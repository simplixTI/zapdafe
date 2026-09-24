# Zapdafé — Status do Projeto (2026-09-22)

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
- Se resposta **>900 chars**: TTS ElevenLabs. Cada áudio vai até 2000 caracteres (`VOICE_CHUNK_MAX`), bem acima do gatilho de propósito — se os dois fossem iguais, uma resposta de 500 caracteres viraria dois áudios. Na prática a resposta típica sai num áudio só. **Se o TTS falhar, cada bloco vira uma mensagem de texto separada**, que é o sintoma de resposta picotada quando a chave do ElevenLabs está errada
- `splitSentences()` quebra só em fim de frase de verdade. Na dúvida NÃO quebra: trecho maior é inofensivo, frase partida ao meio não é. Não corta em abreviação ("Pr. Everaldo", "Sra. Maria"), inicial solta ("J. Silva"), número ("1.500"), reticências no meio da frase, nem ponto seguido de minúscula (`'ele disse "..." e isso me acalmou'`). A versão anterior cortava em todo ponto final, inclusive dentro de aspas, e ainda comia dois pontos das reticências

**Broadcast branch** (só enfileira — quem envia é o Worker):
- Dedupe via `broadcast:sent:<messageId>` (evita re-entrega do Uazapi)
- Alvos: **união de duas fontes**, menos os opt-outs — (a) `arch:contacts` com `lastMsgAt <90d` e (b) o índice `active:<chatid>`, que o webhook escreve a cada mensagem recebida e cujo TTL de 90 dias **é** a janela de atividade
- Divide em grupos de **até 100 contatos** (`TAMANHO_ALVO_GRUPO`) e grava job + registros de grupo + `broadcast:queue`. Nenhuma mensagem sai daqui
- O que é fixo é o **tamanho** do grupo, não a quantidade. Com quantidade fixa cada grupo engordava junto com a lista — foi assim que 3 grupos de 79 bateram no teto de chamadas. Agora o ritmo é sempre o mesmo (um grupo a cada 10 min) e só a duração total cresce: 235 contatos → 3 grupos, 500 → 5, 1000 → 10, 2000 → 20 (~200 min). Se a duração incomodar, o ajuste é `GROUP_INTERVAL_MIN` no Worker, **não** aumentar o grupo
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
4. **Aceno depois do encerramento** ("ok", "blz", "pode deixar", "amém") → silêncio total
5. Regra do cérebro (gatilho exato) → resposta fixa, sem gastar token
6. Nada disso → conversa normal com a IA

O passo 4 vem **antes** do cérebro de propósito: "amém" tem regra fixa lá, e ela continua valendo fora do contexto de encerramento.

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
2. **"Fé no Zap" é o nome do perfil do WhatsApp**, confirmado em 2026-09-21 pelo `/instance/status` da Uazapi: `profileName: "Fé no Zap"` (o `name` da instância é "ZAP DA FÉ", outro campo). Não está em código nenhum.

   ⚠️ **Não dá pra trocar pela API.** O endpoint `/profile/name` responde `"Profile name updated successfully"` para **qualquer** payload — inclusive POST vazio e cinco nomes de campo diferentes testados — e não aplica nada. A conta é `isBusiness: true`, plataforma `smbi`: em conta WhatsApp Business o nome de exibição é controlado pela Meta e passa por revisão. **Só muda no app WhatsApp Business** do aparelho dono do número `552123427056`, e pode ficar pendente de aprovação.
3. **O número 21 2342-7056 está correto** (confirmado pelo cliente) e é diferente do número do gatilho do devocional (21 99808-8003), que é outra coisa mesmo.

## Config do webhook no Uazapi (instância luxprodutora)

- URL: `https://zapdafe.com.br/api/uazapi/webhook?secret=<AI_WEBHOOK_SECRET>`
- Method: POST
- Escutar: `messages`
- Excluir: `wasSentByApi`, `isGroupYes`

### Ajustes pedidos pelo cliente em 2026-09-22 (depois dos testes dele)

