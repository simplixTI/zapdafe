// Passagem do atendimento para uma pessoa de verdade.
//
// Pedido do cliente em 2026-10-20: a psicóloga (Denise) atende a pessoa pelo
// WhatsApp DELA, numa conversa separada, e a IA não pode ficar respondendo no
// meio do atendimento. Como o Zapdafé não participa daquela conversa, ele não
// tem como perceber nada sozinho — alguém da equipe precisa avisar.
//
// Duas portas, porque a principal não é verificável daqui:
//
//   1. A FRASE NA PRÓPRIA CONVERSA (é o que o cliente pediu). A psicóloga entra
//      no WhatsApp oficial do Zapdafé por aparelho conectado e digita "Aqui é a
//      Denise do ZapdaFé" na conversa da pessoa. A frase faz duas coisas de uma
//      vez: apresenta a Denise ao contato e tira o bot do caminho.
//
//      Essa mensagem chega ao webhook como `fromMe` com `wasSentByApi: false`,
//      e é assim que se distingue o que uma PESSOA digitou do que a IA enviou.
//      ⚠️ Em 2026-10-20 não havia nenhuma mensagem digitada à mão na instância
//      (120 nossas, todas via API), então não deu para provar que a Uazapi
//      repassa esse evento ao webhook. Se não repassar, sobra a porta 2.
//
//   2. O COMANDO REMOTO, de um número da equipe, dizendo qual número pausar:
//        /pausar 5521999998888
//        /voltar 5521999998888      (encerra a pausa antes das 3h)
//
// A pausa vive numa chave de KV por número, com TTL de 3 horas. O TTL é o
// próprio prazo: não há data para comparar nem rotina para limpar, e quando
// expira o bot volta sozinho. Mesmo desenho do índice `active:`, e de
// propósito: uma chave por número não tem leitura-antes-de-escrita, que é o
// que apagou nomes de contato em 2026-09-25.

import type { Env } from './auth';
import { normalizePhone, phoneVariants } from './optouts';
import { normalizeText } from './text';

export const PAUSE_PREFIX = 'pause:';
/** Quanto tempo o bot fica fora do ar numa conversa. Pedido do cliente. */
export const PAUSE_HOURS = 3;

/**
 * Números autorizados a pausar uma conversa.
 *
 * Fica em código, versionado, e não em env: a lista muda raríssimo, e os
 * secrets deste projeto já foram corrompidos uma vez pelo prompt interativo do
 * wrangler (ver "Por que ele existe" no STATUS). O número do gatilho entra
 * automaticamente, via env, porque já é um número privilegiado do sistema.
 *
 * ⚠️ Sem autorização qualquer contato poderia calar o bot para outra pessoa.
 */
const EQUIPE: string[] = [
  // Vazio de propósito: a psicóloga usa o número OFICIAL do Zapdafé, então ela
  // não precisa estar aqui — quem a identifica é a frase na conversa. Esta
  // lista existe para o comando remoto, e o número do gatilho já entra via env.
];

export function isTeamPhone(env: Env, phone: string): boolean {
  const alvo = normalizePhone(phone);
  const autorizados = new Set<string>();
  for (const p of [...EQUIPE, env.DEVOTIONAL_TRIGGER_PHONE].filter(Boolean)) {
    for (const v of phoneVariants(normalizePhone(p))) autorizados.add(v);
  }
  return phoneVariants(alvo).some((v) => autorizados.has(v));
}

// A frase que tira o bot da conversa. "Aqui é a Denise do ZapdaFé" é a que o
// cliente pediu, mas o nome é livre: no dia em que outra pessoa da equipe
// assumir, a frase dela funciona sem precisar de deploy.
const FRASE_NA_CONVERSA = /\baqui (e|eh|quem fala e) (a|o) \p{L}[\p{L}'-]* (do|da) zap ?da ?fe\b/u;

/**
 * True quando é alguém da equipe se apresentando na conversa, o que na prática
 * quer dizer "assumi daqui, pode sair". Só vale para mensagem digitada à mão no
 * número oficial — ver o cabeçalho deste arquivo.
 */
export function looksLikeHumanTakeover(text: string): boolean {
  return FRASE_NA_CONVERSA.test(normalizeText(text));
}

export interface HandoffCommand {
  action: 'pausar' | 'voltar';
  phone: string;
}

const PALAVRA_PAUSAR = /^\/?(pausar|pausa|assumir|atendimento)\b/;
const PALAVRA_VOLTAR = /^\/?(voltar|volta|retomar|liberar)\b/;

/**
 * Lê um comando de passagem, ou null. O telefone é a primeira sequência longa
 * de dígitos da mensagem, já normalizada com o 55 na frente.
 */
export function parseHandoffCommand(text: string): HandoffCommand | null {
  const normalizado = normalizeText(text);
  const ehPausa = PALAVRA_PAUSAR.test(normalizado) || FRASE_NA_CONVERSA.test(normalizado);
  const ehVolta = PALAVRA_VOLTAR.test(normalizado);
  if (!ehPausa && !ehVolta) return null;

  const phone = extrairTelefone(text);
  if (!phone) return null;
  return { action: ehVolta ? 'voltar' : 'pausar', phone };
}

/**
 * Tira um telefone brasileiro do meio do texto. Aceita "5521999998888",
 * "21 99999-8888" e "(21) 99999 8888"; sem o 55, assume Brasil.
 */
export function extrairTelefone(text: string): string | null {
  const candidatos = text.match(/[\d][\d\s().-]{8,}\d/g) ?? [];
  for (const bruto of candidatos) {
    const digitos = normalizePhone(bruto);
    if (digitos.length === 12 || digitos.length === 13) {
      if (digitos.startsWith('55')) return digitos;
    }
    // Sem o código do país: 10 dígitos (fixo) ou 11 (celular com o nono)
    if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  }
  return null;
}

const key = (phone: string) => `${PAUSE_PREFIX}${phone}`;

/**
 * Pausa a conversa com esse número. Grava todas as grafias do telefone, para
 * a checagem valer para a pessoa e não para a forma como o número foi digitado
 * — o chatid pode ter 12 ou 13 dígitos e quem digita usa a outra forma.
 */
export async function pausarConversa(env: Env, phone: string): Promise<string[]> {
  const variantes = phoneVariants(normalizePhone(phone));
  const agora = new Date().toISOString();
  await Promise.all(
    variantes.map((v) => env.KV.put(key(v), agora, { expirationTtl: PAUSE_HOURS * 60 * 60 })),
  );
  return variantes;
}

/** Devolve o bot para a conversa antes das 3 horas. */
export async function retomarConversa(env: Env, phone: string): Promise<string[]> {
  const variantes = phoneVariants(normalizePhone(phone));
  await Promise.all(variantes.map((v) => env.KV.delete(key(v))));
  return variantes;
}

/** True enquanto a conversa estiver nas mãos de uma pessoa. */
export async function conversaPausada(env: Env, phone: string): Promise<boolean> {
  return (await env.KV.get(key(normalizePhone(phone)))) !== null;
}
