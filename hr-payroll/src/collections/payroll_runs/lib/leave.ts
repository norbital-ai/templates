/**
 * Leave balances, derived over one leave year.
 *
 * A balance is a bank statement for days: every movement is stored, and everything else is
 * arithmetic over the date. Accrual and expiry are pure functions and are never written. The one
 * figure that IS written is the carry-forward a leave year opens with: `process_leave_year` posts
 * it once as a `CARRY_FORWARD` event, with its cap and expiry applied, and nothing recomputes it.
 * A hire-date correction or a new sealed profile therefore moves this year's live entitlement and
 * leaves every posted carry exactly where HR left it.
 *
 * ```
 * balance(D) = carryInto(leaveYear(D))            the posted row; provisional one level back
 *            + accrued(leaveYearStart → D)         derived, month by month, this year only
 *            − expired(D)                          the carry still unspent on its expiry date
 *            + Σ ledger.days in the leave year     the stored movements
 * ```
 *
 * A year HR has not processed yet reads a *provisional* carry: last year's closing from last
 * year's posted row (or zero — never a second provisional level), capped by policy. The read is
 * bounded at two leave years and two posted rows for any tenure; nothing walks to the hire year.
 *
 * **The running total is rounded, never the monthly increment.** Rounding each month's 1.75 up to
 * 2.0 and summing twelve of them overstates a 21-day entitlement by three days; rounding the
 * cumulative figure is monotonic and lands exactly on the entitlement in December.
 *
 * Payroll itself reads none of this. It reads only the unpaid-leave movements in the attendance
 * window, because an unpaid day costs money whatever the balance says — a balance guard belongs at
 * request time, not at pay time (decision L9).
 */

import { Number as EffectNumber, Schema } from 'effect';
import type { WorkspaceRow } from '../$types.js';
import type { Configuration, Jurisdiction, LeaveType } from './configuration.js';
import {
	completedMonths,
	completedYears,
	dateKey,
	monthDays,
	monthKey,
	shiftPeriod,
	type IsoDate
} from './dates.js';
import { roundHalfDay } from './rounding.js';
import { coversDate } from './effective.js';
import type { PayrollWindow } from './period.js';
import { decodeNumber } from '@norbital-ai/std/json';

/** One child fact as the leave floor reads it: the employment's non-superseded rows. */
export type ChildFact = WorkspaceRow<'employee_children'>;

const LedgerRowSchema = Schema.Struct({
	id: Schema.String,
	leave_type_id: Schema.String,
	entry_date: Schema.String,
	/**
	 * Last calendar day the movement covers. TIME_OFF spans a range; a point movement repeats
	 * `entry_date`. Capture uses the span so a request that crosses a payroll window is read by
	 * both periods for the days each window holds.
	 */
	through_date: Schema.optionalKey(Schema.NullOr(Schema.String)),
	kind: Schema.NullOr(Schema.String),
	days: Schema.Number,
	source_id: Schema.NullOr(Schema.String),
	approval_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/** `CARRY_FORWARD` rows only: the leave year the carry opens and the day it lapses. */
	leave_year: Schema.optionalKey(Schema.NullOr(Schema.Number)),
	expires_on: Schema.optionalKey(Schema.NullOr(Schema.String))
});

/**
 * A ledger row as the database hands it back.
 *
 * `kind` is widened to `string | null` because a generated enum column is nullable whatever the
 * model declares. It is compared against the three known kinds rather than narrowed by assertion,
 * so an unrecognised value is simply not `TAKEN` and cannot silently become one.
 */
export type LedgerRow = Schema.Schema.Type<typeof LedgerRowSchema>;

/** `payroll` acts on settled rows only; a new request is checked against every row. */
const BalanceBasisSchema = Schema.Union([Schema.Literal('SETTLED'), Schema.Literal('PROJECTED')]);
type BalanceBasis = Schema.Schema.Type<typeof BalanceBasisSchema>;

