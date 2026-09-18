import type { Env } from './auth';
import { sendText, type UazapiEnv } from './uazapi-send';

interface ArchivedContact {
  name: string;
  firstMsgAt: number;
  lastMsgAt: number;
  msgsIn: number;
  msgsOut: number;
}

const BROADCAST_ACTIVE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

function phoneFromChatId(chatid: string): string {
  return chatid.split('@')[0];
}

function aiUazapiEnv(env: Env): UazapiEnv {
  return { UAZAPI_BASE: env.AI_UAZAPI_BASE, UAZAPI_TOKEN: env.AI_UAZAPI_TOKEN };
}

export async function runBroadcast(
  env: Env,
  sourceText: string,
  messageId: string,
  ctx: { waitUntil: (p: Promise<unknown>) => void },
): Promise<void> {
  ctx.waitUntil(_handleDevotionalBroadcast(env, sourceText, messageId));
}

async function _handleDevotionalBroadcast(env: Env, sourceText: string, messageId: string): Promise<void> {
  // Idempotency: if we already broadcast this messageId, skip
  const dedupKey = `broadcast:sent:${messageId}`;
  if (await env.KV.get(dedupKey)) return;
  await env.KV.put(dedupKey, '1', { expirationTtl: 60 * 60 * 24 * 7 });

  const contactsRaw = await env.KV.get('arch:contacts');
  const optoutsRaw = await env.KV.get('optouts:list');
  const contacts = contactsRaw ? (JSON.parse(contactsRaw) as Record<string, ArchivedContact>) : {};
  const optouts = new Set<string>(optoutsRaw ? (JSON.parse(optoutsRaw) as string[]) : []);
  const cutoff = Date.now() - BROADCAST_ACTIVE_WINDOW_MS;

  const targets: string[] = [];
  for (const [chatid, c] of Object.entries(contacts)) {
    if (c.lastMsgAt < cutoff) continue;
    if (optouts.has(phoneFromChatId(chatid))) continue;
    targets.push(chatid);
  }

  const progressKey = `broadcast:progress:${messageId}`;
  const startedAt = Date.now();
  const stats = {
    total: targets.length,
    dispatched: 0,
    failed: 0,
    lastChatid: null as string | null,
    startedAtISO: new Date(startedAt).toISOString(),
    updatedAtISO: new Date(startedAt).toISOString(),
    finishedAtISO: null as string | null,
  };
  const persist = () =>
    env.KV.put(progressKey, JSON.stringify({ ...stats, updatedAtISO: new Date().toISOString() }), {
      expirationTtl: 60 * 60 * 24 * 30,
    });
  await persist();

  // Fire all sends simultaneously so total wall-clock time equals the slowest
  // single Uazapi call (~2-5 s). Sequential batches or per-message delays push
  // total time past the ~30 s waitUntil() wall-clock limit on Pages Functions.
  const aiEnv = aiUazapiEnv(env);
  await Promise.all(
    targets.map(async (chatid) => {
      try {
        await sendText(aiEnv, chatid, sourceText);
        stats.dispatched += 1;
      } catch (err) {
        stats.failed += 1;
        console.error(`broadcast send to ${chatid}:`, err instanceof Error ? err.message : String(err));
      }
      stats.lastChatid = chatid;
    }),
  );

  stats.finishedAtISO = new Date().toISOString();
  await persist();
  await env.KV.put(`broadcast:log:${messageId}`, JSON.stringify(stats), { expirationTtl: 60 * 60 * 24 * 30 });
}
