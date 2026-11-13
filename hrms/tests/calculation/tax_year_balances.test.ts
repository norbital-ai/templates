// What a run reads of earlier runs comes from the balance: the tax year to date under the year's key, the months a
// formula reads under their pay month's key, twelve back and no further. Malaysia's law pack is the fixture unless a
// test says why not.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import { viewOf } from '../../src/lib/ledger/core.ts';
import { PayslipBreakdown } from '../../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import { ENTITY, accountsIn, catalogRow, pack, storedQuery, uuid, workspace } from '../kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
type Seed = ReturnType<typeof pack>;
const terms = (amount: number) => ({
	rate: { amount, unit: 'MONTHLY' },
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
});
/** One person on `amount` a month from `from`, on the Malaysian law in force `on`. */
const malaysia = (amount: number, on = '2026-06-15', from = '2025-01-01'): Seed => {
	const seed = pack('MY', 'Asia/Kuala_Lumpur', terms(amount), {}, [], [], on);
	return {
		...seed,
		employee_contract: (seed.employee_contract ?? []).map((row) => ({
			...row,
			effective_range: { from, to: null }
		}))
	};
};
const run = (t: Kit, period: string) =>
	Effect.flatMap(t.as(t.admin), (caller) =>
		caller.act({ 'payroll_run.create': [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }] })
	).pipe(Effect.andThen(t.run_due()));
const enter = (t: Kit, seed: Seed, code: string, quantity: number, on: string) =>
	Effect.flatMap(t.as(t.admin), (caller) =>
		caller.act({
			'adhoc_catalog_entry.create': [
				{
					entity_id: ENTITY,
					employment_id: CONTRACT,
					catalog_id: idOf('adhoc_catalog', catalogRow(seed, 'adhoc_catalog', code)),
					description: code,
					quantity: String(quantity),
					incurred_on: on
				}
			]
		})
	);
const slips = (t: Kit) =>
	storedQuery(t, { payslip: { limit: 100 }, payroll_run: { limit: 100 } }).pipe(
		Effect.map((got) =>
			got.payslip.rows
				.map((slip) => ({
					period: got.payroll_run.rows.find((row) => row.id === slip.payroll_run_id)?.period ?? '',
					breakdown: Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown)
				}))
				.sort((a, b) => a.period.localeCompare(b.period))
		)
	);
const months = (year: number) =>
	Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
/** What a formula reads on a pay date, as a run builds it. */
const view = (t: Kit, scope: string, payDate: string) =>
	accountsIn(t).pipe(
		Effect.map((accounts) =>
			Schema.decodeUnknownSync(
				Schema.Struct({
					ytd: Schema.Record(Schema.String, Schema.Number),
					month: Schema.Record(Schema.String, Schema.Number)
				})
			)(viewOf(accounts, scope, 1, payDate))
		)
	);

/** What each calendar year holds of a pay checkpoint, the checkpoint under it taken off, and of a statutory row paid. */
const posted = (t: Kit, benefit: string, below: string, tax: string) =>
	accountsIn(t).pipe(
		Effect.map((accounts) => {
			const years = (family: string, code: string, measure: string) =>
				Object.entries(accounts[family]?.[code] ?? {}).flatMap(([period, measures]) =>
					period.includes('.Y.') ? [[period, measures[measure] ?? 0] as const] : []
				);
			const under = new Map(years('pay', below, 'total'));
			return [
				...years('pay', benefit, 'total').map(
					([period, total]) => `${period} ${total - (under.get(period) ?? 0)}`
				),
				...years('statutory', tax, 'paid').map(([period, paid]) => `${period} ${paid}`)
			];
		})
	);
/** A run paid: what is entered after it no longer waits on its review. */
const paid = (t: Kit, period: string) =>
	Effect.gen(function* () {
		yield* run(t, period);
		const [made] = (yield* storedQuery(t, {
			payroll_run: { where: { period: { eq: period } }, limit: 1 }
		})).payroll_run.rows;
		assert.ok(made !== undefined);
		yield* (yield* t.as(t.admin)).act({
			'payroll_run.update': [{ target: made, set: { state: 'PAID' } }]
		});
		yield* t.run_due();
	});
const taxed = (t: Kit, period: string, code: string) =>
	slips(t).pipe(
		Effect.map(
			(all) =>
				all
					.find((one) => one.period === period)
					?.breakdown.statutory.find((row) => row.code === code)?.employee ?? 0
		)
	);

