import { refuse } from '../refuse.js';
import type { Reads } from '../reads.js';
import { pointNumber } from '../half-day.js';
import { calendarDaysThrough, leaveCalendarGridBounds } from './calendar-grid.js';
import { readLeaveContext, leavePool, leaveRules, type LeaveContext } from './context.js';
import { measureLeaveDay, planLeaveActivity } from './activity.js';
import { leaveBalanceAt, assertLeaveBalanceIntegrity } from './balance.js';
import { leaveWindowOf } from './entitlement.js';
import { getErrorMessage } from '../refuse.js';

type HalfDay = { readonly date: string; readonly half: 'FIRST' | 'SECOND' };
/** The `leave_entries.preview_leave` query's input, as its literal declares it. */
export type PreviewLeaveInput = {
	readonly employment_id: string;
	readonly catalogue_id: string;
	/** A calendar month, YYYY-MM. */
	readonly calendar_month?: string | null;
	readonly range?: { readonly start: HalfDay; readonly end: HalfDay } | null;
	readonly exclude_entry_id?: string | null;
};
export type LeaveDayPreview = {
	readonly eligible: boolean;
	readonly reason_code?:
		| 'INELIGIBLE'
		| 'HOLIDAY'
		| 'REST_OR_OFF'
		| 'OTHER_LEAVE'
		| 'PAID_PAYROLL'
		| 'NO_SCHEDULE'
		| 'BEFORE_HIRE'
		| 'AFTER_EXIT'
		| 'MISSING_ROSTER_CODE';
	readonly reason_mark?: string;
	readonly settled?: boolean;
	readonly shift_label?: string;
	readonly first_half_label?: string;
	readonly second_half_label?: string;
	readonly first_half_available?: boolean;
	readonly second_half_available?: boolean;
};
export type LeavePreview = {
	readonly certificate_required: boolean;
	readonly remaining_days: number | null;
	readonly chargeable_days: number | null;
	readonly availability: Readonly<Record<string, LeaveDayPreview>>;
	readonly issues: readonly { readonly code: 'INVALID_INPUT'; readonly message: string }[];
};

export function previewWindowOf(input: PreviewLeaveInput) {
	if (input.calendar_month != null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.calendar_month))
		refuse('A calendar month is YYYY-MM.');
	const grid = input.calendar_month == null ? null : leaveCalendarGridBounds(input.calendar_month);
	const start = [grid?.start, input.range?.start.date]
		.filter((value): value is string => value != null)
		.toSorted()[0];
	const end = [grid?.end, input.range?.end.date]
		.filter((value): value is string => value != null)
		.toSorted()
		.at(-1);
	return start == null || end == null ? null : { start, end };
}

export function evaluateLeavePreview(
	context: LeaveContext,
	input: PreviewLeaveInput
): LeavePreview {
	const window = previewWindowOf(input);
	if (!window) refuse('Choose a calendar month or a leave range.');
	const rules = leaveRules(context, input.employment_id, input.catalogue_id);
	const entries = context.entries.filter((row) => row.id !== input.exclude_entry_id);
	const sameLeave = leavePool(context, input.employment_id, rules, entries).own;
	const availability: Record<string, LeaveDayPreview> = {};
	const dates = calendarDaysThrough(window.start, window.end);
	for (const date of dates) {
		if (rules.catalogueAt(date) == null) {
			availability[date] = { eligible: false, reason_code: 'INELIGIBLE', reason_mark: '—' };
			continue;
		}
		const day = measureLeaveDay(context, rules, date, entries);
		if (!day.eligible) {
			availability[date] = {
				eligible: false,
				reason_code: day.reason,
				reason_mark: day.reason === 'HOLIDAY' ? 'H' : day.reason === 'REST_OR_OFF' ? 'R' : '—',
				...('period' in day ? { settled: true } : {})
			};
		} else {
			const first = !day.occupied.has('FIRST'),
				second = !day.occupied.has('SECOND');
			availability[date] = {
				eligible: first || second,
				...(first || second ? {} : { reason_code: 'OTHER_LEAVE' as const, reason_mark: 'L' }),
				first_half_available: first,
				second_half_available: second,
				...(day.labels == null
					? {}
					: {
							shift_label: day.labels.span,
							first_half_label: day.labels.first,
							second_half_label: day.labels.second
						})
			};
		}
	}
	// Calendar padding is display only. Without a selection, show the first covered day of
	// the requested month; a selected range retains strict validation of its actual start date.
	const asOf =
		input.range?.start.date ??
		dates.find(
			(date) => date.startsWith(input.calendar_month ?? '') && rules.catalogueAt(date) != null
		) ??
		(input.calendar_month == null ? window.start : `${input.calendar_month}-01`);
	const annual = leaveWindowOf(asOf, rules.catalogueOn(asOf).entitlement);
	assertLeaveBalanceIntegrity(sameLeave, [annual], rules.entitlementAt);
	const balance = leaveBalanceAt({
		entries: sameLeave,
		window: annual,
		date: asOf,
		entitlementAt: rules.entitlementAt
	});
	const issues: { code: 'INVALID_INPUT'; message: string }[] = [];
	let quantity: number | null = null;
	let certificate = false;
	if (input.range != null) {
		try {
			let reference = 'preview';
			while (entries.some((row) => row.reference === reference)) reference += ':';
			const plan = planLeaveActivity(
				context,
				{
					employment_id: input.employment_id,
					catalogue_id: input.catalogue_id,
					reference,
					from_date: input.range.start.date,
					to_date: input.range.end.date,
					half_day_start: input.range.start.half === 'SECOND',
					half_day_end: input.range.end.half === 'FIRST',
					days: null,
					as_adjustment_entry: false,
					reason: null
				},
				'00000000-0000-4000-8000-000000000000',
				entries
			);
			quantity = plan.charges.reduce((sum, row) => sum + row.days, 0);
			certificate = plan.certificateRequired;
		} catch (error) {
			issues.push({
				code: 'INVALID_INPUT',
				message: getErrorMessage(error)
			});
			// Still show the measured selection when a balance or certificate check refuses it.
			if (pointNumber(input.range.start) <= pointNumber(input.range.end))
				quantity = calendarDaysThrough(input.range.start.date, input.range.end.date).reduce(
					(sum, date) => {
						const day = availability[date];
						if (!day?.eligible) return sum;
						for (const half of ['FIRST', 'SECOND'] as const) {
							const point = pointNumber({ date, half });
							if (
								point >= pointNumber(input.range!.start) &&
								point <= pointNumber(input.range!.end) &&
								(half === 'FIRST' ? day.first_half_available : day.second_half_available)
							)
								sum += 0.5;
						}
						return sum;
					},
					0
				);
		}
	}
	return {
		remaining_days: balance.available,
		chargeable_days: quantity,
		certificate_required: certificate,
		availability,
		issues
	};
}

export async function previewLeave(reads: Reads, input: PreviewLeaveInput): Promise<LeavePreview> {
	const window = previewWindowOf(input);
	if (!window) refuse('Choose a calendar month or a leave range.');
	return evaluateLeavePreview(await readLeaveContext(reads, [input.employment_id], window), input);
}
