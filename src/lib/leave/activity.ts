import { refuse } from '@norbital-ai/bolt/authoring';
import { fromMinorUnits, toMinorUnits } from '@norbital-ai/std/finance';
import type { LeaveActivity } from './pending.js';
import type { LeaveAllocation } from '../../datatypes/leave_allocations/+definition.js';
import type { LeaveCharge } from '../../datatypes/leave_charges/+definition.js';
import { addDays, daysBetween, monthDay } from '../../collections/payroll_runs/lib/dates.js';
import { coversDate } from '../../collections/payroll_runs/lib/effective.js';
import { dateKey } from '../iso-day.js';
import { pointNumber, type HalfDayRange } from '../half-day.js';
import { resolveHolidays } from '../holiday-calendar.js';
import { patternAnchor, patternRosterCodeId, termPatternRow } from '../scheduling/work-pattern.js';
import { rosterCodeKind, workWindow, workWindowHalves } from '../scheduling/roster-code.js';
import type { RosterCodeVariant } from '../../datatypes/roster_code_variant/+definition.js';
import { payrollWindows, lockStateForDate } from '../scheduling/lock.js';
import {
	allocateLeaveDays,
	assertLeaveBalanceIntegrity,
	reverseLeaveAllocations
} from './balance.js';
import { assertLeaveWindow, grantedDays, leaveWindowOf, type LeaveWindow } from './entitlement.js';
import { leavePool, leaveRules, type LeaveContext } from './context.js';
import {
	emptyActivityFields,
	leaveActivityOf,
	type LeaveActivityKind,
	type LeaveEntryActivity
} from './activity-fields.js';

export type LeaveSubmission = LeaveEntryActivity & {
	readonly employment_id: string;
	readonly catalogue_id: string;
	readonly reference: string;
};

type FlatFields = Required<Omit<LeaveEntryActivity, 'charges'>>;

/** The half-day points a flat time-off range states; null when the range is incomplete. */
export function timeOffRangeOf(fields: LeaveEntryActivity): HalfDayRange | null {
	if (fields.from_date == null || fields.to_date == null) return null;
	return {
		start: { date: fields.from_date, half: fields.half_day_start ? 'SECOND' : 'FIRST' },
		end: { date: fields.to_date, half: fields.half_day_end ? 'FIRST' : 'SECOND' }
	};
}

