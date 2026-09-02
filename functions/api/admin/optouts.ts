import type { Env } from '../../_shared/auth';

const KEY = 'optouts:list';

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

async function loadList(env: Env): Promise<string[]> {
  const raw = await env.KV.get(KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as string[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function saveList(env: Env, list: string[]): Promise<void> {
  await env.KV.put(KEY, JSON.stringify(list));
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const list = await loadList(context.env);
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
  const phone = normalizePhone(body.phone);
  const action = body.action ?? 'add';

  const current = await loadList(context.env);
  const set = new Set(current);
  if (action === 'add') set.add(phone);
  else if (action === 'remove') set.delete(phone);
  else {
    return new Response(JSON.stringify({ error: 'invalid_action' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const next = Array.from(set).sort();
  await saveList(context.env, next);

  return new Response(JSON.stringify({ ok: true, optouts: next, count: next.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
