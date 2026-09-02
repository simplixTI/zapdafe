import type { Env } from '../../_shared/auth';
import { clearCookieHeader, destroySession } from '../../_shared/auth';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  await destroySession(context.request, context.env);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearCookieHeader(),
    },
  });
};
