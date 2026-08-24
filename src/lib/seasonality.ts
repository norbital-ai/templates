import { formatDateISO } from '@norbital-ai/std/date';
import type { EntryOrigin } from '../datatypes/entry_origin/+definition.js';

interface SeasonalHeatmapRow {
	readonly year: string;
	readonly months: number[];
}

export const componentSeasonalityCategories = [
	'RECURRING',
	'ONE_OFF',
	'CLAIM',
	'LOAN_INSTALMENT',
	'REVERSAL',
	'ARREARS',
	'MANUAL_ADJUSTMENT'
] as const;

/** Five calendar years ending in the live year, so an in-progress year is never hidden. */
export function seasonalityYears(currentYear: number): number[] {
	return Array.from({ length: 5 }, (_value, index) => currentYear - 4 + index);
}

/** Inclusive Jan 1 of the first seasonality year through the exclusive Jan 1 after the last. */
export function seasonalityDateWindow(currentYear: number): {
	start: string;
	endExclusive: string;
} {
	const years = seasonalityYears(currentYear);
	const first = years[0] ?? currentYear - 4;
	const last = years[years.length - 1] ?? currentYear;
	return { start: `${first}-01-01`, endExclusive: `${last + 1}-01-01` };
}

/** Fill the rolling window's complete 5×12 matrix from sparse collection rows. */
export function bucketSeasonalHeatmap(
	years: readonly number[],
	fromDates: readonly (string | Date | null | undefined)[]
): SeasonalHeatmapRow[] {
	const heatmap = years.map((year) => ({
		year: String(year),
		months: Array.from({ length: 12 }, () => 0)
	}));
	const yearIndex = new Map(years.map((year, index) => [year, index]));
	for (const fromDate of fromDates) {
		if (fromDate == null) continue;
		const key = formatDateISO(fromDate);
		const year = Number(key.slice(0, 4));
		const month = Number(key.slice(5, 7));
		const index = yearIndex.get(year);
		if (index == null || month < 1 || month > 12) continue;
		const row = heatmap[index];
		if (row == null) continue;
		row.months[month - 1] += 1;
	}
	return heatmap;
}

/** Claims use their economic date; every other component entry uses its event date. */
export function componentSeasonalityDate(origin: EntryOrigin, eventDate: string | Date): string {
	return origin.kind === 'CLAIM' ? origin.incurred_on : formatDateISO(eventDate);
}
