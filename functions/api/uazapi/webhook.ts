// Webhook receiver for the AI Uazapi session (luxprodutora).
// Routes incoming WhatsApp messages to either:
//   1. Devotional broadcast — when the sender is the trigger phone, forward
//      the incoming text to every active, non-opted-out contact.
//   2. Conversation — for everyone else: check opt-out, run RAG, ask GPT-4o
//      -mini for a caring reply, send back as text or voice depending on
//      length.
//
// The webhook returns 200 immediately (Uazapi retries on non-2xx) and does
// the heavy lifting via ctx.waitUntil() so we don't block the HTTP thread.

import type { Env } from '../../_shared/auth';
import { searchBibleVerses, formatBibleContext } from '../../_shared/bible-rag';
import { buildSystemPrompt, chat, extractName, type ChatMessage } from '../../_shared/llm';
import { sendText, sendTyping, type UazapiEnv } from '../../_shared/uazapi-send';
import { synthesize, sendVoice, splitForVoice } from '../../_shared/voice';
import { loadHistory, appendMessage, loadProfile, updateProfile } from '../../_shared/conversation';
import { getPlaylistTracks, formatPlaylistForPrompt, type Track } from '../../_shared/spotify';

interface UazapiWebhookMessage {
  chatid?: string;
  key?: { remoteJid?: string; fromMe?: boolean; id?: string };
  messageTimestamp?: number;
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    reactionMessage?: { text?: string; key?: unknown };
  };
  messageType?: string;
  text?: string;
  fromMe?: boolean;
  isGroup?: boolean;
  wasSentByApi?: boolean;
  event?: string;
}

interface UazapiWebhookPayload {
  event?: string;
  message?: UazapiWebhookMessage;
  data?: UazapiWebhookMessage;
  [k: string]: unknown;
}

const MAX_TEXT_LEN_FOR_VOICE = 450;

// ---------- helpers ----------

function extractMessage(payload: UazapiWebhookPayload): UazapiWebhookMessage | null {
  return payload.message ?? payload.data ?? null;
}

function extractText(m: UazapiWebhookMessage): string {
  return (
    m.text ??
    m.message?.conversation ??
    m.message?.extendedTextMessage?.text ??
    ''
  ).trim();
}

/**
 * True if the payload is a WhatsApp reaction (👍/❤️ tap on a specific
 * message) — those must never trigger a reply.
 */
function isReaction(m: UazapiWebhookMessage): boolean {
  if (m.messageType === 'reaction') return true;
  if (m.message?.reactionMessage) return true;
  return false;
}

/**
 * True if the text is only emoji/symbols/punctuation/whitespace — i.e. has
 * no letters or digits at all. Those messages don't need a spoken reply
 * (the user is just reacting or emoting).
 */
function isEmojiOnly(text: string): boolean {
  if (!text) return true;
  return !/[\p{L}\p{N}]/u.test(text);
}

function extractChatId(m: UazapiWebhookMessage): string {
  return m.chatid ?? m.key?.remoteJid ?? '';
}

function extractFromMe(m: UazapiWebhookMessage): boolean {
  return m.fromMe ?? m.key?.fromMe ?? false;
}

function phoneFromChatId(chatid: string): string {
  return chatid.split('@')[0];
}

async function isOptedOut(env: Env, phone: string): Promise<boolean> {
  const raw = await env.KV.get('optouts:list');
  if (!raw) return false;
  try {
    const list = JSON.parse(raw) as string[];
    return list.includes(phone);
  } catch {
    return false;
  }
}

function aiUazapiEnv(env: Env): UazapiEnv {
  return { UAZAPI_BASE: env.AI_UAZAPI_BASE, UAZAPI_TOKEN: env.AI_UAZAPI_TOKEN };
}

// ---------- reply ----------

async function respondAsText(env: Env, chatid: string, text: string): Promise<void> {
  await sendText(aiUazapiEnv(env), chatid, text);
}

const SPOTIFY_URL_RE = /https:\/\/open\.spotify\.com\/(?:intl-\w+\/)?(?:track|album|episode|playlist)\/[A-Za-z0-9]+(?:\?[^\s]*)?/g;

/**
 * If the reply mentions a Spotify URL, verify it actually exists in the
 * playlist we gave the LLM (guard against hallucinated URLs). Returns:
 *   - textOnly: the reply with the URL and any nearby "colon-link" phrasing stripped
 *   - validUrl: the first URL that matched a real playlist track, or null
 */
