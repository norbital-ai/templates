import { decodeNumber } from '@norbital-ai/std/json';
import type { MoneyValue } from '@norbital-ai/std/finance';
import { addDays } from '../period.js';
import {
	monthBounds,
	monthKey,
	requiredDateKey,
	type IsoDate
} from '../../collections/payroll_runs/lib/dates.js';
import { readRange } from '../../collections/payroll_runs/lib/effective.js';

export type ReferenceWagePeriod = {
	readonly id: string;
	readonly period: unknown;
	readonly normal_wages: MoneyValue | null;
	readonly ordinary_wages: MoneyValue | null;
	readonly ordinary_days: unknown;
	readonly due_on: string;
	readonly paid_on: string | null;
	readonly reference: string;
	readonly approval_id?: string | null;
};

function periodDates(row: ReferenceWagePeriod): { readonly start: IsoDate; readonly end: IsoDate } {
	const range = readRange(row.period);
	if (range?.end == null)
		throw new Error('Reference wage period must have a finite inclusive end.');
	return {
		start: requiredDateKey(range.start, 'employment_wage_periods.period.start'),
		end: requiredDateKey(range.end, 'employment_wage_periods.period.end')
	};
}

function amount(
	money: MoneyValue | null,
	currency: string,
	label: 'normal wages' | 'ordinary earnings'
): number {
	if (money == null) throw new Error(`Reference wage period is missing ${label}.`);
	if (money.currency !== currency)
		throw new Error(`Reference wage period ${label} currency differs from payroll.`);
	const value = decodeNumber(money.value);
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
	const wages = amount(row.ordinary_wages, options.currency, 'ordinary earnings');
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
}): { readonly row: ReferenceWagePeriod; readonly normalDay: number } {
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
			`Normal-wage rate requires a complete monthly wage period received or due before ${options.boundary}.`
		);
	const latestEnd = periodDates(eligible[0]!).end;
	const matches = eligible.filter((row) => periodDates(row).end === latestEnd);
	if (matches.length !== 1)
		throw new Error(`Normal-wage rate has ambiguous monthly periods ending ${latestEnd}.`);
	const row = matches[0]!;
	return { row, normalDay: amount(row.normal_wages, options.currency, 'normal wages') / 30 };
}
