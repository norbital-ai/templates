import { formatDateISO } from '@norbital-ai/std/date';

interface SeasonalHeatmapRow {
	readonly year: string;
	readonly months: number[];
}

/**
 * The categories money is grouped by on the pay-components activity chart.
 *
 * They are `occasion` where an obligation has one and `terms` where it does not, because that is
 * exactly what the two columns mean: `terms` says HOW money comes due and `occasion` says WHY a
 * one-off was raised, and only the second is interesting when it exists. `LOAN_INSTALMENT` is gone
 * from the list because those rows are gone from the workspace — a loan is one SCHEDULED obligation
 * carrying its instalments, not N copies of itself.
 */
export const obligationSeasonalityCategories = [
	'RECURRING',
	'SCHEDULED',
	'REVERSAL',
	'ENTERED',
	'CLAIM',
	'ARREARS',
	'ADJUSTMENT'
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

/** One obligation as the chart buckets it: its occasion where it has one, its terms otherwise. */
export function obligationSeasonalityCategory(row: {
	readonly terms: string;
	readonly occasion?: string | null;
}): string {
	return row.occasion ?? row.terms;
}

/** Claims use their economic date; every other obligation uses its event date. */
export function obligationSeasonalityDate(row: {
	readonly occasion?: string | null;
	readonly incurred_on?: string | Date | null;
	readonly event_date: string | Date;
}): string {
	return row.occasion === 'CLAIM' && row.incurred_on != null
		? formatDateISO(row.incurred_on)
		: formatDateISO(row.event_date);
}