describe('the tax year to date', () => {
	it.live(
		'restarts at the year end, while a formula still reads the twelve months before it and no further',
		() => {
			// a salary in cents, on both sides of the read window and year end: BASIC is kept by month and year
			const salary = 3333.33;
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				for (const period of ['2026-01', '2026-02', '2026-12', '2027-01', '2027-02'])
					yield* run(t, period);
				const { ytd, month } = yield* view(t, 'MY', '2027-02-25');
				assert.ok(Math.abs((ytd['BASIC'] ?? 0) - 2 * salary) < 0.01);
				assert.equal(month['2027-02.BASIC'], salary);
				// December, past the year end, and February a year back are read; January a year back is not
				assert.equal(month['2026-12.BASIC'], salary);
				assert.equal(month['2026-02.BASIC'], salary);
				assert.equal(
					Object.keys(month).some((key) => key.startsWith('2026-01.')),
					false
				);
				// out of what a formula reads is not gone: the month stays held in the balance
				const accounts = yield* accountsIn(t);
				assert.equal(accounts.pay?.['BASIC']?.['MY.M.2026-01-01']?.['total'], salary);
				assert.ok(
					Math.abs((accounts.pay?.['BASIC']?.['MY.Y.2026-01-01']?.['total'] ?? 0) - 3 * salary) <
						0.01
				);
			}).pipe(
				Effect.provide(workspace({ seed: malaysia(salary), now: '2027-03-01T02:00:00.000Z' }))
			);
		}
	);

	// a year of 8,000 sums to 142.80000000000004 of EIS, past the digits the ledger keeps
	it.live(
		'crosses the year with float dust, and the new year’s first run can still be deleted and rerun',
		() => {
			const seed = malaysia(8000);
			const january = (t: Kit) =>
				storedQuery(t, { payroll_run: { where: { period: { eq: '2027-01' } }, limit: 1 } });
			const basic = (t: Kit) =>
				view(t, 'MY', '2027-01-25').pipe(Effect.map(({ ytd }) => ytd['BASIC']));
			const year2026 = (t: Kit) =>
				accountsIn(t).pipe(
					Effect.map((accounts) => accounts.pay?.['BASIC']?.['MY.Y.2026-01-01']?.['total'])
				);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				for (const period of [...months(2026), '2027-01']) yield* run(t, period);
				assert.equal(yield* basic(t), 8000);
				const target = (yield* january(t)).payroll_run.rows[0];
				assert.ok(target !== undefined);
				yield* (yield* t.as(t.admin)).act({ 'payroll_run.delete': [{ target }] });
				yield* t.run_due();
				assert.equal(yield* year2026(t), 12 * 8000);
				assert.equal((yield* basic(t)) ?? 0, 0);
				yield* run(t, '2027-01');
				assert.equal(yield* basic(t), 8000);
			}).pipe(Effect.provide(workspace({ seed, now: '2027-02-01T02:00:00.000Z' })));
		}
	);

	it.live("a top-up paid a month late reaches the year's tax all the same", () => {
		// joined in November: November and December are the tax year's only months
		const seed = malaysia(6000, '2026-11-15', '2026-11-01');
		const pcb = (late: boolean) =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				if (!late) yield* enter(t, seed, 'BPAYBS', 30_000, '2026-11-10');
				yield* run(t, '2026-11');
				if (late) yield* enter(t, seed, 'BPAYBS', 30_000, '2026-12-10');
				yield* run(t, '2026-12');
				const november = yield* taxed(t, '2026-11', 'PCB');
				const december = yield* taxed(t, '2026-12', 'PCB');
				return { december, total: Number((november + december).toFixed(2)) };
			}).pipe(Effect.provide(workspace({ seed, now: '2026-12-20T02:00:00.000Z' })));
		return Effect.gen(function* () {
			const on = yield* pcb(false);
			const late = yield* pcb(true);
			assert.ok(on.total > 0);
			assert.equal(late.total, on.total);
			assert.ok(late.december > on.december);
		});
	});
});

