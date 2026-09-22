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
const BATCH_PAUSE_MS = 6000;
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
// Espaçamento entre grupos, pedido do cliente — evita parecer disparo em massa.
const GROUP_INTERVAL_MIN = 10;

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
 * Envia o que falta de um grupo, salvando progresso a cada lote. Devolve
 * `true` se o grupo terminou; `false` se parou no teto de envios da invocação
 * e precisa continuar no próximo tick.
 */
async function sendGroup(env: Env, job: BroadcastJob, group: GroupStats): Promise<boolean> {
  const uazapi = aiEnv(env);

  let primeiroLote = true;
  let enviadosNestaInvocacao = 0;

  while (group.cursor < group.end) {
    if (enviadosNestaInvocacao + BATCH_SIZE > MAX_ENVIOS_POR_INVOCACAO) {
      console.log(`[devocional] grupo ${group.lane}: teto da invocação, continua no próximo tick`);
      return false;
    }
    // Freio entre lotes — ver BATCH_PAUSE_MS
    if (!primeiroLote) await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
    primeiroLote = false;

    const batchEnd = Math.min(group.cursor + BATCH_SIZE, group.end);
    const batch = job.targets.slice(group.cursor, batchEnd);

    await Promise.all(
      batch.map(async (chatid) => {
        try {
          await sendText(uazapi, chatid, job.text);
          group.dispatched += 1;
        } catch (err) {
          group.failed += 1;
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`envio para ${chatid} falhou:`, msg);
          // Com o número junto: em 2026-09-22 uma falha sozinha custou uma
          // varredura no histórico da Uazapi só para descobrir de quem era.
          const amostra = (group.errosAmostra ??= []);
          const linha = `${chatid.split('@')[0]}: ${msg}`;
          if (amostra.length < MAX_ERROS_AMOSTRA && !amostra.includes(linha)) amostra.push(linha);
        }
        group.lastChatid = chatid;
      }),
    );

    // Progresso salvo lote a lote: se esta invocação morrer, o próximo tick
    // retoma exatamente daqui em vez de reenviar para quem já recebeu.
    group.cursor = batchEnd;
    group.updatedAtISO = new Date().toISOString();
    enviadosNestaInvocacao += batch.length;
    await saveGroup(env, group);
  }

  group.finishedAtISO = new Date().toISOString();
  await saveGroup(env, group);
  return true;
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

  const terminou = await sendGroup(env, job, pending);
  if (!terminou) {
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
