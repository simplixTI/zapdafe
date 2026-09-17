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
import { buildSystemPrompt, chat, type ChatMessage } from '../../_shared/llm';
import { sendText, sendTyping, type UazapiEnv } from '../../_shared/uazapi-send';
import { synthesize, sendVoice, splitForVoice } from '../../_shared/voice';
import { loadHistory, appendMessage } from '../../_shared/conversation';

interface UazapiWebhookMessage {
  chatid?: string;
  key?: { remoteJid?: string; fromMe?: boolean; id?: string };
  messageTimestamp?: number;
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string };
  };
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

async function handleConversation(env: Env, chatid: string, userText: string): Promise<void> {
  // Typing indicator (best-effort)
  await sendTyping(aiUazapiEnv(env), chatid, 1500);

  // Retrieve conversation history and Bible context in parallel
  const [history, verses] = await Promise.all([
    loadHistory(env, chatid),
    searchBibleVerses(env, userText, { limit: 3, threshold: 0.32 }),
  ]);

  const systemContent = buildSystemPrompt(formatBibleContext(verses));
  const messages: ChatMessage[] = [
    { role: 'system', content: systemContent },
    ...history,
    { role: 'user', content: userText },
  ];

  const reply = await chat(env, messages, { maxTokens: 500, temperature: 0.75 });
  if (!reply) return;

  // Persist history AFTER we have the reply so we don't save orphan turns
  await appendMessage(env, chatid, { role: 'user', content: userText });
  await appendMessage(env, chatid, { role: 'assistant', content: reply });

  if (reply.length > MAX_TEXT_LEN_FOR_VOICE) {
    await respondAsVoice(env, chatid, reply);
  } else {
    await respondAsText(env, chatid, reply);
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

  // Shared-secret auth — Uazapi should be configured to send this header
  const providedSecret = request.headers.get('x-webhook-secret');
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

  // Ignore rules
  if (!chatid || !text || fromMe || m.wasSentByApi || isGroup) {
    return new Response('ignored', { status: 200 });
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
