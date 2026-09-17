# AI Response Webhook — `/api/uazapi/webhook`

Recebe mensagens da sessão **luxprodutora** do Uazapi e responde com GPT-4o-mini + RAG bíblia, com voz via ElevenLabs quando a resposta passa de 450 caracteres. Também atende ao gatilho de devocional manual.

## Fluxo

```
Uazapi → POST /api/uazapi/webhook
        ↓
        1. Valida X-Webhook-Secret
        2. Ignora se: fromMe, isGroup, wasSentByApi, texto vazio
        3. Se sender === DEVOTIONAL_TRIGGER_PHONE:
             → broadcast pra todos ativos (<30d) não-opt-out (delay 1.2s entre envios)
        4. Se opted_out: 200 silêncio
        5. Caso contrário:
             → carrega histórico (últimas 12 turns) do KV
             → busca top 3 versos bíblicos via RAG
             → chama GPT-4o-mini com system prompt "parceiro carinhoso"
             → salva turn no KV
             → se resposta ≤ 450 chars: sendText via Uazapi
             → se > 450: quebra em blocos por frase → TTS ElevenLabs → sendVoice
```

Retorna 200 imediatamente; o trabalho pesado roda em `ctx.waitUntil`.

## Env vars (Cloudflare Pages → Settings → Variables and Secrets — marcar **Encrypt** em tudo)

| Nome                       | Valor                                                   |
|----------------------------|---------------------------------------------------------|
| `AI_UAZAPI_BASE`           | `https://luxprodutora.uazapi.com`                       |
| `AI_UAZAPI_TOKEN`          | `68ec598a-cca7-491a-8025-ab9c0e865691` (rotacionar!)    |
| `AI_WEBHOOK_SECRET`        | *(gere um segredo aleatório, 32+ bytes hex)*            |
| `OPENAI_API_KEY`           | `sk-proj-...`                                           |
| `SUPABASE_URL`             | `https://rvpdulzkipkmwwglsgja.supabase.co`              |
| `SUPABASE_SERVICE_ROLE_KEY`| `eyJhbGciOi...` (service_role)                          |
| `BIBLE_RAG_ENABLED`        | `true`                                                  |
| `ELEVENLABS_API_KEY`       | `931...`                                                |
| `ELEVENLABS_VOICE_ID`      | `Lo3nuVZKTfiOvJvov8W7`                                  |
| `DEVOTIONAL_TRIGGER_PHONE` | `5521998088003`                                         |

Aplica em **Production** e **Preview** se quiser testar em preview URL.

## Setup no Uazapi

1. Dashboard Uazapi → instância luxprodutora → **Webhooks**
2. **URL**: `https://zapdafe.com.br/api/uazapi/webhook`
3. **Method**: POST
4. **Custom headers**: `X-Webhook-Secret: <mesmo valor de AI_WEBHOOK_SECRET>`
5. **Events**: `messages` (novas mensagens recebidas)

## Regra do devocional manual

Quando o número `+55 21 99808-8003` (config em `DEVOTIONAL_TRIGGER_PHONE`) manda mensagem pra essa sessão do Uazapi, o texto é reencaminhado pra **todos os contatos ativos (últimos 30d)** que não estão em opt-out, com espaçamento de 1.2s entre envios. Idempotente por `messageId` (não reenvia se o webhook re-entrega).

Log de cada broadcast fica em KV com key `broadcast:log:<messageId>` (TTL 30d) — pode ler via dashboard Cloudflare KV se quiser auditar.

## Segurança

- `X-Webhook-Secret` protege contra chamadas externas ao endpoint.
- Nada de LLM/RAG/TTS/broadcast roda sem esse header válido.
- Se o Uazapi não suportar header custom, alternativa é validar por IP allowlist ou por token na URL (menos ideal — token aparece em logs).

## Limitações conhecidas

- CF Workers tem ~30s de CPU. Broadcast pra >200 contatos pode estourar; nesse caso, migrar pra Queue ou Cron.
- ElevenLabs pode falhar (rate limit, quota). Fallback é enviar como texto.
- Sem streaming da resposta — usuário espera a mensagem inteira ficar pronta. Latência típica: 2-5s texto, 4-8s voz.
