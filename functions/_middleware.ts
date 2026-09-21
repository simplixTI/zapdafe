import type { Env } from './_shared/auth';
import { isAuthed, unauthorizedJson, unauthorizedRedirect } from './_shared/auth';

const PUBLIC_PATHS = [
  '/api/admin/login',
  '/api/optouts', // consumed by Bubble via bearer token, has its own auth
];

const PROTECTED_PATH_PREFIXES = ['/admin', '/api/admin'];

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const path = url.pathname;

  const isPublic = PUBLIC_PATHS.includes(path) || path === '/admin-login';
  const isProtected =
    !isPublic && PROTECTED_PATH_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));

  if (!isProtected) {
    return context.next();
  }

  if (await isAuthed(context.request, context.env)) {
    return context.next();
  }

  if (path.startsWith('/api/')) {
    return unauthorizedJson();
  }
  return unauthorizedRedirect(context.request);
};
