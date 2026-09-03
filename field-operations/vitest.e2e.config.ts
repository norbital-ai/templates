import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		name: 'e2e',
		include: ['tests/e2e/**/*.test.ts'],
		environment: 'node',
		testTimeout: 180_000,
		hookTimeout: 60_000,
		maxWorkers: 1,
		fileParallelism: false
	}
});