O cliente colou a lista inteira no `/admin` → Cérebro → Instruções. **Metade dos pedidos não funciona por instrução de texto** — três pediam silêncio (e o código sempre envia o que o LLM devolve) e dois brigavam com o prompt base. O que foi feito de cada um:

| Pedido | Onde resolveu |
|---|---|
| 1º contato: saudação + pergunta o nome, nada mais | `buildSystemPrompt`: o `openingRule` pedia também "convide para conversar", que era exatamente a pergunta que ele mandou tirar |
| Não provocar diálogo ("Como posso te ajudar?") | Seção nova **"Você NÃO puxa conversa"** no prompt base, com as frases proibidas nominalmente. A única pergunta permitida é a do nome |
| "ok/blz/pode deixar" depois do encerramento → não responder | `isAcknowledgement()` + marca `closingAtISO` no perfil. **Impossível no prompt** |
| Não repetir "estou aqui se precisar" (1x/24h) | `lastOfferAtISO` no perfil: o prompt avisa, e `stripOfferSentences()` corta a frase se o modelo insistir |
| Conselho sempre ancorado em versículo | Prompt base: a regra antiga dizia o contrário ("se a pessoa só quer desabafar, o melhor é acolher sem citar nada") |
| "Amém" depois do encerramento → não responder | Mesmo caminho do aceno |
| Perguntaram se é IA → assume, dizendo que é supervisionada por humano | Seção nova no prompt base (pedido do cliente no fim do dia 22/09) |

**Sobre assumir que é IA.** A regra é: nunca negar, nunca se dizer pessoa, responder em uma frase que sim, é uma IA, e que o atendimento é sempre supervisionado por alguém da equipe. Não é convite pra explicar como funciona — uma frase e a conversa segue. Isso não conflita com a regra do Pastor Everaldo: ali a resposta continua sendo "aqui é o Zapdafé".

**Sobre o exemplo de crise.** O exemplo que o cliente escreveu para "estou pensando em me matar" não menciona o CVV. **A estrutura dele foi adotada** (respirar fundo → validar o peso → versículo de força → a vida tem valor imenso → um passo de cada vez), e o **188 ficou**, entrando no fim como braço estendido, não como encaminhamento seco. Decidido com o Bru em 22/09: ninguém em risco fica sem uma linha 24h.

**Por que o gatilho de áudio subiu de 455 para 900.** "Sempre citar versículo" empurra quase toda resposta acima de 455 caracteres. Com o valor antigo, o acolhimento em crise chegaria como **áudio** — e o número do CVV, que a pessoa precisa ler e discar, junto. A resposta-modelo do cliente tem ~890 caracteres e agora chega como texto.

**Detalhes que mordem:**
- A janela do silêncio é de **6 horas** (`ACK_SILENCE_WINDOW_HOURS`). Maior que isso e o "amém" da manhã seguinte — que responde ao devocional do dia, não à conversa de ontem — cairia no silêncio em vez de receber a bênção do cérebro.
- `isAcknowledgement` é uma lista curta de propósito. "sim", "isso" e "tudo bem" ficaram **fora**: podem estar respondendo a uma pergunta. "obrigado" também, porque tem regra própria no cérebro.
- `handleRuleReply` marca `closingAtISO`. Sem isso, a regra do "amém" responde e o "ok" seguinte voltaria pra IA — o silêncio nunca aconteceria na prática.
- `{nome}` escrito nas **instruções** do painel agora é trocado antes de entrar no prompt. Antes só funcionava nas regras de resposta, e o modelo copiava o placeholder literal pra fala.

⚠️ **Duas coisas continuam do lado do painel, não do código:**
1. As duas últimas linhas da lista do cliente (a do "Se precisar falar mais, estou aqui" e a do "Amém depois do encerramento") **não foram coladas** nas instruções. O comportamento das duas já está no código, mas o painel não reflete a lista completa.
2. ✅ **Resolvido em 2026-09-22.** A regra do cérebro de "obrigado/obrigada" respondia *"Por nada {nome}. Estou aqui sempre que precisar."* — repetia a frase de disponibilidade toda vez que alguém agradecia, que é a reclamação do cliente, e o corte de repetição **não alcança regra fixa** (ela responde antes da IA). Trocada no KV por *"Por nada, {nome}. Que Deus te abençoe."*

   Lição para qualquer regra nova no painel: o que está no cérebro escapa de todo controle de tom do prompt. Se a frase não puder se repetir, ela não pode ser uma regra fixa.