/** The first day of the leave year a date falls in. */
export function leaveYearStart(date: IsoDate, startMonth: number): IsoDate {
	const month = EffectNumber.clamp({ minimum: 1, maximum: 12 })(Math.trunc(startMonth));
	const year = decodeNumber(date.slice(0, 4));
	const inThisYear = decodeNumber(date.slice(5, 7)) >= month;
	return `${inThisYear ? year : year - 1}-${String(month).padStart(2, '0')}-01`;
}

/** The label of the leave year a date falls in — its starting year. */
export function leaveYearOf(date: IsoDate, startMonth: number): number {
	return decodeNumber(leaveYearStart(date, startMonth).slice(0, 4));
}

/** One band of the company entitlement layers on a leave code — organisation or employee. */
type LeaveEntitlementLayer = NonNullable<LeaveType['entitlement']>['layers'][number];
type EmployeeLeaveEntitlementLayer = Extract<LeaveEntitlementLayer, { readonly level: 'EMPLOYEE' }>;

/** What `resolveEntitlement` needs: the leave code, the profile, the children facts and the dates. */
type ResolveEntitlementOptions = {
	readonly leaveType: LeaveType;
	/** The sealed statutory profile the leave type's `statutory_kind` floors against. */
	readonly profile: Jurisdiction;
	/** The employment's non-superseded child facts. */
	readonly children: readonly ChildFact[];
	readonly serviceMonths: number;
	readonly employmentId: EmployeeLeaveEntitlementLayer['employment_id'];
	readonly asOf: IsoDate;
};

/**
 * The statutory floor one profile kind states at a service age, scaled by the employee's children.
 *
 * The ladder band whose `band_from` is the highest one at or below the service months supplies the
 * base. Where the law scales by children (`per_child`), the employee's eligible children — under
 * the age limit as of the date, within the fact's legal span — add `per_child.days` each, capped by
 * `max_days`; a child-conditioned kind whose gate is not met (`eligible < min_children`) grants
 * nothing. `kind: null` on the leave type means no statute mandates it and the floor is absent.
 */
function statutoryLeaveFloor(
	profile: Jurisdiction,
	kind: string,
	children: readonly ChildFact[],
	serviceMonths: number,
	asOf: IsoDate
): number | null {
	const member = profile.statutory_leave.find((entry) => entry.kind === kind);
	if (member == null) return null;
	const ladderDays = member.ladder.reduce(
		(best, band) => (band.band_from <= serviceMonths ? Math.max(best, band.days) : best),
		0
	);
	if (member.per_child == null) return ladderDays;
	const eligible = eligibleChildren(children, member.per_child.age_limit, asOf);
	if (eligible < member.per_child.min_children) return 0;
	const scaled = ladderDays + member.per_child.days * eligible;
	return member.max_days == null ? scaled : Math.min(scaled, member.max_days);
}

/**
 * Entitlement in days for one leave code at a service age.
 *
 * Three layers collapse to `max(profile statutory floor, company ?? floor)`. The floor is a floor:
 * a company that mis-types maternity leave as 60 days still owes the statute's 98, so compliance
 * never depends on the customer configuring correctly.
 */
export function resolveEntitlement(options: ResolveEntitlementOptions): number {
	const entitlement = options.leaveType.entitlement;
	const kind = options.leaveType.statutory_kind;
	const statutory =
		kind == null
			? 0
			: (statutoryLeaveFloor(
					options.profile,
					kind,
					options.children,
					options.serviceMonths,
					options.asOf
				) ?? 0);
	const forLevel = (level: 'ORGANISATION' | 'EMPLOYEE'): number | null => {
		let best: { floor: number; days: number } | null = null;
		if (entitlement == null) return null;
		for (const layer of entitlement.layers) {
			if (layer.level !== level) continue;
			if (layer.level === 'EMPLOYEE' && layer.employment_id !== options.employmentId) continue;
			if (layer.band_from > options.serviceMonths) continue;
			if (best == null || layer.band_from > best.floor)
				best = { floor: layer.band_from, days: decodeNumber(layer.days) };
		}
		return best?.days ?? null;
	};
	const organisation = forLevel('ORGANISATION') ?? statutory;
	const employee = forLevel('EMPLOYEE') ?? organisation;
	return Math.max(statutory, organisation, employee);
}

