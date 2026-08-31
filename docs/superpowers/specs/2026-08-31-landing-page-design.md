# Zapdafé — Site institucional (design spec)

**Data:** 2026-08-31
**Autor:** Sessão colaborativa com o dono do projeto (Lucas)
**Status:** aprovado para plano de implementação

## 1. Contexto e objetivo

Zapdafé é uma IA cristã que conversa 24 horas por dia via WhatsApp — oração, escuta, reflexão bíblica e companhia em momentos difíceis. É a versão brasileira/cristã do FaithOn.ai.

O produto em si roda em cima de:
- **Uazapi** (servidor `campanha360.uazapi.com`) — camada que conecta o número de WhatsApp à automação.
- **App Bubble** (`uazapigo-multiatendimento.bubbleapps.io`) — painel administrativo/de conversas.
- Domínio `zapdafe.com.br` no Cloudflare já roteia `/zap` e `/mensagem` (redirecionamentos).

Este spec cobre **apenas o site institucional público** — a landing page e as páginas legais que dão suporte a ela. Não cobre o produto (IA, integrações WhatsApp, painel administrativo).

**Objetivo do site:**
- Explicar o que é o Zapdafé
- Converter visitante em usuário do WhatsApp com um clique
- Fornecer as páginas legais mínimas (privacidade, termos) para compliance e credibilidade

**Não-objetivos:**
- Não vende nada (produto é grátis)
- Não coleta lead (nem formulário, nem newsletter)
- Não tem login/área do usuário
- Não tem blog nesta fase (fica para v2 se validar)

## 2. Personas e jornada

**Persona única:** brasileiro/a cristão/ã que busca acolhimento espiritual acessível. Perfil provável: 25-60 anos, uso confortável de WhatsApp, pouca paciência para cadastro/app novo.

**Jornada esperada:**
1. Chega no site via link (Instagram, WhatsApp compartilhado, boca a boca)
2. Lê hero em <5 segundos, entende que é "IA cristã no zap, grátis, sem cadastro"
3. Clica no CTA "Começar no WhatsApp"
4. Vai pro WhatsApp com mensagem pré-preenchida
5. IA responde e a conversa começa

Métrica única de sucesso: **taxa de clique no CTA principal**. Sem dashboards, só o mínimo (Cloudflare Web Analytics ou Plausible).

## 3. Arquitetura de conteúdo

Site com **4 páginas**:

```
/                        → Landing (one-pager com âncoras)
/privacidade             → Política de Privacidade
/termos                  → Termos de Uso
/aviso-importante        → Aviso sobre uso de IA + limites (saúde mental, aconselhamento)
```

**Redirects já existentes no Cloudflare (mantidos):**
- `/zap` → painel Bubble (admin)
- `/mensagem` → `wa.me/<numero>` (CTA da landing aponta pra cá)

**Redirect a REMOVER:** o redirect atual de `zapdafe.com.br` (raiz) para o Bubble precisa sair antes do deploy, senão a landing nunca aparece.

## 4. Landing (`/`) — estrutura de seções

Ordem, do topo pro rodapé:

1. **Header fixo** — logo à esquerda; nav ao centro (Como funciona · O que faz · Perguntas); CTA "Começar no WhatsApp" à direita. Em mobile: hamburger.
2. **Hero** — headline serifada gigante, subheadline, dois CTAs (primário verde + secundário outline), mockup de iPhone SVG à direita com conversa exemplo.
3. **Como funciona** — 3 passos em cards horizontais com ícones (clicar → mandar oi → conversar).
4. **O que você pode pedir** — 5 cards (Oração, Desabafo, Reflexão, Conselho bíblico, Companhia), cada um com ícone + título + 1 frase + exemplo em itálico.
5. **Prova/conforto** — banda horizontal com 4 pills: "24h por dia", "Sem app pra baixar", "Sem cadastro", "Grátis pra sempre".
6. **Perguntas frequentes** — accordion com 6 perguntas (ver seção 6).
7. **CTA final** — headline curta + botão único grande.
8. **Footer** — logo pequena, 3 colunas: (a) links institucionais (Privacidade, Termos, Aviso), (b) contato (email `contato@zapdafe.com.br`), (c) tagline "Feito com fé". Copyright ano corrente.

