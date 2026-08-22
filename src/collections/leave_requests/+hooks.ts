import { Effect, Schema } from 'effect';
import { refuse, type SchemaQueryConfig } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types.js';
import { dateKey } from '../../lib/iso-day.js';
import { pointAt, pointNumber } from '../../lib/half-day.js';
import { completedMonths } from '../payroll_runs/lib/dates.js';
import { leaveBalance, resolveEntitlement, type LedgerRow } from '../payroll_runs/lib/leave.js';
import { coversDate } from '../payroll_runs/lib/effective.js';
import { patternRosterCodeId } from '../../lib/scheduling/work-pattern.js';
import { rosterCodeKind } from '../../lib/scheduling/roster-code.js';
import {
	payrollWindows,
	assertNotSettled,
	sourceLock,
	sourceLockBlocksWrite,
	sourceLockMessage
} from '../../lib/scheduling/lock.js';
import type { LeaveEvent } from '../../datatypes/leave_event/+definition.js';
import type { Hooks, WorkspaceRow } from './$types.js';

const halfSchema = Schema.Union([Schema.Literal('FIRST'), Schema.Literal('SECOND')]);
type Half = Schema.Schema.Type<typeof halfSchema>;
const pointSchema = Schema.Struct({ date: Schema.String, half: halfSchema });
type Point = Schema.Schema.Type<typeof pointSchema>;
type TimeOffEvent = Extract<LeaveEvent, { kind: 'TIME_OFF' }>;

const LIMIT = 20_000;
const DAY_MS = 86_400_000;

function rangeOf(event: TimeOffEvent): { start: Point; end: Point } {
	return event.range;
}

function assertRange(range: { start: Point; end: Point }): void {
	if (pointNumber(range.end) < pointNumber(range.start)) {
		refuse('Leave must end after it starts. Select one continuous range on the calendar.');
	}
}

function monthRanges(start: string, end: string): Array<{ start: string; end: string }> {
	const ranges: Array<{ start: string; end: string }> = [];
	let cursor = new Date(`${start.slice(0, 7)}-01T00:00:00.000Z`);
	const last = new Date(`${end.slice(0, 7)}-01T00:00:00.000Z`);
	while (cursor <= last) {
		const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
		ranges.push({
			start: cursor.toISOString().slice(0, 10),
			end: new Date(next.getTime() - DAY_MS).toISOString().slice(0, 10)
		});
		cursor = next;
	}
	return ranges;
}

type HookApi = Parameters<
	NonNullable<NonNullable<NonNullable<Hooks['create']>['perRecord']>['before']>['handler']
>[0]['api'];

type EmploymentTermRow = Pick<
	WorkspaceRow<'employment_terms'>,
	'employment_id' | 'work_pattern' | 'effective_range'
>;
type RosterEntryRow = Pick<
	WorkspaceRow<'roster_entries'>,
	'employment_id' | 'work_date' | 'shift_definition_id'
>;
type CompanyHolidayRow = Pick<WorkspaceRow<'company_holidays'>, 'company_id' | 'date'>;
type RosterCodeRow = Pick<WorkspaceRow<'shift_definitions'>, 'id' | 'variant'>;
type SettledRunRow = Pick<
	WorkspaceRow<'payroll_runs'>,
	'period' | 'lifecycle' | 'attendance_from' | 'attendance_to'
>;
type RequestRow = Pick<
	WorkspaceRow<'leave_requests'>,
	| 'id'
	| 'employment_id'
	| 'leave_type_id'
	| 'kind'
	| 'from_date'
	| 'to_date'
	| 'days'
	| 'event'
	| 'approval_id'
>;

/**
 * The database surface `normalizedTimeOff` reads, stated so the batch path can drive the same
 * function against rows it already fetched instead of the live api. The real hook api satisfies
 * it, and the batch's in-memory api satisfies it without a cast.
 */