/** Actual approval dates consume history; annual availability remains a recomputable projection. */
/** Approved reversals cancel coverage, while held reversals leave the original reservation intact. */
export function activeTimeOff(entries: readonly LeaveActivity[]) {
	const reversed = new Set(
		entries.flatMap((row) =>
			row.approval_id == null && row.as_adjustment_entry === true && row.reversal_of_id != null
				? [row.reversal_of_id]
				: []
		)
	);
	return entries.filter(
		(row) => leaveActivityOf(row) === 'TIME_OFF' && row.charges.length > 0 && !reversed.has(row.id)
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
	// The lock is this person's payslip, not their run. A colleague still held no longer keeps the
	// day open, and a colleague already paid no longer closes it.
	const paid = lockStateForDate(
		payrollWindows(
			context.runs.filter((row) => row.company_id === rules.company.id),
			context.payslips
		),
		date,
		rules.employment.id
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
	const patternRow = termPatternRow(term, new Map(context.patterns.map((row) => [row.id, row])));
	const codeId =
		override?.shift_definition_id ??
		patternRosterCodeId(patternRow?.pattern ?? null, date, patternAnchor(patternRow));
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
		const range = timeOffRangeOf(entry);
		if (range == null) continue;
		for (const half of ['FIRST', 'SECOND'] as const) {
			const point = pointNumber({ date, half });
			if (point >= pointNumber(range.start) && point <= pointNumber(range.end)) occupied.add(half);
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

function activityDateOf(entry: LeaveActivity): string | null {
	if (leaveActivityOf(entry) === 'TIME_OFF') return entry.from_date;
	return entry.effective_on;
}

/** Complete entry planning is pure over the guarded preparation reads, including batch reservations. */
export function planLeaveActivity(
	context: LeaveContext,
	input: LeaveSubmission,
	id: string,
	entries: readonly LeaveActivity[] = context.entries
) {
	const rules = leaveRules(
		context,
		input.employment_id,
		input.catalogue_id,
		input.event_kind == null && input.event_relationship == null && input.event_child_index == null
			? undefined
			: {
					kind: input.event_kind,
					relationship: input.event_relationship,
					child_index: input.event_child_index,
					date: input.event_date
				}
	);
	if (!input.reference.trim()) refuse('A leave entry needs a unique supporting reference.');
	const pools = leavePool(context, input.employment_id, rules, entries);
	const sameLeave = pools.own;
	if (
		entries.some(
			(row) => row.employment_id === input.employment_id && row.reference === input.reference
		)
	)
		refuse('A leave entry with this reference already exists or is awaiting approval.');
	let fields: FlatFields = {
		...emptyActivityFields(),
		from_date: input.from_date ?? null,
		to_date: input.to_date ?? null,
		half_day_start: input.half_day_start ?? null,
		half_day_end: input.half_day_end ?? null,
		days: input.days ?? null,
		hours: input.hours ?? null,
		encash_days: input.encash_days ?? null,
		as_adjustment_entry: input.as_adjustment_entry ?? false,
		reversal_of_id: input.reversal_of_id ?? null,
		effective_on: input.effective_on ?? null,
		due_on: input.due_on ?? null,
		destination_from: input.destination_from ?? null,
		destination_to: input.destination_to ?? null,
		available_from: input.available_from ?? null,
		expires_on: input.expires_on ?? null,
		reason: input.reason ?? null,
		event_kind: input.event_kind ?? null,
		event_relationship: input.event_relationship ?? null,
		event_child_index: input.event_child_index ?? null,
		event_date: input.event_date ?? null
	};
	const charges: LeaveCharge[] = [];
	const allocations: LeaveAllocation[] = [];
	const pooled: { window: LeaveWindow; date: string; days: number }[] = [];
	let certificateRequired = false;
	const debit = (
		window: LeaveWindow,
		date: string,
		days: number,
		basis: 'available' | 'earned'
	) => {
		assertLeaveWindow(window, rules.catalogueOn(date).entitlement);
		allocations.push(
			...allocateLeaveDays({
				entries: [...sameLeave, { id, allocations, approval_id: 'planning' }],
				window,
				date,
				days,
				entitlementAt: rules.entitlementAt,
				basis
			})
		);
		// The same day also counts inside the pool this row draws from.
		if (pools.pool != null) {
			const poolWindow = leaveWindowOf(date, pools.pool.rules.catalogueOn(date).entitlement);
			allocations.push(
				...allocateLeaveDays({
					entries: [
						...pools.pool.entries,
						{ id, allocations, approval_id: 'planning', leave_code: rules.selected.code }
					],
					window: poolWindow,
					date,
					days,
					entitlementAt: pools.pool.rules.entitlementAt,
					basis,
					pool: pools.pool.code
				})
			);
		}
	};
	/**
	 * A grant that is not an annual pool is judged on the entry itself: a PER_EVENT row against
	 * the days its bands grant for this event and the events a lifetime allows; a rolling-window
	 * row against the days already charged in the months before each charge.
	 */
	const judgeUnpooled = (charged: readonly LeaveCharge[], quantity: number): boolean => {
		const first = charged[0];
		if (first == null) return false;
		const rule = rules.catalogueOn(first.date).entitlement;
		if (rule.availability === 'PER_EVENT') {
			const person = rules.personOn(first.date, {
				kind: fields.event_kind,
				relationship: fields.event_relationship,
				child_index: fields.event_child_index,
				date: fields.event_date
			});
			const granted = grantedDays(rule, person);
			if (quantity > granted + 1e-9)
				refuse(
					`${rules.selected.code} grants ${granted} days for this event; ${quantity} were requested.`
				);
			const taken = activeTimeOff(sameLeave).filter(
				(row) => row.leave_code === rules.selected.code && row.employment_id === input.employment_id
			).length;
			// ponytail: counted on this employment; a rehire's earlier contract is not read here.
			if (rule.lifetime_events != null && taken >= rule.lifetime_events)
				refuse(
					`${rules.selected.code} is granted for ${rule.lifetime_events} events in a lifetime; this would be event ${taken + 1}.`
				);
			return true;
		}
		if (rule.rolling_months != null) {
			for (const charge of charged) {
				const from = addDays(
					monthDay(
						Number(charge.date.slice(0, 4)),
						Number(charge.date.slice(5, 7)) - 1 - rule.rolling_months,
						Number(charge.date.slice(8, 10))
					),
					1
				);
				const already = activeTimeOff(sameLeave)
					.flatMap((row) => row.charges)
					.filter((row) => row.date >= from && row.date <= charge.date)
					.reduce((sum, row) => sum + row.days, 0);
				const within = charged
					.filter((row) => row.date >= from && row.date <= charge.date)
					.reduce((sum, row) => sum + row.days, 0);
				const granted = grantedDays(rule, rules.personOn(charge.date));
				if (already + within > granted + 1e-9)
					refuse(
						`${rules.selected.code} allows ${granted} days in any ${rule.rolling_months} months; ${already} are already taken in the ${rule.rolling_months} months before ${charge.date}.`
					);
			}
			return true;
		}
		return false;
	};
	const activity: LeaveActivityKind = leaveActivityOf(fields);
	switch (activity) {
		case 'TIME_OFF': {
			const range = timeOffRangeOf(fields);
			if (range == null) refuse('Time off needs a start and end date.');
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
				const days =
					day.catalogue.unit === 'HOUR' && fields.hours != null
						? hourlyShare(fields.hours, range, day.shift.variant)
						: halves === 2
							? 1
							: 0.5;
				charges.push({
					date,
					days,
					catalogue_id: day.catalogue.id,
					employment_term_id: day.term.id,
					holiday_id: day.evidence.holiday_id,
					shift_definition_id: day.shift.id,
					work_day_id: day.workDay?.id ?? null
				});
				pooled.push({ window: leaveWindowOf(date, day.catalogue.entitlement), date, days });
			}
			if (charges.length === 0) refuse('The range contains no eligible scheduled work time.');
			const quantity = charges.reduce((sum, row) => sum + row.days, 0);
			if (!judgeUnpooled(charges, quantity))
				for (const debitOf of pooled)
					debit(debitOf.window, debitOf.date, debitOf.days, 'available');
			certificateRequired = charges.some((row) => {
				const threshold = context.catalogues.find(
					(catalogue) => catalogue.id === row.catalogue_id
				)?.evidence_after_days;
				return threshold != null && quantity > threshold;
			});
			fields = {
				...fields,
				from_date: range.start.date,
				to_date: range.end.date,
				half_day_start: range.start.half === 'SECOND',
				half_day_end: range.end.half === 'FIRST',
				days: quantity,
				effective_on: range.start.date
			};
			break;
		}
		case 'ENCASHMENT': {
			if (fields.from_date == null || fields.to_date == null)
				refuse('Encashment needs a source window.');
			const source: LeaveWindow = { start: fields.from_date, end: fields.to_date };
			if (
				fields.encash_days == null ||
				!Number.isFinite(fields.encash_days) ||
				fields.encash_days <= 0
			)
				refuse('An encashment converts a positive number of days.');
			if (
				fields.effective_on == null ||
				fields.due_on == null ||
				fields.effective_on < source.start ||
				fields.due_on < fields.effective_on
			)
				refuse('Encashment needs effective and due dates in order after the source window begins.');
			const catalogue = context.catalogues.find((row) => row.id === input.catalogue_id);
			if (catalogue == null) refuse('Encashment names a leave row that is not available.');
			if (!catalogue.can_encash)
				refuse(`${catalogue.code} is not encashable in this settings version.`);
			const date = [
				fields.effective_on,
				source.end,
				...(rules.exit == null ? [] : [rules.exit])
			].toSorted()[0]!;
			if (date < source.start) refuse('The source window falls after this employment ended.');
			if (date < rules.hire) refuse('Encashment cannot consume leave before employment began.');
			// Leave carries no pricing: the days are the entry's own quantity and payroll prices them
			// at the ordinary day wage when the entry settles.
			debit(source, date, fields.encash_days, 'earned');
			fields = { ...fields, days: fields.encash_days };
			break;
		}
		case 'CARRY_FORWARD': {
			if (
				fields.from_date == null ||
				fields.to_date == null ||
				fields.destination_from == null ||
				fields.destination_to == null ||
				fields.available_from == null ||
				fields.expires_on == null
			)
				refuse('Carry-forward needs source and destination windows with validity dates.');
			const source: LeaveWindow = { start: fields.from_date, end: fields.to_date };
			const destination: LeaveWindow = {
				start: fields.destination_from,
				end: fields.destination_to
			};
			assertLeaveWindow(destination, rules.catalogueOn(fields.available_from).entitlement);
			if (
				destination.start <= source.end ||
				fields.available_from < destination.start ||
				fields.expires_on > destination.end ||
				fields.available_from > fields.expires_on
			)
				refuse(
					'Carry-forward needs a later destination window and validity dates inside that window.'
				);
			if (fields.days == null || !(fields.days > 0))
				refuse('A carry-forward moves a positive number of days.');
			debit(source, source.end, fields.days, 'earned');
			break;
		}
		case 'ADJUSTMENT': {
			if (fields.from_date == null || fields.to_date == null)
				refuse('A leave adjustment needs its stated window.');
			const window: LeaveWindow = { start: fields.from_date, end: fields.to_date };
			if (fields.effective_on == null)
				refuse('A leave adjustment must fall inside its stated window.');
			assertLeaveWindow(window, rules.catalogueOn(fields.effective_on).entitlement);
			if (!fields.reason?.trim()) refuse('A leave adjustment needs a reason.');
			if (fields.effective_on < window.start || fields.effective_on > window.end)
				refuse('A leave adjustment must fall inside its stated window.');
			if (fields.days == null || !Number.isFinite(fields.days) || fields.days === 0)
				refuse('A leave adjustment must change the balance.');
			if (fields.days < 0) debit(window, fields.effective_on, -fields.days, 'available');
			else
				allocations.push({
					window,
					date: fields.effective_on,
					days: fields.days,
					credit_entry_id: null
				});
			break;
		}
		case 'REVERSAL': {
			if (
				(input.charges?.length ?? 0) > 0 ||
				fields.encash_days != null ||
				fields.destination_from != null ||
				fields.destination_to != null
			)
				refuse('A reversal cannot also carry charges, encashed days or a carry destination.');
			const originalId = fields.reversal_of_id;
			const original = sameLeave.find((row) => row.id === originalId && row.approval_id == null);
			if (!original)
				refuse('A reversal must reference an approved entry for this employment and leave type.');
			if (
				sameLeave.some(
					(row) => row.as_adjustment_entry === true && row.reversal_of_id === originalId
				)
			)
				refuse('This leave entry is already reversed or has a pending reversal.');
			if (!fields.reason?.trim()) refuse('A reversal needs a reason.');
			const originalDate = activityDateOf(original);
			if (
				fields.effective_on == null ||
				(originalDate != null && fields.effective_on < originalDate)
			)
				refuse('A reversal cannot precede its original activity.');
			let currency: string | null = null;
			let total = 0n;
			if (original.payslip_id != null) {
				// This person's own payslip. Payment is per slip, so a colleague still waiting on a
				// correction no longer holds this reversal — the run reading DRAFT because of them
				// used to refuse a reversal whose money had in fact been paid.
				const payslip = context.payslips.find((row) => row.id === original.payslip_id);
				if (payslip == null || payslip.paid_at == null)
					refuse('Delete or settle the draft payroll holding this leave before reversing it.');
				// The settled lines are the frozen evidence, so the
				// reversal negates the gross it reads back off the payslip the entry is pinned to.
				for (const line of payslip.adjustments) {
					if (line.family !== 'LEAVE' || line.source_id !== original.id) continue;
					if (currency != null && currency !== payslip.currency)
						refuse('Leave captures use inconsistent currencies.');
					currency = payslip.currency;
					total += toMinorUnits(
						line.bucket === 'ABSENCE' ? -line.amount : line.amount,
						payslip.currency
					);
				}
			}
			const gross =
				currency == null || total === 0n
					? null
					: { value: fromMinorUnits(-total, currency), currency };
			if (gross != null && (fields.due_on == null || fields.due_on < fields.effective_on))
				refuse('A paid leave correction needs a due date on or after its effective date.');
			allocations.push(...reverseLeaveAllocations(original));
			const originalActivity = leaveActivityOf(original);
			const days =
				originalActivity === 'TIME_OFF'
					? original.days
					: originalActivity === 'REVERSAL'
						? null
						: Math.abs(original.days ?? 0);
			fields = {
				...fields,
				days,
				due_on: gross == null ? null : fields.due_on
			};
			break;
		}
	}
	const windows = [...new Map(allocations.map((row) => [row.window.start, row.window])).values()];
	assertLeaveBalanceIntegrity(
		[...sameLeave, { id, ...fields, allocations, approval_id: null }],
		windows,
		rules.entitlementAt
	);
	if (pools.pool != null)
		assertLeaveBalanceIntegrity(
			[
				...pools.pool.entries,
				{ id, ...fields, allocations, approval_id: null, leave_code: rules.selected.code }
			],
			windows,
			pools.pool.rules.entitlementAt,
			pools.pool.code
		);
	return {
		employment_id: input.employment_id,
		catalogue_id: rules.selected.id,
		leave_code: rules.selected.code,
		reference: input.reference,
		...fields,
		summary: leaveSummary(activity, fields),
		charges,
		allocations,
		// A planned entry is not settled: the payroll stamps the pin when it consumes the row.
		payslip_id: null,
		certificateRequired
	};
}

/**
 * The share of a day some hours of leave are: the hours over the shift's paid hours, to the
 * eighth (an hour of an eight-hour day), never more than the day. One day at a time: hourly
 * leave over a range is refused, because the hours name one shift.
 */
function hourlyShare(hours: number, range: HalfDayRange, variant: RosterCodeVariant): number {
	if (range.start.date !== range.end.date)
		refuse('Leave by the hour is taken one day at a time: name the day and its hours.');
	if (!Number.isFinite(hours) || hours <= 0) refuse('Leave by the hour needs the hours.');
	const paidHours = (workWindow(variant)?.paid_minutes ?? 480) / 60;
	return Math.min(1, Math.max(0.125, Math.round((hours / paidHours) * 8) / 8));
}

/** The record label the ledger and pickers read: the activity and the day it turns on. */
function leaveSummary(kind: LeaveActivityKind, fields: LeaveEntryActivity): string {
	return `${kind} · ${fields.from_date ?? fields.effective_on ?? ''}`;
}
