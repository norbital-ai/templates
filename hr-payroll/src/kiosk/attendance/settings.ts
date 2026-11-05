import { Effect, Result, Schema } from 'effect';

/**
 * Kiosk settings: the preferences of the one device on the wall.
 *
 * They belong to the tablet, not to a person or a workspace row, so they live in that browser's
 * storage. A missing or unreadable store is the defaults; nothing here can fail the kiosk.
 */
const STORAGE_KEY = 'norbital.kiosk.settings';

const KioskSettings = Schema.Struct({
	voiceEnabled: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true)))
});
type KioskSettings = Schema.Schema.Type<typeof KioskSettings>;

const KIOSK_SETTINGS_DEFAULTS: KioskSettings = { voiceEnabled: true };

const storage = (): Storage | null =>
	Result.getOrElse(
		Result.try(() => globalThis.localStorage ?? null),
		() => null
	);

export const readKioskSettings = (): KioskSettings => {
	const raw = Result.getOrElse(
		Result.try(() => storage()?.getItem(STORAGE_KEY) ?? null),
		() => null
	);
	if (raw === null) return KIOSK_SETTINGS_DEFAULTS;
	return Result.getOrElse(
		Schema.decodeUnknownResult(Schema.fromJsonString(KioskSettings))(raw),
		() => KIOSK_SETTINGS_DEFAULTS
	);
};

export const writeKioskSettings = (patch: Partial<KioskSettings>): KioskSettings => {
	const next: KioskSettings = { ...readKioskSettings(), ...patch };
	return Result.getOrElse(
		Result.try(() => {
			storage()?.setItem(STORAGE_KEY, JSON.stringify(next));
			return next;
		}),
		() => next
	); // A refused store still leaves the preference usable in this session.
};
