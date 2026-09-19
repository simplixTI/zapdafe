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
  chainError?: string;
  chainErrorAtISO?: string;
}

interface LaneStats extends BroadcastStats {
  messageId: string;
  lane: number;
  start: number;
  end: number;
  cursor: number;
}

/** A run is only finished when every one of its lanes is. */
function mergeLanes(lanes: LaneStats[]): BroadcastStats & { lanes: LaneStats[] } {
  const sorted = [...lanes].sort((a, b) => a.lane - b.lane);
  const allDone = sorted.every((l) => l.finishedAtISO);
  const finishedTimes = sorted.map((l) => l.finishedAtISO ?? '').filter(Boolean);
  const chainErrors = sorted
    .filter((l) => l.chainError)
    .map((l) => `faixa ${l.lane}: ${l.chainError}`);
  return {
    total: sorted.reduce((n, l) => n + l.total, 0),
    dispatched: sorted.reduce((n, l) => n + l.dispatched, 0),
    failed: sorted.reduce((n, l) => n + l.failed, 0),
    lastChatid: sorted[sorted.length - 1]?.lastChatid ?? null,
    startedAtISO: sorted.map((l) => l.startedAtISO).sort()[0] ?? '',
    updatedAtISO: sorted.map((l) => l.updatedAtISO).sort().reverse()[0] ?? '',
    finishedAtISO: allDone ? finishedTimes.sort().reverse()[0] ?? null : null,
    ...(chainErrors.length > 0 ? { chainError: chainErrors.join(' | ') } : {}),
    lanes: sorted,
  };
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

  // 1. Lane records (current format) — each run has one per lane, merged here
  {
    const listed = await env.KV.list({ prefix: 'broadcast:lane:', limit: 200 });
    const byRun = new Map<string, LaneStats[]>();
    for (const k of listed.keys) {
      const raw = await env.KV.get(k.name);
      if (!raw) continue;
      try {
        const lane = JSON.parse(raw) as LaneStats;
        if (!lane.messageId) continue;
        byRun.set(lane.messageId, [...(byRun.get(lane.messageId) ?? []), lane]);
      } catch { /* ignore */ }
    }
    for (const [messageId, lanes] of byRun) {
      upsert(messageId, { progress: mergeLanes(lanes) });
    }
  }

  // 2. Single-chain progress (runs before the lane split) — kept so older
  //    broadcasts still show up in the panel
  {
    const listed = await env.KV.list({ prefix: 'broadcast:progress:', limit: 100 });
    for (const k of listed.keys) {
      const messageId = k.name.replace('broadcast:progress:', '');
      const raw = await env.KV.get(k.name);
      let progress: BroadcastStats | null = null;
      try { progress = raw ? JSON.parse(raw) as BroadcastStats : null; } catch { /* ignore */ }
      if (progress && !byId.get(messageId)?.progress) upsert(messageId, { progress });
    }
  }

  // 3. Legacy log — older format written at end of run only
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

  // 4. Dedupe keys — proof the handler was at least entered
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
