import { Effect, Schema } from 'effect';
import { refuse, type Api, type SchemaQueryConfig } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types.js';
import type { WorkspaceRow } from '../../collections/leave_requests/$types.js';
import { calendarDay, dateKey } from '../iso-day.js';
import { settingsInForce } from '../jurisdiction_settings.js';
import { pointAt, pointNumber, type HalfDayRange } from '../half-day.js';
import { coversDate } from '../../collections/payroll_runs/lib/effective.js';
import {
	patternRosterCodeId,
	patternRosterCodeIds,
	termPattern
} from '../scheduling/work-pattern.js';
import { rosterCodeKind, workWindowHalves } from '../scheduling/roster-code.js';
import { lockStateForDate, payrollWindows } from '../scheduling/lock.js';
import { calendarDaysThrough, leaveCalendarGridBounds } from './calendar-grid.js';
import { withPendingLeaveRequests, type LeaveBalanceRequest } from './pending.js';
import { isEligible, personContext } from '../../collections/payroll_runs/lib/eligibility.js';
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
	leave_entitlement_id: Schema.optionalKey(Schema.String.check(Schema.isUUID())),
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
	'ENTITLEMENT_REQUIRED',
	'INELIGIBLE'
] as const;
type LeavePreviewIssueCode = (typeof leavePreviewIssueCodes)[number];

type LeavePreviewIssue = {
	readonly code: LeavePreviewIssueCode;
	readonly message: string;
};

const leaveDayReasonCodes = [
	'INELIGIBLE',
	'ENTITLEMENT_REQUIRED',
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
	| 'shift_pattern_id'
	| 'effective_range'
	| 'employment_type'
	| 'work_classification'
	| 'base_salary'
	| 'statutory_work_category'
	| 'department'
	| 'payroll_group'
>;
type WorkDayRow = Pick<
	WorkspaceRow<'work_days'>,
	'employment_id' | 'work_date' | 'shift_definition_id'
>;
type CompanyHolidayRow = Pick<WorkspaceRow<'company_holidays'>, 'settings_id' | 'date'>;
type SettingsVersionRow = Pick<
	WorkspaceRow<'jurisdiction_settings'>,
	'id' | 'code' | 'name' | 'sealed_at' | 'voided_at' | 'effective_range' | 'approval_id'
>;
type RosterCodeRow = Pick<WorkspaceRow<'shift_definitions'>, 'id' | 'variant'>;
type ShiftPatternRow = Pick<WorkspaceRow<'shift_patterns'>, 'id' | 'code' | 'pattern'>;
type SettledRunRow = Pick<
	WorkspaceRow<'payroll_runs'>,
	'period' | 'lifecycle' | 'attendance_from' | 'attendance_to'
>;
type EntitlementRow = WorkspaceRow<'leave_entitlements'>;
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
		jurisdiction_settings: QueryRows<'jurisdiction_settings', SettingsVersionRow>;
		leave_types: QueryFirst<'leave_types'>;
		leave_entitlements: QueryRows<'leave_entitlements', EntitlementRow>;
		employee_children: QueryRows<'employee_children', WorkspaceRow<'employee_children'>>;
		leave_entries: QueryRows<'leave_entries', EntryRow>;
		company_holidays: QueryRows<'company_holidays', CompanyHolidayRow>;
		employment_terms: QueryRows<'employment_terms', EmploymentTermRow>;
		work_days: QueryRows<'work_days', WorkDayRow>;
		leave_requests: QueryRows<'leave_requests', LeaveBalanceRequest> &
			Pick<Api<WorkspaceSchema>['db']['leave_requests'], 'findPending'>;
		payroll_runs: QueryRows<'payroll_runs', SettledRunRow>;
		shift_definitions: QueryRows<'shift_definitions', RosterCodeRow>;
		shift_patterns: QueryRows<'shift_patterns', ShiftPatternRow>;
	};
};

