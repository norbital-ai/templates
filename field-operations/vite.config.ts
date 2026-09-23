import path from 'node:path';
import { createRequire } from 'node:module';
import { defineConfig } from 'vite';
import { boltPlugin } from '@norbital-ai/bolt/vite';

const require = createRequire(import.meta.url);
const pdqRoot = path.dirname(require.resolve('pdq-wasm/package.json'));

export default defineConfig({
	plugins: [
		boltPlugin({
			// The only file the guest reads: `pdq.ts` instantiates this WASM itself, without the JS glue.
			serverAssets: [
				{
					source: path.join(pdqRoot, 'wasm/pdq.wasm'),
					target: 'node_modules/pdq-wasm/wasm/pdq.wasm'
				}
			]
		})
	]
});