### 🔴 Incidente de 2026-09-23 — contato novo não recebia o devocional do dia seguinte

**Sintoma:** os números que chegaram ontem não receberam o devocional de hoje.

**Causa raiz:** os alvos saíam **só** do `arch:contacts`, que não é um cadastro — é um **retrato** tirado pelo `runArchive`. E o `runArchive` só roda em duas situações: alguém **abrir o `/admin`** com o arquivo vencido há 6h, ou um POST manual em `/api/admin/archive`. O Worker do cron não arquiva. O webhook, ao receber um contato novo, grava `contact:<chatid>` (perfil da conversa) e **nunca toca no `arch:contacts`**.

Ou seja: **quem recebia o devocional dependia de alguém ter aberto o painel.**

**Medido, não suposto:**

| disparo | alvos |
|---|---|
| 21/09 10:58 UTC | 235 |
| 22/09 11:22 UTC | 238 |
| 23/09 10:52 UTC | 245 |
| `arch:contacts` às 18:56 UTC de 23/09 | **266** |

21 contatos estavam no arquivo e fora do disparo de hoje. **20 deles já existiam antes das 10:52** — o mais antigo desde 22/09 13:15 — e ficaram de fora mesmo assim. (O 21º, Fátima, chegou às 16:30, depois do disparo; esse não é falha.)

**Correção:** índice `active:<chatid>`, escrito pelo webhook a cada mensagem recebida, com TTL de 90 dias. O `enqueue` passou a unir esse índice com o arquivo.

**Por que uma chave por contato, e não escrever direto no `arch:contacts`:** o arquivo é um JSON único de 36KB. Mandar o webhook fazer read-modify-write nele a cada mensagem criaria uma corrida capaz de **apagar contatos** — no arquivo que este documento marca como insubstituível (a Uazapi só retém ~8 dias). Chave por contato não tem leitura antes da escrita, então duas mensagens simultâneas não se atropelam. E o TTL faz o papel do filtro de 90 dias de graça.

**Por que não mandar o disparo rodar o `runArchive` antes:** o enqueue vive num `waitUntil` do Pages, com teto de ~30s, e o `runArchive` pagina milhares de mensagens da Uazapi. Era voltar ao modo de falha nº 1 da lista lá em cima.

**Limitação conhecida:** o `markActive` fica depois dos returns de reação e de mensagem só-emoji, então um contato cuja **única** interação de todos os tempos seja um 🙏 continua dependendo do arquivo. Na prática não acontece: quem entra pelo link de captação manda texto de verdade na primeira mensagem.

**Contrato Pages↔Worker não mudou** — `broadcast:job:`, `broadcast:lane:` e `broadcast:queue` seguem com os mesmos campos, conferido por teste.

### Cumprimento seco tem resposta fixa (2026-09-24)

Teste real em 24/09 01:29, já com o prompt novo no ar: **"Oi" → "Oi! Como você está?"** — exatamente a pergunta que o cliente mandou tirar. No mesmo histórico, "Boa tarde Zap!" → "Boa tarde! Que Deus te abençoe." saiu perfeito, também pós-deploy.

Ou seja: o prompt acerta na maior parte das vezes e erra justamente no caso mais comum. Numa mensagem sem assunto nenhum, o modelo não tem sobre o que ter empatia e volta ao instinto de puxar conversa. **Proibição em prompt é probabilística; a reclamação do cliente é binária.**

`matchGreeting()` devolve o cumprimento canônico quando a mensagem é só isso ("Oi", "Olá", "Bom dia", "Boa tarde Zap!", "Oi pastor Everaldo") e o webhook responde `"<cumprimento>, {nome}. Que Deus te abençoe."` sem chamar a IA.

