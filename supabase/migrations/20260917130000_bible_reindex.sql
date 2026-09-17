-- After bulk-loading 31k vectors, the ivfflat index needs to be rebuilt so
-- its cluster centroids reflect actual data (an index built on an empty
-- table becomes a full-scan trap). We also tune the RPC to do KNN via the
-- index first and apply the similarity threshold in a second pass —
-- otherwise the WHERE clause forces a distance calculation on every row.
--
-- Runs against a Supabase project via the SQL editor with:
--   set statement_timeout = '5min';
--   set maintenance_work_mem = '128MB';
-- (these are session-local and don't persist)

drop index if exists public.idx_bible_verses_embedding;

create index idx_bible_verses_embedding
  on public.bible_verses
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 10);

analyze public.bible_verses;

-- Index-friendly RPC: order by distance (uses ivfflat), then filter.
create or replace function public.match_bible_verses(
  query_embedding vector(1536),
  match_threshold float default 0.35,
  match_count int default 5
)
returns table (id uuid, book text, chapter integer, verse integer,
               text text, translation text, similarity float)
language sql stable as $$
  with candidates as (
    select id, book, chapter, verse, text, translation,
      1 - (embedding <=> query_embedding) as similarity
    from public.bible_verses
    where embedding is not null
    order by embedding <=> query_embedding
    limit greatest(match_count * 3, 30)
  )
  select * from candidates
  where similarity > match_threshold
  order by similarity desc
  limit match_count;
$$;
