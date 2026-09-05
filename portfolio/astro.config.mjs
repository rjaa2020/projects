import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://rjaa2020.github.io',
  base: process.env.SITE_BASE ?? '/projects',
});