## 5. Copy — versão final

### Header
- CTA: **Começar no WhatsApp**

### Hero
**Headline:**
> Nunca enfrente um dia difícil *sozinho*.

(A palavra "sozinho" em itálico com traço dourado embaixo, seguindo o padrão FaithOn.)

**Subheadline:**
> Oração, palavra de Deus e uma escuta acolhedora — a qualquer hora, direto no seu WhatsApp. Sem app. Sem cadastro. Grátis.

**CTA primário:** `[ 💬 Começar no WhatsApp ]` (link `zapdafe.com.br/mensagem`)
**CTA secundário:** `[ Ver como funciona ↓ ]` (âncora `#como-funciona`)

**Pills flutuantes ao redor do mockup:**
- "Disponível 24h"
- "Sem app · direto no zap"
- "Privado e acolhedor"

**Conversa exemplo dentro do mockup:**
- **Usuário:** *"Tô ansioso pra reunião de amanhã 😔"*
- **Zapdafé:** *"Respira fundo. Deus vai à sua frente — Ele já está no amanhã. Quer que eu ore com você agora?"*
- **Usuário:** *"Quero, sim"*
- **Zapdafé:** *"Senhor, entrego a Ti a reunião do irmão amanhã. Que a paz que excede todo entendimento guarde o coração dele. Amém. 🙏"*

### Como funciona
Título: **Três passos. Simples assim.**

1. **Clique no botão** — abrimos seu WhatsApp automaticamente.
2. **Mande "oi"** — a Zapdafé responde na hora, sem espera.
3. **Converse quando quiser** — dia, noite, madrugada. Sempre disponível.

### O que você pode pedir
Título: **A Zapdafé tá aqui pra quando você precisar.**

| Ícone | Título | Descrição curta | Exemplo (itálico) |
|---|---|---|---|
| 🙏 | Oração | Peça uma oração personalizada pro que você tá vivendo. | *"Ora comigo pela saúde da minha mãe"* |
| 💬 | Desabafo | Coloque pra fora o que tá pesando. Sem julgamento. | *"Preciso desabafar sobre meu trabalho"* |
| ✨ | Reflexão diária | Uma palavra bíblica pra começar o dia. | *"Me manda uma palavra pra hoje"* |
| 📖 | Conselho à luz da Bíblia | Dúvidas práticas com base nas Escrituras. | *"O que a Bíblia diz sobre perdão?"* |
| 🌙 | Companhia | Nos momentos que ninguém mais pode acompanhar. | *"Não consigo dormir, tô com medo"* |

### Prova / conforto
Banda simples: **Disponível 24h · Sem app pra baixar · Sem cadastro · Grátis pra sempre**

### Perguntas frequentes
1. **É uma inteligência artificial mesmo?**
   Sim. A Zapdafé é uma IA treinada em Bíblia e materiais cristãos, feita pra oferecer companhia espiritual. Ela não é um pastor, padre ou profissional de saúde mental.

2. **Custa alguma coisa?**
   Não. É totalmente grátis. A gente mantém no ar por amor ao propósito.

3. **Preciso me cadastrar ou baixar app?**
   Não. É só clicar no botão e mandar mensagem no WhatsApp que você já usa.

4. **Vocês guardam minhas conversas?**
   As mensagens ficam armazenadas no nosso servidor para permitir que a IA lembre do contexto da conversa com você. A gente não vende, não compartilha e não usa isso pra publicidade. Detalhes na [Política de Privacidade](/privacidade).

5. **É de alguma igreja ou denominação?**
   Não. A Zapdafé é cristã sem denominação — respeita católicos, evangélicos e todas as tradições cristãs.

