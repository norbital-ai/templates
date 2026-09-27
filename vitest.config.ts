import { defineConfig } from 'vitest/config';

// `bolt test` brings svelte, the kit's resolution, `$bolt` and the DOM conditions.
export default defineConfig({
	test: {
		// `pnpm test:e2e` runs the surface sweep alone
		include: process.env['E2E'] ? ['tests/e2e/**/*.test.ts'] : ['tests/*.test.ts'],
		testTimeout: 180_000,
		hookTimeout: 60_000,
		fileParallelism: false,
		execArgv: ['--no-experimental-webstorage']
	}
});
