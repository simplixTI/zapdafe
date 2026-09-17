# Zapdafé — Status do Projeto (2026-09-17)

Retomada rápida: leia esse arquivo primeiro pra saber exatamente onde paramos.

## Visão geral

Zapdafé é um companheiro cristão via WhatsApp: recebe mensagens, responde com tom carinhoso (não recita versos secos, conversa e usa a Bíblia como conforto), sugere música da playlist Spotify, e o cliente (`+55 21 99808-8003`) pode disparar devocional manual pra todos os contatos ativos.

## Stack

- **Frontend/Backend**: Astro + Cloudflare Pages Functions (edge runtime)
- **Storage**: Cloudflare Workers KV (namespace único, binding `KV`) + Supabase Postgres (pgvector)
- **LLM**: OpenAI GPT-4o-mini (chat) + text-embedding-3-small (RAG)
- **TTS**: ElevenLabs (voice_id fixo)
- **WhatsApp**: Uazapi (2 instâncias, ver abaixo)
- **Repo**: `simplixTI/zapdafe` — branch de produção é `feat/admin`

## Componentes deployados (todos em produção via `zapdafe.com.br`)

### 1. Admin dashboard (`/admin`, `/admin-login`)
Redesign completo com skeleton loading, sparklines de 30d das métricas totais, contagem animada, deltas hoje vs ontem, avatars hue-hash por chatid, live-dot pulsante, tabular numerals, custom scrollbar/selection, etc.

Seções da página: Totais acumulados → Sistema (custos OpenAI + saldo ElevenLabs) → Por período → Conversas com a IA → Picos por horário → Últimas atividades → Opt-outs.

- Login: senha em `ADMIN_PASSWORD`, sessão cookie httpOnly 7d
- Endpoints `/api/admin/*` protegidos pelo middleware
- `/api/admin/stats` — métricas Uazapi da instância **campanha360** (número antigo, ainda usado pra métricas)
- `/api/admin/optouts` — CRUD da lista de números opt-out
- `/api/admin/observability` — custo OpenAI (tokens contados dos usage returns), saldo ElevenLabs (via /v1/user), conversas recentes
- `/api/admin/broadcasts` — lista disparos do devocional com progresso

### 2. Bíblia RAG (Supabase pgvector)
- Projeto Supabase **Zapdafe** ref `rvpdulzkipkmwwglsgja`, region us-east-1
- Tabela `bible_verses` com 31.058 versos da **Almeida Corrigida** (todos 66 livros, Salmo 119 completo)
- Índice ivfflat lists=10 + RPC `match_bible_verses(query_embedding, threshold, count)`
- Scripts em `scripts/`: `parse-almeida.mjs` (extrai do PDF `bibilia.pdf`), `vectorize-bible.mjs` (batch de 100 embed + upsert)
- Lib `functions/_shared/bible-rag.ts`: `searchBibleVerses(env, query, {limit, threshold})` — funciona no edge

### 3. Webhook AI (`/api/uazapi/webhook`)
Recebe da instância Uazapi **luxprodutora**. Fluxo:
1. Auth via `?secret=` (query param) — Uazapi antigo não suporta custom header
2. Ignora fromMe, isGroup, wasSentByApi, reactions, emoji-only, opt-outs
3. Se sender = `DEVOTIONAL_TRIGGER_PHONE` → broadcast
4. Senão → conversation

**Conversation branch:**
- Carrega histórico (`conv:<chatid>`) — últimas 12 turns
- Carrega perfil (`contact:<chatid>`) — nome, first/lastSeen
- Se contato não tem perfil, checa `arch:contacts` (do admin) — herda nome de retornante
- Busca RAG (top 3, threshold 0.32)
- Busca playlist Spotify (cache 7d em `spotify:playlist:*`)
- Monta system prompt com 3 modos: primeira msg (apresenta + pede nome), retornante c/ nome, retornante s/ nome
- Regras rígidas no prompt: sem emoji nunca, sem reação, música SÓ da playlist Zapdafé
- GPT-4o-mini responde
- Se resposta tem link Spotify: separa em 2 mensagens (texto + link) pra WhatsApp renderizar cartão
- Se resposta >450 chars: TTS ElevenLabs em blocos por frase, fallback pra texto

**Broadcast branch:**
- Dedupe via `broadcast:sent:<messageId>` (evita re-entrega do Uazapi)
- Alvos: contatos com `lastMsgAt <30d` E não-optout, lidos do `arch:contacts`
- Envio fire-and-forget (não bloqueia CPU) com delay random 1-6s
- Checkpoint em `broadcast:progress:<messageId>` a cada 10 envios
- Log final em `broadcast:log:<messageId>` (compat com formato antigo)

### 4. Spotify (playlist "fenozap")
- Playlist ID: `1gIgyuj2MUkK8TsLHJtqRo` (69 tracks, playlist do cliente)
- **Não usa credenciais Spotify** — Web API bloqueou client-credentials pra playlists de usuário em nov/2024. Uso o embed público (`/embed/playlist/<id>`) e faço parse do `trackList` do HTML
- Cache em KV por 7d
- Injetado no system prompt como "Nome — Artista • URL" pra o LLM escolher

## Env vars em produção (Cloudflare Pages)

Todas marcadas como Secret / Encrypt.

