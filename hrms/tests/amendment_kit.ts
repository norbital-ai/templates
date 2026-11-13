// What the tests of paid periods corrected at their source share: making and paying a run, reading a payslip and what
// it carries for an earlier period, and the open amendment rows.
import assert from 'node:assert/strict';
import type { Id } from '@norbital-ai/bolt';
import type { Kit } from '@norbital-ai/bolt-cli/test';
import { DateTime, Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, WORK, pack, storedQuery, uuid } from './kit.ts';

export const dates = (month: string) => {
	const last = new Date(
		Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)
	).getUTCDate();
	return Array.from(
		{ length: last },
		(_, index) => `${month}-${String(index + 1).padStart(2, '0')}`
	);
};
/** A month's days but its Sundays. */
export const working = (month: string) =>
	dates(month).filter((date) => new Date(`${date}T00:00:00Z`).getUTCDay() !== 0);

/** An on-cycle run for a period, unpaid. A company with several pay groups names the one it pays. */
export const run = (t: Kit, period: string, group?: string, entity: string = ENTITY) =>
	Effect.gen(function* () {
		yield* (yield* t.as(t.admin)).act({
			'payroll_run.create': [
				{
					entity_id: idOf('entity', entity),
					period,
					kind: 'ON_CYCLE',
					...(group === undefined ? {} : { pay_group_id: idOf('pay_group', group) })
				}
			]
		});
		yield* t.run_due();
		const { payroll_run } = yield* storedQuery(t, {
			payroll_run: { where: { period: { eq: period } }, limit: 10 }
		});
		const made = payroll_run.rows.find((row) => group === undefined || row.pay_group_id === group);
		assert.ok(made !== undefined, `the ${period} run`);
		return made;
	});
/** An on-cycle run for a period, paid. */
export const pay = (t: Kit, period: string, group?: string, entity: string = ENTITY) =>
	Effect.gen(function* () {
		const made = yield* run(t, period, group, entity);
		yield* (yield* t.as(t.admin)).act({
			'payroll_run.update': [{ target: made, set: { state: 'PAID' } }]
		});
		yield* t.run_due();
		return made;
	});
/** The one payslip of a period (the first person's, or the named one's). */
export const slip = (t: Kit, period: string, employee?: string) =>
	Effect.gen(function* () {
		const { payslip } = yield* storedQuery(t, {
			payslip: { where: { period: { eq: period } }, limit: 100 }
		});
		const row = payslip.rows.find((one) => employee === undefined || one.employee_id === employee);
		assert.ok(row !== undefined, `the ${period} payslip`);
		return {
			net: Number(row.net_pay),
			breakdown: Schema.decodeUnknownSync(PayslipBreakdown)(row.breakdown)
		};
	});
export const amendments = (t: Kit) =>
	storedQuery(t, { pay_amendment: { limit: 1000 } }).pipe(
		Effect.map(({ pay_amendment }) => pay_amendment.rows)
	);
export const signed = (line: { readonly direction: string; readonly amount: number }) =>
	line.direction === 'DEDUCT' ? -line.amount : line.amount;
export const cents = (value: number) => Number(value.toFixed(2));
/** A payslip's own lines (nothing it carries for an earlier period), signed, by code and party. */
export const ownLines = (t: Kit, period: string, employee?: string) =>
	slip(t, period, employee).pipe(
		Effect.map(({ breakdown }) =>
			Object.fromEntries(
				breakdown.lines
					.filter((line) => line.period === undefined)
					.map((line) => [`${line.code}/${line.party}`, cents(signed(line))])
			)
		)
	);
/** What a payslip carries for one earlier period, signed, by code and party. */
export const carriedFor = (t: Kit, on: string, period: string, employee?: string) =>
	slip(t, on, employee).pipe(
		Effect.map(({ breakdown }) =>
			Object.fromEntries(
				breakdown.lines
					.filter((line) => line.period === period)
					.map((line) => [`${line.code}/${line.party}`, cents(signed(line))])
			)
		)
	);
/** Net pay over these periods. */
export const net = (t: Kit, ...periods: readonly string[]) =>
	Effect.forEach(periods, (period) => slip(t, period)).pipe(
		Effect.map((slips) => cents(slips.reduce((total, one) => total + one.net, 0)))
	);
