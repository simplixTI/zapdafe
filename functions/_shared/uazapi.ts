import type { Env } from './auth';

// Cutoff: 2026-08-15 00:00:00 America/Sao_Paulo (UTC-3)
// Anything before this is ignored (pre-launch / testing data).
export const CUTOFF_MS = Date.parse('2026-08-15T00:00:00-03:00');

/**
 * Credenciais de uma instância. Existem duas: a antiga (campanha360), cujos
 * dados viraram backlog congelado, e a luxprodutora, que é onde a IA vive e de
 * onde vem tudo que entra de novo.
 */
export interface UazapiCreds {
  base: string;
  token: string;
  /** Rótulo usado para guardar o high-water separado por instância. */
  source: 'campanha360' | 'lux';
}

export function legacyCreds(env: Env): UazapiCreds {
  return { base: env.UAZAPI_BASE, token: env.UAZAPI_TOKEN, source: 'campanha360' };
}

export function aiCreds(env: Env): UazapiCreds {
  return { base: env.AI_UAZAPI_BASE, token: env.AI_UAZAPI_TOKEN, source: 'lux' };
}

export function headers(creds: UazapiCreds): Record<string, string> {
  return { token: creds.token, 'Content-Type': 'application/json' };
}

export interface UazapiContact {
  contact_FirstName: string;
  contact_name: string;
  jid: string;
}

export interface UazapiChat {
  id: string;
  wa_chatid?: string;
  wa_name?: string;
  wa_isGroup?: boolean;
  image?: string;
  lead_name?: string;
  lead_email?: string;
  lead_field01?: string;
  chatbot_disableUntil?: number;
  wa_lastMsgTimestamp?: number;
  [key: string]: unknown;
}

export interface UazapiMessage {
  id: string;
  chatid: string;
  messageTimestamp: number;
  fromMe: boolean;
  messageType?: string;
  isGroup?: boolean;
  content?: { text?: string; [k: string]: unknown };
  [k: string]: unknown;
}

interface MessageFindResponse {
  hasMore: boolean;
  limit: number;
  messages: UazapiMessage[];
}

interface ChatFindResponse {
  chats: UazapiChat[];
}

export async function fetchContacts(creds: UazapiCreds): Promise<UazapiContact[]> {
  const res = await fetch(`${creds.base}/contacts`, {
    method: 'GET',
    headers: headers(creds),
  });
  if (!res.ok) throw new Error(`Uazapi /contacts ${res.status}`);
  return res.json() as Promise<UazapiContact[]>;
}

export async function fetchAllChats(creds: UazapiCreds): Promise<UazapiChat[]> {
  const res = await fetch(`${creds.base}/chat/find`, {
    method: 'POST',
    headers: headers(creds),
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Uazapi /chat/find ${res.status}`);
  const body = (await res.json()) as ChatFindResponse;
  return body.chats ?? [];
}

export interface FetchMessagesResult {
  messages: UazapiMessage[];
  pagesFetched: number;
  hitPageCap: boolean;
  hasMore: boolean;
  oldestFetchedMs: number | null;
}

/**
 * Fetches all messages since CUTOFF_MS using offset-based pagination.
 * Uazapi returns hasMore=true when there are more results at higher offsets.
 */
export async function fetchMessagesSinceCutoff(creds: UazapiCreds): Promise<FetchMessagesResult> {
  const all: UazapiMessage[] = [];
  const seen = new Set<string>();
  const LIMIT = 500;
  const maxPages = 200;
  let pagesFetched = 0;
  let lastHasMore = false;
  let oldestFetched: number | null = null;
  let reachedCutoff = false;

  for (let page = 0; page < maxPages; page++) {
    const body: Record<string, unknown> = {
      limit: LIMIT,
      offset: page * LIMIT,
    };

    const res = await fetch(`${creds.base}/message/find`, {
      method: 'POST',
      headers: headers(creds),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Uazapi /message/find ${res.status}`);
    const payload = (await res.json()) as MessageFindResponse;
    pagesFetched++;
    lastHasMore = !!payload.hasMore;
    const batch = payload.messages ?? [];
    if (batch.length === 0) break;

    let anyNew = false;
    let batchOldest = Infinity;
    for (const m of batch) {
      if (m.messageTimestamp < batchOldest) batchOldest = m.messageTimestamp;
      if (m.messageTimestamp < CUTOFF_MS) { reachedCutoff = true; continue; }
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      all.push(m);
      anyNew = true;
      if (oldestFetched === null || m.messageTimestamp < oldestFetched) {
        oldestFetched = m.messageTimestamp;
      }
    }

    if (reachedCutoff) break;
    if (!payload.hasMore) break;
    if (!anyNew) break; // safeguard: if server ignores offset, avoid infinite loop
  }

  return {
    messages: all,
    pagesFetched,
    hitPageCap: pagesFetched >= maxPages,
    hasMore: lastHasMore,
    oldestFetchedMs: oldestFetched,
  };
}
