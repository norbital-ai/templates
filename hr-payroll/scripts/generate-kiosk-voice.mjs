/**
 * Renders the kiosk's narration clips from the one phrase list the kiosk speaks.
 *
 * Reads `src/lib/kiosk/phrases.ts` (every key, every language) and writes one clip per phrase and
 * language to `assets/kiosk-voice/<language>/<key>.<format>`, which the `kiosk-voice-clips` plugin
 * in `vite.config.ts` ships beside the face models. Re-runnable: an existing clip is kept, never
 * overwritten (recordings are source material); a phrase removed from the list leaves a stale file
 * this script deletes.
 *
 *   node scripts/generate-kiosk-voice.mjs --provider=macos
 *   node scripts/generate-kiosk-voice.mjs --provider=gemini            (needs GEMINI_API_KEY)
 *   node scripts/generate-kiosk-voice.mjs --provider=macos --language=zh --only=checked_in
 *
 * Providers:
 *   macos   `say -v <voice>` renders to AIFF, `afconvert` encodes it. Voices per language default
 *           to Samantha (en) and Tingting (zh); `say -v '?'` lists what is installed. Override with
 *           --voice-en=Daniel --voice-zh=Meijia.
 *   gemini  Gemini TTS (`gemini-2.5-flash-preview-tts`) over the REST API. Returns 24 kHz 16-bit
 *           mono PCM, which is wrapped as WAV and encoded by `afconvert` (macOS) or `ffmpeg`.
 *           Voices default to Kore (en) and Leda (zh); any prebuilt Gemini voice works for either.
 *           Override with --voice-en=... --voice-zh=...
 *
 * The output container is `KIOSK_VOICE_CLIP_FORMAT` from the phrase list (mp3). Both encoders
 * produce it; the runtime resolves clips by that extension, so it is not an option here. Keys that
 * already have a clip are skipped, so a recording is never overwritten; a key with no clip falls
 * back to browser speech at runtime.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
const provider = options.provider ?? 'macos';
const languages =
	options.language === undefined
		? KIOSK_VOICE_LANGUAGES
		: options.language.split(',').filter((language) => KIOSK_VOICE_LANGUAGES.includes(language));
const keys =
	options.only === undefined
		? KIOSK_PHRASE_KEYS
		: options.only.split(',').filter((key) => KIOSK_PHRASE_KEYS.includes(key));

const DEFAULT_VOICES = {
	macos: { en: 'Samantha', zh: 'Tingting' },
	gemini: { en: 'Kore', zh: 'Leda' }
};

const voiceFor = (language) => options[`voice-${language}`] ?? DEFAULT_VOICES[provider]?.[language];

const which = (binary) =>
	spawnSync('which', [binary], { stdio: ['ignore', 'pipe', 'ignore'] }).status === 0;

/** Encodes a WAV or AIFF file into the shipped container with whichever encoder the host has. */
const encode = (source, target) => {
	if (KIOSK_VOICE_CLIP_FORMAT === 'mp3') {
		if (which('afconvert')) {
			execFileSync('afconvert', ['-f', 'MP3F', '-d', '.mp3', '-b', '64000', source, target], {
				stdio: 'inherit'
			});
			return;
		}
		if (which('ffmpeg')) {
			execFileSync(
				'ffmpeg',
				['-y', '-loglevel', 'error', '-i', source, '-c:a', 'libmp3lame', '-b:a', '64k', target],
				{ stdio: 'inherit' }
			);
			return;
		}
		throw new Error(
			'No encoder found: install ffmpeg, or run on macOS where afconvert is built in.'
		);
	}
	if (which('afconvert')) {
		execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', source, target], {
			stdio: 'inherit'
		});
		return;
	}
	if (which('ffmpeg')) {
		execFileSync(
			'ffmpeg',
			['-y', '-loglevel', 'error', '-i', source, '-c:a', 'aac', '-b:a', '64k', target],
			{ stdio: 'inherit' }
		);
		return;
	}
	throw new Error('No encoder found: install ffmpeg, or run on macOS where afconvert is built in.');
};

