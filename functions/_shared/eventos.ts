// Eventos da Uazapi que não são mensagem de contato.
//
// Até 2026-11-16 o webhook assinava só `messages`. Isso custou caro duas vezes:
//
//   1. A sessão caiu em 15/11 às 14:42 e ficou **24 horas muda para todo
//      mundo** sem ninguém saber. O evento `connection` avisa no segundo em
//      que cai, com o motivo.
//   2. O arquivo (`arch:*`) acumula QUANTIDADE de mensagem, nunca status de
//      entrega — `msgsOut` conta o que saiu daqui, não o que chegou lá. Para
//      decidir quem parou de receber, a única fonte era a janela de ~8 dias da
//      Uazapi, o que reduz qualquer medição a 4 ou 5 devocionais. O evento
//      `messages_update` deixa a gente acumular isso por conta própria.
//
// ⚠️ O formato exato do payload destes dois eventos não está na documentação
// pública, só os nomes. Por isso tudo aqui lê de forma defensiva, por vários
// caminhos possíveis, e guarda uma amostra crua do primeiro payload de cada
// tipo (`debug:evento:*`, TTL de 2 dias) para conferir o formato de verdade
// depois que começarem a chegar. Quando estiver confirmado, dá para apertar.

import type { Env } from './auth';

const TTL_2D = 60 * 60 * 24 * 2;
const TTL_180D = 60 * 60 * 24 * 180;

/** Estado atual da sessão, como o último evento `connection` deixou. */
export interface EstadoSessao {
  status: string;
  motivo: string;
  emISO: string;
}

/** Uma queda: quando caiu, quando voltou (null = ainda fora), e por quê. */
export interface QuedaSessao {
  caiuEmISO: string;
  voltouEmISO: string | null;
  motivo: string;
}

const CHAVE_ESTADO = 'sessao:estado';
const CHAVE_QUEDAS = 'sessao:quedas';
const MAX_QUEDAS = 20;

type Payload = Record<string, unknown>;

function pegar(obj: unknown, ...caminhos: string[][]): string {
  for (const caminho of caminhos) {
    let cur: unknown = obj;
    for (const parte of caminho) {
      if (cur && typeof cur === 'object' && parte in (cur as Payload)) {
        cur = (cur as Payload)[parte];
      } else {
        cur = undefined;
        break;
      }
    }
    if (typeof cur === 'string' && cur.length > 0) return cur;
  }
  return '';
}

/** Guarda uma amostra crua, para conferir o formato real do evento. */
async function guardarAmostra(env: Env, tipo: string, payload: unknown): Promise<void> {
  const chave = `debug:evento:${tipo}`;
  if (await env.KV.get(chave)) return; // já tenho uma
  await env.KV.put(chave, JSON.stringify(payload).slice(0, 8000), { expirationTtl: TTL_2D });
}

const TTL_7D = 60 * 60 * 24 * 7;

/**
 * Sonda de formato, para QUALQUER payload que não seja uma mensagem comum.
 *
 * ⚠️ Esta função existe por causa de um erro meu em 2026-11-16: eu assinei os
 * eventos `connection` e `messages_update` e pus a captura da amostra DENTRO
 * dos tratadores. Como a condição que eu não tinha certeza (`payload.event`)
 * nunca casou, nada foi gravado — enterrei a sonda atrás exatamente da coisa
 * que eu queria medir. Em 23/11 a sessão caiu, voltou, e um devocional de 531
 * mensagens passou, e eu tinha zero amostras para olhar.
 *
 * Agora a captura vem ANTES de qualquer decisão. A chave é a assinatura das
 * chaves de topo do payload, então ela se deduplica por FORMATO e é
 * auto-explicativa: ver `debug:payload:event,instance` no KV já conta de onde
 * veio. Também guarda cabeçalhos selecionados, porque o tipo do evento pode
 * estar vindo por header em vez de corpo.
 *
 * A URL é guardada sem query string: o secret do webhook vive nela.
 */
export async function guardarFormatoDesconhecido(
  env: Env,
  payload: Record<string, unknown>,
  req: Request,
): Promise<void> {
  const assinatura = (Object.keys(payload).sort().join(',') || 'sem-chaves').slice(0, 120);
  const chave = `debug:payload:${assinatura}`;
  if (await env.KV.get(chave)) return;

  const cabecalhos: Record<string, string> = {};
  for (const nome of ['content-type', 'user-agent', 'x-event', 'x-event-type', 'x-webhook-event']) {
    const v = req.headers.get(nome);
    if (v) cabecalhos[nome] = v.slice(0, 120);
  }

  const amostra = {
    visto: new Date().toISOString(),
    caminho: new URL(req.url).pathname,
    cabecalhos,
    payload,
  };
  await env.KV.put(chave, JSON.stringify(amostra).slice(0, 8000), { expirationTtl: TTL_7D });
}

