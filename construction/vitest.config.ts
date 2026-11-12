import { defineConfig } from 'vitest/config';

// `bolt test` brings svelte, the kit's resolution and the timeouts
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
