import { Effect, Schema } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { calendarDay } from '../iso-day.js';
import { pointNumber } from '../half-day.js';
import { calendarDaysThrough, leaveCalendarGridBounds } from './calendar-grid.js';
import { readLeaveContext, leaveRules, type LeaveContext, type LeaveReadApi } from './context.js';
import { measureLeaveDay, planLeaveActivity } from './activity.js';
import { leaveBalanceAt, assertLeaveBalanceIntegrity } from './balance.js';
import { leaveWindowOf } from './entitlement.js';

const half = Schema.Literals(['FIRST', 'SECOND']);
export const previewLeaveInputSchema = Schema.Struct({
	employment_id: Schema.String.check(Schema.isUUID()),
	leave_catalogue_id: Schema.String.check(Schema.isUUID()),
	calendar_month: Schema.optionalKey(
		Schema.String.check(Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])$/))
	),
	range: Schema.optionalKey(
		Schema.Struct({
			start: Schema.Struct({ date: calendarDay, half }),
			end: Schema.Struct({ date: calendarDay, half })
		})
	),
	exclude_entry_id: Schema.optionalKey(Schema.String.check(Schema.isUUID()))
});
export type PreviewLeaveInput = Schema.Schema.Type<typeof previewLeaveInputSchema>;
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
	readonly settled_period?: string;
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
	const rules = leaveRules(context, input.employment_id, input.leave_catalogue_id);
	const entries = context.entries.filter((row) => row.id !== input.exclude_entry_id);
	const sameLeave = entries.filter(
		(row) => row.employment_id === input.employment_id && row.leave_code === rules.selected.code
	);
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
				...('period' in day ? { settled_period: day.period } : {})
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
	const annual = leaveWindowOf(asOf, rules.catalogueOn(asOf).entitlement.year_start_month);
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
					leave_catalogue_id: input.leave_catalogue_id,
					reference,
					event: { kind: 'TIME_OFF', range: input.range, chargeable_days: null, reason: null }
				},
				'00000000-0000-4000-8000-000000000000',
				entries
			);
			quantity = plan.charges.reduce((sum, row) => sum + row.days, 0);
			certificate = plan.certificateRequired;
		} catch (error) {
			issues.push({
				code: 'INVALID_INPUT',
				message: error instanceof Error ? error.message : String(error)
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

export function previewLeave(
	api: LeaveReadApi,
	input: PreviewLeaveInput
): Effect.Effect<LeavePreview> {
	const window = previewWindowOf(input);
	if (!window) refuse('Choose a calendar month or a leave range.');
	return Effect.map(readLeaveContext(api, [input.employment_id], window), (context) =>
		evaluateLeavePreview(context, input)
	);
}
