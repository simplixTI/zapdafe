// Send helpers for Uazapi (the WhatsApp gateway).
// Reads UAZAPI_BASE + UAZAPI_TOKEN from the environment.

export interface UazapiEnv {
  UAZAPI_BASE: string;
  UAZAPI_TOKEN: string;
}

async function post(env: UazapiEnv, path: string, body: unknown): Promise<Response> {
  return fetch(`${env.UAZAPI_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      token: env.UAZAPI_TOKEN,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Send a plain text message. Returns Uazapi response payload on success,
 * throws on non-2xx so callers can decide how to fallback.
 */
export async function sendText(env: UazapiEnv, chatid: string, text: string): Promise<unknown> {
  const res = await post(env, '/send/text', { number: chatid, text });
  if (!res.ok) {
    throw new Error(`uazapi /send/text ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Simulate typing indicator briefly before sending. Not strictly required,
 * but gives the conversation a more human cadence.
 */
export async function sendTyping(env: UazapiEnv, chatid: string, ms = 1500): Promise<void> {
  try {
    await post(env, '/message/presence', { number: chatid, presence: 'composing', delay: ms });
  } catch {
    // typing indicator is best-effort; never fail a reply because of it
  }
}
