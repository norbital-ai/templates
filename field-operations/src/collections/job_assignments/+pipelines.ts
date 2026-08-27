import { isCalendarDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import type { Pipelines } from './$types.js';
import { usersByName } from '../../lib/identity-directory.js';

function shiftCalendarDate(value: string, days: number): string {
	if (!isCalendarDate(value)) {
		throw new Error('Calendar date must use YYYY-MM-DD.');
	}
	const date = new Date(`${value}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

/** One non-blank text value as a roster cell carries it: `trim().min(1)` on the wire. */
const rosterText = Schema.String.check(Schema.isPattern(/^\s*\S[\s\S]*$/));

const rowSchema = Schema.Struct({
	site_name: rosterText,
	scheduled_for: rosterText,
	job_title: rosterText,
	/**
	 * Who the job goes to, by the name they sign in under.
	 *
	 * A contractor is a user, not a company, so the roster names a person and the import resolves them
	 * against `user`. A name is the only identifying field the identity
	 * grant's mask exposes — the address is not readable through it — so a name shared by two people
	 * is refused by `usersByName` rather than resolved to whichever row came back first.
	 */
	contractor_name: rosterText,
	summary: Schema.optional(Schema.String)
});

const importInputSchema = Schema.Struct({
	week_start: rosterText,
	rows: Schema.NonEmptyArray(rowSchema)
});

const importSchema = Schema.toStandardSchemaV1(importInputSchema);

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
			'Turns a week of roster rows into dispatched assignments by matching each row to a single unassigned job by site, date and title, and each named contractor to the user they sign in as.',
		input: importSchema,
		handler: ({ input }, api) =>
			Effect.gen(function* () {
				// The import boundary decodes the wire payload against the declared `input` schema, so
				// the handler receives the validated week directly.
				const { week_start: weekStart, rows } =
					yield* Schema.decodeUnknownEffect(importInputSchema)(input);

				if (!isCalendarDate(weekStart)) {
					return yield* Effect.fail(new Error('week_start must be a calendar date (YYYY-MM-DD).'));
				}

				const weekEnd = shiftCalendarDate(weekStart, 6);
				const invalidDates = [
					...new Set(
						rows.filter((row) => !isCalendarDate(row.scheduled_for)).map((row) => row.scheduled_for)
					)
				];
				if (invalidDates.length > 0) {
					return yield* Effect.fail(
						new Error(
							`These scheduled_for values are not valid calendar days (YYYY-MM-DD):\n${formatNamedList(invalidDates)}`
						)
					);
				}

				const outsideWeek = rows
					.filter((row) => row.scheduled_for < weekStart || row.scheduled_for > weekEnd)
					.map((row, index) => rowLabel(row, index));
				if (outsideWeek.length > 0) {
					return yield* Effect.fail(
						new Error(
							`Every scheduled_for must fall within the week starting ${weekStart}:\n${formatNamedList(outsideWeek)}`
						)
					);
				}

				const scheduledDates = [...new Set(rows.map((row) => row.scheduled_for))];
				const [sites, contractorByName, jobs, existingAssignments] = yield* Effect.all(
					[
						api.db.sites.findMany({
							columns: { id: true, name: true },
							limit: QUERY_LIMIT
						}),
						usersByName(api),
						api.db.jobs.findMany({
							where: { scheduled_for: { in: scheduledDates } },
							columns: {
								id: true,
								site_id: true,
								title: true,
								scheduled_for: true,
								status: true
							},
							limit: QUERY_LIMIT
						}),
						api.db.job_assignments.findMany({
							columns: { id: true, job_id: true },
							limit: QUERY_LIMIT
						})
					],
					{ concurrency: 'unbounded' }
				);

				const siteByName = new Map(sites.map((site) => [normalizeKey(site.name), site]));
				const assignmentByJobId = new Map(
					existingAssignments.map((assignment) => [assignment.job_id, assignment])
				);
				const jobsByMatchKey = new Map<string, (typeof jobs)[number][]>();
				for (const job of jobs) {
					const key = `${job.site_id}\t${job.scheduled_for}\t${normalizeKey(job.title)}`;
					const matches = jobsByMatchKey.get(key) ?? [];
					matches.push(job);
					jobsByMatchKey.set(key, matches);
				}

				const problems: string[] = [];
				const resolvedRows: Array<{
					row: RosterRow;
					jobId: string;
					assigneeUserId: string;
				}> = [];
				const seenJobIds = new Set<string>();

				for (const [index, row] of rows.entries()) {
					const label = rowLabel(row, index);
					const site = siteByName.get(normalizeKey(row.site_name));
					if (site == null) {
						problems.push(`${label}: unknown site "${row.site_name}".`);
						continue;
					}

					const contractor = contractorByName.get(normalizeKey(row.contractor_name));
					if (contractor == null) {
						problems.push(`${label}: no single workspace user is named "${row.contractor_name}".`);
						continue;
					}

					const matchKey = `${site.id}\t${row.scheduled_for}\t${normalizeKey(row.job_title)}`;
					const matchingJobs = (jobsByMatchKey.get(matchKey) ?? []).filter(
						(job) => job.status === 'unassigned' && !assignmentByJobId.has(job.id)
					);
					if (matchingJobs.length === 0) {
						problems.push(
							`${label}: no unassigned job found. Create the job first, then import again.`
						);
						continue;
					}
					if (matchingJobs.length > 1) {
						problems.push(
							`${label}: more than one unassigned job matches this site, date, and title.`
						);
						continue;
					}

					const job = matchingJobs[0];
					if (seenJobIds.has(job.id)) {
						problems.push(`${label}: this job appears more than once in the import.`);
						continue;
					}
					seenJobIds.add(job.id);
					resolvedRows.push({
						row,
						jobId: job.id,
						assigneeUserId: contractor.id
					});
				}

				if (problems.length > 0) {
					return yield* Effect.fail(
						new Error(`The roster could not be imported:\n${formatNamedList(problems)}`)
					);
				}

				return resolvedRows.map((entry) => ({
					job_id: entry.jobId,
					assignee_user_id: entry.assigneeUserId,
					status: 'assigned' as const,
					summary: entry.row.summary ?? null
				}));
			})
	}
} satisfies Pipelines;
