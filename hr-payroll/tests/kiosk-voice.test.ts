import test from 'node:test';
import assert from 'node:assert/strict';
import { isAcceptableKioskVoice, pickKioskVoice, type KioskVoice } from '../src/lib/kiosk/voice.ts';
import { KIOSK_MODEL_BASE, KIOSK_REQUIRED_MODELS } from '../src/lib/kiosk/config.ts';

const voice = (overrides: Partial<KioskVoice> & Pick<KioskVoice, 'name'>): KioskVoice => ({
	lang: 'en-US',
	localService: true,
	voiceURI: overrides.name,
	default: false,
	...overrides
});

test('an acceptable kiosk voice runs locally, speaks the locale and carries a natural mark', () => {
	assert.equal(isAcceptableKioskVoice(voice({ name: 'Samantha' }), 'en-US'), true);
	assert.equal(isAcceptableKioskVoice(voice({ name: 'Daniel', lang: 'en-GB' }), 'en-US'), true);
	assert.equal(
		isAcceptableKioskVoice(voice({ name: 'Google US English', localService: false }), 'en-US'),
		false,
		'a network voice is not acceptable'
	);
	assert.equal(
		isAcceptableKioskVoice(voice({ name: 'Microsoft David' }), 'en-US'),
		false,
		'the low-quality system voice carries no natural mark'
	);
	assert.equal(
		isAcceptableKioskVoice(voice({ name: 'Ting-Ting (Enhanced)', lang: 'zh-CN' }), 'en-US'),
		false,
		'a voice for another language is not acceptable'
	);
	assert.equal(
		isAcceptableKioskVoice(voice({ name: 'Ting-Ting (Enhanced)', lang: 'zh_CN' }), 'zh-CN'),
		true
	);
});

test('the stored voice wins while it is installed and acceptable', () => {
	const voices = [
		voice({ name: 'Samantha (Enhanced)', voiceURI: 'samantha-enhanced' }),
		voice({ name: 'Daniel', voiceURI: 'daniel', lang: 'en-GB' })
	];
	assert.equal(pickKioskVoice(voices, 'en-US', 'daniel')?.voiceURI, 'daniel');
	assert.equal(
		pickKioskVoice(voices, 'en-US', 'gone')?.voiceURI,
		'samantha-enhanced',
		'an uninstalled stored pick falls back to the best exact-locale voice'
	);
	assert.equal(
		pickKioskVoice([voice({ name: 'Microsoft David', voiceURI: 'david' })], 'en-US', 'david'),
		null,
		'a stored pick that is no longer acceptable is dropped'
	);
});

test('no acceptable voice means silence, never the browser default', () => {
	assert.equal(pickKioskVoice([], 'en-US', null), null);
	assert.equal(
		pickKioskVoice(
			[
				voice({ name: 'Microsoft David' }),
				voice({ name: 'Google US English', localService: false })
			],
			'en-US',
			null
		),
		null
	);
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