type NormalizationApi = {
	db: {
		query: {
			employments: {
				findFirst(
					options: SchemaQueryConfig<WorkspaceSchema, 'employments'>
				): Effect.Effect<WorkspaceRow<'employments'> | undefined, never, never>;
			};
			companies: {
				findFirst(
					options: SchemaQueryConfig<WorkspaceSchema, 'companies'>
				): Effect.Effect<WorkspaceRow<'companies'> | undefined, never, never>;
			};
			leave_types: {
				findFirst(
					options: SchemaQueryConfig<WorkspaceSchema, 'leave_types'>
				): Effect.Effect<WorkspaceRow<'leave_types'> | undefined, never, never>;
			};
			company_holidays: {
				findMany(
					options: SchemaQueryConfig<WorkspaceSchema, 'company_holidays'>
				): Effect.Effect<CompanyHolidayRow[], never, never>;
			};
			employment_terms: {
				findMany(
					options: SchemaQueryConfig<WorkspaceSchema, 'employment_terms'>
				): Effect.Effect<EmploymentTermRow[], never, never>;
			};
			roster_entries: {
				findMany(
					options: SchemaQueryConfig<WorkspaceSchema, 'roster_entries'>
				): Effect.Effect<RosterEntryRow[], never, never>;
			};
			leave_requests: {
				findMany(
					options: SchemaQueryConfig<WorkspaceSchema, 'leave_requests'>
				): Effect.Effect<RequestRow[], never, never>;
			};
			payroll_runs: {
				findMany(
					options: SchemaQueryConfig<WorkspaceSchema, 'payroll_runs'>
				): Effect.Effect<SettledRunRow[], never, never>;
			};
			shift_definitions: {
				findMany(
					options: SchemaQueryConfig<WorkspaceSchema, 'shift_definitions'>
				): Effect.Effect<RosterCodeRow[], never, never>;
			};
		};
	};
};

function isSeedNormalizedTimeOff(event: LeaveEvent | null | undefined): boolean {
	return (
		event != null &&
		event.kind === 'TIME_OFF' &&
		event.range != null &&
		typeof event.range.start?.date === 'string' &&
		typeof event.range.end?.date === 'string' &&
		typeof event.chargeable_days === 'number' &&
		Number.isFinite(event.chargeable_days) &&
		event.chargeable_days > 0
	);
}