/** How many of the employment's children are eligible for a child-scaled floor on a date. */
function eligibleChildren(children: readonly ChildFact[], ageLimit: number, asOf: IsoDate): number {
	return children.filter((child) => {
		if (child.supersedes_id != null) return false;
		if (child.effective_range != null && !coversDate(child.effective_range, asOf)) return false;
		const born = dateKey(child.child_birthdate);
		if (born == null) return false;
		return completedYears(born, asOf) < ageLimit;
	}).length;
}

/** The accrual window: the employment's leave profile plus the two dates it is asked over. */
type AccruedDaysOptions = Pick<
	BalanceInput,
	'leaveType' | 'entitlementAt' | 'hireDate' | 'exitDate'
> & {
	readonly leaveYearStart: IsoDate;
	readonly asOf: IsoDate;
};

/**
 * Days accrued between the leave-year start and a date.
 *
 * The band is read **at each month**, so someone crossing a service band in July accrues at the old
 * rate for the first half of the year and the new one for the second — and a mid-year joiner is
 * prorated for free, which is why there is no `prorate_on_hire` flag. A partial first or last month
 * counts pro rata by calendar days.
 */
export function accruedDays(options: AccruedDaysOptions): number {
	const accrual = options.leaveType.accrual;
	if (accrual == null)
		throw new Error(`Leave type ${options.leaveType.code} has no accrual and cannot be read.`);
	if (accrual.kind === 'PER_EVENT') return 0;

	const start =
		options.leaveYearStart > options.hireDate ? options.leaveYearStart : options.hireDate;
	const end =
		options.exitDate != null && options.exitDate < options.asOf ? options.exitDate : options.asOf;
	if (end < start) return 0;

	if (accrual.kind === 'UPFRONT') {
		// The whole entitlement exists from the start of the leave year. Upfront means upfront: it is
		// not re-prorated by hire date, which is both the plain meaning and the behaviour of record
		// (decision L8).
		return options.entitlementAt(completedMonths(options.hireDate, end), end);
	}

	let total = 0;
	for (let month = monthKey(start); month <= monthKey(end); month = shiftPeriod(month, 1)) {
		const monthStart = `${month}-01`;
		const monthLength = monthDays(monthStart);
		const from = monthStart > start ? monthStart : start;
		const lastDay = `${month}-${String(monthLength).padStart(2, '0')}`;
		const to = lastDay < end ? lastDay : end;
		if (to < from) continue;
		const coveredDays = decodeNumber(to.slice(8, 10)) - decodeNumber(from.slice(8, 10)) + 1;
		const entitlement = options.entitlementAt(completedMonths(options.hireDate, to), to);
		total += (entitlement / 12) * (coveredDays / monthLength);
	}
	return roundHalfDay(total);
}

/** The posted carry-forward is read by `carryInto`; it is never summed as a movement. */
const CARRY_KIND = 'CARRY_FORWARD';

/** Days moved by the ledger inside a window. */
function ledgerDays(
	rows: readonly LedgerRow[],
	leaveTypeId: string,
	window: { readonly start: IsoDate; readonly end: IsoDate },
	basis: BalanceBasis,
	kinds?: ReadonlySet<string>
): number {
	return rows.reduce((total, row) => {
		if (row.leave_type_id !== leaveTypeId) return total;
		if (row.kind === CARRY_KIND) return total;
		if (kinds != null && (row.kind == null || !kinds.has(row.kind))) return total;
		// A projection of the balance reads every row; payroll only acts on a settled one.
		if (basis !== 'PROJECTED' && row.approval_id != null) return total;
		const date = dateKey(row.entry_date);
		if (date == null || date < window.start || date > window.end) return total;
		return total + decodeNumber(row.days);
	}, 0);
}

