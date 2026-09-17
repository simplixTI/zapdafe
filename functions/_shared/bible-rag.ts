// RAG lookup against Supabase pgvector using OpenAI embeddings.
// Runs inside a Cloudflare Pages Function (edge runtime, no Node deps).

import { recordUsage } from './usage';
import type { Env } from './auth';

export interface BibleVerseHit {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
  translation: string;
  similarity: number;
}

export interface BibleRagEnv extends Partial<Env> {
  OPENAI_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  BIBLE_RAG_ENABLED?: string;
}

const EMBED_MODEL = 'text-embedding-3-small';

/**
 * Retrieves the top-k most relevant Bible verses for a natural-language query.
 * Returns [] when the RAG feature flag is off, on error, or on empty result.
 */
export async function searchBibleVerses(
  env: BibleRagEnv,
  query: string,
  { limit = 5, threshold = 0.78 }: { limit?: number; threshold?: number } = {},
): Promise<BibleVerseHit[]> {
  if (env.BIBLE_RAG_ENABLED !== 'true') return [];
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    const embRes = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: EMBED_MODEL, input: trimmed }),
    });
    if (!embRes.ok) {
      console.error('bible-rag embed:', embRes.status, await embRes.text());
      return [];
    }
    const embJson = (await embRes.json()) as {
      data: Array<{ embedding: number[] }>;
      usage?: { prompt_tokens?: number; total_tokens?: number };
    };
    const embedding = embJson.data?.[0]?.embedding;
    if (!embedding) return [];
    if (env.KV && embJson.usage) {
      await recordUsage(env as Env, { embed: embJson.usage.total_tokens ?? embJson.usage.prompt_tokens ?? 0 });
    }

    const sbUrl = env.SUPABASE_URL.replace(/\/$/, '');
    const rpcRes = await fetch(`${sbUrl}/rest/v1/rpc/match_bible_verses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        query_embedding: embedding,
        match_threshold: threshold,
        match_count: limit,
      }),
    });
    if (!rpcRes.ok) {
      console.error('bible-rag rpc:', rpcRes.status, await rpcRes.text());
      return [];
    }
    const rows = (await rpcRes.json()) as BibleVerseHit[];
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.error('bible-rag error:', err instanceof Error ? err.message : String(err));
    return [];
  }
}

/**
 * Renders retrieved verses as a compact context block for LLM prompts.
 * Returns null when there are no hits, so the caller can decide to skip
 * quoting Scripture (rather than fabricating a citation).
 */
export function formatBibleContext(verses: BibleVerseHit[]): string | null {
  if (!verses?.length) return null;
  return verses
    .map(v => `${v.book} ${v.chapter}:${v.verse} (${v.translation}): "${v.text}"`)
    .join('\n');
}
