// Per-contact conversation memory in KV. Stores the last N turns so the LLM
// keeps context across messages without re-reading Uazapi history. Also
// stores a small profile (currently: extracted first name) that the system
// prompt uses to personalise replies.

import type { Env } from './auth';
import type { ChatMessage } from './llm';

const MAX_TURNS = 12;
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days — refreshes on each write

const historyKey = (chatid: string) => `conv:${chatid}`;
const profileKey = (chatid: string) => `contact:${chatid}`;

export interface ContactProfile {
  name?: string;
  firstSeenISO?: string;
  lastSeenISO?: string;
  /** Quando mandamos a última mensagem de encerramento (bênção ou "estou aqui"). */
  closingAtISO?: string;
  /** Quando dissemos "estou aqui se precisar" pela última vez — teto de 1x/24h. */
  lastOfferAtISO?: string;
}

export async function loadHistory(env: Env, chatid: string): Promise<ChatMessage[]> {
  const raw = await env.KV.get(historyKey(chatid));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function appendMessage(env: Env, chatid: string, msg: ChatMessage): Promise<void> {
  const history = await loadHistory(env, chatid);
  history.push(msg);
  const trimmed = history.slice(-MAX_TURNS);
  await env.KV.put(historyKey(chatid), JSON.stringify(trimmed), { expirationTtl: TTL_SECONDS });
}

export async function loadProfile(env: Env, chatid: string): Promise<ContactProfile> {
  const raw = await env.KV.get(profileKey(chatid));
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ContactProfile;
  } catch {
    return {};
  }
}

export async function updateProfile(env: Env, chatid: string, patch: Partial<ContactProfile>): Promise<ContactProfile> {
  const now = new Date().toISOString();
  const current = await loadProfile(env, chatid);
  const next: ContactProfile = { ...current, ...patch, lastSeenISO: now };
  if (!next.firstSeenISO) next.firstSeenISO = now;
  await env.KV.put(profileKey(chatid), JSON.stringify(next), { expirationTtl: TTL_SECONDS * 12 }); // ~1 year
  return next;
}