export type BalanceInput = {
	readonly leaveType: LeaveType;
	/** The merged entitlement at a service age and a date — child scaling moves with the date. */
	readonly entitlementAt: (serviceMonths: number, asOf: IsoDate) => number;
	readonly hireDate: IsoDate;
	readonly exitDate: IsoDate | null;
	readonly leaveYearStartMonth: number;
	readonly ledger: readonly LedgerRow[];
	readonly basis: BalanceBasis;
};

/** The first and last day of a leave year. */
export function yearWindow(year: number, startMonth: number): { start: IsoDate; end: IsoDate } {
	const month = String(
		EffectNumber.clamp({ minimum: 1, maximum: 12 })(Math.trunc(startMonth))
	).padStart(2, '0');
	const start = `${year}-${month}-01`;
	const nextStart = `${year + 1}-${month}-01`;
	const end = new Date(Date.parse(`${nextStart}T00:00:00.000Z`) - 86_400_000)
		.toISOString()
		.slice(0, 10);
	return { start, end };
}

/**
 * The carry-forward a leave year opens with.
 *
 * - `POSTED`      — a `CARRY_FORWARD` row exists for the year; its days and expiry are the fact.
 * - `PROVISIONAL` — the year is not processed yet: last year's closing from last year's posted
 *                   row (or zero), capped by policy, with the policy's expiry. Spendable, labelled.
 * - `NONE`        — nothing can carry: the hire year, no carry policy, or a per-event type.
 */
type CarryIn = {
	readonly days: number;
	readonly expires_on: IsoDate | null;
	readonly state: 'POSTED' | 'PROVISIONAL' | 'NONE';
};

const NO_CARRY: CarryIn = { days: 0, expires_on: null, state: 'NONE' };

function carryPolicy(input: BalanceInput) {
	const accrual = input.leaveType.accrual;
	if (accrual == null || accrual.kind === 'PER_EVENT') return null;
	return accrual.carry;
}

/** The day this year's carry lapses under the company's policy, or null when it never does. */
export function policyCarryExpiry(input: BalanceInput, year: number): IsoDate | null {
	const carry = carryPolicy(input);
	if (carry == null || carry.expiry_months <= 0) return null;
	const window = yearWindow(year, input.leaveYearStartMonth);
	return `${shiftPeriod(monthKey(window.start), carry.expiry_months)}-01`;
}

function postedCarry(input: BalanceInput, year: number): LedgerRow | undefined {
	return input.ledger.find(
		(row) =>
			row.kind === CARRY_KIND &&
			row.leave_type_id === input.leaveType.id &&
			(row.leave_year ??
				leaveYearOf(dateKey(row.entry_date) ?? '0000-01-01', input.leaveYearStartMonth)) === year
	);
}

function postedCarryIn(input: BalanceInput, year: number): CarryIn | null {
	const posted = postedCarry(input, year);
	if (posted == null) return null;
	return {
		days: Math.max(0, decodeNumber(posted.days)),
		expires_on: posted.expires_on ?? null,
		state: 'POSTED'
	};
}

/**
 * Carried-in days that lapsed unused, measured on a date.
 *
 * Consumption is oldest-first — leave taken is charged against carried-in days before this year's
 * accrual — so only what the carry still holds on the expiry date is lost. Without oldest-first
 * this would remove days already spent, and the balance would be wrong by exactly what was taken
 * before the deadline.
 */
function expiredCarry(
	input: BalanceInput,
	carry: CarryIn,
	window: { readonly start: IsoDate; readonly end: IsoDate },
	asOf: IsoDate
): number {
	if (carry.days <= 0 || carry.expires_on == null || asOf < carry.expires_on) return 0;
	const takenBefore = -Math.min(
		0,
		ledgerDays(
			input.ledger,
			input.leaveType.id,
			{ start: window.start, end: carry.expires_on },
			'SETTLED'
		)
	);
	return Math.max(0, carry.days - takenBefore);
}

/** What one leave year closed with, as of its last day, from that year's posted carry or zero. */
type Closing = {
	readonly entitlement: number;
	readonly carried_in: number;
	readonly accrued: number;
	readonly adjusted: number;
	readonly taken: number;
	readonly encashed: number;
	readonly expired: number;
	readonly closing: number;
};

