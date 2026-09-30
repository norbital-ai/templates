/**
 * Payroll history: the one reader of a person's past — earlier payslips, work days, leave and
 * terms, opening pay recorded before this workspace, and history outside this payroll.
 *
 * Three layers live here:
 * - the reference-wage readers (a preceding or latest complete wage period);
 * - the statutory history (earlier paid assessments, cumulated at the current cadence);
 * - E4, the history accessor the expressions read (`history.slips(window)`, `history.days(window)`,
 *   `history.leave(window)`, `history.terms(window)`, `history.external(kind, window)`).
 *
 * The accessor knows no rule: it lists what was saved, clipped to a window the stored expression
 * names; every average, floor and aggregate is the expression's own.
 */

import { refuse } from '../refuse.js';
import { decodeNumber } from '../wire.js';
import type { WorkspaceRow } from '../rows.js';
import { dateKey } from '../iso-day.js';
import {
	monthBounds,
	monthKey,
	periodMonth,
	requiredDateKey,
	type IsoDate,
	addDays,
	daysBetween
} from './run/dates.js';
import { live, readRange } from './run/effective.js';
import type { FamilyPayItem } from './family.js';
import type { PayrollWorld } from './world.js';
import { externalHistory } from '../person-facts.js';

export type ReferenceWagePeriod = {
	readonly id: string;
	readonly period: unknown;
	readonly currency: string;
	readonly normal_wages: number | null;
	readonly ordinary_wages: number | null;
	readonly ordinary_days: unknown;
	readonly due_on: string;
	readonly paid_on: string | null;
	readonly reference: string;
	readonly approval_id?: string | null | undefined;
	/** Set on a month read from the payslips that settled it, which no manual record stands for. */
	readonly payslips?: readonly string[] | undefined;
};

/**
 * One calendar month's pay as the earlier payslips of that month settled it — the record a
 * normal-wage reference reads without anyone typing it in (TW 施行細則 §24-1).
 */
export type PayslipWageMonth = {
	readonly month: string;
	/** The first and last day the month's contract lines covered. */
	readonly start: IsoDate;
	readonly end: IsoDate;
	/** The latest settlement date, or null while any of the month's payslips is unpaid. */
	readonly paid_on: IsoDate | null;
	readonly payslips: readonly string[];
	/** The contract lines by component code — the wage and each allowance class — as prorated. */
	readonly contract: Readonly<Record<string, number>>;
	/** Paid lines of classes marked `WAGES` (commission, a regular allowance raised ad hoc). */
	readonly regular: number;
	/** The month's unpaid days. */
	readonly absence: number;
};

export function periodDates(row: ReferenceWagePeriod): {
	readonly start: IsoDate;
	readonly end: IsoDate;
} {
	const range = readRange(row.period);
	if (range?.end == null)
		throw new Error('Reference wage period must have a finite inclusive end.');
	return {
		start: requiredDateKey(range.start, 'employment_wage_periods.period.start'),
		end: requiredDateKey(range.end, 'employment_wage_periods.period.end')
	};
}

function amount(
	row: ReferenceWagePeriod,
	field: 'normal_wages' | 'ordinary_wages',
	currency: string,
	label: 'normal wages' | 'ordinary earnings'
): number {
	if (row[field] == null) throw new Error(`Reference wage period is missing ${label}.`);
	if (row.currency !== currency)
		throw new Error(`Reference wage period ${label} currency differs from payroll.`);
	const value = row[field];
	if (!Number.isFinite(value) || value < 0)
		throw new Error(`Reference wage period ${label} must be finite and nonnegative.`);
	return value;
}

function approved(rows: readonly ReferenceWagePeriod[]): readonly ReferenceWagePeriod[] {
	return rows.filter((row) => row.approval_id == null);
}

