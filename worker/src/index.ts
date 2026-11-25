// Worker do devocional. O webhook do Pages apenas enfileira o trabalho no KV;
// quem envia é este cron.
//
// Por que existe: dentro do Pages Functions não há como esperar entre um grupo
// e outro — `waitUntil()` morre em ~30s. Foi essa limitação que gerou o
// encadeamento de invocações, que esbarrou no limite de 16 hops Worker→Worker,
// que virou faixas paralelas, que quebraram na consistência eventual do KV.
// Três desenhos, três disparos incompletos (20/221, 160/221, 74/221).
//
// Um Cron Trigger tem 15 minutos de execução, então um grupo inteiro cabe numa
// invocação só. E como ele acorda minutos depois de o webhook ter escrito, a
// corrida de leitura-após-escrita deixa de existir.

import { sendText, type UazapiEnv } from '../../functions/_shared/uazapi-send';

export interface Env {
  KV: KVNamespace;
  AI_UAZAPI_BASE: string;
  AI_UAZAPI_TOKEN: string;
}

interface BroadcastJob {
  messageId: string;
  text: string;
  targets: string[];
}

interface GroupStats {
  messageId: string;
  lane: number;
  start: number;
  end: number;
  cursor: number;
  total: number;
  dispatched: number;
  failed: number;
  lastChatid: string | null;
  startedAtISO: string;
  updatedAtISO: string;
  finishedAtISO: string | null;
  /** Amostra dos erros de envio. Sem isso a falha some no console e o painel
   *  só mostra um número, que não diz nada sobre a causa. */
  errosAmostra?: string[];
  /** Quantas falhas a segunda tentativa recuperou. */
  retentadosOk?: number;
}

interface Queue {
  messageId: string;
  groups: number;
  nextGroupAtISO: string;
  createdAtISO: string;
}

// 6 conexões simultâneas por invocação: um lote de 10 vira 2 ondas de ~8s.
const BATCH_SIZE = 10;
// Pausa entre lotes. No desenho antigo cada lote rodava numa invocação
// separada, e os ~13s de troca funcionavam como freio sem ninguém ter
// projetado isso. Ao juntar tudo numa invocação só, o envio ficou contínuo e
// a Uazapi passou a recusar: 86 de 235 falharam em 2026-09-21. O freio agora
// é explícito.
// Subiu de 6s para 12s em 2026-11-16. Nao foi para resolver a queda daquela
// semana (que foi deslogue de sessao, nao restricao por volume), e sim
// prudencia: a base foi de 235 para 553 contatos, e volume alto para gente que
// nunca responde e o perfil que o WhatsApp penaliza.
const BATCH_PAUSE_MS = 12000;
// Teto de envios por invocação. Dois limites em jogo:
//   - chamadas externas: 50 no plano gratuito (foi o que quebrou o disparo de
//     2026-09-21, com exatamente os 50 primeiros de cada grupo chegando),
//     10.000 no Workers Paid, assinado em 2026-09-22 e medido com
//     /health?probe=subrequests
//   - relógio: 15 min por invocação. Com a pausa de 6s entre lotes, 200 envios
//     levam ~8 min, ainda com folga
// O que passar do teto continua no tick seguinte, pelo cursor já salvo — então
// mesmo que a conta volte ao plano gratuito, o disparo entrega tudo, só mais
// devagar. Se isso acontecer, baixe para 45.
const MAX_ENVIOS_POR_INVOCACAO = 200;
/** Quantos erros distintos guardar por grupo, para diagnóstico. */
const MAX_ERROS_AMOSTRA = 5;
// Teto da segunda tentativa. Folgado para o que se vê na prática (0 a 2 falhas
// em 400+ envios) e baixo o bastante para não virar um segundo disparo se algo
// der muito errado.
const MAX_RETENTATIVAS = 20;
// Espaçamento entre grupos, pedido do cliente — evita parecer disparo em massa.
// Subiu de 10 para 15 em 2026-11-16, mesma razao do BATCH_PAUSE_MS.
// ⚠️ Mudou aqui, muda o BROADCAST_GROUP_INTERVAL_MIN em
// src/pages/admin/index.astro — e com ele o limiar que o painel usa para
// dizer "Parado". Em 09/11 o painel passou semanas chamando disparo saudavel
// de morto por causa dessa constante dessincronizada.
const GROUP_INTERVAL_MIN = 15;

