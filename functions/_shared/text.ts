// Message normalisation shared by the rule matcher and the intent detectors.
// Strips accents, case, emoji and punctuation so "Amém!" and "amem" compare
// equal. The slash survives so "/sair" stays distinguishable from "sair".

export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
