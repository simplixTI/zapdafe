# Zapdafé — Status do Projeto (2026-09-21)

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

Seções da página, nesta ordem: Totais acumulados → Por período → Sistema (custos OpenAI + saldo ElevenLabs) → Conversas com a IA → Picos por horário → Devocionais enviados → Cérebro → Opt-outs.

A seção "Últimas atividades" foi removida em 2026-09-19 a pedido do cliente. Junto com ela saiu o botão "Marcar opt-out" por contato, que só existia naquela tabela — hoje só dá pra marcar opt-out digitando o número na seção Opt-outs. `/api/admin/stats` continua devolvendo o campo `recent`, que ninguém mais consome.

- Login: senha em `ADMIN_PASSWORD`, sessão cookie httpOnly 7d
- Endpoints `/api/admin/*` protegidos pelo middleware
- `/api/admin/stats` — métricas Uazapi da instância **campanha360** (número antigo, ainda usado pra métricas)
- `/api/admin/optouts` — CRUD da lista de números opt-out
- `/api/admin/rules` — CRUD do cérebro (respostas automáticas + instruções da IA)
- `/api/admin/contact-name` — lê e corrige o primeiro nome de um contato
- `/api/admin/observability` — custo OpenAI (tokens contados dos usage returns), saldo ElevenLabs (via /v1/user), conversas recentes
- `/api/admin/broadcasts` — lista disparos do devocional com progresso

### 2. Bíblia RAG (Supabase pgvector)
- Projeto Supabase **Zapdafe** ref `rvpdulzkipkmwwglsgja`, region us-east-1
- Tabela `bible_verses` com 31.058 versos da **Almeida Corrigida** (todos 66 livros, Salmo 119 completo)
- Índice ivfflat lists=10 + RPC `match_bible_verses(query_embedding, threshold, count)`
- Scripts em `scripts/`: `parse-almeida.mjs` (extrai do PDF `bibilia.pdf`), `vectorize-bible.mjs` (batch de 100 embed + upsert)
- Lib `functions/_shared/bible-rag.ts`: `searchBibleVerses(env, query, {limit, threshold})` — funciona no edge

### 3. Endpoints de disparo do devocional

**POST `/api/admin/broadcast-trigger`** — dispara devocional manualmente sem precisar do número gatilho. Body: `{ text: string }`. Auth: session cookie ou `Authorization: Bearer <ADMIN_PASSWORD>`. Útil para reenvios.

O `/api/admin/broadcast-resume` **foi removido** em 2026-09-20 junto com a máquina de encadeamento. Não é mais necessário: se um grupo falhar no meio, o próximo tick do cron retoma sozinho do cursor salvo.

**Como o disparo funciona agora:** o webhook (ou o broadcast-trigger) apenas **enfileira** no KV — grava `broadcast:job:<messageId>`, um registro por grupo em `broadcast:lane:<messageId>:<lane>` e a chave `broadcast:queue` — e responde na hora, sem enviar nada. O Worker (`worker/src/index.ts`) acorda de 5 em 5 minutos, vê se chegou a hora do próximo grupo, envia e agenda o seguinte para dali a 10 minutos.

⚠️ O formato desses três registros é **contrato entre o Pages e o Worker**. Mudar um lado sem o outro faz o devocional parar de sair em silêncio. Existe um teste de integração ponta a ponta para isso (ver "Como testar mudança sem framework de teste").

### 4. Webhook AI (`/api/uazapi/webhook`)
Recebe da instância Uazapi **luxprodutora**. Fluxo:
1. Auth via `?secret=` (query param) — Uazapi antigo não suporta custom header
2. Ignora fromMe, isGroup, wasSentByApi, reactions, emoji-only
3. Se sender = `DEVOTIONAL_TRIGGER_PHONE` → broadcast
4. Senão → camada de respostas rápidas (ver abaixo) e, se nada casar, conversation

