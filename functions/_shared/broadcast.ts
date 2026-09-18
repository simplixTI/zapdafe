import type { Env } from './auth';
import { sendText, type UazapiEnv } from './uazapi-send';

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

interface BroadcastStats {
  total: number;
  dispatched: number;
  failed: number;
  lastChatid: string | null;
  startedAtISO: string;
  updatedAtISO: string;
  finishedAtISO: string | null;
}

const BROADCAST_ACTIVE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
// Each chunk runs inside a single waitUntil() invocation. Keep it small enough
// that 10 parallel Uazapi calls complete well inside the ~30 s wall-clock limit.
const CHUNK_SIZE = 10;
const RESUME_URL = 'https://zapdafe.com.br/api/admin/broadcast-resume';

const jobKey = (id: string) => `broadcast:job:${id}`;
const progressKey = (id: string) => `broadcast:progress:${id}`;
const dedupKey = (id: string) => `broadcast:sent:${id}`;

function aiUazapiEnv(env: Env): UazapiEnv {
  return { UAZAPI_BASE: env.AI_UAZAPI_BASE, UAZAPI_TOKEN: env.AI_UAZAPI_TOKEN };
}

type Ctx = { waitUntil: (p: Promise<unknown>) => void };

// Kick off a broadcast. Stores the job in KV and starts the first chunk.
// Must be called from a request handler that has a live waitUntil context.
export function runBroadcast(env: Env, text: string, messageId: string, ctx: Ctx): void {
  ctx.waitUntil(_setup(env, text, messageId, ctx));
}

async function _setup(env: Env, text: string, messageId: string, ctx: Ctx): Promise<void> {
  // Idempotency: skip if this messageId was already processed
  if (await env.KV.get(dedupKey(messageId))) return;
  await env.KV.put(dedupKey(messageId), '1', { expirationTtl: 60 * 60 * 24 * 7 });

  const [contactsRaw, optoutsRaw] = await Promise.all([
    env.KV.get('arch:contacts'),
    env.KV.get('optouts:list'),
  ]);
  const contacts = contactsRaw ? (JSON.parse(contactsRaw) as Record<string, ArchivedContact>) : {};
  const optouts = new Set<string>(optoutsRaw ? (JSON.parse(optoutsRaw) as string[]) : []);
  const cutoff = Date.now() - BROADCAST_ACTIVE_WINDOW_MS;

  const targets: string[] = [];
  for (const [chatid, c] of Object.entries(contacts)) {
    if (c.lastMsgAt < cutoff) continue;
    if (optouts.has(chatid.split('@')[0])) continue;
    targets.push(chatid);
  }

  const job: BroadcastJob = { messageId, text, targets };
  const stats: BroadcastStats = {
    total: targets.length,
    dispatched: 0,
    failed: 0,
    lastChatid: null,
    startedAtISO: new Date().toISOString(),
    updatedAtISO: new Date().toISOString(),
    finishedAtISO: null,
  };

  await Promise.all([
    env.KV.put(jobKey(messageId), JSON.stringify(job), { expirationTtl: 60 * 60 * 24 }),
    env.KV.put(progressKey(messageId), JSON.stringify(stats), { expirationTtl: 60 * 60 * 24 * 30 }),
  ]);

  // Start first chunk — runs inside the same waitUntil context
  ctx.waitUntil(runChunk(env, messageId, 0, ctx));
}

// Processes targets[cursor..cursor+CHUNK_SIZE], then chains to the next chunk
// by firing a self-fetch to /api/admin/broadcast-resume (new Worker invocation).
export async function runChunk(env: Env, messageId: string, cursor: number, ctx: Ctx): Promise<void> {
  const [jobRaw, statsRaw] = await Promise.all([
    env.KV.get(jobKey(messageId)),
    env.KV.get(progressKey(messageId)),
  ]);
  if (!jobRaw || !statsRaw) return;

  const job = JSON.parse(jobRaw) as BroadcastJob;
  const stats = JSON.parse(statsRaw) as BroadcastStats;

  const chunk = job.targets.slice(cursor, cursor + CHUNK_SIZE);
  if (chunk.length === 0) return;

  const aiEnv = aiUazapiEnv(env);
  await Promise.all(
    chunk.map(async (chatid) => {
      try {
        await sendText(aiEnv, chatid, job.text);
        stats.dispatched += 1;
      } catch (err) {
        stats.failed += 1;
        console.error(`broadcast send to ${chatid}:`, err instanceof Error ? err.message : String(err));
      }
      stats.lastChatid = chatid;
    }),
  );

  const nextCursor = cursor + CHUNK_SIZE;
  const done = nextCursor >= job.targets.length;
  if (done) stats.finishedAtISO = new Date().toISOString();
  stats.updatedAtISO = new Date().toISOString();

  await env.KV.put(progressKey(messageId), JSON.stringify(stats), { expirationTtl: 60 * 60 * 24 * 30 });

  if (done) {
    await env.KV.put(`broadcast:log:${messageId}`, JSON.stringify(stats), { expirationTtl: 60 * 60 * 24 * 30 });
    return;
  }

  // Chain: fire the next chunk in a NEW Worker invocation via self-fetch.
  // waitUntil keeps the current Worker alive until broadcast-resume responds (< 1 s).
  ctx.waitUntil(
    fetch(`${RESUME_URL}?messageId=${encodeURIComponent(messageId)}&cursor=${nextCursor}`, {
      method: 'POST',
      headers: { 'x-broadcast-secret': env.AI_WEBHOOK_SECRET },
    }).catch((err) => {
      console.error('broadcast-resume chain failed:', err instanceof Error ? err.message : String(err));
    }),
  );
}
