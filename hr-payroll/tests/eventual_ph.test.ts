// On the Philippines' law pack. A wrong payment is corrected by later cycles: each statutory row charges what the month's
// total owes less what the month already charged. A no-pay day is a catalog line at PAID_BASIC.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, pack, uuid, workspace, leaveCreate, storedQuery } from './kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
type Seed = ReturnType<typeof pack>;
type Row = Seed[string][number];
type Allowances = Record<string, { readonly amount: number }>;
/** The fixture: an off-cycle wage item, a salary, and an amount that crosses a tax band on top of it. */
const ITEM = 'BACKPAY_BASIC';
const SALARY = 60_000;
const EXTRA = 300_000;
const TAX = 'WTAX.employee';
const WAGES = 'ORDINARY_WAGES';
const terms = (amount: number, allowances: Allowances = {}, unit = 'MONTHLY') => ({
	rate: { amount, unit },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'RESIDENT',
	wage_payment_method: 'BANK',
	allowances
});
const seedOf = (
	contract: ReturnType<typeof terms>,
	from = '2026-01-01',
	on = '2026-06-15'
): Seed => {
	const seed = pack('PH', 'Asia/Manila', contract, {}, [], [], on);
	return {
		...seed,
		employee_contract: (seed.employee_contract ?? []).map((row) => ({
			...row,
			effective_range: { from, to: null }
		}))
	};
};
const reschedule = (seed: Seed, payment_schedule: Row[string]): Seed => ({
	...seed,
	pay_group: (seed.pay_group ?? []).map((row) => ({
		...row,
		payment_schedule
	}))
});
const TWICE = {
	frequency: 'SEMI_MONTHLY',
	business_day: 'PREVIOUS',
	non_working_weekdays: [0, 6],
	short_month: 'LAST_DAY',
	pay_days: [15, 31]
};
const catalogId = <M extends 'adhoc_catalog' | 'leave_catalog'>(
	seed: Seed,
	model: M,
	code: string
) => {
	const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
	const row = seed[model]?.find((item) => item.code === code && item.settings_id === version);
	assert.ok(row !== undefined, code);
	return idOf(model, String(row.id));
};
const onCycle = (t: Kit, period: string) =>
	Effect.flatMap(t.as(t.admin), (caller) =>
		caller.act({ 'payroll_run.create': [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }] })
	).pipe(Effect.andThen(t.run_due()));
/** The period's on-cycle run, paid: what is entered for the period after it no longer waits on its review. */
const paidCycle = (t: Kit, period: string) =>
	Effect.gen(function* () {
		yield* onCycle(t, period);
		const [run] = (yield* storedQuery(t, {
			payroll_run: { where: { period: { eq: period } }, limit: 1 }
		})).payroll_run.rows;
		assert.ok(run !== undefined);
		yield* (yield* t.as(t.admin)).act({
			'payroll_run.update': [{ target: run, set: { state: 'PAID' } }]
		});
		yield* t.run_due();
	});
const adhoc = (t: Kit, seed: Seed, item: string, amount: number, on: string) =>
	Effect.flatMap(t.as(t.admin), (caller) =>
		caller.act({
			'adhoc_catalog_entry.create': [
				{
					entity_id: ENTITY,
					employment_id: CONTRACT,
					catalog_id: catalogId(seed, 'adhoc_catalog', item),
					description: 'Adjustment',
					quantity: amount,
					incurred_on: PlainDate(on)
				}
			]
		})
	);
const offCycle = (t: Kit, seed: Seed, item: string, amount: number, period: string) =>
	Effect.gen(function* () {
		yield* adhoc(t, seed, item, amount, `${period}-10`);
		const open = (yield* storedQuery(t, {
			adhoc_catalog_entry: { where: { payroll_run_id: { is_null: true } }, limit: 1 }
		})).adhoc_catalog_entry.rows[0];
		assert.ok(open !== undefined);
		yield* (yield* t.as(t.admin)).act({
			'payroll_run.create': [
				{
					entity_id: ENTITY,
					period,
					kind: 'OFF_CYCLE',
					adhoc: [{ id: open.id, revision: open.revision }]
				}
			]
		});
		yield* t.run_due();
	});
const slips = (t: Kit, period: string) =>
	storedQuery(t, { payslip: { limit: 100 }, payroll_run: { limit: 100 } }).pipe(
		Effect.map((got) =>
			got.payroll_run.rows
				.filter((run) => run.period.startsWith(period))
				.toSorted(
					(left, right) =>
						left.period.localeCompare(right.period) || right.kind.localeCompare(left.kind)
				)
				.flatMap((run) => {
					const slip = got.payslip.rows.find((row) => row.payroll_run_id === run.id);
					return slip === undefined
						? []
						: [
								{
									...Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown),
									net: slip.net_pay.to_number()
								}
							];
				})
		)
	);