describe('a benefit', () => {
	it.live('posts what sits above the checkpoint under it, under the year’s key', () => {
		const BONUS = 20_000;
		const seed = malaysia(10_000, '2026-03-15');
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* enter(t, seed, 'BONUS', BONUS, '2026-03-10');
			yield* paid(t, '2026-03');
			const tax = yield* taxed(t, '2026-03', 'PCB');
			assert.ok(tax > 0);
			assert.deepEqual(yield* posted(t, 'ADDITIONAL_WAGES', 'ORDINARY_WAGES', 'PCB.employee'), [
				`MY.Y.2026-01-01 ${BONUS}`,
				`MY.Y.2026-01-01 ${tax}`
			]);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-04-20T02:00:00.000Z' })));
	});

	// Kept on ID: only its pension tax row reads what earlier calendar years posted (`balances.years`); no Malaysian row
	// reads a year behind the current one.
	it.live(
		'over two calendar years: the second year’s row reads what the first posted, each year under its own key',
		() => {
			const PAID = 100_000_000;
			const TAX = 'PPH21_FINAL_PENSION';
			const base = pack(
				'ID',
				'Asia/Jakarta',
				terms(10_000_000),
				{ pension_tax_history: { first_payment_year: 2026 } },
				[],
				[],
				'2026-06-15'
			);
			const seed: Seed = {
				...base,
				entity_profile_version: (base.entity_profile_version ?? []).map((row) => ({
					...row,
					entity_extension_data: { risk_class: 'I' }
				})),
				employee_contract: (base.employee_contract ?? []).map((row) => ({
					...row,
					effective_range: { from: '2026-01-01', to: null }
				}))
			};
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* enter(t, seed, 'PENSION_LUMPSUM', PAID, '2026-03-10');
				yield* paid(t, '2026-03');
				const first = yield* taxed(t, '2026-03', TAX);
				yield* enter(t, seed, 'PENSION_LUMPSUM', PAID, '2027-04-10');
				yield* paid(t, '2027-04');
				const second = yield* taxed(t, '2027-04', TAX);
				// the same payment twice: only the first year's posting, read from the balance, can make the second differ
				assert.ok(first > 0);
				assert.notEqual(second, first);
				assert.deepEqual(yield* posted(t, 'PENSION_BENEFIT', 'SEVERANCE', `${TAX}.employee`), [
					`ID.Y.2026-01-01 ${PAID}`,
					`ID.Y.2027-01-01 ${PAID}`,
					`ID.Y.2026-01-01 ${first}`,
					`ID.Y.2027-01-01 ${second}`
				]);
			}).pipe(Effect.provide(workspace({ seed, now: '2027-04-20T02:00:00.000Z' })));
		}
	);
});

describe('a statutory row below zero with a refund route', () => {
	// Kept on ID: its PPH21 settles the year in December and comes back below zero after an earlier month over-withheld;
	// every Malaysian row charges month to date and never over-collects, so none returns below zero unless its
	// expression is rewritten.
	it.live(
		'pays the refund once on the run, and the balance holds what was withheld less what came back',
		() => {
			const seed = pack('ID', 'Asia/Jakarta', terms(10_000_000), {}, [], [], '2026-06-15');
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				// a one-month spike withholds at that month's high rate; December settles the year and comes back negative
				yield* enter(t, seed, 'BONUS_THR', 200_000_000, '2026-10-10');
				for (const period of ['2026-10', '2026-11', '2026-12']) yield* run(t, period);
				const all = yield* slips(t);
				const december = all.find((row) => row.period === '2026-12');
				const refunds = (december?.breakdown.statutory ?? []).filter((row) => row.employee < 0);
				assert.ok(refunds.length > 0, 'December refunded nothing');
				for (const { code, employee } of refunds) {
					const line = december?.breakdown.lines.find((row) => row.code === code);
					assert.equal(line?.direction, 'ADD');
					assert.equal(line?.amount, -employee);
				}
				const accounts = yield* accountsIn(t);
				for (const { code } of refunds) {
					const charged = all.reduce(
						(sum, row) =>
							sum + (row.breakdown.statutory.find((one) => one.code === code)?.employee ?? 0),
						0
					);
					assert.ok(
						Math.abs(
							(accounts.statutory?.[`${code}.employee`]?.['ID.Y.2026-01-01']?.['paid'] ?? 0) -
								charged
						) < 0.01
					);
				}
				// the refund is paid once
				yield* run(t, '2027-01');
				const january = (yield* slips(t)).find((row) => row.period === '2027-01');
				for (const { code } of refunds)
					assert.notEqual(
						january?.breakdown.lines.find((row) => row.code === code)?.direction,
						'ADD'
					);
			}).pipe(Effect.provide(workspace({ seed, now: '2027-02-20T02:00:00.000Z' })));
		}
	);
});
