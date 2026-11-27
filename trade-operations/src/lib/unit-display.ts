import { BigDecimal, Option } from 'effect';

const KILOGRAMS = new Set(['kg', 'kgs', '公斤', '千克']);
const TONNES = new Set(['t', 'mt', 'tonne', 'tonnes', '吨', '公吨']);
const THOUSAND = BigDecimal.fromBigInt(1000n);

const normalize = (unit: string | null | undefined): string =>
	unit?.normalize('NFKC').trim().toLowerCase() ?? '';

/** Exact plain decimal string without trailing fractional zeros or scientific notation. */
export const plainDecimal = (value: BigDecimal.BigDecimal): string =>
	BigDecimal.format(BigDecimal.normalize(value));

/** Whether a unit string represents kilograms (stored in KG, shown/edited in tonnes). */
export const isKgUnit = (unit: string | null | undefined): boolean =>
	KILOGRAMS.has(normalize(unit));

/** Whether a unit string represents metric tonnes. */
export const isTonneUnit = (unit: string | null | undefined): boolean =>
	TONNES.has(normalize(unit));

/** User-facing unit label: `吨` (zh) or `MT` (en) for kg/tonne units; verbatim otherwise. */
export function displayUnit(unit: string | null | undefined, locale: string): string {
	if (isKgUnit(unit) || isTonneUnit(unit))
		return locale.toLowerCase().startsWith('zh') ? '吨' : 'MT';
	return unit?.trim() ?? '';
}

/** Default unit for new pricing floors: `吨` for kg (or unset) products, verbatim otherwise. */
export function floorDefaultUnit(productUnit: string | null | undefined): string {
	const trimmed = productUnit?.trim();
	if (!trimmed || isKgUnit(trimmed)) return '吨';
	return trimmed;
}

/** Converts a stored quantity (KG for kg products) to user-facing display quantity (tonnes). */
export function qtyToDisplay(
	stored: string | number | null | undefined,
	unit: string | null | undefined
): string | null {
	if (stored === null || stored === undefined) return null;
	const raw = String(stored).trim();
	if (raw === '') return null;
	const parsed = BigDecimal.fromString(raw);
	if (Option.isNone(parsed)) return raw;
	if (!isKgUnit(unit)) return plainDecimal(parsed.value);
	return plainDecimal(
		BigDecimal.round(BigDecimal.divideUnsafe(parsed.value, THOUSAND), { scale: 6 })
	);
}

/** Converts a user-entered display quantity (tonnes for kg products) back to storage quantity (KG, scale 3). */
export function qtyToStorage(
	display: string | number | null | undefined,
	unit: string | null | undefined
): string | null {
	if (display === null || display === undefined) return null;
	const raw = String(display).trim();
	if (raw === '') return null;
	const parsed = BigDecimal.fromString(raw);
	if (Option.isNone(parsed)) return null;
	if (!isKgUnit(unit)) return plainDecimal(BigDecimal.round(parsed.value, { scale: 3 }));
	return plainDecimal(BigDecimal.round(BigDecimal.multiply(parsed.value, THOUSAND), { scale: 3 }));
}

/** Converts a stored unit price (per KG for kg products) to user-facing price (per tonne). */
export function priceToDisplay(
	stored: string | number | null | undefined,
	unit: string | null | undefined
): string | null {
	if (stored === null || stored === undefined) return null;
	const raw = String(stored).trim();
	if (raw === '') return null;
	const parsed = BigDecimal.fromString(raw);
	if (Option.isNone(parsed)) return raw;
	if (!isKgUnit(unit)) return plainDecimal(parsed.value);
	return plainDecimal(BigDecimal.round(BigDecimal.multiply(parsed.value, THOUSAND), { scale: 8 }));
}

/** Converts a user-entered unit price (per tonne for kg products) back to storage price (per KG, scale 4). */
export function priceToStorage(
	display: string | number | null | undefined,
	unit: string | null | undefined
): string | null {
	if (display === null || display === undefined) return null;
	const raw = String(display).trim();
	if (raw === '') return null;
	const parsed = BigDecimal.fromString(raw);
	if (Option.isNone(parsed)) return null;
	if (!isKgUnit(unit)) return plainDecimal(BigDecimal.round(parsed.value, { scale: 4 }));
	return plainDecimal(
		BigDecimal.round(BigDecimal.divideUnsafe(parsed.value, THOUSAND), { scale: 4 })
	);
}
