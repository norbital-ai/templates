import { Effect, Schema } from 'effect';
import { refuse, type SchemaQueryConfig } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types.js';
import type { WorkspaceRow } from '../../collections/leave_requests/$types.js';
import { calendarDay, dateKey } from '../iso-day.js';
import { pointAt, pointNumber, type HalfDayRange } from '../half-day.js';
import {
	leaveBalance,
	resolveEntitlement,
	type ChildFact,
	type LedgerRow
} from '../../collections/payroll_runs/lib/leave.js';
import type { Jurisdiction, LeaveType } from '../../collections/payroll_runs/lib/configuration.js';
import { sealedProfileCovering } from '../statutory_profile.js';
import { coversDate } from '../../collections/payroll_runs/lib/effective.js';
import { patternRosterCodeId } from '../scheduling/work-pattern.js';
import { rosterCodeKind, workWindowHalves } from '../scheduling/roster-code.js';
import { lockStateForDate, payrollWindows } from '../scheduling/lock.js';
import { decodeNumber } from '@norbital-ai/std/json';
import { calendarDaysThrough, leaveCalendarGridBounds } from './calendar-grid.js';

/**
 * Server-side leave preview: remaining bank, chargeable days, and per-day eligibility.
 *
 * The picker invokes this as `preview_leave` before apply. The `leave_requests` hook runs the same
 * function on write. Both gather person-scoped rows and derive; nothing stores a remaining balance.
 */

const LEAVE_PREVIEW_QUERY_LIMIT = 20_000;

const dayHalfSchema = Schema.Literals(['FIRST', 'SECOND']);
const leavePreviewRangeSchema = Schema.Struct({
	start: Schema.Struct({ date: calendarDay, half: dayHalfSchema }),
	end: Schema.Struct({ date: calendarDay, half: dayHalfSchema })
});

export const previewLeaveInputSchema = Schema.Struct({
	employment_id: Schema.String.check(Schema.isUUID()),
	leave_type_id: Schema.String.check(Schema.isUUID()),
	calendar_month: Schema.optionalKey(
		Schema.String.check(Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])$/))
	),
	range: Schema.optionalKey(leavePreviewRangeSchema),
	exclude_request_id: Schema.optionalKey(Schema.String.check(Schema.isUUID()))
});
export type PreviewLeaveInput = Schema.Schema.Type<typeof previewLeaveInputSchema>;

const leavePreviewIssueCodes = [
	'RANGE_INVERTED',
	'BEFORE_HIRE',
	'AFTER_EXIT',
	'OVERLAP',
	'SETTLED_WINDOW',
	'ENCASHED',
	'NO_TERMS',
	'MISSING_ROSTER_CODE',
	'NO_CHARGEABLE_DAYS',
	'OVERDRAW',
	'MISSING_PROFILE',
	'MISSING_JURISDICTION',
	'WINDOW_REQUIRED',
	'PAGE_TRUNCATED'
] as const;
type LeavePreviewIssueCode = (typeof leavePreviewIssueCodes)[number];

type LeavePreviewIssue = {
	readonly code: LeavePreviewIssueCode;
	readonly message: string;
};

const leaveDayReasonCodes = [
	'HOLIDAY',
	'REST_OR_OFF',
	'OTHER_LEAVE',
	'PAID_PAYROLL',
	'NO_SCHEDULE',
	'BEFORE_HIRE',
	'AFTER_EXIT',
	'MISSING_ROSTER_CODE'
] as const;
type LeaveDayReasonCode = (typeof leaveDayReasonCodes)[number];

export type LeaveDayPreview = {
	readonly eligible: boolean;
	readonly reason_code?: LeaveDayReasonCode;
	readonly reason_mark?: string;
	readonly settled_period?: string;
	readonly shift_label?: string;
	readonly first_half_label?: string;
	readonly second_half_label?: string;
};

export type LeavePreview = {
	readonly remaining_days: number | null;
	readonly chargeable_days: number | null;
	readonly encashed: boolean;
	readonly availability: Readonly<Record<string, LeaveDayPreview>>;
	readonly issues: readonly LeavePreviewIssue[];
};

type EmploymentTermRow = Pick<
	WorkspaceRow<'employment_terms'>,
	'employment_id' | 'work_pattern' | 'effective_range'
>;
type WorkDayRow = Pick<
	WorkspaceRow<'work_days'>,
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

type QueryRows<N extends keyof WorkspaceSchema['tables'] & string, Row> = {
	findMany(options: SchemaQueryConfig<WorkspaceSchema, N>): Effect.Effect<Row[], never, never>;
};

