// Admin observability endpoint — merges provider quotas and recent
// conversation activity in one call for the admin dashboard.
// GET /api/admin/observability

import type { Env } from '../../_shared/auth';
import { costSummary } from '../../_shared/usage';

interface ObservabilityResponse {
  generatedAtISO: string;
  openai: {
    todayCostUsd: number;
    todayInTokens: number;
    todayOutTokens: number;
    todayEmbedTokens: number;
    monthCostUsd: number;
    last30dCostUsd: number;
  };
  elevenlabs: {
    charactersUsed: number;
    charactersLimit: number;
    percentUsed: number;
    tier: string | null;
    error?: string;
  };
  conversations: {
    activeLast24h: number;
    totalTracked: number;
    recent: Array<{
      chatid: string;
      name: string | null;
      turns: number;
      lastAtISO: string | null;
      lastFromRole: 'user' | 'assistant' | null;
      lastPreview: string;
    }>;
  };
}

interface ConvRow {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ProfileRow {
  name?: string;
  firstSeenISO?: string;
  lastSeenISO?: string;
}

async function fetchElevenLabsUsage(env: Env): Promise<ObservabilityResponse['elevenlabs']> {
  if (!env.ELEVENLABS_API_KEY) {
    return { charactersUsed: 0, charactersLimit: 0, percentUsed: 0, tier: null, error: 'no api key' };
  }
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, Accept: 'application/json' },
    });
    if (!res.ok) {
      return { charactersUsed: 0, charactersLimit: 0, percentUsed: 0, tier: null, error: `HTTP ${res.status}` };
    }
    const json = (await res.json()) as {
      subscription?: {
        tier?: string;
        character_count?: number;
        character_limit?: number;
      };
    };
    const used = json.subscription?.character_count ?? 0;
    const limit = json.subscription?.character_limit ?? 0;
    return {
      charactersUsed: used,
      charactersLimit: limit,
      percentUsed: limit > 0 ? Math.round((used / limit) * 1000) / 10 : 0,
      tier: json.subscription?.tier ?? null,
    };
  } catch (err) {
    return {
      charactersUsed: 0,
      charactersLimit: 0,
      percentUsed: 0,
      tier: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function fetchConversations(env: Env): Promise<ObservabilityResponse['conversations']> {
  const now = Date.now();
  const cutoff24h = now - 24 * 60 * 60 * 1000;
  // List a broad slice of contact profiles (we track up to ~1yr TTL).
  const profileList = await env.KV.list({ prefix: 'contact:', limit: 1000 });

  const rows = await Promise.all(
    profileList.keys.map(async k => {
      const chatid = k.name.replace('contact:', '');
      const [profileRaw, convRaw] = await Promise.all([
        env.KV.get(k.name),
        env.KV.get(`conv:${chatid}`),
      ]);
      let profile: ProfileRow = {};
      let history: ConvRow[] = [];
      try { if (profileRaw) profile = JSON.parse(profileRaw) as ProfileRow; } catch {/* ignore */}
      try { if (convRaw) history = JSON.parse(convRaw) as ConvRow[]; } catch {/* ignore */}

      const last = history[history.length - 1];
      const lastAtISO = profile.lastSeenISO ?? null;
      const preview = (last?.content ?? '').replace(/\s+/g, ' ').slice(0, 120);
      return {
        chatid,
        name: profile.name ?? null,
        turns: history.length,
        lastAtISO,
        lastFromRole: last ? (last.role === 'user' || last.role === 'assistant' ? last.role : null) : null,
        lastPreview: preview,
      };
    }),
  );

  const totalTracked = rows.length;
  const activeLast24h = rows.filter(r => r.lastAtISO && Date.parse(r.lastAtISO) >= cutoff24h).length;

  const recent = rows
    .filter(r => r.lastAtISO !== null)
    .sort((a, b) => (b.lastAtISO ?? '').localeCompare(a.lastAtISO ?? ''))
    .slice(0, 30);

  return { activeLast24h, totalTracked, recent };
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { env } = context;

  const [openai, elevenlabs, conversations] = await Promise.all([
    costSummary(env),
    fetchElevenLabsUsage(env),
    fetchConversations(env),
  ]);

  const response: ObservabilityResponse = {
    generatedAtISO: new Date().toISOString(),
    openai: {
      todayCostUsd: openai.today.costUsd,
      todayInTokens: openai.today.chatIn,
      todayOutTokens: openai.today.chatOut,
      todayEmbedTokens: openai.today.embed,
      monthCostUsd: openai.currentMonth.costUsd,
      last30dCostUsd: openai.last30d.costUsd,
    },
    elevenlabs,
    conversations,
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
