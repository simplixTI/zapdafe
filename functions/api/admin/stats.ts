import type { Env } from '../../_shared/auth';
import type { UazapiChat } from '../../_shared/uazapi';
import {
  CUTOFF_MS,
  fetchAllChats,
  fetchContacts,
  fetchMessagesSinceCutoff,
} from '../../_shared/uazapi';

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
  recent: ChatSummary[];
}

const MS_DAY = 24 * 60 * 60 * 1000;
const TZ_OFFSET_MS = -3 * 60 * 60 * 1000; // America/Sao_Paulo

function brasiliaStartOfDay(nowMs: number): number {
  const shifted = nowMs + TZ_OFFSET_MS;
  const day = Math.floor(shifted / MS_DAY);
  return day * MS_DAY - TZ_OFFSET_MS;
}

function brasiliaDateKey(msTimestamp: number): string {
  const shifted = new Date(msTimestamp + TZ_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function chatIdIsUser(id: string): boolean {
  return id.endsWith('@s.whatsapp.net');
}

function pickChatName(chat: UazapiChat | undefined, jid: string): string {
  if (chat?.lead_name) return chat.lead_name;
  if (chat?.wa_name) return chat.wa_name;
  const digits = jid.split('@')[0];
  return digits || 'Sem nome';
}

async function loadOptOutsSet(env: Env): Promise<Set<string>> {
  const raw = await env.KV.get('optouts:list');
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const env = context.env;

  try {
    const [contacts, chats, messages, optOuts] = await Promise.all([
      fetchContacts(env),
      fetchAllChats(env),
      fetchMessagesSinceCutoff(env),
      loadOptOutsSet(env),
    ]);

    const now = Date.now();
    const today = brasiliaStartOfDay(now);
    const cutoff24h = now - MS_DAY;
    const cutoff7d = now - 7 * MS_DAY;
    const cutoff30d = now - 30 * MS_DAY;

    const chatByJid = new Map<string, UazapiChat>();
    for (const c of chats) {
      const jid = (c.wa_chatid as string | undefined) ?? c.id;
      chatByJid.set(jid, c);
    }

    // Aggregate per chat, filtering out groups + self.
    const perChat = new Map<string, ChatSummary>();
    for (const m of messages) {
      if (!chatIdIsUser(m.chatid)) continue;
      if (m.isGroup) continue;

      let summary = perChat.get(m.chatid);
      if (!summary) {
        summary = {
          chatid: m.chatid,
          name: pickChatName(chatByJid.get(m.chatid), m.chatid),
          firstMsgAt: m.messageTimestamp,
          lastMsgAt: m.messageTimestamp,
          msgsIn: 0,
          msgsOut: 0,
          msgsTotal: 0,
          optedOut: optOuts.has(m.chatid.split('@')[0]),
        };
        perChat.set(m.chatid, summary);
      }
      if (m.messageTimestamp < summary.firstMsgAt) summary.firstMsgAt = m.messageTimestamp;
      if (m.messageTimestamp > summary.lastMsgAt) summary.lastMsgAt = m.messageTimestamp;
      if (m.fromMe) summary.msgsOut++;
      else summary.msgsIn++;
      summary.msgsTotal++;
    }

    const dailyMap = new Map<
      string,
      { incoming: number; outgoing: number; startedConvos: number }
    >();
    for (const m of messages) {
      if (!chatIdIsUser(m.chatid)) continue;
      if (m.isGroup) continue;
      const key = brasiliaDateKey(m.messageTimestamp);
      const row = dailyMap.get(key) ?? { incoming: 0, outgoing: 0, startedConvos: 0 };
      if (m.fromMe) row.outgoing++;
      else row.incoming++;
      dailyMap.set(key, row);
    }
    for (const summary of perChat.values()) {
      const key = brasiliaDateKey(summary.firstMsgAt);
      const row = dailyMap.get(key) ?? { incoming: 0, outgoing: 0, startedConvos: 0 };
      row.startedConvos++;
      dailyMap.set(key, row);
    }

    const daily = Array.from(dailyMap.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const chatSummaries = Array.from(perChat.values());

    const activeLast24h = chatSummaries.filter((c) => c.lastMsgAt >= cutoff24h).length;
    const activeLast7d = chatSummaries.filter((c) => c.lastMsgAt >= cutoff7d).length;
    const activeLast30d = chatSummaries.filter((c) => c.lastMsgAt >= cutoff30d).length;
    const startedToday = chatSummaries.filter((c) => c.firstMsgAt >= today).length;

    const todayMsgs = messages.filter(
      (m) => m.messageTimestamp >= today && chatIdIsUser(m.chatid) && !m.isGroup,
    );
    const last7dMsgs = messages.filter(
      (m) => m.messageTimestamp >= cutoff7d && chatIdIsUser(m.chatid) && !m.isGroup,
    );
    const last30dMsgs = messages.filter(
      (m) => m.messageTimestamp >= cutoff30d && chatIdIsUser(m.chatid) && !m.isGroup,
    );

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
        totalSinceCutoff: messages.filter((m) => chatIdIsUser(m.chatid) && !m.isGroup).length,
        today: todayMsgs.length,
        last7d: last7dMsgs.length,
        last30d: last30dMsgs.length,
        incomingToday: todayMsgs.filter((m) => !m.fromMe).length,
        outgoingToday: todayMsgs.filter((m) => m.fromMe).length,
      },
      daily,
      recent,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: 'stats_failed', detail: message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