type QueryFirst<N extends keyof WorkspaceSchema['tables'] & string> = {
	findFirst(
		options: SchemaQueryConfig<WorkspaceSchema, N>
	): Effect.Effect<WorkspaceRow<N> | undefined, never, never>;
};

/**
 * The database surface preview and the write hook both read. The live api satisfies it; tests
 * satisfy it with an in-memory stub.
 */
export type LeavePreviewApi = {
	db: {
		jurisdictions: QueryFirst<'jurisdictions'> & {
			findMany(
				options: SchemaQueryConfig<WorkspaceSchema, 'jurisdictions'>
			): Effect.Effect<Jurisdiction[], never, never>;
		};
		employee_children: QueryRows<'employee_children', ChildFact>;
		employments: QueryFirst<'employments'>;
		companies: QueryFirst<'companies'>;
		leave_types: QueryFirst<'leave_types'>;
		company_holidays: QueryRows<'company_holidays', CompanyHolidayRow>;
		employment_terms: QueryRows<'employment_terms', EmploymentTermRow>;
		work_days: QueryRows<'work_days', WorkDayRow>;
		leave_requests: QueryRows<'leave_requests', RequestRow>;
		payroll_runs: QueryRows<'payroll_runs', SettledRunRow>;
		shift_definitions: QueryRows<'shift_definitions', RosterCodeRow>;
	};
};

type LeavePreviewFacts = {
	readonly employment: {
		readonly id: string;
		readonly company_id: string;
		readonly hire_date: string;
		readonly exit_date: string | null;
	};
	readonly company: {
		readonly jurisdiction_id: string;
		readonly leave_year_start_month: number;
	};
	readonly leaveType: LeaveType;
	readonly holidays: readonly CompanyHolidayRow[];
	readonly terms: readonly EmploymentTermRow[];
	readonly workDays: readonly WorkDayRow[];
	readonly overlappingTimeOff: readonly RequestRow[];
	readonly ledger: readonly RequestRow[];
	readonly encashed: boolean;
	readonly settledRuns: readonly SettledRunRow[];
	readonly rosterCodes: readonly RosterCodeRow[];
	readonly jurisdictionCode: string;
	readonly sealedProfiles: readonly Jurisdiction[];
	readonly children: readonly ChildFact[];
};

function issue(code: LeavePreviewIssueCode, message: string): LeavePreviewIssue {
	return { code, message };
}

function requireCompletePage(rows: readonly unknown[], label: string): LeavePreviewIssue | null {
	if (rows.length < LEAVE_PREVIEW_QUERY_LIMIT) return null;
	return issue(
		'PAGE_TRUNCATED',
		`The ${label} read reached its ${LEAVE_PREVIEW_QUERY_LIMIT.toLocaleString()}-row safety ceiling, so the leave preview cannot be trusted.`
	);
}

function previewWindow(
	input: PreviewLeaveInput
): { readonly start: string; readonly end: string } | null {
	const grid = input.calendar_month == null ? null : leaveCalendarGridBounds(input.calendar_month);
	const range = input.range;
	if (grid == null && range == null) return null;
	if (grid == null && range != null) {
		return { start: range.start.date, end: range.end.date };
	}
	if (grid != null && range == null) return grid;
	if (grid == null || range == null) return null;
	return {
		start: range.start.date < grid.start ? range.start.date : grid.start,
		end: range.end.date > grid.end ? range.end.date : grid.end
	};
}

function asOfDate(input: PreviewLeaveInput, window: { start: string; end: string }): string {
	return input.range?.end.date ?? window.end;
}

function timeOffRangeOf(event: RequestRow['event']): HalfDayRange | null {
	if (event == null || event.kind !== 'TIME_OFF') return null;
	const range = event.range;
	if (
		range == null ||
		typeof range.start?.date !== 'string' ||
		typeof range.end?.date !== 'string'
	) {
		return null;
	}
	return range;
}

