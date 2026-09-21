// Worker do devocional. O webhook do Pages apenas enfileira o trabalho no KV;
// quem envia é este cron.
//
// Por que existe: dentro do Pages Functions não há como esperar entre um grupo
// e outro — `waitUntil()` morre em ~30s. Foi essa limitação que gerou o
// encadeamento de invocações, que esbarrou no limite de 16 hops Worker→Worker,
// que virou faixas paralelas, que quebraram na consistência eventual do KV.
// Três desenhos, três disparos incompletos (20/221, 160/221, 74/221).
//
// Um Cron Trigger tem 15 minutos de execução, então um grupo inteiro cabe numa
// invocação só. E como ele acorda minutos depois de o webhook ter escrito, a
// corrida de leitura-após-escrita deixa de existir.

import { sendText, type UazapiEnv } from '../../functions/_shared/uazapi-send';

export interface Env {
  KV: KVNamespace;
  AI_UAZAPI_BASE: string;
  AI_UAZAPI_TOKEN: string;
}

interface BroadcastJob {
  messageId: string;
  text: string;
  targets: string[];
}

interface GroupStats {
  messageId: string;
  lane: number;
  start: number;
  end: number;
  cursor: number;
  total: number;
  dispatched: number;
  failed: number;
  lastChatid: string | null;
  startedAtISO: string;
  updatedAtISO: string;
  finishedAtISO: string | null;
}

interface Queue {
  messageId: string;
  groups: number;
  nextGroupAtISO: string;
  createdAtISO: string;
}

// 6 conexões simultâneas por invocação: um lote de 10 vira 2 ondas de ~8s.
const BATCH_SIZE = 10;
// Espaçamento entre grupos, pedido do cliente — evita parecer disparo em massa.
const GROUP_INTERVAL_MIN = 10;

const QUEUE_KEY = 'broadcast:queue';
const jobKey = (id: string) => `broadcast:job:${id}`;
const laneKey = (id: string, lane: number) => `broadcast:lane:${id}:${lane}`;

const TTL_30D = 60 * 60 * 24 * 30;

function aiEnv(env: Env): UazapiEnv {
  return { UAZAPI_BASE: env.AI_UAZAPI_BASE, UAZAPI_TOKEN: env.AI_UAZAPI_TOKEN };
}

async function readJson<T>(env: Env, key: string): Promise<T | null> {
  const raw = await env.KV.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function saveGroup(env: Env, g: GroupStats): Promise<void> {
  await env.KV.put(laneKey(g.messageId, g.lane), JSON.stringify(g), { expirationTtl: TTL_30D });
}

/** Envia o que falta de um grupo, salvando progresso a cada lote. */
async function sendGroup(env: Env, job: BroadcastJob, group: GroupStats): Promise<void> {
  const uazapi = aiEnv(env);

  while (group.cursor < group.end) {
    const batchEnd = Math.min(group.cursor + BATCH_SIZE, group.end);
    const batch = job.targets.slice(group.cursor, batchEnd);

    await Promise.all(
      batch.map(async (chatid) => {
        try {
          await sendText(uazapi, chatid, job.text);
          group.dispatched += 1;
        } catch (err) {
          group.failed += 1;
          console.error(`envio para ${chatid} falhou:`, err instanceof Error ? err.message : String(err));
        }
        group.lastChatid = chatid;
      }),
    );

    // Progresso salvo lote a lote: se esta invocação morrer, o próximo tick
    // retoma exatamente daqui em vez de reenviar para quem já recebeu.
    group.cursor = batchEnd;
    group.updatedAtISO = new Date().toISOString();
    await saveGroup(env, group);
  }

  group.finishedAtISO = new Date().toISOString();
  await saveGroup(env, group);
}

export async function runDue(env: Env, now = Date.now()): Promise<string> {
  const queue = await readJson<Queue>(env, QUEUE_KEY);
  if (!queue) return 'nada na fila';

  if (now < Date.parse(queue.nextGroupAtISO)) {
    return `próximo grupo só às ${queue.nextGroupAtISO}`;
  }

  const job = await readJson<BroadcastJob>(env, jobKey(queue.messageId));
  if (!job) {
    await env.KV.delete(QUEUE_KEY);
    return `job ${queue.messageId} sumiu do KV (TTL?), fila limpa`;
  }

  // Primeiro grupo ainda não terminado
  let pending: GroupStats | null = null;
  for (let lane = 0; lane < queue.groups; lane++) {
    const g = await readJson<GroupStats>(env, laneKey(queue.messageId, lane));
    if (g && !g.finishedAtISO) {
      pending = g;
      break;
    }
  }

  if (!pending) {
    await env.KV.delete(QUEUE_KEY);
    return `disparo ${queue.messageId} concluído`;
  }

  await sendGroup(env, job, pending);

  const restam = pending.lane + 1 < queue.groups;
  if (restam) {
    const next: Queue = {
      ...queue,
      nextGroupAtISO: new Date(now + GROUP_INTERVAL_MIN * 60 * 1000).toISOString(),
    };
    await env.KV.put(QUEUE_KEY, JSON.stringify(next), { expirationTtl: TTL_30D });
  } else {
    await env.KV.delete(QUEUE_KEY);
  }

  return `grupo ${pending.lane}: ${pending.dispatched} enviados, ${pending.failed} falhas`;
}

/**
 * Confere se o Worker está de fato utilizável: KV acessível e credenciais da
 * Uazapi válidas. Sem isso, um secret errado só apareceria no próximo disparo
 * — tarde demais. Autenticado com o próprio token, então não revela nada a
 * quem já não o tivesse.
 */
async function health(env: Env, url: URL): Promise<Response> {
  const ok = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });

  if (url.searchParams.get('token') !== env.AI_UAZAPI_TOKEN) {
    return ok({ error: 'token nao confere' }, 401);
  }

  let kv = 'ok';
  try {
    await env.KV.get(QUEUE_KEY);
  } catch (err) {
    kv = `falhou: ${err instanceof Error ? err.message : String(err)}`;
  }

  let uazapi: string;
  try {
    const res = await fetch(`${env.AI_UAZAPI_BASE}/instance/status`, {
      headers: { token: env.AI_UAZAPI_TOKEN },
    });
    uazapi = res.ok ? 'ok' : `HTTP ${res.status}`;
  } catch (err) {
    uazapi = `falhou: ${err instanceof Error ? err.message : String(err)}`;
  }

  const queue = await readJson<Queue>(env, QUEUE_KEY);
  return ok({
    worker: 'zapdafe-broadcast',
    kv,
    uazapi,
    base: env.AI_UAZAPI_BASE,
    tokenChars: env.AI_UAZAPI_TOKEN.length,
    fila: queue ? { messageId: queue.messageId, grupos: queue.groups, proximoAsISO: queue.nextGroupAtISO } : null,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return health(env, url);
    return new Response('zapdafe-broadcast', { status: 200 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runDue(env)
        .then((r) => console.log(`[devocional] ${r}`))
        .catch((err) => console.error('[devocional] erro:', err instanceof Error ? err.message : String(err))),
    );
  },
};
