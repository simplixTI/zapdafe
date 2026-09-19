// Guard for the contact's first name.
//
// The name reaching us is either the WhatsApp profile name (a nickname the
// person picked, often a phrase with emoji) or something the LLM pulled out of
// a sentence. Both lie. A contact displaying "~Sou Eu 🌞" became "Sou", and the
// bot answered "Deus é bom o tempo todo" with "realmente, sou." — reading as a
// claim to be God. Anything that is not clearly a given name is rejected here,
// and the assistant simply asks for the name instead.

import { normalizeText } from './text';

// Words that show up as the first token of a WhatsApp display name, or that the
// extractor pulls from phrases like "eu sou sozinha".
const NOT_NAMES = new Set([
  'sou', 'eu', 'me', 'meu', 'minha', 'mim', 'nos', 'voce', 'vc', 'ele', 'ela',
  'nao', 'sim', 'talvez', 'nada', 'tudo', 'bem', 'mal',
  'deus', 'jesus', 'cristo', 'senhor', 'senhora', 'santo', 'santa', 'espirito',
  'amem', 'amor', 'paz', 'fe', 'vida', 'luz', 'gloria', 'aleluia',
  'familia', 'casa', 'mae', 'pai', 'filho', 'filha', 'irma', 'irmao', 'tia',
  'tio', 'vo', 'vovo', 'dona', 'dono', 'sr', 'sra', 'srta', 'doutor', 'doutora',
  'pastor', 'pastora', 'missionaria', 'missionario', 'evangelista', 'diacono',
  'obrigado', 'obrigada', 'oi', 'ola', 'bom', 'boa', 'dia', 'tarde', 'noite',
  'aqui', 'agora', 'hoje', 'ontem', 'amanha', 'gente', 'pessoa', 'alguem',
  'ninguem', 'trabalho', 'celular', 'whatsapp', 'zap', 'contato', 'cliente',
  'grupo', 'adm', 'admin', 'equipe', 'suporte', 'vendas', 'oficial', 'nenhum',
]);

const LETTERS_ONLY = /^[\p{L}][\p{L}'-]*$/u;

/**
 * Returns a usable first name, or null when the input cannot be trusted as one.
 * Rejects emoji, digits, symbols, single letters and common non-name words.
 */
export function plausibleFirstName(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // An emoji, digit or symbol anywhere means this is a display name, not a name
  if (/[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{N}]/u.test(trimmed)) return null;

  // Hyphens stay: "Ana-Clara" is one name, while "Maria - Vendas" splits on the space
  const first = trimmed.split(/[\s,._|/]+/).filter(Boolean)[0];
  if (!first) return null;

  const cleaned = first.replace(/[^\p{L}'-]/gu, '');
  if (cleaned.length < 2 || cleaned.length > 20) return null;
  if (!LETTERS_ONLY.test(cleaned)) return null;
  if (NOT_NAMES.has(normalizeText(cleaned))) return null;

  return cleaned
    .toLowerCase()
    .replace(/(^|[-'])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toUpperCase());
}
