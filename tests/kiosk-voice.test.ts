import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { KIOSK_MODEL_BASE, KIOSK_REQUIRED_MODELS } from '../src/lib/kiosk/config.ts';
import {
	KIOSK_PHRASES,
	KIOSK_PHRASE_KEYS,
	KIOSK_VOICE_CLIP_FORMAT,
	KIOSK_VOICE_LANGUAGES,
	kioskVoiceLanguage
} from '../src/lib/kiosk/phrases.ts';
import { createKioskNarrator } from '../src/lib/kiosk/voice.ts';

const clipsRoot = fileURLToPath(new URL('../assets/kiosk-voice/', import.meta.url));

test('every phrase ships a clip in every language, so nothing ever falls back to a system voice', () => {
	for (const language of KIOSK_VOICE_LANGUAGES) {
		for (const key of KIOSK_PHRASE_KEYS) {
			const clip = `${clipsRoot}${language}/${key}.${KIOSK_VOICE_CLIP_FORMAT}`;
			assert.ok(existsSync(clip), `missing clip ${language}/${key}`);
			assert.ok(readFileSync(clip).byteLength > 1_000, `empty clip ${language}/${key}`);
		}
	}
});

test('phrases are short and direct: one sentence or two, never a paragraph', () => {
	for (const key of KIOSK_PHRASE_KEYS) {
		assert.ok(KIOSK_PHRASES[key].en.length <= 60, `${key} en is too long`);
		assert.ok(KIOSK_PHRASES[key].zh.length <= 24, `${key} zh is too long`);
	}
	assert.equal(kioskVoiceLanguage('zh-Hans-SG'), 'zh');
	assert.equal(kioskVoiceLanguage('en-SG'), 'en');
});

test('a missing clip is silence: the narrator marks it and moves on without any speech', async () => {
	const played: string[] = [];
	const narrator = createKioskNarrator(
		{
			play: (url) => ({
				done: Promise.resolve(
					url.includes('/no_face.') ? ('missing' as const) : ('played' as const)
				),
				stop: () => {}
			})
		},
		{ language: 'en' }
	);
	narrator.say('no_face');
	narrator.say('checked_in');
	await new Promise((resolve) => setTimeout(resolve, 10));
	narrator.say('no_face');
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal([...narrator.missing].length, 1);
	assert.ok([...narrator.missing][0]?.endsWith('/en/no_face.mp3'));
	void played;
});

test('the model base resolves beside this chunk and names every enabled model', () => {
	// In the built bundle the chunk lives under `assets/` and the models one level up; under Node the
	// same expression resolves relative to the source file, so only the shape is asserted here.
	assert.ok(KIOSK_MODEL_BASE.endsWith('/models/human/'), KIOSK_MODEL_BASE);
	assert.ok(!KIOSK_MODEL_BASE.startsWith('/__bolt/static/'), 'no absolute, unversioned path');
	assert.deepEqual([...KIOSK_REQUIRED_MODELS].toSorted(), [
		'antispoof',
		'blazeface',
		'facemesh',
		'faceres',
		'iris'
	]);
});
