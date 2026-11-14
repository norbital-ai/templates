/**
 * Everything the kiosk and the enrollment flow ever say, in every language they speak.
 *
 * One list, three readers: the narrator (`voice.ts`) plays the clip for a key, the generator
 * (`scripts/generate-kiosk-voice.mjs`) renders a clip per key and language from this text, and the
 * Vite plugin (`vite.config.ts`) ships the clips beside the face models. A phrase that is not here
 * cannot be spoken, and a phrase without a generated clip fails the build: the kiosk never uses
 * a browser or system voice.
 *
 * The copy is written to be heard, not read: short, plain, one idea per phrase. A name is never
 * spoken (a clip cannot carry one), so the "checked in" phrase is the same for everyone and the
 * screen shows who it was.
 */
const KIOSK_VOICE_LANGUAGES = ['en', 'zh'] as const;
export type KioskVoiceLanguage = (typeof KIOSK_VOICE_LANGUAGES)[number];

/** The container every clip ships in. `afconvert` on macOS and `ffmpeg` elsewhere both emit it. */
export const KIOSK_VOICE_CLIP_FORMAT = 'mp3';

type Phrase = Readonly<Record<KioskVoiceLanguage, string>>;

const KIOSK_PHRASES = {
	// Clock
	move_closer: { en: 'Move closer.', zh: '请靠近一点。' },
	no_face: { en: 'Step into the frame.', zh: '请站到画面中。' },
	checked_in: { en: 'Checked in. Have a good day.', zh: '上班打卡成功。' },
	checked_out: { en: 'Checked out. See you.', zh: '下班打卡成功。' },
	identity_unknown: { en: 'Not recognised. Please see HR.', zh: '无法识别，请联系人事。' },
	no_active_employment: {
		en: 'No active employment. Please see HR.',
		zh: '没有有效任职，请联系人事。'
	},
	too_soon: { en: 'Too soon. Try again shortly.', zh: '请稍后再试。' },
	refused: { en: 'Not recorded. Please see your supervisor.', zh: '未记录，请联系主管。' },
	unchanged: { en: 'Nothing changed.', zh: '没有变化。' },
	try_again: { en: 'Something went wrong. Try again.', zh: '出错了，请重试。' },
	engine_unavailable: {
		en: 'Face scanning unavailable. Use manual entry.',
		zh: '人脸识别不可用，请手动登记。'
	},
	// Enrollment
	enroll_straight: { en: 'Look straight ahead.', zh: '请正视镜头。' },
	enroll_left: { en: 'Turn left.', zh: '向左转。' },
	enroll_right: { en: 'Turn right.', zh: '向右转。' },
	enroll_up: { en: 'Look up.', zh: '抬头。' },
	enroll_down: { en: 'Look down.', zh: '低头。' },
	enroll_no_face: { en: 'Step into the frame.', zh: '请站到画面中。' },
	enroll_done: { en: 'Done. Thank you.', zh: '完成，谢谢。' }
} as const satisfies Record<string, Phrase>;

export type KioskPhraseKey = keyof typeof KIOSK_PHRASES;

/** The language a locale tag speaks in this list: any Chinese locale is `zh`, everything else `en`. */
export const kioskVoiceLanguage = (locale: string): KioskVoiceLanguage =>
	locale.toLowerCase().replace('_', '-').split('-')[0] === 'zh' ? 'zh' : 'en';

/** Narration of actual native capture refusals, shared by the camera consumer and edge case tests. */
export function kioskCaptureRefusalPhrase(reason: unknown): KioskPhraseKey {
	return reason === 'cooldown' ? 'too_soon' : reason === 'refused' ? 'refused' : 'unchanged';
}