function workEligible(
	date: string,
	facts: LeavePreviewFacts,
	rosterCodeById: ReadonlyMap<string, RosterCodeRow>,
	plannedByDate: ReadonlyMap<string, WorkDayRow>,
	holidayDates: ReadonlySet<string>
): {
	readonly work: boolean;
	readonly issue: LeavePreviewIssue | null;
	readonly codeId: string | null;
} {
	if (holidayDates.has(date)) {
		return { work: false, issue: null, codeId: null };
	}
	const term = facts.terms.find((candidate) => coversDate(candidate.effective_range, date));
	if (term == null) {
		return {
			work: false,
			issue: issue('NO_TERMS', `No employment terms cover ${date}, so leave cannot be measured.`),
			codeId: null
		};
	}
	let rosterCodeId = plannedByDate.get(date)?.shift_definition_id ?? null;
	if (rosterCodeId == null) {
		try {
			rosterCodeId = patternRosterCodeId(term.work_pattern, date);
		} catch {
			rosterCodeId = null;
		}
	}
	if (rosterCodeId == null) {
		return { work: term.work_pattern?.type === 'ROSTERED', issue: null, codeId: null };
	}
	const code = rosterCodeById.get(rosterCodeId);
	if (code == null) {
		return {
			work: false,
			issue: issue(
				'MISSING_ROSTER_CODE',
				`The schedule on ${date} names a roster code that no longer exists.`
			),
			codeId: rosterCodeId
		};
	}
	return { work: rosterCodeKind(code.variant) === 'WORK', issue: null, codeId: rosterCodeId };
}

function dayPreview(
	date: string,
	facts: LeavePreviewFacts,
	input: PreviewLeaveInput,
	rosterCodeById: ReadonlyMap<string, RosterCodeRow>,
	plannedByDate: ReadonlyMap<string, WorkDayRow>,
	holidayDates: ReadonlySet<string>,
	settledWindows: ReturnType<typeof payrollWindows>,
	hireDate: string,
	exitDate: string | null
): { readonly day: LeaveDayPreview; readonly issue: LeavePreviewIssue | null } {
	if (date < hireDate) {
		return {
			day: { eligible: false, reason_code: 'BEFORE_HIRE', reason_mark: '—' },
			issue: null
		};
	}
	if (exitDate != null && date > exitDate) {
		return {
			day: { eligible: false, reason_code: 'AFTER_EXIT', reason_mark: '—' },
			issue: null
		};
	}
	const settled = lockStateForDate(settledWindows, date);
	if (settled.kind === 'SETTLED') {
		return {
			day: {
				eligible: false,
				reason_code: 'PAID_PAYROLL',
				reason_mark: '🔒',
				settled_period: settled.period
			},
			issue: null
		};
	}
	if (holidayDates.has(date)) {
		return {
			day: { eligible: false, reason_code: 'HOLIDAY', reason_mark: 'H' },
			issue: null
		};
	}
	const coveredByOtherRequest = facts.overlappingTimeOff.some((row) => {
		if (row.id === input.exclude_request_id) return false;
		if (row.kind !== 'TIME_OFF' || row.from_date == null || row.to_date == null) return false;
		const from = dateKey(row.from_date);
		const to = dateKey(row.to_date);
		return date >= from && date <= to;
	});
	if (coveredByOtherRequest) {
		return {
			day: { eligible: false, reason_code: 'OTHER_LEAVE', reason_mark: 'L' },
			issue: null
		};
	}
	const eligibility = workEligible(date, facts, rosterCodeById, plannedByDate, holidayDates);
	if (eligibility.issue != null && eligibility.issue.code === 'MISSING_ROSTER_CODE') {
		return {
			day: { eligible: false, reason_code: 'MISSING_ROSTER_CODE', reason_mark: '?' },
			issue: eligibility.issue
		};
	}
	if (eligibility.issue != null && eligibility.issue.code === 'NO_TERMS') {
		return {
			day: { eligible: false, reason_code: 'NO_SCHEDULE' },
			issue: eligibility.issue
		};
	}
	if (!eligibility.work) {
		const term = facts.terms.find((candidate) => coversDate(candidate.effective_range, date));
		return {
			day: {
				eligible: false,
				reason_code: term == null ? 'NO_SCHEDULE' : 'REST_OR_OFF',
				reason_mark: term == null ? undefined : term.work_pattern?.type === 'ROSTERED' ? 'O' : 'R'
			},
			issue: null
		};
	}
	const code = eligibility.codeId == null ? null : (rosterCodeById.get(eligibility.codeId) ?? null);
	const halves = code == null ? null : workWindowHalves(code.variant);
	return {
		day: {
			eligible: true,
			shift_label: halves?.span,
			first_half_label: halves?.first,
			second_half_label: halves?.second
		},
		issue: null
	};
}