type LeavePreviewFacts = {
	readonly employee: Pick<
		WorkspaceRow<'employees'>,
		'gender' | 'date_of_birth' | 'nationality'
	> | null;
	readonly employment: WorkspaceRow<'employments'>;
	readonly leaveType: WorkspaceRow<'leave_types'>;
	readonly entitlement: EntitlementRow | null;
	readonly entries: readonly EntryRow[];
	readonly children: readonly WorkspaceRow<'employee_children'>[];
	readonly holidays: readonly CompanyHolidayRow[];
	readonly terms: readonly EmploymentTermRow[];
	readonly workDays: readonly WorkDayRow[];
	readonly requests: readonly LeaveBalanceRequest[];
	readonly settledRuns: readonly SettledRunRow[];
	readonly rosterCodes: readonly RosterCodeRow[];
	/** The named patterns the terms point at; a term's base is projected through them. */
	readonly patterns: readonly ShiftPatternRow[];
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
	patternById: ReadonlyMap<string, ShiftPatternRow>,
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
	const pattern = termPattern(term, patternById);
	let codeId = plannedByDate.get(date)?.shift_definition_id ?? null;
	if (codeId == null) {
		try {
			codeId = patternRosterCodeId(pattern, date);
		} catch {
			codeId = null;
		}
	}
	if (codeId == null) return { work: pattern.type === 'ROSTERED', codeId: null };
	const code = rosterCodeById.get(codeId);
	if (code == null)
		return {
			work: false,
			codeId,
			issue: issue('MISSING_ROSTER_CODE', `The schedule on ${date} names a missing roster code.`)
		};
	return { work: rosterCodeKind(code.variant) === 'WORK', codeId };
}

function entitlementCovers(entitlement: EntitlementRow | null, date: string): boolean {
	return (
		entitlement != null &&
		entitlement.status === 'OPEN' &&
		date >= dateKey(entitlement.starts_on) &&
		date <= dateKey(entitlement.ends_on)
	);
}

