// ElevenLabs TTS + Uazapi voice send.
// Long assistant replies (>450 chars) become voice messages so they feel
// natural in WhatsApp rather than a wall of text.

import type { UazapiEnv } from './uazapi-send';

export interface VoiceEnv {
  ELEVENLABS_API_KEY: string;
  ELEVENLABS_VOICE_ID: string;
}

const MODEL_ID = 'eleven_multilingual_v2';

/**
 * Synthesize speech via ElevenLabs. Returns a base64 string of the MP3 audio
 * (Uazapi accepts audio as data URL or base64 in /send/media).
 */
export async function synthesize(env: VoiceEnv, text: string): Promise<string> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${env.ELEVENLABS_VOICE_ID}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // trim: espaço vindo da colagem no painel quebra o header e vira 400
        'xi-api-key': env.ELEVENLABS_API_KEY.trim(),
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.75,
          style: 0.35,
          use_speaker_boost: true,
        },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`elevenlabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const buf = await res.arrayBuffer();
  // Base64 encode without pulling in Node Buffer (edge runtime)
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * Send audio as a WhatsApp voice note via Uazapi.
 * Uazapi accepts base64 payloads on /send/media with type "audio".
 */
export async function sendVoice(
  env: UazapiEnv,
  chatid: string,
  audioBase64: string,
): Promise<unknown> {
  const res = await fetch(`${env.UAZAPI_BASE}/send/media`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      token: env.UAZAPI_TOKEN,
    },
    body: JSON.stringify({
      number: chatid,
      type: 'audio',
      file: `data:audio/mpeg;base64,${audioBase64}`,
      ptt: true, // push-to-talk / voice note style
    }),
  });
  if (!res.ok) {
    throw new Error(`uazapi /send/media ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

// Abreviações que terminam em ponto sem terminar a frase. Sem isso,
// "Pr. Everaldo" vira duas frases — exatamente o corte no meio que não pode
// acontecer.
const ABBREVIATIONS = new Set([
  'sr', 'sra', 'srta', 'dr', 'dra', 'prof', 'profa', 'pr', 'pra', 'pe', 'ex',
  'exmo', 'exma', 'av', 'r', 'n', 'no', 'num', 'pag', 'pág', 'cap', 'vs',
  'etc', 'ed', 'seg', 'ap', 'apt', 'obs', 'ref', 'tel', 'fl', 'vol', 'art',
]);

const SENTENCE_PUNCT = /[.!?…]/;
/** Depois do ponto, o que abre frase nova: maiúscula, aspas, travessão, parêntese. */
const STARTS_SENTENCE = /^\s+["“«'(\-–—]?\p{Lu}/u;

function endsWithAbbreviation(textSoFar: string): boolean {
  const lastWord = textSoFar.split(/[\s(["“]/).pop() ?? '';
  const bare = lastWord.replace(/[^\p{L}]/gu, '').toLowerCase();
  if (!bare) return false;
  // Inicial solta ("J. Silva") nunca encerra frase
  if (bare.length === 1) return true;
  return ABBREVIATIONS.has(bare);
}

/**
 * Quebra o texto em frases inteiras. Na dúvida, NÃO quebra — um trecho um
 * pouco maior é inofensivo, uma frase partida ao meio não é.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    if (!SENTENCE_PUNCT.test(text[i]!)) continue;

    // Pontuação repetida ("...", "?!") conta como uma só
    let end = i;
    while (end + 1 < text.length && SENTENCE_PUNCT.test(text[end + 1]!)) end++;
    // Aspas e parênteses de fechamento pertencem à frase que termina
    while (end + 1 < text.length && /["”»')\]]/.test(text[end + 1]!)) end++;

    const before = text.slice(start, i);
    const rest = text.slice(end + 1);
    const isDot = text[i] === '.';

    // Ponto entre dígitos é número ("1.500"), não fim de frase
    const betweenDigits = isDot && /\d$/.test(before) && /^\d/.test(rest);
    const afterAbbrev = isDot && endsWithAbbreviation(before);
    const opensNext = rest.trim() === '' || STARTS_SENTENCE.test(rest);

    if (!betweenDigits && !afterAbbrev && opensNext) {
      const sentence = text.slice(start, end + 1).trim();
      if (sentence) out.push(sentence);
      start = end + 1;
    }
    i = end;
  }

  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/**
 * Split a long text into chunks that respect sentence boundaries — never
 * mid-word and never mid-sentence. Each chunk is up to `maxChars`; a single
 * sentence longer than that is kept whole on purpose.
 */
export function splitForVoice(text: string, maxChars = 1200): string[] {
  const clean = text.replace(/[ \t]+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean.replace(/\s+/g, ' ')];

  const chunks: string[] = [];
  let cur = '';

  const push = () => {
    const t = cur.replace(/\s+/g, ' ').trim();
    if (t) chunks.push(t);
    cur = '';
  };

  for (const para of clean.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)) {
    for (const sentence of splitSentences(para)) {
      if (!cur) {
        cur = sentence;
      } else if (cur.length + 1 + sentence.length <= maxChars) {
        cur += ' ' + sentence;
      } else {
        push();
        cur = sentence;
      }
    }
  }
  push();

  return chunks;
}