- Vem **depois** do cérebro: regra do painel sempre ganha.
- Só vale para quem **já tem histórico** — primeira mensagem continua sendo apresentação + pergunta do nome.
- "Oi, tudo bem?" e "Bom dia! Estou triste hoje" devolvem `null` de propósito: ali tem conteúdo de verdade, que merece a IA.
- Marca `closingAtISO`, então o "amém" ou "ok" logo depois cai no silêncio.

O prompt também ganhou "Como você está?" e "Tudo bem com você?" na lista de proibidas e a regra **"sua resposta NUNCA termina com ponto de interrogação"**, com a pergunta do nome como única exceção.

## Regras de comportamento (system prompt do LLM)

- Tom: **companheiro carinhoso, parceiro**, português BR contemporâneo, frases curtas
- Nunca emoji, nunca reação, nunca CAPS
- **Ortografia correta, toda frase começando com maiúscula.** Regra adicionada em 2026-09-19: o prompt só dizia "não escreve em CAIXA ALTA" e, somado a "sem formalidade excessiva", o GPT-4o-mini passou a responder tudo em minúsculas ("sinto muito que você esteja sentindo essa dor."). Agora o prompt separa explicitamente as duas coisas — informal é o tom, não a grafia
- **Não puxa conversa** (regra do cliente, 22/09): responde com empatia e encerra. Proibido "Como posso te ajudar?", "Tem algo que queira compartilhar?" e variações. A única pergunta permitida é a do primeiro nome, uma vez só
- **Todo conselho ou orientação vem ancorado num versículo**, com referência e texto (regra do cliente, 22/09). Cumprimento curto ("bom dia", "amém") não pede versículo
- Bíblia como ferramenta de conforto — primeiro escuta, valida sentimento, então traz o verso com contexto e ternura
- Se crise séria (autoextermínio, violência, urgência) → acolhe, traz versículo de força, e o CVV 188 entra no fim como braço estendido (ou 190/192 em risco imediato) — nunca como encaminhamento seco
- **Se oferece uma vez por dia, não por resposta** — "estou aqui se precisar" tem teto de 1x/24h por contato
- **Se perguntarem se é IA, assume** (regra do cliente, 22/09): sim, é inteligência artificial, sempre supervisionada por um humano da equipe. Uma frase, sem virar assunto. Nunca nega, nunca se diz pessoa
- Se não sabe, diz que não sabe
- Primeira msg: saudação + apresenta como Zapdafé + pergunta primeiro nome, e só isso
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

   ### Disparo de 2026-09-21 — arquitetura OK, mas 86 falhas de envio

   Primeiro disparo pelo Worker. **Os três grupos rodaram e terminaram** (11:03, 11:17, 11:32), fila limpa sozinha — a arquitetura passou no teste depois de três dias de disparos que morriam no meio. Mas: **149 de 235 entregues, 86 falhas** (29, 29 e 28 — proporção igual nos três grupos).

   Descartado por medição, não por palpite:
   - **Não é número inválido**: 233 dos 235 estão no WhatsApp (`POST /chat/check` com `{"numbers":[...]}` devolve `isInWhatsapp` por número — ferramenta útil, não envia nada)
   - **Não é a instância**: `status: connected`
   - **Não é o envio**: um `/send/text` de teste passa normal

   **CAUSA REAL (2026-09-22): o limite de 50 chamadas externas por invocação do plano gratuito do Workers.** Descoberta comparando a lista de alvos do `broadcast:job:` com quem de fato recebeu (buscando o texto do devocional no `/message/find`). O padrão não deixa dúvida — em **todos** os três grupos, exatamente os 50 primeiros chegaram:

   ```
   grupo 0: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX...........................
   grupo 1: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX...........................
   grupo 2: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX.........................
   ```

   Não era ritmo, não era a Uazapi, não eram os números. A hipótese de ritmo que eu registrei em 21/09 estava **errada**, e o `BATCH_PAUSE_MS` que veio dela não resolveria nada (foi mantido, é inofensivo e gentil com a API).

   Corrigido em `55a5eaa` com `MAX_ENVIOS_POR_INVOCACAO = 45`: `sendGroup` devolve se o grupo terminou e, se parou no teto, a fila não avança — o próximo tick retoma pelo cursor já salvo. Com 235 contatos são ~6 ticks, no máximo 40 chamadas por invocação.

   ✅ **Workers Paid assinado em 2026-09-22** (US$5/mês), o que eleva o limite de 50 para 10.000 chamadas e tira o teto de 1.000 escritas/dia do KV. Com isso `MAX_ENVIOS_POR_INVOCACAO` subiu para 200 e cada grupo volta a caber numa invocação só — o espaçamento real volta a ser os 10 minutos pretendidos.

   **Cuidado ao escolher o plano:** o que resolve é o **Workers Paid**, de nível de conta, em `dash.cloudflare.com/?to=/:account/workers/plans`. Não confundir com o plano **Pro do domínio (US$20)**, com **Additional Page Rules** nem com **APO** — nenhum deles toca em KV ou Workers.

   **Medir em vez de supor:**
   ```
   /health?token=<AI_UAZAPI_TOKEN>&probe=subrequests
   ```
   Faz 70 chamadas externas numa invocação e diz quantas passaram. 70/70 = plano pago; travar em ~50 = gratuito. Foi assim que a assinatura foi confirmada, e serve para detectar se a conta voltar ao plano gratuito.

   Se isso acontecer, baixe `MAX_ENVIOS_POR_INVOCACAO` para 45: o disparo continua entregando tudo, só usando mais ticks.

   **Como identificar quem não recebeu** (o registro só guarda a contagem, não a lista): buscar no `/message/find` da lux as mensagens `fromMe` do dia cujo texto casa com o do `broadcast:job:`, e tirar a diferença contra `job.targets`. Foi assim que os 85 foram encontrados e **reenviados manualmente em 2026-09-22 às 10:01**, com 100% de entrega.

   ### ✅ Disparo de 2026-09-22 — 238 de 238, arquitetura validada

   Primeiro disparo limpo desde que o desenho mudou: **08:22, 3 grupos, todos concluídos, 238 alvos e 238 mensagens criadas na Uazapi.** O painel mostrou 237 por causa de uma única falha de entrega, e essa falha é a história do dia.

   | status na Uazapi | quantos |
   |---|---|
   | Read | 66 |
   | Delivered | 128 |
   | Sent | 43 |
   | **Failed** | **1** |

   **A falha: `553189077770` ("Soares construções"), `WhatsApp server error 403`.** É o cliente que reclamou em 2026-09-18 e que o cliente bloqueou no WhatsApp à mão — mandar para quem você bloqueou dá 403. Ou seja: não foi um defeito do disparo, foi o WhatsApp recusando corretamente.

   **Mas por que ele ainda era alvo?** Aí sim havia um defeito, e ele é geral. Ele foi marcado como opt-out, mas o número gravado na lista era `55231989077770` — a forma de 13 dígitos com um `2` digitado a mais — enquanto o chatid dele tem 12 dígitos: `553189077770`. A comparação era string contra string, então **nunca bateu**. Ele entrou como alvo de todo devocional desde 18/09. Só não recebeu nenhum porque estava bloqueado.

   Isso não é um caso isolado esperando acontecer — é a regra: na base de hoje **143 chatids têm 12 dígitos e 91 têm 13**. Qualquer opt-out digitado na forma "errada" era silenciosamente ignorado.

   **Corrigido em `functions/_shared/optouts.ts`:** `phoneVariants()` gera as duas formas do número brasileiro (com e sem o nono dígito) e a comparação passa a ser por pessoa, não por grafia. A expansão de 8→9 dígitos só vale para celular (prefixo 6–9), porque inventar um nono dígito num fixo criaria o celular de outra pessoa. Verificado contra os 235 contatos reais: **nenhuma variante colide com outro contato**.

   O `removeOptOut` também passou a remover qualquer uma das formas — senão tirar o número digitado deixaria a outra grafia para trás, silenciando alguém para sempre.

   **E o Worker agora grava o número junto do erro** (`errosAmostra`), porque descobrir de quem era essa única falha custou uma varredura no histórico da Uazapi.

   **Ainda a fazer no `/admin` → Opt-outs:** apagar a entrada `55231989077770` (inválida) e cadastrar `553189077770`.

   **Estado: ✅ NO AR e validado em 2026-09-22.** Worker `zapdafe-broadcast` deployado (cron `*/5 * * * *`), secrets conferidos, e o lado do Pages trocado para só enfileirar. `runChunk`, `chainNext`, `recordChainError` e o endpoint `broadcast-resume` foram apagados.

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

   **Resolvido em 2026-09-21 00:20:** o arquivo migrou (`arch:meta` ganhou `highWaterBySource`), passando para 235 contatos e 8.882 mensagens. Mas a investigação revelou duas coisas muito mais importantes que os números.