/** Malaysia EA s.60I(1C): the immediately preceding complete wage period, with exact adjacency. */
export function previousWagePeriodOrdinaryRate(options: {
	readonly periods: readonly ReferenceWagePeriod[];
	readonly currentPeriodStart: IsoDate;
	readonly currency: string;
}): { readonly row: ReferenceWagePeriod; readonly ordinaryDay: number } {
	const previousEnd = addDays(options.currentPeriodStart, -1);
	const matches = approved(options.periods).filter((row) => periodDates(row).end === previousEnd);
	if (matches.length === 0)
		throw new Error(
			`Ordinary rate requires the wage period ending ${previousEnd}, immediately before the current period.`
		);
	if (matches.length !== 1)
		throw new Error(`Ordinary rate has ambiguous wage periods ending ${previousEnd}.`);
	const row = matches[0]!;
	const wages = amount(row, 'ordinary_wages', options.currency, 'ordinary earnings');
	const days = decodeNumber(row.ordinary_days);
	if (!Number.isFinite(days) || days <= 0)
		throw new Error('Reference wage period ordinary days must be finite and positive.');
	return { row, ordinaryDay: wages / days };
}

/** Taiwan normal-wage basis: latest full month received or contractually due before the boundary. */
export function latestDueMonthNormalRate(options: {
	readonly periods: readonly ReferenceWagePeriod[];
	readonly boundary: IsoDate;
	readonly currency: string;
	readonly dailyDivisor: number;
}): { readonly row: ReferenceWagePeriod; readonly normalDay: number } {
	if (!Number.isInteger(options.dailyDivisor) || options.dailyDivisor <= 0)
		throw new Error('Normal-wage daily divisor must be a positive integer in the sealed version.');
	const eligible = approved(options.periods)
		.filter((row) => {
			const period = periodDates(row);
			const month = monthBounds(monthKey(period.start));
			if (period.start !== month.start || period.end !== month.end) return false;
			const due = requiredDateKey(row.due_on, 'employment_wage_periods.due_on');
			const paid =
				row.paid_on == null
					? null
					: requiredDateKey(row.paid_on, 'employment_wage_periods.paid_on');
			return due < options.boundary || (paid != null && paid < options.boundary);
		})
		.toSorted((left, right) => periodDates(right).end.localeCompare(periodDates(left).end));
	if (eligible.length === 0)
		throw new Error(
			`Normal-wage rate requires a complete monthly wage period received or due before ${options.boundary}: ` +
				'no earlier payslip settles a whole month then. Run that month’s payroll first, or record ' +
				'the month’s normal-hours wages as an employment wage period where it was paid before this workspace.'
		);
	const latestEnd = periodDates(eligible[0]!).end;
	const matches = eligible.filter((row) => periodDates(row).end === latestEnd);
	if (matches.length !== 1)
		throw new Error(`Normal-wage rate has ambiguous monthly periods ending ${latestEnd}.`);
	const row = matches[0]!;
	return {
		row,
		normalDay: amount(row, 'normal_wages', options.currency, 'normal wages') / options.dailyDivisor
	};
}

export type AssessmentFrequency = 'MONTHLY' | 'SEMI_MONTHLY' | 'WEEKLY';

type StatutoryChargeHistory = {
	readonly base: number;
	readonly ordinary: number | null;
	readonly employee: number;
	readonly employer: number;
};

export type StatutoryPeriodHistory = {
	readonly period: string;
	readonly frequency: AssessmentFrequency | null;
	readonly charges: Readonly<Record<string, StatutoryChargeHistory>>;
};

export type StatutoryHistorySummary = {
	readonly periods: number;
	readonly base: number;
	readonly ordinary: number;
	readonly employee: number;
	readonly employer: number;
	readonly triggered: boolean;
	readonly hasOpening: boolean;
	/** Whether every opening states the payroll periods and cadence its amounts represent. */
	readonly periodsRecorded: boolean;
};

type Opening = {
	readonly base: number;
	readonly ordinary?: number | null | undefined;
	readonly employee: number;
	readonly employer: number;
	readonly months?: number | null | undefined;
	readonly payroll_periods?: number | null | undefined;
	readonly payroll_frequency?: AssessmentFrequency | null | undefined;
};

const frequencyOf = (
	period: string,
	frequencies: ReadonlySet<string>
): AssessmentFrequency | null => {
	if (frequencies.size === 1) {
		const value = [...frequencies][0];
		if (value === 'MONTHLY' || value === 'SEMI_MONTHLY' || value === 'WEEKLY') return value;
	}
	return /^\d{4}-\d{2}$/.test(period) ? 'MONTHLY' : null;
};

