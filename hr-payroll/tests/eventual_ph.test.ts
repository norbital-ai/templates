// On the Philippines' law pack. A wrong payment is corrected by later cycles: each statutory row charges what the month's
// total owes less what the month already charged. A no-pay day is a catalog line at PAID_BASIC, so a reversal after payment pays it back.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	pack,
	sealedAdhoc,
	sealedLeave,
	uuid,
	workspace,
	leaveCreate,
	reversalSlots
} from './kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
type Seed = ReturnType<typeof pack>;
type Row = Seed[string][number];
type Allowances = Record<string, { readonly amount: number }>;
/** The fixture: an off-cycle wage item, a salary, an amount that crosses a tax band on top of it, and two flat allowances. */
const ITEM = 'BACKPAY_BASIC';
const SALARY = 60_000;
const EXTRA = 300_000;
const TAX = 'WTAX.employee';
const ALLOWANCES: Allowances = { transport: { amount: 2200 }, meal: { amount: 2000 } };
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
	t
		.as(t.admin)
		.act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }])
		.pipe(Effect.andThen(t.runDue()));
const adhoc = (
	t: Kit,
	seed: Seed,
	item: string,
	amount: number,
	on: string,
	reverses: Id<'adhoc_catalog_entry'> | null = null
) =>
	t.as(t.admin).act('adhoc_catalog_entry.create', [
		{
			entity_id: ENTITY,
			employment_id: CONTRACT,
			catalog_id: catalogId(seed, 'adhoc_catalog', item),
			description: 'Adjustment',
			quantity: amount,
			incurred_on: PlainDate(on),
			reverses
		}
	]);
const offCycle = (
	t: Kit,
	seed: Seed,
	item: string,
	amount: number,
	period: string,
	reverses: Id<'adhoc_catalog_entry'> | null = null
) =>
	Effect.gen(function* () {
		yield* adhoc(t, seed, item, amount, `${period}-10`, reverses);
		const open = (yield* t.storedQuery({
			adhoc_catalog_entry: { where: { payroll_run_id: { isNull: true } }, limit: 1 }
		})).adhoc_catalog_entry.rows[0];
		assert.ok(open !== undefined);
		yield* t.as(t.admin).act('payroll_run.create', [
			{
				entity_id: ENTITY,
				period,
				kind: 'OFF_CYCLE',
				attaches: { adhoc: [idOf('adhoc_catalog_entry', open.id)] }
			}
		]);
		yield* t.runDue();
	});
const slips = (t: Kit, period: string) =>
	t.storedQuery({ payslip: { limit: 100 }, payroll_run: { limit: 100 } }).pipe(
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
									net: slip.net_pay.toNumber()
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
				onCycle(t, '2026-06').pipe(
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
	it.live("a reversal in the next run takes it back out of the year's tax", () =>
		Effect.gen(function* () {
			const right = yield* inWorkspace(seed, DECEMBER, (t) =>
				Effect.gen(function* () {
					yield* onCycle(t, '2026-11');
					yield* onCycle(t, '2026-12');
					return yield* tax(t);
				})
			);
			const corrected = yield* inWorkspace(seed, DECEMBER, (t) =>
				Effect.gen(function* () {
					yield* adhoc(t, seed, ITEM, EXTRA, '2026-11-10');
					yield* onCycle(t, '2026-11');
					yield* adhoc(t, seed, ITEM, EXTRA, '2026-12-10', yield* sealedAdhoc(t));
					yield* onCycle(t, '2026-12');
					return yield* tax(t);
				})
			);
			assert.equal(corrected.total, right.total);
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
				yield* t.as(t.admin).act('leave_catalog_entry.create', [
					leaveCreate({
						entity_id: ENTITY,
						employment_id: CONTRACT,
						catalog_id: noPay,
						days
					})
				]);
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
const leave = (
	t: Kit,
	seed: Seed,
	days: ReturnType<typeof whole>,
	reverses: Id<'leave_catalog_entry'> | null = null
) =>
	Effect.gen(function* () {
		const selected = reverses == null ? days : yield* reversalSlots(t, reverses);
		yield* t.as(t.admin).act('leave_catalog_entry.create', [
			leaveCreate({
				entity_id: ENTITY,
				employment_id: CONTRACT,
				catalog_id: catalogId(seed, 'leave_catalog', 'NPL'),
				days: selected,
				reverses
			})
		]);
	});
const lineOf = (lines: PayslipBreakdown['lines'], code: string) =>
	lines
		.filter((line) => line.code === code)
		.reduce((total, line) => total + line.amount * (line.direction === 'DEDUCT' ? -1 : 1), 0);

describe('a no-pay day', () => {
	const monthly = seedOf(terms(44_000, ALLOWANCES));

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

	it.live('reversed across a 30/31-day boundary, the next run pays back what June took', () =>
		inWorkspace(monthly, '2026-07-20T02:00:00.000Z', (t) =>
			Effect.gen(function* () {
				yield* leave(t, monthly, whole('2026-06-10'));
				yield* onCycle(t, '2026-06');
				yield* leave(t, monthly, whole('2026-07-06'), yield* sealedLeave(t));
				yield* onCycle(t, '2026-07');
				yield* onCycle(t, '2026-08');
				const [june] = yield* slips(t, '2026-06');
				const [july] = yield* slips(t, '2026-07');
				const [august] = yield* slips(t, '2026-08');
				assert.ok(june !== undefined && july !== undefined && august !== undefined);
				const full = checkpoint(august.checkpoints, WAGES);
				const taken = full - checkpoint(june.checkpoints, WAGES);
				assert.ok(taken > 0);
				// a reversal is priced like the line it undoes; an allowance that fell with the day gives it back on its own line
				within(lineOf(july.lines, 'NPL'), -lineOf(june.lines, 'NPL'));
				for (const code of Object.keys(ALLOWANCES))
					within(
						lineOf(july.lines, code) - lineOf(august.lines, code),
						lineOf(august.lines, code) - lineOf(june.lines, code)
					);
				within(checkpoint(july.checkpoints, WAGES), full + taken);
				assert.equal(lineOf(august.lines, 'NPL'), 0);
			})
		)
	);

	it.live("twice a month, a reversal in the next half pays back that half's day", () => {
		const seed = reschedule(monthly, TWICE);
		return inWorkspace(seed, '2026-07-05T02:00:00.000Z', (t) =>
			Effect.gen(function* () {
				yield* leave(t, seed, whole('2026-06-10'));
				yield* onCycle(t, '2026-06-1');
				yield* leave(t, seed, whole('2026-06-22'), yield* sealedLeave(t));
				yield* onCycle(t, '2026-06-2');
				const [first, second] = yield* slips(t, '2026-06');
				assert.ok(first !== undefined && second !== undefined);
				const taken = lineOf(first.lines, 'NPL');
				assert.ok(taken < 0);
				within(lineOf(second.lines, 'NPL'), -taken);
			})
		);
	});
});
