import { refuse } from '@norbital-ai/bolt/authoring';
import { isCalendarDate } from '@norbital-ai/std/date';
import { getErrorMessage } from '@norbital-ai/std/error';
import { Effect, Schema } from 'effect';
import type { Pipelines } from './$types.js';

function shiftCalendarDate(value: string, days: number): string {
	if (!isCalendarDate(value)) {
		refuse('Calendar date must use YYYY-MM-DD.');
	}
	const date = new Date(`${value}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

/** One non-blank text value as a roster cell carries it: `trim().min(1)` on the wire. */
const rosterText = Schema.String.check(Schema.isPattern(/^\s*\S[\s\S]*$/));
const rosterUserId = Schema.String.check(
	Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
);

const rowSchema = Schema.Struct({
	site_name: rosterText,
	scheduled_for: rosterText,
	job_title: rosterText,
	/**
	 * The declared relationship value, supplied by the operator rather than resolved through a
	 * private identity query. The relationship's database foreign key is the existence check.
	 */
	assignee_user_id: rosterUserId,
	summary: Schema.optional(Schema.String)
});

const importInputSchema = Schema.Struct({
	week_start: rosterText,
	rows: Schema.NonEmptyArray(rowSchema)
});

const importSchema = Schema.toStandardSchemaV1(importInputSchema);
const decodeImportInput = Schema.decodeUnknownEffect(importInputSchema);

type RosterRow = Schema.Schema.Type<typeof rowSchema>;

const QUERY_LIMIT = 5_000;

function formatNamedList(items: readonly string[]): string {
	return items.map((item) => `• ${item}`).join('\n');
}

function normalizeKey(value: string): string {
	return value.trim().toLowerCase();
}

function rowLabel(row: RosterRow, index: number): string {
	return `Row ${index + 1}: ${row.job_title} at ${row.site_name} on ${row.scheduled_for}`;
}

export default {
	import: {
		description:
			'Turns a week of roster rows into dispatched assignments by matching each row to a single unassigned job by site, date and title, using the explicit assignee user relationship value supplied in the roster.',
		input: importSchema,
		handler: ({ input }, api) =>
			Effect.gen(function* () {
				// The authored import handler receives an unknown document. Decode it against the same
				// schema the pipeline declares before reading any roster fields.
				const { week_start: weekStart, rows } = yield* decodeImportInput(input).pipe(
					Effect.catch((error) => Effect.sync(() => refuse(getErrorMessage(error))))
				);

				if (!isCalendarDate(weekStart)) {
					refuse('week_start must be a calendar date (YYYY-MM-DD).');
				}

				const weekEnd = shiftCalendarDate(weekStart, 6);
				const invalidDates = [
					...new Set(
						rows.filter((row) => !isCalendarDate(row.scheduled_for)).map((row) => row.scheduled_for)
					)
				];
				if (invalidDates.length > 0) {
					refuse(
						`These scheduled_for values are not valid calendar days (YYYY-MM-DD):\n${formatNamedList(invalidDates)}`
					);
				}

				const outsideWeek = rows
					.filter((row) => row.scheduled_for < weekStart || row.scheduled_for > weekEnd)
					.map((row, index) => rowLabel(row, index));
				if (outsideWeek.length > 0) {
					refuse(
						`Every scheduled_for must fall within the week starting ${weekStart}:\n${formatNamedList(outsideWeek)}`
					);
				}

				const scheduledDates = [...new Set(rows.map((row) => row.scheduled_for))];
				const [sites, existing] = yield* Effect.all(
					[
						api.db.sites.findMany({
							columns: { id: true, name: true },
							limit: QUERY_LIMIT
						}),
						api.db.job_assignments.findMany({
							where: { scheduled_for: { in: scheduledDates } },
							columns: {
								id: true,
								site_id: true,
								title: true,
								scheduled_for: true,
								status: true
							},
							limit: QUERY_LIMIT
						})
					],
					{ concurrency: 'unbounded' }
				);

				const siteByName = new Map(sites.map((site) => [normalizeKey(site.name), site]));
				const assignmentByMatchKey = new Map(
					existing.map((assignment) => [
						`${assignment.site_id}\t${assignment.scheduled_for}\t${normalizeKey(assignment.title)}`,
						assignment
					])
				);

				const problems: string[] = [];
				const resolvedRows: Array<{
					row: RosterRow;
					siteId: string;
				}> = [];
				const seenMatchKeys = new Set<string>();

				for (const [index, row] of rows.entries()) {
					const label = rowLabel(row, index);
					const site = siteByName.get(normalizeKey(row.site_name));
					if (site == null) {
						problems.push(`${label}: unknown site "${row.site_name}".`);
						continue;
					}

					const matchKey = `${site.id}\t${row.scheduled_for}\t${normalizeKey(row.job_title)}`;
					if (seenMatchKeys.has(matchKey)) {
						problems.push(`${label}: this work appears more than once in the import.`);
						continue;
					}
					if (assignmentByMatchKey.has(matchKey)) {
						// A work order is the assignment row now, and an import only creates. A row that
						// already exists is dispatched on the board, where the assignee is editable.
						problems.push(
							`${label}: this work is already filed for that site and day. Assign it on the dispatch board instead.`
						);
						continue;
					}
					seenMatchKeys.add(matchKey);
					resolvedRows.push({ row, siteId: site.id });
				}

				if (problems.length > 0) {
					refuse(`The roster could not be imported:\n${formatNamedList(problems)}`);
				}

				return resolvedRows.map((entry) => ({
					site_id: entry.siteId,
					title: entry.row.job_title,
					nature: entry.row.job_title,
					scheduled_for: `${entry.row.scheduled_for}T00:00:00.000Z`,
					description: '',
					assignee_user_id: entry.row.assignee_user_id,
					status: 'assigned' as const,
					summary: entry.row.summary
				}));
			})
	}
} satisfies Pipelines;
