/**
 * Kiosk settings: the preferences of the one device on the wall.
 *
 * They belong to the tablet, not to a person or a workspace row, so they live in that browser's
 * storage. A missing or unreadable store is the defaults; nothing here can fail the kiosk.
 */
const STORAGE_KEY = 'norbital.kiosk.settings';

type KioskSettings = Readonly<{
	/** Whether the kiosk speaks its statuses at all. */
	voiceEnabled: boolean;
}>;

const KIOSK_SETTINGS_DEFAULTS: KioskSettings = { voiceEnabled: true };

const storage = (): Storage | null => {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
};

export const readKioskSettings = (): KioskSettings => {
	try {
		const raw = storage()?.getItem(STORAGE_KEY) ?? null;
		if (raw === null) return KIOSK_SETTINGS_DEFAULTS;
		const parsed: unknown = JSON.parse(raw);
		if (parsed === null || typeof parsed !== 'object') return KIOSK_SETTINGS_DEFAULTS;
		const voiceEnabled = Reflect.get(parsed, 'voiceEnabled');
		return { voiceEnabled: typeof voiceEnabled === 'boolean' ? voiceEnabled : true };
	} catch {
		return KIOSK_SETTINGS_DEFAULTS;
	}
};

export const writeKioskSettings = (patch: Partial<KioskSettings>): KioskSettings => {
	const next: KioskSettings = { ...readKioskSettings(), ...patch };
	try {
		storage()?.setItem(STORAGE_KEY, JSON.stringify(next));
	} catch {
		// Storage refused (private mode, quota): the setting still applies for this session.
	}
	return next;
};
