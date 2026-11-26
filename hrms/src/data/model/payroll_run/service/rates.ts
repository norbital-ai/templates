import { BigDecimal, DateTime } from 'effect';
import type { JsonObject, Party, Direction, Rounding, Unit } from '../../../../lib/contracts.js';
import { ROUNDING_MODES as roundingModes, settingsConstants } from '../../../../lib/contracts.js';
import { evaluate } from '../../jurisdiction/service/expressions.js';
import { programOf } from '../../jurisdiction/service/programs.js';
import {
	Refusal,
	daysIn,
	isIsoDate,
	isJsonObject,
	monthEndOf
} from '../../../../lib/foundation.js';

export interface PayLine {
	readonly code: string;
	readonly label: string;
	/** The code of the subtotal the line posts to. */
	readonly subtotal: string;
	readonly amount: number;
	readonly direction: Direction;
	readonly party: Party;
	readonly incurred_on: string;
	readonly coverage: { readonly from: string; readonly to: string };
	readonly quantity?: number;
	readonly unit?: Unit;
	readonly rate_code?: string;
	readonly back_pay_period?: string;
	readonly source_id: { readonly model: string; readonly id: string };
}

/** One earlier-period earning delta owed in the signing period, preserving its original catalogue and subtotal. */
export interface BackPayLine {
	readonly code: string;
	readonly label: string;
	readonly subtotal: string;
	readonly amount: number;
	readonly direction: Direction;
	readonly party: Party;
	readonly source: string;
	readonly back_pay_period: string;
}

export interface SubtotalResult {
	readonly code: string;
	readonly name: string;
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
	/**
	 * Back-pay deltas owed in this signing period for earlier periods under later-signed terms, line by line with each
	 * item's own catalogue code, source and subtotal.
	 */
	readonly back_pay?: readonly BackPayLine[];
	/** Every scheduled non-holiday working day in this period's salary coverage is 100% unpaid (zero worked or paid-leave days). */
	readonly full_period_unpaid?: boolean;
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

export const text = (row: JsonObject, key: string): string => {
	const value = row[key];
	if (typeof value !== 'string' || value.length === 0)
		throw new Refusal({ message: `${key}: required text.` });
	return value;
};
export const number = (value: unknown, field: string): number => {
	if (typeof value !== 'number' || !Number.isFinite(value))
		throw new Refusal({ message: `${field}: expected a finite number.` });
	return value;
};
export const amount = (value: unknown, field: string): number => {
	const result = number(value, field);
	if (result < 0) throw new Refusal({ message: `${field}: amount must be nonnegative.` });
	return result;
};
export const id = (row: JsonObject): string => text(row, 'id');
export const period = (run: JsonObject): { from: string; to: string } => {
	const coverage = run.salary_coverage;
	if (!isJsonObject(coverage))
		throw new Refusal({ message: 'Payroll requires an explicit salary coverage period.' });
	const from = coverage.from,
		to = coverage.to;
	if (typeof from !== 'string' || typeof to !== 'string' || !isIsoDate(from) || !isIsoDate(to))
		throw new Refusal({ message: 'Salary coverage requires actual dates.' });
	return { from, to };
};
// one map a catalogue, not one for every person it prices
const catalogMaps = new WeakMap<readonly JsonObject[], ReadonlyMap<string, JsonObject>>();
export const catalogByCode = (rows: readonly JsonObject[]): ReadonlyMap<string, JsonObject> => {
	const held = catalogMaps.get(rows);
	if (held !== undefined) return held;
	const made = new Map(rows.map((row) => [text(row, 'code'), row]));
	catalogMaps.set(rows, made);
	return made;
};

/** The configured chain is the whole execution plan: no implicit BASE/EARNINGS/NET stages. */
const subtotalChains = new WeakMap<readonly JsonObject[], readonly JsonObject[]>();
export function subtotalChain(rows: readonly JsonObject[]): readonly JsonObject[] {
	const cached = subtotalChains.get(rows);
	if (cached !== undefined) return cached;
	const byCode = new Map(rows.map((row) => [text(row, 'code'), row]));
	const next = new Map<string, JsonObject>();
	for (const row of rows) {
		const previous = row.previous;
		if (previous == null) continue;
		if (typeof previous !== 'string' || !byCode.has(previous))
			throw new Refusal({ message: `${text(row, 'code')}: predecessor is missing.` });
		if (next.has(previous))
			throw new Refusal({ message: 'Subtotals must form one linear chain, not a branch.' });
		next.set(previous, row);
	}
	const first = rows.filter((row) => row.previous == null);
	if (rows.length > 0 && first.length !== 1)
		throw new Refusal({ message: 'A subtotal chain needs exactly one first checkpoint.' });
	const ordered: JsonObject[] = [];
	let current = first[0];
	const seen = new Set<string>();
	while (current !== undefined) {
		const key = text(current, 'code');
		if (seen.has(key)) throw new Refusal({ message: 'Subtotal chain contains a cycle.' });
		seen.add(key);
		ordered.push(current);
		current = next.get(key);
	}
	if (ordered.length !== rows.length)
		throw new Refusal({ message: 'Subtotal chain is disconnected.' });
	subtotalChains.set(rows, ordered);
	return ordered;
}

/** Statutory dependencies are explicit scheme codes and only finalised results are visible. */
const statutoryOrders = new WeakMap<readonly JsonObject[], readonly JsonObject[]>();
export function statutoryOrder(rows: readonly JsonObject[]): readonly JsonObject[] {
	const cached = statutoryOrders.get(rows);
	if (cached !== undefined) return cached;
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
		const dependencies = row.depends_on ?? [];
		if (!Array.isArray(dependencies))
			throw new Refusal({ message: `${code}: depends_on lists scheme codes.` });
		for (const dependency of dependencies) visit(String(dependency));
		visiting.delete(code);
		done.add(code);
		ordered.push(row);
	};
	for (const code of [...byCode.keys()].sort()) visit(code);
	statutoryOrders.set(rows, ordered);
	return ordered;
}