const TAKEN = new Set(['TAKEN']);
const ADJUSTED = new Set(['ADJUSTMENT']);
const ENCASHED = new Set(['ENCASHMENT']);

/**
 * The live formula as of the last day of `year`. This is what `process_leave_year` posts from, and
 * what a provisional carry reads. It reads the year's own posted row or zero — never a provisional
 * one — which is what keeps every balance read bounded at two leave years.
 */
export function closingBalance(input: BalanceInput, year: number): Closing {
	const window = yearWindow(year, input.leaveYearStartMonth);
	const carry = postedCarryIn(input, year) ?? NO_CARRY;
	const accrued = accruedDays({
		leaveType: input.leaveType,
		entitlementAt: input.entitlementAt,
		hireDate: input.hireDate,
		exitDate: input.exitDate,
		leaveYearStart: window.start,
		asOf: window.end
	});
	const expired = expiredCarry(input, carry, window, window.end);
	const type = input.leaveType.id;
	const taken = -Math.min(0, ledgerDays(input.ledger, type, window, 'SETTLED', TAKEN));
	const adjusted = ledgerDays(input.ledger, type, window, 'SETTLED', ADJUSTED);
	const encashed = -Math.min(0, ledgerDays(input.ledger, type, window, 'SETTLED', ENCASHED));
	const asOf = input.exitDate != null && input.exitDate < window.end ? input.exitDate : window.end;
	return {
		entitlement: input.entitlementAt(completedMonths(input.hireDate, asOf), asOf),
		carried_in: carry.days,
		accrued,
		adjusted,
		taken,
		encashed,
		expired,
		closing: carry.days + accrued - expired + adjusted - taken - encashed
	};
}

/** The carry-forward `year` opens with: posted, provisional, or none. */
export function carryInto(input: BalanceInput, year: number): CarryIn {
	const posted = postedCarryIn(input, year);
	if (posted != null) return posted;
	const carry = carryPolicy(input);
	if (carry == null) return NO_CARRY;
	if (year <= leaveYearOf(input.hireDate, input.leaveYearStartMonth)) return NO_CARRY;
	const closing = closingBalance(input, year - 1).closing;
	return {
		days: EffectNumber.clamp({ minimum: 0, maximum: carry.limit_days })(closing),
		expires_on: policyCarryExpiry(input, year),
		state: 'PROVISIONAL'
	};
}

/** Carried-in days that have lapsed by a date (the year's last day when none is given). */
export function expiredDays(input: BalanceInput, year: number, asOf?: IsoDate): number {
	const window = yearWindow(year, input.leaveYearStartMonth);
	return expiredCarry(input, carryInto(input, year), window, asOf ?? window.end);
}

/** The balance on a date: carry-in, accrual to date, expiry to date, and the year's movements. */
export function leaveBalance(input: BalanceInput, asOf: IsoDate): number {
	const year = leaveYearOf(asOf, input.leaveYearStartMonth);
	const window = yearWindow(year, input.leaveYearStartMonth);
	return (
		carryInto(input, year).days +
		accruedDays({
			leaveType: input.leaveType,
			entitlementAt: input.entitlementAt,
			hireDate: input.hireDate,
			exitDate: input.exitDate,
			leaveYearStart: window.start,
			asOf
		}) -
		expiredDays(input, year, asOf) +
		ledgerDays(input.ledger, input.leaveType.id, { start: window.start, end: asOf }, input.basis)
	);
}

/** The balance row an employee reads for one leave type: the standard HRMS breakdown. */
type LeaveYearSummary = {
	readonly year: number;
	readonly window: { readonly start: IsoDate; readonly end: IsoDate };
	/** The full-year band as of the date — the base. */
	readonly entitlement: number;
	/** Accrued between the year start and the date; equals the band for UPFRONT accrual. */
	readonly earned: number;
	readonly carry: CarryIn;
	readonly adjusted: number;
	/** Settled time off anywhere in the leave year, including days booked after the date. */
	readonly taken: number;
	/** Time off still awaiting approval, anywhere in the leave year. */
	readonly pending: number;
	readonly encashed: number;
	readonly expired: number;
	/** What can still be booked this year: carry + earned − expired + adjusted − taken − encashed. */
	readonly balance: number;
};

