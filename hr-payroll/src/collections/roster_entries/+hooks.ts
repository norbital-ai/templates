import type { CollectionHooks } from '@norbital-ai/bolt/authoring';
import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { WorkspaceSchema } from '$bolt/types.js';
import type { RosterCodeVariant } from '../../datatypes/roster_code_variant/+definition.js';
import { dateKey } from '../../lib/iso-day.js';
import { rosterCodeKind } from '../../lib/scheduling/roster-code.js';
import { leaveCoverage, type LeaveRequestLike } from '../../lib/scheduling/leave-coverage.js';
import { payrollWindows, assertNotSettled, type PayrollWindow } from '../../lib/scheduling/lock.js';
import { coversDate } from '../payroll_runs/lib/effective.js';
import {
	assertNoOverlap,
	assertNoOverlappingAssignments,
	readOverlapData,
	type OverlapData
} from './lib/assignment-overlap.js';
import type { HookApi, Hooks, WorkspaceRow } from './$types.js';

type CreateInput = Parameters<
	NonNullable<
		NonNullable<NonNullable<NonNullable<Hooks['create']>['perRecord']>['before']>['handler']
	>
>[0]['input'];

const QUERY_LIMIT = 20_000;

type AssignmentValue = Pick<
	WorkspaceRow<'roster_entries'>,
	'employment_id' | 'work_date' | 'shift_definition_id' | 'roster_id'
>;

type EmploymentReference = Pick<WorkspaceRow<'employments'>, 'company_id'>;
type RosterCodeReference = Pick<
	WorkspaceRow<'shift_definitions'>,
	'company_id' | 'code' | 'variant' | 'effective_range'
>;
type RosterReference = Pick<WorkspaceRow<'rosters'>, 'company_id' | 'month' | 'published_at'>;

function assertResolvedAssignment(
	value: AssignmentValue,
	employment: EmploymentReference | null | undefined,
	code: RosterCodeReference | null | undefined,
	roster: RosterReference | null | undefined
): void {
	const date = dateKey(value.work_date);
	if (employment == null) refuse('The employment for this roster assignment no longer exists.');
	if (code == null) refuse('Choose a roster code that still exists.');
	if (code.company_id !== employment.company_id) {
		refuse(`Roster code ${code.code} belongs to another legal entity.`);
	}
	if (!coversDate(code.effective_range, date)) {
		refuse(`Roster code ${code.code} is not effective on ${date}.`);
	}
	if (value.roster_id == null) return;
	if (roster == null) refuse('The draft roster for this assignment no longer exists.');
	if (roster.published_at != null) {
		refuse(
			`Roster ${roster.month} is published, so its assignments are fixed. Re-open the month before changing it.`
		);
	}
	if (roster.company_id !== employment.company_id) {
		refuse('The employee and monthly roster belong to different legal entities.');
	}
	if (!date.startsWith(`${roster.month}-`)) {
		refuse(`${date} does not belong to roster ${roster.month}.`);
	}
}

/** Whether the monthly roster a change lands on is still open. Pure; the reads are its callers'. */
function assertRosterOpenIn(
	roster: { readonly month: string; readonly published_at: string | null } | null | undefined,
	rosterId: string | null | undefined
): void {
	if (rosterId == null) return;
	if (roster == null) refuse('The draft roster for this assignment no longer exists.');
	if (roster.published_at != null) {
		refuse(
			`Roster ${roster.month} is published, so its assignments are fixed. Re-open the month before changing it.`
		);
	}
}

function assertRosterOpen(
	api: HookApi,
	rosterId: string | null | undefined
): Effect.Effect<void, never, never> {
	if (rosterId == null) return Effect.void;
	return Effect.map(
		api.db.query.rosters.findFirst({
			where: { id: { eq: rosterId } },
			columns: { month: true, published_at: true }
		}),
		(roster) => assertRosterOpenIn(roster, rosterId)
	);
}

