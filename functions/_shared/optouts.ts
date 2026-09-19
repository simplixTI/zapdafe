// Single source of truth for the opt-out list. Consumers: the AI webhook,
// the devotional broadcast, the admin CRUD and the Bubble bridge.

import type { Env } from './auth';

const KEY = 'optouts:list';

export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

export async function loadOptOuts(env: Env): Promise<string[]> {
  const raw = await env.KV.get(KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as string[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function loadOptOutSet(env: Env): Promise<Set<string>> {
  return new Set(await loadOptOuts(env));
}

export async function isOptedOut(env: Env, phone: string): Promise<boolean> {
  const list = await loadOptOuts(env);
  return list.includes(normalizePhone(phone));
}

async function save(env: Env, list: string[]): Promise<string[]> {
  const next = Array.from(new Set(list)).sort();
  await env.KV.put(KEY, JSON.stringify(next));
  return next;
}

export async function addOptOut(env: Env, phone: string): Promise<string[]> {
  const list = await loadOptOuts(env);
  list.push(normalizePhone(phone));
  return save(env, list);
}

export async function removeOptOut(env: Env, phone: string): Promise<string[]> {
  const target = normalizePhone(phone);
  const list = (await loadOptOuts(env)).filter((p) => p !== target);
  return save(env, list);
}
