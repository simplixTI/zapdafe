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

// Aceno de fim de conversa. Depois de uma mensagem de encerramento, isso não é
// uma fala nova — é a pessoa dizendo "recebi". Responder aqui é exatamente o
// que o cliente chamou de provocar diálogo (pedido de 2026-09-22).
//
// A lista é curta de propósito. "Sim", "isso" e "tudo bem" ficaram de fora
// porque podem estar respondendo a uma pergunta, e "obrigado" tem regra
// própria no cérebro.
const ACKNOWLEDGEMENTS = new Set([
  'ok', 'okay', 'oky', 'okey', 'ta', 'ta bom', 'ta bem', 'ta certo', 'tabom',
  'blz', 'beleza', 'belezura', 'certo', 'combinado', 'fechou', 'fechado',
  'pode deixar', 'pode deixar sim', 'tranquilo', 'tranquila', 'suave',
  'valeu', 'vlw', 'amem', 'amem amem', 'amem amem amem',
]);

/** True quando a mensagem inteira é só um aceno de recebido. */
export function isAcknowledgement(text: string): boolean {
  const normalized = normalizeText(text);
  return normalized.length > 0 && ACKNOWLEDGEMENTS.has(normalized);
}

// Cumprimento seco, sem assunto nenhum junto.
//
// Tem resposta fixa porque o prompt não segurou: em 24/09 o "Oi" virou "Oi!
// Como você está?" — a pergunta que o cliente mandou tirar — mesmo com a
// proibição escrita. Num "Oi" sozinho o modelo não tem sobre o que ter
// empatia e cai no instinto de puxar conversa. A resposta que o cliente
// pediu ("Bom dia {nome}, que Deus te abençoe") não precisa de LLM.
const GREETING_SUFFIX = /\s+(zap|zapdafe|zap da fe|pastor|everaldo|pastor everaldo|irmao|irma|pessoal|gente|a todos)$/;

/**
 * Devolve o cumprimento canônico ("Bom dia", "Oi"...) quando a mensagem é SÓ
 * isso, ou null. "Oi, tudo bem?" devolve null de propósito: ali tem uma
 * pergunta de verdade, que merece a IA.
 */
export function matchGreeting(text: string): string | null {
  let n = normalizeText(text);
  // "Boa tarde Zap!" e "Bom dia, pastor" são o mesmo cumprimento seco
  while (GREETING_SUFFIX.test(n)) n = n.replace(GREETING_SUFFIX, '').trim();
  if (/^bom dia$/.test(n)) return 'Bom dia';
  if (/^boa tarde$/.test(n)) return 'Boa tarde';
  if (/^boa noite$/.test(n)) return 'Boa noite';
  if (/^(oi|ola|opa|salve|e ai)$/.test(n)) return 'Oi';
  return null;
}