function normalizedTimeOff(
	api: NormalizationApi,
	employmentId: string,
	leaveTypeId: string,
	event: TimeOffEvent,
	excludeId?: string
): Effect.Effect<TimeOffEvent, never, never> {
	return Effect.gen(function* () {
		const range = rangeOf(event);
		assertRange(range);

		const employment = yield* api.db.query.employments.findFirst({
			where: { id: { eq: employmentId } }
		});
		if (employment == null) refuse('The leave request must reference an employment on file.');
		if (range.start.date < dateKey(employment.hire_date)) {
			refuse('Leave cannot start before the employment hire date.');
		}
		if (employment.exit_date != null && range.end.date > dateKey(employment.exit_date)) {
			refuse('Leave cannot end after the employment exit date.');
		}

		const [company, leaveType, holidays, terms, rosterEntries, existingRequests] =
			yield* Effect.all(
				[
					api.db.query.companies.findFirst({
						where: { id: { eq: employment.company_id } }
					}),
					api.db.query.leave_types.findFirst({
						where: { id: { eq: leaveTypeId }, company_id: { eq: employment.company_id } }
					}),
					api.db.query.company_holidays.findMany({
						where: {
							company_id: { eq: employment.company_id },
							date: { gte: range.start.date, lte: range.end.date }
						},
						limit: LIMIT
					}),
					api.db.query.employment_terms.findMany({
						where: { employment_id: { eq: employmentId } },
						limit: LIMIT
					}),
					api.db.query.roster_entries.findMany({
						where: {
							employment_id: { eq: employmentId },
							work_date: { gte: range.start.date, lte: range.end.date }
						},
						limit: LIMIT
					}),
					api.db.query.leave_requests.findMany({
						where: {
							employment_id: { eq: employmentId },
							kind: { eq: 'TIME_OFF' },
							from_date: { lte: range.end.date },
							to_date: { gte: range.start.date }
						},
						limit: LIMIT
					})
				],
				{ concurrency: 'unbounded' }
			);
		if (company == null) refuse('The employing entity no longer exists.');
		if (leaveType == null) refuse('That leave type does not belong to the employing entity.');
		if (!coversDate(leaveType.effective_range, range.start.date)) {
			refuse('That leave type is not effective when the selected range starts.');
		}

		for (const request of existingRequests) {
			if (request.id === excludeId) continue;
			if (request.event == null || request.event.kind !== 'TIME_OFF') continue;
			const other = rangeOf(request.event);
			if (
				pointNumber(other.start) <= pointNumber(range.end) &&
				pointNumber(other.end) >= pointNumber(range.start)
			) {
				refuse(
					`The selected half-day range overlaps another leave request beginning ${other.start.date}.`
				);
			}
		}

		// A leave range must not touch a day a paid payroll run already settled: those days are the
		// record of what was paid, and moving leave across them would rewrite settled money.
		const settledRuns = yield* api.db.query.payroll_runs.findMany({
			where: { company_id: { eq: employment.company_id }, lifecycle: { eq: 'PAID' } },
			columns: { period: true, lifecycle: true, attendance_from: true, attendance_to: true },
			limit: LIMIT
		});
		const settledWindows = payrollWindows(settledRuns);
		for (let number = pointNumber(range.start); number <= pointNumber(range.end); number += 1) {
			assertNotSettled(settledWindows, pointAt(number).date, 'Changing a leave request');
		}

		// An encashment pays the remaining balance out. Once it exists for this leave type, nothing
		// further may be taken against it — the balance the guard checks has been settled as money.
		const encashed = yield* api.db.query.leave_requests.findMany({
			where: {
				employment_id: { eq: employmentId },
				leave_type_id: { eq: leaveTypeId },
				kind: { eq: 'ENCASHMENT' },
				approval_id: { isNull: true }
			},
			columns: { id: true },
			limit: 100
		});
		if (encashed.length > 0) {
			refuse(
				`${leaveType.code} was encashed on exit for this employment, so no further leave can be taken against it.`
			);
		}

		const shiftIds = [
			...new Set([
				...rosterEntries.map((entry: RosterEntryRow) => entry.shift_definition_id),
				...terms.flatMap((term: EmploymentTermRow) => {
					const pattern = term.work_pattern;
					if (pattern?.type !== 'PATTERNED') return [];
					return pattern.phases.flatMap((phase) =>
						phase.day_cycle.map((day) => day.roster_code_id)
					);
				})
			])
		];
		const rosterCodes = yield* api.db.query.shift_definitions.findMany({
			where: { id: { in: shiftIds } },
			limit: LIMIT
		});
		const rosterCodeById = new Map(rosterCodes.map((code: RosterCodeRow) => [code.id, code]));
		const rosterByDate: Map<string, RosterEntryRow> = new Map(
			rosterEntries.map((entry: RosterEntryRow) => [dateKey(entry.work_date), entry])
		);
		const holidayDates = new Set(
			holidays.map((holiday: CompanyHolidayRow) => dateKey(holiday.date))
		);

		const eligible = (date: string): boolean => {
			if (holidayDates.has(date)) return false;
			const term = terms.find((candidate: EmploymentTermRow) =>
				coversDate(candidate.effective_range, date)
			);
			if (term == null) refuse(`No employment terms cover ${date}, so leave cannot be measured.`);
			const rosterCodeId =
				rosterByDate.get(date)?.shift_definition_id ?? patternRosterCodeId(term.work_pattern, date);
			if (rosterCodeId == null) {
				return term.work_pattern?.type === 'ROSTERED';
			}
			const code = rosterCodeById.get(rosterCodeId);
			if (code == null)
				return refuse(`The schedule on ${date} names a roster code that no longer exists.`);
			return rosterCodeKind(code.variant) === 'WORK';
		};

		let chargedHalfDays = 0;
		for (let number = pointNumber(range.start); number <= pointNumber(range.end); number += 1) {
			if (eligible(pointAt(number).date)) chargedHalfDays += 1;
		}
		if (chargedHalfDays === 0) {
			refuse(
				'The selected range contains no scheduled work half-days after holidays and rest/off days are excluded.'
			);
		}

		if (leaveType.accrual?.kind !== 'PER_EVENT') {
			const allLedger = yield* api.db.query.leave_requests.findMany({
				where: { employment_id: { eq: employmentId }, leave_type_id: { eq: leaveTypeId } },
				limit: LIMIT
			});
			const projectedLedger: LedgerRow[] = allLedger.flatMap((row) => {
				if (row.id === excludeId || row.from_date == null) return [];
				return [
					{
						...row,
						entry_date: row.from_date,
						days: row.kind === 'TIME_OFF' ? -Math.abs(Number(row.days)) : Number(row.days),
						source_id: null
					}
				];
			});
			const entitlementAtMonths = (serviceMonths: number) =>
				resolveEntitlement({
					leaveType,
					serviceMonths,
					employmentId,
					asOf: range.end.date
				});
			const available = leaveBalance(
				{
					leaveType,
					entitlementAtMonths,
					hireDate: dateKey(employment.hire_date),
					exitDate: employment.exit_date == null ? null : dateKey(employment.exit_date),
					leaveYearStartMonth: Number(company.leave_year_start_month),
					ledger: projectedLedger,
					basis: 'PROJECTED'
				},
				range.end.date
			);
			const requestedDays = chargedHalfDays / 2;
			if (requestedDays > available + 1e-9) {
				refuse(
					`This range charges ${requestedDays} day(s), but only ${Math.max(0, available)} day(s) are available.`
				);
			}
			// Resolve once here as a loud policy check even when no accrued balance exists yet.
			entitlementAtMonths(completedMonths(dateKey(employment.hire_date), range.end.date));
		}

		return {
			...event,
			range,
			chargeable_days: chargedHalfDays / 2
		};
	});
}