**Conversation branch:**
- Carrega histórico (`conv:<chatid>`) — últimas 12 turns
- Carrega perfil (`contact:<chatid>`) — nome, first/lastSeen
- Se contato não tem perfil, checa `arch:contacts` (do admin) — herda nome de retornante
- **Todo nome passa por `plausibleFirstName`** antes de ser usado (ver "Validação do nome")
- Busca RAG (top 3, threshold 0.32)
- Busca playlist Spotify (cache 7d em `spotify:playlist:*`)
- Monta system prompt com 3 modos: primeira msg (apresenta + pede nome), retornante c/ nome, retornante s/ nome
- Regras rígidas no prompt: sem emoji nunca, sem reação, música SÓ da playlist Zapdafé
- GPT-4o-mini responde
- Se resposta tem link Spotify: separa em 2 mensagens (texto + link) pra WhatsApp renderizar cartão
- Se resposta **>455 chars**: TTS ElevenLabs. Cada áudio vai até 1200 caracteres (`VOICE_CHUNK_MAX`), bem acima do gatilho de propósito — se os dois fossem iguais, uma resposta de 500 caracteres viraria dois áudios. Na prática a resposta típica sai num áudio só. **Se o TTS falhar, cada bloco vira uma mensagem de texto separada**, que é o sintoma de resposta picotada quando a chave do ElevenLabs está errada
- `splitSentences()` quebra só em fim de frase de verdade. Na dúvida NÃO quebra: trecho maior é inofensivo, frase partida ao meio não é. Não corta em abreviação ("Pr. Everaldo", "Sra. Maria"), inicial solta ("J. Silva"), número ("1.500"), reticências no meio da frase, nem ponto seguido de minúscula (`'ele disse "..." e isso me acalmou'`). A versão anterior cortava em todo ponto final, inclusive dentro de aspas, e ainda comia dois pontos das reticências

**Broadcast branch** (só enfileira — quem envia é o Worker):
- Dedupe via `broadcast:sent:<messageId>` (evita re-entrega do Uazapi)
- Alvos: contatos com `lastMsgAt <90d` E não-optout, lidos do `arch:contacts`
- Divide em **3 grupos** contíguos e grava job + registros de grupo + `broadcast:queue`. Nenhuma mensagem sai daqui
- O Worker manda um grupo a cada **10 minutos**, em lotes de 10, salvando progresso lote a lote

**Limites da Cloudflare que explicam por que é assim** (medidos nos disparos de 18 a 20/09):
- 6 conexões simultâneas por invocação → lote de 10 = 2 ondas ≈ 17s
- `waitUntil()` ≈ 30s no Pages → matou o 1º desenho em 20/221
- **16 invocações Worker→Worker por cadeia** (header `CF-EW-Via`, erro 1019) → matou o 2º em exatamente 160/221
- **KV é eventualmente consistente** → matou o 3º em 74/221: os workers das faixas 1 e 2 nasceram 1s depois da escrita, leram `null` e saíram em silêncio
- Cron Trigger: **15 minutos** de execução e 30s de CPU (envio é espera de rede, quase não gasta CPU) → é o que torna o desenho atual possível, sem teto prático de contatos

**Respostas rápidas (antes de chamar a IA), na ordem:**
1. Já é opt-out → silêncio total
2. Comando `/sair` ou `/parar` (com ou sem barra) → entra na lista de opt-out + confirmação fixa
3. Linguagem ambígua de saída ("não quero mais receber", "descadastra") → **não** opta sozinho, só orienta a digitar o comando
4. Regra do cérebro (gatilho exato) → resposta fixa, sem gastar token
5. Nada disso → conversa normal com a IA

### 5. Cérebro — regras geridas pelo cliente no `/admin`
Seção "Cérebro" no painel, guardada em `rules:brain` no KV. Duas partes:
- **Respostas automáticas**: gatilho (mensagem inteira, ignorando acento/caixa/pontuação) → resposta fixa. Aceita `{nome}`, que vira o primeiro nome do contato (sem nome, o placeholder e a vírgula somem). Já vem semeada com a regra do "amém"
- **Instruções para a IA**: texto livre que entra no system prompt de toda conversa. Não sobrescreve as regras de emoji, crise (CVV 188) ou música só da playlist

Endpoint: `GET/POST /api/admin/rules` (`action`: `add` | `remove` | `instructions`).

### 6. Validação do nome do contato (`functions/_shared/names.ts`)

`plausibleFirstName(raw)` devolve um primeiro nome confiável ou `null`. Usado nos **quatro** pontos onde um nome entra: `arch:contacts`, perfil salvo, extração pelo LLM (`extractName`) e resposta por regra do cérebro.

