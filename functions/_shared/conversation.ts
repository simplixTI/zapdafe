// Per-contact conversation memory in KV. Stores the last N turns so the LLM
// keeps context across messages without re-reading Uazapi history.

import type { Env } from './auth';
import type { ChatMessage } from './llm';

const MAX_TURNS = 12; // 6 user + 6 assistant pairs, plenty for conversational context
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function key(chatid: string): string {
  return `conv:${chatid}`;
}

export async function loadHistory(env: Env, chatid: string): Promise<ChatMessage[]> {
  const raw = await env.KV.get(key(chatid));
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
  // Trim to last MAX_TURNS, always keeping a user message as the first if possible
  const trimmed = history.slice(-MAX_TURNS);
  await env.KV.put(key(chatid), JSON.stringify(trimmed), { expirationTtl: TTL_SECONDS });
}
