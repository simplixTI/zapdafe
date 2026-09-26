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
import {
  loadHistory, appendMessage, loadProfile, updateProfile, type ContactProfile,
} from '../../_shared/conversation';
import { getPlaylistTracks, formatPlaylistForPrompt, type Track } from '../../_shared/spotify';
import { runBroadcast, markActive } from '../../_shared/broadcast';
import { isOptedOut, addOptOut } from '../../_shared/optouts';
import { isOptOutCommand, isOptOutIntent, isAcknowledgement, matchGreeting } from '../../_shared/intents';
import { containsOffer, looksLikeClosing, stripOfferSentences, withinHours } from '../../_shared/tone';
import { loadBrain, matchReply, renderResponse, type ReplyRule } from '../../_shared/rules';
import {
  plausibleFirstName, namedAsSomeoneElse, looksLikeNameQuestion, looksLikeSelfIntroduction,
} from '../../_shared/names';

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

// Acima disso a resposta vira áudio.
//
// Subiu de 455 para 900 em 2026-09-22: o cliente passou a exigir versículo em
// todo conselho, e versículo citado com referência empurra quase toda resposta
// para além de 455. Com o valor antigo, o acolhimento em crise chegaria como
// áudio — e o número do CVV, que a pessoa precisa LER e discar, junto.
const MAX_TEXT_LEN_FOR_VOICE = 900;
// Teto de cada áudio. Bem maior que o gatilho de propósito: se fosse igual,
// uma resposta logo acima do gatilho viraria dois áudios em vez de um. Só
// quebra em fim de frase, então o normal é sair um áudio só.
const VOICE_CHUNK_MAX = 2000;

// Por quanto tempo um "ok"/"amém" conta como eco da mensagem de encerramento.
// Curto de propósito: o "amém" da manhã seguinte responde ao devocional do dia,
// não fecha a conversa de ontem — esse continua sendo respondido pelo cérebro.
const ACK_SILENCE_WINDOW_HOURS = 6;

const OPT_OUT_CONFIRMATION =
  'Tudo bem. Não vou te enviar mais mensagens. Se um dia quiser conversar de novo, é só me chamar por aqui.';
const OPT_OUT_NUDGE =
  'Entendi. Se quiser parar de receber minhas mensagens, digite /sair (ou /parar) que eu confirmo na hora.';

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
  const chunks = splitForVoice(text, VOICE_CHUNK_MAX);
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
 * Se esse chatid já escreveu pra gente antes, mesmo que o histórico local
 * tenha expirado (`conv:<chatid>` vive 30 dias). Serve só para não nos
 * reapresentarmos a quem já conhece o Zapdafé.
 *
 * NÃO devolve nome, de propósito. O que o arquivo guarda é o nome de EXIBIÇÃO
 * do WhatsApp — um apelido que a pessoa escolheu para si, não o nome que ela
 * nos deu. Usar aquilo como vocativo já produziu três incidentes: "Sou" para a
 * Cleonice, "Everaldo" para o Toninho e, em 2026-09-25, "Joanilson" para quem
 * se chama Pedro, "Membro" para o Victor e "Elbianosantos" para o Elbiano.
 *
 * Decisão do cliente em 2026-09-25: sem um nome que a pessoa tenha dito, a IA
 * pergunta em vez de chutar. Ser chamado pelo nome de um estranho é pior que
 * ser perguntado.
 */
async function isKnownFromArchive(env: Env, chatid: string): Promise<boolean> {
  const raw = await env.KV.get('arch:contacts');
  if (!raw) return false;
  try {
    const contacts = JSON.parse(raw) as Record<string, unknown>;
    return Object.prototype.hasOwnProperty.call(contacts, chatid);
  } catch {
    return false;
  }
}

