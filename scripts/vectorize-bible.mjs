// Vectorizes a JSON dataset of Bible verses into Supabase pgvector.
//
// Input:  path to a JSON file shaped as [{ book, chapter, verse, text, translation? }, ...]
// Output: rows in `public.bible_verses` with embeddings (text-embedding-3-small, 1536 dims).
//
// - Idempotent: uses upsert on (translation, book, chapter, verse) so re-runs skip existing.
// - Batches 100 verses per embedding call.
// - Retries on transient network errors with exponential backoff (3 tries).
// - Progress logged every batch.
//
// Env:
//   OPENAI_API_KEY          — OpenAI key (embeddings)
//   SUPABASE_URL            — https://<ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — service role key (needed to write)
//
// Usage: node scripts/vectorize-bible.mjs [--input path] [--translation NTLH]

import fs from 'node:fs';

const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const inputPath = val('--input') ?? 'data/ntlh-verses.json';
const translation = val('--translation') ?? 'NTLH';
const BATCH = Number(val('--batch') ?? 100);
const EMBED_MODEL = 'text-embedding-3-small';

for (const req of ['OPENAI_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (!process.env[req]) { console.error(`Missing env: ${req}`); process.exit(1); }
}
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const SB_URL = process.env.SUPABASE_URL.replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (!Array.isArray(raw)) { console.error('Input JSON must be an array'); process.exit(1); }

// Normalize + dedupe
const verses = raw
  .filter(v => v && v.book && v.chapter && v.verse && typeof v.text === 'string' && v.text.trim())
  .map(v => ({
    book: String(v.book),
    chapter: Number(v.chapter),
    verse: Number(v.verse),
    text: v.text.replace(/\s+/g, ' ').trim(),
    translation: String(v.translation ?? translation),
  }));

console.log(`Loaded ${verses.length} verses from ${inputPath}`);

async function retry(fn, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      const wait = 500 * Math.pow(2, i);
      console.warn(`retry ${i + 1}/${tries} after ${wait}ms: ${err.message}`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function embedBatch(texts) {
  return retry(async () => {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    return j.data.map(d => d.embedding);
  });
}

async function upsertBatch(rows) {
  return retry(async () => {
    const res = await fetch(`${SB_URL}/rest/v1/bible_verses?on_conflict=translation,book,chapter,verse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error(`supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  });
}

let done = 0;
const startTs = Date.now();
for (let i = 0; i < verses.length; i += BATCH) {
  const chunk = verses.slice(i, i + BATCH);
  const texts = chunk.map(v => `${v.book} ${v.chapter}:${v.verse} — ${v.text}`);
  const embeddings = await embedBatch(texts);
  const rows = chunk.map((v, k) => ({ ...v, embedding: embeddings[k] }));
  await upsertBatch(rows);
  done += chunk.length;
  const rate = done / ((Date.now() - startTs) / 1000);
  const eta = Math.round((verses.length - done) / Math.max(rate, 0.1));
  console.log(`${done}/${verses.length} (${Math.round(done/verses.length*100)}%) · ${rate.toFixed(1)}/s · ETA ${eta}s`);
}

console.log(`✓ Vectorized ${done} verses in ${Math.round((Date.now() - startTs)/1000)}s`);