export function leaveYearSummary(input: BalanceInput, asOf: IsoDate): LeaveYearSummary {
	const year = leaveYearOf(asOf, input.leaveYearStartMonth);
	const window = yearWindow(year, input.leaveYearStartMonth);
	const type = input.leaveType.id;
	const carry = carryInto(input, year);
	const earned = accruedDays({
		leaveType: input.leaveType,
		entitlementAt: input.entitlementAt,
		hireDate: input.hireDate,
		exitDate: input.exitDate,
		leaveYearStart: window.start,
		asOf
	});
	const expired = expiredCarry(input, carry, window, asOf);
	const taken = -Math.min(0, ledgerDays(input.ledger, type, window, 'SETTLED', TAKEN));
	const projected = -Math.min(0, ledgerDays(input.ledger, type, window, 'PROJECTED', TAKEN));
	const adjusted = ledgerDays(input.ledger, type, window, 'SETTLED', ADJUSTED);
	const encashed = -Math.min(0, ledgerDays(input.ledger, type, window, 'SETTLED', ENCASHED));
	return {
		year,
		window,
		entitlement: input.entitlementAt(completedMonths(input.hireDate, asOf), asOf),
		earned,
		carry,
		adjusted,
		taken,
		pending: projected - taken,
		encashed,
		expired,
		balance: carry.days + earned - expired + adjusted - taken - encashed
	};
}

/**
 * One `leave_requests` row as the ledger reads it, from the columns every reader already selects.
 *
 * Time off is a debit: the generated `days` column stores the magnitude of a request, and the book
 * stores movements. Adjustments, encashments and carries carry their own signed movement; the carry
 * additionally names the year it opens and the day it lapses, which only its event knows.
 */
function ledgerRowOf(row: {
	readonly id: string;
	readonly leave_type_id: string;
	readonly kind: string | null;
	readonly from_date: string | Date | null;
	readonly days: unknown;
	readonly approval_id?: string | null;
	readonly event?: {
		readonly kind: string;
		readonly expires_on?: string | null;
		readonly leave_year?: number;
	} | null;
}): LedgerRow | null {
	const entryDate =
		row.from_date == null
			? null
			: dateKey(
					String(row.from_date instanceof Date ? row.from_date.toISOString() : row.from_date)
				);
	if (entryDate == null) return null;
	const magnitude = decodeNumber(row.days);
	const kind =
		row.kind === 'TIME_OFF' ? 'TAKEN' : row.kind === 'BALANCE_ADJUSTMENT' ? 'ADJUSTMENT' : row.kind;
	return {
		id: row.id,
		leave_type_id: row.leave_type_id,
		entry_date: entryDate,
		kind,
		days: kind === 'TAKEN' ? -Math.abs(magnitude) : magnitude,
		source_id: null,
		approval_id: row.approval_id ?? null,
		...(row.event?.kind === 'CARRY_FORWARD'
			? { leave_year: row.event.leave_year ?? null, expires_on: row.event.expires_on ?? null }
			: {})
	};
}

/** Unpaid leave taken inside the attendance window, grouped by the component that carries it. */
const UnpaidLeaveSchema = Schema.Struct({
	componentId: Schema.String,
	days: Schema.Number,
	/**
	 * The requests that caused it, each with the days it contributed.
	 *
	 * The days are carried per request rather than only in total because a `payslip_adjustments`
	 * row names exactly ONE source: an unpaid absence spanning three requests is three rows, and the
	 * amount the formula produced for the whole absence is apportioned across them by these days.
	 * Summing them back gives `days`, which is what the payslip's quantity has always been.
	 */
	requests: Schema.Array(Schema.Struct({ id: Schema.String, days: Schema.Number }))
});
export type UnpaidLeave = Schema.Schema.Type<typeof UnpaidLeaveSchema>;

