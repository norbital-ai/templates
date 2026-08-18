import { defineQueryHandler, type SchemaRawOperators } from '@norbital-ai/bolt/authoring';
import { Effect, Schema } from 'effect';
import { calendarDayKey } from '../lib/ui/calendar.js';
import type { EntryOrigin } from '../custom-types/entry_origin/+definition.js';

export type SeasonalHeatmapRow = {
	readonly year: string;
	readonly months: number[];
};

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
	const heatmap: Array<{ year: string; months: number[] }> = years.map((year) => ({
		year: String(year),
		months: Array.from({ length: 12 }, () => 0)
	}));
	const yearIndex = new Map(years.map((year, index) => [year, index]));
	for (const fromDate of fromDates) {
		if (fromDate == null) continue;
		const key = calendarDayKey(fromDate);
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
 * - `CLAIM` counts `component_entries` whose `origin` variant is `CLAIM`, dated by the origin's
 *   `incurred_on` — a claim's economic date, not the row's creation date.
 *
 * `company_id` scopes both subjects through the employment each row belongs to.
 *
 * `total` is every row of the subject, not just the rows inside the seasonality window: the
 * heading counts the catalogue, while the heatmap reports the rolling five years beneath it.
 */
const subjectSchema = Schema.Literals(['CLAIM', 'LEAVE']);
type Subject = Schema.Schema.Type<typeof subjectSchema>;
type AnalyticsInput = { subject: Subject; company_id?: string };

/**
 * `component_entries.origin` is a jsonb discriminated union, so "is a claim" and "when was it
 * incurred" are both JSON paths rather than columns. Writing the predicate once keeps the total
 * and the seasonality read on one definition of a claim.
 */
function claimsIncurredBetween(from: string, toExclusive: string) {
	return (table: Readonly<Record<string, unknown>>, operators: SchemaRawOperators) => {
		const sql = operators.sql;
		return sql`${table.origin}->>'kind' = 'CLAIM' AND (${table.origin}->>'incurred_on')::date >= ${from}::date AND (${table.origin}->>'incurred_on')::date < ${toExclusive}::date`;
	};
}

function anyClaim(table: Readonly<Record<string, unknown>>, operators: SchemaRawOperators) {
	const sql = operators.sql;
	return sql`${table.origin}->>'kind' = 'CLAIM'`;
}

/** The claim arm is the only origin variant carrying an economic date. */
function claimIncurredOn(origin: EntryOrigin): string | null {
	return origin.kind === 'CLAIM' ? origin.incurred_on : null;
}

export default defineQueryHandler({
	description:
		'Counts every time-off request or expense claim on file and returns the last five years of monthly counts for seasonality analysis.',
	schema: Schema.Struct({
		subject: subjectSchema,
		company_id: Schema.optional(Schema.String.check(Schema.isUUID()))
	}),
	handler: ({ subject, company_id }: AnalyticsInput, api) =>
		Effect.gen(function* () {
			const currentYear = new Date().getUTCFullYear();
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
			/* Same shape as LEAVE, for the same reason: one windowed read bucketed in memory. */
			const [total, seasonalRows] = yield* Effect.all(
				[
					api.db.component_entries.count({ where: { ...companyScope, RAW: anyClaim } }),
					api.db.query.component_entries.findMany({
						where: {
							...companyScope,
							RAW: claimsIncurredBetween(windowStart, windowEnd)
						},
						columns: { origin: true },
						limit: 5000
					})
				],
				{ concurrency: 'unbounded' }
			);

			return {
				total,
				seasonal_heatmap: bucketSeasonalHeatmap(
					historyYears,
					seasonalRows.map((row) => claimIncurredOn(row.origin))
				)
			};
		})
});
