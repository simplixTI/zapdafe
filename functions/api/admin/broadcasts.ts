// Lists the recent devotional broadcasts with their progress data.
// Protected by the admin session (see functions/_middleware.ts).
// GET /api/admin/broadcasts → { items: [...] }

import type { Env } from '../../_shared/auth';

interface BroadcastStats {
  total: number;
  dispatched: number;
  failed: number;
  lastChatid: string | null;
  startedAtISO: string;
  updatedAtISO: string;
  finishedAtISO: string | null;
  chainError?: string;
  chainErrorAtISO?: string;
}

interface LaneStats extends BroadcastStats {
  messageId: string;
  lane: number;
  start: number;
  end: number;
  cursor: number;
}

/**
 * Quantos disparos o painel mostra. O painel lista os devocionais recentes;
 * mais que isso é histórico, que ninguém rola — e cada disparo custa uma
 * leitura de KV por faixa.
 */
const MAX_RUNS = 12;

/** A run is only finished when every one of its lanes is. */
function mergeLanes(lanes: LaneStats[]): BroadcastStats & { lanes: LaneStats[] } {
  const sorted = [...lanes].sort((a, b) => a.lane - b.lane);
  const allDone = sorted.every((l) => l.finishedAtISO);
  const finishedTimes = sorted.map((l) => l.finishedAtISO ?? '').filter(Boolean);
  const chainErrors = sorted
    .filter((l) => l.chainError)
    .map((l) => `faixa ${l.lane}: ${l.chainError}`);
  return {
    total: sorted.reduce((n, l) => n + l.total, 0),
    dispatched: sorted.reduce((n, l) => n + l.dispatched, 0),
    failed: sorted.reduce((n, l) => n + l.failed, 0),
    lastChatid: sorted[sorted.length - 1]?.lastChatid ?? null,
    startedAtISO: sorted.map((l) => l.startedAtISO).sort()[0] ?? '',
    updatedAtISO: sorted.map((l) => l.updatedAtISO).sort().reverse()[0] ?? '',
    finishedAtISO: allDone ? finishedTimes.sort().reverse()[0] ?? null : null,
    ...(chainErrors.length > 0 ? { chainError: chainErrors.join(' | ') } : {}),
    lanes: sorted,
  };
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { env } = context;
  const byId = new Map<string, {
    messageId: string;
    progress: BroadcastStats | null;
    legacyLog: unknown | null;
    dedupSeen: boolean;
  }>();

  const upsert = (messageId: string, patch: Partial<{ progress: BroadcastStats; legacyLog: unknown; dedupSeen: boolean }>) => {
    const cur = byId.get(messageId) ?? { messageId, progress: null, legacyLog: null, dedupSeen: false };
    byId.set(messageId, { ...cur, ...patch });
  };

  // 1. Lane records (current format) — each run has one per lane, merged here
  //
  // ⚠️ O `limit: 200` daqui era uma bomba com data marcada, encontrada em
  // 2026-11-09 com 170 faixas no KV. São 6 faixas por disparo (a base cresceu
  // de 235 para 544 contatos) com TTL de 30 dias, ou seja ~180 em regime, e
  // subindo. A lista do KV é alfabética e a data está no nome da chave, então
  // ao passar de 200 o que vinha era as 200 MAIS ANTIGAS: os disparos recentes
  // sumiriam do painel, e o sintoma seria exatamente "o devocional parou".
  //
  // Agora lista tudo paginando, agrupa pelo messageId lido do PRÓPRIO NOME da
  // chave — sem ler valor nenhum — e só então busca as faixas dos disparos mais
  // recentes. De passagem resolve a lentidão: eram 170 leituras de KV em série,
  // hoje são ~60 em paralelo.
  {
    const PREFIXO = 'broadcast:lane:';
    const chaves: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await env.KV.list({ prefix: PREFIXO, cursor });
      for (const k of page.keys) chaves.push(k.name);
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    // `broadcast:lane:<messageId>:<faixa>` — o último trecho é o número da
    // faixa, o resto é o messageId.
    const porRun = new Map<string, string[]>();
    for (const nome of chaves) {
      const resto = nome.slice(PREFIXO.length);
      const corte = resto.lastIndexOf(':');
      if (corte <= 0) continue;
      const messageId = resto.slice(0, corte);
      porRun.set(messageId, [...(porRun.get(messageId) ?? []), nome]);
    }

    // O messageId termina no timestamp do disparo, então ordenar por ele é
    // ordenar por data. Formato inesperado cai para 0 e vai para o fim, em vez
    // de bagunçar a ordem toda.
    const carimbo = (messageId: string) => Number(messageId.split(':').pop()) || 0;
    const recentes = [...porRun.entries()]
      .sort((a, b) => carimbo(b[0]) - carimbo(a[0]) || b[0].localeCompare(a[0]))
      .slice(0, MAX_RUNS);

    for (const [messageId, nomes] of recentes) {
      const brutos = await Promise.all(nomes.map((n) => env.KV.get(n)));
      const lanes: LaneStats[] = [];
      for (const raw of brutos) {
        if (!raw) continue;
        try {
          const lane = JSON.parse(raw) as LaneStats;
          if (lane.messageId) lanes.push(lane);
        } catch { /* ignore */ }
      }
      if (lanes.length > 0) upsert(messageId, { progress: mergeLanes(lanes) });
    }
  }

  // 2. Single-chain progress (runs before the lane split) — kept so older
  //    broadcasts still show up in the panel
  {
    const listed = await env.KV.list({ prefix: 'broadcast:progress:', limit: 100 });
    for (const k of listed.keys) {
      const messageId = k.name.replace('broadcast:progress:', '');
      const raw = await env.KV.get(k.name);
      let progress: BroadcastStats | null = null;
      try { progress = raw ? JSON.parse(raw) as BroadcastStats : null; } catch { /* ignore */ }
      if (progress && !byId.get(messageId)?.progress) upsert(messageId, { progress });
    }
  }

  // 3. Legacy log — older format written at end of run only
  {
    const listed = await env.KV.list({ prefix: 'broadcast:log:', limit: 100 });
    for (const k of listed.keys) {
      const messageId = k.name.replace('broadcast:log:', '');
      const raw = await env.KV.get(k.name);
      let legacyLog: unknown = null;
      try { legacyLog = raw ? JSON.parse(raw) : null; } catch { legacyLog = raw; }
      upsert(messageId, { legacyLog });
    }
  }

  // 4. Dedupe keys — proof the handler was at least entered
  {
    const listed = await env.KV.list({ prefix: 'broadcast:sent:', limit: 100 });
    for (const k of listed.keys) {
      const messageId = k.name.replace('broadcast:sent:', '');
      upsert(messageId, { dedupSeen: true });
    }
  }

  const items = [...byId.values()].sort((a, b) => {
    const ta = a.progress?.startedAtISO ?? '';
    const tb = b.progress?.startedAtISO ?? '';
    return tb.localeCompare(ta);
  });

  return new Response(JSON.stringify({ count: items.length, items }, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
