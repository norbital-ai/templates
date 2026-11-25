import { defineConfig } from 'vitest/config';

// `bolt test` brings svelte, the kit's resolution, `$bolt` and the timeouts; its config reaches the root project only,
// so the suite is one project. Node's own `localStorage` (undefined without a file) shadows the DOM environment's.
export default defineConfig({
	test: { include: ['tests/**/*.test.ts'], execArgv: ['--no-experimental-webstorage'] }
});
