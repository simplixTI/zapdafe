// Confere o roteamento de eventos do webhook com os TRÊS payloads reais que a
// sonda `debug:payload:*` capturou em 23 e 24/11/2026. Chama o handler de
// verdade (onRequest), não uma cópia da lógica.
import { onRequest } from '../functions/api/uazapi/webhook';

const SECRET = 'segredo-de-teste';

function fakeKV() {
  const m = new Map<string, string>();
  return {
    store: m,
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => { m.set(k, v); },
    delete: async (k: string) => { m.delete(k); },
    list: async () => ({ keys: [], list_complete: true }),
  };
}

function ctx(payload: unknown, kv: ReturnType<typeof fakeKV>) {
  const pendentes: Promise<unknown>[] = [];
  return {
    request: new Request('https://x/api/uazapi/webhook?secret=' + SECRET, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'uazapiGO-Webhook/1.0' },
      body: JSON.stringify(payload),
    }),
    env: { KV: kv, AI_WEBHOOK_SECRET: SECRET, DEVOTIONAL_TRIGGER_PHONE: '5521998088003' },
    waitUntil: (p: Promise<unknown>) => { pendentes.push(p); },
    pendentes,
  } as any;
}

const CONNECTION = {
  BaseUrl: 'https://luxprodutora.uazapi.com',
  EventType: 'connection',
  event_id: '9e2c4d15-5315-47d9-ab3d-ad24222622df',
  instance: {
    lastDisconnect: '2026-11-24 14:02:11.601Z',
    lastDisconnectReason: '401: logged out from another device with recentMessage',
    name: 'ZAP DA FE',
    status: 'disconnected',
  },
  instanceName: 'ZAP DA FE', owner: '552123427056', token: 'x', type: 'LoggedOut',
};

const RECONEXAO = {
  ...CONNECTION,
  instance: { ...CONNECTION.instance, status: 'connected', lastDisconnectReason: '' },
  type: 'Connected',
};

const MESSAGES_UPDATE = {
  BaseUrl: 'https://luxprodutora.uazapi.com',
  EventType: 'messages_update',
  event: {
    Chat: '5521951014062@s.whatsapp.net', IsFromMe: false, IsGroup: false,
    MessageIDs: ['3EB035D07E82CB67EF7CC7'], Sender: '5521951014062@s.whatsapp.net',
    Timestamp: 1795439001, Type: 'Delivered', chatid: '5521951014062@s.whatsapp.net',
    chatlid: '114804643602443@lid', sender_lid: '114804643602443@lid',
    sender_pn: '5521951014062@s.whatsapp.net',
  },
  instanceName: 'ZAP DA FE', owner: '552123427056', state: 'Delivered', token: 'x',
  type: 'ReadReceipt',
};

const MENSAGEM = {
  BaseUrl: 'https://luxprodutora.uazapi.com',
  EventType: 'messages',
  chat: { id: 'x' }, chatSource: 'updated',
  // fromMe: true faz o handler ignorar sem rede nenhuma. O que este caso prova
  // é que `EventType: "messages"` NÃO é comido pelos ramos de evento.
  message: {
    chatid: '5521951014062@s.whatsapp.net', content: 'Dia', text: 'Dia',
    fromMe: true, wasSentByApi: false, isGroup: false, messageType: 'Conversation',
    messageid: '3ACF510170633D859DF2', type: 'text',
  },
  instanceName: 'ZAP DA FE', owner: '552123427056', token: 'x',
};

// Formato antigo hipotético: `event` como string. Tem que continuar valendo.
const CONNECTION_FORMATO_ANTIGO = {
  event: 'connection', status: 'disconnected', lastDisconnectReason: 'teste',
};

let falhas = 0;
function ok(nome: string, cond: boolean, detalhe = '') {
  const marca = cond ? 'OK   ' : 'FALHA';
  console.log(marca + ' ' + nome + (!cond && detalhe ? ' -> ' + detalhe : ''));
  if (!cond) falhas++;
}

async function roda(payload: unknown, kv = fakeKV()) {
  const c = ctx(payload, kv);
  const res = await onRequest(c);
  await Promise.all(c.pendentes);
  let body: any = {};
  try { body = JSON.parse(await res.clone().text()); } catch { body = { raw: await res.text() }; }
  return { res, body, kv };
}

(async () => {
  // 1. connection -> ramo certo, estado e queda gravados
  {
    const { body, kv } = await roda(CONNECTION);
    ok('connection cai no ramo connection', body.kind === 'connection', JSON.stringify(body));
    const estado = JSON.parse(kv.store.get('sessao:estado') ?? '{}');
    ok('sessao:estado gravado como disconnected', estado.status === 'disconnected', JSON.stringify(estado));
    ok('motivo real preservado', String(estado.motivo).includes('logged out from another device'), estado.motivo);
    const quedas = JSON.parse(kv.store.get('sessao:quedas') ?? '[]');
    ok('queda aberta no historico', quedas.length === 1 && quedas[0].voltouEmISO === null, JSON.stringify(quedas));

    const r2 = await roda(RECONEXAO, kv);
    ok('reconexao cai no ramo connection', r2.body.kind === 'connection');
    const estado2 = JSON.parse(kv.store.get('sessao:estado') ?? '{}');
    ok('sessao:estado vira connected', estado2.status === 'connected', JSON.stringify(estado2));
    const quedas2 = JSON.parse(kv.store.get('sessao:quedas') ?? '[]');
    ok('queda fechada com hora de volta', quedas2.length === 1 && !!quedas2[0].voltouEmISO, JSON.stringify(quedas2));

    await roda(RECONEXAO, kv);
    const quedas3 = JSON.parse(kv.store.get('sessao:quedas') ?? '[]');
    ok('connected repetido nao inventa queda', quedas3.length === 1, JSON.stringify(quedas3));
  }

  // 2. messages_update -> entrega gravada pelo telefone certo
  {
    const { body, kv } = await roda(MESSAGES_UPDATE);
    ok('messages_update cai no ramo de entrega', body.kind === 'messages_update', JSON.stringify(body));
    ok('entrega:5521951014062 gravada', kv.store.has('entrega:5521951014062'),
      JSON.stringify([...kv.store.keys()]));
  }

  // 3. "Sent" não conta como entrega
  {
    const sent = { ...MESSAGES_UPDATE, state: 'Sent', event: { ...MESSAGES_UPDATE.event, Type: 'Sent' } };
    const { kv } = await roda(sent);
    ok('Sent nao vira entrega', ![...kv.store.keys()].some(k => k.startsWith('entrega:')),
      JSON.stringify([...kv.store.keys()]));
  }

  // 4. mensagem comum NÃO é comida pelos ramos de evento
  {
    const { res, body } = await roda(MENSAGEM);
    const txt = body.kind ?? body.raw;
    ok('messages segue para o fluxo de mensagem', txt === 'ignored' || body.kind === 'handoff_na_conversa',
      'status ' + res.status + ' body ' + JSON.stringify(body));
  }

  // 5. formato antigo (event como string) continua funcionando
  {
    const { body, kv } = await roda(CONNECTION_FORMATO_ANTIGO);
    ok('event como string ainda roteia', body.kind === 'connection', JSON.stringify(body));
    ok('estado gravado no formato antigo', !!kv.store.get('sessao:estado'));
  }

  console.log(falhas === 0 ? '\nTODOS OS CASOS PASSARAM' : '\n' + falhas + ' FALHA(S)');
  process.exit(falhas === 0 ? 0 : 1);
})();