### 🔴 A Uazapi guarda pouco histórico — o arquivo KV é insubstituível

Medido em 2026-09-21 chamando `/message/find` direto nas duas instâncias:

| Instância | Mensagens disponíveis | Mais antiga |
|---|---|---|
| campanha360 | ~1.957 | 13/09/26 |
| luxprodutora | ~2.500 | 13/09/26 |

O arquivo em KV tem **7.882 mensagens desde 15/08**. Ou seja, a Uazapi retém só as ~2.000 mais recentes (cerca de 8 dias) e **todo o histórico anterior existe somente no nosso KV**.

⚠️ **NUNCA reconstrua o arquivo do zero.** Um "rebuild" reduziria 7.882 para ~1.957 e apagaria meses de dados, sem forma de recuperar. Pelo mesmo motivo, nunca apague `arch:meta`, `arch:contacts`, `arch:days` ou `arch:hourly`.

**Backup:** existe uma cópia local em `backup/` (fora do git — tem telefone de contato). Refazer periodicamente:
```bash
NS=71f423871ba94149a3bb8f67b4af9642
for k in arch:contacts arch:days arch:hourly arch:meta optouts:list rules:brain; do
  npx wrangler kv key get --namespace-id $NS --remote "$k" > "backup/${k//:/_}-$(date -u +%Y%m%d).json"
done
```

