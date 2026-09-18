// POST /api/admin/broadcast-trigger
// Body: { text: string }
// Triggers a devotional broadcast to all active contacts without needing the
// WhatsApp trigger phone. Auth via session cookie OR Authorization: Bearer <ADMIN_PASSWORD>.

import type { Env } from '../../_shared/auth';
import { runBroadcast } from '../../_shared/broadcast';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  let body: { text?: string };
  try {
    body = (await request.json()) as { text?: string };
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) {
    return new Response(JSON.stringify({ error: 'text is required' }), { status: 400 });
  }

  const messageId = `admin-trigger:${Date.now()}`;
  runBroadcast(env, text, messageId, context);

  return new Response(JSON.stringify({ ok: true, messageId }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
