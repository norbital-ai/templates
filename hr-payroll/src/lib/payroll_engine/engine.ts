import { is_plain_date } from '@norbital-ai/std/date';
import type { JsonObject, Lookup, Party, Direction, Rounding, Unit } from './contracts.js';
import { lookupOf, settingsConstants } from './contracts.js';
import { contextRoots, evaluate } from './expressions.js';
import { programOf } from './programs.js';
import { Refusal, daysIn, isJsonObject, leaveEntry } from './foundation.js';
import { rounded } from './money.js';
import { accountsOf, eventOn, eventsOf, periodOn } from '../ledger/core.js';

export interface PayLine {
	readonly code: string;
	readonly label: string;
	readonly subtotal_id: string;
	readonly amount: number;
	readonly direction: Direction;
	readonly party: Party;
	readonly incurred_on: string;
	readonly coverage: { readonly from: string; readonly to: string };
	readonly quantity?: number;
	readonly unit?: Unit;
	readonly rate_code?: string;
	readonly source_id: { readonly model: string; readonly id: string };
}

export interface SubtotalResult {
	readonly id: string;
	readonly code: string;
	readonly name: string;
	readonly previous_id?: string | null;
	value: number;
}

export interface StatutoryResult {
	readonly code: string;
	readonly kind: string;
	readonly employee: number;
	readonly employer: number;
	readonly employee_ytd: number;
	readonly employer_ytd: number;
}

export interface ProjectedDay {
	readonly date: string;
	readonly work: boolean;
}

export interface PayrollInput {
	readonly run: JsonObject;
	readonly settings: JsonObject;
	readonly subtotals: readonly JsonObject[];
	readonly allowance: readonly JsonObject[];
	readonly overtime: readonly JsonObject[];
	readonly statutory: readonly JsonObject[];
	readonly leave_catalog: readonly JsonObject[];
	readonly claim_catalog: readonly JsonObject[];
	readonly adhoc_catalog: readonly JsonObject[];
	readonly loan_catalog: readonly JsonObject[];
	readonly employee: JsonObject;
	readonly employment: JsonObject;
	readonly employer: JsonObject;
	readonly balance: JsonObject;
	readonly entries: Readonly<Record<string, readonly JsonObject[]>>;
	/** Dated work events applicable to this employment, entity-wide and employment-specific. */
	readonly work_events?: readonly JsonObject[];
	readonly work?: { readonly days: readonly JsonObject[] };
	/** The person's contracts, whichever one pays: days outside all of them were never owed. */
	/** The person's contract versions: their days, and the terms each was agreed on. */
	readonly employed?: readonly {
		readonly from: string;
		readonly to: string | null;
		readonly terms?: JsonObject | null;
	}[];
	/** The person's pattern over the salary and attendance periods. */
	readonly projected_days?: readonly ProjectedDay[];
	/**
	 * Pay this run carries for earlier periods, by checkpoint code, signed. A scheme assessed in the month paid counts it
	 * as this month's wages; every other scheme was worked out again for the month it was earned.
	 */
	readonly carried?: Readonly<Record<string, number>>;
}

/** Overtime a run owes as time off: its hours, on the leave row that takes them, in the window of the day worked. */
export interface TimeOff {
	readonly code: string;
	readonly period: string;
	readonly hours: number;
	readonly on: string;
}

export interface PayrollResult {
	readonly lines: readonly PayLine[];
	readonly subtotals: readonly SubtotalResult[];
	readonly statutory: readonly StatutoryResult[];
	readonly time_off: readonly TimeOff[];
	readonly net_pay: number;
	readonly employer_cost: number;
}

const text = (row: JsonObject, key: string): string => {
	const value = row[key];
	if (typeof value !== 'string' || value.length === 0)
		throw new Refusal({ message: `${key}: required text.` });
	return value;
};
const number = (value: unknown, field: string): number => {
	if (typeof value !== 'number' || !Number.isFinite(value))
		throw new Refusal({ message: `${field}: expected a finite number.` });
	return value;
};
const amount = (value: unknown, field: string): number => {
	const result = number(value, field);
	if (result < 0) throw new Refusal({ message: `${field}: amount must be nonnegative.` });
	return result;
};
const id = (row: JsonObject): string => text(row, 'id');
const period = (run: JsonObject): { from: string; to: string } => {
	const coverage = run.salary_coverage;
	if (coverage === null || typeof coverage !== 'object' || Array.isArray(coverage))
		throw new Refusal({ message: 'Payroll requires an explicit salary coverage period.' });
	const value = coverage as JsonObject;
	const from = value.from,
		to = value.to;
	if (!is_plain_date(from) || !is_plain_date(to))
		throw new Refusal({ message: 'Salary coverage requires actual dates.' });
	return { from, to };
};
// one map a catalogue, not one for every person it prices
const catalogMaps = new WeakMap<readonly JsonObject[], ReadonlyMap<string, JsonObject>>();
const catalogById = (rows: readonly JsonObject[]): ReadonlyMap<string, JsonObject> => {
	const held = catalogMaps.get(rows);
	if (held !== undefined) return held;
	const made = new Map(rows.map((row) => [id(row), row]));
	catalogMaps.set(rows, made);
	return made;
};

/** The configured chain is the whole execution plan: no implicit BASE/EARNINGS/NET stages. */
export function subtotalChain(rows: readonly JsonObject[]): readonly JsonObject[] {
	const byId = new Map(rows.map((row) => [id(row), row]));
	const next = new Map<string, JsonObject>();
	for (const row of rows) {
		const previous = row.previous_id;
		if (previous == null) continue;
		if (typeof previous !== 'string' || !byId.has(previous))
			throw new Refusal({ message: `${text(row, 'code')}: predecessor is missing.` });
		if (next.has(previous))
			throw new Refusal({ message: 'Subtotals must form one linear chain, not a branch.' });
		next.set(previous, row);
	}
	const first = rows.filter((row) => row.previous_id == null);
	if (rows.length > 0 && first.length !== 1)
		throw new Refusal({ message: 'A subtotal chain needs exactly one first checkpoint.' });
	const ordered: JsonObject[] = [];
	let current = first[0];
	const seen = new Set<string>();
	while (current !== undefined) {
		const key = id(current);
		if (seen.has(key)) throw new Refusal({ message: 'Subtotal chain contains a cycle.' });
		seen.add(key);
		ordered.push(current);
		current = next.get(key);
	}
	if (ordered.length !== rows.length)
		throw new Refusal({ message: 'Subtotal chain is disconnected.' });
	return ordered;
}

