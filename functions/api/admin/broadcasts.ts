// Lists the recent devotional broadcasts with their progress data.
// Protected by the admin session (see functions/_middleware.ts).
// GET /api/admin/broadcasts → { items: [...] }

import type { Env } from '../../_shared/auth';

interface BroadcastStats {
  total: number;
  dispatched: number;
  failed: number;
  lastChatid: string | null;
  startedAtISO: string;
  updatedAtISO: string;
  finishedAtISO: string | null;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { env } = context;
  const byId = new Map<string, {
    messageId: string;
    progress: BroadcastStats | null;
    legacyLog: unknown | null;
    dedupSeen: boolean;
  }>();

  const upsert = (messageId: string, patch: Partial<{ progress: BroadcastStats; legacyLog: unknown; dedupSeen: boolean }>) => {
    const cur = byId.get(messageId) ?? { messageId, progress: null, legacyLog: null, dedupSeen: false };
    byId.set(messageId, { ...cur, ...patch });
  };

  // 1. Progress (post-e03b095 fix) — the richest data
  {
    const listed = await env.KV.list({ prefix: 'broadcast:progress:', limit: 100 });
    for (const k of listed.keys) {
      const messageId = k.name.replace('broadcast:progress:', '');
      const raw = await env.KV.get(k.name);
      let progress: BroadcastStats | null = null;
      try { progress = raw ? JSON.parse(raw) as BroadcastStats : null; } catch { /* ignore */ }
      if (progress) upsert(messageId, { progress });
    }
  }

  // 2. Legacy log — older format written at end of run only
  {
    const listed = await env.KV.list({ prefix: 'broadcast:log:', limit: 100 });
    for (const k of listed.keys) {
      const messageId = k.name.replace('broadcast:log:', '');
      const raw = await env.KV.get(k.name);
      let legacyLog: unknown = null;
      try { legacyLog = raw ? JSON.parse(raw) : null; } catch { legacyLog = raw; }
      upsert(messageId, { legacyLog });
    }
  }

  // 3. Dedupe keys — proof the handler was at least entered
  {
    const listed = await env.KV.list({ prefix: 'broadcast:sent:', limit: 100 });
    for (const k of listed.keys) {
      const messageId = k.name.replace('broadcast:sent:', '');
      upsert(messageId, { dedupSeen: true });
    }
  }

  const items = [...byId.values()].sort((a, b) => {
    const ta = a.progress?.startedAtISO ?? '';
    const tb = b.progress?.startedAtISO ?? '';
    return tb.localeCompare(ta);
  });

  return new Response(JSON.stringify({ count: items.length, items }, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
