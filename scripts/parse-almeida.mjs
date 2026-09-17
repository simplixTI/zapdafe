// Parses the clean Almeida-style PDF (bibilia.pdf) into
// [{ book, chapter, verse, text, translation }].
//
// Format observations from the source PDF:
//   - Book headers appear on their own line: "Gênesis"
//   - Chapter headers appear on their own line: "Gênesis 1", "Gênesis 2", ...
//   - Verse markers are "<num><CapitalLetter>...": "1NO princípio criou Deus..."
//   - Verses can wrap across lines (continuation starts lowercase or capital)
//   - Multiple verses may appear on one line separated by " <num><Cap>":
//       "...os céus, 5E toda a planta do campo..."
//   - Page markers: "-- N of 3047 --"
//   - Chapter index page (tab-separated numbers) precedes each book's chapters
//
// Usage: node scripts/parse-almeida.mjs [--input bibilia.pdf] [--out data/bible-verses.json]

import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

const CAPITAL_CLASS = 'A-ZÁÀÂÃÄÉÊËÍÎÏÓÔÕÖÚÛÜÇ';

// Canonical book names (output) mapped to any PDF-header variants (input).
// Some names differ or contain typos in the source PDF; both spellings must
// be recognised as the same book.
const BOOK_ALIASES = [
  ['Gênesis',            ['Gênesis']],
  ['Êxodo',              ['Êxodo']],
  ['Levítico',           ['Levítico']],
  ['Números',            ['Números']],
  ['Deuteronômio',       ['Deuteronômio']],
  ['Josué',              ['Josué']],
  ['Juízes',             ['Juízes']],
  ['Rute',               ['Rute']],
  ['1 Samuel',           ['1 Samuel']],
  ['2 Samuel',           ['2 Samuel']],
  ['1 Reis',             ['1 Reis']],
  ['2 Reis',             ['2 Reis']],
  ['1 Crônicas',         ['1 Crônicas']],
  ['2 Crônicas',         ['2 Crônicas']],
  ['Esdras',             ['Esdras']],
  ['Neemias',            ['Neemias']],
  ['Ester',              ['Ester']],
  ['Jó',                 ['Jó']],
  ['Salmos',             ['Salmos']],
  ['Provérbios',         ['Provérbios']],
  ['Eclesiastes',        ['Eclesiastes']],
  ['Cantares',           ['Cantares de Salomão', 'Cantares']],
  ['Isaías',             ['Isaías']],
  ['Jeremias',           ['Jeremias']],
  ['Lamentações',        ['Lamentações']],
  ['Ezequiel',           ['Ezequiel']],
  ['Daniel',             ['Daniel']],
  ['Oséias',             ['Oséias']],
  ['Joel',               ['Joel']],
  ['Amós',               ['Amós']],
  ['Obadias',            ['Obadias']],
  ['Jonas',              ['Jonas']],
  ['Miquéias',           ['Miqéias', 'Miquéias']], // PDF has typo "Miqéias"
  ['Naum',               ['Naum']],
  ['Habacuque',          ['Habacuque']],
  ['Sofonias',           ['Sofonias']],
  ['Ageu',               ['Ageu']],
  ['Zacarias',           ['Zacarias']],
  ['Malaquias',          ['Malaquias']],
  ['Mateus',             ['Mateus']],
  ['Marcos',             ['Marcos']],
  ['Lucas',              ['Lucas']],
  ['João',               ['João']],
  ['Atos',               ['Atos']],
  ['Romanos',            ['Romanos']],
  ['1 Coríntios',        ['1 Coríntios']],
  ['2 Coríntios',        ['2 Coríntios']],
  ['Gálatas',            ['Gálatas']],
  ['Efésios',            ['Efésios']],
  ['Filipenses',         ['Filipenses']],
  ['Colossenses',        ['Colossenses']],
  ['1 Tessalonicenses',  ['1 Tessalonicenses']],
  ['2 Tessalonicenses',  ['2 Tessalonicenses']],
  ['1 Timóteo',          ['1 Timóteo']],
  ['2 Timóteo',          ['2 Timóteo']],
  ['Tito',               ['Tito']],
  ['Filemom',            ['Filemom']],
  ['Hebreus',            ['Hebreus']],
  ['Tiago',              ['Tiago']],
  ['1 Pedro',            ['1 Pedro']],
  ['2 Pedro',            ['2 Pedro']],
  ['1 João',             ['1 João']],
  ['2 João',             ['2 João']],
  ['3 João',             ['3 João']],
  ['Judas',              ['Judas']],
  ['Apocalipse',         ['Apocalipse']],
];

// Build alias → canonical map + all names (sorted by length desc so
// "Cantares de Salomão" matches before "Cantares" would-be prefix).
const ALIAS_TO_CANON = new Map();
for (const [canon, aliases] of BOOK_ALIASES) {
  for (const a of aliases) ALIAS_TO_CANON.set(a, canon);
}
const ALL_NAMES = [...ALIAS_TO_CANON.keys()].sort((a, b) => b.length - a.length);

