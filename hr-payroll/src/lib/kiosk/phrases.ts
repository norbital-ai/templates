/**
 * Everything the kiosk and the enrollment flow ever say, in every language they speak.
 *
 * One list, three readers: the narrator (`voice.ts`) plays the clip for a key, the generator
 * (`scripts/generate-kiosk-voice.mjs`) renders a clip per key and language from this text, and the
 * Vite plugin (`vite.config.ts`) ships the clips beside the face models. A phrase that is not here
 * cannot be spoken, and a clip nobody generated falls back to browser speech of this same text.
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
	choose_action: { en: 'Choose check in or check out.', zh: '请选择上班打卡或下班打卡。' },
	selected_in: { en: 'Check in. Please look at the camera.', zh: '上班打卡。请看向镜头。' },
	selected_out: { en: 'Check out. Please look at the camera.', zh: '下班打卡。请看向镜头。' },
	move_closer: { en: 'Please come a little closer.', zh: '请再靠近一点。' },
	no_face: {
		en: "I can't see you yet. Please step into the frame.",
		zh: '还没看到您，请站到画面中。'
	},
	confirm_in: {
		en: 'Welcome. Hold still and blink once to check in.',
		zh: '欢迎。请保持不动，眨一下眼完成上班打卡。'
	},
	confirm_out: {
		en: 'Hold still and blink once to check out.',
		zh: '请保持不动，眨一下眼完成下班打卡。'
	},
	checked_in: { en: "You're checked in. Have a good day.", zh: '上班打卡成功，祝您工作愉快。' },
	checked_out: { en: "You're checked out. See you next time.", zh: '下班打卡成功，下次见。' },
	identity_unknown: {
		en: "Sorry, I don't recognise you. Please ask HR.",
		zh: '抱歉，未能识别您的身份。请联系人事。'
	},
	no_active_employment: {
		en: "I know you, but there's no active job to record. Please ask HR.",
		zh: '已识别您，但没有有效的任职记录。请联系人事。'
	},
	already_in: { en: "You're already checked in today.", zh: '您今天已经打过上班卡了。' },
	no_arrival: {
		en: "There's no check-in yet. Please check in first.",
		zh: '还没有上班打卡记录，请先打上班卡。'
	},
	too_soon: { en: 'Please wait a moment and try again.', zh: '请稍等片刻再试。' },
	unchanged: { en: 'Nothing was changed.', zh: '考勤没有变化。' },
	live_face_required: {
		en: 'I need a live face. Please look at the camera and blink.',
		zh: '需要真人面孔。请看向镜头并眨眼。'
	},
	face_lost: { en: 'I lost your face. Please try again.', zh: '人脸离开了画面，请再试一次。' },
	try_again: { en: 'Something went wrong. Please try again.', zh: '出了点问题，请再试一次。' },
	engine_unavailable: {
		en: "Face scanning isn't available right now. Please use manual entry.",
		zh: '人脸识别暂时不可用，请使用手动登记。'
	},
	// Enrollment
	enroll_straight: { en: 'Look straight at the camera.', zh: '请正视镜头。' },
	enroll_left: { en: 'Now turn your head a little to the left.', zh: '请把头稍微向左转。' },
	enroll_right: { en: 'And a little to the right.', zh: '再稍微向右转。' },
	enroll_up: { en: 'Tilt your head up a little.', zh: '请稍微抬头。' },
	enroll_down: { en: 'And down a little.', zh: '再稍微低头。' },
	enroll_no_face: { en: 'Please step into the frame.', zh: '请站到画面中。' },
	enroll_done: { en: 'All done. Thank you.', zh: '完成，谢谢。' }
} as const satisfies Record<string, Phrase>;

export type KioskPhraseKey = keyof typeof KIOSK_PHRASES;

export const KIOSK_PHRASE_KEYS = Object.keys(KIOSK_PHRASES) as readonly KioskPhraseKey[];

/** The language a locale tag speaks in this list: any Chinese locale is `zh`, everything else `en`. */
export const kioskVoiceLanguage = (locale: string): KioskVoiceLanguage =>
	locale.toLowerCase().replace('_', '-').split('-')[0] === 'zh' ? 'zh' : 'en';

/** The text of one phrase in one language, for the browser-speech fallback and the generator. */
export const kioskPhraseText = (key: KioskPhraseKey, language: KioskVoiceLanguage): string =>
	KIOSK_PHRASES[key][language];
