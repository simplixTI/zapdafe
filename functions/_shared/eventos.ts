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

  const chatid = pegar(payload,
    ['chatid'], ['message', 'chatid'], ['data', 'chatid'],
    ['key', 'remoteJid'], ['message', 'key', 'remoteJid'], ['data', 'key', 'remoteJid'],
  );
  const status = pegar(payload,
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
