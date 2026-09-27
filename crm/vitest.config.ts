import { defineConfig } from 'vitest/config';

// `bolt test` brings svelte, the kit's resolution, `$bolt` and the timeouts.
// Node's own `localStorage` (undefined without a file) shadows the DOM environment's in the sweep
export default defineConfig({
	test: { include: ['tests/**/*.test.ts'], execArgv: ['--no-experimental-webstorage'] }
});