/** Payroll periods of one cadence in a month; a week's is the version's weeks a month. */
const periodsPerMonth = (
	frequency: AssessmentFrequency,
	weeksPerMonth: (() => number) | undefined
): number =>
	frequency === 'MONTHLY'
		? 1
		: frequency === 'SEMI_MONTHLY'
			? 2
			: (weeksPerMonth ?? refuse('A weekly cadence needs the version’s weeks a month.'))();

const convertPeriods = (
	periods: number,
	from: AssessmentFrequency,
	to: AssessmentFrequency,
	weeksPerMonth: (() => number) | undefined
): number =>
	from === to
		? periods
		: (periods * periodsPerMonth(to, weeksPerMonth)) / periodsPerMonth(from, weeksPerMonth);

/** One paid assessment per person and payroll period, including all concurrent contracts. */
export function buildStatutoryHistory(options: {
	readonly payslips: readonly WorkspaceRow<'payslips'>[];
	readonly periodByRun: ReadonlyMap<string, string>;
	readonly employmentToEmployee: ReadonlyMap<string, string>;
	readonly inTaxYear: ReadonlySet<string>;
}): Map<string, readonly StatutoryPeriodHistory[]> {
	type Period = { charges: Record<string, StatutoryChargeHistory>; frequencies: Set<string> };
	const people = new Map<string, Map<string, Period>>();
	for (const slip of options.payslips) {
		if (slip.status !== 'PAID' || !options.inTaxYear.has(slip.payroll_run_id)) continue;
		const period = options.periodByRun.get(slip.payroll_run_id);
		const employee = options.employmentToEmployee.get(slip.employment_id);
		if (period == null || employee == null) continue;
		let periods = people.get(employee);
		if (!periods) {
			periods = new Map();
			people.set(employee, periods);
		}
		let entry = periods.get(period);
		if (!entry) {
			entry = { charges: {}, frequencies: new Set() };
			periods.set(period, entry);
		}
		for (const line of slip.statutory) {
			if (line.assessment_frequency != null) entry.frequencies.add(line.assessment_frequency);
			const prior = entry.charges[line.scheme_code];
			const ordinary = line.ordinary_amount == null ? null : line.ordinary_amount;
			entry.charges[line.scheme_code] = {
				base: (prior?.base ?? 0) + line.base_amount,
				ordinary:
					prior?.ordinary === null || ordinary === null ? null : (prior?.ordinary ?? 0) + ordinary,
				employee: (prior?.employee ?? 0) + line.employee_amount,
				employer: (prior?.employer ?? 0) + line.employer_amount
			};
		}
	}
	return new Map(
		[...people].map(([employee, periods]) => [
			employee,
			[...periods]
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([period, entry]) => ({
					period,
					frequency: frequencyOf(period, entry.frequencies),
					charges: entry.charges
				}))
		])
	);
}

type HistoryTrigger = NonNullable<WorkspaceRow<'statutory_contributions'>['history_trigger']>;

/**
 * Cumulative history, converted to the cadence of the assessment being calculated. `triggered` is
 * set only for a scheme that declares a `history_trigger`, from that scheme's own prior charges.
 */