/** Every statutory row a period charged, both sides: a refund counts against it. */
const charged = (t: Kit, period: string) =>
	slips(t, period).pipe(
		Effect.map((runs) => {
			const totals = new Map<string, number>();
			const add = (key: string, value: number) => totals.set(key, (totals.get(key) ?? 0) + value);
			for (const { statutory } of runs)
				for (const row of statutory) {
					add(`${row.code}.employee`, row.employee);
					add(`${row.code}.employer`, row.employer);
				}
			return Object.fromEntries(
				[...totals]
					.map(([key, value]) => [key, Number(value.toFixed(2))] as const)
					.filter(([, value]) => value !== 0)
					.sort(([left], [right]) => left.localeCompare(right))
			);
		})
	);
const checkpoint = (
	rows: readonly { readonly code: string; readonly value: number }[],
	code: string
) => rows.find((row) => row.code === code)?.value ?? 0;
const within = (actual: number, expected: number, tolerance = 0.02) =>
	assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected}`);
const NOW = '2026-06-20T02:00:00.000Z';
const inWorkspace = <A, E>(
	seed: Seed,
	now: string,
	body: (t: Kit) => Effect.Effect<A, E, TestWorkspace>
) =>
	Effect.gen(function* () {
		return yield* body(yield* TestWorkspace);
	}).pipe(Effect.provide(workspace({ seed, now })));

describe('short, then topped up in the same month', () => {
	it.live('the two runs owe what one run of the total owes', () => {
		const seed = seedOf(terms(SALARY));
		return Effect.gen(function* () {
			const whole = yield* inWorkspace(seed, NOW, (t) =>
				adhoc(t, seed, ITEM, EXTRA, '2026-06-10').pipe(
					Effect.andThen(onCycle(t, '2026-06')),
					Effect.andThen(charged(t, '2026-06'))
				)
			);
			const topped = yield* inWorkspace(seed, NOW, (t) =>
				paidCycle(t, '2026-06').pipe(
					Effect.andThen(offCycle(t, seed, ITEM, EXTRA, '2026-06')),
					Effect.andThen(charged(t, '2026-06'))
				)
			);
			// WTAX_TAXABLE_PAY is the memo an on-cycle run keeps of its own taxable pay, not a charge: an off-cycle run writes none
			const owed = (rows: Readonly<Record<string, number>>) =>
				Object.entries(rows).filter(([key]) => !key.startsWith('WTAX_TAXABLE_PAY'));
			assert.deepEqual(owed(topped), owed(whole));
			assert.ok(Number(whole[TAX]) > 0);
		});
	});
});

describe('corrected in the next month', () => {
	const DECEMBER = '2026-12-20T02:00:00.000Z';
	const seed = seedOf(terms(SALARY), '2026-11-01', '2026-11-15');
	const tax = (t: Kit) =>
		Effect.gen(function* () {
			const november = yield* charged(t, '2026-11');
			const december = yield* charged(t, '2026-12');
			return {
				december: Number(december[TAX] ?? 0),
				total: Number((Number(november[TAX] ?? 0) + Number(december[TAX] ?? 0)).toFixed(2))
			};
		});
	it.live("a top-up in the next run reaches the year's tax", () =>
		Effect.gen(function* () {
			const on = yield* inWorkspace(seed, DECEMBER, (t) =>
				Effect.gen(function* () {
					yield* adhoc(t, seed, ITEM, EXTRA, '2026-11-10');
					yield* onCycle(t, '2026-11');
					yield* onCycle(t, '2026-12');
					return yield* tax(t);
				})
			);
			const late = yield* inWorkspace(seed, DECEMBER, (t) =>
				Effect.gen(function* () {
					yield* onCycle(t, '2026-11');
					yield* adhoc(t, seed, ITEM, EXTRA, '2026-12-10');
					yield* onCycle(t, '2026-12');
					return yield* tax(t);
				})
			);
			assert.equal(late.total, on.total);
			assert.ok(late.december > on.december);
		})
	);
});

describe('twice a month', () => {
	it.live("the month's two runs withhold what one run withholds", () => {
		const monthly = seedOf(terms(120_000, { transport: { amount: 3100 } }));
		const twice = reschedule(monthly, TWICE);
		return Effect.gen(function* () {
			const whole = yield* inWorkspace(monthly, NOW, (t) =>
				onCycle(t, '2026-06').pipe(Effect.andThen(charged(t, '2026-06')))
			);
			const halves = yield* inWorkspace(twice, '2026-07-05T02:00:00.000Z', (t) =>
				onCycle(t, '2026-06-1').pipe(
					Effect.andThen(onCycle(t, '2026-06-2')),
					Effect.andThen(charged(t, '2026-06'))
				)
			);
			assert.ok(Number(whole[TAX]) > 0);
			assert.deepEqual(halves, whole);
		});
	});

	it.live('a second half with no pay still settles the month', () => {
		const seed = reschedule(seedOf(terms(120_000)), TWICE);
		const noPay = catalogId(seed, 'leave_catalog', 'NPL');
		const days = ['16', '17', '18', '19', '22', '23', '24', '25', '26', '29', '30'].flatMap(
			(day) => [
				{ date: PlainDate(`2026-06-${day}`), part: 'AM' as const },
				{ date: PlainDate(`2026-06-${day}`), part: 'PM' as const }
			]
		);
		return inWorkspace(seed, '2026-07-05T02:00:00.000Z', (t) =>
			Effect.gen(function* () {
				yield* onCycle(t, '2026-06-1');
				yield* (yield* t.as(t.admin)).act({
					'leave_catalog_entry.create': [
						leaveCreate({
							entity_id: ENTITY,
							employment_id: CONTRACT,
							catalog_id: noPay,
							days
						})
					]
				});
				yield* onCycle(t, '2026-06-2');
				const [, second] = yield* slips(t, '2026-06');
				assert.ok(second !== undefined);
				within(checkpoint(second.checkpoints, WAGES), 0);
				// the first half withheld on a full month: the second gives the difference back
				assert.ok(Number(second.statutory.find((row) => row.code === 'WTAX')?.employee ?? 0) < 0);
			})
		);
	});
});

const whole = (date: string) => [
	{ date: PlainDate(date), part: 'AM' as const },
	{ date: PlainDate(date), part: 'PM' as const }
];
const leave = (t: Kit, seed: Seed, days: ReturnType<typeof whole>) =>
	Effect.flatMap(t.as(t.admin), (caller) =>
		caller.act({
			'leave_catalog_entry.create': [
				leaveCreate({
					entity_id: ENTITY,
					employment_id: CONTRACT,
					catalog_id: catalogId(seed, 'leave_catalog', 'NPL'),
					days
				})
			]
		})
	);
const lineOf = (lines: PayslipBreakdown['lines'], code: string) =>
	lines
		.filter((line) => line.code === code)
		.reduce((total, line) => total + line.amount * (line.direction === 'DEDUCT' ? -1 : 1), 0);

describe('a raise inside the month', () => {
	it.live('pays the earlier salary and the raise for the days after it', () => {
		const earlier = seedOf(terms(40_000));
		const [first] = earlier.employee_contract ?? [];
		assert.ok(first !== undefined);
		const seed: Seed = {
			...earlier,
			employee_contract: [
				{ ...first, effective_range: { from: '2026-01-01', to: '2026-06-25' } },
				{
					...first,
					id: uuid(61),
					effective_range: { from: '2026-06-26', to: null },
					terms: terms(43_000)
				}
			]
		};
		return inWorkspace(seed, NOW, (t) =>
			Effect.gen(function* () {
				yield* onCycle(t, '2026-06');
				const [slip] = yield* slips(t, '2026-06');
				assert.ok(slip !== undefined);
				// 26, 29 and 30 June at the raise's day rate: 3,000 × 12 ÷ 261 a day
				assert.equal(
					checkpoint(slip.checkpoints, 'PAID_BASIC'),
					40_000 + Math.round(((3 * 3000 * 12) / 261) * 100) / 100
				);
			})
		);
	});
});

describe('a no-pay day', () => {
	it.live('the law rounds what the days take, not the day rate first', () => {
		// 21,774 × 12 ÷ 261 = 1,001.1034… a day: three days take 3,003.31; at the rate rounded first, 3,003.30
		const seed = seedOf(terms(21_774));
		return inWorkspace(seed, NOW, (t) =>
			Effect.gen(function* () {
				yield* leave(t, seed, [
					...whole('2026-06-10'),
					...whole('2026-06-11'),
					...whole('2026-06-12')
				]);
				yield* onCycle(t, '2026-06');
				const [slip] = yield* slips(t, '2026-06');
				assert.ok(slip !== undefined);
				assert.equal(lineOf(slip.lines, 'NPL'), -3003.31);
			})
		);
	});

	it.live('a daily rate takes its day at the rate', () => {
		const rate = 2000;
		const seed = seedOf(terms(rate, {}, 'DAILY'));
		return inWorkspace(seed, NOW, (t) =>
			Effect.gen(function* () {
				yield* leave(t, seed, whole('2026-06-10'));
				yield* onCycle(t, '2026-06');
				const [slip] = yield* slips(t, '2026-06');
				assert.ok(slip !== undefined);
				// June's 22 weekdays at the rate, less the day's line
				within(lineOf(slip.lines, 'NPL'), -rate);
				within(checkpoint(slip.checkpoints, 'BASIC'), rate * 22);
				within(checkpoint(slip.checkpoints, 'PAID_BASIC'), rate * 21);
			})
		);
	});
});
