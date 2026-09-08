import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { KIOSK_MODEL_BASE, KIOSK_REQUIRED_MODELS } from '../src/lib/kiosk/config.ts';
import { blockedPhraseKey, type PunchBlockedReason } from '../src/lib/kiosk/punch.ts';
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

/**
 * `vite.config.ts` imports `KIOSK_REQUIRED_MODELS` rather than restating it, so the build cannot
 * ship a different set from the one the kiosk refuses to start without. A guard that read the
 * plugin's own literal list used to stand here; the import deleted the duplication and the guard
 * with it, which is the better outcome — there is no longer a second list to disagree.
 */
test('the model base resolves beside this chunk and names every enabled model', () => {
	// In the built bundle the chunk lives under `assets/` and the models one level up; under Node the
	// same expression resolves relative to the source file, so only the shape is asserted here.
	assert.ok(KIOSK_MODEL_BASE.endsWith('/models/human/'), KIOSK_MODEL_BASE);
	assert.ok(!KIOSK_MODEL_BASE.startsWith('/__bolt/static/'), 'no absolute, unversioned path');
	assert.deepEqual([...KIOSK_REQUIRED_MODELS].toSorted(), [
		'blazeface',
		'facemesh',
		'faceres',
		'iris'
	]);
});

/**
 * A person who is not rostered is told so, and not told "Nothing changed".
 *
 * That was the defect: the schedule gate blocked the punch correctly, but the narration fell
 * through to `unchanged` — truthful and useless at a shop-floor tablet, where the whole point of
 * speaking is that nobody is reading. Both schedule reasons say the same sentence, because "no
 * shift today" and "today is a rest day" are the same fact to the person standing there; the
 * screen carries which one, the voice does not.
 *
 * The mapping is contract, so it is asserted directly. It used to be declared inside
 * `+kiosk.svelte`, and this test read it out of the source text with a control feeding it the old
 * shape — a weak instrument that only existed because the function could not be imported. It is
 * exported from `lib/kiosk/punch.ts` now, beside the reasons it maps from, and the scan and its
 * control are gone with it.
 *
 * The failure it guards is silent: an unmapped reason falls through to `unchanged`, which is
 * exactly what the kiosk said before the schedule gate landed.
 */
test('a blocked punch says why: not scheduled, or too soon, and never "nothing changed"', () => {
	assert.equal(blockedPhraseKey('not-scheduled'), 'no_shift_today');
	assert.equal(blockedPhraseKey('not-a-work-day'), 'no_shift_today');
	assert.equal(blockedPhraseKey('cooldown'), 'too_soon', 'the debounce keeps its own sentence');
	// An unknown reason still falls back honestly rather than claiming a schedule it never read.
	assert.equal(blockedPhraseKey(undefined), 'unchanged');
	assert.equal(blockedPhraseKey('something-new'), 'unchanged');

	// Every reason the punch path can produce is mapped to something other than the fallback, so a
	// reason added without a sentence is caught here rather than spoken as "Nothing changed".
	const reasons: readonly PunchBlockedReason[] = ['cooldown', 'not-scheduled', 'not-a-work-day'];
	for (const reason of reasons) {
		assert.notEqual(
			blockedPhraseKey(reason),
			'unchanged',
			`${reason} has no sentence of its own and would be spoken as "Nothing changed"`
		);
	}

	// The sentence itself, in both languages, and it must not be the fallback's.
	const spoken = KIOSK_PHRASES['no_shift_today'];
	assert.match(spoken.en, /not scheduled/i);
	assert.notEqual(spoken.en, KIOSK_PHRASES['unchanged'].en);
	assert.notEqual(spoken.zh, KIOSK_PHRASES['unchanged'].zh);
});
