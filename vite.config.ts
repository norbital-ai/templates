import { defineConfig } from 'vite';
import { boltPlugin } from '@norbital-ai/bolt/vite';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	KIOSK_PHRASE_KEYS,
	KIOSK_VOICE_CLIP_FORMAT,
	KIOSK_VOICE_LANGUAGES
} from './src/lib/kiosk/phrases.ts';

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
		},
		{
			/**
			 * The narration clips, one per phrase and language, emitted at `kiosk-voice/<language>/
			 * <key>.<format>` beside the face models so the kiosk resolves them from its own chunk
			 * (`KIOSK_VOICE_BASE`). The set is the phrase list's, not the directory's: a clip the list
			 * no longer names is not shipped, and a phrase without a clip is warned about here, at
			 * build time, rather than discovered as a fallback to browser speech on the tablet.
			 * Regenerate with `node scripts/generate-kiosk-voice.mjs`.
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
					this.warn(
						`kiosk voice clips missing (the kiosk will fall back to browser speech for them): ${missing.join(', ')}. Run node scripts/generate-kiosk-voice.mjs.`
					);
			}
		}
	]
});