function assertAssignment(api: HookApi, value: AssignmentValue): Effect.Effect<void, never, never> {
	return Effect.map(
		Effect.all(
			[
				api.db.query.employments.findFirst({
					where: { id: { eq: value.employment_id } },
					columns: { company_id: true }
				}),
				api.db.query.shift_definitions.findFirst({
					where: { id: { eq: value.shift_definition_id } },
					columns: { company_id: true, code: true, variant: true, effective_range: true }
				}),
				value.roster_id == null
					? Effect.succeed(null)
					: api.db.query.rosters.findFirst({
							where: { id: { eq: value.roster_id } },
							columns: { company_id: true, month: true, published_at: true }
						})
			],
			{ concurrency: 'unbounded' }
		),
		([employment, code, roster]) => assertResolvedAssignment(value, employment, code, roster)
	);
}

/**
 * The write-side lock: a roster assignment must not change a day a paid payroll run already
 * settled, and a WORK day that approved leave already owns is not assignable — one writer wins
 * the day. Pending leave is deliberately NOT checked here; the board warns instead.
 */
function assertDayNotSettledIn(windows: readonly PayrollWindow[], workDate: string): void {
	assertNotSettled(windows, dateKey(workDate), 'Changing a roster assignment');
}

function assertDayNotSettled(
	api: HookApi,
	employmentId: string,
	workDate: string
): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		const employment = yield* api.db.query.employments.findFirst({
			where: { id: { eq: employmentId } },
			columns: { company_id: true }
		});
		if (employment == null) return;
		const runs = yield* api.db.query.payroll_runs.findMany({
			where: { company_id: { eq: employment.company_id } },
			columns: {
				period: true,
				lifecycle: true,
				attendance_from: true,
				attendance_to: true
			},
			limit: QUERY_LIMIT
		});
		assertDayNotSettledIn(payrollWindows(runs), workDate);
	});
}

/** One writer wins the day. Pure; both callers supply the leave that overlaps the day. */
function assertLeaveDoesNotOwnDay(
	requests: readonly LeaveRequestLike[],
	variant: RosterCodeVariant | null | undefined,
	workDate: string
): void {
	if (variant == null || rosterCodeKind(variant) !== 'WORK') return;
	const date = dateKey(workDate);
	const covering = requests.find((request) => leaveCoverage(request, date).fullDay);
	if (covering != null) {
		refuse(
			`${date} is covered by approved leave ${dateKey(covering.from_date)} → ` +
				`${dateKey(covering.to_date)} for this employment. Amend or cancel that leave first, ` +
				'or remove this assignment.'
		);
	}
}

function assertDayNotOwnedByLeave(
	api: HookApi,
	employmentId: string,
	workDate: string,
	shiftDefinitionId: string
): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		const code = yield* api.db.query.shift_definitions.findFirst({
			where: { id: { eq: shiftDefinitionId } },
			columns: { variant: true }
		});
		if (code == null || rosterCodeKind(code.variant) !== 'WORK') return;
		const date = dateKey(workDate);
		const requests = yield* api.db.query.leave_requests.findMany({
			where: {
				employment_id: { eq: employmentId },
				kind: { eq: 'TIME_OFF' },
				approval_id: { isNull: true },
				from_date: { lte: date },
				to_date: { gte: date }
			},
			columns: { from_date: true, to_date: true, half_day_start: true, half_day_end: true },
			limit: 200
		});
		assertLeaveDoesNotOwnDay(requests, code.variant, workDate);
	});
}

/**
 * Everything one roster assignment needs to know about the world, read once for the whole batch.
 *
 * A month of assignments for a hundred people is three thousand rows, and the rule below asked
 * twelve questions of each of them: the roster, the employment, the roster code, the payroll runs
 * of that employment's company, the approved leave over that day, and four more for the overlap
 * window. That is thirty-six thousand round trips out of the isolate for one publish. It is now
 * eight, whatever the size of the month.
 *
 * There used to be a function here called `assertBatchedDayRules`, which said in its own comment
 * that it existed "so a large import pays one round trip per company instead of one per row". It
 * was never called from anywhere. This is what it was reaching for, and every rule it restated is
 * back where it belongs — written once, for one record, below.
 */