export function cumulativeHistory(options: {
	readonly periods: readonly StatutoryPeriodHistory[];
	readonly openings: ReadonlyMap<string, Opening>;
	readonly frequency: AssessmentFrequency;
	/** The version's weeks a month (`rate_conversions.weekly_to_monthly`), read for a weekly cadence. */
	readonly weeksPerMonth?: (() => number) | undefined;
	/** Codes whose `history.<code>.periods` the catalogue reads; their openings must state a cadence. */
	readonly requirePeriodsFor?: ReadonlySet<string> | undefined;
	/** The schemes that declare a trigger, by code. */
	readonly triggers?: ReadonlyMap<string, HistoryTrigger> | undefined;
}): ReadonlyMap<string, StatutoryHistorySummary> {
	const codes = new Set([
		...options.openings.keys(),
		...options.periods.flatMap((period) => Object.keys(period.charges))
	]);
	const triggeredFor = (code: string): boolean => {
		const trigger = options.triggers?.get(code);
		if (trigger == null) return false;
		let triggered = false;
		for (const period of options.periods) {
			const charge = period.charges[code];
			if (charge == null) continue;
			const frequency = period.frequency;
			if (frequency == null)
				refuse(`${period.period}: record the payroll cadence on the settled statutory assessment.`);
			const deductions = trigger.less_employee_of.reduce(
				(total, other) => total + (period.charges[other]?.employee ?? 0),
				0
			);
			const total = Math.max(0, charge.base - deductions);
			const ordinary = Math.max(0, (charge.ordinary ?? charge.base) - deductions);
			const supplementary = Math.max(0, total - ordinary);
			const threshold = trigger.ordinary_threshold[frequency];
			triggered ||=
				(ordinary <= threshold && supplementary > 0) ||
				(supplementary > 0 && supplementary >= ordinary);
		}
		return triggered;
	};
	return new Map(
		[...codes].map((code) => {
			const opening = options.openings.get(code);
			const needsPeriods = options.requirePeriodsFor?.has(code) ?? false;
			let periods = 0;
			let periodsRecorded = true;
			let base = opening?.base ?? 0;
			let ordinary = opening == null ? 0 : (opening.ordinary ?? opening.base);
			let employee = opening?.employee ?? 0;
			let employer = opening?.employer ?? 0;
			if (opening != null) {
				const sourceFrequency =
					opening.payroll_frequency ?? (opening.months != null ? 'MONTHLY' : null);
				const sourcePeriods = opening.payroll_periods ?? opening.months;
				const usable = sourceFrequency != null && sourcePeriods != null && sourcePeriods > 0;
				periodsRecorded &&= usable;
				if (usable)
					periods += convertPeriods(
						sourcePeriods,
						sourceFrequency,
						options.frequency,
						options.weeksPerMonth
					);
			}
			for (const period of options.periods) {
				if (needsPeriods) {
					const frequency = period.frequency;
					if (frequency == null)
						refuse(
							`${period.period}: record the payroll cadence on the settled statutory assessment.`
						);
					periods += convertPeriods(1, frequency, options.frequency, options.weeksPerMonth);
				}
				const charge = period.charges[code];
				if (charge == null) continue;
				base += charge.base;
				ordinary += charge.ordinary ?? charge.base;
				employee += charge.employee;
				employer += charge.employer;
			}
			return [
				code,
				{
					periods,
					base,
					ordinary,
					employee,
					employer,
					triggered: triggeredFor(code),
					hasOpening: opening != null,
					periodsRecorded
				}
			] as const;
		})
	);
}

// ---------------------------------------------------------------------------------------------
// E4 — the history accessor.
// ---------------------------------------------------------------------------------------------

/** A window: an inclusive span of calendar days, as `span(from, to)` builds it; `''` ends are empty. */
export type HistoryWindow = { readonly from: string; readonly to: string };

type Amounts = Record<string, number>;

/**
 * One payslip's lines of one wage month. A slip whose lines pay two months (arrears for an earlier
 * month beside this one's pay) is two of these, each under its wage month and both under the pay
 * month of the run; an opening month recorded before this workspace is one with `opening` set.
 */
export type HistorySlip = {
	readonly payslip_id: string;
	/** The month the lines pay for (`YYYY-MM`): where arrears land. */
	readonly wage_month: string;
	/** The month of the run that settled them. */
	readonly pay_month: string;
	/** The first and last day the lines cover: the priced days in the month, else the month. */
	readonly start: IsoDate;
	readonly end: IsoDate;
	/** A payslip's state (DRAFT, ON_HOLD, PAID); an opening's PAID or DUE. */
	readonly status: string;
	/** The settlement day, or '' while unpaid. */
	readonly paid_on: string;
	readonly opening: boolean;
	/** Component code → signed amount (an unpaid day or a deduction is negative). */
	readonly lines: Amounts;
	/** Class or scheme a component counts toward → the signed total of its lines. */
	readonly classes: Amounts;
	/** Scheme code → the assessed base (on the pay month's piece only). */
	readonly bases: Amounts;
	/** Days the priced contract covers in the month, and the unpaid days its absence lines state. */
	readonly days: { readonly covered: number; readonly unpaid: number };
	/** Leave code → the charged leave days inside `[start, end]`. */
	readonly leave: Amounts;
	/** An opening month's recorded figures; zero on a payslip. */
	readonly recorded: {
		readonly normal_wages: number;
		readonly ordinary_wages: number;
		readonly ordinary_days: number;
	};
};

