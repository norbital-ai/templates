import { defineConfig } from 'vite';
import { boltPlugin } from '@norbital-ai/bolt/vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	plugins: [
		boltPlugin(),
		{
			name: 'kiosk-face-models',
			apply: 'build',
			buildStart() {
				for (const model of ['antispoof', 'blazeface', 'facemesh', 'faceres', 'iris']) {
					for (const suffix of ['.json', '.bin']) {
						const name = `${model}${suffix}`;
						const source = fileURLToPath(
							new URL(`./node_modules/@vladmandic/human/models/${name}`, import.meta.url)
						);
						this.addWatchFile(source);
						this.emitFile({
							type: 'asset',
							fileName: `models/human/${name}`,
							source: readFileSync(source)
						});
					}
				}
			}
		}
	]
});