Como funciona: remove emoji, símbolos e o `~` que o WhatsApp prefixa; pega a primeira palavra; rejeita se tiver menos de 2 ou mais de 20 letras, se não for só letras, ou se estiver na lista de não-nomes (`sou`, `eu`, `deus`, `dona`, `pastor`, `vendas`, `contato`…). Hífen é preservado, então "Ana-Clara" continua inteiro.

**Roda na leitura, não só na gravação** — de propósito. Perfis gravados antes dessa trava ainda têm lixo salvo, e revalidar na leitura aposenta esses registros sem migração: a IA simplesmente volta a perguntar o nome.

**Por que existe** (incidente de 2026-09-19): a contato `+55 49 99820-8611` tem nome de exibição `~Sou Eu 🌞`. O código pegava `name.split(/\s+/)[0]` e gravava "Sou" como primeiro nome dela. A IA passou a usar "Sou" como vocativo e, ao responder "Deus é bom o tempo todo" com "realmente, sou.", pareceu estar **afirmando ser Deus**. A segunda ocorrência ("isso é muito doloroso, sou.") confirmou que era vocativo, não teologia. O nome verdadeiro dela é **Cleonice** — informado em 03/09 ao sistema antigo, que não migrou.

Cuidado ao mexer: a primeira versão da trava rejeitava o nome inteiro ao encontrar emoji, o que tirava o nome de `Drika 🦋` e `Vitória 🌻`, que são nomes legítimos com enfeite. Emoji não é sinal de nome ruim — a palavra é.

**Segundo incidente, 2026-09-20 — "Pastor Everaldo".** O contato `+55 22 99822-5733` escreveu "Oi Pastor Everaldo, gostaria de receber as mensagens" e o `extractName` gravou "Everaldo" como nome dele. O nome verdadeiro é **Toninho**. Diferente do caso "Sou", aqui "Everaldo" é um nome perfeitamente válido, então a trava de palavras não pegava. Como o projeto é conhecido pelo nome do pastor, é provável que vários perfis tenham sido contaminados do mesmo jeito.

Três camadas resolvem:
1. `OWN_NAMES` — "everaldo" e "zapdafe" nunca são aceitos como nome de contato. Custo assumido: um contato realmente chamado Everaldo perde o nome, o que é bem melhor que chamar todo mundo de Everaldo
2. `namedAsSomeoneElse(texto, nome)` — rejeita nome que aparece depois de cumprimento ou título ("Oi Pastor X", "bom dia Maria", "pelo pastor Carlos"). Não dispara em apresentação real ("Oi, meu nome é Toninho")
3. Prompt do `extractName` reescrito, deixando explícito que queremos o nome de QUEM ESCREVEU e dando exemplos de vocativo que devem devolver NENHUM

**Contexto interno — NÃO vai no prompt** (definido pelo cliente em 2026-09-20): o Zap da Fé é apadrinhado pelo Pastor Everaldo, e é por isso que tanta gente cumprimenta o projeto pelo nome dele. Essa relação é informação interna: o cliente pediu explicitamente que a IA **não conte isso a ninguém**. O prompt só carrega o comportamento — não fazer disso um assunto, não explicar nada a respeito, nunca dizer que é o pastor, e se perguntarem diretamente responder apenas que ali é o Zapdafé.

**Exceção, definida pelo cliente:** "Everaldo" **é** aceito como nome de contato quando a pessoa está respondendo a uma pergunta direta sobre o nome dela. `looksLikeNameQuestion()` olha a última fala da IA no histórico; se foi um pedido de nome, o `plausibleFirstName` recebe `allowOwnNames: true`. Fora desse contexto, quem escreve "Everaldo" está se referindo ao pastor. A checagem de vocativo continua valendo mesmo aí — "Bom dia Everaldo" logo após a pergunta ainda é cumprimento, não resposta.

### 7. Spotify (playlist "fenozap")
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

## Link de captação — `zapdafe.com.br/mensagem`

**Não está no repositório.** É uma Redirect Rule 301 no painel da Cloudflare (não há `_redirects` nem redirect no `astro.config.mjs`). Destino atual:

```
https://api.whatsapp.com/send/?phone=552123427056&text=Oi%20pastor%20Everaldo!%0A%20%20%20Gostaria%20de%20receber%20as%20mensagens!
```

