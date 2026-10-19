import { defineConfig } from 'vitest/config';
import templateConfig from './vitest.config.ts';

export default defineConfig({
	...templateConfig,
	resolve: { ...templateConfig.resolve, dedupe: ['effect', '@effect/vitest', 'vitest'] },
	test: {
		...templateConfig.test,
		include: ['tests/*.test.ts'],
		maxWorkers: 1,
		execArgv: ['--no-node-snapshot', '--no-experimental-webstorage']
	}
});