/** A payslip as the history reads it; a stored `payslips` row satisfies it. */
export type HistoryPayslip = {
	readonly id: string;
	readonly payroll_run_id: string;
	readonly status: string;
	readonly paid_at?: string | null | undefined;
	readonly base: readonly { readonly component_code: string; readonly amount: number }[];
	readonly proration?:
		| readonly {
				readonly component_code: string;
				readonly from: string;
				readonly to: string;
				readonly prorated_amount: number;
		  }[]
		| null
		| undefined;
	readonly adjustments: readonly {
		readonly family: string;
		readonly source_id: string;
		readonly component_code: string;
		readonly bucket: string;
		readonly amount: number;
		readonly quantity?: number | null | undefined;
	}[];
	readonly statutory: readonly { readonly scheme_code: string; readonly base_amount: number }[];
};

const NO_RECORD = { normal_wages: 0, ordinary_wages: 0, ordinary_days: 0 } as const;

const add = (amounts: Amounts, key: string, amount: number) => {
	amounts[key] = (amounts[key] ?? 0) + amount;
};

/**
 * Earlier payslips split by wage month. A contract line follows the days its proration segments
 * priced (split by their prorated amounts); an adjustment follows the day of the input that
 * caused it (`sourceDate`); anything undated, and every assessed base, stays in the pay month.
 */
export function slipsOf(options: {
	readonly payslips: readonly HistoryPayslip[];
	/** run id → its period; a slip of a run not listed is not history. */
	readonly periodByRun: ReadonlyMap<string, string>;
	readonly components: ReadonlyMap<string, Pick<FamilyPayItem, 'direction' | 'counts_toward'>>;
	/** The day of an adjustment's source input (a work day, a request, a leave entry), or null. */
	readonly sourceDate: (family: string, sourceId: string) => string | null;
}): HistorySlip[] {
	const slips: HistorySlip[] = [];
	for (const slip of options.payslips) {
		const period = options.periodByRun.get(slip.payroll_run_id);
		if (period == null) continue;
		const payMonth = periodMonth(period);
		type Piece = {
			lines: Amounts;
			classes: Amounts;
			bases: Amounts;
			dates: Set<string>;
			unpaid: number;
		};
		const pieces = new Map<string, Piece>();
		const piece = (month: string): Piece => {
			let found = pieces.get(month);
			if (found == null) {
				found = { lines: {}, classes: {}, bases: {}, dates: new Set(), unpaid: 0 };
				pieces.set(month, found);
			}
			return found;
		};
		const line = (month: string, code: string, amount: number) => {
			const target = piece(month);
			add(target.lines, code, amount);
			for (const mark of options.components.get(code)?.counts_toward ?? [])
				add(target.classes, mark, amount);
		};
		const segments = slip.proration ?? [];
		for (const segment of segments)
			for (const day of daysBetween(segment.from, segment.to)) piece(monthKey(day)).dates.add(day);
		for (const base of slip.base) {
			const sign = options.components.get(base.component_code)?.direction === 'SUBTRACT' ? -1 : 1;
			const own = segments.filter((segment) => segment.component_code === base.component_code);
			const priced = own.reduce((sum, segment) => sum + segment.prorated_amount, 0);
			// ponytail: a segment is filed under the month it starts in; a weekly segment across a month
			// end lands whole in the first month. Split by day if a weekly lineage needs it.
			if (priced === 0) line(payMonth, base.component_code, sign * base.amount);
			else
				for (const segment of own)
					line(
						monthKey(segment.from),
						base.component_code,
						(sign * base.amount * segment.prorated_amount) / priced
					);
		}
		for (const adjustment of slip.adjustments) {
			const day = dateKey(options.sourceDate(adjustment.family, adjustment.source_id));
			const month = day === '' ? payMonth : monthKey(day);
			const negative = adjustment.bucket === 'ABSENCE' || adjustment.bucket === 'DEDUCTION';
			line(month, adjustment.component_code, negative ? -adjustment.amount : adjustment.amount);
			if (adjustment.bucket === 'ABSENCE') piece(month).unpaid += adjustment.quantity ?? 0;
		}
		for (const charge of slip.statutory)
			add(piece(payMonth).bases, charge.scheme_code, charge.base_amount);
		for (const [month, found] of pieces) {
			const dates = [...found.dates].filter((day) => monthKey(day) === month).toSorted();
			const bounds = monthBounds(month);
			slips.push({
				payslip_id: slip.id,
				wage_month: month,
				pay_month: payMonth,
				start: dates[0] ?? bounds.start,
				end: dates.at(-1) ?? bounds.end,
				status: slip.status,
				paid_on: dateKey(slip.paid_at),
				opening: false,
				lines: found.lines,
				classes: found.classes,
				bases: found.bases,
				days: { covered: dates.length, unpaid: found.unpaid },
				leave: {},
				recorded: NO_RECORD
			});
		}
	}
	return slips;
}