/** Statutory dependencies are explicit scheme codes and only finalised results are visible. */
export function statutoryOrder(rows: readonly JsonObject[]): readonly JsonObject[] {
	const byCode = new Map(rows.map((row) => [text(row, 'code'), row]));
	const ordered: JsonObject[] = [];
	const visiting = new Set<string>();
	const done = new Set<string>();
	const visit = (code: string): void => {
		if (done.has(code)) return;
		const row = byCode.get(code);
		if (row === undefined) throw new Refusal({ message: `${code}: unknown statutory dependency.` });
		if (visiting.has(code)) throw new Refusal({ message: `${code}: statutory dependency cycle.` });
		visiting.add(code);
		for (const dependency of (row.depends_on ?? []) as readonly string[]) visit(dependency);
		visiting.delete(code);
		done.add(code);
		ordered.push(row);
	};
	for (const code of [...byCode.keys()].sort()) visit(code);
	return ordered;
}

const evaluateNumber = (
	source: unknown,
	context: object,
	field: string,
	roots?: readonly string[]
): number => {
	if (typeof source !== 'string' || source.trim() === '') return 0;
	return number(evaluate(source, 'CALCULATION', context, field, roots), field);
};
const eligible = (
	source: unknown,
	context: object,
	field: string,
	roots?: readonly string[]
): boolean => {
	if (typeof source !== 'string' || source.trim() === '') return true;
	const result = evaluate(source, 'CALCULATION', context, field, roots);
	if (typeof result !== 'boolean')
		throw new Refusal({ message: `${field}: must return a boolean.` });
	return result;
};
const ROUNDING_MODES: readonly Rounding['mode'][] = [
	'HALF_UP',
	'HALF_EVEN',
	'UP',
	'DOWN',
	'TRUNCATE'
];
/** Rounding is a settings field like any other constant. */
const rounding = (row: JsonObject): Rounding => {
	const settings = settingsConstants(row);
	const mode = ROUNDING_MODES.find((candidate) => candidate === settings.rounding) ?? 'HALF_UP';
	const scale =
		typeof settings.rounding_scale === 'number' &&
		Number.isInteger(settings.rounding_scale) &&
		settings.rounding_scale >= 0 &&
		settings.rounding_scale <= 12
			? settings.rounding_scale
			: 2;
	return { mode, scale };
};
const round = (settings: JsonObject, value: number): number => rounded(value, rounding(settings));

function line(input: {
	readonly code: string;
	readonly label: string;
	readonly subtotal: JsonObject;
	readonly amount: number;
	readonly direction?: Direction;
	readonly party?: Party;
	readonly incurred_on: string;
	readonly coverage: { from: string; to: string };
	readonly source: JsonObject;
	readonly model: string;
	readonly quantity?: number;
	readonly unit?: Unit;
	readonly rate_code?: string;
}): PayLine {
	return {
		code: input.code,
		label: input.label,
		subtotal_id: id(input.subtotal),
		amount: input.amount,
		direction: input.direction ?? 'ADD',
		party: input.party ?? 'EMPLOYEE',
		incurred_on: input.incurred_on,
		coverage: input.coverage,
		source_id: { model: input.model, id: id(input.source) },
		...(input.quantity === undefined ? {} : { quantity: input.quantity }),
		...(input.unit === undefined ? {} : { unit: input.unit }),
		...(input.rate_code === undefined ? {} : { rate_code: input.rate_code })
	};
}

const signed = (direction: Direction, amount: number): number =>
	direction === 'ADD' ? amount : -amount;

const unemployedDays = (input: PayrollInput, days: readonly string[]): number =>
	input.employed === undefined
		? 0
		: days.filter(
				(day) => !input.employed?.some(({ from, to }) => from <= day && (to === null || day <= to))
			).length;

type Slot = { readonly date: string; readonly part: string };
type SlotShare = (row: JsonObject, entry: JsonObject, slot: Slot) => number;
const slotsOf = (entry: JsonObject): readonly Slot[] =>
	(Array.isArray(entry.days) ? entry.days : []).flatMap((day) =>
		isJsonObject(day) && is_plain_date(day.date)
			? [{ date: String(day.date), part: String(day.part) }]
			: []
	);
/** A row whose `paid_share` is set: a slot of it may pay less than a normal day. */
export const sharesPay = (row: JsonObject): boolean =>
	typeof row.paid_share === 'string' && row.paid_share.trim() !== '';

/**
 * What one half-day slot of a leave row pays of a normal day: empty 1, a number as written, else its expression on the
 * slot. Always 0 to 1: what pays more than a normal day is a payout or overtime, never leave.
 */
export const paidShareOf = (row: JsonObject, context: () => object): number => {
	const source = row.paid_share;
	if (typeof source !== 'string' || source.trim() === '') return 1;
	const field = `${String(row.code)}.paid_share`;
	const constant = Number(source);
	const share = Number.isFinite(constant)
		? constant
		: number(
				evaluate(source, 'CALCULATION', context(), field, programOf('leave_catalog')?.roots),
				field
			);
	if (share < 0 || share > 1)
		throw new Refusal({
			message: `${field}: a leave day pays from 0 to 1 of a normal day, not ${share}. Pay more as a payout or overtime.`
		});
	return share;
};

/** Unpaid days by date: each leave slot's unpaid half day, `(1 − paid_share) / 2`, and days the roster marks ABS. */
const unpaidByDate = (input: PayrollInput, share: SlotShare): Map<string, number> => {
	const unpaid = new Map<string, number>();
	const add = (date: string, days: number) => unpaid.set(date, (unpaid.get(date) ?? 0) + days);
	const catalogs = catalogById(input.leave_catalog);
	for (const entry of input.entries.leave_catalog_entry ?? []) {
		const row = catalogs.get(String(entry.catalog_id));
		// an encashment takes no day off
		if (row === undefined || !sharesPay(row) || entry.encashment === true) continue;
		for (const slot of slotsOf(entry)) {
			const lost = (1 - share(row, entry, slot)) / 2;
			if (lost > 0) add(slot.date, lost);
		}
	}
	for (const day of input.work?.days ?? []) if (day.day_type === 'ABS') add(String(day.date), 1);
	return unpaid;
};

/** The person's days in a period: their pattern, or the employer's weekdays without one. */
const plannedDays = (
	input: PayrollInput,
	coverage: { from: string; to: string }
): readonly ProjectedDay[] => {
	if (input.projected_days !== undefined) return input.projected_days;
	const off = offDaysOf(input);
	return daysIn(coverage.from, coverage.to).map((date) => ({
		date: String(date),
		work: isWorkingDay(String(date), off)
	}));
};

/** A 30-day divisor prices every calendar day, so a missed day is one of the month's thirty. */
const dayRateCalendar = (input: PayrollInput): boolean => {
	const dayBasis = settingsConstants(input.settings).day_basis;
	const typed: JsonObject = isJsonObject(dayBasis) ? dayBasis : {};
	return typed.basis === 'FIXED' && Number(typed.days) === 30;
};

