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
export const KIOSK_VOICE_LANGUAGES = ['en', 'zh'] as const;
export type KioskVoiceLanguage = (typeof KIOSK_VOICE_LANGUAGES)[number];

/** The container every clip ships in. `afconvert` on macOS and `ffmpeg` elsewhere both emit it. */
export const KIOSK_VOICE_CLIP_FORMAT = 'mp3';

type Phrase = Readonly<Record<KioskVoiceLanguage, string>>;

export const KIOSK_PHRASES = {
	// Clock
	choose_action: { en: 'Choose check in or check out.', zh: '请选择上班或下班打卡。' },
	selected_in: { en: 'Check in. Look at the camera.', zh: '上班打卡，请看镜头。' },
	selected_out: { en: 'Check out. Look at the camera.', zh: '下班打卡，请看镜头。' },
	move_closer: { en: 'Move closer.', zh: '请靠近一点。' },
	no_face: { en: 'Step into the frame.', zh: '请站到画面中。' },
	confirm_in: { en: 'Hold still and blink to check in.', zh: '请保持不动，眨眼确认上班。' },
	confirm_out: { en: 'Hold still and blink to check out.', zh: '请保持不动，眨眼确认下班。' },
	checked_in: { en: 'Checked in. Have a good day.', zh: '上班打卡成功。' },
	checked_out: { en: 'Checked out. See you.', zh: '下班打卡成功。' },
	identity_unknown: { en: 'Not recognised. Please see HR.', zh: '无法识别，请联系人事。' },
	no_active_employment: {
		en: 'No active employment. Please see HR.',
		zh: '没有有效任职，请联系人事。'
	},
	already_in: { en: 'Already checked in today.', zh: '今天已打过上班卡。' },
	no_arrival: { en: 'Check in first.', zh: '请先打上班卡。' },
	too_soon: { en: 'Too soon. Try again shortly.', zh: '请稍后再试。' },
	unchanged: { en: 'Nothing changed.', zh: '没有变化。' },
	live_face_required: { en: 'Look at the camera and blink.', zh: '请看镜头并眨眼。' },
	face_lost: { en: 'Face lost. Try again.', zh: '人脸丢失，请重试。' },
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

export const KIOSK_PHRASE_KEYS = Object.keys(KIOSK_PHRASES) as readonly KioskPhraseKey[];

/** The language a locale tag speaks in this list: any Chinese locale is `zh`, everything else `en`. */
export const kioskVoiceLanguage = (locale: string): KioskVoiceLanguage =>
	locale.toLowerCase().replace('_', '-').split('-')[0] === 'zh' ? 'zh' : 'en';