| Nome | Valor / Observação |
|---|---|
| `ADMIN_PASSWORD` | senha do painel |
| `UAZAPI_TOKEN` | token da instância **campanha360** (admin/métricas antigas) |
| `UAZAPI_BASE` | `https://campanha360.uazapi.com` |
| `BUBBLE_BEARER` | (legado do bubble) |
| `AI_UAZAPI_BASE` | `https://luxprodutora.uazapi.com` |
| `AI_UAZAPI_TOKEN` | `68ec598a-cca7-491a-8025-ab9c0e865691` (rotacionar) |
| `AI_WEBHOOK_SECRET` | `31d18d783db84783b72b36674062a196f9da33483493c2fd79c8a4a0ff7b26a9` |
| `OPENAI_API_KEY` | `sk-proj-...` (rotacionar — apareceu no chat) |
| `SUPABASE_URL` | `https://rvpdulzkipkmwwglsgja.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGciOi...` (service_role) |
| `BIBLE_RAG_ENABLED` | `true` |
| `ELEVENLABS_API_KEY` | ⚠️ **valor atual é o ID da chave, não a chave** — precisa trocar por uma `sk_...` |
| `ELEVENLABS_VOICE_ID` | `Lo3nuVZKTfiOvJvov8W7` |
| `DEVOTIONAL_TRIGGER_PHONE` | `5521998088003` |
| `SPOTIFY_PLAYLIST_ID` | `1gIgyuj2MUkK8TsLHJtqRo` |

## Config do webhook no Uazapi (instância luxprodutora)

- URL: `https://zapdafe.com.br/api/uazapi/webhook?secret=<AI_WEBHOOK_SECRET>`
- Method: POST
- Escutar: `messages`
- Excluir: `wasSentByApi`, `isGroupYes`

## Regras de comportamento (system prompt do LLM)

- Tom: **companheiro carinhoso, parceiro**, português BR contemporâneo, frases curtas
- Nunca emoji, nunca reação, nunca CAPS
- Bíblia como ferramenta de conforto — primeiro escuta, valida sentimento, só então (se fizer sentido) traz um verso com contexto e ternura
- Se crise séria (autoextermínio, violência, urgência) → acolhe + CVV 188 ou 190/192
- Se não sabe, diz que não sabe
- Primeira msg: apresenta como Zapdafé + pergunta primeiro nome
- Retornante c/ nome: chama pelo nome com naturalidade (não em toda msg)
- Retornante s/ nome: pergunta com jeito em algum momento
- Música SÓ da playlist Zapdafé (nunca inventa) — se não achar uma que caiba, diz com carinho

## O que está PENDENTE

1. **ElevenLabs API key errada** — usuário precisa criar uma nova em https://elevenlabs.io/app/settings/api-keys (formato `sk_...`) e atualizar `ELEVENLABS_API_KEY` no CF. Sem isso, voz cai em fallback silencioso de texto e card do admin mostra HTTP 400.
2. **Broadcast reliability** — usuário reportou que um disparo pra 200 contatos parou depois de 10-15 msgs (antes do fix `e03b095`). Novo código tem delay random 1-6s + fire-and-forget + checkpoint em KV. Se travar de novo, migrar pra Cloudflare Queues ou chunking recursivo.
3. **Admin ainda lê da campanha360** — as métricas de "Pessoas atendidas / Mensagens trocadas" vêm da instância antiga. Se quiser unificar, migrar `functions/api/admin/stats.ts` pra ler da luxprodutora (ou somar as duas).
4. **RAG bíblia**: alguns versos podem diferir de contagem canônica em ±0.2% (Almeida vs KJV varia levemente). Aceitável pro uso RAG.

## Comandos úteis

```bash
# Dev local (Astro apenas — Functions não rodam sem wrangler)
astro dev --background
astro dev stop
astro dev logs

# Reparse da bíblia (raramente)
node scripts/parse-almeida.mjs --out data/bible-verses.json

# Revetorizar (só se trocar de bíblia ou modelo)
OPENAI_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/vectorize-bible.mjs --input data/bible-verses.json

# Ver progresso de broadcast em produção
# → https://zapdafe.com.br/api/admin/broadcasts (logado em /admin)

# Ver saldo/custos
# → https://zapdafe.com.br/api/admin/observability
```

## Últimos commits em feat/admin

Ordem cronológica (mais recente por último — ver `git log --oneline`):
- `feat(admin): redesign com skeleton, sparklines reais, contagem animada e cromo temático`
- `feat(rag): bíblia RAG com Supabase pgvector + OpenAI embeddings`
- `feat(ai): webhook AI + broadcast devocional + voz ElevenLabs`
- `feat(ai): aceita webhook secret via query param`
- `feat(ai): primeira mensagem carinhosa + memória de nome + reconhece retornantes`
- `fix(ai): ignora reações WhatsApp e mensagens só-emoji`
- `feat(ai): indicações de música da playlist Zapdafé no Spotify`
- `fix(ai): trava sugestão de música só na playlist + separa link em mensagem própria`
- `fix(broadcast): delay random 1-6s + fire-and-forget + progresso em KV`
- `feat(admin): endpoint /api/admin/broadcasts`
- `feat(admin): cards de custo OpenAI/ElevenLabs + tabela de conversas com a IA`
