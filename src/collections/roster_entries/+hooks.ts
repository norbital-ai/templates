import type { CollectionHooks } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { WorkspaceSchema } from '$bolt/types.js';
import type { RosterCodeVariant } from '../../custom-types/roster_code_variant/+definition.js';
import { rosterCodeKind, workWindow } from '../../lib/scheduling/roster-code.js';
import { leaveCoverage, type LeaveRequestLike } from '../../lib/scheduling/leave-coverage.js';
import { payrollWindows, assertNotSettled, type PayrollWindow } from '../../lib/scheduling/lock.js';
import { patternRosterCodeId } from '../../lib/scheduling/work-pattern.js';
import { overlappingWorkShifts, type ValidationDay } from '../rosters/lib/workforce-validation.js';
import type { HookApi, Hooks, WorkspaceRow } from './$types.js';

type CreateInput = Parameters<
	NonNullable<
		NonNullable<NonNullable<NonNullable<Hooks['create']>['perRecord']>['before']>['handler']
	>
>[0]['input'];

const QUERY_LIMIT = 20_000;
const DAY_MS = 86_400_000;

function dateKey(value: string | Date | null | undefined): string {
	if (value == null) return '';
	return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function rangeCovers(
	range: { readonly start?: string | Date; readonly end?: string | Date } | null,
	date: string
): boolean {
	if (range?.start == null) return false;
	return date >= dateKey(range.start) && (range.end == null || date <= dateKey(range.end));
}

type AssignmentValue = {
	readonly employment_id: string;
	readonly work_date: string | Date;
	readonly shift_definition_id: string;
	readonly roster_id: string | null;
};

type EmploymentReference = { readonly company_id: string };
type RosterCodeReference = Pick<
	WorkspaceRow<'shift_definitions'>,
	'company_id' | 'code' | 'variant' | 'effective_range'
>;
type RosterReference = {
	readonly company_id: string;
	readonly month: string;
	readonly published_at: string | Date | null;
};

type AssignmentChange = {
	readonly employment_id: string;
	readonly work_date: string | Date;
	/** Null means the explicit override is being removed and the pattern baseline resumes. */
	readonly shift_definition_id: string | null;
	readonly existing_id?: string;
};

function addDays(date: string, amount: number): string {
	return new Date(Date.parse(`${date}T00:00:00.000Z`) + amount * DAY_MS).toISOString().slice(0, 10);
}

type ExplicitEntry = {
	readonly norbital_id: string;
	readonly employment_id: string;
	readonly work_date: string;
	readonly shift_definition_id: string;
};

/**
 * Everything the overlap rule reads, for however many changes it is asked about at once.
 *
 * The rule is about one employment's three-day neighbourhood, but the *reads* are the same four
 * queries whether they answer for one row or three thousand — which is exactly the split `prepare`
 * exists for. A published month is written a whole month at a time, so asking per row cost four
 * round trips a row.
 */
type OverlapData = {
	readonly termsByEmployment: ReadonlyMap<
		string,
		ReadonlyArray<Pick<WorkspaceRow<'employment_terms'>, 'work_pattern' | 'effective_range'>>
	>;
	readonly explicitByKey: ReadonlyMap<string, ExplicitEntry>;
	readonly codeById: ReadonlyMap<
		string,
		{ readonly code: string; readonly variant: RosterCodeVariant }
	>;
};

/** The four reads. Data only — every refusal below is `assertNoOverlap`'s. */
function readOverlapData(
	api: HookApi,
	changes: readonly AssignmentChange[]
): Effect.Effect<OverlapData, never, never> {
	return Effect.gen(function* () {
		const employmentIds = [...new Set(changes.map((change) => change.employment_id))];
		const changedDates = changes.map((change) => dateKey(change.work_date));
		const first = addDays(changedDates.toSorted()[0]!, -1);
		const last = addDays(changedDates.toSorted().at(-1)!, 1);
		const [employments, terms, existingEntries] = yield* Effect.all(
			[
				api.db.query.employments.findMany({
					where: { norbital_id: { in: employmentIds } },
					columns: { norbital_id: true, company_id: true },
					limit: Math.max(1, employmentIds.length)
				}),
				api.db.query.employment_terms.findMany({
					where: { employment_id: { in: employmentIds } },
					columns: { employment_id: true, work_pattern: true, effective_range: true },
					limit: QUERY_LIMIT
				}),
				api.db.query.roster_entries.findMany({
					where: {
						employment_id: { in: employmentIds },
						work_date: { gte: first, lte: last }
					},
					columns: {
						norbital_id: true,
						employment_id: true,
						work_date: true,
						shift_definition_id: true
					},
					limit: QUERY_LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		if (terms.length === QUERY_LIMIT || existingEntries.length === QUERY_LIMIT) {
			throw new Error('This schedule is too large to validate safely in one write.');
		}
		const companyIds = [...new Set(employments.map((employment) => employment.company_id))];
		const codes = yield* api.db.query.shift_definitions.findMany({
			where: { company_id: { in: companyIds } },
			columns: { norbital_id: true, code: true, variant: true },
			limit: QUERY_LIMIT
		});
		if (codes.length === QUERY_LIMIT) {
			throw new Error('This legal entity has too many roster codes to validate safely.');
		}

		const termsByEmployment = new Map<string, Array<(typeof terms)[number]>>();
		for (const term of terms) {
			const bucket = termsByEmployment.get(term.employment_id);
			if (bucket) bucket.push(term);
			else termsByEmployment.set(term.employment_id, [term]);
		}
		return {
			termsByEmployment,
			explicitByKey: new Map(
				existingEntries.map((entry) => [
					`${entry.employment_id}:${dateKey(entry.work_date)}`,
					{
						norbital_id: entry.norbital_id,
						employment_id: entry.employment_id,
						work_date: dateKey(entry.work_date),
						shift_definition_id: entry.shift_definition_id
					}
				])
			),
			codeById: new Map(codes.map((code) => [code.norbital_id, code]))
		};
	});
}

/** Reject a draft write that would make two WORK windows occupy the same real minute. */
function assertNoOverlap(data: OverlapData, changes: readonly AssignmentChange[]): void {
	if (changes.length === 0) return;
	const removedIds = new Set(
		changes.flatMap((change) => (change.existing_id ? [change.existing_id] : []))
	);
	// The changes overlay the stored day, exactly as the single-shot version did by mutating its own
	// copy of the map. Reading through an overlay rather than rebuilding it keeps this O(changes)
	// instead of O(batch × stored entries) when it is called once per record.
	const overlay = new Map<string, ExplicitEntry | null>();
	for (const change of changes) {
		const key = `${change.employment_id}:${dateKey(change.work_date)}`;
		overlay.set(
			key,
			change.shift_definition_id == null
				? null
				: {
						norbital_id: change.existing_id ?? '',
						employment_id: change.employment_id,
						work_date: dateKey(change.work_date),
						shift_definition_id: change.shift_definition_id
					}
		);
	}
	const explicitAt = (key: string): ExplicitEntry | undefined => {
		if (overlay.has(key)) return overlay.get(key) ?? undefined;
		const stored = data.explicitByKey.get(key);
		return stored != null && removedIds.has(stored.norbital_id) ? undefined : stored;
	};

	const datesByEmployment = new Map<string, Set<string>>();
	for (const change of changes) {
		const date = dateKey(change.work_date);
		const bucket = datesByEmployment.get(change.employment_id) ?? new Set<string>();
		bucket.add(addDays(date, -1));
		bucket.add(date);
		bucket.add(addDays(date, 1));
		datesByEmployment.set(change.employment_id, bucket);
	}

	const days: ValidationDay[] = [];
	for (const [employmentId, dates] of datesByEmployment) {
		for (const date of dates) {
			const explicit = explicitAt(`${employmentId}:${date}`);
			const term = (data.termsByEmployment.get(employmentId) ?? []).find((candidate) =>
				rangeCovers(candidate.effective_range, date)
			);
			const codeId =
				explicit?.shift_definition_id ??
				(term == null ? null : patternRosterCodeId(term.work_pattern, date));
			const code = codeId == null ? null : data.codeById.get(codeId);
			const kind = code == null ? null : rosterCodeKind(code.variant);
			const window = kind === 'WORK' ? workWindow(code?.variant) : null;
			days.push({
				employment_id: employmentId,
				work_date: date,
				designation: kind,
				shift:
					window == null || code == null
						? null
						: {
								code: code.code,
								start_time: window.start_time,
								end_time: window.end_time,
								break_minutes: window.break_minutes
							}
			});
		}
	}
	const [overlap] = overlappingWorkShifts(days);
	if (overlap != null) {
		throw new Error(
			`${overlap.first.work_date} ${overlap.first.shift?.code ?? 'WORK'} overlaps ${overlap.second.work_date} ${overlap.second.shift?.code ?? 'WORK'} for this employment.`
		);
	}
}

/**
 * Read, then decide — for the two paths that have no batch to read for.
 *
 * `update` and `delete` are authored for one existing record and the platform gives them no view of
 * the call they arrived in, so they pay their own four reads. The decision is `assertNoOverlap`'s
 * either way; only where its data comes from differs.
 */
function assertNoOverlappingAssignments(
	api: HookApi,
	changes: readonly AssignmentChange[]
): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		if (changes.length === 0) return;
		assertNoOverlap(yield* readOverlapData(api, changes), changes);
	});
}

function assertResolvedAssignment(
	value: AssignmentValue,
	employment: EmploymentReference | null | undefined,
	code: RosterCodeReference | null | undefined,
	roster: RosterReference | null | undefined
): void {
	const date = dateKey(value.work_date);
	if (employment == null)
		throw new Error('The employment for this roster assignment no longer exists.');
	if (code == null) throw new Error('Choose a roster code that still exists.');
	if (code.company_id !== employment.company_id) {
		throw new Error(`Roster code ${code.code} belongs to another legal entity.`);
	}
	if (!rangeCovers(code.effective_range, date)) {
		throw new Error(`Roster code ${code.code} is not effective on ${date}.`);
	}
	if (value.roster_id == null) return;
	if (roster == null) throw new Error('The draft roster for this assignment no longer exists.');
	if (roster.published_at != null) {
		throw new Error(
			`Roster ${roster.month} is published, so its assignments are fixed. Re-open the month before changing it.`
		);
	}
	if (roster.company_id !== employment.company_id) {
		throw new Error('The employee and monthly roster belong to different legal entities.');
	}
	if (!date.startsWith(`${roster.month}-`)) {
		throw new Error(`${date} does not belong to roster ${roster.month}.`);
	}
}

/** Whether the monthly roster a change lands on is still open. Pure; the reads are its callers'. */
function assertRosterOpenIn(
	roster:
		{ readonly month: string; readonly published_at: string | Date | null } | null | undefined,
	rosterId: string | null | undefined
): void {
	if (rosterId == null) return;
	if (roster == null) throw new Error('The draft roster for this assignment no longer exists.');
	if (roster.published_at != null) {
		throw new Error(
			`Roster ${roster.month} is published, so its assignments are fixed. Re-open the month before changing it.`
		);
	}
}

function assertRosterOpen(
	api: HookApi,
	rosterId: string | null | undefined
): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		if (rosterId == null) return;
		const roster = yield* api.db.query.rosters.findFirst({
			where: { norbital_id: { eq: rosterId } },
			columns: { month: true, published_at: true }
		});
		assertRosterOpenIn(roster, rosterId);
	});
}

