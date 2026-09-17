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
        'xi-api-key': env.ELEVENLABS_API_KEY,
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

/**
 * Split a long text into chunks that respect sentence boundaries — never
 * mid-word. Each chunk is up to `maxChars`. Priority: paragraph → sentence
 * → clause. If a single sentence exceeds the limit, it stays whole.
 */
export function splitForVoice(text: string, maxChars = 450): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return [clean];

  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = '';

  const push = () => { if (cur.trim()) chunks.push(cur.trim()); cur = ''; };

  const appendSentence = (s: string) => {
    if (!cur) { cur = s; return; }
    if ((cur.length + 1 + s.length) <= maxChars) {
      cur += ' ' + s;
    } else {
      push();
      cur = s;
    }
  };

  for (const para of paragraphs) {
    if (para.length <= maxChars && !cur) { chunks.push(para); continue; }
    // sentence split — keep the punctuation with the sentence
    const sentences = para.match(/[^.!?…]+[.!?…]?(\s|$)/g)?.map(s => s.trim()).filter(Boolean) ?? [para];
    for (const s of sentences) appendSentence(s);
    push();
  }
  push();

  return chunks;
}