/** The days a period's share counts, by `proration_basis`: its calendar days, or the person's own working days. */
const basisDays = (
	input: PayrollInput,
	coverage: { from: string; to: string },
	basis: unknown
): readonly string[] => {
	const calendar = basis === 'CALENDAR_DAYS' || (basis === 'DAY_RATE' && dayRateCalendar(input));
	return calendar
		? daysIn(coverage.from, coverage.to)
		: plannedDays(input, coverage)
				.filter(({ date, work }) => work && date >= coverage.from && date <= coverage.to)
				.map(({ date }) => date);
};

/**
 * The basis days of the whole month a date falls in: calendar days, or the pattern's working days. Counted from the
 * pattern, since the run's projected days cover only its own window.
 */
const monthBasisCount = (input: PayrollInput, date: string, basis: unknown): number => {
	const month = monthBounds(date);
	const days = daysIn(month.from, month.to);
	if (basis === 'CALENDAR_DAYS' || (basis === 'DAY_RATE' && dayRateCalendar(input)))
		return days.length;
	const off = offDaysOf(input);
	return days.filter((day) => isWorkingDay(day, off)).length;
};

/**
 * A missed day is a day of its own month. Attendance runs behind the salary period, so a day missed late last month is
 * deducted here at that month's count of days: as days of this period, its month's count over the day's own.
 */
const ownMonthWeight = (
	input: PayrollInput,
	coverage: { from: string; to: string },
	basis: unknown,
	date: string
): number => {
	const paid = monthBounds(coverage.from);
	if (date >= paid.from && date <= paid.to) return 1;
	const own = monthBasisCount(input, date, basis);
	return own <= 0 ? 1 : monthBasisCount(input, paid.from, basis) / own;
};

/**
 * The share of a period someone is paid for, by the jurisdiction's `proration_basis`. Joiners, leavers,
 * the unpaid part of leave and ABS all pass through this one rule.
 */
const paidShare = (
	input: PayrollInput,
	coverage: { from: string; to: string },
	basis: unknown,
	unpaid: ReadonlyMap<string, number>
): number => {
	const counted = basisDays(input, coverage, basis);
	const unpaidDays = [...unpaid].reduce(
		(total, [date, value]) =>
			total + value * (basis === 'DAY_RATE' ? 1 : ownMonthWeight(input, coverage, basis, date)),
		0
	);
	const lost = unemployedDays(input, counted) + unpaidDays;
	// a missed day takes the statute's day rate, not a share of the period's days (PH 313/261, TW/TH ÷30, etc.)
	if (basis === 'DAY_RATE') {
		const { day_rate, month_wage } = payBasis(input, coverage);
		// the wage the coverage pays for: a half-month cycle pays half the month, so its day is that half's share
		const schedule = isJsonObject(input.employer.payment_schedule)
			? input.employer.payment_schedule
			: {};
		const frequency = String(schedule.frequency ?? 'MONTHLY');
		const parts = frequency === 'SEMI_MONTHLY' ? 2 : frequency === 'TEN_DAY' ? 3 : 1;
		const periodWage = month_wage / parts;
		return periodWage <= 0 ? 1 : Math.min(1, Math.max(0, 1 - (lost * day_rate) / periodWage));
	}
	return counted.length <= 0 ? 1 : Math.min(1, Math.max(0, counted.length - lost) / counted.length);
};

/**
 * The person's ordinary week: the employer's non-working weekdays, unless the contract agrees a different number of
 * usual days a week (a six-day shift, a four-day week); then the contract's week is the one the law counts.
 */
export const offDaysOf = (input: PayrollInput): readonly number[] =>
	offDaysFor(isJsonObject(input.employment.terms) ? input.employment.terms : {}, input.employer);
export const offDaysFor = (terms: JsonObject, employer: JsonObject): readonly number[] => {
	const schedule = employer.payment_schedule;
	const scheduled =
		isJsonObject(schedule) && Array.isArray(schedule.non_working_weekdays)
			? schedule.non_working_weekdays.filter((day): day is number => typeof day === 'number')
			: [0, 6];
	const stated = terms.normal_days_per_week;
	if (
		typeof stated === 'number' &&
		Number.isInteger(stated) &&
		stated > 0 &&
		stated < 7 &&
		stated !== 7 - scheduled.length
	)
		return [0, 6, 5, 4, 3, 2, 1].slice(0, 7 - stated);
	return scheduled;
};
export const isWorkingDay = (date: string, off: readonly number[]): boolean =>
	!off.includes(new Date(`${date}T00:00:00Z`).getUTCDay());
/** The calendar month a date falls in. */
const monthBounds = (date: string): { from: string; to: string } => {
	const year = Number(date.slice(0, 4)),
		month = Number(date.slice(5, 7)),
		last = new Date(Date.UTC(year, month, 0)).getUTCDate(),
		head = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
	return { from: `${head}-01`, to: `${head}-${String(last).padStart(2, '0')}` };
};
const numeric = (value: unknown): number =>
	typeof value === 'number' && Number.isFinite(value) ? value : 0;
const fixedOf = (value: JsonObject, key: string, field: string): number => {
	const fixed = value[key];
	if (typeof fixed === 'number' && Number.isFinite(fixed) && fixed > 0) return fixed;
	throw new Refusal({ message: `${field}: FIXED needs a positive ${key}.` });
};
/** The contract's rate and the hours it is worked over; ordinary hours are terms, never jurisdiction law. */
const rateOf = (input: PayrollInput) => {
	const terms: JsonObject = isJsonObject(input.employment.terms) ? input.employment.terms : {};
	const rate = terms.rate;
	const hoursPerDay = amount(terms.normal_hours_per_day, 'terms.normal_hours_per_day');
	if (hoursPerDay <= 0)
		throw new Refusal({ message: 'terms.normal_hours_per_day must be more than 0.' });
	return {
		terms,
		amount: isJsonObject(rate) ? numeric(rate.amount) : 0,
		unit: isJsonObject(rate) && typeof rate.unit === 'string' ? rate.unit : 'MONTHLY',
		hoursPerDay,
		daysPerWeek: amount(terms.normal_days_per_week, 'terms.normal_days_per_week'),
		weeklyHours: amount(terms.normal_hours_per_week, 'terms.normal_hours_per_week')
	} as const;
};
/** The wage a day or hour rate divides: the contract salary plus the allowances its inclusion names. */
const includedAllowances = (input: PayrollInput, terms: JsonObject): number => {
	const rows = new Map(input.allowance.map((row) => [String(row.code), row]));
	const allowances = isJsonObject(terms.allowances) ? terms.allowances : {};
	let total = 0;
	for (const [code, value] of Object.entries(allowances)) {
		if (rows.get(code)?.include_in_rate !== true) continue;
		total += isJsonObject(value) ? numeric(value.amount) : numeric(value);
	}
	return total;
};
/**
 * The conversions a jurisdiction sets: its day basis (`CALENDAR_DAYS`, `WORKING_DAYS`, `YEAR` = 52 contract weeks,
 * `YEAR_REST_DAYS` = 365 − 52 rest days, `HOUR` = the hour rate × contract hours, or the FIXED arm's days) and its hour
 * basis (`CONTRACT_HOURS`, `CONTRACT_WEEKLY` = 52 contract weeks, or the FIXED arm's hours). The overtime hour is the
 * employer's `pay_methods.overtime_hour_basis` where it pays more than the jurisdiction's hour.
 */
