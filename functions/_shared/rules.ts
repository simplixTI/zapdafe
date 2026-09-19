// The "brain": response rules the client manages from /admin, without a deploy.
//
// Two kinds:
//   - replies: trigger -> fixed answer, matched before the LLM runs (no tokens
//     spent, always answers exactly what was written in the panel).
//   - instructions: free text appended to the system prompt, for behaviour the
//     LLM should follow when it does answer.

import type { Env } from './auth';
import { normalizeText } from './text';

const KEY = 'rules:brain';

export interface ReplyRule {
  id: string;
  triggers: string[];
  response: string;
  createdAtISO: string;
}

export interface Brain {
  replies: ReplyRule[];
  instructions: string;
}

const DEFAULT_BRAIN: Brain = {
  replies: [
    {
      id: 'amem',
      triggers: ['amém', 'amém amém', 'amém amém amém', 'amém obrigado', 'amém obrigada'],
      response: 'Amém, {nome}, que Deus continue abençoando você e sua família!',
      createdAtISO: '2026-09-19T00:00:00.000Z',
    },
  ],
  instructions: '',
};

export async function loadBrain(env: Env): Promise<Brain> {
  const raw = await env.KV.get(KEY);
  if (!raw) return DEFAULT_BRAIN;
  try {
    const parsed = JSON.parse(raw) as Partial<Brain>;
    return {
      replies: Array.isArray(parsed.replies) ? parsed.replies : [],
      instructions: typeof parsed.instructions === 'string' ? parsed.instructions : '',
    };
  } catch {
    return DEFAULT_BRAIN;
  }
}

export async function saveBrain(env: Env, brain: Brain): Promise<void> {
  await env.KV.put(KEY, JSON.stringify(brain));
}

/** Whole-message match: "Amém!" fires, "Amém, mas hoje tô triste" does not. */
export function matchReply(brain: Brain, text: string): ReplyRule | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  return (
    brain.replies.find((rule) =>
      rule.triggers.some((trigger) => normalizeText(trigger) === normalized),
    ) ?? null
  );
}

/** Fills {nome}; without a known name the placeholder and its comma go away. */
export function renderResponse(response: string, name: string | null): string {
  if (name) return response.replace(/\{nome\}/g, name);
  return response
    .replace(/\s*\{nome\}\s*/g, '')
    .replace(/,\s*,/g, ',')
    .replace(/^\s*,\s*/, '')
    .replace(/\s+([.,!?…])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