/**
 * Evento `connection`: a sessão do WhatsApp caiu ou voltou.
 *
 * Não tenta avisar ninguém — avisar por WhatsApp que o WhatsApp caiu não
 * funciona. O que isso resolve é o sistema **saber**: o painel mostra na hora
 * e a janela exata da queda fica gravada, em vez de ser reconstruída depois
 * por arqueologia no histórico.
 */
export async function registrarConexao(env: Env, payload: unknown): Promise<string> {
  await guardarAmostra(env, 'connection', payload);

  const status = (pegar(payload,
    ['status'], ['instance', 'status'], ['data', 'status'], ['connection'], ['state'],
  ) || 'desconhecido').toLowerCase();

  const motivo = pegar(payload,
    ['lastDisconnectReason'], ['instance', 'lastDisconnectReason'],
    ['data', 'lastDisconnectReason'], ['reason'], ['message'],
  );

  const agora = new Date().toISOString();
  const anterior = await env.KV.get(CHAVE_ESTADO);
  const estadoAnterior = anterior ? (JSON.parse(anterior) as EstadoSessao) : null;

  await env.KV.put(
    CHAVE_ESTADO,
    JSON.stringify({ status, motivo, emISO: agora } satisfies EstadoSessao),
  );

  // Só mexe no histórico quando o estado MUDA. Sem isso, um evento repetido de
  // "connected" abriria uma queda nova a cada batida.
  const estavaConectado = estadoAnterior?.status === 'connected';
  const agoraConectado = status === 'connected';
  if (estadoAnterior && estavaConectado === agoraConectado) return `connection: ${status} (sem mudança)`;

  const brutas = await env.KV.get(CHAVE_QUEDAS);
  const quedas = brutas ? (JSON.parse(brutas) as QuedaSessao[]) : [];

  if (!agoraConectado) {
    quedas.unshift({ caiuEmISO: agora, voltouEmISO: null, motivo: motivo || status });
  } else if (quedas[0] && !quedas[0].voltouEmISO) {
    quedas[0].voltouEmISO = agora;
  }

  await env.KV.put(CHAVE_QUEDAS, JSON.stringify(quedas.slice(0, MAX_QUEDAS)));
  console.error(`[sessao] ${estadoAnterior?.status ?? '?'} -> ${status}${motivo ? ` (${motivo})` : ''}`);
  return `connection: ${status}`;
}

const ENTREGA_PREFIX = 'entrega:';

/**
 * Evento `messages_update`: o status de uma mensagem mudou.
 *
 * Só interessa `Delivered` e `Read` — "Sent" significa que a Uazapi aceitou,
 * que é justamente o que o nosso registro de disparo já conta e justamente o
 * que NÃO prova entrega.
 *
 * Uma chave por contato, sem leitura antes da escrita: duas atualizações
 * simultâneas não se atropelam. Mesmo desenho do índice `active:`.
 */
export async function registrarEntrega(env: Env, payload: unknown): Promise<string> {
  await guardarAmostra(env, 'messages_update', payload);

  // Os dois primeiros caminhos de cada lista são o formato REAL, confirmado em
  // 2026-11-25 pela amostra da sonda:
  //
  //   { EventType: "messages_update", state: "Delivered", type: "ReadReceipt",
  //     event: { Chat, chatid, Type: "Delivered", MessageIDs: [...] } }
  //
  // O status mora em `state` (topo) ou `event.Type`, e o telefone em
  // `event.chatid`. Nenhum dos caminhos que eu havia escrito em 16/11 — todos
  // em cima de `status` e `chatid` no topo — existe neste payload. O resto da
  // lista fica como rede, para a Uazapi mudar de formato sem apagar a medição.
  const chatid = pegar(payload,
    ['event', 'chatid'], ['event', 'Chat'],
    ['chatid'], ['message', 'chatid'], ['data', 'chatid'],
    ['key', 'remoteJid'], ['message', 'key', 'remoteJid'], ['data', 'key', 'remoteJid'],
  );
  const status = pegar(payload,
    ['state'], ['event', 'Type'],
    ['status'], ['message', 'status'], ['data', 'status'],
  ).toLowerCase();

  if (!chatid) return 'messages_update sem chatid';
  if (status !== 'delivered' && status !== 'read') return `messages_update: ${status} (ignorado)`;

  const phone = chatid.split('@')[0];
  await env.KV.put(`${ENTREGA_PREFIX}${phone}`, new Date().toISOString(), {
    expirationTtl: TTL_180D,
  });
  return `entrega registrada: ${phone} (${status})`;
}

/** Quando foi a última vez que algo chegou de verdade nesse número. */
export async function ultimaEntrega(env: Env, phone: string): Promise<string | null> {
  return env.KV.get(`${ENTREGA_PREFIX}${phone}`);
}
