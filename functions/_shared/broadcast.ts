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

// Fixamos o TAMANHO do grupo, não a quantidade. Com quantidade fixa, cada
// grupo engordava junto com a lista — foi assim que 3 grupos de 79 viraram
// um problema. Com tamanho fixo o ritmo de envio é sempre o mesmo (um grupo a
// cada 10 min) e só a duração total cresce: 235 contatos dão 3 grupos, 500
// dão 5, 1000 dão 10.
//
// 100 é escolhido para o grupo caber folgado numa invocação: ~10 lotes de 10,
// uns 4 min, contra o teto de 15 min por invocação do cron.
const TAMANHO_ALVO_GRUPO = 100;

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

  const [contactsRaw, optouts] = await Promise.all([
    env.KV.get('arch:contacts'),
    loadOptOutSet(env),
  ]);
  const contacts = contactsRaw ? (JSON.parse(contactsRaw) as Record<string, ArchivedContact>) : {};
  const cutoff = Date.now() - BROADCAST_ACTIVE_WINDOW_MS;

  const targets: string[] = [];
  for (const [chatid, c] of Object.entries(contacts)) {
    if (c.lastMsgAt < cutoff) continue;
    if (optouts.has(chatid.split('@')[0])) continue;
    targets.push(chatid);
  }
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
