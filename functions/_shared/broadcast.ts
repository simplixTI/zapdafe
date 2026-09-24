// Enfileira o devocional. Quem envia é o Worker com cron (ver worker/src/index.ts).
//
// Este arquivo já tentou enviar de três jeitos e os três falharam, sempre pelo
// mesmo motivo de fundo: não existe onde esperar dentro do Pages Functions.
//   1. Tudo num waitUntil            -> morreu no teto de ~30s, 20/221 entregues
//   2. Cadeia de invocações          -> morreu no limite de 16 hops, 160/221
//   3. Faixas paralelas              -> morreu na consistência eventual do KV, 74/221
// Agora ele só grava o trabalho e responde. O Worker acorda de 5 em 5 minutos,
// tem 15 minutos de execução por invocação e manda um grupo por vez.

import type { Env } from './auth';
import { loadOptOutSet } from './optouts';

interface ArchivedContact {
  name: string;
  firstMsgAt: number;
  lastMsgAt: number;
  msgsIn: number;
  msgsOut: number;
}

interface BroadcastJob {
  messageId: string;
  text: string;
  targets: string[];
}

/** Precisa casar com GroupStats em worker/src/index.ts. */
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
}

interface Queue {
  messageId: string;
  groups: number;
  nextGroupAtISO: string;
  createdAtISO: string;
}

const BROADCAST_ACTIVE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
export const ACTIVE_TTL_SECONDS = BROADCAST_ACTIVE_WINDOW_MS / 1000;

// Fixamos o TAMANHO do grupo, não a quantidade. Com quantidade fixa, cada
// grupo engordava junto com a lista — foi assim que 3 grupos de 79 viraram
// um problema. Com tamanho fixo o ritmo de envio é sempre o mesmo (um grupo a
// cada 10 min) e só a duração total cresce: 235 contatos dão 3 grupos, 500
// dão 5, 1000 dão 10.
//
// 100 é escolhido para o grupo caber folgado numa invocação: ~10 lotes de 10,
// uns 4 min, contra o teto de 15 min por invocação do cron.
const TAMANHO_ALVO_GRUPO = 100;

/**
 * Índice de contatos ativos, mantido pelo webhook a cada mensagem recebida.
 * O TTL é a própria janela de atividade: se a chave existe, a pessoa falou
 * com a gente nos últimos 90 dias. Contrato entre o webhook e o disparo.
 *
 * Por que ele existe (incidente de 2026-09-23): os alvos saíam só do
 * `arch:contacts`, que é um retrato tirado pelo `runArchive` — e o runArchive
 * só roda quando ALGUÉM ABRE O /admin com o arquivo vencido há 6h. Ou seja, a
 * lista de quem recebe o devocional dependia de alguém ter aberto o painel.
 * Vinte pessoas que chegaram entre 22/09 13:15 e 23/09 06:37 não receberam o
 * devocional de 23/09 às 10:52 por causa disso.
 *
 * Uma chave por contato, de propósito: `arch:contacts` é um JSON único de 36KB,
 * e mandar o webhook fazer read-modify-write nele a cada mensagem criaria uma
 * corrida capaz de APAGAR contatos — num arquivo que o STATUS.md marca como
 * insubstituível (a Uazapi só guarda ~8 dias de histórico).
 */
export const ACTIVE_KEY_PREFIX = 'active:';

/**
 * Registra que o contato falou com a gente agora. Escrita independente por
 * contato: duas mensagens simultâneas não se atropelam.
 */
export async function markActive(env: Env, chatid: string): Promise<void> {
  await env.KV.put(ACTIVE_KEY_PREFIX + chatid, '1', { expirationTtl: ACTIVE_TTL_SECONDS });
}

/** Lê o índice inteiro, paginando até o fim. */
async function listActiveChatIds(env: Env): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.KV.list({ prefix: ACTIVE_KEY_PREFIX, cursor });
    for (const k of page.keys) out.push(k.name.slice(ACTIVE_KEY_PREFIX.length));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