function dayPreview(
	date: string,
	facts: LeavePreviewFacts,
	input: PreviewLeaveInput,
	rosterCodeById: ReadonlyMap<string, RosterCodeRow>,
	patternById: ReadonlyMap<string, ShiftPatternRow>,
	plannedByDate: ReadonlyMap<string, WorkDayRow>,
	holidayDates: ReadonlySet<string>,
	settledWindows: ReturnType<typeof payrollWindows>
): { readonly day: LeaveDayPreview; readonly issue?: LeavePreviewIssue } {
	const hire = dateKey(facts.employment.hire_date);
	const exit = facts.employment.exit_date == null ? null : dateKey(facts.employment.exit_date);
	if (!entitlementCovers(facts.entitlement, date))
		return { day: { eligible: false, reason_code: 'ENTITLEMENT_REQUIRED', reason_mark: '—' } };
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
	const work = workEligible(date, facts, rosterCodeById, patternById, plannedByDate, holidayDates);
	if (work.issue?.code === 'MISSING_ROSTER_CODE')
		return {
			day: { eligible: false, reason_code: 'MISSING_ROSTER_CODE', reason_mark: '?' },
			issue: work.issue
		};
	if (work.issue != null)
		return { day: { eligible: false, reason_code: 'NO_SCHEDULE' }, issue: work.issue };
	if (!work.work) return { day: { eligible: false, reason_code: 'REST_OR_OFF', reason_mark: 'R' } };
	if (
		!isEligible(
			facts.leaveType.eligibility,
			personContext({
				employee: facts.employee,
				employment: facts.employment,
				terms: facts.terms.find((candidate) => coversDate(candidate.effective_range, date)) ?? null,
				children: facts.children,
				asOf: date
			})
		)
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
				row.leave_entitlement_id === facts.entitlement?.id
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
	if (facts.entitlement == null)
		issues.push(
			issue(
				'ENTITLEMENT_REQUIRED',
				'No generated leave entitlement covers this request. The reconciler creates the entitlement before leave can be submitted; an employee the leave type does not cover never has one.'
			)
		);
	if (range != null && pointNumber(range.end) < pointNumber(range.start))
		issues.push(issue('RANGE_INVERTED', 'Leave must end after it starts.'));
	if (range != null && range.start.date < hire)
		issues.push(issue('BEFORE_HIRE', 'Leave cannot start before the employment hire date.'));
	if (range != null && exit != null && range.end.date > exit)
		issues.push(issue('AFTER_EXIT', 'Leave cannot end after the employment exit date.'));
	if (
		range != null &&
		facts.entitlement != null &&
		!entitlementCovers(facts.entitlement, range.start.date)
	)
		issues.push(
			issue('ENTITLEMENT_REQUIRED', 'The selected entitlement does not cover the requested dates.')
		);
	if (
		range != null &&
		facts.entitlement != null &&
		!entitlementCovers(facts.entitlement, range.end.date)
	)
		issues.push(issue('ENTITLEMENT_REQUIRED', 'One leave request cannot cross leave years.'));
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
	const patternById = new Map(facts.patterns.map((row) => [row.id, row]));
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
			patternById,
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
	const remaining =
		facts.entitlement == null ? 0 : balanceAt(facts, asOf, input.exclude_request_id);
	if (
		facts.entitlement?.accrual_kind !== 'UNLIMITED' &&
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
	if (encashed) issues.push(issue('ENCASHED', 'This entitlement was encashed and is closed.'));
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
		// The type belongs to the entity through its settings lineage: any version of the lineage,
		// because a request may cite the row an earlier version's entitlement was sealed with.
		const company = yield* api.db.companies.findFirst({
			where: { id: { eq: employment.company_id } }
		});
		if (company == null) refuse('The employing entity does not exist.');
		const versions = yield* api.db.jurisdiction_settings.findMany({
			where: { code: { eq: company.settings_code }, approval_id: { isNull: true } },
			limit: LIMIT
		});
		requireComplete(versions, 'jurisdiction settings versions');
		const versionIds = versions.map((version) => version.id);
		const leaveType = yield* api.db.leave_types.findFirst({
			where: { id: { eq: input.leave_type_id } }
		});
		if (leaveType == null || !versionIds.includes(leaveType.settings_id))
			refuse('That leave type does not belong to the employing entity.');
		const asOf = input.range?.end.date ?? window.end;
		const entitlementRows = yield* api.db.leave_entitlements.findMany({
			where: {
				employment_id: { eq: input.employment_id },
				leave_type_id: { eq: leaveType.id },
				approval_id: { isNull: true }
			},
			limit: LIMIT
		});
		requireComplete(entitlementRows, 'leave entitlement');
		const entitlement =
			entitlementRows.find((row) => row.id === input.leave_entitlement_id) ??
			entitlementRows.find((row) => entitlementCovers(row, asOf)) ??
			null;
		if (input.leave_entitlement_id != null && entitlement?.id !== input.leave_entitlement_id)
			refuse('The selected leave entitlement does not belong to this employment and leave type.');

		const [person, holidays, terms, workDays, storedRequests, settledRuns, entries, children] =
			yield* Effect.all(
				[
					api.db.employees.findFirst({
						where: { id: { eq: employment.employee_id } },
						columns: { gender: true, date_of_birth: true, nationality: true }
					}),
					Effect.map(
						versionIds.length === 0
							? Effect.succeed([] as CompanyHolidayRow[])
							: api.db.company_holidays.findMany({
									where: {
										settings_id: { in: versionIds },
										date: { gte: window.start, lte: window.end }
									},
									limit: LIMIT
								}),
						// A holiday counts on the days its own version governs.
						(rows) =>
							rows.filter(
								(row) =>
									settingsInForce(versions, company.settings_code, dateKey(row.date))?.id ===
									row.settings_id
							)
					),
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
					entitlement == null
						? Effect.succeed([])
						: api.db.leave_entries.findMany({
								where: {
									leave_entitlement_id: { eq: entitlement.id },
									approval_id: { isNull: true }
								},
								limit: LIMIT
							}),
					api.db.employee_children.findMany({
						where: { employment_id: { eq: input.employment_id }, approval_id: { isNull: true } },
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
			[entries, 'leave entry'],
			[children, 'child fact']
		] as const)
			requireComplete(rows, label);
		const requests = yield* withPendingLeaveRequests(
			api,
			input.employment_id,
			storedRequests,
			input.exclude_request_id
		);
		// The named patterns the terms point at, read after the terms because the ids come from them.
		const patternIds = [
			...new Set(
				terms.flatMap((term) => (term.shift_pattern_id == null ? [] : [term.shift_pattern_id]))
			)
		];
		const patterns =
			patternIds.length === 0
				? []
				: yield* api.db.shift_patterns.findMany({
						where: { id: { in: patternIds } },
						limit: LIMIT
					});
		requireComplete(patterns, 'shift pattern');
		const patternById = new Map(patterns.map((row) => [row.id, row]));
		const shiftIds = [
			...new Set([
				...workDays.flatMap((day) =>
					day.shift_definition_id == null ? [] : [day.shift_definition_id]
				),
				...terms.flatMap((term) => patternRosterCodeIds(termPattern(term, patternById)))
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
			employee: person ?? null,
			employment,
			leaveType,
			entitlement,
			entries,
			children,
			holidays,
			terms,
			workDays,
			requests,
			settledRuns,
			rosterCodes,
			patterns
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
