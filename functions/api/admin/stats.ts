import type { Env } from '../../_shared/auth';
import {
  CUTOFF_MS,
  fetchAllChats,
  fetchMessagesSinceCutoff,
} from '../../_shared/uazapi';
import {
  archiveIsStale,
  readArchive,
  runArchive,
  type ArchivedContact,
} from '../../_shared/archive';

interface ChatSummary {
  chatid: string;
  name: string;
  firstMsgAt: number;
  lastMsgAt: number;
  msgsIn: number;
  msgsOut: number;
  msgsTotal: number;
  optedOut: boolean;
}

interface StatsResponse {
  cutoffISO: string;
  generatedAtISO: string;
  people: {
    total: number;
    activeLast24h: number;
    activeLast7d: number;
    activeLast30d: number;
    startedToday: number;
    optedOutCount: number;
  };
  messages: {
    totalSinceCutoff: number;
    today: number;
    last7d: number;
    last30d: number;
    incomingToday: number;
    outgoingToday: number;
  };
  daily: Array<{ date: string; incoming: number; outgoing: number; startedConvos: number }>;
  peaks: {
    grid: number[][];
    maxCell: number;
    totalIncoming: number;
    totalOutgoing: number;
    topHour: { day: number; hour: number; count: number };
  };
  recent: ChatSummary[];
  debug: {
    archiveLastRunISO: string;
    archiveDaysCovered: number;
    archiveTotalContacts: number;
    archiveTotalMessages: number;
    lastUazapiFetchPages: number;
    lastUazapiHasMore: boolean;
    lastUazapiOldestISO: string | null;
    archiveJustRan: boolean;
  };
}

const MS_DAY = 24 * 60 * 60 * 1000;
const TZ_OFFSET_MS = -3 * 60 * 60 * 1000;

function brasiliaStartOfDay(nowMs: number): number {
  const shifted = nowMs + TZ_OFFSET_MS;
  const day = Math.floor(shifted / MS_DAY);
  return day * MS_DAY - TZ_OFFSET_MS;
}

async function loadOptOutsSet(env: Env): Promise<Set<string>> {
  const raw = await env.KV.get('optouts:list');
  if (!raw) return new Set();
  try {
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const env = context.env;

  try {
    // 1. Load archive first (cheap KV reads)
    let archive = await readArchive(env);
    let archiveJustRan = false;
    let uazapiFetchPages = 0;
    let uazapiHasMore = false;
    let uazapiOldestMs: number | null = null;

    // 2. If archive is stale, refresh from Uazapi
    if (archiveIsStale(archive.meta)) {
      const [chats, messagesResult] = await Promise.all([
        fetchAllChats(env),
        fetchMessagesSinceCutoff(env),
      ]);
      uazapiFetchPages = messagesResult.pagesFetched;
      uazapiHasMore = messagesResult.hasMore;
      uazapiOldestMs = messagesResult.oldestFetchedMs;
      archive = await runArchive(env, messagesResult.messages, chats);
      archiveJustRan = true;
    }

    // 3. Overlay opt-outs
    const optOuts = await loadOptOutsSet(env);

    // 4. Build the response from archive
    const now = Date.now();
    const today = brasiliaStartOfDay(now);
    const cutoff24h = now - MS_DAY;
    const cutoff7d = now - 7 * MS_DAY;
    const cutoff30d = now - 30 * MS_DAY;

    const contacts = archive.contacts;
    const contactEntries: Array<[string, ArchivedContact]> = Object.entries(contacts);

    const chatSummaries: ChatSummary[] = contactEntries.map(([chatid, c]) => ({
      chatid,
      name: c.name,
      firstMsgAt: c.firstMsgAt,
      lastMsgAt: c.lastMsgAt,
      msgsIn: c.msgsIn,
      msgsOut: c.msgsOut,
      msgsTotal: c.msgsIn + c.msgsOut,
      optedOut: optOuts.has(chatid.split('@')[0]),
    }));

    const activeLast24h = chatSummaries.filter((c) => c.lastMsgAt >= cutoff24h).length;
    const activeLast7d = chatSummaries.filter((c) => c.lastMsgAt >= cutoff7d).length;
    const activeLast30d = chatSummaries.filter((c) => c.lastMsgAt >= cutoff30d).length;
    const startedToday = chatSummaries.filter((c) => c.firstMsgAt >= today).length;

    // Daily rollups
    const daily = Object.entries(archive.days)
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Total msgs today from daily
    const todayKey = new Date(today + TZ_OFFSET_MS).toISOString().slice(0, 10);
    const todayRow = archive.days[todayKey] ?? { incoming: 0, outgoing: 0, startedConvos: 0 };
    const incomingToday = todayRow.incoming;
    const outgoingToday = todayRow.outgoing;

    const sumRange = (fromMs: number): number => {
      let sum = 0;
      for (const [date, v] of Object.entries(archive.days)) {
        const day0 = Date.parse(date + 'T00:00:00-03:00');
        if (day0 >= fromMs) sum += v.incoming + v.outgoing;
      }
      return sum;
    };
    const last7dTotal = sumRange(cutoff7d);
    const last30dTotal = sumRange(cutoff30d);
    const totalSinceCutoff = Object.values(archive.days).reduce(
      (acc, v) => acc + v.incoming + v.outgoing,
      0,
    );

    // Peaks from archive hourly
    let peaksTotalIncoming = 0;
    let peaksTotalOutgoing = 0;
    for (const v of Object.values(archive.days)) {
      peaksTotalIncoming += v.incoming;
      peaksTotalOutgoing += v.outgoing;
    }
    let peaksMax = 0;
    let topHour = { day: 0, hour: 0, count: 0 };
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const c = archive.hourly[d][h] ?? 0;
        if (c > peaksMax) peaksMax = c;
        if (c > topHour.count) topHour = { day: d, hour: h, count: c };
      }
    }
    peaksMax = Math.max(1, peaksMax);

    const recent = [...chatSummaries]
      .sort((a, b) => b.lastMsgAt - a.lastMsgAt)
      .slice(0, 50);

    const response: StatsResponse = {
      cutoffISO: new Date(CUTOFF_MS).toISOString(),
      generatedAtISO: new Date(now).toISOString(),
      people: {
        total: chatSummaries.length,
        activeLast24h,
        activeLast7d,
        activeLast30d,
        startedToday,
        optedOutCount: chatSummaries.filter((c) => c.optedOut).length,
      },
      messages: {
        totalSinceCutoff,
        today: incomingToday + outgoingToday,
        last7d: last7dTotal,
        last30d: last30dTotal,
        incomingToday,
        outgoingToday,
      },
      daily,
      peaks: {
        grid: archive.hourly,
        maxCell: peaksMax,
        totalIncoming: peaksTotalIncoming,
        totalOutgoing: peaksTotalOutgoing,
        topHour,
      },
      recent,
      debug: {
        archiveLastRunISO: archive.meta.lastArchiveISO,
        archiveDaysCovered: Object.keys(archive.days).length,
        archiveTotalContacts: archive.meta.totalContactsEver,
        archiveTotalMessages: archive.meta.totalMessagesEver,
        lastUazapiFetchPages: uazapiFetchPages,
        lastUazapiHasMore: uazapiHasMore,
        lastUazapiOldestISO: uazapiOldestMs ? new Date(uazapiOldestMs).toISOString() : null,
        archiveJustRan,
      },
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: 'stats_failed', detail: message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