/** Every line these periods' payslips hold, own and carried, summed by code and party: what was paid in all. */
export const paidInAll = (t: Kit, ...periods: readonly string[]) =>
	Effect.forEach(periods, (period) => slip(t, period)).pipe(
		Effect.map((slips) => {
			const totals = new Map<string, number>();
			for (const { breakdown } of slips)
				for (const line of breakdown.lines) {
					const key = `${line.code}/${line.party}`;
					totals.set(key, (totals.get(key) ?? 0) + signed(line));
				}
			return Object.fromEntries(
				[...totals]
					.map(([key, value]) => [key, cents(value)] as const)
					.filter(([, value]) => value !== 0)
					.toSorted(([a], [b]) => a.localeCompare(b))
			);
		})
	);

// One person on the Malaysian pack, paid by the month: the fixture most of these tests correct.
const TERMS = {
	rate: { amount: 2800, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 45,
	normal_days_per_week: 6,
	statutory_work_category: 'MANUAL_LABOUR',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
export const EMPLOYMENT = idOf('employment', uuid(6));
/** These months on the roster, eight hours a working day; `overtime` keys two more hours on one day. */
export const rostered = (months: readonly string[], overtime?: string, rate = 2800) =>
	pack(
		'MY',
		'Asia/Kuala_Lumpur',
		{ ...TERMS, rate: { amount: rate, unit: 'MONTHLY' } },
		{},
		months
			.flatMap(working)
			.map((date) =>
				date === overtime
					? { date, shift: WORK, hours: 10, overtime: 2 }
					: { date, shift: WORK, hours: 8 }
			),
		[]
	);
/** Two hours of overtime keyed on a roster day that had none. */
export const overtimeKeyed = (t: Kit, date: string) =>
	Effect.gen(function* () {
		const { roster_entry } = yield* storedQuery(t, {
			roster_entry: { where: { work_date: { eq: date } }, limit: 1 }
		});
		const [day] = roster_entry.rows;
		assert.ok(day !== undefined);
		yield* (yield* t.as(t.admin)).act({
			'roster_entry.update': [
				{
					target: day,
					set: {
						actual_worked_intervals: [
							{
								start: DateTime.formatIso(DateTime.makeUnsafe(`${date}T00:00:00.000Z`)),
								end: DateTime.formatIso(DateTime.makeUnsafe(`${date}T10:00:00.000Z`))
							}
						],
						planned_overtime_intervals: [
							{
								start: DateTime.formatIso(DateTime.makeUnsafe(`${date}T08:00:00.000Z`)),
								end: DateTime.formatIso(DateTime.makeUnsafe(`${date}T10:00:00.000Z`))
							}
						]
					}
				}
			]
		});
	});
/** A medical claim HR keys for the person; answers its id. */
export const claimed = (t: Kit, quantity: number, on: string) =>
	Effect.gen(function* () {
		yield* (yield* t.as(t.admin)).act({
			'claim_catalog_entry.create': [
				{
					entity_id: ENTITY,
					employment_id: EMPLOYMENT,
					catalog_code: 'MEDICAL_CLAIM',
					quantity: String(quantity),
					incurred_on: on
				}
			]
		});
		yield* t.run_due();
		const { claim_catalog_entry } = yield* storedQuery(t, {
			claim_catalog_entry: { where: { incurred_on: { eq: on } }, limit: 10 }
		});
		const [made] = claim_catalog_entry.rows;
		assert.ok(made !== undefined);
		return made.id;
	});
/** A claim entry as stored. */
export const claimAt = (t: Kit, id: Id<'claim_catalog_entry'>) =>
	storedQuery(t, { claim_catalog_entry: { where: { id: { eq: id } }, limit: 1 } }).pipe(
		Effect.map(({ claim_catalog_entry }) => {
			const [row] = claim_catalog_entry.rows;
			assert.ok(row !== undefined);
			return row;
		})
	);
/** A raise from `from`, the first of a month: one terms row holding the new rate and nothing else. */
export const raisedFrom = (t: Kit, from: string, amount: number) =>
	Effect.gen(function* () {
		yield* (yield* t.as(t.admin)).act({
			'contract_terms.create': [
				{
					employment_id: EMPLOYMENT,
					effective_from: from,
					rate: { amount, unit: 'MONTHLY' }
				}
			]
		});
		yield* t.run_due();
	});