function assertAssignment(api: HookApi, value: AssignmentValue): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		const [employment, code, roster] = yield* Effect.all(
			[
				api.db.query.employments.findFirst({
					where: { norbital_id: { eq: value.employment_id } },
					columns: { company_id: true }
				}),
				api.db.query.shift_definitions.findFirst({
					where: { norbital_id: { eq: value.shift_definition_id } },
					columns: { company_id: true, code: true, variant: true, effective_range: true }
				}),
				value.roster_id == null
					? Effect.succeed(null)
					: api.db.query.rosters.findFirst({
							where: { norbital_id: { eq: value.roster_id } },
							columns: { company_id: true, month: true, published_at: true }
						})
			],
			{ concurrency: 'unbounded' }
		);
		assertResolvedAssignment(value, employment, code, roster);
	});
}

/**
 * The write-side lock: a roster assignment must not change a day a paid payroll run already
 * settled, and a WORK day that approved leave already owns is not assignable — one writer wins
 * the day. Pending leave is deliberately NOT checked here; the board warns instead.
 */
function assertDayNotSettledIn(windows: readonly PayrollWindow[], workDate: string | Date): void {
	assertNotSettled(windows, dateKey(workDate), 'Changing a roster assignment');
}

function assertDayNotSettled(
	api: HookApi,
	employmentId: string,
	workDate: string | Date
): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		const employment = yield* api.db.query.employments.findFirst({
			where: { norbital_id: { eq: employmentId } },
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
	workDate: string | Date
): void {
	if (variant == null || rosterCodeKind(variant) !== 'WORK') return;
	const date = dateKey(workDate);
	const covering = requests.find((request) => leaveCoverage(request, date).fullDay);
	if (covering != null) {
		throw new Error(
			`${date} is covered by approved leave ${dateKey(covering.from_date)} → ` +
				`${dateKey(covering.to_date)} for this employment. Amend or cancel that leave first, ` +
				'or remove this assignment.'
		);
	}
}

function assertDayNotOwnedByLeave(
	api: HookApi,
	employmentId: string,
	workDate: string | Date,
	shiftDefinitionId: string
): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		const code = yield* api.db.query.shift_definitions.findFirst({
			where: { norbital_id: { eq: shiftDefinitionId } },
			columns: { variant: true }
		});
		if (code == null || rosterCodeKind(code.variant) !== 'WORK') return;
		const date = dateKey(workDate);
		const requests = yield* api.db.query.leave_requests.findMany({
			where: {
				employment_id: { eq: employmentId },
				kind: { eq: 'TIME_OFF' },
				norbital_approval_id: { isNull: true },
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
									where: { norbital_id: { in: employmentIds } },
									columns: { norbital_id: true, company_id: true },
									limit: QUERY_LIMIT
								})
							: Effect.succeed([]),
						codeIds.length
							? api.db.query.shift_definitions.findMany({
									where: { norbital_id: { in: codeIds } },
									columns: {
										norbital_id: true,
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
									where: { norbital_id: { in: rosterIds } },
									columns: {
										norbital_id: true,
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
									norbital_approval_id: { isNull: true },
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
					rosters: new Map(rosters.map((roster) => [roster.norbital_id, roster])),
					employments: new Map(
						employments.map((employment) => [employment.norbital_id, employment])
					),
					codes: new Map(codes.map((code) => [code.norbital_id, code])),
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
											existing_id: existing.norbital_id
										}
									]
								: []),
							{
								employment_id: input.employment_id ?? existing.employment_id,
								work_date: input.work_date ?? existing.work_date,
								shift_definition_id: input.shift_definition_id ?? existing.shift_definition_id,
								existing_id: existing.norbital_id
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
								existing_id: existing.norbital_id
							}
						]);
					})
			}
		}
	}
} satisfies RosterEntryHooks;