export const evaluateNumber = (
	source: unknown,
	context: object,
	field: string,
	roots?: readonly string[]
): number => {
	if (typeof source !== 'string' || source.trim() === '') return 0;
	return number(evaluate(source, 'CALCULATION', context, field, roots), field);
};
export const eligible = (
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
const roundingRules = new WeakMap<object, Rounding>();
export const rounding = (row: JsonObject): Rounding => {
	const held = roundingRules.get(row);
	if (held !== undefined) return held;
	const settings = settingsConstants(row);
	const mode = ROUNDING_MODES.find((candidate) => candidate === settings.rounding) ?? 'HALF_UP';
	const scale =
		typeof settings.rounding_scale === 'number' &&
		Number.isInteger(settings.rounding_scale) &&
		settings.rounding_scale >= 0 &&
		settings.rounding_scale <= 12
			? settings.rounding_scale
			: 2;
	const rule: Rounding = { mode, scale };
	roundingRules.set(row, rule);
	return rule;
};
export const round = (settings: JsonObject, value: number): number => {
	if (value === 0) return 0;
	if (Number.isSafeInteger(value)) return value;
	const rule = rounding(settings);
	return BigDecimal.toNumberUnsafe(
		BigDecimal.round(BigDecimal.fromNumberUnsafe(value), {
			scale: rule.scale,
			mode: roundingModes[rule.mode]
		})
	);
};
export const floorMinor = (settings: JsonObject, value: number): number => {
	if (value === 0) return 0;
	if (Number.isSafeInteger(value)) return value;
	const rule = rounding(settings);
	return BigDecimal.toNumberUnsafe(
		BigDecimal.round(BigDecimal.fromNumberUnsafe(value), {
			scale: rule.scale,
			mode: 'to-zero'
		})
	);
};

export function line(input: {
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
	readonly back_pay_period?: string;
}): PayLine {
	return {
		code: input.code,
		label: input.label,
		subtotal: text(input.subtotal, 'code'),
		amount: input.amount,
		direction: input.direction ?? 'ADD',
		party: input.party ?? 'EMPLOYEE',
		incurred_on: input.incurred_on,
		coverage: input.coverage,
		// a row of the law is named by its code
		source_id: {
			model: input.model,
			id: typeof input.source.id === 'string' ? input.source.id : text(input.source, 'code')
		},
		...(input.quantity === undefined ? {} : { quantity: input.quantity }),
		...(input.unit === undefined ? {} : { unit: input.unit }),
		...(input.rate_code === undefined ? {} : { rate_code: input.rate_code }),
		...(input.back_pay_period === undefined ? {} : { back_pay_period: input.back_pay_period })
	};
}

export const signed = (direction: Direction, amount: number): number =>
	direction === 'ADD' ? amount : -amount;

export const unemployedDays = (input: PayrollInput, days: readonly string[]): number =>
	input.employed === undefined
		? 0
		: days.filter(
				(day) => !input.employed?.some(({ from, to }) => from <= day && (to === null || day <= to))
			).length;

export type Slot = { readonly date: string; readonly part: string };
export type SlotShare = (row: JsonObject, entry: JsonObject, slot: Slot) => number;
export const slotsOf = (entry: JsonObject): readonly Slot[] =>
	(Array.isArray(entry.days) ? entry.days : []).flatMap((day) =>
		isJsonObject(day) && typeof day.date === 'string' && isIsoDate(day.date)
			? [{ date: day.date, part: String(day.part) }]
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
export const unpaidByDate = (input: PayrollInput, share: SlotShare): Map<string, number> => {
	const unpaid = new Map<string, number>();
	const add = (date: string, days: number) => unpaid.set(date, (unpaid.get(date) ?? 0) + days);
	const catalogs = catalogByCode(input.leave_catalog);
	for (const entry of input.entries.leave_catalog_entry ?? []) {
		const row = catalogs.get(String(entry.catalog_code));
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
		date: date,
		work: isWorkingDay(date, off)
	}));
};

