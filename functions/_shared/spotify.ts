// Fetches tracks from a Spotify playlist via the public embed page.
// Spotify's Web API no longer serves user-playlist tracks under
// client-credentials auth (policy change late 2024), so we parse the
// server-rendered trackList from the embed HTML instead. No API key
// required, only the playlist ID.

import type { Env } from './auth';

export interface SpotifyEnv extends Env {
  SPOTIFY_PLAYLIST_ID: string;
}

export interface Track {
  name: string;
  artist: string;
  url: string;
}

const PLAYLIST_KV_KEY = (id: string) => `spotify:playlist:${id}`;
const PLAYLIST_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

interface EmbedTrack {
  uri?: string;
  title?: string;
  subtitle?: string;
}

async function fetchTracksFromEmbed(playlistId: string): Promise<Track[]> {
  const url = `https://open.spotify.com/embed/playlist/${playlistId}`;
  const res = await fetch(url, {
    headers: {
      // Any modern UA is fine — the embed page is public and doesn't require login
      'User-Agent':
        'Mozilla/5.0 (compatible; ZapdafeBot/1.0; +https://zapdafe.com.br)',
      Accept: 'text/html',
    },
  });
  if (!res.ok) {
    throw new Error(`spotify embed ${res.status}`);
  }
  const html = await res.text();

  // Extract the `trackList: [...]` JSON array from the embedded Next.js state.
  // We walk the string from the first "\"trackList\":[" and match balanced
  // brackets to survive nested arrays/objects.
  const key = '"trackList":';
  const start = html.indexOf(key);
  if (start < 0) return [];
  let i = start + key.length;
  while (i < html.length && html[i] !== '[') i++;
  if (i >= html.length) return [];
  const arrStart = i;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  const raw = html.slice(arrStart, i);
  let parsed: EmbedTrack[];
  try {
    parsed = JSON.parse(raw) as EmbedTrack[];
  } catch {
    return [];
  }

  return parsed
    .map((t): Track | null => {
      const uri = t.uri ?? '';
      const match = /^spotify:track:([A-Za-z0-9]+)$/.exec(uri);
      if (!match) return null;
      const spotifyId = match[1];
      return {
        name: (t.title ?? '').trim(),
        artist: (t.subtitle ?? '').trim(),
        url: `https://open.spotify.com/track/${spotifyId}`,
      };
    })
    .filter((t): t is Track => t !== null && !!t.name);
}

interface CachedPlaylist {
  fetchedAt: number;
  tracks: Track[];
}

/**
 * Returns the playlist tracks. Serves from KV cache (7-day TTL); on miss,
 * fetches the embed page and caches. Returns [] on any error so the
 * caller degrades gracefully (music suggestions just won't be offered).
 */
export async function getPlaylistTracks(env: SpotifyEnv): Promise<Track[]> {
  if (!env.SPOTIFY_PLAYLIST_ID) return [];
  const cachedRaw = await env.KV.get(PLAYLIST_KV_KEY(env.SPOTIFY_PLAYLIST_ID));
  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw) as CachedPlaylist;
      if (Array.isArray(cached.tracks) && cached.tracks.length > 0) return cached.tracks;
    } catch {/* re-fetch */}
  }
  try {
    const tracks = await fetchTracksFromEmbed(env.SPOTIFY_PLAYLIST_ID);
    if (tracks.length > 0) {
      const cached: CachedPlaylist = { fetchedAt: Date.now(), tracks };
      await env.KV.put(PLAYLIST_KV_KEY(env.SPOTIFY_PLAYLIST_ID), JSON.stringify(cached), {
        expirationTtl: PLAYLIST_TTL_SECONDS,
      });
    }
    return tracks;
  } catch (err) {
    console.error('spotify fetch error:', err instanceof Error ? err.message : String(err));
    return [];
  }
}

/**
 * Compact string listing tracks for the LLM prompt.
 * Format: "Nome — Artista • https://open.spotify.com/track/..."
 */
export function formatPlaylistForPrompt(tracks: Track[]): string | null {
  if (!tracks.length) return null;
  return tracks.map(t => `${t.name} — ${t.artist} • ${t.url}`).join('\n');
}
