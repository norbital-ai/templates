import { refuse } from '@norbital-ai/bolt/authoring';
import { fromMinorUnits, toMinorUnits } from '@norbital-ai/std/finance';
import type {
	LeaveEvent,
	LeaveWindow,
	TimeOffEvent
} from '../../datatypes/leave_event/+definition.js';
import type { LeaveAllocation } from '../../datatypes/leave_allocations/+definition.js';
import type { LeaveCharge } from '../../datatypes/leave_charges/+definition.js';
import { daysBetween } from '../../collections/payroll_runs/lib/dates.js';
import { coversDate } from '../../collections/payroll_runs/lib/effective.js';
import { dateKey } from '../iso-day.js';
import { pointNumber } from '../half-day.js';
import { resolveHolidays } from '../holiday-calendar.js';
import { patternRosterCodeId, termPattern } from '../scheduling/work-pattern.js';
import { rosterCodeKind, workWindowHalves } from '../scheduling/roster-code.js';
import { payrollWindows, lockStateForDate } from '../scheduling/lock.js';
import {
	allocateLeaveDays,
	assertLeaveBalanceIntegrity,
	reverseLeaveAllocations
} from './balance.js';
import { assertLeaveWindow, leaveWindowOf } from './entitlement.js';
import { leaveRules, type LeaveContext } from './context.js';
import type { LeaveActivity } from './pending.js';

export type LeaveSubmission = {
	readonly employment_id: string;
	readonly leave_catalogue_id: string;
	readonly reference: string;
	readonly event: LeaveEvent;
};

/** Actual approval dates consume history; annual availability remains a recomputable projection. */
/** Approved reversals cancel coverage, while held reversals leave the original reservation intact. */
export function activeTimeOff(entries: readonly LeaveActivity[]) {
	const reversed = new Set(
		entries.flatMap((row) =>
			row.approval_id == null && row.event.kind === 'REVERSAL' ? [row.event.entry_id] : []
		)
	);
	return entries.filter(
		(row): row is LeaveActivity & { event: TimeOffEvent } =>
			row.event.kind === 'TIME_OFF' && !reversed.has(row.id)
	);
}

export function measureLeaveDay(
	context: LeaveContext,
	rules: ReturnType<typeof leaveRules>,
	date: string,
	entries: readonly LeaveActivity[]
) {
	const settings = rules.settingsOn(date);
	const resolved = resolveHolidays(context.holidays, rules.company.id, date, date);
	const evidence = {
		company_id: rules.company.id,
		date,
		holiday_id: resolved.get(date)?.id ?? null
	};
	if (date < rules.hire)
		return { eligible: false as const, reason: 'BEFORE_HIRE' as const, evidence };
	if (rules.exit != null && date > rules.exit)
		return { eligible: false as const, reason: 'AFTER_EXIT' as const, evidence };
	const paid = lockStateForDate(
		payrollWindows(
			context.runs.filter((row) => row.company_id === rules.company.id && row.lifecycle === 'PAID')
		),
		date
	);
	if (paid.kind === 'SETTLED')
		return {
			eligible: false as const,
			reason: 'PAID_PAYROLL' as const,
			period: paid.period,
			evidence
		};
	if (resolved.has(date)) return { eligible: false as const, reason: 'HOLIDAY' as const, evidence };
	const term = rules.terms.find((row) => coversDate(row.effective_range, date));
	if (!term) return { eligible: false as const, reason: 'NO_SCHEDULE' as const, evidence };
	const override = context.workDays.find(
		(row) => row.employment_id === rules.employment.id && dateKey(row.work_date) === date
	);
	const namedPattern = context.patterns.find((row) => row.id === term.shift_pattern_id);
	if (namedPattern != null && !coversDate(namedPattern.effective_range, date))
		return { eligible: false as const, reason: 'NO_SCHEDULE' as const, evidence };
	const pattern = termPattern(term, new Map(context.patterns.map((row) => [row.id, row])));
	const codeId = override?.shift_definition_id ?? patternRosterCodeId(pattern, date);
	const shift = context.shifts.find(
		(row) => row.id === codeId && row.company_id === rules.company.id
	);
	if (!shift || !coversDate(shift.effective_range, date))
		return { eligible: false as const, reason: 'MISSING_ROSTER_CODE' as const, evidence };
	if (rosterCodeKind(shift.variant) !== 'WORK')
		return { eligible: false as const, reason: 'REST_OR_OFF' as const, evidence };
	if (!rules.eligibleOn(date))
		return { eligible: false as const, reason: 'INELIGIBLE' as const, evidence };
	const occupied = new Set<'FIRST' | 'SECOND'>();
	for (const entry of activeTimeOff(
		entries.filter((row) => row.employment_id === rules.employment.id)
	)) {
		if (!entry.charges.some((charge) => charge.date === date)) continue;
		for (const half of ['FIRST', 'SECOND'] as const) {
			const point = pointNumber({ date, half });
			if (
				point >= pointNumber(entry.event.range.start) &&
				point <= pointNumber(entry.event.range.end)
			)
				occupied.add(half);
		}
	}
	return {
		eligible: true as const,
		evidence,
		occupied,
		term,
		shift,
		workDay: override ?? null,
		catalogue: rules.catalogueOn(date),
		labels: workWindowHalves(shift.variant)
	};
}

