// Contatos que não estão recebendo o devocional, e por isso saíram da lista de
// alvos.
//
// ⚠️ NÃO é a lista de opt-out, e a separação é deliberada. `optouts:list` é o
// registro de quem PEDIU para sair — o cliente olha para ela, e se um dia
// perguntar "por que essa pessoa está aqui?", a resposta tem que ser "ela
// pediu". Número que o sistema tirou por conta própria misturado ali corrompe
// esse significado. E o ciclo de vida é outro: opt-out nunca deve voltar;
// quem está aqui volta no dia em que as mensagens começarem a chegar.
//
// Como esta lista nasceu (2026-11-16): 34 contatos nunca escreveram uma única
// mensagem, e um deles já tinha recebido 63 devocionais. Medindo o status real
// na Uazapi, eles se dividiram em três grupos bem diferentes:
//   - 8 LEEM todo dia (status `Read`) e nunca escrevem. Devocional é mensagem
//     de mão única; ler sem responder é o comportamento normal. Esses ficam.
//   - 13 recebem sem confirmar leitura (`Delivered`). Não dá para concluir
//     nada: muita gente desliga confirmação de leitura. Esses ficam.
//   - 12 cujas mensagens ficam em `Server Whatsapp` e NUNCA alcançam o
//     aparelho. Esses entraram aqui.
//
// O `/chat/check` confirmou que todos os 12 **existem** no WhatsApp — não são
// números mortos. Em conta que existe, mensagem presa no servidor significa
// aparelho há muito tempo offline ou, mais provável, que a pessoa bloqueou o
// número. Nos dois casos o envio diário é desperdício puro; e se for bloqueio,
// insistir é justamente o que estraga a reputação do número no WhatsApp.
//
// ⚠️ O limite honesto desta medição: a Uazapi só guarda ~8 dias de histórico,
// então o que se observa são 4 ou 5 devocionais. Um celular desligado por uma
// semana — viagem, aparelho quebrado — parece igual a um bloqueio. É por isso
// que esta lista é reversível e tem data de revisão no STATUS.md.

import type { Env } from './auth';
import { normalizePhone, phoneVariants } from './optouts';

const KEY = 'inativos:list';

export interface Inativo {
  phone: string;
  /** Por que saiu. Texto livre, para alguém entender sem precisar do commit. */
  motivo: string;
  /** Quando saiu (YYYY-MM-DD). */
  desde: string;
}

export async function loadInativos(env: Env): Promise<Inativo[]> {
  const raw = await env.KV.get(KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as Inativo[];
    return Array.isArray(arr) ? arr.filter((i) => i && typeof i.phone === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Conjunto pronto para `has(telefone)`, com as duas grafias de cada número —
 * mesma razão do opt-out: o chatid pode ter 12 ou 13 dígitos, e comparar
 * grafia contra grafia já deixou um contato recebendo por cinco dias depois de
 * pedir para sair (incidente de 2026-09-22).
 */
export async function loadInativoSet(env: Env): Promise<Set<string>> {
  const set = new Set<string>();
  for (const i of await loadInativos(env)) {
    for (const v of phoneVariants(normalizePhone(i.phone))) set.add(v);
  }
  return set;
}
