// Tom de encerramento e oferta de disponibilidade.
//
// Dois pedidos do cliente (2026-09-22) não cabem numa instrução de texto para o
// LLM, porque o que eles pedem é SILÊNCIO — e o modelo sempre devolve alguma
// coisa, que o código sempre envia:
//
//   1. "Quando o contato responder ok/beleza/blz/pode deixar depois da mensagem
//      de encerramento, não precisa responder mais nada."
//   2. "Não precisa falar várias vezes 'Estou aqui se precisar'. Basta falar uma
//      vez dentro do diálogo de 24 horas."
//
// Por isso a decisão vive aqui, em função pura, e não no prompt.

import { normalizeText } from './text';
import { splitSentences } from './voice';

// Frases com que o Zapdafé se coloca à disposição. São o fecho natural de quase
// toda resposta dele — repetidas, viram tique.
const OFFER_PATTERNS: RegExp[] = [
  /\b(estou|estarei|to|sigo|fico) (por )?aqui\b/,
  /\bconte comigo\b/,
  /\bpode contar comigo\b/,
  /\bse (voce )?precisar (de )?(falar|conversar|desabafar|algo|alguma coisa|de mim|compartilhar)/,
  /\bse (voce )?quiser (falar|conversar|desabafar|compartilhar|me contar)/,
  /\bqualquer coisa (me chama|me chame|e so chamar|estou aqui)/,
  /\b(e )?so (me )?chamar\b/,
];

// Bênção de despedida: o outro jeito de uma resposta do Zapdafé terminar.
const BLESSING_PATTERNS: RegExp[] = [
  /\bque deus (te|lhe|o|a|os|as)? ?abencoe/,
  /\bdeus (continue |te |lhe )?abencoand/,
  /\b(fique|fica|va|vai) com deus\b/,
  /\bum abraco\b/,
  /\bque (a )?paz (do senhor |de deus )?(esteja|fique)/,
  /\bpor nada\b/,
];

/** True quando a frase se coloca à disposição ("estou aqui se precisar"). */
export function containsOffer(text: string): boolean {
  const normalized = normalizeText(text);
  return OFFER_PATTERNS.some((re) => re.test(normalized));
}

/**
 * True quando a mensagem que ACABAMOS de enviar fecha o assunto — bênção de
 * despedida ou oferta de disponibilidade. É o gatilho para tratar o "ok" ou o
 * "amém" seguinte como aceno, não como pergunta.
 */
export function looksLikeClosing(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return (
    BLESSING_PATTERNS.some((re) => re.test(normalized)) ||
    OFFER_PATTERNS.some((re) => re.test(normalized))
  );
}

/**
 * Remove as frases que são só oferta de disponibilidade, mantendo o resto da
 * resposta intacto. Usado quando o Zapdafé já se ofereceu nas últimas 24h.
 *
 * Devolve null quando não sobra nada — aí é melhor mandar a resposta original
 * do que mandar mensagem vazia.
 */
export function stripOfferSentences(text: string): string | null {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return null;

  const kept = sentences.filter((s) => !containsOffer(s));
  if (kept.length === sentences.length) return null; // nada a tirar
  const joined = kept.join(' ').replace(/\s{2,}/g, ' ').trim();
  return joined.length > 0 ? joined : null;
}

/** True quando `iso` é de menos de `hours` atrás. */
export function withinHours(iso: string | undefined, hours: number): boolean {
  if (!iso) return false;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return false;
  return Date.now() - then < hours * 60 * 60 * 1000;
}
