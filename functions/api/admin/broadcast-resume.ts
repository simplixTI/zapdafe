// POST /api/admin/broadcast-resume?messageId=...&cursor=...
// Internal endpoint called by each broadcast chunk to trigger the next one.
// Auth: x-broadcast-secret header must equal env.AI_WEBHOOK_SECRET.
// Returns 200 immediately; the actual work runs via context.waitUntil().

import type { Env } from '../../_shared/auth';
import { runChunk } from '../../_shared/broadcast';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const secret = request.headers.get('x-broadcast-secret');
  if (!secret || secret !== env.AI_WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }

  const url = new URL(request.url);
  const messageId = url.searchParams.get('messageId') ?? '';
  const cursor = parseInt(url.searchParams.get('cursor') ?? '0', 10);

  if (!messageId) {
    return new Response('missing messageId', { status: 400 });
  }

  context.waitUntil(runChunk(env, messageId, cursor, context));
  return new Response('ok');
};
