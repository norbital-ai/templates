import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `bolt test` brings svelte, `$bolt`, the kit's timeouts and its worker pool; every suite runs under it.
// Human's `exports` list `node` first and no `browser`: the sweep's face-enrolment page takes the browser ESM build by path,
// not the node one (which needs tfjs-node).
const human = fileURLToPath(
	new URL('node_modules/@vladmandic/human/dist/human.esm.js', import.meta.url)
);

export default defineConfig({
	resolve: { alias: [{ find: /^@vladmandic\/human$/, replacement: human }] },
	test: {
		include: ['tests/**/*.test.ts'],
		// Node's own `localStorage` (undefined without a file) shadows the DOM environment's in the sweep
		execArgv: ['--no-experimental-webstorage']
	}
});
