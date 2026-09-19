// CRUD for the response rules the client manages from /admin ("cérebro").
// Protected by the admin session (see functions/_middleware.ts).
//   GET  /api/admin/rules → { replies, instructions }
//   POST /api/admin/rules → { action: 'add' | 'remove' | 'instructions', ... }

import type { Env } from '../../_shared/auth';
import { loadBrain, saveBrain, type ReplyRule } from '../../_shared/rules';

const MAX_TRIGGERS = 20;
const MAX_LEN = 2000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const brain = await loadBrain(context.env);
  return json(brain);
};

interface RulesBody {
  action?: 'add' | 'remove' | 'instructions';
  triggers?: string;
  response?: string;
  id?: string;
  instructions?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: RulesBody;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  const brain = await loadBrain(context.env);

  if (body.action === 'add') {
    const triggers = (body.triggers ?? '')
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, MAX_TRIGGERS);
    const response = (body.response ?? '').trim();
    if (triggers.length === 0 || !response) {
      return json({ error: 'missing_trigger_or_response' }, 400);
    }
    if (response.length > MAX_LEN) {
      return json({ error: 'response_too_long' }, 400);
    }
    const rule: ReplyRule = {
      id: crypto.randomUUID(),
      triggers,
      response,
      createdAtISO: new Date().toISOString(),
    };
    brain.replies.push(rule);
  } else if (body.action === 'remove') {
    if (!body.id) return json({ error: 'missing_id' }, 400);
    brain.replies = brain.replies.filter((r) => r.id !== body.id);
  } else if (body.action === 'instructions') {
    const instructions = (body.instructions ?? '').trim();
    if (instructions.length > MAX_LEN) {
      return json({ error: 'instructions_too_long' }, 400);
    }
    brain.instructions = instructions;
  } else {
    return json({ error: 'invalid_action' }, 400);
  }

  await saveBrain(context.env, brain);
  return json({ ok: true, ...brain });
};
