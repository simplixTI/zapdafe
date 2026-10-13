// Transcrição de áudio recebido no WhatsApp.
//
// Por que existe: até 2026-10-13 o webhook **ignorava áudio em silêncio**. O
// `extractText` só olha campos de texto, o áudio chega com `text: ""`, e o
// guarda de "mensagem só-emoji" (`!text`) devolvia 200 sem responder nada. Na
// prática, quem mandava áudio — gente mais velha, quem não gosta de digitar —
// falava com uma parede.
//
// O áudio do WhatsApp é mídia criptografada ponta a ponta: o payload traz uma
// URL `.enc` em `mmg.whatsapp.net` mais a `mediaKey`, e não serve para download
// direto. Quem descriptografa é a Uazapi, pelo `POST /message/download`, que
// devolve um MP3 já convertido numa URL dela.

import type { UazapiEnv } from './uazapi-send';
import { recordUsage } from './usage';
import type { Env } from './auth';

/** Acima disso não transcrevemos — ver TRANSCRIBE_MAX_SECONDS no webhook. */
export const MAX_AUDIO_SECONDS = 300;
/** Teto de segurança para o arquivo baixado (o limite do Whisper é 25MB). */
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

/**
 * Pede à Uazapi o áudio descriptografado. Devolve a URL do MP3, ou null.
 *
 * `id` é o `messageid` da mensagem (sem o prefixo do dono). Conferido contra a
 * instância real em 2026-10-13: devolve `{ cached, fileURL, mimetype }`.
 */
export async function audioFileUrl(env: UazapiEnv, id: string): Promise<string | null> {
  const res = await fetch(`${env.UAZAPI_BASE}/message/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: env.UAZAPI_TOKEN },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    throw new Error(`uazapi /message/download ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { fileURL?: string; mimetype?: string };
  return json.fileURL || null;
}

/**
 * Transcreve o áudio em português. Devolve o texto, ou null quando não dá para
 * aproveitar nada (áudio vazio, falha de download, resposta sem texto).
 */
export async function transcribeAudio(
  env: Env,
  uazapi: UazapiEnv,
  messageId: string,
  seconds?: number,
): Promise<string | null> {
  if (seconds !== undefined && seconds > MAX_AUDIO_SECONDS) {
    console.log(`áudio de ${seconds}s acima do teto de ${MAX_AUDIO_SECONDS}s — não transcrito`);
    return null;
  }

  const url = await audioFileUrl(uazapi, messageId);
  if (!url) return null;

  const audio = await fetch(url);
  if (!audio.ok) {
    throw new Error(`download do mp3 ${audio.status}`);
  }
  const bytes = await audio.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_AUDIO_BYTES) {
    console.log(`áudio de ${bytes.byteLength} bytes fora do aceitável — não transcrito`);
    return null;
  }

  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'audio/mpeg' }), 'audio.mp3');
  form.append('model', 'whisper-1');
  // Fixar o idioma melhora bastante a transcrição de áudio curto e com ruído,
  // que é a regra no WhatsApp. Sem isso o modelo às vezes "ouve" espanhol.
  form.append('language', 'pt');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`openai transcriptions ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { text?: string };
  const texto = (json.text ?? '').trim();

  // O custo é por tempo de áudio, não por token, então entra num contador
  // próprio — senão a transcrição ficaria invisível no painel de custos.
  if (seconds) await recordUsage(env, { audioSec: seconds });

  return texto.length > 0 ? texto : null;
}
