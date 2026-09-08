import { defineConfig } from 'vite';
import { boltPlugin } from '@norbital-ai/bolt/vite';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	KIOSK_PHRASE_KEYS,
	KIOSK_VOICE_CLIP_FORMAT,
	KIOSK_VOICE_LANGUAGES
} from './src/lib/kiosk/phrases.ts';
import { KIOSK_REQUIRED_MODELS } from './src/lib/kiosk/config.ts';

export default defineConfig({
	plugins: [
		boltPlugin(),
		{
			name: 'kiosk-face-models',
			apply: 'build',
			buildStart() {
				// The gate is the supply. `KIOSK_REQUIRED_MODELS` is what the kiosk refuses to start
				// without, so it is exactly what the build must ship. A second hand-kept copy of the
				// list here could drift from it, and that drift fails silently: a missing graph does
				// not fail `load()`, it fails `detect()` on the first face, and the kiosk sits in
				// `unavailable` having scanned nobody. One list, imported — not restated.
				for (const model of KIOSK_REQUIRED_MODELS) {
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
				for (const [name, relative] of [
					['minifasnet.onnx', './assets/models/minifasnet.onnx'],
					['LICENSE.minivision', './assets/models/LICENSE.minivision'],
					['LICENSE.onnxruntime', './assets/models/LICENSE.onnxruntime'],
					[
						'ThirdPartyNotices.onnxruntime.txt',
						'./assets/models/ThirdPartyNotices.onnxruntime.txt'
					],
					[
						'ort-wasm-simd-threaded.wasm',
						'./node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm'
					],
					[
						'ort-wasm-simd-threaded.mjs',
						'./node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs'
					]
				] as const) {
					const source = fileURLToPath(new URL(relative, import.meta.url));
					this.addWatchFile(source);
					this.emitFile({
						type: 'asset',
						fileName: `models/minifas/${name}`,
						source: readFileSync(source)
					});
				}
			}
		},
		{
			/**
			 * The narration clips, one per phrase and language, emitted at `kiosk-voice/<language>/
			 * <key>.<format>` beside the face models so the kiosk resolves them from its own chunk
			 * (`KIOSK_VOICE_BASE`). The set is the phrase list's, not the directory's: a clip the list
			 * no longer names is not shipped, and a phrase without a clip fails the build here rather
			 * than being discovered as a silent kiosk on the tablet (there is no browser-speech
			 * fallback). Regenerate with `node scripts/generate-kiosk-voice.mjs`.
			 */
			name: 'kiosk-voice-clips',
			apply: 'build',
			buildStart() {
				const missing: string[] = [];
				for (const language of KIOSK_VOICE_LANGUAGES) {
					for (const key of KIOSK_PHRASE_KEYS) {
						const name = `${language}/${key}.${KIOSK_VOICE_CLIP_FORMAT}`;
						const source = fileURLToPath(new URL(`./assets/kiosk-voice/${name}`, import.meta.url));
						if (!existsSync(source)) {
							missing.push(name);
							continue;
						}
						this.addWatchFile(source);
						this.emitFile({
							type: 'asset',
							fileName: `kiosk-voice/${name}`,
							source: readFileSync(source)
						});
					}
				}
				if (missing.length > 0)
					this.error(
						`kiosk voice clips missing (the kiosk would be silent for them): ${missing.join(', ')}. Run node scripts/generate-kiosk-voice.mjs.`
					);
			}
		}
	]
});
