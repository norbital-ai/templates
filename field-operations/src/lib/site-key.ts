/**
 * A site's identity, derived from its address: the postal code plus the unit when the address carries one
 * (`460133#05-12`), otherwise the normalised address itself. The `sites` transform stamps it on every write and the
 * work-order import looks a site up by it before filing one.
 */
/** Street words typed two ways; long becomes short. */
const ABBREVIATIONS = [
	['AVENUE', 'AVE'],
	['ROAD', 'RD'],
	['STREET', 'ST'],
	['BLOCK', 'BLK'],
	['DRIVE', 'DR']
] as const;
/** Rewrites of an uppercased address, in order. */
const REWRITES: ReadonlyArray<readonly [string, string]> = [
	["['’]", ''],
	['[^A-Z0-9#-]+', ' '],
	[' *# *', '#'],
	[' *- *', '-'],
	// `#5-12` is the unit `#05-12`.
	['#([0-9])-', '#0$1-'],
	...ABBREVIATIONS.map(([long, short]) => [`(^| )${long}(?= |$)`, `$1${short}`] as const),
	// The country is on every address here, so it identifies nothing.
	['(^| )SINGAPORE(?= |$)', '$1'],
	[' +', ' ']
];
/** A six-digit postal code, not part of a longer number. */
const POSTAL = /(?:^|[^0-9])([0-9]{6})(?:[^0-9]|$)/;
/** A normalised unit, `#05-12`. */
const UNIT = /#[0-9]+-[0-9A-Z]+/;
/** The address as the key compares it: uppercase, one spelling per street word, no punctuation. */
function normalizeAddress(address: string): string {
	return REWRITES.reduce(
		(text, [pattern, replacement]) => text.replace(new RegExp(pattern, 'g'), replacement),
		address.toUpperCase()
	).trim();
}
/**
 * The key for a location label plus an optional unit. Embedded units in legacy addresses still match.
 */
export function siteKey(address: string, unitNumber?: string | null): string {
	const normalized = normalizeAddress(address);
	const unit =
		unitNumber === undefined
			? (UNIT.exec(normalized)?.[0] ?? '')
			: unitNumber?.trim()
				? normalizeAddress(`#${unitNumber.trim().replace(/^#/, '')}`)
				: '';
	const location = normalized.replace(UNIT, '').replace(/\s+/g, ' ').trim();
	return (POSTAL.exec(location)?.[1] ?? location) + unit;
}