Três coisas descobertas em 2026-09-20:

1. **O texto pré-preenchido é a origem do bug do nome.** Toda pessoa que entra por esse link manda "Oi pastor Everaldo! Gostaria de receber as mensagens!" como primeira mensagem — não foi um contato digitando isso, é o link. Por isso o problema do "Everaldo" era sistêmico, não pontual. A trava em `names.ts` segura, mas a origem segue lá. Sugestão pendente: trocar por algo sem nome próprio, tipo "Oi! Gostaria de receber as mensagens do Zap da Fé!"
2. **"Fé no Zap" é o nome do perfil do WhatsApp** do número 21 2342-7056, não está em código nenhum. Trocar pra "Zap da Fé" no WhatsApp Business (Configurações → Perfil da empresa → Nome) ou pela API da Uazapi.
3. **O número 21 2342-7056 está correto** (confirmado pelo cliente) e é diferente do número do gatilho do devocional (21 99808-8003), que é outra coisa mesmo.

## Config do webhook no Uazapi (instância luxprodutora)

- URL: `https://zapdafe.com.br/api/uazapi/webhook?secret=<AI_WEBHOOK_SECRET>`
- Method: POST
- Escutar: `messages`
- Excluir: `wasSentByApi`, `isGroupYes`

## Regras de comportamento (system prompt do LLM)

- Tom: **companheiro carinhoso, parceiro**, português BR contemporâneo, frases curtas
- Nunca emoji, nunca reação, nunca CAPS
- **Ortografia correta, toda frase começando com maiúscula.** Regra adicionada em 2026-09-19: o prompt só dizia "não escreve em CAIXA ALTA" e, somado a "sem formalidade excessiva", o GPT-4o-mini passou a responder tudo em minúsculas ("sinto muito que você esteja sentindo essa dor."). Agora o prompt separa explicitamente as duas coisas — informal é o tom, não a grafia
- Bíblia como ferramenta de conforto — primeiro escuta, valida sentimento, só então (se fizer sentido) traz um verso com contexto e ternura
- Se crise séria (autoextermínio, violência, urgência) → acolhe + CVV 188 ou 190/192
- Se não sabe, diz que não sabe
- Primeira msg: apresenta como Zapdafé + pergunta primeiro nome
- Retornante c/ nome: chama pelo nome com naturalidade (não em toda msg)
- Retornante s/ nome: pergunta com jeito em algum momento
- Música SÓ da playlist Zapdafé (nunca inventa) — se não achar uma que caiba, diz com carinho

## O que está PENDENTE

1. **ElevenLabs** — ✅ RESOLVIDO em 2026-09-20. A voz está ativa: conta **pro**, 600.164 caracteres.

   **Causa raiz, que demorou a aparecer:** o valor em `ELEVENLABS_API_KEY` era o **ID da chave**, não a chave. Na tela de API keys do ElevenLabs, o ⓘ ao lado do nome mostra o ID (64 caracteres hexadecimais, sem prefixo) e é fácil copiá-lo por engano; a chave de verdade começa com **`sk_`** e só é exibida **uma vez**, na janela que abre ao criar. Na lista ela aparece sempre mascarada (`••••••b540`), então não dá pra conferir o prefixo por lá.

   Sintomas que despistaram: o ElevenLabs devolve **400** para chave malformada (chave errada mas bem formada daria 401), e o cliente chegou a comprar mais saldo achando que era isso. Também não era deploy nem ambiente.

   **O que destravou:** o card do admin passou a informar o *formato* da chave configurada — `NÃO começa com sk_ (64 chars)` — sem expor o valor. Isso transformou três rodadas de adivinhação em um diagnóstico de um segundo. Vale manter essa ideia para qualquer credencial futura.

   ⚠️ Pendência pequena: a chave em uso passou pelo chat durante o diagnóstico. Vale criar outra e desativar essa quando der.