// Escape name for regex
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Chapter-header pattern: "<book> <number>" — matches either standalone
// line ($) or inline (followed by space or end); the parser will split the
// line at match position.
const CHAPTER_ANY = new RegExp(`(?:^|(?<=[\\s.]))(${ALL_NAMES.map(escapeRe).join('|')}) (\\d+)(?=\\s|$)`, 'g');
// Inline verse marker: preceded by start-of-string or whitespace, then digit(s),
// optionally followed by ". " (used at acrostic section starts in Psalm 119),
// then a capital letter.
const VERSE_INLINE = new RegExp(`(?:^|(?<=\\s))(\\d+)(\\.\\s)?(?=[${CAPITAL_CLASS}])`, 'g');
// Chapter-index grid line: only tabs/spaces and digits
const INDEX_LINE = /^(?:\d+[\t ]*)+$/;
// Page marker
const PAGE_MARKER = /^-- \d+ of \d+ --$/;
// Colophon / end-of-book marker
const COLOPHON = /^FICHA TÉCNICA\b/;

// ---------- args ----------
const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const inputPath = val('--input') ?? 'bibilia.pdf';
const outPath = val('--out') ?? 'data/bible-verses.json';
const translation = val('--translation') ?? 'ACF';

// ---------- extract ----------
console.log(`Loading ${inputPath}…`);
const buf = fs.readFileSync(inputPath);
const parser = new PDFParse({ data: buf });
const { text, total } = await parser.getText();
console.log(`Extracted ${total ?? '?'} pages, ${text.length} chars`);

// ---------- parse ----------
const verses = [];
let book = null;
let chapter = 0;
let verse = 0;
let buf2 = '';

function commit() {
  const t = buf2.replace(/\s+/g, ' ').trim();
  if (t && book && chapter && verse) {
    verses.push({ book, chapter, verse, text: t, translation });
  }
  buf2 = '';
}

// Process a text fragment (may contain inline verse markers)
function feed(fragment) {
  if (!fragment) return;
  // Find inline verse markers
  const markers = [...fragment.matchAll(VERSE_INLINE)];
  if (markers.length === 0) {
    buf2 += ' ' + fragment;
    return;
  }
  // Text before the first marker belongs to the current verse
  const firstIdx = markers[0].index;
  if (firstIdx > 0) buf2 += ' ' + fragment.slice(0, firstIdx);
  // Each marker starts a new verse
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    const num = Number(m[1]);
    const startText = m.index + m[0].length; // consume optional ". " too
    const endText = i + 1 < markers.length ? markers[i + 1].index : fragment.length;
    commit();
    verse = num;
    buf2 = fragment.slice(startText, endText);
  }
}

// Process one line: split it at inline chapter-header markers, feeding
// segments through feed() and switching book/chapter at each header.
function processLine(line) {
  // Reset regex lastIndex (global regex retains state across calls)
  CHAPTER_ANY.lastIndex = 0;
  const matches = [...line.matchAll(CHAPTER_ANY)];
  if (matches.length === 0) {
    if (book && chapter) feed(line);
    return;
  }
  // Segment 0: text before the first chapter header — belongs to current
  // chapter (previous chapter's tail)
  if (matches[0].index > 0 && book && chapter) {
    feed(line.slice(0, matches[0].index).trim());
  }
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const canonName = ALIAS_TO_CANON.get(m[1]);
    const chNum = Number(m[2]);
    if (!canonName) continue;
    commit();
    book = canonName;
    chapter = chNum;
    verse = 0;
    // Text between this header and the next (or end of line)
    const segStart = m.index + m[0].length;
    const segEnd = i + 1 < matches.length ? matches[i + 1].index : line.length;
    const segment = line.slice(segStart, segEnd).trim();
    if (segment) feed(segment);
  }
}

const lines = text.split(/\r?\n/);
let done = false;
for (const raw of lines) {
  if (done) break;
  const line = raw.trim();
  if (!line) continue;
  if (PAGE_MARKER.test(line)) continue;
  if (INDEX_LINE.test(line)) continue;
  if (COLOPHON.test(line)) { commit(); done = true; break; }
  processLine(line);
}
commit();

// ---------- summary ----------
const byBook = new Map();
for (const v of verses) {
  const e = byBook.get(v.book) ?? { chapters: new Set(), verses: 0 };
  e.chapters.add(v.chapter);
  e.verses += 1;
  byBook.set(v.book, e);
}
const summary = BOOK_ALIASES.map(([b]) => {
  const e = byBook.get(b);
  return { book: b, chapters: e?.chapters.size ?? 0, verses: e?.verses ?? 0 };
});

fs.writeFileSync(outPath, JSON.stringify(verses, null, 0));
fs.writeFileSync(outPath.replace('.json', '.summary.json'), JSON.stringify(summary, null, 2));

console.log(`✓ ${verses.length} verses across ${summary.filter(s => s.verses > 0).length}/${BOOK_ALIASES.length} books`);
console.log('\nFirst 3 verses:');
for (const v of verses.slice(0, 3)) console.log(`  ${v.book} ${v.chapter}:${v.verse}  "${v.text.slice(0, 90)}${v.text.length > 90 ? '…' : ''}"`);
console.log('\nLast 3 verses:');
for (const v of verses.slice(-3)) console.log(`  ${v.book} ${v.chapter}:${v.verse}  "${v.text.slice(0, 90)}${v.text.length > 90 ? '…' : ''}"`);
console.log('\nPer-book counts:');
for (const s of summary) console.log(`  ${s.book.padEnd(20)} ${String(s.chapters).padStart(3)} ch · ${String(s.verses).padStart(5)} v`);
