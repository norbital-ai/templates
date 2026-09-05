import path from 'node:path';
import { createRequire } from 'node:module';
import { defineConfig } from 'vite';
import { boltPlugin } from '@norbital-ai/bolt/vite';

const require = createRequire(import.meta.url);
const pdqRoot = path.dirname(require.resolve('pdq-wasm/package.json'));
const pdqRuntimeFiles = [
	'package.json',
	'dist/index.js',
	'dist/pdq.js',
	'dist/browser.js',
	'wasm/pdq.js',
	'wasm/pdq.wasm'
];

export default defineConfig({
	plugins: [
		boltPlugin({
			serverAssets: pdqRuntimeFiles.map((relative) => ({
				source: path.join(pdqRoot, relative),
				target: path.join('node_modules/pdq-wasm', relative)
			}))
		})
	]
});
