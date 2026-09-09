import type { Env } from './auth';
import type { UazapiChat, UazapiMessage } from './uazapi';
import { CUTOFF_MS } from './uazapi';

const TZ_OFFSET_MS = -3 * 60 * 60 * 1000;

export interface ArchivedContact {
  name: string;
  firstMsgAt: number;
  lastMsgAt: number;
  msgsIn: number;
  msgsOut: number;
}

export interface ArchiveDay {
  incoming: number;
  outgoing: number;
  startedConvos: number;
}

export interface ArchiveMeta {
  lastArchiveISO: string;
  highWaterMs: number;
  totalMessagesEver: number;
  totalContactsEver: number;
}

export interface ArchiveData {
  contacts: Record<string, ArchivedContact>;
  days: Record<string, ArchiveDay>;
  hourly: number[][];
  meta: ArchiveMeta;
}

function brasiliaDateKey(ms: number): string {
  const shifted = new Date(ms + TZ_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const mo = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

function chatIdIsUser(id: string): boolean {
  return id.endsWith('@s.whatsapp.net');
}

function emptyHourly(): number[][] {
  return Array.from({ length: 7 }, () => Array<number>(24).fill(0));
}

export async function readArchive(env: Env): Promise<ArchiveData> {
  const [contactsRaw, daysRaw, hourlyRaw, metaRaw] = await Promise.all([
    env.KV.get('arch:contacts'),
    env.KV.get('arch:days'),
    env.KV.get('arch:hourly'),
    env.KV.get('arch:meta'),
  ]);
  return {
    contacts: contactsRaw ? JSON.parse(contactsRaw) : {},
    days: daysRaw ? JSON.parse(daysRaw) : {},
    hourly: hourlyRaw ? JSON.parse(hourlyRaw) : emptyHourly(),
    meta: metaRaw
      ? JSON.parse(metaRaw)
      : { lastArchiveISO: '', highWaterMs: 0, totalMessagesEver: 0, totalContactsEver: 0 },
  };
}

/**
 * Merges new Uazapi messages into the archive. Idempotent: uses a
 * high-water timestamp so re-runs skip already-archived messages.
 */
export async function runArchive(
  env: Env,
  messages: UazapiMessage[],
  chats: UazapiChat[],
): Promise<ArchiveData> {
  const archive = await readArchive(env);

  const chatByJid = new Map<string, UazapiChat>();
  for (const c of chats) {
    const jid = (c.wa_chatid as string | undefined) ?? c.id;
    chatByJid.set(jid, c);
  }

  const highWater = archive.meta.highWaterMs || 0;
  let newHighWater = highWater;
  let newMessages = 0;

  for (const m of messages) {
    if (!chatIdIsUser(m.chatid)) continue;
    if (m.isGroup) continue;
    if (m.messageTimestamp < CUTOFF_MS) continue;
    if (m.messageTimestamp <= highWater) continue;

    if (m.messageTimestamp > newHighWater) newHighWater = m.messageTimestamp;
    newMessages++;

    const contactId = m.chatid;
    const chatMeta = chatByJid.get(contactId);
    const derivedName = chatMeta?.lead_name || chatMeta?.wa_name || contactId.split('@')[0];

    const existing = archive.contacts[contactId];
    if (!existing) {
      archive.contacts[contactId] = {
        name: derivedName,
        firstMsgAt: m.messageTimestamp,
        lastMsgAt: m.messageTimestamp,
        msgsIn: m.fromMe ? 0 : 1,
        msgsOut: m.fromMe ? 1 : 0,
      };
    } else {
      if (m.messageTimestamp < existing.firstMsgAt) existing.firstMsgAt = m.messageTimestamp;
      if (m.messageTimestamp > existing.lastMsgAt) existing.lastMsgAt = m.messageTimestamp;
      if (m.fromMe) existing.msgsOut++;
      else existing.msgsIn++;
      if (derivedName && derivedName !== contactId.split('@')[0]) existing.name = derivedName;
    }

    // Days
    const dayKey = brasiliaDateKey(m.messageTimestamp);
    if (!archive.days[dayKey]) archive.days[dayKey] = { incoming: 0, outgoing: 0, startedConvos: 0 };
    if (m.fromMe) archive.days[dayKey].outgoing++;
    else archive.days[dayKey].incoming++;

    // Hourly heatmap (incoming only)
    if (!m.fromMe) {
      const shifted = new Date(m.messageTimestamp + TZ_OFFSET_MS);
      const day = shifted.getUTCDay();
      const hour = shifted.getUTCHours();
      archive.hourly[day][hour]++;
    }
  }

  // Recompute startedConvos per day from contacts' firstMsgAt
  for (const key of Object.keys(archive.days)) archive.days[key].startedConvos = 0;
  for (const c of Object.values(archive.contacts)) {
    const key = brasiliaDateKey(c.firstMsgAt);
    if (!archive.days[key]) archive.days[key] = { incoming: 0, outgoing: 0, startedConvos: 0 };
    archive.days[key].startedConvos++;
  }

  archive.meta = {
    lastArchiveISO: new Date().toISOString(),
    highWaterMs: newHighWater,
    totalMessagesEver: (archive.meta.totalMessagesEver || 0) + newMessages,
    totalContactsEver: Object.keys(archive.contacts).length,
  };

  await Promise.all([
    env.KV.put('arch:contacts', JSON.stringify(archive.contacts)),
    env.KV.put('arch:days', JSON.stringify(archive.days)),
    env.KV.put('arch:hourly', JSON.stringify(archive.hourly)),
    env.KV.put('arch:meta', JSON.stringify(archive.meta)),
  ]);

  return archive;
}

/**
 * Returns true if archive hasn't run in the last N hours.
 */
export function archiveIsStale(meta: ArchiveMeta, maxAgeHours = 6): boolean {
  if (!meta.lastArchiveISO) return true;
  const ageMs = Date.now() - Date.parse(meta.lastArchiveISO);
  return ageMs > maxAgeHours * 60 * 60 * 1000;
}
