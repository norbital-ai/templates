import { defineConfig } from 'vitest/config';

export default defineConfig({
	// `bolt test` brings svelte, the kit's resolution, `$bolt`, the DOM conditions and the timeouts
	test: {
		// Node's own `localStorage` (empty without a file) shadows happy-dom's
		execArgv: ['--no-experimental-webstorage'],
		include: ['tests/**/*.test.ts']
	}
});