// Validated on read, not just on write: profiles saved before this guard
// existed still hold junk like "Sou", and re-checking here retires them
// without a migration — the assistant just asks for the name again.
async function resolveContactName(env: Env, chatid: string): Promise<string | null> {
  const profile = await loadProfile(env, chatid);
  // Só o que a pessoa nos disse. Sem queda para o nome de exibição do
  // WhatsApp — ver isKnownFromArchive acima.
  return plausibleFirstName(profile.name);
}

async function handleOptOut(env: Env, chatid: string, phone: string): Promise<void> {
  await addOptOut(env, phone);
  await respondAsText(env, chatid, OPT_OUT_CONFIRMATION);
}

// Canned replies skip the history write on purpose: the whole point of a rule
// is to answer without spending tokens on an "amém". A regra grava uma única
// chave (o marcador de encerramento) porque sem ela o pedido de silêncio do
// cliente nunca se cumpriria — o aceno seguinte cairia direto na IA.
async function handleRuleReply(env: Env, chatid: string, rule: ReplyRule): Promise<void> {
  const name = await resolveContactName(env, chatid);
  const response = renderResponse(rule.response, name);
  await respondAsText(env, chatid, response);
  // As regras do painel são todas bênção de despedida ("Amém, que Deus
  // continue abençoando"). Marcar aqui é o que faz o "ok" seguinte cair no
  // silêncio — sem isso, a regra responde e o aceno volta pra IA.
  if (looksLikeClosing(response)) {
    await updateProfile(env, chatid, { closingAtISO: new Date().toISOString() });
  }
}

// Cumprimento seco não passa pela IA. O prompt proíbe puxar conversa, mas em
// 24/09 o "Oi" ainda virou "Oi! Como você está?": sem assunto na mensagem, o
// modelo cai no instinto de perguntar. A resposta que o cliente pediu é fixa,
// então não precisa de LLM nem fica à mercê dele.
async function handleGreeting(env: Env, chatid: string, greeting: string): Promise<void> {
  const name = await resolveContactName(env, chatid);
  const response = name
    ? `${greeting}, ${name}. Que Deus te abençoe.`
    : `${greeting}. Que Deus te abençoe.`;
  await respondAsText(env, chatid, response);
  await updateProfile(env, chatid, { closingAtISO: new Date().toISOString() });
}