/** Opening pay recorded before this workspace (`employment_wage_periods`), one slip a period. */
export function openingsOf(periods: readonly ReferenceWagePeriod[]): HistorySlip[] {
	return approved(periods).map((row) => {
		const { start, end } = periodDates(row);
		return {
			payslip_id: row.id,
			wage_month: monthKey(start),
			pay_month: monthKey(dateKey(row.paid_on) || end),
			start,
			end,
			status: row.paid_on == null ? 'DUE' : 'PAID',
			paid_on: dateKey(row.paid_on),
			opening: true,
			lines: {},
			classes: {},
			bases: {},
			days: { covered: 0, unpaid: 0 },
			leave: {},
			recorded: {
				normal_wages: row.normal_wages ?? 0,
				ordinary_wages: row.ordinary_wages ?? 0,
				ordinary_days: decodeNumber(row.ordinary_days) || 0
			}
		};
	});
}

/** A saved work day as the history reads it; a stored `work_days` row satisfies it. */
export type HistoryWorkDay = {
	readonly work_date: string;
	readonly worked_intervals?: readonly unknown[] | null | undefined;
	readonly approved_overtime_hours?: unknown;
	readonly piece_units?: unknown;
	readonly facts?: Readonly<Record<string, unknown>> | null | undefined;
};

/** One calendar day of a window: `recorded` false where no work day was saved for it. */
export type HistoryDay = {
	readonly date: string;
	readonly recorded: boolean;
	readonly hours: number;
	readonly overtime_hours: number;
	readonly piece_units: number;
	readonly facts: Readonly<Record<string, unknown>>;
};

/** Time off as the history reads it; a stored `leave_entries` row satisfies it. */
export type HistoryLeaveEntry = {
	readonly id: string;
	readonly leave_code: string;
	readonly activity: string;
	readonly episode_id?: string | null | undefined;
	readonly reversal_of_id?: string | null | undefined;
	readonly charges?: readonly { readonly date: string; readonly days: number }[] | null | undefined;
};

/** One leave episode touching a window: an opening entry and the entries that continue it. */
export type HistoryEpisode = {
	readonly episode: string;
	readonly code: string;
	/** The episode's first and last charged day, whatever the window. */
	readonly from: string;
	readonly to: string;
	/** Charged days inside the window, and in the whole episode. */
	readonly days: number;
	readonly total_days: number;
};

/** One terms revision touching a window: its scalar fields and its days (`to` '' while open). */
export type HistoryTerms = Readonly<Record<string, string | number | boolean>> & {
	readonly from: string;
	readonly to: string;
};

/** What `history.*` answers; `ExpressionEngine.history` binds one per person. */
export type HistoryAccess = {
	readonly slips: (window: HistoryWindow) => readonly HistorySlip[];
	readonly days: (window: HistoryWindow) => readonly HistoryDay[];
	readonly leave: (window: HistoryWindow) => readonly HistoryEpisode[];
	readonly terms: (window: HistoryWindow) => readonly HistoryTerms[];
	readonly external: (
		kind: string,
		window: HistoryWindow
	) => readonly {
		readonly from: string;
		readonly to: string;
		readonly days: number;
		readonly facts: Readonly<Record<string, unknown>>;
	}[];
};

/** A site's history where nothing was saved: every window is empty (the write-time compiler binds it). */
export const BLANK_HISTORY: HistoryAccess = {
	slips: () => [],
	days: () => [],
	leave: () => [],
	terms: () => [],
	external: () => []
};

