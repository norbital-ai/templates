/**
 * Which speech voice the kiosk is allowed to use.
 *
 * A `SpeechSynthesisUtterance` with no `voice` gets the browser default, which on Firefox and most
 * Chromium builds is the low-quality system voice, so the kiosk sounded synthetic. The pick is a
 * voice that runs on the device (`localService`: no network round trip while a person waits), speaks
 * the kiosk's locale, and whose name the vendor marks as one of the natural ones. No such voice
 * means the kiosk stays text only, silent, rather than speaking badly.
 */
export type KioskVoice = Pick<
	SpeechSynthesisVoice,
	'name' | 'lang' | 'localService' | 'voiceURI' | 'default'
>;

/** Name fragments the vendors use for their natural voices, on macOS, iOS, Android and Chrome. */
const NATURAL_VOICE_MARKS: readonly string[] = [
	'enhanced',
	'premium',
	'natural',
	'google',
	'samantha',
	'daniel'
];

const languageOf = (tag: string): string => tag.toLowerCase().replace('_', '-').split('-')[0] ?? '';

const normalize = (tag: string): string => tag.toLowerCase().replace('_', '-');

/** True when the voice runs locally, speaks the locale's language and carries a natural mark. */
export const isAcceptableKioskVoice = (voice: KioskVoice, locale: string): boolean =>
	voice.localService &&
	languageOf(voice.lang) === languageOf(locale) &&
	NATURAL_VOICE_MARKS.some((mark) => voice.name.toLowerCase().includes(mark));

/**
 * The voice to speak with: the stored pick when it is still installed and still acceptable, else
 * the best acceptable voice (an exact locale match first, then the platform default), else null.
 */
export const pickKioskVoice = <Voice extends KioskVoice>(
	voices: readonly Voice[],
	locale: string,
	storedUri: string | null
): Voice | null => {
	const stored = storedUri === null ? undefined : voices.find((v) => v.voiceURI === storedUri);
	if (stored !== undefined && isAcceptableKioskVoice(stored, locale)) return stored;
	const wanted = normalize(locale);
	const rank = (voice: Voice): number =>
		(normalize(voice.lang) === wanted ? 0 : 2) + (voice.default ? 0 : 1);
	const candidates = voices
		.filter((voice) => isAcceptableKioskVoice(voice, locale))
		.toSorted((left, right) => rank(left) - rank(right));
	return candidates[0] ?? null;
};