/** Every unpaid day this employment has ever taken, in order — the input to a spell. */
export function unpaidLeaveDates(
	ledger: readonly LedgerRow[],
	leaveTypes: Configuration['leaveTypes']
): IsoDate[] {
	const unpaidTypeIds = new Set(
		leaveTypes.filter((type) => type.payroll_effect?.kind === 'UNPAID').map((t) => t.id)
	);
	const dates: IsoDate[] = [];
	for (const row of ledger) {
		if (row.kind !== 'TAKEN' || row.approval_id != null) continue;
		if (!unpaidTypeIds.has(row.leave_type_id)) continue;
		const date = dateKey(row.entry_date);
		if (date != null) dates.push(date);
	}
	return dates.toSorted();
}

/**
 * What `unpaidLeaveInWindow` selects against: the settled ledger, the attendance window and the
 * month the run pays for, over the picked leave types.
 */
type UnpaidLeaveInWindowOptions = {
	readonly ledger: readonly LedgerRow[];
	readonly window: PayrollWindow['salary'];
	readonly configuration: Pick<Configuration, 'leaveTypes'>;
	/** The calendar month this run pays for — where an extended absence's days settle. */
	readonly month?: PayrollWindow['salary'];
	/** Days belonging to an extended absence, from `extendedAbsenceDays`. */
	readonly extendedDates?: ReadonlySet<IsoDate>;
};

/**
 * The only thing payroll reads from leave.
 *
 * `leave_types.payroll_effect` names the deduction component that carries the lost wage. A paid
 * type moves the ledger and costs nothing; an unpaid one costs a day's wage per day, whatever the
 * balance says.
 *
 * **Which run pays for a day is a cutoff question, and it has two answers.** An ordinary unpaid day
 * settles in the run whose attendance window contains it — that is the pay calendar, and it lags by
 * up to a month. A day inside a *leave of absence* settles in the run for its own calendar month,
 * because a leave that begins on the 15th is felt in that month's pay rather than the next one's.
 * `extendedDates` is the set of days the second answer applies to, resolved by the caller from
 * `companies.settlement_policy`; passing an empty set is the plain calendar.
 *
 * The two selections are disjoint — a day is in `extendedDates` or it is not — so across the run
 * sequence every unpaid day is deducted exactly once. That is the invariant, and it is the reason
 * this is one predicate here rather than an adjustment somewhere later.
 */
export function unpaidLeaveInWindow(options: UnpaidLeaveInWindowOptions): UnpaidLeave[] {
	const typeById = new Map(options.configuration.leaveTypes.map((type) => [type.id, type]));
	const extended = options.extendedDates ?? new Set<IsoDate>();
	const month = options.month;
	const byComponent = new Map<string, { days: number; requests: Map<string, number> }>();
	for (const row of options.ledger) {
		if (row.kind !== 'TAKEN' || row.approval_id != null) continue;
		const date = dateKey(row.entry_date);
		if (date == null) continue;
		const settlesHere =
			extended.has(date) && month != null
				? date >= month.start && date <= month.end
				: date >= options.window.start && date <= options.window.end;
		if (!settlesHere) continue;
		const type = typeById.get(row.leave_type_id);
		if (!type) continue;
		const effect = type.payroll_effect;
		if (effect == null || effect.kind !== 'UNPAID') continue;
		const bucket = byComponent.get(effect.component_id) ?? {
			days: 0,
			requests: new Map<string, number>()
		};
		// A TAKEN row is negative; the deduction it causes is a magnitude.
		const days = Math.abs(decodeNumber(row.days));
		bucket.days += days;
		if (row.source_id != null)
			bucket.requests.set(row.source_id, (bucket.requests.get(row.source_id) ?? 0) + days);
		byComponent.set(effect.component_id, bucket);
	}
	return [...byComponent].map(([componentId, bucket]) => ({
		componentId,
		days: bucket.days,
		requests: [...bucket.requests].map(([id, days]) => ({ id, days }))
	}));
}
