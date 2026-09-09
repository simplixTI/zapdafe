import type { Env } from '../../_shared/auth';
import { fetchAllChats, fetchMessagesSinceCutoff } from '../../_shared/uazapi';
import { runArchive } from '../../_shared/archive';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const env = context.env;
  try {
    const [chats, messagesResult] = await Promise.all([
      fetchAllChats(env),
      fetchMessagesSinceCutoff(env),
    ]);
    const archive = await runArchive(env, messagesResult.messages, chats);
    return new Response(
      JSON.stringify({
        ok: true,
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