/** 16-bit mono PCM to a WAV file: a 44-byte header in front of the samples. */
const writeWav = (target, pcm, sampleRate) => {
	const header = Buffer.alloc(44);
	header.write('RIFF', 0);
	header.writeUInt32LE(36 + pcm.length, 4);
	header.write('WAVE', 8);
	header.write('fmt ', 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(sampleRate * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write('data', 36);
	header.writeUInt32LE(pcm.length, 40);
	writeFileSync(target, Buffer.concat([header, pcm]));
};

const providers = {
	macos: {
		check: () => {
			if (process.platform !== 'darwin') throw new Error('The macos provider needs macOS.');
			for (const language of languages) {
				const voice = voiceFor(language);
				const installed = execFileSync('say', ['-v', '?'], { encoding: 'utf8' });
				if (!installed.split('\n').some((line) => line.startsWith(`${voice} `)))
					throw new Error(`Voice ${voice} is not installed; see \`say -v '?'\`.`);
			}
		},
		render: async (text, language, intermediate) => {
			execFileSync('say', ['-v', voiceFor(language), '-o', intermediate, text], {
				stdio: 'inherit'
			});
		},
		intermediateExtension: 'aiff'
	},
	gemini: {
		check: () => {
			if (!process.env.GEMINI_API_KEY)
				throw new Error('GEMINI_API_KEY is not set; the gemini provider needs it.');
		},
		render: async (text, language, intermediate) => {
			const model = options.model ?? 'gemini-2.5-flash-preview-tts';
			const response = await fetch(
				`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
				{
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						'x-goog-api-key': process.env.GEMINI_API_KEY
					},
					body: JSON.stringify({
						contents: [{ parts: [{ text }] }],
						generationConfig: {
							responseModalities: ['AUDIO'],
							speechConfig: {
								voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceFor(language) } }
							}
						}
					})
				}
			);
			if (!response.ok)
				throw new Error(`Gemini TTS ${response.status}: ${(await response.text()).slice(0, 400)}`);
			const body = await response.json();
			const part = body.candidates?.[0]?.content?.parts?.find((entry) => entry.inlineData);
			if (part === undefined) throw new Error('Gemini TTS returned no audio part.');
			const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? '')?.[1] ?? 24000);
			writeWav(intermediate, Buffer.from(part.inlineData.data, 'base64'), rate);
		},
		intermediateExtension: 'wav'
	}
};

const chosen = providers[provider];
if (chosen === undefined) {
	console.error(`Unknown provider ${provider}; use --provider=macos or --provider=gemini.`);
	process.exit(2);
}
chosen.check();

const scratch = path.join(tmpdir(), `kiosk-voice-${process.pid}`);
mkdirSync(scratch, { recursive: true });
let written = 0;
try {
	for (const language of languages) {
		const directory = path.join(outputRoot, language);
		mkdirSync(directory, { recursive: true });
		for (const key of keys) {
			const text = KIOSK_PHRASES[key][language];
			const target = path.join(directory, `${key}.${KIOSK_VOICE_CLIP_FORMAT}`);
			if (existsSync(target)) {
				console.log(`skip ${language}/${key}.${KIOSK_VOICE_CLIP_FORMAT} (already recorded)`);
				continue;
			}
			const intermediate = path.join(scratch, `${language}-${key}.${chosen.intermediateExtension}`);
			await chosen.render(text, language, intermediate);
			encode(intermediate, target);
			written += 1;
			console.log(
				`${language}/${key}.${KIOSK_VOICE_CLIP_FORMAT}  ${voiceFor(language)}  "${text}"`
			);
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
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
console.log(
	`${written} clip(s) written under ${path.relative(root, outputRoot)} with ${provider}.`
);
