import type { Env } from '../../_shared/auth';
import { loadOptOuts, addOptOut, removeOptOut } from '../../_shared/optouts';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const list = await loadOptOuts(context.env);
  return new Response(JSON.stringify({ optouts: list, count: list.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};

interface OptOutBody {
  phone?: string;
  action?: 'add' | 'remove';
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: OptOutBody;
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!body.phone) {
    return new Response(JSON.stringify({ error: 'missing_phone' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const action = body.action ?? 'add';
  if (action !== 'add' && action !== 'remove') {
    return new Response(JSON.stringify({ error: 'invalid_action' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const next =
    action === 'add'
      ? await addOptOut(context.env, body.phone)
      : await removeOptOut(context.env, body.phone);

  return new Response(JSON.stringify({ ok: true, optouts: next, count: next.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
