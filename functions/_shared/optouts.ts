// Single source of truth for the opt-out list. Consumers: the AI webhook,
// the devotional broadcast, the admin CRUD and the Bubble bridge.

import type { Env } from './auth';

const KEY = 'optouts:list';

export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * Um celular brasileiro vive em duas formas: com e sem o "nono dígito"
 * (5531988887777 e 553188887777 são a mesma pessoa). O WhatsApp guarda uma
 * das duas por contato — na base de hoje, 143 chatids têm 12 dígitos e 91 têm
 * 13 — e quem digita o número no /admin quase sempre usa a outra.
 *
 * Isso não é teórico: o cliente que reclamou em 2026-09-18 foi marcado como
 * opt-out na forma de 13 dígitos, enquanto o chatid dele tem 12. A lista nunca
 * bateu, e ele continuou entrando como alvo de todo devocional desde então.
 * Só não recebeu porque tinha sido bloqueado no WhatsApp à mão.
 *
 * Comparar as duas formas é o que faz a lista valer para a pessoa, não para a
 * grafia do número.
 */
export function phoneVariants(raw: string): string[] {
  const digits = normalizePhone(raw);
  const out = new Set<string>([digits]);
  if (digits.startsWith('55')) {
    const ddd = digits.slice(2, 4);
    const resto = digits.slice(4);
    // 9XXXXXXXX -> XXXXXXXX
    if (resto.length === 9 && resto.startsWith('9')) out.add(`55${ddd}${resto.slice(1)}`);
    // XXXXXXXX -> 9XXXXXXXX, só para celular. Fixo no Brasil começa com
    // 2–5, e inventar um nono dígito nele criaria um celular de outra pessoa.
    if (resto.length === 8 && /^[6-9]/.test(resto)) out.add(`55${ddd}9${resto}`);
  }
  return [...out];
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

/**
 * Conjunto pronto para `has(telefone)`, já com as duas formas de cada número.
 * É maior que a lista salva de propósito — quem quer mostrar a lista ao
 * usuário usa `loadOptOuts`.
 */
export async function loadOptOutSet(env: Env): Promise<Set<string>> {
  const set = new Set<string>();
  for (const p of await loadOptOuts(env)) {
    for (const v of phoneVariants(p)) set.add(v);
  }
  return set;
}

export async function isOptedOut(env: Env, phone: string): Promise<boolean> {
  const set = await loadOptOutSet(env);
  return phoneVariants(phone).some((v) => set.has(v));
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

/** Remove o número em qualquer uma das suas formas — senão o admin tira o que
 *  digitou e a outra grafia fica para trás, silenciando alguém para sempre. */
export async function removeOptOut(env: Env, phone: string): Promise<string[]> {
  const alvos = new Set(phoneVariants(phone));
  const list = (await loadOptOuts(env)).filter((p) => !alvos.has(normalizePhone(p)));
  return save(env, list);
}