/** A 30-day divisor prices every calendar day, so a missed day is one of the month's thirty. */
const dayRateCalendar = (input: PayrollInput): boolean => {
	const dayBasis = settingsConstants(input.settings).day_basis;
	const typed: JsonObject = isJsonObject(dayBasis) ? dayBasis : {};
	return typed.basis === 'FIXED' && Number(typed.days) === 30;
};

/** The days a period's share counts, by `proration_basis`: its calendar days, or the person's own working days. */
export const basisDays = (
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
	const ym = date.slice(0, 7);
	const days = daysIn(`${ym}-01`, monthEndOf(ym));
	if (basis === 'CALENDAR_DAYS' || (basis === 'DAY_RATE' && dayRateCalendar(input)))
		return days.length;
	const off = offDaysOf(input);
	return days.filter((day) => isWorkingDay(day, off)).length;
};

/**
 * A missed day is a day of its own month. Attendance runs behind the salary period, so a day missed late last month is
 * deducted here at that month's count of days: as days of this period, its month's count over the day's own.
 */
export const ownMonthWeight = (
	input: PayrollInput,
	coverage: { from: string; to: string },
	basis: unknown,
	date: string
): number => {
	if (date.slice(0, 7) === coverage.from.slice(0, 7)) return 1;
	const own = monthBasisCount(input, date, basis);
	return own <= 0 ? 1 : monthBasisCount(input, coverage.from, basis) / own;
};

/**
 * The share of a period someone is paid for, by the jurisdiction's `proration_basis`. Joiners, leavers,
 * the unpaid part of leave and ABS all pass through this one rule.
 */
