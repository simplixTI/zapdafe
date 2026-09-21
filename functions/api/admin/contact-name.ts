// Corrige o primeiro nome de um contato.
//   GET  /api/admin/contact-name?phone=55DD9XXXXXXXX → { phone, chatid, name }
//   POST /api/admin/contact-name { phone, name }     → grava
//
// Existe porque a trava em names.ts descarta nome ruim na leitura, mas não
// tem como adivinhar o certo: a Cleonice tinha sido salva como "Sou" (do
// nome de exibição "~Sou Eu 🌞") e o Toninho como "Everaldo" (do "Oi pastor
// Everaldo" que o link de captação manda pré-preenchido).

import type { Env } from '../../_shared/auth';
import { loadProfile, updateProfile } from '../../_shared/conversation';
import { plausibleFirstName } from '../../_shared/names';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function chatidFromPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return `${digits}@s.whatsapp.net`;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const phone = new URL(context.request.url).searchParams.get('phone') ?? '';
  const chatid = chatidFromPhone(phone);
  if (!chatid) return json({ error: 'telefone_invalido' }, 400);

  const profile = await loadProfile(context.env, chatid);
  return json({
    phone: chatid.split('@')[0],
    chatid,
    name: profile.name ?? null,
    // O nome salvo pode existir e mesmo assim ser descartado pela trava
    nameEmUso: plausibleFirstName(profile.name),
    firstSeenISO: profile.firstSeenISO ?? null,
    lastSeenISO: profile.lastSeenISO ?? null,
  });
};

interface Body {
  phone?: string;
  name?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: Body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'corpo_invalido' }, 400);
  }

  const chatid = chatidFromPhone(body.phone ?? '');
  if (!chatid) return json({ error: 'telefone_invalido' }, 400);

  const name = (body.name ?? '').trim();
  if (!name) return json({ error: 'nome_vazio' }, 400);

  // Passa pela mesma trava do webhook: não adianta salvar um nome que a
  // conversa vai descartar na leitura. allowOwnNames porque aqui quem digita
  // é a equipe — se disserem que o contato se chama Everaldo, é porque é.
  const clean = plausibleFirstName(name, { allowOwnNames: true });
  if (!clean) return json({ error: 'nome_invalido', detalhe: 'use só o primeiro nome, sem emoji ou números' }, 400);

  const saved = await updateProfile(context.env, chatid, { name: clean });
  return json({ ok: true, phone: chatid.split('@')[0], name: saved.name });
};