const QUEUE_KEY = 'broadcast:queue';
const jobKey = (id: string) => `broadcast:job:${id}`;
const laneKey = (id: string, lane: number) => `broadcast:lane:${id}:${lane}`;
const dedupKey = (id: string) => `broadcast:sent:${id}`;

const TTL_7D = 60 * 60 * 24 * 7;
const TTL_30D = 60 * 60 * 24 * 30;

type Ctx = { waitUntil: (p: Promise<unknown>) => void };

/**
 * Monta a lista de alvos e deixa tudo pronto no KV para o Worker.
 * Precisa ser chamado de um handler com waitUntil vivo.
 */
export function runBroadcast(env: Env, text: string, messageId: string, ctx: Ctx): void {
  ctx.waitUntil(enqueue(env, text, messageId));
}

async function enqueue(env: Env, text: string, messageId: string): Promise<void> {
  // Idempotência: o Uazapi reentrega webhook, e sem isso o devocional sairia duas vezes
  if (await env.KV.get(dedupKey(messageId))) return;
  await env.KV.put(dedupKey(messageId), '1', { expirationTtl: TTL_7D });

  const [contactsRaw, optouts, activeChatIds] = await Promise.all([
    env.KV.get('arch:contacts'),
    loadOptOutSet(env),
    listActiveChatIds(env),
  ]);
  const contacts = contactsRaw ? (JSON.parse(contactsRaw) as Record<string, ArchivedContact>) : {};
  const cutoff = Date.now() - BROADCAST_ACTIVE_WINDOW_MS;

  // Duas fontes, uma lista. O arquivo tem o histórico (inclusive quem é
  // anterior ao índice); o índice tem quem chegou depois do último retrato.
  const seen = new Set<string>();
  const targets: string[] = [];
  const add = (chatid: string) => {
    if (seen.has(chatid)) return;
    if (optouts.has(chatid.split('@')[0])) return;
    seen.add(chatid);
    targets.push(chatid);
  };

  for (const [chatid, c] of Object.entries(contacts)) {
    if (c.lastMsgAt < cutoff) continue;
    add(chatid);
  }
  // No índice a janela de 90 dias é o próprio TTL da chave: se ela existe, a
  // pessoa falou com a gente dentro do prazo.
  for (const chatid of activeChatIds) add(chatid);

  if (targets.length === 0) return;

  const job: BroadcastJob = { messageId, text, targets };
  const now = new Date().toISOString();
  // Quantos grupos cabem no tamanho alvo, e então reparte por igual entre eles
  // — 235 viram 3 grupos de 79/79/77, não 2 de 100 e um de 35.
  const qtdGrupos = Math.max(1, Math.ceil(targets.length / TAMANHO_ALVO_GRUPO));
  const groupSize = Math.ceil(targets.length / qtdGrupos);

  const groups: GroupStats[] = [];
  for (let lane = 0; lane < qtdGrupos; lane++) {
    const start = lane * groupSize;
    if (start >= targets.length) break;
    const end = Math.min(start + groupSize, targets.length);
    groups.push({
      messageId,
      lane,
      start,
      end,
      cursor: start,
      total: end - start,
      dispatched: 0,
      failed: 0,
      lastChatid: null,
      startedAtISO: now,
      updatedAtISO: now,
      finishedAtISO: null,
    });
  }

  const queue: Queue = {
    messageId,
    groups: groups.length,
    nextGroupAtISO: now, // o primeiro grupo sai no próximo tick do cron
    createdAtISO: now,
  };

  await Promise.all([
    env.KV.put(jobKey(messageId), JSON.stringify(job), { expirationTtl: TTL_7D }),
    ...groups.map((g) =>
      env.KV.put(laneKey(messageId, g.lane), JSON.stringify(g), { expirationTtl: TTL_30D }),
    ),
    env.KV.put(QUEUE_KEY, JSON.stringify(queue), { expirationTtl: TTL_30D }),
  ]);
}