### 🔴 A Uazapi mente no `hasMore`

Ela devolve `hasMore: false` em **todos** os offsets, mesmo com páginas cheias atrás: no offset 1000 retorna 500 mensagens e diz que acabou; idem em 1500 e 2000; só no 3000 vem vazio. Confiando nela, a primeira leitura da lux trouxe 1.000 de ~2.500 — sem erro nenhum, números plausíveis e errados.

Corrigido em `4948716`: pagina enquanto a página vier cheia, para quando vier incompleta. **Se for integrar qualquer outro endpoint da Uazapi, não confie em campo de paginação dela.**

**Pendência conhecida:** faltam ~1.500 mensagens da lux (13 a 19/09) que a leitura truncada não trouxe. Como o arquivo pula por marca de tempo, ele não volta sozinho. Recuperar exigiria zerar `highWaterBySource.lux`, o que recontaria as 1.000 já registradas. Decisão de 2026-09-21: **deixar como está** — os totais ficam ~1.500 abaixo do real no histórico, e tudo novo entra certo.

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
- `07ee7b1 feat(broadcast): agrupa por tamanho fixo, não por quantidade fixa` (2026-09-22)

## Como testar mudança sem framework de teste

O projeto não tem test runner. Para validar função pura (`normalizeText`, `plausibleFirstName`, `matchReply`, particionamento do broadcast), o caminho usado em 2026-09-19 foi: escrever um script `scripts/_check-*.ts` importando o módulo real, compilar com o esbuild que já vem com o Astro e rodar no node — depois apagar o script.

```bash
npx esbuild scripts/_check-x.ts --bundle --platform=node --format=esm --outfile=/tmp/x.mjs && node /tmp/x.mjs
```

Dá pra simular o broadcast inteiro assim, com KV falso e `globalThis.fetch` stubado interceptando o `/api/admin/broadcast-resume` pra imitar a invocação nova do Worker. Foi como o desenho de faixas foi conferido (1, 5, 10, 29, 30, 31, 221, 300 e 480 contatos: zero duplicado, zero lacuna).
