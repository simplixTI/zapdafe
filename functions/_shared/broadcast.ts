import type { Env } from './auth';
import { sendText, type UazapiEnv } from './uazapi-send';
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

// One record per lane. Lanes never share a KV key, which keeps their
// read-modify-write cycles from clobbering each other's counters.
interface LaneStats {
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
  chainError?: string;
  chainErrorAtISO?: string;
}

const BROADCAST_ACTIVE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

// Three platform ceilings shape this design:
//   1. A Worker invocation may hold only 6 connections waiting for headers, so
//      a chunk of 10 is really 2 waves of sends (~8 s each, measured).
//   2. waitUntil() gets ~30 s, which is what a chunk must fit in.
//   3. A Worker-to-Worker chain dies after 16 hops (CF-EW-Via, error 1019).
// A single chain therefore tops out around 16 chunks: on 2026-09-19 a run of
// 221 contacts stopped at exactly 160 sent. Splitting the list into
// independent lanes keeps chunks in the proven ~17 s range while cutting the
// hops per chain: 3 lanes over 221 contacts is ~8 hops each, and the ceiling
// moves to LANES * 16 * CHUNK_SIZE contacts.
const CHUNK_SIZE = 10;
const LANES = 3;
const RESUME_URL = 'https://zapdafe.com.br/api/admin/broadcast-resume';

const jobKey = (id: string) => `broadcast:job:${id}`;
const laneKey = (id: string, lane: number) => `broadcast:lane:${id}:${lane}`;
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

  const job: BroadcastJob = { messageId, text, targets };
  await env.KV.put(jobKey(messageId), JSON.stringify(job), { expirationTtl: 60 * 60 * 24 });

  const now = new Date().toISOString();
  const laneSize = Math.ceil(targets.length / LANES);
  const lanes: LaneStats[] = [];
  for (let lane = 0; lane < LANES; lane++) {
    const start = lane * laneSize;
    if (start >= targets.length) break;
    const end = Math.min(start + laneSize, targets.length);
    lanes.push({
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
  await Promise.all(lanes.map((l) => saveLane(env, l)));

  // Lane 0 runs here, saving it a hop; the rest each open their own chain.
  for (const l of lanes) {
    if (l.lane === 0) ctx.waitUntil(runChunk(env, messageId, l.lane, l.start, ctx));
    else ctx.waitUntil(chainNext(env, messageId, l.lane, l.start));
  }
}

async function saveLane(env: Env, lane: LaneStats): Promise<void> {
  await env.KV.put(laneKey(lane.messageId, lane.lane), JSON.stringify(lane), {
    expirationTtl: 60 * 60 * 24 * 30,
  });
}

// Sends one chunk of this lane's slice, then chains to the lane's next chunk
// via a self-fetch to /api/admin/broadcast-resume (a new Worker invocation).
export async function runChunk(
  env: Env,
  messageId: string,
  lane: number,
  cursor: number,
  ctx: Ctx,
): Promise<void> {
  const [jobRaw, laneRaw] = await Promise.all([
    env.KV.get(jobKey(messageId)),
    env.KV.get(laneKey(messageId, lane)),
  ]);
  if (!jobRaw || !laneRaw) return;

  const job = JSON.parse(jobRaw) as BroadcastJob;
  const stats = JSON.parse(laneRaw) as LaneStats;

  const chunkEnd = Math.min(cursor + CHUNK_SIZE, stats.end);
  const chunk = job.targets.slice(cursor, chunkEnd);
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

  const nextCursor = chunkEnd;
  const done = nextCursor >= stats.end;
  stats.cursor = nextCursor;
  if (done) stats.finishedAtISO = new Date().toISOString();
  stats.updatedAtISO = new Date().toISOString();

  await saveLane(env, stats);

  if (done) return;

  // Chain: fire the next chunk in a NEW Worker invocation via self-fetch.
  // waitUntil keeps the current Worker alive until broadcast-resume responds (< 1 s).
  ctx.waitUntil(chainNext(env, messageId, lane, nextCursor));
}

// A broken chain used to be invisible: the run just stopped mid-list and looked
// identical to one still in flight. Record it so /api/admin/broadcasts can say
// where it died and from which cursor to resume.
async function chainNext(
  env: Env,
  messageId: string,
  lane: number,
  cursor: number,
): Promise<void> {
  const url =
    `${RESUME_URL}?messageId=${encodeURIComponent(messageId)}` +
    `&lane=${lane}&cursor=${cursor}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-broadcast-secret': env.AI_WEBHOOK_SECRET },
    });
    if (!res.ok) throw new Error(`broadcast-resume respondeu ${res.status}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('broadcast-resume chain failed:', message);
    await recordChainError(env, messageId, lane, cursor, message);
  }
}

async function recordChainError(
  env: Env,
  messageId: string,
  lane: number,
  cursor: number,
  message: string,
): Promise<void> {
  const raw = await env.KV.get(laneKey(messageId, lane));
  if (!raw) return;
  try {
    const stats = JSON.parse(raw) as LaneStats;
    stats.chainError = `cursor ${cursor}: ${message}`;
    stats.chainErrorAtISO = new Date().toISOString();
    await saveLane(env, stats);
  } catch {
    /* lane record unreadable — nothing useful to write */
  }
}
