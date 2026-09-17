// Per-day usage counters (OpenAI tokens) in KV so we can estimate cost
// without needing OpenAI's billing API (session-only, unreachable from
// sk-proj-* keys).
//
// Keys: usage:openai:YYYY-MM-DD → { chatIn, chatOut, embed }
// TTL: 90 days (rolling window; older days automatically drop)

import type { Env } from './auth';

const TZ_OFFSET_MS = -3 * 60 * 60 * 1000; // Brasília
const TTL_SECONDS = 60 * 60 * 24 * 90;

// $ per 1M tokens (gpt-4o-mini + text-embedding-3-small) as of 2026-09
const PRICING = {
  chatInputPerM: 0.15,
  chatOutputPerM: 0.60,
  embedPerM: 0.02,
};

export interface DayUsage {
  chatIn: number;
  chatOut: number;
  embed: number;
}

export interface CostSummary {
  today: DayUsage & { costUsd: number };
  last30d: DayUsage & { costUsd: number };
  currentMonth: DayUsage & { costUsd: number };
}

function brasiliaDateKey(ms: number): string {
  const shifted = new Date(ms + TZ_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const mo = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

const key = (date: string) => `usage:openai:${date}`;

async function readDay(env: Env, date: string): Promise<DayUsage> {
  const raw = await env.KV.get(key(date));
  if (!raw) return { chatIn: 0, chatOut: 0, embed: 0 };
  try {
    const parsed = JSON.parse(raw) as DayUsage;
    return {
      chatIn: Number(parsed.chatIn ?? 0),
      chatOut: Number(parsed.chatOut ?? 0),
      embed: Number(parsed.embed ?? 0),
    };
  } catch {
    return { chatIn: 0, chatOut: 0, embed: 0 };
  }
}

async function writeDay(env: Env, date: string, day: DayUsage): Promise<void> {
  await env.KV.put(key(date), JSON.stringify(day), { expirationTtl: TTL_SECONDS });
}

export function estimateCostUsd(day: DayUsage): number {
  return (
    (day.chatIn / 1_000_000) * PRICING.chatInputPerM +
    (day.chatOut / 1_000_000) * PRICING.chatOutputPerM +
    (day.embed / 1_000_000) * PRICING.embedPerM
  );
}

/**
 * Adds token counts to today's counter. Non-blocking — logs and swallows
 * errors so a KV hiccup never breaks the response path.
 */
export async function recordUsage(env: Env, delta: Partial<DayUsage>): Promise<void> {
  try {
    const date = brasiliaDateKey(Date.now());
    const current = await readDay(env, date);
    const next: DayUsage = {
      chatIn: current.chatIn + (delta.chatIn ?? 0),
      chatOut: current.chatOut + (delta.chatOut ?? 0),
      embed: current.embed + (delta.embed ?? 0),
    };
    await writeDay(env, date, next);
  } catch (err) {
    console.error('usage recordUsage:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Aggregates today, last-30-days, and month-to-date.
 */
export async function costSummary(env: Env): Promise<CostSummary> {
  const now = Date.now();
  const todayKey = brasiliaDateKey(now);
  const today = await readDay(env, todayKey);

  const last30d: DayUsage = { chatIn: 0, chatOut: 0, embed: 0 };
  const currentMonth: DayUsage = { chatIn: 0, chatOut: 0, embed: 0 };
  const monthPrefix = todayKey.slice(0, 7); // YYYY-MM

  for (let i = 0; i < 30; i++) {
    const date = brasiliaDateKey(now - i * 24 * 60 * 60 * 1000);
    const d = await readDay(env, date);
    last30d.chatIn += d.chatIn;
    last30d.chatOut += d.chatOut;
    last30d.embed += d.embed;
    if (date.startsWith(monthPrefix)) {
      currentMonth.chatIn += d.chatIn;
      currentMonth.chatOut += d.chatOut;
      currentMonth.embed += d.embed;
    }
  }

  return {
    today: { ...today, costUsd: estimateCostUsd(today) },
    last30d: { ...last30d, costUsd: estimateCostUsd(last30d) },
    currentMonth: { ...currentMonth, costUsd: estimateCostUsd(currentMonth) },
  };
}