/** Complete entry planning is pure over the guarded preparation reads, including batch reservations. */
export function planLeaveActivity(
	context: LeaveContext,
	input: LeaveSubmission,
	id: string,
	entries: readonly LeaveActivity[] = context.entries
) {
	const rules = leaveRules(context, input.employment_id, input.leave_catalogue_id);
	if (!input.reference.trim()) refuse('A leave entry needs a unique supporting reference.');
	const sameLeave = entries.filter(
		(row) => row.employment_id === input.employment_id && row.leave_code === rules.selected.code
	);
	if (
		entries.some(
			(row) => row.employment_id === input.employment_id && row.reference === input.reference
		)
	)
		refuse('A leave entry with this reference already exists or is awaiting approval.');
	let event = input.event;
	const charges: LeaveCharge[] = [];
	const allocations: LeaveAllocation[] = [];
	let certificateRequired = false;
	const debit = (
		window: LeaveWindow,
		date: string,
		days: number,
		basis: 'available' | 'earned'
	) => {
		assertLeaveWindow(window, rules.catalogueOn(date).entitlement.year_start_month);
		allocations.push(
			...allocateLeaveDays({
				entries: [...sameLeave, { id, event, allocations, approval_id: 'planning' }],
				window,
				date,
				days,
				entitlementAt: rules.entitlementAt,
				basis
			})
		);
	};
	switch (event.kind) {
		case 'TIME_OFF': {
			const range = event.range;
			if (pointNumber(range.end) < pointNumber(range.start))
				refuse('Leave must end after it starts.');
			if (range.start.date < rules.hire || (rules.exit != null && range.end.date > rules.exit))
				refuse('Time off must fall within the employment dates.');
			for (const date of daysBetween(range.start.date, range.end.date)) {
				const day = measureLeaveDay(context, rules, date, entries);
				if (!day.eligible) {
					if (day.reason === 'HOLIDAY' || day.reason === 'REST_OR_OFF') continue;
					refuse(`Leave on ${date} cannot be approved: ${day.reason}.`);
				}
				let halves = 0;
				for (const half of ['FIRST', 'SECOND'] as const) {
					const point = pointNumber({ date, half });
					if (point < pointNumber(range.start) || point > pointNumber(range.end)) continue;
					if (day.occupied.has(half))
						refuse(`Leave overlaps an approved or pending ${half.toLowerCase()} half on ${date}.`);
					halves += 1;
				}
				const days = halves === 2 ? 1 : 0.5;
				charges.push({
					date,
					days,
					leave_catalogue_id: day.catalogue.id,
					employment_term_id: day.term.id,
					holiday_id: day.evidence.holiday_id,
					shift_definition_id: day.shift.id,
					work_day_id: day.workDay?.id ?? null
				});
				debit(
					leaveWindowOf(date, day.catalogue.entitlement.year_start_month),
					date,
					days,
					'available'
				);
			}
			if (charges.length === 0) refuse('The range contains no eligible scheduled work time.');
			const quantity = charges.reduce((sum, row) => sum + row.days, 0);
			certificateRequired = charges.some((row) => {
				const threshold = context.catalogues.find(
					(catalogue) => catalogue.id === row.leave_catalogue_id
				)?.requires_certificate_after_days;
				return threshold != null && quantity > threshold;
			});
			event = { ...event, chargeable_days: quantity };
			break;
		}
		case 'ENCASHMENT': {
			if (event.effective_on < event.source_window.start || event.due_on < event.effective_on)
				refuse('Encashment needs effective and due dates in order after the source window begins.');
			const amount = event.gross_amount;
			if (amount.value <= 0) refuse('An encashment needs a positive agreed gross amount.');
			if (
				event.rate != null &&
				toMinorUnits(event.days * event.rate, amount.currency) !==
					toMinorUnits(amount.value, amount.currency)
			)
				refuse('Days multiplied by the entered rate must equal the agreed gross amount.');
			const date = [
				event.effective_on,
				event.source_window.end,
				...(rules.exit == null ? [] : [rules.exit])
			].toSorted()[0]!;
			if (date < event.source_window.start)
				refuse('The source window falls after this employment ended.');
			if (date < rules.hire) refuse('Encashment cannot consume leave before employment began.');
			if (amount.currency !== rules.settingsOn(date).currency)
				refuse('The agreed encashment currency must match the source jurisdiction currency.');
			if (
				Math.abs(
					fromMinorUnits(toMinorUnits(amount.value, amount.currency), amount.currency) -
						amount.value
				) > 1e-9
			)
				refuse('The agreed encashment amount must use the currency’s supported decimal precision.');
			debit(event.source_window, date, event.days, 'earned');
			break;
		}
		case 'CARRY_FORWARD': {
			assertLeaveWindow(
				event.destination_window,
				rules.catalogueOn(event.available_from).entitlement.year_start_month
			);
			if (
				event.destination_window.start <= event.source_window.end ||
				event.available_from < event.destination_window.start ||
				event.expires_on > event.destination_window.end ||
				event.available_from > event.expires_on
			)
				refuse(
					'Carry-forward needs a later destination window and validity dates inside that window.'
				);
			debit(event.source_window, event.source_window.end, event.days, 'earned');
			allocations.push({
				window: event.destination_window,
				date: event.available_from,
				days: event.days,
				credit_entry_id: id
			});
			break;
		}
		case 'ADJUSTMENT': {
			assertLeaveWindow(
				event.window,
				rules.catalogueOn(event.effective_on).entitlement.year_start_month
			);
			if (!event.reason?.trim()) refuse('A leave adjustment needs a reason.');
			if (event.effective_on < event.window.start || event.effective_on > event.window.end)
				refuse('A leave adjustment must fall inside its stated window.');
			if (event.days < 0) debit(event.window, event.effective_on, -event.days, 'available');
			else
				allocations.push({
					window: event.window,
					date: event.effective_on,
					days: event.days,
					credit_entry_id: null
				});
			break;
		}
		case 'REVERSAL': {
			const originalId = event.entry_id;
			const original = sameLeave.find((row) => row.id === originalId && row.approval_id == null);
			if (!original)
				refuse('A reversal must reference an approved entry for this employment and leave type.');
			if (
				sameLeave.some((row) => row.event.kind === 'REVERSAL' && row.event.entry_id === originalId)
			)
				refuse('This leave entry is already reversed or has a pending reversal.');
			if (!event.reason?.trim()) refuse('A reversal needs a reason.');
			const originalDate =
				original.event.kind === 'TIME_OFF'
					? original.event.range.start.date
					: original.event.effective_on;
			if (event.effective_on < originalDate)
				refuse('A reversal cannot precede its original activity.');
			const captured = context.captures.filter((row) => row.leave_entry_id === original.id);
			let currency: string | null = null;
			let total = 0n;
			for (const capture of captured) {
				// This person's own payslip. Payment is per slip, so a colleague still waiting on a
				// correction no longer holds this reversal — the run reading DRAFT because of them
				// used to refuse a reversal whose money had in fact been paid.
				const payslip = context.payslips.find((row) => row.id === capture.payslip_id);
				if (payslip == null || payslip.paid_at == null)
					refuse('Delete or settle the draft payroll holding this leave before reversing it.');
				const amount = capture.gross_amount;
				if (currency != null && currency !== amount.currency)
					refuse('Leave captures use inconsistent currencies.');
				currency = amount.currency;
				total += toMinorUnits(amount.value, amount.currency);
			}
			const gross =
				currency == null || total === 0n
					? null
					: { value: fromMinorUnits(-total, currency), currency };
			if (gross != null && (event.due_on == null || event.due_on < event.effective_on))
				refuse('A paid leave correction needs a due date on or after its effective date.');
			allocations.push(...reverseLeaveAllocations(original));
			const days =
				original.event.kind === 'TIME_OFF'
					? original.event.chargeable_days
					: original.event.kind === 'REVERSAL'
						? null
						: Math.abs(original.event.days);
			event = { ...event, days, gross_amount: gross, due_on: gross == null ? null : event.due_on };
			break;
		}
	}
	const windows = [...new Map(allocations.map((row) => [row.window.start, row.window])).values()];
	assertLeaveBalanceIntegrity(
		[...sameLeave, { id, event, allocations, approval_id: null }],
		windows,
		rules.entitlementAt
	);
	return {
		employment_id: input.employment_id,
		leave_catalogue_id: rules.selected.id,
		leave_code: rules.selected.code,
		reference: input.reference,
		event,
		charges,
		allocations,
		certificateRequired
	};
}
