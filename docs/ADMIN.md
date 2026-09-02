# Painel Admin — `/admin`

Painel single-user para acompanhar métricas do Zapdafé (pessoas, conversas, mensagens) e gerenciar opt-outs.

- **URL:** `https://zapdafe.com.br/admin`
- **Login:** `https://zapdafe.com.br/admin-login` (senha guardada em env var)
- **Filtro global:** só considera mensagens de `2026-08-01` em diante (data de lançamento). Ajustável em `functions/_shared/uazapi.ts` (constante `CUTOFF_MS`).

## Arquitetura

- **Frontend:** páginas Astro estáticas (`src/pages/admin/index.astro` + `src/pages/admin-login.astro`)
- **Backend:** Cloudflare Pages Functions em `functions/`
  - `_middleware.ts` — gate de autenticação em `/admin/*` e `/api/admin/*`
  - `api/admin/login.ts` / `logout.ts` — sessão via cookie httpOnly (7 dias de TTL) armazenada em KV
  - `api/admin/stats.ts` — busca dados do Uazapi (contatos, chats, mensagens) e agrega
  - `api/admin/optouts.ts` — CRUD da lista de opt-outs (KV)
  - `api/optouts.ts` — leitura pública **protegida por Bearer token** para o backend da IA (Bubble) consultar

- **Storage:** Cloudflare Workers KV (namespace único).
  - Chaves: `session:<token>` (auth) e `optouts:list` (JSON array de números só-dígitos)

## Setup no Cloudflare Pages (uma vez só)

### 1. Cria o KV Namespace

Dashboard Cloudflare → **Workers & Pages → KV → Create namespace**:
- Nome: `zapdafe-admin`
- Copia o **Namespace ID** (você não precisa dele diretamente, mas confirma que foi criado)

### 2. Bind o KV no projeto Pages

Projeto `zapdafe` → **Settings → Functions → KV namespace bindings → Add binding**:
- Variable name: `KV`
- KV namespace: `zapdafe-admin`

### 3. Adiciona as env vars

Projeto → **Settings → Variables and Secrets → Add**. **Marca "Encrypt"** para todas (são segredos):

| Nome              | Valor exemplo                                          | Descrição |
|-------------------|--------------------------------------------------------|-----------|
| `ADMIN_PASSWORD`  | (senha forte que só você sabe)                         | Senha do painel |
| `UAZAPI_TOKEN`    | `5a1ac581-7267-4ccb-94de-873581e08cdb` (rotacionar!)   | Token da instância Uazapi |
| `UAZAPI_BASE`     | `https://campanha360.uazapi.com`                       | URL base do servidor Uazapi |
| `BUBBLE_BEARER`   | (gera aleatório, ex.: 32 bytes hex)                    | Token que o Bubble usa pra consultar opt-outs |

Aplica em **Production** (e Preview se quiser).

### 4. Redeploy

Depois de adicionar KV + env vars, dispare um novo deploy (**Deployments → Retry deployment** ou faz um push).

## Como o Bubble consulta opt-outs

Antes de responder a alguém no WhatsApp, o Bubble deve chamar:

```
GET https://zapdafe.com.br/api/optouts?phone=5521999998888
Authorization: Bearer <BUBBLE_BEARER>
```

Resposta:
```json
{ "phone": "5521999998888", "optedOut": false }
```

Se `optedOut: true`, o Bubble não responde (e opcionalmente registra o desligamento).

Também pode listar todos:
```
GET https://zapdafe.com.br/api/optouts
Authorization: Bearer <BUBBLE_BEARER>
```

## Segurança — pontos de atenção

- **Rotacione o `UAZAPI_TOKEN`**: ele apareceu no chat e vive na Redirect Rule `/zap` (visível em logs Cloudflare).
- **Senha forte no `ADMIN_PASSWORD`**: URL é pública, quem descobre a senha entra.
- **Sessão de 7 dias**: se roubarem seu cookie, tem acesso por até 7 dias. Faça logout em máquinas compartilhadas.
- O painel **não é indexado** pelo Google (robots.txt + `<meta noindex>`).

## Métricas mostradas

- **KPIs:** total de pessoas, ativas 24h/7d, iniciaram hoje, mensagens hoje, opt-outs
- **Gráfico últimos 30 dias:** barras verdes (recebidas) + douradas (enviadas), pontinho quando teve conversa nova
- **Tabela últimas atividades:** 50 contatos mais recentes com botão de opt-out
- **Seção opt-outs:** adicionar/remover manualmente por número

Todas as métricas respeitam o cutoff de `2026-08-01`.
