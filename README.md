# Zapdafé — Site institucional

Site estático em Astro 4 + Tailwind 4 para zapdafe.com.br.

## Rodar local

```bash
nvm use          # Node 20 via .nvmrc
npm install
npm run dev      # http://localhost:4321
```

## Build

```bash
npm run build    # gera dist/
npm run preview  # preview do build
```

## Estrutura

- `src/pages/` — rotas (`index`, `privacidade`, `termos`, `aviso-importante`)
- `src/layouts/` — `Base` (todas as páginas) e `Legal` (páginas legais)
- `src/components/` — componentes reutilizáveis
- `src/content/` — dados JSON (features, FAQ)
- `src/lib/constants.ts` — URLs, emails, dados legais
- `src/styles/global.css` — Tailwind 4 + tokens de design + fontes
- `public/` — assets estáticos (logo, favicon, robots)

## Antes de deployar

Preencher os `<<TODO>>` em `src/lib/constants.ts`:
- `RAZAO_SOCIAL` — razão social do CNPJ 54.062.495/0001-02
- `ENDERECO` — endereço completo
- `PROVEDOR_IA` — nome do provedor de IA usado (OpenAI, Anthropic, Google...)
- `RETENCAO_MSGS` — tempo de retenção real das mensagens
- `FORO` — cidade/UF do foro nos Termos

E o token do Cloudflare Web Analytics em `src/layouts/Base.astro`.

Verificar antes do deploy:
```bash
grep -r '<<TODO' src/
```
Não pode retornar nada.

## Deploy no Cloudflare Pages

1. **Remover** a Redirect Rule que hoje aponta `zapdafe.com.br` (raiz) para o Bubble. Manter as regras `/zap` e `/mensagem`.
2. Ir em **Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git**.
3. Selecionar o repo `simplixTI/zapdafe`.
4. Configurar:
   - Framework: Astro
   - Build command: `npm run build`
   - Build output: `dist`
   - Node version: `20`
5. Deploy.
6. Em **Custom domains**, adicionar `zapdafe.com.br` (e `www.zapdafe.com.br` se quiser).
7. Ir em **Web Analytics**, criar um site apontando pra `zapdafe.com.br`, copiar o token, substituir o `<<TODO>>` no `Base.astro`, commitar — novo deploy roda automático.

## Copy e conteúdo

- Textos de features estão em `src/content/features.json`.
- FAQ em `src/content/faq.json`.
- Copy de páginas legais direto nos `src/pages/*.astro` (usam variáveis do `constants.ts`).

## Referência do design

- `docs/superpowers/specs/2026-08-31-landing-page-design.md` — spec completa (arquitetura, copy final, sistema visual).
- `docs/superpowers/plans/2026-08-31-landing-page.md` — plano de implementação task-a-task.
- `docs/ADMIN.md` — painel `/admin` (métricas + opt-outs). Passo a passo pra bindar KV e env vars no Cloudflare Pages.