2. **Broadcast reliability — AINDA QUEBRADO, e é a pendência mais urgente.** Histórico dos três desenhos:
   - **2026-09-18**, tudo num `waitUntil`: morreu no teto de 30s, 20/221 entregues
   - **2026-09-19**, cadeia linear de chunks: morreu no limite de 16 hops, 160/221 entregues (61 sem receber)
   - **2026-09-20**, 3 faixas paralelas: **74/221 entregues (147 sem receber)**. A faixa 0 rodou perfeita (74/74, zero falhas, 107s). As faixas 1 e 2 **nunca enviaram nada** — `updatedAtISO` igual ao `startedAtISO`, cursor parado no início, e nenhum `chainError`

   **Causa do de hoje: KV é eventualmente consistente.** O worker do setup grava job e faixas no KV e dispara as faixas 1 e 2 em workers novos no mesmo segundo. Esses workers leem os registros de volta, recebem `null`, e o `runChunk` sai no `if (!jobRaw || !laneRaw) return;` — em silêncio. A faixa 0 escapou porque rodou dentro do mesmo worker que escreveu (lê a própria escrita) e só encadeou 13s depois. Agravante: o `recordChainError` também lê o registro antes de gravar, com o mesmo `if (!raw) return`, então uma falha real também sairia silenciosa.

   Lição: os testes de faixa passaram em 9 cenários com KV falso, onde escrita e leitura são instantâneas — justamente o comportamento que importava não estava modelado.

   Os 147 que faltaram foram **reenviados manualmente pelo cliente** em 2026-09-20 via `broadcast-resume`, fechando o dia em 221/221.

   **Desenho decidido (ideia do cliente, 2026-09-20): 3 grupos com 10 minutos de intervalo, num Worker separado com Cron Trigger.** Não dá pra fazer no Pages Functions porque não existe como esperar 10 minutos ali (`waitUntil` tem teto de 30s — é essa limitação que gerou o encadeamento, que gerou o limite de hops, que gerou as faixas, que gerou a corrida com o KV). Cron Trigger tem **15 minutos de execução** e 30s de CPU (envio é espera de rede, quase não gasta CPU), então um grupo de 74 contatos (~107s) cabe folgado. O webhook só grava o trabalho no KV e responde; o Worker acorda de 5 em 5 minutos, vê se chegou a hora do próximo grupo, envia e agenda o seguinte. Some o encadeamento, some o limite de 16 hops, some a corrida (o cron roda minutos depois da escrita) e some o pico de 18 conexões. Custo: segundo alvo de deploy, `wrangler login` ou deploy no CI.

   **Estado: ✅ NO AR e verificado em 2026-09-20.** Worker `zapdafe-broadcast` deployado (cron `*/5 * * * *`), secrets conferidos, e o lado do Pages trocado para só enfileirar. `runChunk`, `chainNext`, `recordChainError` e o endpoint `broadcast-resume` foram apagados. **Falta só a validação no primeiro disparo real.**

   **Health check — use sempre que mexer no Worker:**
   ```
   https://zapdafe-broadcast.brucnascimento.workers.dev/health?token=<AI_UAZAPI_TOKEN>
   ```
   Devolve `kv`, `uazapi`, a `base` configurada, `tokenChars` e a fila atual. Autenticado com o próprio token, então não expõe nada a quem já não o tivesse.

   ⚠️ **Por que ele existe, e a lição junto:** ao configurar os secrets pela primeira vez, o prompt interativo do `wrangler secret put` gravou `AI_UAZAPI_BASE` como `uu\x16ndefinedndefined` — o `\x16` é o código do **Ctrl+V**, que o terminal inseriu como caractere em vez de colar. O `wrangler secret list` só mostra nomes, então nada denunciaria isso: o devocional simplesmente falharia com "Invalid URL" no dia seguinte.

   Pior: o secret quebrado exibiu **20 asteriscos** e pareceu certo, enquanto o que exibiu **1 asterisco** e levantou suspeita estava correto. O visual do prompt não serve para nada. **Sempre configure secret por stdin** — `"valor" | npx wrangler secret put NOME` — e confirme no `/health`.

   Detalhes do que foi: Código em `worker/` (`wrangler.toml` + `src/index.ts`). Ele lê o mesmo namespace KV do Pages e mantém o formato `broadcast:lane:<messageId>:<lane>`, então o painel continua funcionando sem mudança. Progresso é salvo **a cada lote de 10**, então se a invocação morrer no meio o próximo tick retoma do cursor (perda máxima: os 10 do lote em voo, que podem duplicar).

   Para mexer no Worker depois: `cd worker`, `npx wrangler deploy`. Os secrets `AI_UAZAPI_BASE` e `AI_UAZAPI_TOKEN` são do Worker e ficam separados dos do Pages — mudou num lado, tem que mudar no outro