async function handleConversation(
  env: Env,
  chatid: string,
  userText: string,
  extraInstructions: string,
): Promise<void> {
  // Typing indicator (best-effort)
  await sendTyping(aiUazapiEnv(env), chatid, 1500);

  // Retrieve history, profile, Bible context, and playlist in parallel
  const [history, profile, verses, tracks] = await Promise.all([
    loadHistory(env, chatid),
    loadProfile(env, chatid),
    searchBibleVerses(env, userText, { limit: 3, threshold: 0.32 }),
    getPlaylistTracks(env),
  ]);

  let contactName = plausibleFirstName(profile.name);

  // Sem histórico local a pessoa PARECE nova, mas pode só ter sumido por mais
  // de 30 dias (o `conv:` expira) ou vir do fluxo antigo do n8n. Se ela está no
  // arquivo, já escreveu antes: não nos reapresentamos.
  //
  // O arquivo não entrega nome nenhum (ver isKnownFromArchive). Então aqui a
  // pessoa cai no modo "retornante sem nome" do prompt, que pergunta o nome
  // uma vez, com jeito — em vez de chamá-la pelo apelido do WhatsApp.
  let treatAsFirstMessage = history.length === 0;
  if (treatAsFirstMessage && (await isKnownFromArchive(env, chatid))) {
    treatAsFirstMessage = false;
  }

  // If we still don't have a name and this isn't the very first message,
  // try to extract one from what the user just said (they might be
  // answering our earlier "qual seu nome?"). Best-effort — never blocks.
  //
  // `corrigindo` é a segunda porta, e ela existe porque a primeira se fechava
  // para sempre: com um nome já salvo a extração não rodava, então quem ficou
  // registrado com o nome de exibição do WhatsApp ("Joanilson" para o Pedro,
  // "Membro" para o Victor) não tinha como se corrigir por mais que dissesse.
  const corrigindo = looksLikeSelfIntroduction(userText);
  if (corrigindo || (!contactName && !treatAsFirstMessage)) {
    try {
      // "Everaldo" é o pastor, exceto quando a pessoa está respondendo à
      // pergunta direta sobre o nome dela — aí é nome de contato mesmo.
      const lastFromAI = [...history].reverse().find((m) => m.role === 'assistant');
      const answeringNameQuestion = corrigindo
        || (lastFromAI ? looksLikeNameQuestion(lastFromAI.content) : false);

      // O extrator devolve "Sou" para "eu sou sozinha" e "Everaldo" para
      // "Oi Pastor Everaldo" — a mesma trava vale, mais a checagem de vocativo
      const extracted = plausibleFirstName(await extractName(env, userText), {
        allowOwnNames: answeringNameQuestion,
      });
      if (extracted && namedAsSomeoneElse(userText, extracted)) {
        console.log(`nome "${extracted}" ignorado: aparece como vocativo em "${userText.slice(0, 80)}"`);
      } else if (extracted) {
        contactName = extracted;
        await updateProfile(env, chatid, { name: extracted });
      }
    } catch {/* ignore */}
  }
  const isFirstMessage = treatAsFirstMessage;

  // "Estou aqui se precisar" é uma frase por dia, não por resposta. O prompt
  // pede pra não repetir; o corte determinista mais abaixo garante.
  const alreadyOfferedRecently = withinHours(profile.lastOfferAtISO, 24);

  const systemContent = buildSystemPrompt({
    bibleContext: formatBibleContext(verses),
    isFirstMessage,
    contactName,
    playlistContext: formatPlaylistForPrompt(tracks),
    extraInstructions,
    alreadyOfferedRecently,
  });
  const messages: ChatMessage[] = [
    { role: 'system', content: systemContent },
    ...history,
    { role: 'user', content: userText },
  ];

  const reply = await chat(env, messages, { maxTokens: 500, temperature: 0.75 });
  if (!reply) return;

  // Separate any Spotify link so we can send text first, then link as its
  // own message (WhatsApp then renders a preview card for the link).
  const { textOnly, validUrl } = extractSpotifyLink(reply, tracks);

  // Se o modelo se ofereceu de novo dentro das 24h, a frase sai fora. O prompt
  // já pede isso, mas pedir não é garantir — e repetição era a reclamação.
  let finalText = textOnly;
  if (alreadyOfferedRecently && containsOffer(finalText)) {
    finalText = stripOfferSentences(finalText) ?? finalText;
  }

  const nowISO = new Date().toISOString();
  const patch: Partial<ContactProfile> = {};
  if (containsOffer(finalText)) patch.lastOfferAtISO = nowISO;
  if (looksLikeClosing(finalText)) patch.closingAtISO = nowISO;
  // O nome vai JUNTO deste patch, mesmo já tendo sido gravado lá em cima.
  //
  // `updateProfile` relê o KV antes de gravar, e essa releitura pode vir velha
  // — o KV é eventualmente consistente e a borda cacheia leitura por até 60s.
  // Quando vem, a gravação de fim de turno escreve por cima SEM o nome, e a
  // pessoa que acabou de se apresentar volta a não ter nome. É o que deixou
  // Pedro, Elbiano, Nilda, Ederson e outros seis sem nome no perfil, fazendo a
  // IA cair no nome de exibição do WhatsApp e chamar cada um de outra coisa.
  if (contactName) patch.name = contactName;

  // Persist history and touch profile timestamps
  await appendMessage(env, chatid, { role: 'user', content: userText });
  await appendMessage(env, chatid, { role: 'assistant', content: reply });
  await updateProfile(env, chatid, patch);

  if (finalText.length > MAX_TEXT_LEN_FOR_VOICE) {
    await respondAsVoice(env, chatid, finalText);
  } else if (finalText) {
    await respondAsText(env, chatid, finalText);
  }

  if (validUrl) {
    // Short pause so the text lands first
    await new Promise(r => setTimeout(r, 700));
    await respondAsText(env, chatid, validUrl);
  }
}

