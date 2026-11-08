import { datePeriod, eachDay, isPlainDate } from '@norbital-ai/std/date';
import type { JsonObject, Lookup, Party, Direction, Rounding, Unit } from './contracts.js';
import { lookupOf, settingsConstants } from './contracts.js';
import { evaluate } from './expressions.js';
import { programOf } from './programs.js';
import { Refusal, isJsonObject, leaveEntry } from './foundation.js';
import { rounded } from './money.js';

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
	readonly reversal: boolean;
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
	/** The entries a run's reversal entries undo: their own days price the refund, wherever they were taken. */
	readonly reversals?: readonly JsonObject[];
	readonly work?: { readonly days: readonly JsonObject[] };
	/** The person's contracts, whichever one pays: days outside all of them were never owed. */
	readonly employed?: readonly { readonly from: string; readonly to: string | null }[];
	/** The person's pattern over the salary and attendance periods. */
	readonly projected_days?: readonly ProjectedDay[];
}

export interface PayrollResult {
	readonly lines: readonly PayLine[];
	readonly subtotals: readonly SubtotalResult[];
	readonly statutory: readonly StatutoryResult[];
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
	if (!isPlainDate(from) || !isPlainDate(to))
		throw new Refusal({ message: 'Salary coverage requires actual dates.' });
	return { from, to };
};
const catalogById = (rows: readonly JsonObject[]): ReadonlyMap<string, JsonObject> =>
	new Map(rows.map((row) => [id(row), row]));

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
const incurredOn = (
	source: unknown,
	context: object,
	fallback: string,
	field: string,
	roots?: readonly string[]
): string => {
	if (typeof source !== 'string' || source.trim() === '') return fallback;
	const value = evaluate(source, 'CALCULATION', context, field, roots);
	if (!isPlainDate(value)) throw new Refusal({ message: `${field}: must return an ISO date.` });
	return value;
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
	readonly reversal?: boolean;
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
		reversal: input.reversal === true,
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

/** Unpaid days by date: unpaid leave, half days included, and days the roster marks ABS. */
const unpaidByDate = (input: PayrollInput): Map<string, number> => {
	const unpaid = new Map<string, number>();
	const add = (date: string, days: number) => unpaid.set(date, (unpaid.get(date) ?? 0) + days);
	const catalogs = catalogById(input.leave_catalog);
	for (const entry of input.entries.leave_catalog_entry ?? []) {
		if (catalogs.get(String(entry.catalog_id))?.pay_treatment !== 'UNPAID') continue;
		// a reversal is refunded by its own line in the original month; it never changes this period's share
		if (entry.reverses != null) continue;
		for (const day of Array.isArray(entry.days) ? entry.days : [])
			if (isJsonObject(day)) add(String(day.date), 0.5);
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
	return eachDay(datePeriod(coverage.from, coverage.to)).map((date) => ({
		date: String(date),
		work: isWorkingDay(String(date), off)
	}));
};

/** Rest and off days between missed work days: nobody earns them inside a stretch of unpaid days. */
const unpaidRestDays = (
	days: readonly ProjectedDay[],
	unpaid: ReadonlyMap<string, number>
): number => {
	const missed = (day: ProjectedDay | undefined) =>
		day === undefined || (unpaid.get(day.date) ?? 0) >= 1;
	return days.filter((day, index) => {
		if (day.work) return false;
		const before = days.slice(0, index).findLast((other) => other.work);
		const after = days.slice(index + 1).find((other) => other.work);
		return (before !== undefined || after !== undefined) && missed(before) && missed(after);
	}).length;
};

/**
 * The share of a period someone is paid for, by the jurisdiction's `proration_basis`. Joiners, leavers,
 * unpaid leave and ABS all pass through this one rule.
 */
const paidShare = (
	input: PayrollInput,
	coverage: { from: string; to: string },
	basis: unknown
): number => {
	const days = plannedDays(input, coverage);
	const unpaid = unpaidByDate(input);
	const unpaidDays = [...unpaid.values()].reduce((total, value) => total + value, 0);
	const share = (total: number, lost: number) =>
		total <= 0 ? 1 : Math.min(1, Math.max(0, total - lost) / total);
	if (basis === 'CALENDAR_DAYS') {
		const calendar = eachDay(datePeriod(coverage.from, coverage.to)).map(String);
		return share(
			calendar.length,
			unemployedDays(input, calendar) + unpaidDays + unpaidRestDays(days, unpaid)
		);
	}
	const workDays = days
		.filter(({ date, work }) => work && date >= coverage.from && date <= coverage.to)
		.map(({ date }) => date);
	return share(workDays.length, unemployedDays(input, workDays) + unpaidDays);
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
 * basis (`CONTRACT_HOURS`, `CONTRACT_WEEKLY` = 52 contract weeks, or the FIXED arm's hours).
 */
export const payBasis = (input: PayrollInput, coverage: { from: string; to: string }) => {
	const { terms, amount: rate, unit, hoursPerDay, daysPerWeek, weeklyHours } = rateOf(input);
	const off = offDaysOf(input);
	const month = monthBounds(coverage.from);
	const monthDays = eachDay(datePeriod(month.from, month.to)).map(String);
	const monthCalendar = monthDays.length;
	const monthWorking = monthDays.filter((date) => isWorkingDay(date, off)).length;
	const calendar_days = eachDay(datePeriod(coverage.from, coverage.to)).length;
	const working_days = eachDay(datePeriod(coverage.from, coverage.to)).filter((date) =>
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
	return { month_wage, day_rate, hour_rate, calendar_days, working_days };
};
/** What a reversal of an unpaid entry gives back: the original month's wage over the share its days took. */
const unpaidRefund = (input: PayrollInput, entry: JsonObject): number => {
	const days = Array.isArray(entry.days) ? entry.days.filter(isJsonObject) : [];
	const dates = days.flatMap((day) => (isPlainDate(day.date) ? [String(day.date)] : [])).sort();
	const first = dates[0];
	if (first === undefined) return 0;
	const month = monthBounds(first),
		coverage = { from: month.from, to: month.to },
		basis = payBasis(input, coverage),
		{ unit } = rateOf(input);
	if (unit !== 'MONTHLY') return basis.day_rate * (days.length / 2);
	const off = offDaysOf(input),
		planned = eachDay(datePeriod(month.from, month.to)).map((date) => ({
			date: String(date),
			work: isWorkingDay(String(date), off)
		})),
		unpaid = new Map<string, number>();
	for (const date of dates) unpaid.set(date, (unpaid.get(date) ?? 0) + 0.5);
	const lost = [...unpaid.values()].reduce((total, value) => total + value, 0);
	if (settingsConstants(input.settings).proration_basis === 'CALENDAR_DAYS') {
		const calendar = eachDay(datePeriod(coverage.from, coverage.to)).length;
		return (
			(basis.month_wage * Math.min(calendar, lost + unpaidRestDays(planned, unpaid))) / calendar
		);
	}
	const work = planned.filter((day) => day.work).length;
	return work <= 0 ? 0 : (basis.month_wage * Math.min(work, lost)) / work;
};
/** Default opening checkpoint: contract salary, prorated by UNPAID leave; reversal undoes the absence. */
function defaultBasePay(input: PayrollInput, coverage: { from: string; to: string }): number {
	const { amount: rate, unit, hoursPerDay } = rateOf(input);
	const off = offDaysOf(input);
	const workingDays = eachDay(datePeriod(coverage.from, coverage.to)).filter((date) =>
		isWorkingDay(String(date), off)
	).length;
	if (workingDays <= 0) throw new Refusal({ message: 'Working days must be positive.' });
	const hoursPerMonth = workingDays * hoursPerDay;
	const salaryAmount =
		unit === 'DAILY' ? rate * workingDays : unit === 'HOURLY' ? rate * hoursPerMonth : rate;
	// a day or hour rate pays the days worked; only a salary follows the statute's basis
	const basis =
		unit === 'DAILY' || unit === 'HOURLY'
			? 'WORKING_DAYS'
			: settingsConstants(input.settings).proration_basis;
	return salaryAmount * paidShare(input, coverage, basis);
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
	// the constants view: a row reads the jurisdiction's settings fields under ctx.lookup, then its own lookup
	const settingsView: Lookup = settingsConstants(input.settings);
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
		work: input.work ?? { days: [] },
		run: input.run,
		as_of: coverage.to
	});
	/**
	 * A reversal refunds the salary basis through its one line. Where allowances are not part of that basis, the
	 * prorated producer lines the absence also cut are refunded at the same share of the original month.
	 */
	const producerRefund = (original: JsonObject, salaryRefund: number): number => {
		if (salaryRefund === 0) return 0;
		const inRate = new Map(
			input.allowance.map((row) => [String(row.code), row.include_in_rate === true])
		);
		const dates = (Array.isArray(original.days) ? original.days : [])
			.flatMap((day) => (isJsonObject(day) && isPlainDate(day.date) ? [String(day.date)] : []))
			.sort();
		const first = dates[0];
		if (first === undefined) return 0;
		const month = monthBounds(first);
		const monthWage = payBasis(input, month).month_wage;
		if (monthWage <= 0) return 0;
		const share = Math.min(1, salaryRefund / monthWage);
		let total = 0;
		for (const producer of [...input.allowance, ...input.overtime]) {
			if (producer.prorate !== true || input.run.kind === 'OFF_CYCLE') continue;
			if (inRate.get(text(producer, 'code')) === true) continue;
			const lookup = lookupOf(producer);
			const model = input.allowance.includes(producer) ? 'allowance_catalog' : 'overtime_catalog';
			const context = {
				...base(0, lookup),
				subtotals: Object.fromEntries(results.map((result) => [result.code, result.value]))
			};
			const raw = evaluateNumber(
				producer.conversion,
				context,
				`${text(producer, 'code')}.conversion`,
				programOf(model)?.roots
			);
			total += raw * share;
		}
		return total;
	};
	const openingPay = input.run.kind === 'OFF_CYCLE' ? 0 : defaultBasePay(input, coverage);
	const lines: PayLine[] = [];
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
				subtotals: Object.fromEntries(results.map((r) => [r.code, r.value]))
			};
			if (!eligible(producer.eligibility, context, `${code}.eligibility`, roots)) continue;
			const raw = evaluateNumber(producer.conversion, context, `${code}.conversion`, roots);
			const value =
				producer.prorate === true
					? raw * paidShare(input, coverage, settingsConstants(input.settings).proration_basis)
					: raw;
			if (value === 0) continue;
			subtotalLines.push(
				line({
					code,
					label: text(producer, 'name'),
					subtotal,
					amount: round(input.settings, value),
					direction:
						model === 'overtime_catalog' ? ((producer.direction as Direction) ?? 'ADD') : 'ADD',
					party:
						model === 'overtime_catalog' ? 'EMPLOYEE' : ((producer.party as Party) ?? 'EMPLOYEE'),
					incurred_on: incurredOn(
						producer.incurred_on,
						context,
						coverage.to,
						`${code}.incurred_on`,
						roots
					),
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
				if (catalog === undefined || catalog.subtotal_id !== id(subtotal)) continue;
				if (
					input.run.kind === 'OFF_CYCLE' &&
					(group.model !== 'adhoc_catalog' || catalog.off_cycle_eligible !== true)
				)
					continue;
				const code = text(catalog, 'code');
				if (catalog.pay_treatment === 'UNPAID') {
					// no line for the absence itself: BASIC carries it through paidShare; a reversal gives back the original month
					if (entry.reverses == null) continue;
					const undone =
						typeof entry.reverses === 'string'
							? input.reversals?.find((row) => String(row.id) === entry.reverses)
							: undefined;
					const original = undone ?? entry;
					const salaryRefund = unpaidRefund(input, original);
					const refund = salaryRefund + producerRefund(original, salaryRefund);
					if (refund === 0) continue;
					subtotalLines.push(
						line({
							code,
							label: text(catalog, 'name'),
							subtotal,
							amount: round(input.settings, refund),
							direction: 'ADD',
							party: (catalog.party as Party) ?? 'EMPLOYEE',
							incurred_on: String(entry.incurred_on ?? coverage.to),
							coverage,
							source: entry,
							model: group.entryModel,
							reversal: true,
							...(typeof entry.quantity === 'number' ? { quantity: entry.quantity } : {}),
							...(entry.unit === undefined ? {} : { unit: entry.unit as Unit })
						})
					);
					continue;
				}
				const lookup = lookupOf(catalog);
				const context = {
					...base(previousValue + computed, lookup),
					entry,
					subtotals: Object.fromEntries(results.map((r) => [r.code, r.value]))
				};
				const roots = programOf(group.model)?.roots;
				if (!eligible(catalog.eligibility, context, `${code}.eligibility`, roots)) continue;
				const value = evaluateNumber(catalog.conversion, context, `${code}.conversion`, roots);
				if (value === 0) continue;
				subtotalLines.push(
					line({
						code,
						label: text(catalog, 'name'),
						subtotal,
						amount: round(input.settings, value),
						direction:
							((catalog.direction as Direction) ?? 'ADD') === 'ADD' && entry.reverses != null
								? 'DEDUCT'
								: ((catalog.direction as Direction) ?? 'ADD') === 'DEDUCT' && entry.reverses != null
									? 'ADD'
									: ((catalog.direction as Direction) ?? 'ADD'),
						party:
							group.model === 'leave_catalog'
								? 'EMPLOYEE'
								: ((catalog.party as Party) ?? 'EMPLOYEE'),
						incurred_on: incurredOn(
							catalog.incurred_on,
							context,
							String(entry.incurred_on ?? coverage.to),
							`${code}.incurred_on`,
							roots
						),
						coverage,
						source: entry,
						model: group.entryModel,
						reversal: entry.reverses != null,
						...(typeof entry.quantity === 'number' ? { quantity: entry.quantity } : {}),
						...(entry.unit === undefined ? {} : { unit: entry.unit as Unit })
					})
				);
			}
		}

		const loanCatalog = catalogById(input.loan_catalog);
		for (const repayment of input.entries.loan_repayment_entry ?? []) {
			if (repayment.payroll_run_id != null) continue;
			// an instalment is due in the run that covers its date; a later month's stays open
			if (repayment.paid_on != null && String(repayment.paid_on) > coverage.to) continue;
			const loan = (input.entries.loan_catalog_entry ?? []).find(
				(row) => id(row) === repayment.loan_id
			);
			const catalog = loan === undefined ? undefined : loanCatalog.get(String(loan.catalog_id));
			if (catalog === undefined || catalog.subtotal_id !== id(subtotal)) continue;
			// loan recovery is on-cycle only; off-cycle runs pay one-off adjustments, not instalments
			if (input.run.kind === 'OFF_CYCLE') continue;
			const value = amount(repayment.amount ?? 0, 'repayment.amount');
			if (value === 0) continue;
			subtotalLines.push(
				line({
					code: text(catalog, 'code'),
					label: text(catalog, 'name'),
					subtotal,
					amount: round(input.settings, value),
					direction: repayment.reverses != null ? 'ADD' : 'DEDUCT',
					party: 'EMPLOYEE',
					incurred_on: String(repayment.paid_on ?? coverage.to),
					coverage,
					source: repayment,
					model: 'loan_repayment_entry',
					reversal: repayment.reverses != null,
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
	for (const scheme of statutoryOrder(input.statutory)) {
		const code = text(scheme, 'code');
		const subtotal = chain.find((row) => id(row) === scheme.subtotal_id);
		if (subtotal === undefined)
			throw new Refusal({ message: `${code}: its subtotal is not in this version.` });
		const lookup = lookupOf(scheme);
		const context = {
			...base(values.get(id(subtotal)) ?? 0, lookup),
			subtotals: Object.fromEntries(results.map((r) => [r.code, r.value])),
			statutory: statutoryValues,
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
		const employer = round(
			input.settings,
			amount(
				evaluateNumber(scheme.employer_amount, context, `${code}.employer_amount`, roots),
				`${code}.employer_amount`
			)
		);
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
					label: text(scheme, 'name'),
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
					label: `${text(scheme, 'name')} (employer)`,
					subtotal: employerTarget,
					amount: employer,
					direction: 'ADD',
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
	if (net < 0 && lines.some((l) => l.source_id?.model === 'loan_repayment_entry' && !l.reversal))
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
		net_pay: net,
		employer_cost: employerCost
	};
}
