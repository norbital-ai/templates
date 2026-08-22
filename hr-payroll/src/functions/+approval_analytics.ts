import { defineQueryHandler, type SchemaRawOperators } from '@norbital-ai/bolt/authoring';
import { Clock, Effect, Schema } from 'effect';
import { formatDateISO } from '@norbital-ai/std/date';
import type { EntryOrigin } from '../datatypes/entry_origin/+definition.js';

const SeasonalHeatmapRowSchema = Schema.Struct({
	year: Schema.String,
	months: Schema.Array(Schema.Number)
});
export type SeasonalHeatmapRow = Schema.Schema.Type<typeof SeasonalHeatmapRowSchema>;

export const componentSeasonalityCategories = [
	'RECURRING',
	'ONE_OFF',
	'CLAIM',
	'LOAN_INSTALMENT',
	'REVERSAL',
	'ARREARS',
	'MANUAL_ADJUSTMENT'
] as const;
export type ComponentSeasonalityCategory = (typeof componentSeasonalityCategories)[number];

/** Five calendar years ending in the live year, so an in-progress year is never hidden. */
export function seasonalityYears(currentYear: number): number[] {
	return Array.from({ length: 5 }, (_value, index) => currentYear - 4 + index);
}

/**
 * Inclusive Jan 1 of the first seasonality year through the exclusive Jan 1 after the last.
 * `from_date` filters use `[start, end)`.
 */
export function seasonalityDateWindow(currentYear: number): {
	start: string;
	endExclusive: string;
} {
	const years = seasonalityYears(currentYear);
	const first = years[0] ?? currentYear - 4;
	const last = years[years.length - 1] ?? currentYear;
	return { start: `${first}-01-01`, endExclusive: `${last + 1}-01-01` };
}

/**
 * One cell per month of the rolling window. Missing buckets stay 0 so a sparse tally still
 * paints a complete 5×12 heatmap.
 */
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

/**
 * Five-year monthly seasonality counts, plus the all-time total, for the two subjects the HR
 * Controller overview tabs paint as a heatmap.
 *
 * - `LEAVE` counts `leave_requests`, dated by `from_date`.
 * - `PAY_COMPONENT` counts every `component_entries` origin category. Claims use their economic
 *   `incurred_on`; every other category uses `event_date`.
 *
 * `company_id` scopes both subjects through the employment each row belongs to.
 *
 * Leave keeps its all-time total. Pay-component `total` is the bounded five-year population used by
 * the chart, which avoids a second scan solely to decorate the heading.
 */
const subjectSchema = Schema.Literals(['PAY_COMPONENT', 'LEAVE']);
const approvalAnalyticsQuerySchema = Schema.Struct({
	subject: subjectSchema,
	company_id: Schema.optional(Schema.String.check(Schema.isUUID()))
});
type AnalyticsInput = Schema.Schema.Type<typeof approvalAnalyticsQuerySchema>;

/**
 * Claims carry their economic date inside the origin union. All other entries use `event_date`.
 * The same expression filters the database window and selects the date bucket in memory.
 */
function componentEntriesDatedBetween(from: string, toExclusive: string) {
	return (table: Readonly<Record<string, unknown>>, operators: SchemaRawOperators) => {
		const sql = operators.sql;
		return sql`(CASE WHEN ${table.origin}->>'kind' = 'CLAIM' THEN (${table.origin}->>'incurred_on')::date ELSE ${table.event_date} END) >= ${from}::date AND (CASE WHEN ${table.origin}->>'kind' = 'CLAIM' THEN (${table.origin}->>'incurred_on')::date ELSE ${table.event_date} END) < ${toExclusive}::date`;
	};
}

function componentSeasonalityDate(origin: EntryOrigin, eventDate: string | Date): string | Date {
	return origin.kind === 'CLAIM' ? origin.incurred_on : eventDate;
}

export default defineQueryHandler({
	description:
		'Counts time-off requests or pay-component entries and returns the last five years of monthly counts for seasonality analysis.',
	schema: approvalAnalyticsQuerySchema,
	handler: ({ subject, company_id }: AnalyticsInput, api) =>
		Effect.gen(function* () {
			const nowMs = yield* Clock.currentTimeMillis;
			const currentYear = new Date(nowMs).getUTCFullYear();
			const historyYears = seasonalityYears(currentYear);
			const { start: windowStart, endExclusive: windowEnd } = seasonalityDateWindow(currentYear);

			if (subject === 'LEAVE') {
				const companyScope = company_id
					? { leave_request_employment: { company_id: { eq: company_id } } }
					: {};
				/*
				 * Hosted remotes run in a 2s sealed guest. Seasonality used to issue 60 monthly `count()`
				 * queries (5 years × 12 months). The query API has no GROUP BY, so one `findMany` of
				 * `from_date` in the window is bucketed in memory — still one read, not sixty round-trips.
				 */
				const [total, seasonalRows] = yield* Effect.all(
					[
						api.db.leave_requests.count({
							where: { ...companyScope, kind: { eq: 'TIME_OFF' } }
						}),
						api.db.query.leave_requests.findMany({
							where: {
								...companyScope,
								kind: { eq: 'TIME_OFF' },
								from_date: { gte: windowStart, lt: windowEnd }
							},
							columns: { from_date: true },
							limit: 5000
						})
					],
					{ concurrency: 'unbounded' }
				);
				return {
					total,
					seasonal_heatmap: bucketSeasonalHeatmap(
						historyYears,
						seasonalRows.map((row) => row.from_date)
					)
				};
			}

			const companyScope = company_id
				? { entry_employment: { company_id: { eq: company_id } } }
				: {};
			/* One bounded window read, bucketed by month and origin category in memory. */
			const seasonalRows = yield* api.db.query.component_entries.findMany({
				where: {
					...companyScope,
					RAW: componentEntriesDatedBetween(windowStart, windowEnd)
				},
				columns: { origin: true, event_date: true },
				limit: 5000
			});

			const dated = seasonalRows.map((row) => ({
				category: row.origin.kind,
				date: componentSeasonalityDate(row.origin, row.event_date)
			}));
			return {
				total: seasonalRows.length,
				seasonal_heatmap: bucketSeasonalHeatmap(
					historyYears,
					dated.map((row) => row.date)
				),
				categories: componentSeasonalityCategories.map((category) => {
					const dates = dated.filter((row) => row.category === category).map((row) => row.date);
					return {
						category,
						total: dates.length,
						seasonal_heatmap: bucketSeasonalHeatmap(historyYears, dates)
					};
				})
			};
		})
});
