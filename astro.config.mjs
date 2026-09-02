// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://zapdafe.com.br',
  integrations: [
    sitemap({
      filter: (page) =>
        !page.includes('/admin') && !page.includes('/admin-login'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