interface RosterEntryBatch {
	readonly rosters: ReadonlyMap<string, RosterReference>;
	readonly employments: ReadonlyMap<string, EmploymentReference>;
	readonly codes: ReadonlyMap<string, RosterCodeReference>;
	readonly windowsByCompany: ReadonlyMap<string, ReadonlyArray<PayrollWindow>>;
	readonly leaveByEmployment: ReadonlyMap<string, ReadonlyArray<LeaveRequestLike>>;
	readonly overlap: OverlapData;
}

/** `Hooks` with what `prepare` returns filled in; see the note in `quote_lines/+hooks.ts`. */
type RosterEntryHooks = CollectionHooks<WorkspaceSchema, 'roster_entries', RosterEntryBatch>;

export default {
	create: {
		prepare: ({ inputs, api }) =>
			Effect.gen(function* () {
				const employmentIds = [
					...new Set(inputs.flatMap((input) => (input.employment_id ? [input.employment_id] : [])))
				];
				const codeIds = [
					...new Set(
						inputs.flatMap((input) =>
							input.shift_definition_id ? [input.shift_definition_id] : []
						)
					)
				];
				const rosterIds = [
					...new Set(inputs.flatMap((input) => (input.roster_id ? [input.roster_id] : [])))
				];
				const dates = inputs
					.map((input) => dateKey(input.work_date))
					.filter((date) => date !== '')
					.toSorted();
				const [employments, codes, rosters] = yield* Effect.all(
					[
						employmentIds.length
							? api.db.query.employments.findMany({
									where: { id: { in: employmentIds } },
									columns: { id: true, company_id: true },
									limit: QUERY_LIMIT
								})
							: Effect.succeed([]),
						codeIds.length
							? api.db.query.shift_definitions.findMany({
									where: { id: { in: codeIds } },
									columns: {
										id: true,
										company_id: true,
										code: true,
										variant: true,
										effective_range: true
									},
									limit: QUERY_LIMIT
								})
							: Effect.succeed([]),
						rosterIds.length
							? api.db.query.rosters.findMany({
									where: { id: { in: rosterIds } },
									columns: {
										id: true,
										company_id: true,
										month: true,
										published_at: true
									},
									limit: QUERY_LIMIT
								})
							: Effect.succeed([])
					],
					{ concurrency: 'unbounded' }
				);
				const companyIds = [...new Set(employments.map((employment) => employment.company_id))];
				const runs = companyIds.length
					? yield* api.db.query.payroll_runs.findMany({
							where: { company_id: { in: companyIds } },
							columns: {
								company_id: true,
								period: true,
								lifecycle: true,
								attendance_from: true,
								attendance_to: true
							},
							limit: QUERY_LIMIT
						})
					: [];
				const runsByCompany = new Map<string, Array<(typeof runs)[number]>>();
				for (const run of runs) {
					const grouped = runsByCompany.get(run.company_id) ?? [];
					grouped.push(run);
					runsByCompany.set(run.company_id, grouped);
				}
				const first = dates[0];
				const last = dates[dates.length - 1];
				const requests =
					employmentIds.length && first != null && last != null
						? yield* api.db.query.leave_requests.findMany({
								where: {
									employment_id: { in: employmentIds },
									kind: { eq: 'TIME_OFF' },
									approval_id: { isNull: true },
									from_date: { lte: last },
									to_date: { gte: first }
								},
								columns: {
									employment_id: true,
									from_date: true,
									to_date: true,
									half_day_start: true,
									half_day_end: true
								},
								limit: QUERY_LIMIT
							})
						: [];
				const leaveByEmployment = new Map<string, Array<LeaveRequestLike>>();
				for (const request of requests) {
					const grouped = leaveByEmployment.get(request.employment_id) ?? [];
					grouped.push(request);
					leaveByEmployment.set(request.employment_id, grouped);
				}
				const overlap = yield* readOverlapData(
					api,
					inputs.map((input) => ({
						employment_id: input.employment_id,
						work_date: input.work_date,
						shift_definition_id: input.shift_definition_id
					}))
				);
				return {
					rosters: new Map(rosters.map((roster) => [roster.id, roster])),
					employments: new Map(employments.map((employment) => [employment.id, employment])),
					codes: new Map(codes.map((code) => [code.id, code])),
					windowsByCompany: new Map(
						[...runsByCompany].map(([companyId, grouped]) => [companyId, payrollWindows(grouped)])
					),
					leaveByEmployment,
					overlap
				};
			}),
		perRecord: {
			before: {
				description:
					'Refuses assignments in a published month and verifies the roster code is valid for the employment, legal entity and work date.',
				handler: ({ input, prepared }) => {
					const rosterId = input.roster_id ?? null;
					const roster = rosterId == null ? null : (prepared.rosters.get(rosterId) ?? null);
					assertRosterOpenIn(roster, rosterId);
					const employment = prepared.employments.get(input.employment_id);
					const code = prepared.codes.get(input.shift_definition_id);
					assertResolvedAssignment(
						{
							employment_id: input.employment_id,
							work_date: input.work_date,
							shift_definition_id: input.shift_definition_id,
							roster_id: rosterId
						},
						employment,
						code,
						roster
					);
					assertNoOverlap(prepared.overlap, [
						{
							employment_id: input.employment_id,
							work_date: input.work_date,
							shift_definition_id: input.shift_definition_id
						}
					]);
					// An employment the batch could not find has no company and therefore no window,
					// which is the same silence the per-record lookup produced when it found nothing.
					const windows =
						employment == null ? [] : (prepared.windowsByCompany.get(employment.company_id) ?? []);
					assertDayNotSettledIn(windows, input.work_date);
					assertLeaveDoesNotOwnDay(
						prepared.leaveByEmployment.get(input.employment_id) ?? [],
						code?.variant,
						input.work_date
					);
					return input;
				}
			}
		}
	},
	update: {
		perRecord: {
			before: {
				description:
					'Refuses edits in a published month and validates the complete resulting roster-code assignment.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						yield* assertRosterOpen(api, existing.roster_id);
						if (input.roster_id != null && input.roster_id !== existing.roster_id) {
							yield* assertRosterOpen(api, input.roster_id);
						}
						yield* assertAssignment(api, {
							employment_id: input.employment_id ?? existing.employment_id,
							work_date: input.work_date ?? existing.work_date,
							shift_definition_id: input.shift_definition_id ?? existing.shift_definition_id,
							roster_id: input.roster_id === undefined ? existing.roster_id : input.roster_id
						});
						yield* assertNoOverlappingAssignments(api, [
							...(input.employment_id != null || input.work_date != null
								? [
										{
											employment_id: existing.employment_id,
											work_date: existing.work_date,
											shift_definition_id: null,
											existing_id: existing.id
										}
									]
								: []),
							{
								employment_id: input.employment_id ?? existing.employment_id,
								work_date: input.work_date ?? existing.work_date,
								shift_definition_id: input.shift_definition_id ?? existing.shift_definition_id,
								existing_id: existing.id
							}
						]);
						yield* assertDayNotSettled(
							api,
							input.employment_id ?? existing.employment_id,
							input.work_date ?? existing.work_date
						);
						yield* assertDayNotOwnedByLeave(
							api,
							input.employment_id ?? existing.employment_id,
							input.work_date ?? existing.work_date,
							input.shift_definition_id ?? existing.shift_definition_id
						);
						return input;
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Refuses to remove an assignment from a published monthly roster or from a day a paid payroll run settled.',
				handler: ({ existing, api }) =>
					Effect.gen(function* () {
						yield* assertRosterOpen(api, existing.roster_id);
						yield* assertDayNotSettled(api, existing.employment_id, existing.work_date);
						yield* assertNoOverlappingAssignments(api, [
							{
								employment_id: existing.employment_id,
								work_date: existing.work_date,
								shift_definition_id: null,
								existing_id: existing.id
							}
						]);
					})
			}
		}
	}
} satisfies RosterEntryHooks;