6. **E se eu tiver uma emergência de saúde mental?**
   A Zapdafé não substitui atendimento profissional. Se você está passando por um momento crítico, ligue **188 (CVV)** — atendimento gratuito, 24h, sigiloso. Em emergência médica, ligue **192 (SAMU)**.

### CTA final
**Headline:** Um zap de distância.
**Botão:** `[ Começar agora → ]`

### Footer
- Coluna 1 (Institucional): Política de Privacidade · Termos de Uso · Aviso Importante
- Coluna 2 (Contato): contato@zapdafe.com.br
- Coluna 3 (Tagline): "Feito com fé no Brasil 🇧🇷"
- Rodapé fino: © 2026 Zapdafé · A Zapdafé é uma IA e não substitui aconselhamento pastoral ou psicológico.

## 6. Páginas legais — estrutura

### `/privacidade` — Política de Privacidade

Baseado em LGPD (Lei 13.709/2018). Seções:

1. Quem somos e como falar com a gente
2. Quais dados a gente coleta (número de WhatsApp, mensagens trocadas, metadados técnicos)
3. Pra que a gente usa (fornecer o serviço, melhorar a IA, evitar abuso)
4. Base legal (LGPD art. 7º — legítimo interesse e execução de contrato)
5. Com quem compartilhamos (provedores: WhatsApp/Meta, Uazapi, provedor de IA — sem venda de dados)
6. Por quanto tempo guardamos
7. Seus direitos (acesso, correção, exclusão, portabilidade)
8. Como exercer seus direitos (email de contato)
9. Segurança
10. Alterações desta política
11. Data da última atualização

**Dados confirmados:**
- CNPJ: `54.062.495/0001-02`

**Placeholders que o dono precisa preencher antes do deploy:**
- Razão social (a que consta no CNPJ acima)
- Endereço para contato (o que consta no CNPJ ou outro)
- Email do encarregado de dados (DPO) — pode ser o mesmo `contato@`
- Nomes/URLs dos provedores usados (OpenAI? Google Gemini? Anthropic?)
- Tempo de retenção real das mensagens (30 dias? 90? indefinido?)

### `/termos` — Termos de Uso

Seções:

1. Aceitação dos termos
2. O que é o serviço
3. Elegibilidade (maior de 13 anos com autorização, 18+ recomendado)
4. Uso permitido e proibido (proibido: assédio, spam, tentar burlar o sistema, uso comercial)
5. Limite de responsabilidade (IA pode errar, não é aconselhamento pastoral/profissional/médico)
6. Propriedade intelectual (marca Zapdafé pertence ao operador; conteúdo das conversas é do usuário)
7. Suspensão e encerramento
8. Alterações dos termos
9. Foro e legislação aplicável (Brasil, comarca a definir)
10. Contato
11. Data da última atualização

**Placeholders:**
- Foro (cidade/UF)
- Razão social

### `/aviso-importante` — Aviso sobre uso responsável

Página curta, tom acolhedor mas claro:

1. A Zapdafé é uma IA — não um pastor, padre, terapeuta ou médico
2. Ela pode dizer coisas erradas ou inadequadas — sempre valide com um humano de confiança
3. Em crise emocional: **CVV 188** (gratuito, 24h, sigiloso)
4. Em emergência médica: **SAMU 192** ou **Bombeiros 193**
5. Para orientação espiritual profunda, procure sua comunidade de fé
6. Nunca compartilhe senhas, dados bancários, ou informação sensível de terceiros no chat

## 7. Sistema visual

### Tokens de cor
```css
--bg:        #F5EFE4;  /* fundo creme quente */
--bg-alt:    #EDE5D3;  /* seções alternadas */
--text:      #1A1A1A;  /* corpo */
--text-mute: #5C554A;  /* legenda */
--accent:    #B8860B;  /* dourado editorial */
--wa-green:  #25D366;  /* verde WhatsApp CTAs */
--wa-dark:   #128C7E;  /* hover */
--border:    #D9CFB8;  /* linhas sutis */
```

