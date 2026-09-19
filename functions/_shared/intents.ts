// Deterministic opt-out detection, run before any LLM call.
//
// Two tiers on purpose: only an explicit command opts someone out, so a
// mis-read sentence can never silence a contact. Fuzzier phrasing merely
// points the person at the command.

import { normalizeText } from './text';

const COMMAND = /^\/?(sair|parar)$/;

const INTENT_PATTERNS: RegExp[] = [
  /\bpar[ae]r? de (me )?(mandar|enviar)/,
  /\bnao (quero|queria) (mais )?(receber|mensage|msg)/,
  /\bnao (manda|mande|mandem|envie|envia|enviem) mais/,
  /\bdescadastr/,
  /\bcancelar (a )?(inscricao|assinatura|as mensagens|o envio|o recebimento)/,
  /\b(remov|tir|exclu)\w* (o )?meu (numero|contato)/,
  /\bme (tira|tire|remove|remova|exclua) (da|dessa|desta) lista/,
  /\bsair da lista/,
  /\bquero sair\b/,
];

export function isOptOutCommand(text: string): boolean {
  return COMMAND.test(normalizeText(text));
}

export function isOptOutIntent(text: string): boolean {
  const normalized = normalizeText(text);
  return INTENT_PATTERNS.some((re) => re.test(normalized));
}
