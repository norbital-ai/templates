import { defineConfig } from 'vitest/config';

// `bolt test` brings svelte, the kit's resolution, `$bolt`, the DOM conditions and the timeouts.
export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		// Node's own `localStorage` (undefined without a file) shadows the DOM environment's in the sweep
		execArgv: ['--no-experimental-webstorage']
	}
});
