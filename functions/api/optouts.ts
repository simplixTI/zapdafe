import type { Env } from '../_shared/auth';
import { loadOptOuts, normalizePhone, phoneVariants } from '../_shared/optouts';

function bearerFromHeader(auth: string | null): string | null {
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const provided = bearerFromHeader(context.request.headers.get('Authorization'));
  if (!provided || !context.env.BUBBLE_BEARER || provided !== context.env.BUBBLE_BEARER) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(context.request.url);
  const check = url.searchParams.get('phone');

  const list = await loadOptOuts(context.env);

  if (check) {
    const normalized = normalizePhone(check);
    return new Response(
      JSON.stringify({ phone: normalized, optedOut: phoneVariants(normalized).some((v) => list.includes(v)) }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
    );
  }

  return new Response(JSON.stringify({ optouts: list, count: list.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