// Por quanto tempo vale insistir num disparo travado por sessao caida. Depois
// disso o devocional do dia perdeu a hora: mandar o texto de domingo na
// segunda-feira e pior que nao mandar.
const HORAS_LIMITE_DO_DISPARO = 6;

/**
 * True quando o erro é da SESSÃO do WhatsApp, não daquele contato.
 *
 * A diferença decide tudo: falha de contato (um 403 porque aquela pessoa
 * bloqueou) é para contar e seguir; falha de sessão significa que NENHUM envio
 * vai funcionar, e insistir só queima a lista inteira.
 *
 * Em 2026-11-15 a sessão caiu às 14:42 (deslogada de outro aparelho) no meio do
 * grupo 1. Os grupos 2 a 5 tentaram 361 envios com a sessão morta, todos
 * falharam um por um, e o disparo se declarou "Concluído" — 418 pessoas sem
 * receber, fila limpa, nada para retomar.
 */
function ehFalhaDeSessao(msg: string): boolean {
  const m = msg.toLowerCase();
  // O 403 vem PRIMEIRO, e isso não é detalhe: ele é recusa daquele contato
  // (a pessoa bloqueou o número), e já apareceu em produção dentro de resposta
  // 500 **e** 503. Sem esta linha na frente, a heurística de "503 = sessão"
  // leria um bloqueio individual como queda de sessão e pararia o disparo
  // inteiro por causa de uma pessoa. Achado pelo próprio teste.
  if (m.includes('whatsapp server error 403')) return false;
  return (
    m.includes('disconnected') ||
    m.includes('not reconnecting') ||
    m.includes("store doesn't contain a device jid") ||
    m.includes('/send/text 503')
  );
}