function projectedLedger(facts: LeavePreviewFacts, excludeId: string | undefined): LedgerRow[] {
	return facts.ledger.flatMap((row) => {
		if (row.id === excludeId || row.from_date == null) return [];
		return [
			{
				id: row.id,
				leave_type_id: row.leave_type_id,
				entry_date: dateKey(row.from_date),
				kind: row.kind,
				days: row.kind === 'TIME_OFF' ? -Math.abs(decodeNumber(row.days)) : decodeNumber(row.days),
				source_id: null,
				approval_id: row.approval_id
			}
		];
	});
}

/**
 * Pure evaluation over already-loaded person-scoped rows. The hook and the remote share this so a
 * preview the operator reads cannot disagree with the write that later refuses or accepts.
 */
export function evaluateLeavePreview(
	facts: LeavePreviewFacts,
	input: PreviewLeaveInput
): LeavePreview {
	const issues: LeavePreviewIssue[] = [];
	const window = previewWindow(input);
	if (window == null) {
		return {
			remaining_days: null,
			chargeable_days: null,
			encashed: facts.encashed,
			availability: {},
			issues: [
				issue(
					'WINDOW_REQUIRED',
					'A leave preview needs a calendar month or a half-day range so it knows which days to measure.'
				)
			]
		};
	}

	const hireDate = dateKey(facts.employment.hire_date);
	const exitDate = facts.employment.exit_date == null ? null : dateKey(facts.employment.exit_date);
	const range = input.range;
	if (range != null && pointNumber(range.end) < pointNumber(range.start)) {
		issues.push(
			issue(
				'RANGE_INVERTED',
				'Leave must end after it starts. Select one continuous range on the calendar.'
			)
		);
	}
	if (range != null && range.start.date < hireDate) {
		issues.push(issue('BEFORE_HIRE', 'Leave cannot start before the employment hire date.'));
	}
	if (range != null && exitDate != null && range.end.date > exitDate) {
		issues.push(issue('AFTER_EXIT', 'Leave cannot end after the employment exit date.'));
	}

	if (facts.encashed) {
		issues.push(
			issue(
				'ENCASHED',
				`${facts.leaveType.code} was encashed on exit for this employment, so no further leave can be taken against it.`
			)
		);
	}

	if (range != null && pointNumber(range.end) >= pointNumber(range.start)) {
		for (const request of facts.overlappingTimeOff) {
			if (request.id === input.exclude_request_id) continue;
			const other = timeOffRangeOf(request.event);
			if (other == null) continue;
			if (
				pointNumber(other.start) <= pointNumber(range.end) &&
				pointNumber(other.end) >= pointNumber(range.start)
			) {
				issues.push(
					issue(
						'OVERLAP',
						`The selected half-day range overlaps another leave request beginning ${other.start.date}.`
					)
				);
				break;
			}
		}
	}

	const rosterCodeById = new Map(facts.rosterCodes.map((code) => [code.id, code]));
	const plannedByDate = new Map(
		facts.workDays.map((day) => [dateKey(day.work_date), day] as const)
	);
	const holidayDates = new Set(facts.holidays.map((holiday) => dateKey(holiday.date)));
	const settledWindows = payrollWindows(facts.settledRuns);

	if (range != null && pointNumber(range.end) >= pointNumber(range.start)) {
		for (let number = pointNumber(range.start); number <= pointNumber(range.end); number += 1) {
			const date = pointAt(number).date;
			const lock = lockStateForDate(settledWindows, date);
			if (lock.kind === 'SETTLED') {
				issues.push(
					issue(
						'SETTLED_WINDOW',
						`Changing a leave request on ${date} is refused: that day is inside paid payroll ${lock.period}. ` +
							'Correct it with an adjustment entry in a later draft run.'
					)
				);
				break;
			}
		}
	}

	const availability: Record<string, LeaveDayPreview> = {};
	for (const date of calendarDaysThrough(window.start, window.end)) {
		const { day, issue: dayIssue } = dayPreview(
			date,
			facts,
			input,
			rosterCodeById,
			plannedByDate,
			holidayDates,
			settledWindows,
			hireDate,
			exitDate
		);
		availability[date] = day;
		if (dayIssue != null && !issues.some((existing) => existing.code === dayIssue.code)) {
			issues.push(dayIssue);
		}
	}

	let chargeable_days: number | null = null;
	if (range != null && pointNumber(range.end) >= pointNumber(range.start)) {
		let chargedHalfDays = 0;
		for (let number = pointNumber(range.start); number <= pointNumber(range.end); number += 1) {
			const date = pointAt(number).date;
			const eligibility = workEligible(date, facts, rosterCodeById, plannedByDate, holidayDates);
			if (eligibility.work) chargedHalfDays += 1;
		}
		chargeable_days = chargedHalfDays / 2;
		if (chargedHalfDays === 0) {
			issues.push(
				issue(
					'NO_CHARGEABLE_DAYS',
					'The selected range contains no scheduled work half-days after holidays and rest/off days are excluded.'
				)
			);
		}
	}

	let remaining_days: number | null = null;
	if (facts.leaveType.accrual?.kind !== 'PER_EVENT') {
		const asOf = asOfDate(input, window);
		if (facts.jurisdictionCode.length === 0) {
			issues.push(
				issue(
					'MISSING_JURISDICTION',
					'The company states no jurisdiction anchor, so the statutory floor cannot resolve.'
				)
			);
		} else {
			try {
				// Same pick as the employee panel: the profile covering the as-of date, not each
				// historical month. Carry-forward walks back to hire; a 2026-only seal must still
				// resolve a 2019 start.
				const profile = sealedProfileCovering(facts.sealedProfiles, facts.jurisdictionCode, asOf);
				if (profile == null) {
					throw new Error(
						`No sealed statutory profile covers ${asOf}, so the statutory leave floor ` +
							'cannot resolve. Seal a version of the law family first.'
					);
				}
				const entitlementAt = (serviceMonths: number, entitlementAsOf: string) =>
					resolveEntitlement({
						leaveType: facts.leaveType,
						profile,
						children: facts.children,
						serviceMonths,
						employmentId: facts.employment.id,
						asOf: entitlementAsOf
					});
				remaining_days = leaveBalance(
					{
						leaveType: facts.leaveType,
						entitlementAt,
						hireDate,
						exitDate,
						leaveYearStartMonth: facts.company.leave_year_start_month,
						ledger: projectedLedger(facts, input.exclude_request_id),
						basis: 'PROJECTED'
					},
					asOf
				);
				if (chargeable_days != null && chargeable_days > remaining_days + 1e-9 && !facts.encashed) {
					issues.push(
						issue(
							'OVERDRAW',
							`This range charges ${chargeable_days} day(s), but only ${Math.max(0, remaining_days)} day(s) are available.`
						)
					);
				}
			} catch (error) {
				issues.push(
					issue(
						'MISSING_PROFILE',
						error instanceof Error
							? error.message
							: `No sealed statutory profile covers ${asOf}, so the statutory leave floor cannot resolve.`
					)
				);
			}
		}
	}

	return {
		remaining_days,
		chargeable_days,
		encashed: facts.encashed,
		availability,
		issues
	};
}

