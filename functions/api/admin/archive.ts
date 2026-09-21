import type { Env } from '../../_shared/auth';
import { aiCreds, legacyCreds, fetchAllChats, fetchMessagesSinceCutoff } from '../../_shared/uazapi';
import { runArchive } from '../../_shared/archive';

/**
 * Força uma passada do arquivo. Por padrão lê a luxprodutora; com
 * `?source=campanha360` relê a instância antiga, útil só se o backlog precisar
 * ser reconstruído.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const env = context.env;
  const source = new URL(context.request.url).searchParams.get('source');
  const creds = source === 'campanha360' ? legacyCreds(env) : aiCreds(env);
  try {
    const [chats, messagesResult] = await Promise.all([
      fetchAllChats(creds),
      fetchMessagesSinceCutoff(creds),
    ]);
    const archive = await runArchive(env, messagesResult.messages, chats, creds.source);
    return new Response(
      JSON.stringify({
        ok: true,
        source: creds.source,
        pagesFetched: messagesResult.pagesFetched,
        messagesFetched: messagesResult.messages.length,
        totalContactsEver: archive.meta.totalContactsEver,
        totalMessagesEver: archive.meta.totalMessagesEver,
        lastArchiveISO: archive.meta.lastArchiveISO,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'archive_failed', detail: err instanceof Error ? err.message : String(err) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
