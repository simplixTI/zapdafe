# Zapdafé — Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Zapdafé static site (landing + 3 páginas legais) em Astro, pronto para deploy no Cloudflare Pages, seguindo o spec em `docs/superpowers/specs/2026-08-31-landing-page-design.md`.

**Architecture:** Astro 4.x static site generation, Tailwind CSS, self-hosted fonts, zero JS por padrão. Deploy via Cloudflare Pages conectado ao repo GitHub. Copy final e sistema visual vêm do spec (referência autoritária).

**Tech Stack:** Astro 4.x · Tailwind CSS · TypeScript · Node 20 · Cloudflare Pages · Fraunces + Inter fonts · lucide-astro icons

**Convenção de verificação:** cada tarefa termina com `npm run build` (garante que não quebrou nada) ou `npm run dev` + verificação visual (quando aplicável).

---

## Task 1 — Bootstrap do projeto Astro

**Files:**
- Create: `package.json`, `astro.config.mjs`, `tsconfig.json`, `tailwind.config.mjs`, `.gitignore`, `.nvmrc`, `README.md`
- Create: `src/pages/index.astro` (placeholder inicial)

- [ ] **Step 1: Inicializar Astro**

Do repo root (`c:/Users/GalaxyBook3/Documents/Claude Code/ZapdaFe`):
```bash
npm create astro@latest . -- --template minimal --typescript strict --install --no-git --skip-houston --yes
```

- [ ] **Step 2: Instalar Tailwind, sitemap e lucide-astro**

```bash
npx astro add tailwind --yes
npx astro add sitemap --yes
npm install lucide-astro
```

- [ ] **Step 3: Criar `.nvmrc` pinando Node 20**

```
20
```

- [ ] **Step 4: Atualizar `astro.config.mjs` com site URL**

```js
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://zapdafe.com.br',
  integrations: [tailwind(), sitemap()],
});
```

- [ ] **Step 5: Sobrescrever `src/pages/index.astro` com placeholder**

```astro
---
---
<html lang="pt-BR">
  <head><title>Zapdafé</title></head>
  <body><h1>Zapdafé em construção</h1></body>
</html>
```

- [ ] **Step 6: Build para garantir que tudo compila**

```bash
npm run build
```
Expected: build completa sem erros, gera pasta `dist/`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: bootstrap Astro project with Tailwind and sitemap"
```

---

## Task 2 — Tokens de design, fontes e reset global

**Files:**
- Create: `src/styles/global.css`
- Create: `public/fonts/` (arquivos woff2 de Fraunces e Inter)
- Modify: `tailwind.config.mjs`

- [ ] **Step 1: Baixar as fontes woff2**

Baixar de `https://gwfh.mranftl.com/fonts` (Google Webfonts Helper) — self-hosted:
- Fraunces: weights 500 e 700, subset latin + latin-ext
- Inter: weights 400 e 500, subset latin + latin-ext

Colocar em `public/fonts/`:
- `Fraunces-500.woff2`
- `Fraunces-700.woff2`
- `Fraunces-500-italic.woff2`
- `Fraunces-700-italic.woff2`
- `Inter-400.woff2`
- `Inter-500.woff2`

- [ ] **Step 2: Criar `src/styles/global.css` com tokens + @font-face**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@font-face {
  font-family: 'Fraunces';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('/fonts/Fraunces-500.woff2') format('woff2');
}
@font-face {
  font-family: 'Fraunces';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('/fonts/Fraunces-700.woff2') format('woff2');
}
@font-face {
  font-family: 'Fraunces';
  font-style: italic;
  font-weight: 500;
  font-display: swap;
  src: url('/fonts/Fraunces-500-italic.woff2') format('woff2');
}
@font-face {
  font-family: 'Fraunces';
  font-style: italic;
  font-weight: 700;
  font-display: swap;
  src: url('/fonts/Fraunces-700-italic.woff2') format('woff2');
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/Inter-400.woff2') format('woff2');
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('/fonts/Inter-500.woff2') format('woff2');
}

:root {
  --bg: #F5EFE4;
  --bg-alt: #EDE5D3;
  --text: #1A1A1A;
  --text-mute: #5C554A;
  --accent: #B8860B;
  --wa-green: #25D366;
  --wa-dark: #128C7E;
  --border: #D9CFB8;
}

html {
  scroll-behavior: smooth;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: 'Inter', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { animation: none !important; transition: none !important; }
}

.accent-underline {
  font-style: italic;
  position: relative;
  color: var(--text);
}
.accent-underline::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -0.05em;
  height: 0.12em;
  background: var(--accent);
  border-radius: 999px;
}
```

- [ ] **Step 3: Atualizar `tailwind.config.mjs` com tokens**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        'bg-alt': 'var(--bg-alt)',
        text: 'var(--text)',
        'text-mute': 'var(--text-mute)',
        accent: 'var(--accent)',
        'wa-green': 'var(--wa-green)',
        'wa-dark': 'var(--wa-dark)',
        border: 'var(--border)',
      },
      fontFamily: {
        serif: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 4: Verificar build**

```bash
npm run build
```
Expected: build ok, sem warnings de CSS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add design tokens, fonts, and global styles"
```

---

## Task 3 — Constantes e layout base

**Files:**
- Create: `src/lib/constants.ts`
- Create: `src/layouts/Base.astro`

- [ ] **Step 1: Criar `src/lib/constants.ts`**

```ts
export const SITE_URL = 'https://zapdafe.com.br';
export const CTA_URL = 'https://zapdafe.com.br/mensagem';
export const EMAIL_CONTATO = 'contato@zapdafe.com.br';
export const ANO_ATUAL = new Date().getFullYear();

export const CNPJ = '54.062.495/0001-02';
export const RAZAO_SOCIAL = '<<TODO: razão social>>';
export const ENDERECO = '<<TODO: endereço completo>>';
export const PROVEDOR_IA = '<<TODO: nome do provedor de IA (OpenAI/Anthropic/Google)>>';
export const RETENCAO_MSGS = '<<TODO: tempo de retenção das mensagens (ex.: 90 dias)>>';
export const FORO = '<<TODO: cidade/UF do foro>>';

export const SITE_NAME = 'Zapdafé';
export const SITE_TAGLINE = 'Companhia cristã 24h no seu WhatsApp';
```

- [ ] **Step 2: Criar `src/layouts/Base.astro`**