export const payBasis = (input: PayrollInput, coverage: { from: string; to: string }) => {
	const { terms, amount: rate, unit, hoursPerDay, daysPerWeek, weeklyHours } = rateOf(input);
	const off = offDaysOf(input);
	const month = monthBounds(coverage.from);
	const monthDays = daysIn(month.from, month.to);
	const monthCalendar = monthDays.length;
	const monthWorking = monthDays.filter((date) => isWorkingDay(date, off)).length;
	const calendar_days = daysIn(coverage.from, coverage.to).length;
	const working_days = daysIn(coverage.from, coverage.to).filter((date) =>
		isWorkingDay(String(date), off)
	).length;
	const monthly =
		unit === 'DAILY'
			? rate * monthWorking
			: unit === 'HOURLY'
				? rate * monthWorking * hoursPerDay
				: rate;
	const month_wage = monthly + includedAllowances(input, terms);
	const settings = settingsConstants(input.settings);
	const typedDay: JsonObject = isJsonObject(settings.day_basis) ? settings.day_basis : {};
	const typedHour: JsonObject = isJsonObject(settings.hour_basis) ? settings.hour_basis : {};
	const dayKind = typeof typedDay.basis === 'string' ? typedDay.basis : undefined;
	const hourKind = typeof typedHour.basis === 'string' ? typedHour.basis : undefined;
	const fixedDay = dayKind === 'FIXED' ? fixedOf(typedDay, 'days', 'day_basis') : null;
	const fixedHour = hourKind === 'FIXED' ? fixedOf(typedHour, 'hours', 'hour_basis') : null;
	let hour_rate =
		// a daily or hourly contract's own rate is its day or hour, whatever the jurisdiction's monthly divisor
		unit === 'DAILY'
			? rate / hoursPerDay
			: unit === 'HOURLY'
				? rate
				: fixedHour === null
					? hourKind === 'CONTRACT_WEEKLY'
						? (month_wage * 12) / (52 * weeklyHours)
						: 0
					: month_wage / fixedHour;
	let day_rate =
		unit === 'DAILY'
			? rate
			: unit === 'HOURLY'
				? rate * hoursPerDay
				: dayKind === 'CALENDAR_DAYS'
					? month_wage / monthCalendar
					: dayKind === 'YEAR'
						? (month_wage * 12) / (52 * daysPerWeek)
						: dayKind === 'YEAR_REST_DAYS'
							? (month_wage * 12) / (365 - 52 * (7 - daysPerWeek))
							: dayKind === 'HOUR'
								? hour_rate * hoursPerDay
								: month_wage / (fixedDay ?? monthWorking);
	if (hour_rate === 0 && day_rate !== 0) hour_rate = day_rate / hoursPerDay;
	const methods = isJsonObject(input.employer.pay_methods) ? input.employer.pay_methods : {};
	// the listing rounds the hourly rate to the currency's minor unit before it multiplies hours
	const overtime_hour_rate = round(
		input.settings,
		methods.overtime_hour_basis === 'CONTRACT_WEEKLY' && unit === 'MONTHLY' && weeklyHours > 0
			? Math.max(hour_rate, (month_wage * 12) / (52 * weeklyHours))
			: hour_rate
	);
	return { month_wage, day_rate, hour_rate, overtime_hour_rate, calendar_days, working_days };
};
/** The contract salary of a period and the basis its share follows. */
function salaryOf(input: PayrollInput, coverage: { from: string; to: string }) {
	const { amount: rate, unit, hoursPerDay } = rateOf(input);
	const off = offDaysOf(input);
	const workingDays = daysIn(coverage.from, coverage.to).filter((date) =>
		isWorkingDay(String(date), off)
	).length;
	if (workingDays <= 0) throw new Refusal({ message: 'Working days must be positive.' });
	const hoursPerMonth = workingDays * hoursPerDay;
	return {
		amount: unit === 'DAILY' ? rate * workingDays : unit === 'HOURLY' ? rate * hoursPerMonth : rate,
		// a day or hour rate pays the days worked; only a salary follows the statute's basis
		basis:
			unit === 'DAILY' || unit === 'HOURLY'
				? 'WORKING_DAYS'
				: settingsConstants(input.settings).proration_basis
	} as const;
}

const heldBalance = (input: PayrollInput): JsonObject => {
	const account = input.balance.account;
	return isJsonObject(account) ? account : {};
};