const empty = (window: HistoryWindow) =>
	window.from === '' || window.to === '' || window.to < window.from;
const within = (window: HistoryWindow, day: string) => day >= window.from && day <= window.to;

const hoursOf = (intervals: HistoryWorkDay['worked_intervals']): number =>
	(intervals ?? []).reduce<number>((sum, interval) => {
		const range = readRange(interval);
		return range?.end == null
			? sum
			: sum + (Date.parse(range.end) - Date.parse(range.start)) / 3_600_000;
	}, 0);

const numberOr0 = (value: unknown) => (value == null ? 0 : decodeNumber(value) || 0);

const zeroFilled = (keys: readonly string[], amounts: Amounts): Amounts => ({
	...Object.fromEntries(keys.map((key) => [key, 0])),
	...amounts
});

/**
 * The accessor over one person's saved history. `daysFrom` is the first day whose work days were
 * loaded: a `days` window reaching before it refuses rather than read a blank (the load is sized
 * from the version's literal windows, `historyReachDays`). `keys` zero-fill the maps so a stored
 * expression can read `s.lines.X` on a slip that paid no X.
 */
export function historyAccess(input: {
	readonly slips: readonly HistorySlip[];
	readonly workDays: readonly HistoryWorkDay[];
	readonly daysFrom: IsoDate;
	readonly leave: readonly HistoryLeaveEntry[];
	readonly terms: readonly (Readonly<Record<string, unknown>> & {
		readonly effective_range: unknown;
	})[];
	readonly external: Parameters<typeof externalHistory>[0];
	readonly keys: {
		readonly codes: readonly string[];
		readonly classes: readonly string[];
		readonly schemes: readonly string[];
		readonly leave: readonly string[];
	};
}): HistoryAccess {
	const reversed = new Set(
		input.leave.map((entry) => entry.reversal_of_id).filter((id) => id != null)
	);
	const timeOff = input.leave.filter(
		(entry) => entry.activity === 'TIME_OFF' && !reversed.has(entry.id)
	);
	const charges = timeOff.flatMap((entry) =>
		(entry.charges ?? []).map((charge) => ({
			episode: entry.episode_id ?? entry.id,
			code: entry.leave_code,
			date: charge.date,
			days: charge.days
		}))
	);
	let slips: readonly HistorySlip[] | undefined;
	const allSlips = () =>
		(slips ??= input.slips
			.map((slip) => {
				const leave: Amounts = {};
				for (const charge of charges)
					if (within({ from: slip.start, to: slip.end }, charge.date))
						add(leave, charge.code, charge.days);
				return {
					...slip,
					lines: zeroFilled(input.keys.codes, slip.lines),
					classes: zeroFilled(input.keys.classes, slip.classes),
					bases: zeroFilled(input.keys.schemes, slip.bases),
					leave: zeroFilled(input.keys.leave, leave)
				};
			})
			.toSorted(
				(a, b) => a.start.localeCompare(b.start) || a.pay_month.localeCompare(b.pay_month)
			));
	const byDate = Map.groupBy(input.workDays, (day) => dateKey(day.work_date));
	return {
		// A slip belongs to the window its first covered day falls in.
		slips: (window) =>
			empty(window) ? [] : allSlips().filter((slip) => within(window, slip.start)),
		days: (window) => {
			if (empty(window)) return [];
			if (window.from < input.daysFrom)
				refuse(
					`history.days reaches ${window.from}, before the work days this run loaded (from ${input.daysFrom}). ` +
						'Bound the window with a literal months_before(…, n) or days_before(…, n).'
				);
			return daysBetween(window.from, window.to).map((date) => {
				const rows = byDate.get(date) ?? [];
				return {
					date,
					recorded: rows.length > 0,
					hours: rows.reduce((sum, row) => sum + hoursOf(row.worked_intervals), 0),
					overtime_hours: rows.reduce(
						(sum, row) => sum + numberOr0(row.approved_overtime_hours),
						0
					),
					piece_units: rows.reduce((sum, row) => sum + numberOr0(row.piece_units), 0),
					facts: rows[0]?.facts ?? {}
				};
			});
		},
		leave: (window) => {
			if (empty(window)) return [];
			return [...Map.groupBy(charges, (charge) => charge.episode)]
				.flatMap(([episode, rows]) => {
					const inside = rows.filter((row) => within(window, row.date));
					if (inside.length === 0) return [];
					const dates = rows.map((row) => row.date).toSorted();
					return [
						{
							episode,
							code: rows[0]!.code,
							from: dates[0]!,
							to: dates.at(-1)!,
							days: inside.reduce((sum, row) => sum + row.days, 0),
							total_days: rows.reduce((sum, row) => sum + row.days, 0)
						}
					];
				})
				.toSorted((a, b) => a.from.localeCompare(b.from));
		},
		terms: (window) => {
			if (empty(window)) return [];
			return input.terms
				.flatMap((row) => {
					const range = readRange(row.effective_range);
					if (range == null) return [];
					const from = dateKey(range.start);
					const to = dateKey(range.end);
					if (from > window.to || (to !== '' && to < window.from)) return [];
					const scalars = Object.entries(row).filter(
						([, value]) =>
							typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
					) as [string, string | number | boolean][];
					return [{ ...Object.fromEntries(scalars), from, to }];
				})
				.toSorted((a, b) => a.from.localeCompare(b.from));
		},
		external: (kind, window) =>
			empty(window)
				? []
				: externalHistory(input.external, kind, { start: window.from, end: window.to }).map(
						(row) => ({ from: row.start, to: row.end, days: row.days, facts: row.facts })
					)
	};
}