```astro
---
import '../styles/global.css';
import { SITE_URL, SITE_NAME } from '../lib/constants';

interface Props {
  title: string;
  description: string;
  ogImage?: string;
  canonical?: string;
}

const { title, description, ogImage = '/og-image.png', canonical } = Astro.props;
const canonicalURL = canonical ?? new URL(Astro.url.pathname, SITE_URL).toString();
---
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="alternate icon" href="/favicon.ico" />
    <link rel="canonical" href={canonicalURL} />

    <title>{title}</title>
    <meta name="description" content={description} />

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content={SITE_NAME} />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta property="og:url" content={canonicalURL} />
    <meta property="og:image" content={new URL(ogImage, SITE_URL).toString()} />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content={title} />
    <meta name="twitter:description" content={description} />
    <meta name="twitter:image" content={new URL(ogImage, SITE_URL).toString()} />

    <meta name="theme-color" content="#F5EFE4" />

    <link rel="preload" as="font" href="/fonts/Fraunces-700.woff2" type="font/woff2" crossorigin />
    <link rel="preload" as="font" href="/fonts/Inter-400.woff2" type="font/woff2" crossorigin />

    <script type="application/ld+json" set:html={JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/logo.svg`,
    })} />

    <slot name="head" />
  </head>
  <body class="min-h-screen bg-bg text-text antialiased">
    <slot />
  </body>
</html>
```

- [ ] **Step 3: Build**

```bash
npm run build
```
Expected: build ok.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add site constants and base layout with SEO tags"
```

---

## Task 4 — Componente Button reutilizável

**Files:**
- Create: `src/components/Button.astro`

- [ ] **Step 1: Criar `src/components/Button.astro`**

```astro
---
interface Props {
  href: string;
  variant?: 'primary' | 'secondary';
  external?: boolean;
  class?: string;
}

const { href, variant = 'primary', external = false, class: className = '' } = Astro.props;

const base = 'inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-200 whitespace-nowrap';
const sizes = 'px-6 py-3 text-base md:px-7 md:py-3.5 md:text-lg';
const variants = {
  primary: 'bg-wa-green text-white hover:bg-wa-dark hover:-translate-y-0.5 shadow-sm hover:shadow-md',
  secondary: 'bg-transparent text-text border border-text/20 hover:bg-text/5',
};
---
<a
  href={href}
  class={`${base} ${sizes} ${variants[variant]} ${className}`}
  {...external ? { target: '_blank', rel: 'noopener noreferrer' } : {}}
>
  <slot />
</a>
```

- [ ] **Step 2: Build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add reusable Button component"
```

---

## Task 5 — Header com menu mobile

**Files:**
- Create: `src/components/Header.astro`

- [ ] **Step 1: Criar `src/components/Header.astro`**

```astro
---
import Button from './Button.astro';
import { CTA_URL, SITE_NAME } from '../lib/constants';
import { MessageCircle, Menu, X } from 'lucide-astro';
---
<header class="sticky top-0 z-40 bg-bg/90 backdrop-blur-md border-b border-border">
  <div class="max-w-6xl mx-auto px-4 md:px-6 h-16 md:h-20 flex items-center justify-between">
    <a href="/" class="flex items-center gap-2" aria-label={SITE_NAME}>
      <img src="/logo.svg" alt={SITE_NAME} class="h-9 md:h-10 w-auto" />
    </a>

    <nav class="hidden md:flex items-center gap-8 text-sm font-medium text-text-mute">
      <a href="/#como-funciona" class="hover:text-text transition-colors">Como funciona</a>
      <a href="/#o-que-faz" class="hover:text-text transition-colors">O que faz</a>
      <a href="/#perguntas" class="hover:text-text transition-colors">Perguntas</a>
    </nav>

    <div class="hidden md:block">
      <Button href={CTA_URL} variant="primary">
        <MessageCircle size={18} /> Começar no WhatsApp
      </Button>
    </div>

    <button
      id="menu-toggle"
      class="md:hidden p-2 -mr-2"
      aria-label="Abrir menu"
      aria-expanded="false"
      aria-controls="mobile-menu"
    >
      <Menu size={24} class="menu-open" />
      <X size={24} class="menu-close hidden" />
    </button>
  </div>

  <div id="mobile-menu" class="hidden md:hidden border-t border-border bg-bg">
    <div class="px-4 py-6 flex flex-col gap-4">
      <a href="/#como-funciona" class="py-2 text-lg">Como funciona</a>
      <a href="/#o-que-faz" class="py-2 text-lg">O que faz</a>
      <a href="/#perguntas" class="py-2 text-lg">Perguntas</a>
      <Button href={CTA_URL} variant="primary" class="mt-2 w-full">
        <MessageCircle size={18} /> Começar no WhatsApp
      </Button>
    </div>
  </div>
</header>

<script>
  const toggle = document.getElementById('menu-toggle');
  const menu = document.getElementById('mobile-menu');
  const iconOpen = document.querySelector('.menu-open');
  const iconClose = document.querySelector('.menu-close');

  toggle?.addEventListener('click', () => {
    const isOpen = !menu?.classList.contains('hidden');
    menu?.classList.toggle('hidden');
    iconOpen?.classList.toggle('hidden');
    iconClose?.classList.toggle('hidden');
    toggle.setAttribute('aria-expanded', String(!isOpen));
    toggle.setAttribute('aria-label', isOpen ? 'Abrir menu' : 'Fechar menu');
  });

  document.querySelectorAll('#mobile-menu a').forEach(a => {
    a.addEventListener('click', () => {
      menu?.classList.add('hidden');
      iconOpen?.classList.remove('hidden');
      iconClose?.classList.add('hidden');
      toggle?.setAttribute('aria-expanded', 'false');
    });
  });
</script>
```

- [ ] **Step 2: Build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add sticky header with mobile menu"
```

---

## Task 6 — Componente PhoneMockup (SVG do celular com conversa)

**Files:**
- Create: `src/components/PhoneMockup.astro`

- [ ] **Step 1: Criar `src/components/PhoneMockup.astro`**