/** One pure linear pass: inputs in, pay lines, checkpoint values, statutory YTD and ledger out. */
export function calculatePayroll(input: PayrollInput): PayrollResult {
	const chain = subtotalChain(input.subtotals);
	const coverage = period(input.run);
	const settingsLookup = lookupOf(input.settings);
	const balance = heldBalance(input);
	// expressions read service entitlement dates, not the latest contract's start
	const employment =
		typeof input.employment.service_started_on === 'string' &&
		isJsonObject(input.employment.effective_range)
			? {
					...input.employment,
					effective_range: {
						...input.employment.effective_range,
						from: input.employment.service_started_on
					}
				}
			: input.employment;
	const subject = { employee: input.employee, employment, employer: input.employer };
	const basis = payBasis(input, coverage);
	const salary = input.run.kind === 'OFF_CYCLE' ? undefined : salaryOf(input, coverage);
	// What depends on the month a day falls in is priced in that month, never in the run's attendance window: a day
	// worked carries the hour and day rate of the contract version it was worked under, worked out over its own month.
	const paidMonth = monthBounds(coverage.from);
	const ratesBy = new Map<string, { readonly hour_rate: number; readonly day_rate: number }>();
	const work = {
		days: (input.work?.days ?? []).map((day) => {
			const { terms: worked, ...rest } = day;
			const terms = isJsonObject(worked) ? worked : (input.employment.terms ?? null);
			const month = monthBounds(String(day.date));
			const key = `${month.from}${JSON.stringify(terms)}`;
			let rates = ratesBy.get(key);
			if (rates === undefined) {
				const own = payBasis(
					{ ...input, employment: { ...input.employment, terms } },
					month.from === paidMonth.from ? coverage : month
				);
				rates = { hour_rate: own.overtime_hour_rate, day_rate: own.day_rate };
				ratesBy.set(key, rates);
			}
			return { ...rest, ...rates };
		})
	};
	// the constants view: a row reads the jurisdiction's settings fields under ctx.lookup, then its own lookup
	const settingsView: Lookup = settingsConstants(input.settings);
	const leaveRows = catalogById(input.leave_catalog);
	const leaveUsed = accountsOf({ leave: input.balance.leave }).leave ?? {};
	const person = {
		scope: String(input.settings.code),
		started: String(
			input.employment.service_started_on ??
				(isJsonObject(input.employment.effective_range)
					? input.employment.effective_range.from
					: '')
		),
		events: eventsOf(input.employment)
	};
	const order = (slot: Slot) => `${slot.date}:${slot.part === 'PM' ? 1 : 0}`;
	/** Days of a row already used in a slot's window before it: what the balance holds less the days at or after it. */
	const usedBefore = (row: JsonObject, slot: Slot): number => {
		const code = String(row.code),
			lookup = lookupOf(row),
			period = periodOn(lookup, person, slot.date);
		// ponytail: a day posted after this run's window still counts as used; read those slots if a rule needs it exact
		const after = (input.entries.leave_catalog_entry ?? [])
			.filter((entry) => leaveRows.get(String(entry.catalog_id))?.code === code)
			.flatMap(slotsOf)
			.filter(
				(other) => order(other) >= order(slot) && periodOn(lookup, person, other.date) === period
			).length;
		return Math.max(0, (leaveUsed[code]?.[period]?.used ?? 0) - after / 2);
	};
	const shareOf: SlotShare = (row, entry, slot) =>
		paidShareOf(row, () => {
			const lookup = lookupOf(row);
			return {
				subject,
				entry: leaveEntry(entry),
				lookup: { ...settingsView, ...lookup },
				calendar_days: basis.calendar_days,
				working_days: basis.working_days,
				month_wage: basis.month_wage,
				day_rate: basis.day_rate,
				hour_rate: basis.hour_rate,
				work,
				work_events: input.work_events ?? [],
				run: input.run,
				as_of: slot.date,
				event: eventOn(lookup, person.events, slot.date) ?? null,
				...(contextRoots(String(row.paid_share)).has('used') ? { used: usedBefore(row, slot) } : {})
			};
		});
	const unpaid = unpaidByDate(input, shareOf);
	// the run's priced leave slots: a statutory base that counts a leave code's days reads them here
	const leave = (input.entries.leave_catalog_entry ?? []).flatMap((entry) => {
		const row = leaveRows.get(String(entry.catalog_id));
		if (row === undefined || entry.encashment === true) return [];
		const code = String(row.code);
		return slotsOf(entry).map((slot) => ({
			code,
			date: slot.date,
			part: slot.part,
			paid_share: shareOf(row, entry, slot)
		}));
	});
	// the share of the period paid, by the statute's basis: an allowance that reads it falls with the salary
	const paid_share = paidShare(input, coverage, settingsView.proration_basis, unpaid);
	const counted = salary === undefined ? [] : basisDays(input, coverage, salary.basis);
	const prorationDays = salary === undefined ? 0 : unemployedDays(input, counted);
	// a missed day is a share of the period's days (calendar or working, by the basis); only `DAY_RATE` prices it at
	// the statute's day rate. A half-month or ten-day cycle shares out its own part of the month's salary
	const frequency = String(
		(isJsonObject(input.employer.payment_schedule) ? input.employer.payment_schedule : {})
			.frequency ?? 'MONTHLY'
	);
	const unit =
		salary === undefined
			? 0
			: salary.basis === 'DAY_RATE' || counted.length === 0
				? // the statute's day rate holds the rated allowances; the salary's share of it is what a missed day takes
					payBasis(input, coverage).day_rate *
					(rateOf(input).unit === 'MONTHLY' && basis.month_wage > salary.amount && salary.amount > 0
						? salary.amount / basis.month_wage
						: 1)
				: salary.amount /
					(frequency === 'SEMI_MONTHLY' ? 2 : frequency === 'TEN_DAY' ? 3 : 1) /
					counted.length;
	// days not employed and absent days take no more than the period's basic: no checkpoint goes below zero
	const periodBasic =
		salary === undefined
			? 0
			: salary.amount / (frequency === 'SEMI_MONTHLY' ? 2 : frequency === 'TEN_DAY' ? 3 : 1);
	// a jurisdiction rounds a day's rate before it multiplies the days (`RATE`, the default) or only the amount (`AMOUNT`)
	const rateFirst = settingsConstants(input.settings).day_rate_rounding !== 'AMOUNT';
	const perDay = (value: number) => (rateFirst ? round(input.settings, value) : value);
	// a day not employed at the statute's day rate is priced as a no-pay day is: the rate to the minor unit, times the days
	// a version that starts inside the period: the period pays the first version's salary, and each later version adds
	// the difference of its day rate for its own days. The period's basic is the last version's, so the proration
	// gives back what that overstates.
	const dayPrice = (value: number) => (salary?.basis === 'DAY_RATE' ? perDay(value) : value);
	const inPeriod = (input.employed ?? [])
		.filter((version) => isJsonObject(version.terms))
		.map((version) => ({
			from: version.from,
			terms: isJsonObject(version.terms) ? version.terms : {},
			days: counted.filter(
				(day) => version.from <= day && (version.to === null || day <= version.to)
			).length
		}))
		.filter((version) => version.days > 0)
		.toSorted((a, b) => a.from.localeCompare(b.from));
	const [firstVersion] = inPeriod;
	const amountOf = (terms: JsonObject) =>
		salaryOf({ ...input, employment: { ...input.employment, terms } }, coverage).amount;
	const earlierTerms =
		salary === undefined || salary.amount <= 0 || firstVersion === undefined || inPeriod.length < 2
			? 0
			: (() => {
					const baseAmount = amountOf(firstVersion.terms);
					const baseDay = dayPrice((unit * baseAmount) / salary.amount);
					return (
						salary.amount -
						baseAmount -
						inPeriod
							.slice(1)
							.reduce(
								(total, version) =>
									total +
									version.days *
										(dayPrice((unit * amountOf(version.terms)) / salary.amount) - baseDay),
								0
							)
					);
				})();
	const proration_amount = Math.min(periodBasic, prorationDays * dayPrice(unit) + earlierTerms);
	// an absent day is a day of its own month, its rate to the minor unit like a no-pay day's
	const absent = (input.work?.days ?? [])
		.filter((day) => day.day_type === 'ABS')
		.reduce(
			(total, day) =>
				total +
				perDay(
					unit *
						(salary === undefined || salary.basis === 'DAY_RATE'
							? 1
							: ownMonthWeight(input, coverage, salary.basis, String(day.date)))
				),
			0
		);
	const abs_amount = Math.min(periodBasic - proration_amount, absent);
	// a no-pay day takes the same share of the salary: an allowance that reads `ctx.paid_share` loses its own share
	// on its own line, so the wage the day rate divides (allowances included) is not what the line deducts
	const nplUnit = unit;
	const base = (context: unknown, lookup: Lookup) => ({
		subject,
		lookup: { ...settingsView, ...lookup },
		allowance: input.allowance,
		balances: balance,
		base_pay: context,
		calendar_days: basis.calendar_days,
		working_days: basis.working_days,
		month_wage: basis.month_wage,
		day_rate: basis.day_rate,
		hour_rate: basis.hour_rate,
		paid_share,
		proration_amount,
		abs_amount,
		leave,
		work,
		work_events: input.work_events ?? [],
		run: input.run,
		as_of: coverage.to
	});
	const hasProrated = chain.some((row) => text(row, 'code') === 'PRORATED');
	const paidBasicRow = chain.find((row) => text(row, 'code') === 'PAID_BASIC');
	const paidBasicId = paidBasicRow === undefined ? undefined : id(paidBasicRow);
	const hasPaidBasic = paidBasicId !== undefined;
	const openingPay =
		salary === undefined
			? 0
			: hasProrated
				? salary.amount
				: salary.amount * paidShare(input, coverage, salary.basis, unpaid);
	const lines: PayLine[] = [];
	// what this run's ad hoc entries post to an account (`CODE.side`), such as a benefit in kind a tax row counts
	const posted: Record<string, Record<string, number>> = {};
	// leave paid out in money by this run (a cash-out at exit or on request): a levy that stops at wages reads it
	let encashment = 0;
	const values = new Map<string, number>();
	const results: SubtotalResult[] = [];
	const computedBy = new Map<string, number>();
	const baseSubtotal = chain[0];
	if (baseSubtotal === undefined) throw new Refusal({ message: 'A payroll run needs subtotals.' });

	for (const subtotal of chain) {
		const code = text(subtotal, 'code');
		const previous = subtotal.previous_id;
		const previousValue = typeof previous === 'string' ? (values.get(previous) ?? 0) : 0;
		const baseContext = {
			...base(previousValue, settingsLookup),
			subtotals: Object.fromEntries(results.map((r) => [r.code, r.value]))
		};
		const computed =
			chain.indexOf(subtotal) === 0 && subtotal.calculation == null
				? openingPay
				: evaluateNumber(
						subtotal.calculation,
						chain.indexOf(subtotal) === 0 ? { ...baseContext, base_pay: openingPay } : baseContext,
						`${code}.calculation`
					);
		computedBy.set(id(subtotal), computed);
		if (computed !== 0)
			lines.push(
				line({
					code,
					label: text(subtotal, 'name'),
					subtotal,
					amount: Math.abs(computed),
					direction: computed < 0 ? 'DEDUCT' : 'ADD',
					incurred_on: coverage.from,
					coverage,
					source: input.employment,
					model: 'employee_contract'
				})
			);
		const subtotalLines: PayLine[] = [];
		const producers = [...input.allowance, ...input.overtime].filter(
			(row) => row.subtotal_id === id(subtotal) && input.run.kind !== 'OFF_CYCLE'
		);
		for (const producer of producers) {
			const code = text(producer, 'code');
			const lookup = lookupOf(producer);
			const model = input.allowance.includes(producer) ? 'allowance_catalog' : 'overtime_catalog';
			const roots = programOf(model)?.roots;
			const context = {
				...base(previousValue + computed, lookup),
				...(model === 'overtime_catalog' ? { hour_rate: basis.overtime_hour_rate } : {}),
				subtotals: Object.fromEntries(results.map((r) => [r.code, r.value]))
			};
			if (!eligible(producer.eligibility, context, `${code}.eligibility`, roots)) continue;
			// an overtime row prices the days at their own rates: one evaluation for each rate the window holds
			const byRate = Map.groupBy(
				work.days,
				(day) => `${String(day.hour_rate)}/${String(day.day_rate)}`
			);
			const value =
				model !== 'overtime_catalog' || byRate.size === 0
					? evaluateNumber(producer.conversion, context, `${code}.conversion`, roots)
					: [...byRate.values()].reduce((total, days) => {
							const [first] = days;
							return (
								total +
								evaluateNumber(
									producer.conversion,
									{
										...context,
										hour_rate: Number(first?.hour_rate),
										day_rate: Number(first?.day_rate),
										work: { days }
									},
									`${code}.conversion`,
									roots
								)
							);
						}, 0);
			if (value === 0) continue;
			subtotalLines.push(
				line({
					code,
					label: text(producer, 'code'),
					subtotal,
					amount: round(input.settings, value),
					direction:
						model === 'overtime_catalog' ? ((producer.direction as Direction) ?? 'ADD') : 'ADD',
					incurred_on: coverage.to,
					coverage,
					source: producer,
					model
				})
			);
		}

		const catalogs = [
			{
				rows: input.leave_catalog,
				entries: input.entries.leave_catalog_entry ?? [],
				model: 'leave_catalog',
				entryModel: 'leave_catalog_entry'
			},
			{
				rows: input.claim_catalog,
				entries: input.entries.claim_catalog_entry ?? [],
				model: 'claim_catalog',
				entryModel: 'claim_catalog_entry'
			},
			{
				rows: input.adhoc_catalog,
				entries: input.entries.adhoc_catalog_entry ?? [],
				model: 'adhoc_catalog',
				entryModel: 'adhoc_catalog_entry'
			}
		] as const;
		for (const group of catalogs) {
			const byId = catalogById(group.rows);
			for (const raw of group.entries) {
				// a posted entry already reached a finalised payslip: never pay it again
				if (raw.payroll_run_id != null) continue;
				const entry = group.model === 'leave_catalog' ? leaveEntry(raw) : raw;
				const catalog = byId.get(String(entry.catalog_id));
				if (catalog === undefined) continue;
				// unpaid days come off the basic whatever the row's own subtotal (that one takes its payout): a statutory
				// base reads the reduced amount, never a deduction after it
				const home =
					group.model === 'leave_catalog' && entry.encashment !== true && paidBasicId !== undefined
						? paidBasicId
						: catalog.subtotal_id;
				if (home !== id(subtotal)) continue;
				if (
					input.run.kind === 'OFF_CYCLE' &&
					(group.model !== 'adhoc_catalog' || catalog.off_cycle_eligible !== true)
				)
					continue;
				const code = text(catalog, 'code');
				const leave = group.model === 'leave_catalog';
				// a no-pay leave posts its unpaid amount as the catalog line
				if (leave && entry.encashment !== true && hasPaidBasic) {
					const slots = slotsOf(entry);
					// the day's rate to the currency's minor unit, then each date's own share of it, rounded: as a payroll
					// clerk prices it (a half day is half the rounded rate, to the minor unit)
					const unpaidOn = new Map<string, number>();
					for (const slot of slots)
						unpaidOn.set(
							slot.date,
							(unpaidOn.get(slot.date) ?? 0) + (1 - shareOf(catalog, entry, slot)) / 2
						);
					const unpaidAmount = [...unpaidOn].reduce(
						(total, [date, share]) =>
							total +
							// the statute's own day rate is shared out before it is rounded (half a day is half the rate); a
							// month's day count gives a rate that is rounded first, then shared
							perDay(
								settingsView.proration_basis === 'DAY_RATE'
									? share * nplUnit
									: share *
											perDay(
												nplUnit *
													(settingsView.proration_basis === 'CALENDAR_DAYS'
														? ownMonthWeight(input, coverage, 'CALENDAR_DAYS', date)
														: 1)
											)
							),
						0
					);
					// no-pay days take what the basic still holds, never more
					const room = Math.max(
						0,
						previousValue +
							computed +
							subtotalLines.reduce((total, l) => total + signed(l.direction, l.amount), 0)
					);
					if (unpaidAmount > 0 && room > 0)
						subtotalLines.push(
							line({
								code,
								label: text(catalog, 'code'),
								subtotal,
								amount: round(input.settings, Math.min(unpaidAmount, room)),
								direction: 'DEDUCT',
								party: 'EMPLOYEE',
								incurred_on: String(entry.incurred_on ?? coverage.to),
								coverage,
								source: entry,
								model: group.entryModel,
								quantity: slots.length / 2,
								unit: 'DAY'
							})
						);
					continue;
				}
				// leave taken prices no line of its own: only its unpaid part, above, and a cash-out, below
				if (leave && entry.encashment !== true) continue;
				const lookup = lookupOf(catalog);
				const context = {
					...base(previousValue + computed, lookup),
					entry,
					subtotals: Object.fromEntries(results.map((r) => [r.code, r.value]))
				};
				const roots = programOf(group.model)?.roots;
				if (!eligible(catalog.eligibility, context, `${code}.eligibility`, roots)) continue;
				// a cash-out takes no day off and pays its row's payout
				const field = leave ? 'payout' : 'conversion';
				const value = evaluateNumber(catalog[field], context, `${code}.${field}`, roots);
				// only adhoc states a direction and a party; a quantity below zero flips its line
				// leave taken beyond what the last day earned is taken back at the row's own payout
				const net =
					(group.model === 'adhoc_catalog' && catalog.direction === 'DEDUCT') ||
					(leave && entry.take_back === true)
						? -value
						: value;
				const paid = round(input.settings, Math.abs(net));
				if (paid === 0) continue;
				if (leave && entry.encashment === true) encashment += net;
				if (group.model === 'adhoc_catalog' && Array.isArray(lookup.accounts))
					for (const account of lookup.accounts)
						if (
							isJsonObject(account) &&
							account.account === 'statutory' &&
							account.measure === 'paid' &&
							account.period === undefined
						) {
							const [scheme = '', side = ''] = String(account.code).split('.');
							const sign = (account.operation === 'DEDUCT' ? -1 : 1) * (value < 0 ? -1 : 1);
							const held = (posted[scheme] ??= {});
							held[side] = (held[side] ?? 0) + sign * paid;
						}
				subtotalLines.push(
					line({
						code,
						label: text(catalog, 'code'),
						subtotal,
						amount: paid,
						direction: net < 0 ? 'DEDUCT' : 'ADD',
						party:
							group.model === 'adhoc_catalog'
								? ((catalog.party as Party) ?? 'EMPLOYEE')
								: 'EMPLOYEE',
						incurred_on: String(entry.incurred_on ?? coverage.to),
						coverage,
						source: entry,
						model: group.entryModel,
						...(typeof entry.quantity === 'number' ? { quantity: entry.quantity } : {}),
						...(entry.unit === undefined ? {} : { unit: entry.unit as Unit })
					})
				);
			}
		}

		const loanCatalog = catalogById(input.loan_catalog);
		for (const repayment of input.entries.loan_catalog_entry_repayment ?? []) {
			if (repayment.payroll_run_id != null) continue;
			// an instalment is due in the run that covers its date; a later month's stays open
			if (repayment.paid_on != null && String(repayment.paid_on) > coverage.to) continue;
			const loan = (input.entries.loan_catalog_entry ?? []).find(
				(row) => id(row) === repayment.loan_id
			);
			const catalog = loan === undefined ? undefined : loanCatalog.get(String(loan.catalog_id));
			// a loan entry keeps its original catalog across a settings-version cutover; its stored subtotal id
			// belongs to that version, so resolve the current chain's NET row when that id is not in this chain
			const loanSubtotal =
				catalog === undefined
					? undefined
					: (chain.find((row) => id(row) === String(catalog.subtotal_id)) ??
						chain.find((row) => String(row.code) === 'NET'));
			if (catalog === undefined || loanSubtotal === undefined || id(loanSubtotal) !== id(subtotal))
				continue;
			// loan recovery is on-cycle only; off-cycle runs pay one-off adjustments, not instalments
			if (input.run.kind === 'OFF_CYCLE') continue;
			const value = amount(repayment.amount ?? 0, 'repayment.amount');
			if (value === 0) continue;
			subtotalLines.push(
				line({
					code: text(catalog, 'code'),
					label: text(catalog, 'code'),
					subtotal,
					amount: round(input.settings, value),
					direction: 'DEDUCT',
					party: 'EMPLOYEE',
					incurred_on: String(repayment.paid_on ?? coverage.to),
					coverage,
					source: repayment,
					model: 'loan_catalog_entry_repayment',
					quantity: value,
					unit: 'MONEY'
				})
			);
		}

		const value = round(
			input.settings,
			previousValue +
				computed +
				subtotalLines.reduce((total, l) => total + signed(l.direction, l.amount), 0)
		);
		values.set(id(subtotal), value);
		results.push({
			id: id(subtotal),
			code,
			name: text(subtotal, 'name'),
			previous_id: (subtotal.previous_id as string | null | undefined) ?? null,
			value
		});
		lines.push(...subtotalLines);
	}

	const statutory: StatutoryResult[] = [];
	const statutoryValues: Record<string, { employee: number; employer: number }> = {};
	// carried pay enters the chain where it was earned: its checkpoint and every one after it
	let carriedSoFar = 0;
	const withCarried = new Map(
		results.map((r) => {
			carriedSoFar += input.carried?.[r.code] ?? 0;
			return [r.id, r.value + carriedSoFar] as const;
		})
	);
	for (const scheme of statutoryOrder(input.statutory)) {
		const code = text(scheme, 'code');
		const subtotal = chain.find((row) => id(row) === scheme.subtotal_id);
		if (subtotal === undefined)
			throw new Refusal({ message: `${code}: its subtotal is not in this version.` });
		const lookup = lookupOf(scheme);
		const paidMonth = scheme.assessed === 'PAID' && input.carried !== undefined;
		const context = {
			...base((paidMonth ? withCarried : values).get(id(subtotal)) ?? 0, lookup),
			subtotals: Object.fromEntries(
				results.map((r) => [r.code, paidMonth ? (withCarried.get(r.id) ?? r.value) : r.value])
			),
			statutory: statutoryValues,
			posted,
			encashment,
			overtime: lines
				.filter((row) => row.source_id.model === 'overtime_catalog')
				.reduce((total, row) => total + row.amount, 0)
		};
		const roots = programOf('statutory_contribution_catalog')?.roots;
		if (!eligible(scheme.eligibility, context, `${code}.eligibility`, roots)) continue;
		const owed = evaluateNumber(scheme.employee_amount, context, `${code}.employee_amount`, roots);
		// below zero a row refunds on this run where its statute has the employer repay; otherwise it stops at zero and carries
		const refunds = lookupOf(scheme).below_zero === 'REFUND' && owed < 0;
		const employee = refunds
			? -round(input.settings, -owed)
			: round(input.settings, Math.max(0, owed));
		// the employer's share settles as the employee's does: a row that refunds gives back what an earlier run overcharged
		const employerOwed = evaluateNumber(
			scheme.employer_amount,
			context,
			`${code}.employer_amount`,
			roots
		);
		const employer =
			lookupOf(scheme).below_zero === 'REFUND' && employerOwed < 0
				? -round(input.settings, -employerOwed)
				: round(input.settings, amount(employerOwed, `${code}.employer_amount`));
		statutoryValues[code] = { employee, employer };
		const paid = isJsonObject(balance.statutory_contribution) ? balance.statutory_contribution : {};
		const employeeYtd = Number(paid[`${code}.employee`] ?? 0) + employee;
		const employerYtd = Number(paid[`${code}.employer`] ?? 0) + employer;
		statutory.push({
			code,
			kind: String(scheme.kind ?? 'CONTRIBUTION'),
			employee,
			employer,
			employee_ytd: employeeYtd,
			employer_ytd: employerYtd
		});
		const target = chain.find((row) => id(row) === subtotal.id);
		if (target !== undefined && employee !== 0)
			lines.push(
				line({
					code,
					label: text(scheme, 'code'),
					subtotal: target,
					amount: Math.abs(employee),
					direction: employee > 0 ? 'DEDUCT' : 'ADD',
					party: 'EMPLOYEE',
					incurred_on: coverage.to,
					coverage,
					source: scheme,
					model: 'statutory_contribution_catalog'
				})
			);
		const employerTarget = chain.find((row) => id(row) === scheme.employer_cost_subtotal_id);
		if (employerTarget !== undefined && employer !== 0)
			lines.push(
				line({
					code: `${code}_EMPLOYER`,
					label: `${text(scheme, 'code')} (employer)`,
					subtotal: employerTarget,
					amount: Math.abs(employer),
					direction: employer > 0 ? 'ADD' : 'DEDUCT',
					party: 'EMPLOYER',
					incurred_on: coverage.to,
					coverage,
					source: scheme,
					model: 'statutory_contribution_catalog'
				})
			);
	}
	// Statutory lines are producers too: the checkpoints add them up. Nothing is evaluated twice.
	const finalValues = new Map<string, number>();
	const finalResults: SubtotalResult[] = [];
	const linesBy = Map.groupBy(
		lines.filter((l) => l.party === 'EMPLOYEE' && l.source_id.model !== 'employee_contract'),
		(l) => l.subtotal_id
	);
	for (const subtotal of chain) {
		const previous = subtotal.previous_id;
		const previousValue = typeof previous === 'string' ? (finalValues.get(previous) ?? 0) : 0;
		const value = round(
			input.settings,
			previousValue +
				(computedBy.get(id(subtotal)) ?? 0) +
				(linesBy.get(id(subtotal)) ?? []).reduce(
					(total, l) => total + signed(l.direction, l.amount),
					0
				)
		);
		finalValues.set(id(subtotal), value);
		finalResults.push({
			id: id(subtotal),
			code: text(subtotal, 'code'),
			name: text(subtotal, 'name'),
			previous_id: (subtotal.previous_id as string | null | undefined) ?? null,
			value
		});
	}
	results.splice(0, results.length, ...finalResults);
	const net = results.at(-1)?.value ?? 0;
	if (net < 0 && lines.some((l) => l.source_id?.model === 'loan_catalog_entry_repayment'))
		throw new Refusal({
			message: `${String(input.employee.name ?? id(input.employee))}: loan recovery would leave net pay at ${net}; reduce the final repayment.`
		});
	const employerCost = lines
		.filter((l) => l.party === 'EMPLOYER')
		.reduce((total, l) => total + signed(l.direction, l.amount), 0);
	return {
		lines,
		subtotals: results,
		statutory,
		time_off: timeOffOf(input, person),
		net_pay: net,
		employer_cost: employerCost
	};
}