/** Pergunta à Uazapi se a sessão está de pé. Uma chamada, antes de queimar envios. */
async function sessaoConectada(env: Env): Promise<boolean> {
  try {
    const res = await fetch(`${env.AI_UAZAPI_BASE}/instance/status`, {
      headers: { token: env.AI_UAZAPI_TOKEN },
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { instance?: { status?: string }; status?: string };
    const status = json.instance?.status ?? json.status ?? '';
    return status === 'connected';
  } catch {
    // Não dá para afirmar que caiu: na dúvida segue e deixa o envio decidir.
    return true;
  }
}

const QUEUE_KEY = 'broadcast:queue';
const jobKey = (id: string) => `broadcast:job:${id}`;
const laneKey = (id: string, lane: number) => `broadcast:lane:${id}:${lane}`;

const TTL_30D = 60 * 60 * 24 * 30;

function aiEnv(env: Env): UazapiEnv {
  return { UAZAPI_BASE: env.AI_UAZAPI_BASE, UAZAPI_TOKEN: env.AI_UAZAPI_TOKEN };
}

async function readJson<T>(env: Env, key: string): Promise<T | null> {
  const raw = await env.KV.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function saveGroup(env: Env, g: GroupStats): Promise<void> {
  await env.KV.put(laneKey(g.messageId, g.lane), JSON.stringify(g), { expirationTtl: TTL_30D });
}

/**
 * Por que o grupo parou:
 *   'concluido' — mandou tudo
 *   'teto'      — bateu no teto de envios da invocação, retoma no próximo tick
 *   'sessao'    — a sessão do WhatsApp caiu; NÃO avançou o cursor
 */
type ParadaDoGrupo = 'concluido' | 'teto' | 'sessao';

/**
 * Envia o que falta de um grupo, salvando progresso a cada lote.
 */
async function sendGroup(env: Env, job: BroadcastJob, group: GroupStats): Promise<ParadaDoGrupo> {
  const uazapi = aiEnv(env);

  let primeiroLote = true;
  let enviadosNestaInvocacao = 0;
  // Quem falhou nesta invocação, para uma segunda tentativa no fim do grupo.
  const falhas: string[] = [];

  // Uma pergunta antes de queimar o primeiro envio: se a sessão já está fora,
  // nem começa.
  if (!(await sessaoConectada(env))) {
    console.error(`[devocional] grupo ${group.lane}: sessão do WhatsApp fora do ar, não vou tentar`);
    return 'sessao';
  }

  while (group.cursor < group.end) {
    if (enviadosNestaInvocacao + BATCH_SIZE > MAX_ENVIOS_POR_INVOCACAO) {
      console.log(`[devocional] grupo ${group.lane}: teto da invocação, continua no próximo tick`);
      return 'teto';
    }
    // Freio entre lotes — ver BATCH_PAUSE_MS
    if (!primeiroLote) await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
    primeiroLote = false;

    const batchEnd = Math.min(group.cursor + BATCH_SIZE, group.end);
    const batch = job.targets.slice(group.cursor, batchEnd);

    let falhasDoLote = 0;
    let sessaoCaiu = false;

    await Promise.all(
      batch.map(async (chatid) => {
        try {
          await sendText(uazapi, chatid, job.text);
          group.dispatched += 1;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`envio para ${chatid} falhou:`, msg);
          if (ehFalhaDeSessao(msg)) {
            sessaoCaiu = true;
            falhasDoLote += 1;
            return; // não conta como falha do contato: ninguém tentou de verdade
          }
          group.failed += 1;
          falhas.push(chatid);
          // Com o número junto: em 2026-09-22 uma falha sozinha custou uma
          // varredura no histórico da Uazapi só para descobrir de quem era.
          const amostra = (group.errosAmostra ??= []);
          const linha = `${chatid.split('@')[0]}: ${msg}`;
          if (amostra.length < MAX_ERROS_AMOSTRA && !amostra.includes(linha)) amostra.push(linha);
        }
        group.lastChatid = chatid;
      }),
    );

    // Sessão caiu no meio do lote: para aqui SEM avançar o cursor, para o
    // próximo tick retomar exatamente estes contatos. O que já saiu neste lote
    // pode duplicar — receber duas vezes é muito melhor que não receber.
    if (sessaoCaiu) {
      console.error(
        `[devocional] grupo ${group.lane}: sessão caiu no cursor ${group.cursor} ` +
        `(${falhasDoLote} de ${batch.length} do lote). Parando sem avançar.`,
      );
      group.updatedAtISO = new Date().toISOString();
      await saveGroup(env, group);
      return 'sessao';
    }

    // Progresso salvo lote a lote: se esta invocação morrer, o próximo tick
    // retoma exatamente daqui em vez de reenviar para quem já recebeu.
    group.cursor = batchEnd;
    group.updatedAtISO = new Date().toISOString();
    enviadosNestaInvocacao += batch.length;
    await saveGroup(env, group);
  }

  // Segunda tentativa para quem falhou.
  //
  // O `WhatsApp server error 403` do disparo é PASSAGEIRO, não bloqueio: a
  // mesma contato ("Diana - iFood") falhou em 03/10 e 06/10 e recebeu normal
  // em 04 e 05. Sem retentativa, a pessoa simplesmente perde o devocional do
  // dia por uma recusa de alguns segundos. Nos últimos 7 disparos foram 0 a 2
  // falhas em mais de 400 envios, então isso custa quase nada.
  //
  // Roda só depois do grupo inteiro: dá minutos de distância do primeiro
  // envio, que é justamente o que uma recusa passageira precisa. Falha que
  // sobreviver aqui continua contada em `group.failed` e no `errosAmostra`.
  //
  // Cobre apenas as falhas DESTA invocação — se o grupo foi retomado por outro
  // tick, as falhas do tick anterior não voltam. Hoje um grupo cabe numa
  // invocação só (MAX_ENVIOS_POR_INVOCACAO = 200 contra grupo de 100), então
  // na prática cobre tudo.
  const paraRetentar = falhas.slice(0, MAX_RETENTATIVAS);
  if (paraRetentar.length > 0) {
    console.log(`[devocional] grupo ${group.lane}: retentando ${paraRetentar.length} falha(s)`);
    for (const chatid of paraRetentar) {
      try {
        await sendText(uazapi, chatid, job.text);
        group.dispatched += 1;
        group.failed -= 1;
        group.retentadosOk = (group.retentadosOk ?? 0) + 1;
      } catch (err) {
        console.error(`retentativa para ${chatid} falhou:`, err instanceof Error ? err.message : String(err));
      }
    }
  }

  group.finishedAtISO = new Date().toISOString();
  await saveGroup(env, group);
  return 'concluido';
}

export async function runDue(env: Env, now = Date.now()): Promise<string> {
  const queue = await readJson<Queue>(env, QUEUE_KEY);
  if (!queue) return 'nada na fila';

  if (now < Date.parse(queue.nextGroupAtISO)) {
    return `próximo grupo só às ${queue.nextGroupAtISO}`;
  }

  const job = await readJson<BroadcastJob>(env, jobKey(queue.messageId));
  if (!job) {
    await env.KV.delete(QUEUE_KEY);
    return `job ${queue.messageId} sumiu do KV (TTL?), fila limpa`;
  }

  // Primeiro grupo ainda não terminado
  let pending: GroupStats | null = null;
  for (let lane = 0; lane < queue.groups; lane++) {
    const g = await readJson<GroupStats>(env, laneKey(queue.messageId, lane));
    if (g && !g.finishedAtISO) {
      pending = g;
      break;
    }
  }

  if (!pending) {
    await env.KV.delete(QUEUE_KEY);
    return `disparo ${queue.messageId} concluído`;
  }

  const parada = await sendGroup(env, job, pending);

  if (parada === 'sessao') {
    // A fila fica como está, então o próximo tick (5 min) tenta de novo o
    // mesmo grupo, do mesmo cursor. Uma queda de 10 minutos passa a custar 10
    // minutos, e não o disparo inteiro.
    const idadeH = (now - Date.parse(queue.createdAtISO)) / 3_600_000;
    if (idadeH > HORAS_LIMITE_DO_DISPARO) {
      // Antes de 2026-11-25 o abandono era MUDO: apagava a fila e ia embora.
      // As faixas ficavam para sempre com `finishedAtISO: null`, idênticas a um
      // disparo ainda em andamento, e a conta de quem ficou sem receber só
      // existia se alguém somasse os cursores à mão no KV — foi o que eu tive
      // de fazer em 17/11 (393 pessoas) e em 24/11 (409). Três quedas e nenhum
      // registro do prejuízo.
      //
      // Agora o abandono deixa recibo. É a mesma lição do painel em 09/11: o
      // que o sistema não grava, o operador descobre tarde, por reclamação.
      await registrarAbandono(env, queue, idadeH);
      await env.KV.delete(QUEUE_KEY);
      return `disparo ${queue.messageId} abandonado: sessão fora do ar há ${idadeH.toFixed(1)}h, ` +
        `passou do limite de ${HORAS_LIMITE_DO_DISPARO}h`;
    }
    return `grupo ${pending.lane}: sessão do WhatsApp fora do ar, retomo no próximo tick ` +
      `(disparo com ${idadeH.toFixed(1)}h de vida)`;
  }

  if (parada === 'teto') {
    // Grupo interrompido no teto da invocação: não mexe no relógio da fila,
    // para o próximo tick retomar este mesmo grupo de onde parou.
    return `grupo ${pending.lane}: ${pending.dispatched}/${pending.total} (continua no próximo tick)`;
  }

  const restam = pending.lane + 1 < queue.groups;
  if (restam) {
    const next: Queue = {
      ...queue,
      nextGroupAtISO: new Date(now + GROUP_INTERVAL_MIN * 60 * 1000).toISOString(),
    };
    await env.KV.put(QUEUE_KEY, JSON.stringify(next), { expirationTtl: TTL_30D });
  } else {
    await env.KV.delete(QUEUE_KEY);
  }

  return `grupo ${pending.lane}: ${pending.dispatched} enviados, ${pending.failed} falhas`;
}

/** Recibo de um disparo abandonado: quantos ficaram sem receber, e por quê. */
export interface Abandono {
  messageId: string;
  abandonadoEmISO: string;
  idadeHoras: number;
  enviados: number;
  total: number;
  faltantes: number;
  motivo: string;
}

/**
 * Grava o recibo do abandono. Soma os cursores das faixas na hora — são 6
 * leituras de KV, e só acontecem quando um disparo morre, o que é raro.
 *
 * Não tenta reenviar nada: o limite de 6h existe porque devocional de ontem
 * chegando hoje é pior do que não chegar. O que faltava era o número ficar
 * registrado em vez de precisar de arqueologia.
 */
async function registrarAbandono(env: Env, queue: Queue, idadeH: number): Promise<void> {
  let enviados = 0;
  let total = 0;
  for (let lane = 0; lane < queue.groups; lane++) {
    const g = await readJson<GroupStats>(env, laneKey(queue.messageId, lane));
    if (!g) continue;
    enviados += g.dispatched;
    total += g.total;
  }
  const recibo: Abandono = {
    messageId: queue.messageId,
    abandonadoEmISO: new Date().toISOString(),
    idadeHoras: Number(idadeH.toFixed(1)),
    enviados,
    total,
    faltantes: Math.max(0, total - enviados),
    motivo: 'sessao do WhatsApp fora do ar',
  };
  await env.KV.put(`broadcast:abandonado:${queue.messageId}`, JSON.stringify(recibo), {
    expirationTtl: TTL_30D,
  });
  console.error(
    `[broadcast] abandonado ${queue.messageId}: ${recibo.faltantes} de ${total} sem receber ` +
    `(sessao fora ha ${recibo.idadeHoras}h)`,
  );
}

/**
 * Confere se o Worker está de fato utilizável: KV acessível e credenciais da
 * Uazapi válidas. Sem isso, um secret errado só apareceria no próximo disparo
 * — tarde demais. Autenticado com o próprio token, então não revela nada a
 * quem já não o tivesse.
 */
async function health(env: Env, url: URL): Promise<Response> {
  const ok = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });

  if (url.searchParams.get('token') !== env.AI_UAZAPI_TOKEN) {
    return ok({ error: 'token nao confere' }, 401);
  }

  let kv = 'ok';
  try {
    await env.KV.get(QUEUE_KEY);
  } catch (err) {
    kv = `falhou: ${err instanceof Error ? err.message : String(err)}`;
  }

  let uazapi: string;
  try {
    const res = await fetch(`${env.AI_UAZAPI_BASE}/instance/status`, {
      headers: { token: env.AI_UAZAPI_TOKEN },
    });
    uazapi = res.ok ? 'ok' : `HTTP ${res.status}`;
  } catch (err) {
    uazapi = `falhou: ${err instanceof Error ? err.message : String(err)}`;
  }

  // ?probe=subrequests mede o teto real de chamadas externas por invocação —
  // 50 no plano gratuito, milhares no pago. Foi esse limite, invisível até
  // 2026-09-22, que derrubou 86 envios do devocional. Mede em vez de supor.
  if (url.searchParams.get('probe') === 'subrequests') {
    const ALVO = 70;
    let okCount = 0;
    let primeiroErro = '';
    for (let i = 0; i < ALVO; i++) {
      try {
        const r = await fetch(`https://cloudflare.com/cdn-cgi/trace?i=${i}`);
        await r.text();
        okCount++;
      } catch (err) {
        primeiroErro = `na chamada ${i + 1}: ${err instanceof Error ? err.message : String(err)}`;
        break;
      }
    }
    return ok({
      chamadasFeitas: okCount,
      tentadas: ALVO,
      primeiroErro: primeiroErro || null,
      plano: okCount >= ALVO ? 'pago (limite alto)' : `gratuito ou limitado em ~${okCount}`,
    });
  }

  const queue = await readJson<Queue>(env, QUEUE_KEY);
  return ok({
    worker: 'zapdafe-broadcast',
    kv,
    uazapi,
    base: env.AI_UAZAPI_BASE,
    tokenChars: env.AI_UAZAPI_TOKEN.length,
    fila: queue ? { messageId: queue.messageId, grupos: queue.groups, proximoAsISO: queue.nextGroupAtISO } : null,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return health(env, url);
    return new Response('zapdafe-broadcast', { status: 200 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runDue(env)
        .then((r) => console.log(`[devocional] ${r}`))
        .catch((err) => console.error('[devocional] erro:', err instanceof Error ? err.message : String(err))),
    );
  },
};
