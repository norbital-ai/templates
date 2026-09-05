import { Effect, Schema } from 'effect';
import { refuse, type Api, type SchemaQueryConfig } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types.js';
import type { WorkspaceRow } from '../../collections/leave_requests/$types.js';
import { calendarDay, dateKey } from '../iso-day.js';
import { pointAt, pointNumber, type HalfDayRange } from '../half-day.js';
import { coversDate } from '../../collections/payroll_runs/lib/effective.js';
import { patternRosterCodeId } from '../scheduling/work-pattern.js';
import { rosterCodeKind, workWindowHalves } from '../scheduling/roster-code.js';
import { lockStateForDate, payrollWindows } from '../scheduling/lock.js';
import { calendarDaysThrough, leaveCalendarGridBounds } from './calendar-grid.js';
import { withPendingLeaveRequests, type LeaveBalanceRequest } from './pending.js';
import { isEligible } from '../../collections/payroll_runs/lib/eligibility.js';
import { completedMonths } from '../../collections/payroll_runs/lib/dates.js';
import { decodeNumber } from '@norbital-ai/std/json';

const LIMIT = 2_000;
const payrollDayFormatter = new Intl.DateTimeFormat('en', {
	timeZone: 'Asia/Kuala_Lumpur',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

function payrollDayKey(value: string): string {
	if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
	const at = new Date(value);
	if (Number.isNaN(at.getTime())) return value.slice(0, 10);
	const parts = payrollDayFormatter.formatToParts(at);
	const part = (type: string) => parts.find((candidate) => candidate.type === type)?.value ?? '';
	return `${part('year')}-${part('month')}-${part('day')}`;
}

const dayHalfSchema = Schema.Literals(['FIRST', 'SECOND']);
const leavePreviewRangeSchema = Schema.Struct({
	start: Schema.Struct({ date: calendarDay, half: dayHalfSchema }),
	end: Schema.Struct({ date: calendarDay, half: dayHalfSchema })
});

export const previewLeaveInputSchema = Schema.Struct({
	employment_id: Schema.String.check(Schema.isUUID()),
	leave_type_id: Schema.String.check(Schema.isUUID()),
	leave_account_id: Schema.optionalKey(Schema.String.check(Schema.isUUID())),
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
	'WINDOW_REQUIRED',
	'PAGE_TRUNCATED',
	'ACCOUNT_REQUIRED',
	'LEAVE_NOT_AVAILABLE',
	'INELIGIBLE'
] as const;
type LeavePreviewIssueCode = (typeof leavePreviewIssueCodes)[number];

type LeavePreviewIssue = {
	readonly code: LeavePreviewIssueCode;
	readonly message: string;
};

const leaveDayReasonCodes = [
	'INELIGIBLE',
	'LEAVE_NOT_AVAILABLE',
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
	readonly certificate_required?: boolean;
	readonly remaining_days: number | null;
	readonly chargeable_days: number | null;
	readonly encashed: boolean;
	readonly carry_note: null;
	readonly availability: Readonly<Record<string, LeaveDayPreview>>;
	readonly issues: readonly LeavePreviewIssue[];
};

type EmploymentTermRow = Pick<
	WorkspaceRow<'employment_terms'>,
	| 'employment_id'
	| 'work_pattern'
	| 'effective_range'
	| 'employment_type'
	| 'work_classification'
	| 'department'
	| 'payroll_group'
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
type AccountRow = WorkspaceRow<'leave_accounts'>;
type EntryRow = WorkspaceRow<'leave_entries'>;

type QueryRows<N extends keyof WorkspaceSchema['tables'] & string, Row> = {
	findMany(options: SchemaQueryConfig<WorkspaceSchema, N>): Effect.Effect<Row[], never, never>;
};
type QueryFirst<N extends keyof WorkspaceSchema['tables'] & string> = {
	findFirst(
		options: SchemaQueryConfig<WorkspaceSchema, N>
	): Effect.Effect<WorkspaceRow<N> | undefined, never, never>;
};

type LeavePreviewApi = {
	db: {
		employments: QueryFirst<'employments'>;
		employees: QueryFirst<'employees'>;
		companies: QueryFirst<'companies'>;
		leave_types: QueryFirst<'leave_types'>;
		leave_plans: QueryFirst<'leave_plans'>;
		leave_accounts: QueryRows<'leave_accounts', AccountRow>;
		leave_entries: QueryRows<'leave_entries', EntryRow>;
		company_holidays: QueryRows<'company_holidays', CompanyHolidayRow>;
		employment_terms: QueryRows<'employment_terms', EmploymentTermRow>;
		work_days: QueryRows<'work_days', WorkDayRow>;
		leave_requests: QueryRows<'leave_requests', LeaveBalanceRequest> &
			Pick<Api<WorkspaceSchema>['db']['leave_requests'], 'findPending'>;
		payroll_runs: QueryRows<'payroll_runs', SettledRunRow>;
		shift_definitions: QueryRows<'shift_definitions', RosterCodeRow>;
	};
};

type LeavePreviewFacts = {
	readonly gender: WorkspaceRow<'employees'>['gender'];
	readonly employment: WorkspaceRow<'employments'>;
	readonly leaveType: WorkspaceRow<'leave_types'>;
	readonly planActive: boolean;
	readonly account: AccountRow | null;
	readonly entries: readonly EntryRow[];
	readonly holidays: readonly CompanyHolidayRow[];
	readonly terms: readonly EmploymentTermRow[];
	readonly workDays: readonly WorkDayRow[];
	readonly requests: readonly LeaveBalanceRequest[];
	readonly settledRuns: readonly SettledRunRow[];
	readonly rosterCodes: readonly RosterCodeRow[];
};

function issue(code: LeavePreviewIssueCode, message: string): LeavePreviewIssue {
	return { code, message };
}

function requireComplete(rows: readonly unknown[], label: string): void {
	if (rows.length < LIMIT) return;
	refuse(
		`The ${label} read reached its ${LIMIT.toLocaleString()}-row safety ceiling, so the leave preview cannot be trusted.`
	);
}

function previewWindow(
	input: PreviewLeaveInput
): { readonly start: string; readonly end: string } | null {
	const grid = input.calendar_month == null ? null : leaveCalendarGridBounds(input.calendar_month);
	const range = input.range;
	if (grid == null && range == null) return null;
	if (grid == null && range != null) return { start: range.start.date, end: range.end.date };
	if (grid != null && range == null) return grid;
	if (grid == null || range == null) return null;
	return {
		start: range.start.date < grid.start ? range.start.date : grid.start,
		end: range.end.date > grid.end ? range.end.date : grid.end
	};
}

function timeOffRange(event: LeaveBalanceRequest['event']): HalfDayRange {
	return event.range;
}

function workEligible(
	date: string,
	facts: LeavePreviewFacts,
	rosterCodeById: ReadonlyMap<string, RosterCodeRow>,
	plannedByDate: ReadonlyMap<string, WorkDayRow>,
	holidayDates: ReadonlySet<string>
): { readonly work: boolean; readonly codeId: string | null; readonly issue?: LeavePreviewIssue } {
	if (holidayDates.has(date)) return { work: false, codeId: null };
	const term = facts.terms.find((candidate) => coversDate(candidate.effective_range, date));
	if (term == null)
		return {
			work: false,
			codeId: null,
			issue: issue('NO_TERMS', `No employment terms cover ${date}, so leave cannot be measured.`)
		};
	let codeId = plannedByDate.get(date)?.shift_definition_id ?? null;
	if (codeId == null) {
		try {
			codeId = patternRosterCodeId(term.work_pattern, date);
		} catch {
			codeId = null;
		}
	}
	if (codeId == null) return { work: term.work_pattern?.type === 'ROSTERED', codeId: null };
	const code = rosterCodeById.get(codeId);
	if (code == null)
		return {
			work: false,
			codeId,
			issue: issue('MISSING_ROSTER_CODE', `The schedule on ${date} names a missing roster code.`)
		};
	return { work: rosterCodeKind(code.variant) === 'WORK', codeId };
}

function accountCovers(account: AccountRow | null, date: string): boolean {
	return (
		account != null &&
		account.status === 'OPEN' &&
		date >= dateKey(account.starts_on) &&
		date <= dateKey(account.ends_on)
	);
}

function dayPreview(
	date: string,
	facts: LeavePreviewFacts,
	input: PreviewLeaveInput,
	rosterCodeById: ReadonlyMap<string, RosterCodeRow>,
	plannedByDate: ReadonlyMap<string, WorkDayRow>,
	holidayDates: ReadonlySet<string>,
	settledWindows: ReturnType<typeof payrollWindows>
): { readonly day: LeaveDayPreview; readonly issue?: LeavePreviewIssue } {
	const hire = dateKey(facts.employment.hire_date);
	const exit = facts.employment.exit_date == null ? null : dateKey(facts.employment.exit_date);
	if (!facts.planActive || !accountCovers(facts.account, date))
		return { day: { eligible: false, reason_code: 'LEAVE_NOT_AVAILABLE', reason_mark: '—' } };
	if (date < hire)
		return { day: { eligible: false, reason_code: 'BEFORE_HIRE', reason_mark: '—' } };
	if (exit != null && date > exit)
		return { day: { eligible: false, reason_code: 'AFTER_EXIT', reason_mark: '—' } };
	const settled = lockStateForDate(settledWindows, date);
	if (settled.kind === 'SETTLED')
		return {
			day: {
				eligible: false,
				reason_code: 'PAID_PAYROLL',
				reason_mark: '🔒',
				settled_period: settled.period
			},
			issue: issue('SETTLED_WINDOW', `The paid payroll period ${settled.period} is locked.`)
		};
	if (holidayDates.has(date))
		return { day: { eligible: false, reason_code: 'HOLIDAY', reason_mark: 'H' } };
	if (
		facts.requests.some(
			(row) =>
				row.id !== input.exclude_request_id &&
				date >= timeOffRange(row.event).start.date &&
				date <= timeOffRange(row.event).end.date
		)
	)
		return { day: { eligible: false, reason_code: 'OTHER_LEAVE', reason_mark: 'L' } };
	const work = workEligible(date, facts, rosterCodeById, plannedByDate, holidayDates);
	if (work.issue?.code === 'MISSING_ROSTER_CODE')
		return {
			day: { eligible: false, reason_code: 'MISSING_ROSTER_CODE', reason_mark: '?' },
			issue: work.issue
		};
	if (work.issue != null)
		return { day: { eligible: false, reason_code: 'NO_SCHEDULE' }, issue: work.issue };
	if (!work.work) return { day: { eligible: false, reason_code: 'REST_OR_OFF', reason_mark: 'R' } };
	const term = facts.terms.find((candidate) => coversDate(candidate.effective_range, date));
	if (
		!isEligible(facts.leaveType.eligibility, {
			employment_type: term?.employment_type ?? null,
			work_classification: term?.work_classification ?? null,
			department: term?.department ?? null,
			payroll_group: term?.payroll_group ?? null,
			gender: facts.gender ?? null,
			service_months: completedMonths(dateKey(facts.employment.hire_date), date)
		}) &&
		facts.account?.account_kind !== 'EVENT' &&
		decodeNumber(facts.account?.calculation?.statutory_days ?? 0) <= 0
	)
		return {
			day: { eligible: false, reason_code: 'INELIGIBLE', reason_mark: '—' },
			issue: issue(
				'INELIGIBLE',
				`This employee does not meet the eligibility rules for this leave type on ${date}.`
			)
		};
	const code = work.codeId == null ? null : (rosterCodeById.get(work.codeId) ?? null);
	const halves = code == null ? null : workWindowHalves(code.variant);
	return {
		day: {
			eligible: true,
			shift_label: halves?.span,
			first_half_label: halves?.first,
			second_half_label: halves?.second
		}
	};
}

function balanceAt(facts: LeavePreviewFacts, asOf: string, excludeRequestId?: string): number {
	const posted = facts.entries
		.filter((entry) => dateKey(entry.effective_on) <= asOf)
		.reduce((total, entry) => total + decodeNumber(entry.days), 0);
	const pending = facts.requests
		.filter(
			(row) =>
				row.id !== excludeRequestId &&
				row.approval_id != null &&
				row.leave_account_id === facts.account?.id
		)
		.reduce((total, row) => total + decodeNumber(row.days), 0);
	return posted - pending;
}

export function evaluateLeavePreview(
	facts: LeavePreviewFacts,
	input: PreviewLeaveInput
): LeavePreview {
	const window = previewWindow(input);
	if (window == null)
		return {
			remaining_days: null,
			chargeable_days: null,
			encashed: false,
			carry_note: null,
			availability: {},
			issues: [issue('WINDOW_REQUIRED', 'Choose a calendar month or leave range.')]
		};
	const issues: LeavePreviewIssue[] = [];
	const range = input.range;
	const hire = dateKey(facts.employment.hire_date);
	const exit = facts.employment.exit_date == null ? null : dateKey(facts.employment.exit_date);
	if (facts.account == null)
		issues.push(
			issue(
				'ACCOUNT_REQUIRED',
				'No generated leave account covers this request. The automatic reconciliation must create the entitlement before leave can be submitted.'
			)
		);
	if (!facts.planActive)
		issues.push(issue('LEAVE_NOT_AVAILABLE', 'This leave type is not in an approved active plan.'));
	if (range != null && pointNumber(range.end) < pointNumber(range.start))
		issues.push(issue('RANGE_INVERTED', 'Leave must end after it starts.'));
	if (range != null && range.start.date < hire)
		issues.push(issue('BEFORE_HIRE', 'Leave cannot start before the employment hire date.'));
	if (range != null && exit != null && range.end.date > exit)
		issues.push(issue('AFTER_EXIT', 'Leave cannot end after the employment exit date.'));
	if (range != null && facts.account != null && !accountCovers(facts.account, range.start.date))
		issues.push(
			issue('ACCOUNT_REQUIRED', 'The selected account does not cover the requested dates.')
		);
	if (range != null && facts.account != null && !accountCovers(facts.account, range.end.date))
		issues.push(issue('ACCOUNT_REQUIRED', 'One leave request cannot cross entitlement accounts.'));
	if (
		range != null &&
		facts.requests.some((request) => {
			if (request.id === input.exclude_request_id) return false;
			const other = timeOffRange(request.event);
			return (
				pointNumber(other.start) <= pointNumber(range.end) &&
				pointNumber(other.end) >= pointNumber(range.start)
			);
		})
	)
		issues.push(issue('OVERLAP', 'The selected half-day range overlaps another leave request.'));

	const rosterCodeById = new Map(facts.rosterCodes.map((row) => [row.id, row]));
	const plannedByDate = new Map(
		facts.workDays.map((row) => [payrollDayKey(row.work_date), row] as const)
	);
	const holidayDates = new Set(facts.holidays.map((row) => payrollDayKey(row.date)));
	const settledWindows = payrollWindows(facts.settledRuns);
	const availability: Record<string, LeaveDayPreview> = {};
	for (const date of calendarDaysThrough(window.start, window.end)) {
		const evaluated = dayPreview(
			date,
			facts,
			input,
			rosterCodeById,
			plannedByDate,
			holidayDates,
			settledWindows
		);
		availability[date] = evaluated.day;
		if (evaluated.issue != null && !issues.some((entry) => entry.code === evaluated.issue?.code))
			issues.push(evaluated.issue);
	}

	let chargeableDays: number | null = null;
	if (range != null && pointNumber(range.end) >= pointNumber(range.start)) {
		let halves = 0;
		for (let point = pointNumber(range.start); point <= pointNumber(range.end); point += 1) {
			const date = pointAt(point).date;
			if (availability[date]?.eligible === true) halves += 1;
		}
		chargeableDays = halves / 2;
		if (halves === 0)
			issues.push(
				issue('NO_CHARGEABLE_DAYS', 'The range contains no eligible scheduled work time.')
			);
	}
	const asOf = range?.end.date ?? window.end;
	const remaining = facts.account == null ? 0 : balanceAt(facts, asOf, input.exclude_request_id);
	if (
		facts.account?.accrual_kind !== 'UNLIMITED' &&
		chargeableDays != null &&
		chargeableDays > remaining + 1e-9
	)
		issues.push(
			issue(
				'OVERDRAW',
				`This range charges ${chargeableDays} day(s), but only ${Math.max(0, remaining)} day(s) are available.`
			)
		);
	const encashed = facts.entries.some((entry) => entry.kind === 'ENCASHED');
	if (encashed) issues.push(issue('ENCASHED', 'This account was encashed and is closed.'));
	return {
		remaining_days: remaining,
		chargeable_days: chargeableDays,
		certificate_required:
			chargeableDays != null &&
			facts.leaveType.requires_certificate_after_days != null &&
			chargeableDays > facts.leaveType.requires_certificate_after_days,
		encashed,
		carry_note: null,
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
		if (window == null) refuse('Choose a calendar month or leave range.');
		const employment = yield* api.db.employments.findFirst({
			where: { id: { eq: input.employment_id }, approval_id: { isNull: true } }
		});
		if (employment == null) refuse('The leave request must reference an approved employment.');
		const leaveType = yield* api.db.leave_types.findFirst({
			where: { id: { eq: input.leave_type_id }, company_id: { eq: employment.company_id } }
		});
		if (leaveType == null) refuse('That leave type does not belong to the employing entity.');
		const plan = yield* api.db.leave_plans.findFirst({
			where: { id: { eq: leaveType.leave_plan_id }, approval_id: { isNull: true } }
		});
		const asOf = input.range?.end.date ?? window.end;
		const accountRows = yield* api.db.leave_accounts.findMany({
			where: {
				employment_id: { eq: input.employment_id },
				leave_type_id: { eq: leaveType.id },
				approval_id: { isNull: true }
			},
			limit: LIMIT
		});
		requireComplete(accountRows, 'leave account');
		const account =
			accountRows.find((row) => row.id === input.leave_account_id) ??
			accountRows.find((row) => accountCovers(row, asOf)) ??
			null;
		if (input.leave_account_id != null && account?.id !== input.leave_account_id)
			refuse('The selected leave account does not belong to this employment and leave type.');

		const [person, holidays, terms, workDays, storedRequests, settledRuns, entries] =
			yield* Effect.all(
				[
					api.db.employees.findFirst({
						where: { id: { eq: employment.employee_id } },
						columns: { gender: true }
					}),
					api.db.company_holidays.findMany({
						where: {
							company_id: { eq: employment.company_id },
							date: { gte: window.start, lte: window.end }
						},
						limit: LIMIT
					}),
					api.db.employment_terms.findMany({
						where: { employment_id: { eq: input.employment_id } },
						limit: LIMIT
					}),
					api.db.work_days.findMany({
						where: {
							employment_id: { eq: input.employment_id },
							work_date: { gte: window.start, lte: window.end }
						},
						limit: LIMIT
					}),
					api.db.leave_requests.findMany({
						where: { employment_id: { eq: input.employment_id } },
						limit: LIMIT
					}),
					api.db.payroll_runs.findMany({
						where: { company_id: { eq: employment.company_id }, lifecycle: { eq: 'PAID' } },
						columns: { period: true, lifecycle: true, attendance_from: true, attendance_to: true },
						limit: LIMIT
					}),
					account == null
						? Effect.succeed([])
						: api.db.leave_entries.findMany({
								where: { leave_account_id: { eq: account.id }, approval_id: { isNull: true } },
								limit: LIMIT
							})
				],
				{ concurrency: 'unbounded' }
			);
		for (const [rows, label] of [
			[holidays, 'company holiday'],
			[terms, 'employment term'],
			[workDays, 'work day'],
			[storedRequests, 'leave request'],
			[settledRuns, 'paid payroll'],
			[entries, 'leave entry']
		] as const)
			requireComplete(rows, label);
		const requests = yield* withPendingLeaveRequests(
			api,
			input.employment_id,
			storedRequests,
			input.exclude_request_id
		);
		const shiftIds = [
			...new Set([
				...workDays.flatMap((day) =>
					day.shift_definition_id == null ? [] : [day.shift_definition_id]
				),
				...terms.flatMap((term) =>
					term.work_pattern?.type === 'PATTERNED'
						? term.work_pattern.phases.flatMap((phase) =>
								phase.day_cycle.map((day) => day.roster_code_id)
							)
						: []
				)
			])
		];
		const rosterCodes =
			shiftIds.length === 0
				? []
				: yield* api.db.shift_definitions.findMany({
						where: { id: { in: shiftIds } },
						limit: LIMIT
					});
		requireComplete(rosterCodes, 'roster code');
		return {
			gender: person?.gender ?? null,
			employment,
			leaveType,
			planActive: plan != null && account?.opening_plan_id === plan.id,
			account,
			entries,
			holidays,
			terms,
			workDays,
			requests,
			settledRuns,
			rosterCodes
		};
	});
}

export function previewLeave(
	api: LeavePreviewApi,
	input: PreviewLeaveInput
): Effect.Effect<LeavePreview> {
	return Effect.map(loadLeavePreviewFacts(api, input), (facts) =>
		evaluateLeavePreview(facts, input)
	);
}

export function firstLeavePreviewRefusal(preview: LeavePreview): string | null {
	return preview.issues[0]?.message ?? null;
}

export function previewWindowOf(input: PreviewLeaveInput): { start: string; end: string } | null {
	return previewWindow(input);
}
