/**
 * Renders the kiosk's narration clips from the one phrase list the kiosk speaks.
 *
 * Reads `src/lib/kiosk/phrases.ts` (every key, every language) and writes one clip per phrase and
 * language to `assets/kiosk-voice/<language>/<key>.<format>`, which the `kiosk-voice-clips` plugin
 * in `vite.config.ts` ships beside the face models. Re-runnable: an existing clip is kept unless
 * `--force` is given; a phrase removed from the list leaves a stale file this script deletes.
 * The kiosk never speaks through the browser: a key with no clip is silent, so run this after
 * every copy change in phrases.ts.
 *
 *   node scripts/generate-kiosk-voice.mjs
 *   node scripts/generate-kiosk-voice.mjs --force                      (re-render everything)
 *   node scripts/generate-kiosk-voice.mjs --language=zh --only=checked_in
 *
 * Voices are Microsoft Edge's free neural voices through the `edge-tts` Python package
 * (`pip install edge-tts`). Female voices at +15% rate: en-US-AriaNeural (en) and
 * zh-CN-XiaoxiaoNeural (zh); `python3 -m edge_tts --list-voices` lists the rest. The English voice
 * is American by the owner's preference; en-US-AvaNeural is the warmer alternative if Aria reads
 * too much like a newsreader. Override with --voice-en=... --voice-zh=... Writes MP3 directly.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	KIOSK_PHRASES,
	KIOSK_PHRASE_KEYS,
	KIOSK_VOICE_CLIP_FORMAT,
	KIOSK_VOICE_LANGUAGES
} from '../src/lib/kiosk/phrases.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const outputRoot = path.join(root, 'assets', 'kiosk-voice');

const options = Object.fromEntries(
	process.argv.slice(2).map((argument) => {
		const [flag, value = 'true'] = argument.replace(/^--/, '').split('=');
		return [flag, value];
	})
);
const force = options.force === 'true';
const languages =
	options.language === undefined
		? KIOSK_VOICE_LANGUAGES
		: options.language.split(',').filter((language) => KIOSK_VOICE_LANGUAGES.includes(language));
const keys =
	options.only === undefined
		? KIOSK_PHRASE_KEYS
		: options.only.split(',').filter((key) => KIOSK_PHRASE_KEYS.includes(key));

const DEFAULT_VOICES = { en: 'en-US-AriaNeural', zh: 'zh-CN-XiaoxiaoNeural' };

const voiceFor = (language) => options[`voice-${language}`] ?? DEFAULT_VOICES[language];

/** Spoken a little faster than the vendor's baseline (`--rate`, default +15%). */
const render = (text, language, target) => {
	const result = spawnSync(
		'python3',
		[
			'-m',
			'edge_tts',
			'--voice',
			voiceFor(language),
			`--rate=${options.rate ?? '+15%'}`,
			'--text',
			text,
			'--write-media',
			target
		],
		{ stdio: ['ignore', 'ignore', 'pipe'] }
	);
	if (result.status !== 0)
		throw new Error(`edge_tts failed for ${language}: ${result.stderr?.toString() ?? ''}`);
};

if (spawnSync('python3', ['-c', 'import edge_tts'], { stdio: 'ignore' }).status !== 0)
	throw new Error('Rendering needs the edge_tts Python module: pip install edge-tts');

let written = 0;
for (const language of languages) {
	const directory = path.join(outputRoot, language);
	mkdirSync(directory, { recursive: true });
	for (const key of keys) {
		const text = KIOSK_PHRASES[key][language];
		const target = path.join(directory, `${key}.${KIOSK_VOICE_CLIP_FORMAT}`);
		if (existsSync(target) && !force) {
			console.log(
				`skip ${language}/${key}.${KIOSK_VOICE_CLIP_FORMAT} (already recorded; --force overwrites)`
			);
			continue;
		}
		render(text, language, target);
		written += 1;
		console.log(`${language}/${key}.${KIOSK_VOICE_CLIP_FORMAT}  ${voiceFor(language)}  "${text}"`);
	}
	// A full run for this language owns the directory: clips for phrases no longer listed go.
	if (options.only === undefined) {
		for (const file of readdirSync(directory)) {
			const key = file.replace(new RegExp(`\\.${KIOSK_VOICE_CLIP_FORMAT}$`), '');
			if (!KIOSK_PHRASE_KEYS.includes(key)) {
				unlinkSync(path.join(directory, file));
				console.log(`removed stale ${language}/${file}`);
			}
		}
	}
}
console.log(`${written} clip(s) written under ${path.relative(root, outputRoot)} with edge.`);