// ---------- devotional broadcast branch — logic lives in _shared/broadcast.ts ----------

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
    runBroadcast(env, text, messageId, context);
    return new Response(JSON.stringify({ ok: true, kind: 'broadcast' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Someone who already opted out never hears from us again
  if (await isOptedOut(env, phone)) {
    return new Response(JSON.stringify({ ok: true, kind: 'opted_out' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Índice de contatos ativos. É ele que faz alguém que chegou hoje receber o
  // devocional de amanhã: antes os alvos saíam só do `arch:contacts`, que só é
  // atualizado quando ALGUÉM ABRE O /admin — e 20 pessoas que chegaram entre
  // 22/09 e 23/09 ficaram de fora do disparo de 23/09 por causa disso.
  //
  // Vem antes de todas as ramificações de propósito: vale para quem cai numa
  // regra do cérebro ou no silêncio do aceno, não só para quem conversa.
  context.waitUntil(
    markActive(env, chatid).catch(err => {
      console.error('markActive error:', err instanceof Error ? err.message : String(err));
    }),
  );

  // An explicit command is the only thing that actually opts someone out
  if (isOptOutCommand(text)) {
    context.waitUntil(
      handleOptOut(env, chatid, phone).catch(err => {
        console.error('opt-out error:', err instanceof Error ? err.message : String(err));
      }),
    );
    return new Response(JSON.stringify({ ok: true, kind: 'opted_out_now' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fuzzier phrasing only points at the command — never decides for the person
  if (isOptOutIntent(text)) {
    context.waitUntil(
      respondAsText(env, chatid, OPT_OUT_NUDGE).catch(err => {
        console.error('opt-out nudge error:', err instanceof Error ? err.message : String(err));
      }),
    );
    return new Response(JSON.stringify({ ok: true, kind: 'opt_out_nudge' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Aceno depois da mensagem de encerramento ("ok", "blz", "pode deixar",
  // "amém") não pede resposta — responder aí é justamente o que o cliente
  // chamou de provocar diálogo. Vem antes do cérebro porque "amém" tem regra
  // fixa lá, que fora desse contexto continua valendo.
  if (isAcknowledgement(text)) {
    const profile = await loadProfile(env, chatid);
    if (withinHours(profile.closingAtISO, ACK_SILENCE_WINDOW_HOURS)) {
      return new Response(JSON.stringify({ ok: true, kind: 'ack_after_closing' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const brain = await loadBrain(env);

  // Admin-managed canned reply — answered without an LLM call
  const rule = matchReply(brain, text);
  if (rule) {
    context.waitUntil(
      handleRuleReply(env, chatid, rule).catch(err => {
        console.error('rule reply error:', err instanceof Error ? err.message : String(err));
      }),
    );
    return new Response(JSON.stringify({ ok: true, kind: 'rule_reply', ruleId: rule.id }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Cumprimento seco ("Oi", "Boa tarde Zap!") tem resposta fixa. Vem DEPOIS do
  // cérebro, para uma regra do painel sempre ganhar, e só vale para quem já
  // conversou antes — primeira mensagem segue sendo apresentação + nome.
  const greeting = matchGreeting(text);
  if (greeting) {
    const history = await loadHistory(env, chatid);
    if (history.length > 0) {
      context.waitUntil(
        handleGreeting(env, chatid, greeting).catch(err => {
          console.error('greeting error:', err instanceof Error ? err.message : String(err));
        }),
      );
      return new Response(JSON.stringify({ ok: true, kind: 'greeting' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Conversation branch — run async so webhook returns fast
  context.waitUntil(
    handleConversation(env, chatid, text, brain.instructions).catch(err => {
      console.error('conversation error:', err instanceof Error ? err.message : String(err));
    }),
  );

  return new Response(JSON.stringify({ ok: true, kind: 'reply' }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};