3. **Métricas migradas pra luxprodutora** — FEITO em 2026-09-20. `stats.ts` e `/api/admin/archive` agora leem da **luxprodutora** (`aiCreds`). O painel mostrava "Hoje: 0 mensagens" estando correto: a campanha360 realmente não tinha tráfego, porque toda conversa da IA acontece na outra instância.

   **Os contatos da campanha360 são backlog, não lixo** (instrução do cliente): *"salva esse número que era do campanha como backlog, pois existem de verdade essas pessoas"*. Isso é atendido sem precisar copiar nada: `runArchive` **mescla** em vez de substituir, então os 221 contatos e as 7.882 mensagens que já estão em `arch:contacts` continuam lá e a luxprodutora vai somando por cima, pra sempre.

   ⚠️ **A armadilha que isso escondia:** o arquivo usava **um** `highWaterMs` para pular mensagem já processada. Ao trocar a fonte, toda mensagem da lux anterior ao último registro da campanha360 seria descartada **em silêncio** — o painel pareceria funcionar e simplesmente não somaria nada. Por isso `ArchiveMeta` ganhou `highWaterBySource`, um marcador por instância. O `highWaterMs` antigo fica congelado no valor da campanha360, que é backlog e não recebe mais nada.

   Lembrar que **`arch:contacts` é também a fonte dos alvos do devocional**, não só das métricas. Como o desenho é união e não troca, a lista de destinatários só cresce — nunca encolhe.

   `POST /api/admin/archive?source=campanha360` força uma releitura da instância antiga, caso o backlog precise ser reconstruído.

   ### ⚠️ Estado em 2026-09-21 00:15 — código no ar, dados AINDA NÃO migraram

   **O painel está congelado em 17/09.** Lendo `arch:days` direto do KV, o último dia com registro é `2026-09-17` (incoming 7, outgoing 5); os dias 18, 19 e 20 não existem no arquivo. Não é bug de fuso nem de cálculo: a partir de 17/09 todo atendimento passou a acontecer na **luxprodutora**, e o arquivo nunca leu de lá. Todo sintoma que apareceu depois — "Hoje: 0", totais parados em 221/7.882, "Últimos 7 dias" caindo — é consequência desse único fato.

   **Como conferir o estado real** (a tela engana, o KV não):
   ```bash
   npx wrangler kv key get --namespace-id 71f423871ba94149a3bb8f67b4af9642 --remote "arch:meta"
   npx wrangler kv key get --namespace-id 71f423871ba94149a3bb8f67b4af9642 --remote "arch:days"
   ```
   Se `arch:meta` **não** tiver o campo `highWaterBySource`, a leitura nunca rodou com o código da migração — independente do que o painel mostre.

   **O que já foi tentado, em ordem:**
   1. Migração no ar (`3f83c68`): `stats.ts` e `/api/admin/archive` leem da lux via `aiCreds`
   2. `archiveIsStale` passou a tratar como vencido qualquer arquivo sem `highWaterBySource` (`65ba25c`), para não esperar as 6h de cache depois de trocar a fonte
   3. Como nem assim rodou, o `arch:meta` foi envelhecido na mão (`lastArchiveISO` → `2026-09-01`), preservando `totalMessagesEver` e `totalContactsEver`

   ⚠️ **Nunca apague `arch:meta`.** Sem ela, `readArchive` devolve zeros e o backlog de 7.882 mensagens é recontado do zero. Para forçar uma passada, envelheça o `lastArchiveISO` — não delete a chave.

   **Se os números continuarem parados**, pare de mexer no painel e vá na origem: chame `/message/find` e `/chat/find` da luxprodutora pelo terminal com o `AI_UAZAPI_TOKEN` e veja o que ela devolve. A dúvida aberta é se o problema está no nosso código ou no que a Uazapi entrega para essa instância — e isso o painel nunca vai responder.