export const paidShare = (
	input: PayrollInput,
	coverage: { from: string; to: string },
	basis: unknown,
	unpaid: ReadonlyMap<string, number>,
	computedBasis?: ReturnType<typeof payBasis>
): number => {
	if (input.full_period_unpaid === true) return 0;
	const counted = basisDays(input, coverage, basis);
	const unpaidDays = [...unpaid].reduce(
		(total, [date, value]) =>
			total + value * (basis === 'DAY_RATE' ? 1 : ownMonthWeight(input, coverage, basis, date)),
		0
	);
	const lost = unemployedDays(input, counted) + unpaidDays;
	// a missed day takes the statute's day rate, not a share of the period's days (PH 313/261, TW/TH ÷30, etc.)
	if (basis === 'DAY_RATE') {
		const { day_rate, month_wage } = computedBasis ?? payBasis(input, coverage);
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
const weekdays = new Map<string, number>();
export const isWorkingDay = (date: string, off: readonly number[]): boolean => {
	let weekday = weekdays.get(date);
	if (weekday === undefined) {
		weekday = DateTime.getPartUtc(DateTime.makeUnsafe(date), 'weekDay');
		if (weekdays.size >= 4096) weekdays.clear();
		weekdays.set(date, weekday);
	}
	return !off.includes(weekday);
};
const numeric = (value: unknown): number =>
	typeof value === 'number' && Number.isFinite(value) ? value : 0;
const fixedOf = (value: JsonObject, key: string, field: string): number => {
	const fixed = value[key];
	if (typeof fixed === 'number' && Number.isFinite(fixed) && fixed > 0) return fixed;
	throw new Refusal({ message: `${field}: FIXED needs a positive ${key}.` });
};
/** The contract's rate and the hours it is worked over; ordinary hours are terms, never jurisdiction law. */
export const rateOf = (input: PayrollInput) => {
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
	const rows = catalogByCode(input.allowance);
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
	const ym = coverage.from.slice(0, 7);
	const monthStart = `${ym}-01`;
	const monthEnd = monthEndOf(ym);
	const monthDays = daysIn(monthStart, monthEnd);
	const monthCalendar = monthDays.length;
	const monthWorking = monthDays.filter((date) => isWorkingDay(date, off)).length;
	const sameAsMonth = coverage.from === monthStart && coverage.to === monthEnd;
	const coverageDays = sameAsMonth ? monthDays : daysIn(coverage.from, coverage.to);
	const calendar_days = coverageDays.length;
	const working_days = sameAsMonth
		? monthWorking
		: coverageDays.filter((date) => isWorkingDay(date, off)).length;
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
export function salaryOf(
	input: PayrollInput,
	coverage: { from: string; to: string },
	precomputedWorkingDays?: number
) {
	const { amount: rate, unit, hoursPerDay } = rateOf(input);
	const workingDays =
		precomputedWorkingDays ??
		(() => {
			const off = offDaysOf(input);
			return daysIn(coverage.from, coverage.to).filter((date) => isWorkingDay(date, off)).length;
		})();
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

export const heldBalance = (input: PayrollInput): JsonObject => {
	const account = input.balance.account;
	return isJsonObject(account) ? account : {};
};

/** One pure linear pass: inputs in, pay lines, checkpoint values, statutory YTD and ledger out. */
/**
 * Leave the employer pays in full by its own policy (`pay_methods.paid_leave`) where the law's row leaves it unpaid: no
 * statute requires it, and it only ever pays more than the law.
 */
export const withCompanyPaidLeave = (input: PayrollInput): PayrollInput => {
	const methods = isJsonObject(input.employer.pay_methods) ? input.employer.pay_methods : {};
	const paid = new Set(
		(Array.isArray(methods.paid_leave) ? methods.paid_leave : []).filter(
			(code): code is string => typeof code === 'string'
		)
	);
	if (paid.size === 0) return input;
	return {
		...input,
		leave_catalog: input.leave_catalog.map((row) =>
			paid.has(String(row.code)) ? { ...row, paid_share: '' } : row
		)
	};
};
