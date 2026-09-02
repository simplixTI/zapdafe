export interface Env {
  KV: KVNamespace;
  ADMIN_PASSWORD: string;
  UAZAPI_TOKEN: string;
  UAZAPI_BASE: string;
  BUBBLE_BEARER: string;
}

const SESSION_COOKIE = 'zapdafe_admin';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export function parseCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export async function createSession(env: Env): Promise<string> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  await env.KV.put(`session:${token}`, '1', { expirationTtl: SESSION_TTL_SECONDS });
  return token;
}

export async function isAuthed(request: Request, env: Env): Promise<boolean> {
  const token = parseCookie(request.headers.get('Cookie'), SESSION_COOKIE);
  if (!token) return false;
  const record = await env.KV.get(`session:${token}`);
  return record !== null;
}

export async function destroySession(request: Request, env: Env): Promise<void> {
  const token = parseCookie(request.headers.get('Cookie'), SESSION_COOKIE);
  if (token) await env.KV.delete(`session:${token}`);
}

export function unauthorizedRedirect(request: Request): Response {
  const url = new URL(request.url);
  const next = encodeURIComponent(url.pathname + url.search);
  return Response.redirect(`${url.origin}/admin-login?next=${next}`, 302);
}

export function unauthorizedJson(): Response {
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