/**
 * One person's history in one run, read from the run's world: every earlier run of the company
 * (period before `period`), across all the person's employments there and every tax year.
 */
export function personHistory(options: {
	readonly world: PayrollWorld;
	readonly companyId: string;
	readonly employeeId: string;
	readonly period: string;
	readonly components: ReadonlyMap<string, FamilyPayItem>;
	/** The version's scheme and leave codes, zero-filled into `bases` and `leave`. */
	readonly schemes: readonly string[];
	readonly leaveCodes: readonly string[];
	/** The first day of the work days the world loaded. */
	readonly daysFrom: IsoDate;
}): HistoryAccess {
	const { world } = options;
	const employmentIds = new Set(
		live(world.employments)
			.filter(
				(row) => row.company_id === options.companyId && row.employee_id === options.employeeId
			)
			.map((row) => row.id)
	);
	const ours = <
		T extends { readonly approval_id?: string | null | undefined; readonly employment_id: string }
	>(
		rows: readonly T[]
	) => live(rows).filter((row) => employmentIds.has(row.employment_id));
	const periodByRun = new Map(
		world.payroll_runs
			.filter((run) => run.company_id === options.companyId && run.period < options.period)
			.map((run) => [run.id, run.period])
	);
	// The day each adjustment's source input is for, by family: where its line's wage month is.
	const sources: Record<string, ReadonlyMap<string, string | null | undefined>> = {
		WORK_DAY: new Map(world.work_days.map((row) => [row.id, row.work_date])),
		ADHOC: new Map(world.adhoc_requests.map((row) => [row.id, row.event_date])),
		CLAIM: new Map(world.claim_requests.map((row) => [row.id, row.incurred_on])),
		LEAVE: new Map(world.leave_entries.map((row) => [row.id, row.from_date ?? row.effective_on]))
	};
	const classes = new Set<string>();
	for (const component of options.components.values())
		for (const mark of component.counts_toward ?? []) classes.add(mark);
	return historyAccess({
		slips: [
			...openingsOf(ours(world.employment_wage_periods)),
			...slipsOf({
				payslips: world.payslips.filter((slip) => employmentIds.has(slip.employment_id)),
				periodByRun,
				components: options.components,
				sourceDate: (family, id) => sources[family]?.get(id) ?? null
			})
		],
		workDays: ours(world.work_days),
		daysFrom: options.daysFrom,
		leave: ours(world.leave_entries),
		terms: ours(world.employment_terms),
		external: live(world.employment_history ?? []).filter(
			(row) => row.employee_id === options.employeeId
		),
		keys: {
			codes: [...options.components.keys()],
			classes: [...classes],
			schemes: options.schemes,
			leave: options.leaveCodes
		}
	});
}