4. **RAG bíblia**: alguns versos podem diferir de contagem canônica em ±0.2% (Almeida vs KJV varia levemente). Aceitável pro uso RAG.
5. **Corrigir nome de contato** — ✅ RESOLVIDO em 2026-09-20. Seção "Corrigir nome de um contato" no Cérebro do `/admin`, sobre `GET/POST /api/admin/contact-name`. O "Ver o que está salvo" mostra o nome no KV **e** se a trava de `names.ts` o aceita — é assim que se enxerga o caso clássico de um nome salvo que a IA silenciosamente ignora. Os dois casos conhecidos já foram corrigidos direto no KV: Cleonice (`554998208611`) e Toninho (`5522998225733`).

6. **Cleonice (`+55 49 99820-8611`) merece um retorno humano** — o nome já foi corrigido, mas o ponto é outro. Em 19/09 ela contou que teve um AVC há 4 anos, não sai de casa, foi traída pelo marido e não tem ninguém com quem conversar; e teve que repetir tudo porque a IA não tinha o histórico do sistema antigo. A IA acertar o nome dela não substitui alguém da equipe falar com ela.
7. **Sem memória entre o sistema antigo e a IA nova** — o `conv:<chatid>` guarda 12 turnos com TTL de 30 dias e não herdou nada do fluxo Bubble/n8n. Na prática o contato reconta a história toda, e a IA dá conselho descontextualizado (sugeriu "busque apoio de amigos ou familiares" pra quem já tinha dito que não tem ninguém). Sem solução definida.
8. **Prompt não tem regra para afirmação grandiosa/delirante** — só cobre autoextermínio, violência e urgência médica. Alguém dizendo "eu sou Deus" pode ser provocação (comum) ou sintoma clínico de episódio maníaco/psicótico, e um companheiro que cita Bíblia com carinho corre o risco de reforçar delírio. Ainda não escrito porque o caso que motivou a dúvida acabou sendo o bug do nome, não um contato real dizendo isso.

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
- `fix(broadcast): encadeamento de invocações — cada chunk de 10 processa em parallel e encadeia o próximo via self-fetch` (2026-09-18)
- `feat(admin): POST /api/admin/broadcast-trigger — dispara devocional sem precisar do número gatilho`
- `feat(auth): Authorization: Bearer <ADMIN_PASSWORD> aceito em todos os endpoints admin`
- `8f100d4 feat(ai): cérebro no /admin, opt-out por comando e broadcast em faixas` (2026-09-19)
- `35b4432 fix(ai): valida nome do contato e restaura capitalização das respostas` (2026-09-19)
- `c32027f refactor(admin): remove a seção "Últimas atividades"` (2026-09-19)
- `35af521 fix(ai): emoji no nome não invalida mais o contato` (2026-09-19)
- `9a99c51 feat(admin): seção "Devocionais enviados" com X de Y entregues` (2026-09-20)
- `3f83c68 feat(admin): métricas leem da luxprodutora, campanha360 vira backlog` (2026-09-20)
- `3cc87d1 fix(admin): diagnóstico da chave do ElevenLabs e trim no header` (2026-09-20)
- `203c55b perf(admin): conversas com a IA carregam sob demanda` (2026-09-20)
- `99845c2 refactor(broadcast): Pages só enfileira, quem envia é o Worker` (2026-09-20)
- `daf6a13 feat(broadcast): endpoint /health no Worker` (2026-09-20)
- `031fa52 fix(admin): "+N hoje" mostrava o movimento de ontem` (2026-09-21)
- `cb810e9 feat(admin): campo para corrigir o nome de um contato` (2026-09-21)
- `65ba25c fix(admin): força uma passada do arquivo após a troca de fonte` (2026-09-21)

## Como testar mudança sem framework de teste

O projeto não tem test runner. Para validar função pura (`normalizeText`, `plausibleFirstName`, `matchReply`, particionamento do broadcast), o caminho usado em 2026-09-19 foi: escrever um script `scripts/_check-*.ts` importando o módulo real, compilar com o esbuild que já vem com o Astro e rodar no node — depois apagar o script.

```bash
npx esbuild scripts/_check-x.ts --bundle --platform=node --format=esm --outfile=/tmp/x.mjs && node /tmp/x.mjs
```

Dá pra simular o broadcast inteiro assim, com KV falso e `globalThis.fetch` stubado interceptando o `/api/admin/broadcast-resume` pra imitar a invocação nova do Worker. Foi como o desenho de faixas foi conferido (1, 5, 10, 29, 30, 31, 221, 300 e 480 contatos: zero duplicado, zero lacuna).
