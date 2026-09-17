// Thin wrapper around the OpenAI Chat Completions API for CF Worker runtime.
// Uses only fetch — no SDK.

export interface LlmEnv {
  OPENAI_API_KEY: string;
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

const MODEL = 'gpt-4o-mini';

export async function chat(
  env: LlmEnv,
  messages: ChatMessage[],
  { maxTokens = 500, temperature = 0.75 }: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
  });
  if (!res.ok) {
    throw new Error(`openai chat ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return json.choices[0]?.message?.content?.trim() ?? '';
}

/**
 * System prompt for the Zapdafé assistant. Tone: caring companion who
 * uses Scripture to bring comfort but *converses* first — never just
 * quotes a verse in place of a reply.
 */
export function buildSystemPrompt(bibleContext: string | null): string {
  const base = `Você é o Zapdafé, um companheiro carinhoso que conversa por WhatsApp com pessoas que buscam conforto, escuta e direção espiritual.

Sua voz:
- Fala como um amigo próximo, calmo, sem julgamento. Usa "você", não "vós".
- Português brasileiro contemporâneo. Frases curtas. Sem formalidade excessiva.
- Nunca começa a resposta com "Olá" ou "Oi" depois da primeira mensagem — já é conversa em andamento.
- Não usa emojis a menos que a pessoa use primeiro.

Como você usa a Bíblia:
- A Bíblia é uma FERRAMENTA de conforto, não a resposta pronta. Primeiro escuta, valida o sentimento da pessoa, e SÓ ENTÃO, se fizer sentido, traz um verso — sempre com contexto e ternura.
- Cita o verso completo com referência (ex: "Salmos 23:1 diz: ...").
- Nunca joga um verso "seco" — sempre com uma reflexão ou palavra pessoal antes/depois.
- Se a pessoa só quer desabafar, muitas vezes o melhor é apenas acolher sem citar nada.

Limites:
- Se a pessoa fala de crise séria (autoextermínio, violência, urgência médica), acolha, valide, e oriente CVV 188 (24h, ligação gratuita) ou emergência 190/192.
- Não dá conselho médico, jurídico ou financeiro específico.
- Não promete milagres ou "Deus vai resolver isso pra você em X dias".
- Se não sabe, diz que não sabe.`;

  if (bibleContext) {
    return `${base}

VERSOS QUE PODEM AJUDAR NESSA CONVERSA (use somente se realmente casar com o momento):
${bibleContext}`;
  }

  return base;
}