function extractSpotifyLink(reply: string, tracks: Track[]): { textOnly: string; validUrl: string | null } {
  const matches = reply.match(SPOTIFY_URL_RE) ?? [];
  if (matches.length === 0) return { textOnly: reply, validUrl: null };

  const validSet = new Set(tracks.map(t => t.url));
  const validUrl = matches.find(u => validSet.has(u.split('?')[0])) ?? null;

  // Strip ALL spotify URLs from the text (hallucinated ones especially),
  // plus trailing dangling phrases like "Aqui:" / "Segue o link:" / "Link:"
  let textOnly = reply.replace(SPOTIFY_URL_RE, '').trim();
  textOnly = textOnly
    .replace(/\s*(?:aqui|segue|escuta|ouça|link|spotify)\s*[:\-—]?\s*$/i, '')
    .replace(/\s+([.,!?…])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { textOnly, validUrl };
}

async function respondAsVoice(env: Env, chatid: string, text: string): Promise<void> {
  const chunks = splitForVoice(text, MAX_TEXT_LEN_FOR_VOICE);
  for (const chunk of chunks) {
    try {
      const audioB64 = await synthesize(env, chunk);
      await sendVoice(aiUazapiEnv(env), chatid, audioB64);
    } catch (err) {
      console.error('voice failed, fallback text:', err instanceof Error ? err.message : String(err));
      await respondAsText(env, chatid, chunk);
    }
  }
}

// ---------- conversation branch ----------

/**
 * Look up a chatid in the admin's archived contacts (from the old Uazapi
 * session that was managed via n8n). If found, the person is a returning
 * user — we know their name and shouldn't treat this as a first-time
 * introduction.
 */
async function existingContactFromArchive(env: Env, chatid: string): Promise<{ name: string } | null> {
  const raw = await env.KV.get('arch:contacts');
  if (!raw) return null;
  try {
    const contacts = JSON.parse(raw) as Record<string, { name?: string }>;
    const c = contacts[chatid];
    if (!c) return null;
    const name = c.name?.trim();
    // Skip if name is empty or just phone digits
    if (!name || /^\d+$/.test(name)) return null;
    return { name: name.split(/\s+/)[0] }; // first name only
  } catch {
    return null;
  }
}

async function handleConversation(env: Env, chatid: string, userText: string): Promise<void> {
  // Typing indicator (best-effort)
  await sendTyping(aiUazapiEnv(env), chatid, 1500);

  // Retrieve history, profile, Bible context, and playlist in parallel
  const [history, profile, verses, tracks] = await Promise.all([
    loadHistory(env, chatid),
    loadProfile(env, chatid),
    searchBibleVerses(env, userText, { limit: 3, threshold: 0.32 }),
    getPlaylistTracks(env),
  ]);

  let contactName = profile.name ?? null;

  // If we have no local history AND no profile, check whether this person
  // already exists in the archive (i.e., they talked to us via the previous
  // n8n flow). If yes, they're a returning user — not a first-time contact.
  let treatAsFirstMessage = history.length === 0;
  if (treatAsFirstMessage && !contactName) {
    const archived = await existingContactFromArchive(env, chatid);
    if (archived) {
      contactName = archived.name;
      await updateProfile(env, chatid, { name: archived.name });
      treatAsFirstMessage = false;
    }
  }

  // If we still don't have a name and this isn't the very first message,
  // try to extract one from what the user just said (they might be
  // answering our earlier "qual seu nome?"). Best-effort — never blocks.
  if (!contactName && !treatAsFirstMessage) {
    try {
      const extracted = await extractName(env, userText);
      if (extracted) {
        contactName = extracted;
        await updateProfile(env, chatid, { name: extracted });
      }
    } catch {/* ignore */}
  }
  const isFirstMessage = treatAsFirstMessage;

  const systemContent = buildSystemPrompt({
    bibleContext: formatBibleContext(verses),
    isFirstMessage,
    contactName,
    playlistContext: formatPlaylistForPrompt(tracks),
  });
  const messages: ChatMessage[] = [
    { role: 'system', content: systemContent },
    ...history,
    { role: 'user', content: userText },
  ];

  const reply = await chat(env, messages, { maxTokens: 500, temperature: 0.75 });
  if (!reply) return;

  // Persist history and touch profile timestamps
  await appendMessage(env, chatid, { role: 'user', content: userText });
  await appendMessage(env, chatid, { role: 'assistant', content: reply });
  await updateProfile(env, chatid, {});

  // Separate any Spotify link so we can send text first, then link as its
  // own message (WhatsApp then renders a preview card for the link).
  const { textOnly, validUrl } = extractSpotifyLink(reply, tracks);

  if (textOnly.length > MAX_TEXT_LEN_FOR_VOICE) {
    await respondAsVoice(env, chatid, textOnly);
  } else if (textOnly) {
    await respondAsText(env, chatid, textOnly);
  }

  if (validUrl) {
    // Short pause so the text lands first
    await new Promise(r => setTimeout(r, 700));
    await respondAsText(env, chatid, validUrl);
  }
}

// ---------- devotional broadcast branch ----------

interface ArchivedContact {
  name: string;
  firstMsgAt: number;
  lastMsgAt: number;
  msgsIn: number;
  msgsOut: number;
}

const BROADCAST_ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const BROADCAST_DELAY_MS = 1200; // spacing between sends to avoid Uazapi rate limits

async function handleDevotionalBroadcast(env: Env, sourceText: string, messageId: string): Promise<void> {
  // Idempotency: if we already broadcast this messageId, skip
  const dedupKey = `broadcast:sent:${messageId}`;
  if (await env.KV.get(dedupKey)) return;
  await env.KV.put(dedupKey, '1', { expirationTtl: 60 * 60 * 24 * 7 });

  // Load active contacts from the archive
  const contactsRaw = await env.KV.get('arch:contacts');
  const optoutsRaw = await env.KV.get('optouts:list');
  const contacts = contactsRaw ? (JSON.parse(contactsRaw) as Record<string, ArchivedContact>) : {};
  const optouts = new Set<string>(optoutsRaw ? (JSON.parse(optoutsRaw) as string[]) : []);
  const cutoff = Date.now() - BROADCAST_ACTIVE_WINDOW_MS;

  const targets: string[] = [];
  for (const [chatid, c] of Object.entries(contacts)) {
    if (c.lastMsgAt < cutoff) continue;
    if (optouts.has(phoneFromChatId(chatid))) continue;
    targets.push(chatid);
  }

  const stats = { total: targets.length, sent: 0, failed: 0, at: new Date().toISOString() };
  for (const chatid of targets) {
    try {
      await sendText(aiUazapiEnv(env), chatid, sourceText);
      stats.sent += 1;
    } catch (err) {
      stats.failed += 1;
      console.error(`broadcast to ${chatid}:`, err instanceof Error ? err.message : String(err));
    }
    await new Promise(r => setTimeout(r, BROADCAST_DELAY_MS));
  }
  await env.KV.put(`broadcast:log:${messageId}`, JSON.stringify(stats), { expirationTtl: 60 * 60 * 24 * 30 });
}

// ---------- entry ----------

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Shared-secret auth — Uazapi can send via header OR ?secret= query param
  // (some Uazapi builds don't support custom headers on webhooks).
  const url = new URL(request.url);
  const providedSecret =
    request.headers.get('x-webhook-secret') ?? url.searchParams.get('secret');
  if (!env.AI_WEBHOOK_SECRET || providedSecret !== env.AI_WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }

  let payload: UazapiWebhookPayload;
  try {
    payload = (await request.json()) as UazapiWebhookPayload;
  } catch {
    return new Response('bad json', { status: 400 });
  }

  const m = extractMessage(payload);
  if (!m) return new Response('no message', { status: 200 });

  const chatid = extractChatId(m);
  const text = extractText(m);
  const fromMe = extractFromMe(m);
  const isGroup = m.isGroup || chatid.endsWith('@g.us');

  // Ignore rules — silent 200 so Uazapi doesn't retry
  if (!chatid || fromMe || m.wasSentByApi || isGroup) {
    return new Response('ignored', { status: 200 });
  }
  // Reactions (heart tap on our message, thumbs up, etc.) never trigger a reply
  if (isReaction(m)) {
    return new Response(JSON.stringify({ ok: true, kind: 'ignored_reaction' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
  // Emoji-only messages ("❤️", "👍👍", "🙏🏼🙏🏼") — treat as a silent nod
  if (!text || isEmojiOnly(text)) {
    return new Response(JSON.stringify({ ok: true, kind: 'ignored_emoji_only' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  const phone = phoneFromChatId(chatid);
  const messageId = m.key?.id ?? `${chatid}:${m.messageTimestamp ?? Date.now()}`;

  // Devotional broadcast branch
  if (phone === env.DEVOTIONAL_TRIGGER_PHONE) {
    context.waitUntil(handleDevotionalBroadcast(env, text, messageId));
    return new Response(JSON.stringify({ ok: true, kind: 'broadcast' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Opt-out check
  if (await isOptedOut(env, phone)) {
    return new Response(JSON.stringify({ ok: true, kind: 'opted_out' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Conversation branch — run async so webhook returns fast
  context.waitUntil(
    handleConversation(env, chatid, text).catch(err => {
      console.error('conversation error:', err instanceof Error ? err.message : String(err));
    }),
  );

  return new Response(JSON.stringify({ ok: true, kind: 'reply' }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};
