/**
 * Company aggregates (E7): who the entity employs on a day and across its assessment year.
 *
 * A company-wide levy prices the entity, not a person — a quota levy on the year's average
 * headcount, a fund charged per head on a census day. The rows come from `ExpressionEngine.company`
 * (every employment of the entity with its dates, and the person's declared facts on a day); the
 * functions only count them. Every ratio, weight and rate is the stored expression's own:
 * `max(0.0, company.year.headcount_average() * 0.025 - company.year.headcount_average('disability_weight')) * 50000.0`.
 *
 * `where` names a declared person fact: a boolean counts the employment when true, a number counts
 * it at its value (a weighting), anything else counts nothing. Omitted, every employment counts once.
 * One person with two contracts on the books is one head.
 */

import { monthBounds, monthKey, shiftPeriod } from '../../payroll/run/dates.js';
import { isCalendarDate } from '../../iso-day.js';
import type { ExpressionFunctionEntry } from './index.js';
import * as Predicate from 'effect/Predicate';

/** One employment of the entity, as the aggregates count it. `to` is null while open. */
export type CompanyEmployment = {
	readonly employee_id: string;
	readonly from: string;
	readonly to: string | null;
	/** The person's declared facts on a day; absent reads every fact as undeclared. */
	readonly facts?: ((asOf: string) => Readonly<Record<string, unknown>>) | undefined;
};

/** What `ExpressionEngine.company` binds: the entity's employments and its assessment year. */
export type CompanyAccess = {
	readonly employments: readonly CompanyEmployment[];
	/** The assessment year `company.year.*` averages over, inclusive. */
	readonly year: { readonly from: string; readonly to: string };
};

const weightOf = (value: unknown): number =>
	value === true ? 1 : Predicate.isNumber(value) && Number.isFinite(value) ? value : 0;

/** The heads on the books on `date`: each person once, at the largest weight of their contracts. */
export function headcountOn(access: CompanyAccess, date: string, where = ''): number {
	if (!isCalendarDate(date)) return 0;
	const heads = new Map<string, number>();
	for (const row of access.employments) {
		if (row.from > date || (row.to != null && row.to < date)) continue;
		const weight = where === '' ? 1 : weightOf(row.facts?.(date)[where]);
		heads.set(row.employee_id, Math.max(heads.get(row.employee_id) ?? 0, weight));
	}
	let total = 0;
	for (const weight of heads.values()) total += weight;
	return total;
}

/** The mean of the month-end headcounts over every calendar month the year touches. */
export function headcountAverage(access: CompanyAccess, where = ''): number {
	const { from, to } = access.year;
	if (!isCalendarDate(from) || !isCalendarDate(to) || to < from) return 0;
	let months = 0;
	let total = 0;
	for (let month = monthKey(from); month <= monthKey(to); month = shiftPeriod(month, 1)) {
		const end = monthBounds(month).end;
		total += headcountOn(access, end < to ? end : to, where);
		months += 1;
	}
	return total / months;
}

const accessOf = (engine: { readonly company?: CompanyAccess | undefined }, fn: string) => {
	if (engine.company == null) throw new Error(`${fn}: no company employments are bound here.`);
	return engine.company;
};

export const COMPANY_FUNCTIONS: readonly ExpressionFunctionEntry[] = [
	{
		signature: 'map.headcount_on(string): double',
		handler: (engine, _company, date) =>
			headcountOn(accessOf(engine, 'company.headcount_on'), String(date)),
		doc: {
			path: "company.headcount_on(date[, 'fact'])",
			description:
				'The people the entity employs on a `YYYY-MM-DD` day; with a person fact, each counted at its value (true = 1, a number = itself)'
		}
	},
	{
		signature: 'map.headcount_on(string, string): double',
		handler: (engine, _company, date, where) =>
			headcountOn(accessOf(engine, 'company.headcount_on'), String(date), String(where))
	},
	{
		signature: 'map.headcount_average(): double',
		handler: (engine) => headcountAverage(accessOf(engine, 'company.year.headcount_average')),
		doc: {
			path: "company.year.headcount_average(['fact'])",
			description:
				'The mean month-end headcount over the assessment year; with a person fact, each person counted at its value'
		}
	},
	{
		signature: 'map.headcount_average(string): double',
		handler: (engine, _year, where) =>
			headcountAverage(accessOf(engine, 'company.year.headcount_average'), String(where))
	}
];
