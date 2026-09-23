/**
 * A site's identity, derived from its address: the postal code plus the unit when the address
 * carries one (`460133#05-12`), otherwise the normalised address itself.
 *
 * The database computes it (`sites.site_key` is a generated column, so a seeded row, a nested
 * create and a direct write all carry it without a transform stamping it), and authored code
 * computes it to look a site up before one is filed. Both run the one rule table below: `siteKey`
 * applies it in JavaScript and `siteKeySql` renders it as the column's SQL. Every pattern is
 * written in the subset JavaScript and PostgreSQL's regex engine read the same way, and the
 * site-key tests hold the two renderings to the same answers.
 *
 * JavaScript rather than TypeScript because `sites/+model.ts` imports it, and the compiler reads a
 * model with Node's own loader, which does not resolve a `.js` specifier to a `.ts` file.
 */

/** @type {ReadonlyArray<readonly [string, string]>} Street words typed two ways; long becomes short. */
const ABBREVIATIONS = [
	['AVENUE', 'AVE'],
	['ROAD', 'RD'],
	['STREET', 'ST'],
	['BLOCK', 'BLK'],
	['DRIVE', 'DR']
];

/** @type {ReadonlyArray<readonly [string, string]>} Rewrites of an uppercased address, in order. */
const REWRITES = [
	["['’]", ''],
	['[^A-Z0-9#-]+', ' '],
	[' *# *', '#'],
	[' *- *', '-'],
	// `#5-12` is the unit `#05-12`.
	['#([0-9])-', '#0$1-'],
	...ABBREVIATIONS.map(([long, short]) => [`(^| )${long}(?= |$)`, `$1${short}`]),
	// The country is on every address here, so it identifies nothing.
	['(^| )SINGAPORE(?= |$)', '$1'],
	[' +', ' ']
];

/** A six-digit postal code, not part of a longer number. The digits are the first group. */
const POSTAL = '(?:^|[^0-9])([0-9]{6})(?:[^0-9]|$)';
/** A normalised unit, `#05-12`. */
const UNIT = '#[0-9]+-[0-9A-Z]+';

/** The address as the key compares it: uppercase, one spelling per street word, no punctuation. */
export function normalizeAddress(address) {
	return REWRITES.reduce(
		(text, [pattern, replacement]) => text.replace(new RegExp(pattern, 'g'), replacement),
		address.toUpperCase()
	).trim();
}

/**
 * The key for a site typed as `address` and, when it was picked on a map, geocoded as
 * `formattedAddress`. The geocoded address is preferred for the postal code and the fallback text;
 * a unit is taken from whichever carries one, since a geocoder answers for the building.
 */
export function siteKey(address, formattedAddress) {
	const both = normalizeAddress(`${formattedAddress ?? ''} ${address}`);
	const postal = new RegExp(POSTAL).exec(both)?.[1];
	if (postal !== undefined) return postal + (new RegExp(UNIT).exec(both)?.[0] ?? '');
	const formatted = normalizeAddress(formattedAddress ?? '');
	return formatted === '' ? normalizeAddress(address) : formatted;
}

/** @param {string} text */
const literal = (text) => `'${text.replaceAll("'", "''")}'`;

/** @param {string} expression */
const normalizeSql = (expression) =>
	`btrim(${REWRITES.reduce(
		(sql, [pattern, replacement]) =>
			`regexp_replace(${sql}, ${literal(pattern)}, ${literal(replacement.replace(/\$(\d)/g, '\\$1'))}, 'g')`,
		`upper(${expression})`
	)})`;

/** `siteKey` over the row's `name` and `location`, as the generated column's expression. */
export function siteKeySql() {
	const formatted = `(location ->> 'formatted_address')`;
	const both = normalizeSql(`coalesce(${formatted}, '') || ' ' || name`);
	return `coalesce(substring(${both} from ${literal(POSTAL)}) || coalesce(substring(${both} from ${literal(UNIT)}), ''), coalesce(nullif(${normalizeSql(`coalesce(${formatted}, '')`)}, ''), ${normalizeSql('name')}))`;
}