function assertLeaveSourceUnlocked(
	api: HookApi,
	existing: WorkspaceRow<'leave_requests'>,
	action: string
): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		/**
		 * The settlement lock, and now the only thing that freezes an existing leave request.
		 *
		 * Leave used to be held by three facts that were not consumption: an approval stamp, a passed
		 * date, and a paid window around the request's days. The owner's rule is that a record locks
		 * only when a payslip consumed it — so `APPROVED` and `DATE_PASSED` stop blocking here, and
		 * the window keeps only its create-side job, which is the `assertNotSettled` loop in
		 * `normalizedTimeOff`: a new or moved range may not touch days a paid run already priced.
		 * What is left is a `payslip_sources` row naming this request, which says payroll `period`
		 * took it into account and names the run that has to be deleted (while it is still a draft)
		 * to release it.
		 */
		const claim = yield* api.db.query.payslip_sources.findFirst({
			where: { source: { eq: { kind: 'LEAVE_REQUEST', id: existing.id } } },
			columns: { period: true }
		});
		const lock = sourceLock({
			existing: true,
			approvalId: existing.approval_id,
			dates: [],
			settledBy: claim == null ? null : { period: claim.period },
			datePassed: 'IS_NOT_A_LOCK'
		});
		if (sourceLockBlocksWrite(lock)) {
			refuse(sourceLockMessage(lock, action));
		}
	});
}

export default {
	create: {
		perRecord: {
			before: {
				description:
					'Normalizes one half-day-stepped leave range, excludes observed holidays and scheduled rest/off days, refuses overlaps and requests beyond the projected balance.',
				handler: ({ input, api }) =>
					Effect.gen(function* () {
						if (input.event == null || input.event.kind !== 'TIME_OFF') return input;
						return {
							...input,
							event: yield* normalizedTimeOff(
								api,
								input.employment_id,
								input.leave_type_id,
								input.event
							)
						};
					})
			}
		}
	},
	update: {
		perRecord: {
			before: {
				description:
					'Refuses a leave request a payroll run has already taken into account, then re-checks the patched range so a change cannot bypass schedule exclusions, overlap protection or balance limits.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						yield* assertLeaveSourceUnlocked(api, existing, 'Changing a leave request');
						const event = input.event ?? existing.event;
						if (event == null || event.kind !== 'TIME_OFF') return input;
						return {
							...input,
							event: yield* normalizedTimeOff(
								api,
								input.employment_id ?? existing.employment_id,
								input.leave_type_id ?? existing.leave_type_id,
								event,
								existing.id
							)
						};
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Refuses deleting a leave request a payroll run has already taken into account. Corrections are new events.',
				handler: ({ existing, api }) =>
					assertLeaveSourceUnlocked(api, existing, 'Deleting a leave request')
			}
		}
	}
} satisfies Hooks;