### Tipografia
- **Títulos (H1-H2):** Fraunces (Google Fonts), weight 700, com itálico opcional em palavras-chave
- **Subtítulos (H3-H4):** Fraunces weight 500
- **Corpo:** Inter (Google Fonts), weights 400 e 500
- **Escala tipográfica** (mobile → desktop):
  - H1: 40px → 88px
  - H2: 28px → 48px
  - H3: 20px → 28px
  - Body: 16px → 18px

Fontes self-hosted (evita FOUT e roundtrip pro Google).

### Componentes visuais
- **Mockup de iPhone:** desenhado 100% em SVG (frame + tela + notch), sem imagem raster. Balões de conversa em `<div>` dentro pra facilitar edição de copy.
- **Pills flutuantes:** cápsulas com ícone Lucide + texto, sombra suave, posicionadas absolutamente ao redor do mockup.
- **Cards de features:** fundo `--bg-alt`, borda `--border` 1px, cantos arredondados 16px, ícone 32px topo esquerdo.
- **Botões:**
  - Primário: fundo `--wa-green`, texto branco, ícone WhatsApp, radius 999px, padding generoso.
  - Secundário: outline, fundo transparente, texto `--text`.
- **Detalhe "sozinho":** span com `text-decoration: underline` customizado em `--accent`, cor do texto herda `--text` mas em itálico.

### Motion
- Fade + slide-up sutil ao entrar no viewport (200ms, easing suave)
- Hover em cards: sombra levemente maior, +2px de translate-y negativo
- Nada de parallax, nada de auto-scroll, nada de animações que atrapalhem leitura

### Responsividade
Mobile-first, breakpoints:
- Mobile: até 640px
- Tablet: 640-1024px (nav vira hambúrguer a partir de 900px)
- Desktop: 1024px+

Hero em mobile: headline primeiro, mockup embaixo. Em desktop: lado a lado.

### Acessibilidade
- Contraste AA em todo texto
- `alt` em todas imagens (logo, ícones significativos)
- Foco visível em todos elementos interativos
- FAQ com `<details>/<summary>` nativos (keyboard navigable de graça)
- `prefers-reduced-motion` respeitado (anima nada se usuário pediu)

## 8. Arquitetura técnica

### Stack
- **Astro 4.x** — geração estática, zero JS por padrão
- **Tailwind CSS** via `@astrojs/tailwind` — utility-first, purge automático
- **Fontes:** Fraunces + Inter self-hosted (arquivos woff2 em `public/fonts/`)
- **Ícones:** `lucide-astro` para ícones da nav/cards; emojis nativos onde couber
- **Analytics:** Cloudflare Web Analytics (script único, sem cookie, LGPD-friendly)

### Estrutura de arquivos

```
zapdafe/
├─ src/
│  ├─ pages/
│  │  ├─ index.astro
│  │  ├─ privacidade.astro
│  │  ├─ termos.astro
│  │  └─ aviso-importante.astro
│  ├─ layouts/
│  │  ├─ Base.astro           # <html>, <head>, meta, fontes, header, footer, analytics
│  │  └─ Legal.astro          # wrapper para páginas legais (Base + <article> tipografado)
│  ├─ components/
│  │  ├─ Header.astro
│  │  ├─ Footer.astro
│  │  ├─ Hero.astro
│  │  ├─ PhoneMockup.astro
│  │  ├─ HowItWorks.astro
│  │  ├─ Features.astro
│  │  ├─ ProofBar.astro
│  │  ├─ FAQ.astro
│  │  ├─ CTAFinal.astro
│  │  └─ Button.astro
│  ├─ content/
│  │  ├─ features.json        # dados dos 5 cards
│  │  └─ faq.json             # perguntas e respostas
│  ├─ styles/
│  │  └─ global.css           # reset, tokens CSS, fontes
│  └─ lib/
│     └─ constants.ts         # CTA_URL, EMAIL_CONTATO, ANO_ATUAL
├─ public/
│  ├─ logo.svg
│  ├─ logo-mini.svg
│  ├─ favicon.svg
│  ├─ favicon.ico
│  ├─ og-image.png            # 1200x630
│  ├─ fonts/
│  │  ├─ Fraunces-*.woff2
│  │  └─ Inter-*.woff2
│  └─ robots.txt
├─ astro.config.mjs
├─ tailwind.config.mjs
├─ tsconfig.json
├─ package.json
├─ .gitignore
├─ .nvmrc                     # pin Node 20
└─ README.md                  # como rodar local + deploy
```