function loadLeavePreviewFacts(
	api: LeavePreviewApi,
	input: PreviewLeaveInput
): Effect.Effect<LeavePreviewFacts> {
	return Effect.gen(function* () {
		const window = previewWindow(input);
		if (window == null) {
			refuse(
				'A leave preview needs a calendar month or a half-day range so it knows which days to measure.'
			);
		}

		const employment = yield* api.db.employments.findFirst({
			where: { id: { eq: input.employment_id } }
		});
		if (employment == null) refuse('The leave request must reference an employment on file.');

		const [company, leaveType, holidays, terms, workDays, overlappingTimeOff] = yield* Effect.all(
			[
				api.db.companies.findFirst({
					where: { id: { eq: employment.company_id } }
				}),
				api.db.leave_types.findFirst({
					where: { id: { eq: input.leave_type_id }, company_id: { eq: employment.company_id } }
				}),
				api.db.company_holidays.findMany({
					where: {
						company_id: { eq: employment.company_id },
						date: { gte: window.start, lte: window.end }
					},
					limit: LEAVE_PREVIEW_QUERY_LIMIT
				}),
				api.db.employment_terms.findMany({
					where: { employment_id: { eq: input.employment_id } },
					limit: LEAVE_PREVIEW_QUERY_LIMIT
				}),
				api.db.work_days.findMany({
					where: {
						employment_id: { eq: input.employment_id },
						work_date: { gte: window.start, lte: window.end }
					},
					limit: LEAVE_PREVIEW_QUERY_LIMIT
				}),
				api.db.leave_requests.findMany({
					where: {
						employment_id: { eq: input.employment_id },
						kind: { eq: 'TIME_OFF' },
						from_date: { lte: window.end },
						to_date: { gte: window.start }
					},
					limit: LEAVE_PREVIEW_QUERY_LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		if (company == null) refuse('The employing entity no longer exists.');
		if (leaveType == null) refuse('That leave type does not belong to the employing entity.');

		const truncated = [
			requireCompletePage(holidays, 'company-holiday'),
			requireCompletePage(terms, 'employment-term'),
			requireCompletePage(workDays, 'work-day'),
			requireCompletePage(overlappingTimeOff, 'overlapping leave request')
		].find((candidate) => candidate != null);
		if (truncated != null) refuse(truncated.message);

		const settledRuns = yield* api.db.payroll_runs
			.findMany({
				where: { company_id: { eq: employment.company_id }, lifecycle: { eq: 'PAID' } },
				columns: { period: true, lifecycle: true, attendance_from: true, attendance_to: true },
				limit: LEAVE_PREVIEW_QUERY_LIMIT
			})
			.pipe(Effect.orElseSucceed(() => []));

		const encashedRows = yield* api.db.leave_requests.findMany({
			where: {
				employment_id: { eq: input.employment_id },
				leave_type_id: { eq: input.leave_type_id },
				kind: { eq: 'ENCASHMENT' },
				approval_id: { isNull: true }
			},
			columns: { id: true },
			limit: 100
		});

		const shiftIds = [
			...new Set([
				...workDays.flatMap((day) =>
					day.shift_definition_id == null ? [] : [day.shift_definition_id]
				),
				...terms.flatMap((term) => {
					const pattern = term.work_pattern;
					if (pattern?.type !== 'PATTERNED') return [];
					return pattern.phases.flatMap((phase) =>
						phase.day_cycle.map((day) => day.roster_code_id)
					);
				})
			])
		];
		const rosterCodes =
			shiftIds.length === 0
				? []
				: yield* api.db.shift_definitions.findMany({
						where: { id: { in: shiftIds } },
						limit: LEAVE_PREVIEW_QUERY_LIMIT
					});
		if (shiftIds.length > 0) {
			const rosterTruncated = requireCompletePage(rosterCodes, 'roster-code');
			if (rosterTruncated != null) refuse(rosterTruncated.message);
		}

		const anchor = yield* api.db.jurisdictions.findFirst({
			where: { id: { eq: company.jurisdiction_id } },
			columns: { code: true }
		});
		const profileRows =
			anchor == null
				? []
				: yield* api.db.jurisdictions.findMany({
						where: { code: { eq: anchor.code }, lifecycle: { eq: 'SEALED' } },
						limit: LEAVE_PREVIEW_QUERY_LIMIT
					});
		const childFacts = yield* api.db.employee_children.findMany({
			where: { employment_id: { eq: input.employment_id } },
			limit: LEAVE_PREVIEW_QUERY_LIMIT
		});
		const allLedger = yield* api.db.leave_requests.findMany({
			where: {
				employment_id: { eq: input.employment_id },
				leave_type_id: { eq: input.leave_type_id }
			},
			limit: LEAVE_PREVIEW_QUERY_LIMIT
		});
		const ledgerTruncated = requireCompletePage(allLedger, 'leave ledger');
		if (ledgerTruncated != null) refuse(ledgerTruncated.message);

		return {
			employment: {
				id: employment.id,
				company_id: employment.company_id,
				hire_date: dateKey(employment.hire_date),
				exit_date: employment.exit_date == null ? null : dateKey(employment.exit_date)
			},
			company: {
				jurisdiction_id: company.jurisdiction_id,
				leave_year_start_month: decodeNumber(company.leave_year_start_month)
			},
			leaveType,
			holidays,
			terms,
			workDays,
			overlappingTimeOff,
			ledger: allLedger,
			encashed: encashedRows.length > 0,
			settledRuns,
			rosterCodes,
			jurisdictionCode: anchor?.code ?? '',
			sealedProfiles: profileRows,
			children: childFacts
		};
	});
}

export function previewLeave(
	api: LeavePreviewApi,
	input: PreviewLeaveInput
): Effect.Effect<LeavePreview> {
	return Effect.gen(function* () {
		const facts = yield* loadLeavePreviewFacts(api, input);
		return evaluateLeavePreview(facts, input);
	});
}

/** The first blocking sentence the write hook should refuse, or null when the preview is applyable. */
export function firstLeavePreviewRefusal(preview: LeavePreview): string | null {
	return preview.issues[0]?.message ?? null;
}

/** The calendar window this input will gather — month grid, selected range, or their union. */
export function previewWindowOf(input: PreviewLeaveInput): { start: string; end: string } | null {
	return previewWindow(input);
}
