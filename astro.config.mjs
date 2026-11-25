import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://ivan-guirola.github.io',
  trailingSlash: 'always',
  integrations: [
    sitemap({ filter: (page) => !/\/projects\/[^/]+\/$/.test(page) }),
  ],
});