### Constantes centralizadas (`src/lib/constants.ts`)
```ts
export const CTA_URL = 'https://zapdafe.com.br/mensagem';
export const EMAIL_CONTATO = 'contato@zapdafe.com.br';
export const ANO_ATUAL = new Date().getFullYear();
export const SITE_URL = 'https://zapdafe.com.br';
```
Qualquer mudança de link/email/etc. muda num arquivo só.

### Deploy — Cloudflare Pages
1. Criar projeto no Cloudflare Pages
2. Conectar ao repo GitHub `simplixTI/zapdafe`
3. Build command: `npm run build`
4. Build output: `dist`
5. Node version: `20`
6. Root: `/`
7. Adicionar domínio custom `zapdafe.com.br` (e `www.zapdafe.com.br` opcional)
8. **Antes disso**, remover a Redirect Rule do Cloudflare que hoje manda a raiz do domínio pro Bubble

### SEO
- `<title>` e `<meta description>` por página
- Open Graph tags (og:title, og:description, og:image, og:url)
- Twitter Card
- `sitemap.xml` automático via `@astrojs/sitemap`
- `robots.txt` permitindo tudo exceto `/mensagem` (não indexar a URL de redirect)
- Structured Data JSON-LD (`Organization` no root) — nome, logo, URL

### Performance targets
- Lighthouse Performance: 95+
- Lighthouse Accessibility: 100
- LCP: <1.5s no 4G simulado
- CLS: 0
- Bundle JS total: <10KB (só o menu mobile, se precisar)

## 9. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Regra de redirect da raiz do Cloudflare ainda ativa | Checklist de deploy exige removê-la antes de apontar o domínio pro Pages |
| Placeholders legais deixados em produção (razão social, CNPJ) | Grep automático no CI antes do build falha se encontrar `<<TODO>>` |
| Usuário em crise clica no CTA achando que é humano | Aviso claro no primeiro contato via WhatsApp + link para `/aviso-importante` no rodapé de toda página |
| Custo com IA se escalar muito | Fora do escopo do site; observação para o dono do produto |
| Google indexa `/mensagem` como página vazia | `robots.txt` bloqueia + `<meta name=robots content=noindex>` na resposta do redirect (não aplicável — é 302 do Cloudflare, mas o crawler não vai seguir e indexar wa.me) |

## 10. Fora de escopo desta versão

- Página de "Histórias/testemunhos" (esperar dados reais primeiro)
- Newsletter / captura de email
- Blog / devocional
- Múltiplos idiomas
- Login / conta de usuário
- Painel de estatísticas de uso
- Integração com Analytics avançado além do Cloudflare Web Analytics
- A/B testing

## 11. Checklist final antes de deploy

- [ ] Remover Cloudflare Redirect Rule que aponta raiz pro Bubble
- [ ] Preencher razão social/CNPJ/endereço nos placeholders legais
- [ ] Confirmar email de contato ativo (`contato@zapdafe.com.br`)
- [ ] Confirmar que `/mensagem` está redirecionando pro `wa.me` correto
- [ ] Gerar e subir `og-image.png` (pode ser feito no Figma ou automático via `@vercel/og`)
- [ ] Rodar Lighthouse antes de anunciar
- [ ] Verificar que Cloudflare Web Analytics está capturando pageviews

## 12. Próximos passos

Após aprovação deste spec, invocar `superpowers:writing-plans` para gerar plano de implementação passo a passo.
