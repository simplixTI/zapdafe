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

// Nomes do nosso lado do balcão. As pessoas cumprimentam o pastor pelo nome
// ("Oi Pastor Everaldo, gostaria de receber as mensagens"), e o extrator lia
// isso como apresentação do próprio contato — o +55 22 99822-5733, que se chama
// Toninho, virou "Everaldo".
//
// Só valem como nome de contato quando a pessoa está respondendo à pergunta
// "qual é o seu nome?" (allowOwnNames). Fora desse contexto, quem escreve
// "Everaldo" está falando do pastor.
const OWN_NAMES = new Set(['everaldo', 'zapdafe']);

const NAME_QUESTION = /\b(qual (e )?(o )?(seu|teu) (primeiro )?nome|como (voce |vc |tu )?(se )?chama|como posso (te |lhe )?chamar|(me )?(diz|dizer|falar|saber|conhecer) (o )?(seu|teu) nome|(seu|teu) primeiro nome)\b/;

/** True quando a última fala da IA foi pedir o nome da pessoa. */
export function looksLikeNameQuestion(text: string): boolean {
  return NAME_QUESTION.test(normalizeText(text));
}

// A pessoa se apresentando de forma inequívoca. Serve para um caso específico:
// quando JÁ temos um nome salvo e ela está corrigindo.
//
// Sem isso o nome errado é permanente. A extração só roda quando não há nome
// (`if (!contactName)`), então quem foi registrado como "Joanilson" — o nome de
// exibição do WhatsApp — nunca vira "Pedro", por mais vezes que ele diga.
//
// A lista é curta de propósito: aqui a gente SOBRESCREVE um nome existente, e
// "sou o pai da Ana" não pode virar correção. Quem corrige diz "meu nome é" ou
// "me chamo".
const SELF_INTRO = /\b(meu nome (e|eh) |me chamo\b|pode me chamar de\b|meu primeiro nome (e|eh) |nao me chamo\b|meu nome nao (e|eh)\b)/;

/** True quando a pessoa está declarando o próprio nome de forma explícita. */
export function looksLikeSelfIntroduction(text: string): boolean {
  return SELF_INTRO.test(normalizeText(text));
}

const LETTERS_ONLY = /^[\p{L}][\p{L}'-]*$/u;

const GREETINGS = 'oi|ola|opa|bom dia|boa tarde|boa noite|fala|e ai|salve|paz do senhor|paz';
const TITLES = 'pastor|pastora|pr|pra|padre|bispo|reverendo|irmao|irma|missionario|missionaria|diacono|profeta|apostolo|dona|seu|sr|sra';

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when `name` appears in `text` as someone being addressed or referred to,
 * rather than the sender introducing themselves — "Oi Pastor Everaldo" and
 * "bom dia Everaldo" are greetings aimed at a third party.
 */
export function namedAsSomeoneElse(text: string, name: string): boolean {
  const haystack = normalizeText(text);
  const needle = escapeForRegex(normalizeText(name));
  if (!haystack || !needle) return false;

  // Cumprimento (com título opcional) seguido direto do nome
  const afterGreeting = new RegExp(`\\b(?:${GREETINGS})\\b[\\s,!]*(?:(?:${TITLES})\\b[\\s,!]*)?${needle}\\b`);
  // Título colado no nome em qualquer posição: "com o pastor Everaldo"
  const afterTitle = new RegExp(`\\b(?:${TITLES})\\b[\\s,!]*${needle}\\b`);

  return afterGreeting.test(haystack) || afterTitle.test(haystack);
}

/**
 * Returns a usable first name, or null when the input cannot be trusted as one.
 * Rejects emoji, digits, symbols, single letters and common non-name words.
 *
 * `allowOwnNames` libera "Everaldo"/"Zapdafé" — use apenas quando a pessoa
 * está respondendo a uma pergunta direta sobre o nome dela.
 */
export function plausibleFirstName(
  raw: string | null | undefined,
  { allowOwnNames = false }: { allowOwnNames?: boolean } = {},
): string | null {
  if (!raw) return null;

  // Decoration is not a signal: "Drika 🦋" is Drika. Strip the emoji and judge
  // the word, so only the word itself can disqualify the name.
  const trimmed = raw
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{S}~]/gu, ' ')
    .trim();
  if (!trimmed) return null;

  // Hyphens stay: "Ana-Clara" is one name, while "Maria - Vendas" splits on the space
  const first = trimmed.split(/[\s,._|/]+/).filter(Boolean)[0];
  if (!first) return null;

  const cleaned = first.replace(/[^\p{L}'-]/gu, '');
  if (cleaned.length < 2 || cleaned.length > 20) return null;
  if (!LETTERS_ONLY.test(cleaned)) return null;
  const normalized = normalizeText(cleaned);
  if (NOT_NAMES.has(normalized)) return null;
  if (!allowOwnNames && OWN_NAMES.has(normalized)) return null;

  return cleaned
    .toLowerCase()
    .replace(/(^|[-'])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toUpperCase());
}
