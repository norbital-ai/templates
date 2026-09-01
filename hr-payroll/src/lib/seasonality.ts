import { formatDateISO } from '@norbital-ai/std/date';

interface SeasonalHeatmapRow {
	readonly year: string;
	readonly months: number[];
}

/**
 * The categories money is grouped by on the pay-components activity chart.
 *
 * They are the component-entry event arms, because that is exactly what the event column means:
 * WHY the money exists. A claim's month is the month it was incurred in, an arrears settlement's
 * is the day it was raised, and a standing allowance shows up in every month its range covers —
 * which is the honest shape of recurring money on a chart of activity.
 */
export const componentEntrySeasonalityCategories = [
	'CLAIM',
	'ALLOWANCE',
	'BONUS',
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

/** One component entry as the chart buckets it: its event arm. */
export function componentEntrySeasonalityCategory(row: {
	readonly event?: { readonly kind?: string } | null;
}): string {
	const kind =
		row.event != null && typeof row.event === 'object' ? Reflect.get(row.event, 'kind') : undefined;
	return typeof kind === 'string' ? kind : 'UNKNOWN';
}

type ComponentEntrySeasonalityDateRow = {
	readonly event?: { readonly kind?: string; readonly incurred_on?: string | null } | null;
	readonly event_date: string | Date;
};

/** Claims use their economic date; every other entry uses its event date. */
export function componentEntrySeasonalityDate(row: ComponentEntrySeasonalityDateRow): string {
	return row.event?.kind === 'CLAIM' && row.event.incurred_on != null
		? formatDateISO(row.event.incurred_on)
		: formatDateISO(row.event_date);
}