```astro
---
interface Message {
  from: 'user' | 'ai';
  text: string;
}

const messages: Message[] = [
  { from: 'user', text: 'Tô ansioso pra reunião de amanhã 😔' },
  { from: 'ai', text: 'Respira fundo. Deus vai à sua frente — Ele já está no amanhã. Quer que eu ore com você agora?' },
  { from: 'user', text: 'Quero, sim' },
  { from: 'ai', text: 'Senhor, entrego a Ti a reunião do irmão amanhã. Que a paz que excede todo entendimento guarde o coração dele. Amém. 🙏' },
];
---
<div class="relative mx-auto max-w-[320px] md:max-w-[360px]">
  <div class="relative aspect-[9/19] rounded-[3rem] bg-[#111] p-3 shadow-2xl">
    <div class="absolute top-6 left-1/2 -translate-x-1/2 h-6 w-28 bg-black rounded-full z-10"></div>
    <div class="h-full w-full rounded-[2.4rem] bg-bg overflow-hidden flex flex-col">
      <div class="bg-[#075E54] text-white px-4 pt-10 pb-3 flex items-center gap-3">
        <div class="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-lg">🙏</div>
        <div class="flex-1">
          <div class="font-medium text-sm">Zapdafé</div>
          <div class="text-xs text-white/70">online</div>
        </div>
      </div>
      <div class="flex-1 p-3 space-y-2 overflow-hidden bg-[#ECE5DD]">
        {messages.map(m => (
          <div class={`flex ${m.from === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div class={`max-w-[85%] px-3 py-2 rounded-lg text-sm leading-snug shadow-sm ${
              m.from === 'user'
                ? 'bg-[#DCF8C6] text-[#1a1a1a] rounded-tr-none'
                : 'bg-white text-[#1a1a1a] rounded-tl-none'
            }`}>
              {m.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>

  <div class="hidden md:block absolute -left-8 top-16 bg-white shadow-lg rounded-full px-4 py-2 text-sm font-medium border border-border">
    🕐 Disponível 24h
  </div>
  <div class="hidden md:block absolute -right-6 top-1/3 bg-white shadow-lg rounded-full px-4 py-2 text-sm font-medium border border-border">
    📱 Sem app
  </div>
  <div class="hidden md:block absolute -left-6 bottom-24 bg-white shadow-lg rounded-full px-4 py-2 text-sm font-medium border border-border">
    🔒 Privado
  </div>
</div>
```

- [ ] **Step 2: Build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add PhoneMockup component with sample conversation"
```

---

## Task 7 — Hero

**Files:**
- Create: `src/components/Hero.astro`

- [ ] **Step 1: Criar `src/components/Hero.astro`**

```astro
---
import Button from './Button.astro';
import PhoneMockup from './PhoneMockup.astro';
import { CTA_URL } from '../lib/constants';
import { MessageCircle, ArrowDown } from 'lucide-astro';
---
<section class="relative overflow-hidden">
  <div class="max-w-6xl mx-auto px-4 md:px-6 pt-12 md:pt-20 pb-16 md:pb-24">
    <div class="grid md:grid-cols-2 gap-12 md:gap-8 items-center">
      <div class="text-center md:text-left order-2 md:order-1">
        <h1 class="font-serif font-bold text-text leading-[1.05] text-[2.5rem] sm:text-5xl md:text-6xl lg:text-7xl">
          Nunca enfrente<br />
          um dia difícil<br />
          <span class="accent-underline">sozinho.</span>
        </h1>

        <p class="mt-6 md:mt-8 text-lg md:text-xl text-text-mute max-w-xl mx-auto md:mx-0 leading-relaxed">
          Oração, palavra de Deus e uma escuta acolhedora — a qualquer hora, direto no seu WhatsApp. Sem app. Sem cadastro. Grátis.
        </p>

        <div class="mt-8 flex flex-col sm:flex-row gap-3 justify-center md:justify-start">
          <Button href={CTA_URL} variant="primary">
            <MessageCircle size={20} /> Começar no WhatsApp
          </Button>
          <Button href="#como-funciona" variant="secondary">
            Ver como funciona <ArrowDown size={18} />
          </Button>
        </div>
      </div>

      <div class="order-1 md:order-2">
        <PhoneMockup />
      </div>
    </div>
  </div>
</section>
```

- [ ] **Step 2: Renderizar Hero temporariamente em `src/pages/index.astro` pra visualizar**

Substituir o conteúdo de `src/pages/index.astro`:
```astro
---
import Base from '../layouts/Base.astro';
import Header from '../components/Header.astro';
import Hero from '../components/Hero.astro';
---
<Base title="Zapdafé — Companhia cristã 24h no WhatsApp" description="Oração, palavra e escuta acolhedora a qualquer hora. Grátis, sem cadastro, direto no seu WhatsApp.">
  <Header />
  <main>
    <Hero />
  </main>
</Base>
```

- [ ] **Step 3: Rodar dev server e verificar**

```bash
npm run dev
```
Abre `http://localhost:4321` e confirma: hero aparece, mockup renderiza com conversa, botões funcionam, responsivo (resize janela).

Depois interrompe com Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add hero section with headline, CTAs, and phone mockup"
```

---

## Task 8 — Seção "Como funciona"

**Files:**
- Create: `src/components/HowItWorks.astro`

- [ ] **Step 1: Criar `src/components/HowItWorks.astro`**

```astro
---
import { MousePointerClick, MessageSquare, Clock } from 'lucide-astro';

const steps = [
  {
    icon: MousePointerClick,
    title: 'Clique no botão',
    desc: 'Abrimos seu WhatsApp automaticamente.',
  },
  {
    icon: MessageSquare,
    title: 'Mande "oi"',
    desc: 'A Zapdafé responde na hora, sem espera.',
  },
  {
    icon: Clock,
    title: 'Converse quando quiser',
    desc: 'Dia, noite, madrugada. Sempre disponível.',
  },
];
---
<section id="como-funciona" class="bg-bg-alt py-20 md:py-28 border-y border-border">
  <div class="max-w-6xl mx-auto px-4 md:px-6">
    <div class="text-center max-w-2xl mx-auto mb-12 md:mb-16">
      <h2 class="font-serif font-bold text-3xl md:text-5xl leading-tight">
        Três passos. <span class="accent-underline">Simples assim.</span>
      </h2>
    </div>

    <div class="grid md:grid-cols-3 gap-6 md:gap-8">
      {steps.map((step, i) => (
        <div class="bg-bg border border-border rounded-2xl p-6 md:p-8 text-center md:text-left">
          <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-wa-green/10 text-wa-dark mb-4">
            <step.icon size={24} />
          </div>
          <div class="text-sm text-text-mute font-medium mb-2">Passo {i + 1}</div>
          <h3 class="font-serif font-bold text-xl md:text-2xl mb-2">{step.title}</h3>
          <p class="text-text-mute leading-relaxed">{step.desc}</p>
        </div>
      ))}
    </div>
  </div>
</section>
```

- [ ] **Step 2: Adicionar ao `index.astro`**

Adicionar `<HowItWorks />` depois de `<Hero />` e o import correspondente.

- [ ] **Step 3: Build e visual check**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add how-it-works section"
```

---

## Task 9 — Seção "O que você pode pedir" (Features)

**Files:**
- Create: `src/content/features.json`
- Create: `src/components/Features.astro`

- [ ] **Step 1: Criar `src/content/features.json`**

```json
[
  {
    "emoji": "🙏",
    "title": "Oração",
    "desc": "Peça uma oração personalizada pro que você tá vivendo.",
    "example": "Ora comigo pela saúde da minha mãe"
  },
  {
    "emoji": "💬",
    "title": "Desabafo",
    "desc": "Coloque pra fora o que tá pesando. Sem julgamento.",
    "example": "Preciso desabafar sobre meu trabalho"
  },
  {
    "emoji": "✨",
    "title": "Reflexão diária",
    "desc": "Uma palavra bíblica pra começar o dia.",
    "example": "Me manda uma palavra pra hoje"
  },
  {
    "emoji": "📖",
    "title": "Conselho à luz da Bíblia",
    "desc": "Dúvidas práticas com base nas Escrituras.",
    "example": "O que a Bíblia diz sobre perdão?"
  },
  {
    "emoji": "🌙",
    "title": "Companhia",
    "desc": "Nos momentos que ninguém mais pode acompanhar.",
    "example": "Não consigo dormir, tô com medo"
  }
]
```

- [ ] **Step 2: Criar `src/components/Features.astro`**

```astro
---
import features from '../content/features.json';
---
<section id="o-que-faz" class="py-20 md:py-28">
  <div class="max-w-6xl mx-auto px-4 md:px-6">
    <div class="text-center max-w-2xl mx-auto mb-12 md:mb-16">
      <h2 class="font-serif font-bold text-3xl md:text-5xl leading-tight">
        A Zapdafé tá aqui pra <span class="accent-underline">quando você precisar.</span>
      </h2>
    </div>

    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6">
      {features.map(f => (
        <article class="bg-bg-alt border border-border rounded-2xl p-6 hover:-translate-y-0.5 hover:shadow-md transition-all">
          <div class="text-3xl mb-3">{f.emoji}</div>
          <h3 class="font-serif font-bold text-xl mb-2">{f.title}</h3>
          <p class="text-text-mute mb-4 leading-relaxed">{f.desc}</p>
          <div class="text-sm text-text-mute italic border-l-2 border-accent pl-3">
            "{f.example}"
          </div>
        </article>
      ))}
    </div>
  </div>
</section>
```

- [ ] **Step 3: Adicionar ao `index.astro`**

Adicionar `<Features />` após `<HowItWorks />` e o import.

- [ ] **Step 4: Build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add features section with 5 use-case cards"
```

---

## Task 10 — Barra de prova/conforto

**Files:**
- Create: `src/components/ProofBar.astro`

- [ ] **Step 1: Criar `src/components/ProofBar.astro`**

```astro
---
const items = [
  { icon: '🕐', text: 'Disponível 24h' },
  { icon: '📱', text: 'Sem app pra baixar' },
  { icon: '✋', text: 'Sem cadastro' },
  { icon: '💚', text: 'Grátis pra sempre' },
];
---
<section class="bg-bg-alt border-y border-border py-8 md:py-10">
  <div class="max-w-6xl mx-auto px-4 md:px-6">
    <ul class="flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm md:text-base text-text-mute font-medium">
      {items.map(i => (
        <li class="flex items-center gap-2">
          <span class="text-lg">{i.icon}</span>
          <span>{i.text}</span>
        </li>
      ))}
    </ul>
  </div>
</section>
```

- [ ] **Step 2: Adicionar ao `index.astro` (depois de Features)**

- [ ] **Step 3: Build e commit**

```bash
npm run build
git add -A
git commit -m "feat: add proof bar with reassurance pills"
```

---

## Task 11 — FAQ

**Files:**
- Create: `src/content/faq.json`
- Create: `src/components/FAQ.astro`

- [ ] **Step 1: Criar `src/content/faq.json`**

```json
[
  {
    "q": "É uma inteligência artificial mesmo?",
    "a": "Sim. A Zapdafé é uma IA treinada em Bíblia e materiais cristãos, feita pra oferecer companhia espiritual. Ela não é um pastor, padre ou profissional de saúde mental."
  },
  {
    "q": "Custa alguma coisa?",
    "a": "Não. É totalmente grátis. A gente mantém no ar por amor ao propósito."
  },
  {
    "q": "Preciso me cadastrar ou baixar app?",
    "a": "Não. É só clicar no botão e mandar mensagem no WhatsApp que você já usa."
  },
  {
    "q": "Vocês guardam minhas conversas?",
    "a": "As mensagens ficam armazenadas no nosso servidor para permitir que a IA lembre do contexto da conversa com você. A gente não vende, não compartilha e não usa isso pra publicidade. Detalhes na Política de Privacidade."
  },
  {
    "q": "É de alguma igreja ou denominação?",
    "a": "Não. A Zapdafé é cristã sem denominação — respeita católicos, evangélicos e todas as tradições cristãs."
  },
  {
    "q": "E se eu tiver uma emergência de saúde mental?",
    "a": "A Zapdafé não substitui atendimento profissional. Se você está passando por um momento crítico, ligue 188 (CVV) — atendimento gratuito, 24h, sigiloso. Em emergência médica, ligue 192 (SAMU)."
  }
]
```

- [ ] **Step 2: Criar `src/components/FAQ.astro`**

```astro
---
import faqs from '../content/faq.json';
import { ChevronDown } from 'lucide-astro';
---
<section id="perguntas" class="py-20 md:py-28">
  <div class="max-w-3xl mx-auto px-4 md:px-6">
    <div class="text-center mb-12 md:mb-16">
      <h2 class="font-serif font-bold text-3xl md:text-5xl leading-tight">
        Perguntas <span class="accent-underline">frequentes.</span>
      </h2>
    </div>

    <div class="space-y-3">
      {faqs.map(item => (
        <details class="group bg-bg-alt border border-border rounded-2xl px-5 md:px-6 py-4 md:py-5 transition-all open:shadow-sm">
          <summary class="flex justify-between items-start gap-4 cursor-pointer list-none">
            <span class="font-serif font-bold text-lg md:text-xl text-text">{item.q}</span>
            <ChevronDown class="flex-shrink-0 mt-1 transition-transform group-open:rotate-180" size={20} />
          </summary>
          <p class="mt-3 text-text-mute leading-relaxed">{item.a}</p>
        </details>
      ))}
    </div>
  </div>
</section>
```

- [ ] **Step 3: Adicionar ao `index.astro`**

- [ ] **Step 4: Build e commit**

```bash
npm run build
git add -A
git commit -m "feat: add FAQ section with accordion"
```

---

## Task 12 — CTA final

**Files:**
- Create: `src/components/CTAFinal.astro`

- [ ] **Step 1: Criar `src/components/CTAFinal.astro`**

```astro
---
import Button from './Button.astro';
import { CTA_URL } from '../lib/constants';
import { MessageCircle } from 'lucide-astro';
---
<section class="bg-bg-alt border-t border-border py-20 md:py-28">
  <div class="max-w-3xl mx-auto px-4 md:px-6 text-center">
    <h2 class="font-serif font-bold text-4xl md:text-6xl leading-tight mb-8">
      Um zap de <span class="accent-underline">distância.</span>
    </h2>
    <Button href={CTA_URL} variant="primary">
      <MessageCircle size={22} /> Começar agora
    </Button>
  </div>
</section>
```

- [ ] **Step 2: Adicionar ao `index.astro`**

- [ ] **Step 3: Build e commit**

```bash
npm run build
git add -A
git commit -m "feat: add final CTA section"
```

---

## Task 13 — Footer

**Files:**
- Create: `src/components/Footer.astro`

- [ ] **Step 1: Criar `src/components/Footer.astro`**

```astro
---
import { EMAIL_CONTATO, ANO_ATUAL, SITE_NAME } from '../lib/constants';
---
<footer class="bg-bg border-t border-border py-12 md:py-16">
  <div class="max-w-6xl mx-auto px-4 md:px-6">
    <div class="grid md:grid-cols-3 gap-8 md:gap-12 mb-10">
      <div>
        <img src="/logo.svg" alt={SITE_NAME} class="h-8 w-auto mb-3" />
        <p class="text-sm text-text-mute">Feito com fé no Brasil 🇧🇷</p>
      </div>

      <div>
        <h4 class="font-serif font-bold text-base mb-3">Institucional</h4>
        <ul class="space-y-2 text-sm text-text-mute">
          <li><a href="/privacidade" class="hover:text-text transition-colors">Política de Privacidade</a></li>
          <li><a href="/termos" class="hover:text-text transition-colors">Termos de Uso</a></li>
          <li><a href="/aviso-importante" class="hover:text-text transition-colors">Aviso Importante</a></li>
        </ul>
      </div>

      <div>
        <h4 class="font-serif font-bold text-base mb-3">Contato</h4>
        <ul class="space-y-2 text-sm text-text-mute">
          <li><a href={`mailto:${EMAIL_CONTATO}`} class="hover:text-text transition-colors">{EMAIL_CONTATO}</a></li>
        </ul>
      </div>
    </div>

    <div class="border-t border-border pt-6 text-xs text-text-mute text-center md:text-left">
      © {ANO_ATUAL} {SITE_NAME} · A Zapdafé é uma IA e não substitui aconselhamento pastoral ou psicológico.
    </div>
  </div>
</footer>
```

- [ ] **Step 2: Adicionar ao `index.astro` (depois de `</main>`)**

Estrutura final do `index.astro`:
```astro
---
import Base from '../layouts/Base.astro';
import Header from '../components/Header.astro';
import Hero from '../components/Hero.astro';
import HowItWorks from '../components/HowItWorks.astro';
import Features from '../components/Features.astro';
import ProofBar from '../components/ProofBar.astro';
import FAQ from '../components/FAQ.astro';
import CTAFinal from '../components/CTAFinal.astro';
import Footer from '../components/Footer.astro';
---
<Base
  title="Zapdafé — Companhia cristã 24h no WhatsApp"
  description="Oração, palavra e escuta acolhedora a qualquer hora. Grátis, sem cadastro, direto no seu WhatsApp."
>
  <Header />
  <main>
    <Hero />
    <HowItWorks />
    <Features />
    <ProofBar />
    <FAQ />
    <CTAFinal />
  </main>
  <Footer />
</Base>
```

- [ ] **Step 3: Build e teste visual completo**

```bash
npm run build
npm run dev
```

Abre `http://localhost:4321`, verifica cada seção, testa nav âncoras, mobile menu, FAQ accordion.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add footer and assemble complete landing page"
```

---

## Task 14 — Layout para páginas legais

**Files:**
- Create: `src/layouts/Legal.astro`

- [ ] **Step 1: Criar `src/layouts/Legal.astro`**

```astro
---
import Base from './Base.astro';
import Header from '../components/Header.astro';
import Footer from '../components/Footer.astro';

interface Props {
  title: string;
  description: string;
  atualizadoEm: string;
}

const { title, description, atualizadoEm } = Astro.props;
---
<Base title={`${title} — Zapdafé`} description={description}>
  <Header />
  <main class="max-w-3xl mx-auto px-4 md:px-6 py-16 md:py-20">
    <article class="prose-legal">
      <h1 class="font-serif font-bold text-4xl md:text-5xl mb-3">{title}</h1>
      <p class="text-sm text-text-mute mb-10">Última atualização: {atualizadoEm}</p>
      <slot />
    </article>
  </main>
  <Footer />
</Base>

<style is:global>
  .prose-legal h2 {
    font-family: 'Fraunces', serif;
    font-weight: 700;
    font-size: 1.5rem;
    line-height: 1.3;
    margin-top: 2.5rem;
    margin-bottom: 1rem;
  }
  .prose-legal h3 {
    font-family: 'Fraunces', serif;
    font-weight: 500;
    font-size: 1.2rem;
    margin-top: 1.5rem;
    margin-bottom: 0.75rem;
  }
  .prose-legal p, .prose-legal li {
    line-height: 1.7;
    color: var(--text-mute);
    margin-bottom: 1rem;
  }
  .prose-legal ul, .prose-legal ol {
    padding-left: 1.5rem;
    margin-bottom: 1rem;
  }
  .prose-legal ul { list-style: disc; }
  .prose-legal ol { list-style: decimal; }
  .prose-legal a { color: var(--accent); text-decoration: underline; }
  .prose-legal strong { color: var(--text); font-weight: 600; }
</style>
```

- [ ] **Step 2: Build e commit**

```bash
npm run build
git add -A
git commit -m "feat: add Legal layout for policy pages"
```

---

## Task 15 — Página `/privacidade`

**Files:**
- Create: `src/pages/privacidade.astro`

- [ ] **Step 1: Criar `src/pages/privacidade.astro`**

```astro
---
import Legal from '../layouts/Legal.astro';
import { SITE_NAME, EMAIL_CONTATO, CNPJ, RAZAO_SOCIAL, ENDERECO, PROVEDOR_IA, RETENCAO_MSGS } from '../lib/constants';
---
<Legal
  title="Política de Privacidade"
  description="Como a Zapdafé coleta, usa e protege seus dados."
  atualizadoEm="31 de agosto de 2026"
>
  <h2>1. Quem somos</h2>
  <p>
    O <strong>{SITE_NAME}</strong> é um serviço operado por <strong>{RAZAO_SOCIAL}</strong>, inscrita no CNPJ sob nº <strong>{CNPJ}</strong>, com sede em <strong>{ENDERECO}</strong>.
  </p>
  <p>Para qualquer questão sobre dados pessoais, entre em contato pelo email <a href={`mailto:${EMAIL_CONTATO}`}>{EMAIL_CONTATO}</a>.</p>

  <h2>2. Quais dados coletamos</h2>
  <p>Quando você usa o Zapdafé, coletamos:</p>
  <ul>
    <li><strong>Seu número de WhatsApp</strong> — necessário para você conversar com a IA;</li>
    <li><strong>O conteúdo das mensagens</strong> que você troca com a IA (texto, áudio transcrito, imagens que você enviar);</li>
    <li><strong>Metadados técnicos</strong> — horário das mensagens, tipo de dispositivo (quando disponível via WhatsApp).</li>
  </ul>
  <p>Não coletamos foto de perfil, lista de contatos, localização ou qualquer outro dado do seu WhatsApp além do que você nos envia.</p>

  <h2>3. Como usamos seus dados</h2>
  <ul>
    <li><strong>Prestar o serviço</strong> — a IA precisa do histórico da conversa para responder com contexto;</li>
    <li><strong>Melhorar a qualidade das respostas</strong> — analisamos padrões (nunca conteúdo individual identificado) para ajustar a IA;</li>
    <li><strong>Prevenir abuso</strong> — bloquear spam, uso indevido e violações dos Termos.</li>
  </ul>

  <h2>4. Base legal</h2>
  <p>Conforme a Lei Geral de Proteção de Dados (LGPD, Lei 13.709/2018), tratamos seus dados com base em:</p>
  <ul>
    <li><strong>Execução de contrato</strong> (art. 7º, V) — para prestar o serviço que você solicitou;</li>
    <li><strong>Legítimo interesse</strong> (art. 7º, IX) — para melhorar o serviço e prevenir fraudes.</li>
  </ul>

  <h2>5. Com quem compartilhamos</h2>
  <p>Trabalhamos com provedores essenciais para o funcionamento do serviço:</p>
  <ul>
    <li><strong>WhatsApp (Meta Platforms Inc.)</strong> — canal de mensagens;</li>
    <li><strong>Uazapi</strong> — infraestrutura de integração com o WhatsApp;</li>
    <li><strong>{PROVEDOR_IA}</strong> — provedor da inteligência artificial que gera as respostas.</li>
  </ul>
  <p><strong>Não vendemos, alugamos ou trocamos seus dados pessoais com terceiros para fins de marketing.</strong></p>

  <h2>6. Por quanto tempo guardamos</h2>
  <p>Suas mensagens ficam armazenadas por <strong>{RETENCAO_MSGS}</strong>, prazo necessário para manter contexto da conversa. Após esse período, os dados são excluídos automaticamente.</p>
  <p>Se você solicitar exclusão total, atendemos em até 15 dias.</p>

  <h2>7. Seus direitos</h2>
  <p>Pela LGPD, você tem direito a:</p>
  <ul>
    <li>Confirmar se tratamos seus dados;</li>
    <li>Acessar os dados que temos sobre você;</li>
    <li>Corrigir dados incompletos ou desatualizados;</li>
    <li>Solicitar exclusão dos seus dados;</li>
    <li>Solicitar portabilidade para outro serviço;</li>
    <li>Revogar seu consentimento a qualquer momento.</li>
  </ul>

  <h2>8. Como exercer seus direitos</h2>
  <p>Envie um email para <a href={`mailto:${EMAIL_CONTATO}`}>{EMAIL_CONTATO}</a> com o assunto "LGPD — [seu pedido]". Responderemos em até 15 dias.</p>

  <h2>9. Segurança</h2>
  <p>Adotamos medidas técnicas e administrativas razoáveis para proteger seus dados: acesso restrito, criptografia em trânsito, monitoramento contra intrusões. Nenhum sistema é 100% seguro, mas trabalhamos continuamente para reduzir riscos.</p>

  <h2>10. Menores de idade</h2>
  <p>O Zapdafé não é destinado a menores de 13 anos. Menores entre 13 e 18 devem usar apenas com consentimento dos responsáveis.</p>

  <h2>11. Alterações nesta política</h2>
  <p>Podemos atualizar esta política. Mudanças significativas serão comunicadas pelo próprio WhatsApp ou por email. A data no topo indica a última atualização.</p>
</Legal>
```

- [ ] **Step 2: Build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add privacy policy page"
```

---

## Task 16 — Página `/termos`

**Files:**
- Create: `src/pages/termos.astro`

- [ ] **Step 1: Criar `src/pages/termos.astro`**

```astro
---
import Legal from '../layouts/Legal.astro';
import { SITE_NAME, EMAIL_CONTATO, RAZAO_SOCIAL, CNPJ, FORO } from '../lib/constants';
---
<Legal
  title="Termos de Uso"
  description="Regras para usar a Zapdafé."
  atualizadoEm="31 de agosto de 2026"
>
  <h2>1. Aceitação dos termos</h2>
  <p>Ao enviar sua primeira mensagem para o {SITE_NAME}, você concorda com estes Termos de Uso. Se não concordar, não use o serviço.</p>

  <h2>2. O que é o serviço</h2>
  <p>O {SITE_NAME} é uma companhia espiritual cristã baseada em inteligência artificial, disponibilizada gratuitamente via WhatsApp. Oferece oração, escuta, reflexões bíblicas e conversa espiritual — <strong>não é um serviço profissional de aconselhamento pastoral, psicológico ou médico</strong>.</p>

  <h2>3. Quem opera</h2>
  <p>O serviço é operado por <strong>{RAZAO_SOCIAL}</strong>, CNPJ <strong>{CNPJ}</strong>.</p>

  <h2>4. Elegibilidade</h2>
  <p>O serviço é destinado a maiores de 18 anos. Adolescentes entre 13 e 17 anos podem usar apenas com autorização dos responsáveis legais. Não é permitido o uso por menores de 13 anos.</p>

  <h2>5. Uso permitido</h2>
  <p>Você pode usar o {SITE_NAME} para:</p>
  <ul>
    <li>Buscar companhia espiritual, oração e reflexão;</li>
    <li>Fazer perguntas sobre a Bíblia e vida cristã;</li>
    <li>Desabafar sobre o que está sentindo.</li>
  </ul>

  <h2>6. Uso proibido</h2>
  <p>É proibido:</p>
  <ul>
    <li>Assediar, ofender ou usar linguagem de ódio;</li>
    <li>Enviar spam, propaganda ou tentar comercializar produtos/serviços;</li>
    <li>Tentar extrair prompts, contornar filtros de segurança ou fazer engenharia reversa da IA;</li>
    <li>Usar o serviço para fins comerciais sem autorização escrita;</li>
    <li>Compartilhar informações de terceiros sem consentimento;</li>
    <li>Usar em atividades ilegais.</li>
  </ul>
  <p>Violações podem resultar em bloqueio imediato do seu número, sem aviso prévio.</p>

  <h2>7. Limite de responsabilidade</h2>
  <p><strong>A Zapdafé é uma inteligência artificial e pode cometer erros.</strong> Não somos responsáveis por decisões que você tomar com base nas respostas da IA.</p>
  <p>Especificamente:</p>
  <ul>
    <li>A Zapdafé <strong>não substitui aconselhamento pastoral</strong> — para questões espirituais profundas, procure sua igreja/comunidade;</li>
    <li>A Zapdafé <strong>não substitui atendimento psicológico ou psiquiátrico</strong> — em crise, ligue 188 (CVV);</li>
    <li>A Zapdafé <strong>não substitui atendimento médico</strong> — em emergência, ligue 192 (SAMU).</li>
  </ul>

  <h2>8. Propriedade intelectual</h2>
  <p>A marca "{SITE_NAME}", o site, o design e o sistema são de propriedade de {RAZAO_SOCIAL}. O conteúdo das suas conversas pertence a você.</p>

  <h2>9. Suspensão e encerramento</h2>
  <p>Podemos suspender ou encerrar seu acesso a qualquer momento, com ou sem aviso, especialmente em caso de violação destes Termos. Você pode parar de usar o serviço a qualquer momento — basta não mandar mais mensagens.</p>

  <h2>10. Alterações destes Termos</h2>
  <p>Podemos atualizar estes Termos. A versão atual estará sempre em <a href="/termos">zapdafe.com.br/termos</a>. Ao continuar usando após uma atualização, você aceita a nova versão.</p>

  <h2>11. Foro e legislação aplicável</h2>
  <p>Estes Termos são regidos pela legislação brasileira. Fica eleito o foro da comarca de <strong>{FORO}</strong> para dirimir qualquer disputa, com renúncia expressa a qualquer outro.</p>

  <h2>12. Contato</h2>
  <p>Dúvidas sobre estes Termos: <a href={`mailto:${EMAIL_CONTATO}`}>{EMAIL_CONTATO}</a>.</p>
</Legal>
```

- [ ] **Step 2: Build e commit**

```bash
npm run build
git add -A
git commit -m "feat: add terms of use page"
```

---

## Task 17 — Página `/aviso-importante`

**Files:**
- Create: `src/pages/aviso-importante.astro`

- [ ] **Step 1: Criar `src/pages/aviso-importante.astro`**

```astro
---
import Legal from '../layouts/Legal.astro';
---
<Legal
  title="Aviso Importante"
  description="A Zapdafé é uma IA. Entenda os limites e como buscar ajuda profissional quando necessário."
  atualizadoEm="31 de agosto de 2026"
>
  <p><strong>Este aviso é curto de propósito. Leia com atenção — pode fazer diferença um dia.</strong></p>

  <h2>A Zapdafé é uma IA</h2>
  <p>Não é um pastor. Não é um padre. Não é um psicólogo. Não é um médico. É uma inteligência artificial treinada em textos cristãos e desenhada pra oferecer companhia espiritual.</p>
  <p>Ela pode dizer coisas erradas, imprecisas ou inadequadas. Sempre valide com uma pessoa de confiança quando o assunto for sério.</p>

  <h2>Em crise emocional, ligue 188</h2>
  <p>O <strong>CVV (Centro de Valorização da Vida)</strong> oferece apoio emocional gratuito, 24 horas por dia, com total sigilo:</p>
  <ul>
    <li><strong>Telefone:</strong> 188 (ligação gratuita de qualquer lugar do Brasil)</li>
    <li><strong>Chat:</strong> <a href="https://www.cvv.org.br" target="_blank" rel="noopener noreferrer">cvv.org.br</a></li>
  </ul>

  <h2>Em emergência médica</h2>
  <ul>
    <li><strong>SAMU:</strong> 192</li>
    <li><strong>Bombeiros:</strong> 193</li>
    <li><strong>Polícia:</strong> 190</li>
  </ul>

  <h2>Para orientação espiritual profunda</h2>
  <p>Procure sua comunidade de fé — pastor, padre, líder espiritual da sua confiança. A Zapdafé é uma companhia, não um substituto pra relação humana e pastoral.</p>

  <h2>Segurança nas conversas</h2>
  <p>Nunca compartilhe no chat:</p>
  <ul>
    <li>Senhas ou dados bancários;</li>
    <li>Números de cartão;</li>
    <li>Informações sensíveis de terceiros (sem consentimento deles).</li>
  </ul>
  <p>A Zapdafé nunca vai pedir esse tipo de informação. Se algo assim aparecer, é fraude — nos avise em <a href="/privacidade">Política de Privacidade</a>.</p>

  <p style="margin-top: 3rem; font-style: italic;">Que Deus te guarde. Se você tá lendo isso num momento difícil, saiba: você não tá sozinho. Peça ajuda.</p>
</Legal>
```

- [ ] **Step 2: Build e commit**

```bash
npm run build
git add -A
git commit -m "feat: add important notice page with crisis resources"
```

---

## Task 18 — Assets estáticos (logo, favicon, robots)

**Files:**
- Create: `public/logo.svg`
- Create: `public/favicon.svg`
- Create: `public/robots.txt`

- [ ] **Step 1: Salvar `public/logo.svg`**

Se o usuário tem o arquivo SVG da logo, colocar em `public/logo.svg`. Caso contrário, criar placeholder textual:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 80" width="300" height="80">
  <text x="0" y="55" font-family="serif" font-size="48" font-weight="700" fill="#1A1A1A">Zap<tspan font-weight="400">da</tspan><tspan font-weight="700">fé</tspan></text>
</svg>
```
**Nota:** substituir pela logo real fornecida pelo dono.

- [ ] **Step 2: Salvar `public/favicon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" rx="7" fill="#F5EFE4"/>
  <text x="16" y="23" text-anchor="middle" font-family="serif" font-size="22" font-weight="700" fill="#1A1A1A">Z</text>
</svg>
```

- [ ] **Step 3: Criar `public/robots.txt`**

```
User-agent: *
Allow: /
Disallow: /mensagem

Sitemap: https://zapdafe.com.br/sitemap-index.xml
```

- [ ] **Step 4: Build e commit**

```bash
npm run build
git add -A
git commit -m "feat: add logo, favicon, and robots.txt"
```

---

## Task 19 — Cloudflare Web Analytics

**Files:**
- Modify: `src/layouts/Base.astro`

- [ ] **Step 1: Adicionar prop opcional e snippet no Base.astro**

Editar `src/layouts/Base.astro`, na tag `<head>`, adicionar antes do `<slot name="head" />`:

```astro
<script
  defer
  src="https://static.cloudflareinsights.com/beacon.min.js"
  data-cf-beacon='{"token": "<<TODO: token do Cloudflare Web Analytics>>"}'
></script>
```

**Nota:** o token real vem do painel Cloudflare depois que o site estiver publicado. Deixar `<<TODO>>` até lá.

- [ ] **Step 2: Build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add Cloudflare Web Analytics beacon (token pending)"
```

---

## Task 20 — README com instruções de deploy

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Sobrescrever `README.md`**

```markdown
# Zapdafé — Site institucional

Site estático em Astro para zapdafe.com.br.

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
- `public/` — assets estáticos (logo, favicon, fontes, robots)

## Antes de deployar

Preencher os `<<TODO>>` em `src/lib/constants.ts`:
- `RAZAO_SOCIAL` — razão social do CNPJ 54.062.495/0001-02
- `ENDERECO` — endereço completo
- `PROVEDOR_IA` — nome do provedor de IA usado
- `RETENCAO_MSGS` — tempo de retenção real
- `FORO` — cidade/UF do foro nos Termos

E o token do Cloudflare Web Analytics em `src/layouts/Base.astro`.

Rodar `grep -r '<<TODO' src/` — não pode retornar nada antes de publicar.

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
7. Ir em **Web Analytics**, criar um site pointing to `zapdafe.com.br`, copiar o token, substituir o `<<TODO>>` no `Base.astro`, commitar e novo deploy roda automático.
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "docs: add README with dev, build, and deploy instructions"
```

---

## Task 21 — Verificação final e placeholders scan

- [ ] **Step 1: Build limpo**

```bash
rm -rf dist node_modules/.astro
npm run build
```
Expected: build completa sem warnings de acessibilidade nem erros de tipo.

- [ ] **Step 2: Rodar dev server e clicar em cada link**

```bash
npm run dev
```

Checklist manual:
- [ ] Landing carrega
- [ ] Hero mockup aparece
- [ ] Nav âncoras funcionam (Como funciona / O que faz / Perguntas)
- [ ] Botão "Começar no WhatsApp" leva pra `zapdafe.com.br/mensagem`
- [ ] FAQ accordion abre e fecha
- [ ] Menu mobile abre e fecha (redimensionar janela pra <768px)
- [ ] `/privacidade` carrega e renderiza corretamente
- [ ] `/termos` carrega
- [ ] `/aviso-importante` carrega
- [ ] Links do footer funcionam

- [ ] **Step 3: Grep de placeholders**

```bash
grep -r '<<TODO' src/
```
Expected: lista dos `<<TODO>>` conhecidos (constants + Cloudflare token). Confirmar que são só os esperados.

- [ ] **Step 4: Commit final se algo mudou**

```bash
git status
# se limpo, nada a fazer
```

---

## Auto-review (checklist da skill)

**Cobertura do spec:**
- ✅ Landing com 8 seções — Tasks 5–13
- ✅ Página privacidade — Task 15
- ✅ Página termos — Task 16
- ✅ Página aviso — Task 17
- ✅ Sistema visual (tokens, fontes, tipografia) — Task 2
- ✅ Arquitetura de arquivos exata do spec — respeitada
- ✅ Constantes centralizadas — Task 3
- ✅ SEO (OG, meta, sitemap, robots) — Tasks 3, 18
- ✅ Cloudflare Web Analytics — Task 19
- ✅ README com passos de deploy — Task 20
- ✅ Remoção da Redirect Rule raiz — documentada em Task 20

**Placeholders:** os `<<TODO>>` remanescentes são **intencionais** (dados que só o dono tem) e centralizados em `src/lib/constants.ts` + um único no `Base.astro` (analytics token). Todos flagged no README.

**Consistência de tipos/nomes:** Base/Legal aceitam mesmas props (`title`, `description`); componentes de landing são todos self-contained sem dependência cruzada além de `Button` e `constants`.

## Handoff de execução

Este plano pode ser executado de duas formas:

**1. Subagent-Driven (recomendado para tarefas grandes)** — dispatch de subagent fresh por task, review entre tasks.

**2. Inline (mais direto)** — executar tasks em sequência na mesma sessão.

Dado que o projeto é greenfield, contido e o usuário está em auto mode com direção explícita "cria tudo você", a recomendação é **execução inline**.
