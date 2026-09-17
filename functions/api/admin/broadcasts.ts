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
  const items: Array<{ messageId: string; progress: BroadcastStats | null; raw?: string }> = [];

  const listed = await env.KV.list({ prefix: 'broadcast:progress:', limit: 50 });
  for (const k of listed.keys) {
    const messageId = k.name.replace('broadcast:progress:', '');
    const raw = await env.KV.get(k.name);
    let progress: BroadcastStats | null = null;
    try { progress = raw ? JSON.parse(raw) as BroadcastStats : null; } catch { /* keep raw */ }
    items.push({ messageId, progress, ...(progress ? {} : { raw: raw ?? '' }) });
  }

  // Sort by startedAt desc so newest is first
  items.sort((a, b) => {
    const ta = a.progress?.startedAtISO ?? '';
    const tb = b.progress?.startedAtISO ?? '';
    return tb.localeCompare(ta);
  });

  return new Response(JSON.stringify({ count: items.length, items }, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