/**
 * The overtime a run's days took as time off (`time_off_hours`), owed by the hour on the one leave row of the law that
 * takes it (`overtime_as_time_off`), an hour-unit row (`unit: 'HOUR'`).
 */
const timeOffOf = (
	input: PayrollInput,
	person: Parameters<typeof periodOn>[1]
): readonly TimeOff[] => {
	const owed =
		input.run.kind === 'OFF_CYCLE'
			? []
			: (input.work?.days ?? []).filter((day) => Number(day.time_off_hours ?? 0) > 0);
	if (owed.length === 0) return [];
	// leave rows of every version are loaded (an old entry keeps its row): the run's own law names the taker
	const takers = input.leave_catalog.filter((row) => lookupOf(row).overtime_as_time_off === true);
	const own = takers.filter((row) => String(row.settings_id) === String(input.settings.id));
	const [taker, ...more] = own.length > 0 ? own : takers;
	if (taker === undefined || more.length > 0 || lookupOf(taker).unit !== 'HOUR')
		throw new Refusal({
			message:
				'Overtime taken as time off needs one leave row of this law that takes it (overtime_as_time_off), counted in hours (unit HOUR).'
		});
	return owed.map((day) => ({
		code: text(taker, 'code'),
		period: periodOn(lookupOf(taker), person, String(day.date)),
		hours: Number(day.time_off_hours),
		on: String(day.date)
	}));
};
