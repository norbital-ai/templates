// A wrong payment is corrected by later cycles: each statutory row charges what the month's total owes less what the
// month already charged. A no-pay day is a catalog line at PAID_BASIC, so a reversal after payment pays it back.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { jsonObject } from '../src/lib/payroll_engine/foundation.ts';
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
type Country = {
	readonly code: string;
	readonly zone: string;
	/** An off-cycle wage item, a salary, and an amount that crosses a band on top of it. */
	readonly item: string;
	readonly salary: number;
	readonly extra: number;
	readonly tax: string;
	readonly allowances: Allowances;
	readonly noPayLines: readonly string[];
	/** What each pay checkpoint is called, whichever law. */
	readonly wages: string;
};
const COUNTRIES: Readonly<Record<string, Country>> = {
	Philippines: {
		code: 'PH',
		zone: 'Asia/Manila',
		item: 'BACKPAY_BASIC',
		salary: 60_000,
		extra: 300_000,
		tax: 'WTAX',
		allowances: { transport: { amount: 2200 }, meal: { amount: 2000 } },
		noPayLines: ['NPL', 'transport', 'meal'],
		wages: 'ORDINARY_WAGES'
	},
	Vietnam: {
		code: 'VN',
		zone: 'Asia/Ho_Chi_Minh',
		item: 'BONUS',
		salary: 30_000_000,
		extra: 90_000_000,
		tax: 'PIT',
		allowances: { FIXED_ALLOWANCE: { amount: 2_200_000 } },
		noPayLines: ['NPL', 'FIXED_ALLOWANCE'],
		wages: 'ORDINARY_WAGES'
	}
};
const countries = Object.entries(COUNTRIES);

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
	{ code, zone }: Country,
	contract: ReturnType<typeof terms>,
	from = '2026-01-01',
	extension: Parameters<typeof pack>[3] = {},
	on = '2026-06-15'
): Seed => {
	const seed = pack(code, zone, contract, extension, [], [], on);
	return {
		...seed,
		employee_contract: (seed.employee_contract ?? []).map((row) => ({
			...row,
			effective_range: { from, to: null }
		}))
	};
};
// The seeded law ends 2026-11-30: here the last sealed version stays in force, so a year can close and Decree 393 commence.
const lasting = (seed: Seed): Seed => {
	const law = seed.entity_profile_version?.[0]?.input_schema_version_id;
	return {
		...seed,
		jurisdiction_settings: (seed.jurisdiction_settings ?? []).map((row) =>
			row.id === law
				? { ...row, effective_range: { ...jsonObject(row.effective_range), to: null } }
				: row
		)
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
// 1 August 2026 is a Saturday, so August's salary is paid on 31 July, in July's pay month
const ON_THE_FIRST = {
	frequency: 'MONTHLY',
	business_day: 'PREVIOUS',
	non_working_weekdays: [0, 6],
	short_month: 'LAST_DAY',
	pay_days: [1]
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
	for (const [name, one] of countries)
		it.live(`${name}: the two runs owe what one run of the total owes`, () => {
			const seed = seedOf(one, terms(one.salary));
			return Effect.gen(function* () {
				const whole = yield* inWorkspace(seed, NOW, (t) =>
					adhoc(t, seed, one.item, one.extra, '2026-06-10').pipe(
						Effect.andThen(onCycle(t, '2026-06')),
						Effect.andThen(charged(t, '2026-06'))
					)
				);
				const topped = yield* inWorkspace(seed, NOW, (t) =>
					onCycle(t, '2026-06').pipe(
						Effect.andThen(offCycle(t, seed, one.item, one.extra, '2026-06')),
						Effect.andThen(charged(t, '2026-06'))
					)
				);
				// WTAX_TAXABLE_PAY is the memo an on-cycle run keeps of its own taxable pay, not a charge: an off-cycle run writes none
				const owed = (rows: Readonly<Record<string, number>>) =>
					Object.entries(rows).filter(([key]) => !key.startsWith('WTAX_TAXABLE_PAY'));
				assert.deepEqual(owed(topped), owed(whole));
				assert.ok(Number(whole[`${one.tax}.employee`]) > 0);
			});
		});

	it.live('Vietnam: the housing ceiling follows the month, not the run', () => {
		const one = COUNTRIES['Vietnam'];
		assert.ok(one !== undefined);
		const seed = seedOf(one, terms(one.salary, { HOUSING: { amount: 10_000_000 } }));
		return Effect.gen(function* () {
			const whole = yield* inWorkspace(seed, NOW, (t) =>
				adhoc(t, seed, one.item, one.extra, '2026-06-10').pipe(
					Effect.andThen(onCycle(t, '2026-06')),
					Effect.andThen(charged(t, '2026-06'))
				)
			);
			const topped = yield* inWorkspace(seed, NOW, (t) =>
				onCycle(t, '2026-06').pipe(
					Effect.andThen(offCycle(t, seed, one.item, one.extra, '2026-06')),
					Effect.andThen(charged(t, '2026-06'))
				)
			);
			assert.deepEqual(topped, whole);
		});
	});

	it.live(
		'Philippines: an off-cycle wage item that crosses a salary credit charges the month',
		() => {
			const one = COUNTRIES['Philippines'];
			assert.ok(one !== undefined);
			const base = seedOf(one, terms(20_000));
			const seed: Seed = {
				...base,
				adhoc_catalog: (base.adhoc_catalog ?? []).map((row) =>
					row.code === 'COMMISSION' ? { ...row, off_cycle_eligible: true } : row
				)
			};
			return Effect.gen(function* () {
				const whole = yield* inWorkspace(seed, NOW, (t) =>
					adhoc(t, seed, 'COMMISSION', 30_000, '2026-06-10').pipe(
						Effect.andThen(onCycle(t, '2026-06')),
						Effect.andThen(charged(t, '2026-06'))
					)
				);
				const topped = yield* inWorkspace(seed, NOW, (t) =>
					onCycle(t, '2026-06').pipe(
						Effect.andThen(offCycle(t, seed, 'COMMISSION', 30_000, '2026-06')),
						Effect.andThen(charged(t, '2026-06'))
					)
				);
				const contributions = (rows: Readonly<Record<string, number>>) =>
					Object.entries(rows).filter(([key]) => /^(SSS|HDMF)/.test(key));
				assert.deepEqual(contributions(topped), contributions(whole));
			});
		}
	);
});

describe('paid too much, reversed in the next on-cycle run', () => {
	const one = COUNTRIES['Philippines'];
	assert.ok(one !== undefined);
	const overpaid = 30_000;
	it.live('Philippines: off-cycle in the same month it is refused', () => {
		const seed = seedOf(one, terms(one.salary));
		return inWorkspace(seed, NOW, (t) =>
			Effect.gen(function* () {
				yield* adhoc(t, seed, one.item, overpaid, '2026-06-10');
				yield* onCycle(t, '2026-06');
				const refused = yield* Effect.flip(
					offCycle(t, seed, one.item, overpaid, '2026-06', yield* sealedAdhoc(t))
				);
				assert.match(
					String(refused),
					/This run would take someone below zero\. A reversal goes in the next on-cycle run\./
				);
			})
		);
	});
	// A commission is an ordinary wage, so SSS and the month's withholding read it; PhilHealth stands on the basic salary.
	const reversed = (t: Kit, seed: Seed, first: string, second: string) =>
		Effect.gen(function* () {
			yield* adhoc(t, seed, 'COMMISSION', overpaid, `${first}-10`);
			yield* onCycle(t, first);
			yield* adhoc(t, seed, 'COMMISSION', overpaid, `${second}-10`, yield* sealedAdhoc(t));
			yield* onCycle(t, second);
			const [taken] = yield* slips(t, second);
			assert.ok(taken !== undefined);
			assert.ok(taken.lines.every((line) => line.amount >= 0));
			// a row that repays does so on an ADD line, and only that
			for (const { code, employee } of taken.statutory)
				if (employee < 0)
					assert.equal(taken.lines.find((line) => line.code === code)?.direction, 'ADD', code);
		});
	it.live('Philippines: December’s annualisation nets the two months', () => {
		const seed = lasting(seedOf(one, terms(one.salary), '2026-11-01', {}, '2026-11-15'));
		const DECEMBER = '2026-12-20T02:00:00.000Z';
		const withheld = (t: Kit) =>
			Effect.all([charged(t, '2026-11'), charged(t, '2026-12')]).pipe(
				Effect.map(([november, december]) =>
					Number(
						(
							Number(november['WTAX.employee'] ?? 0) + Number(december['WTAX.employee'] ?? 0)
						).toFixed(2)
					)
				)
			);
		return Effect.gen(function* () {
			const right = yield* inWorkspace(seed, DECEMBER, (t) =>
				onCycle(t, '2026-11').pipe(
					Effect.andThen(onCycle(t, '2026-12')),
					Effect.andThen(withheld(t))
				)
			);
			const corrected = yield* inWorkspace(seed, DECEMBER, (t) =>
				reversed(t, seed, '2026-11', '2026-12').pipe(Effect.andThen(withheld(t)))
			);
			assert.equal(corrected, right);
		});
	});
});

describe('Vietnam: paid too much, reversed in the next on-cycle run', () => {
	const one = COUNTRIES['Vietnam'];
	assert.ok(one !== undefined);
	const overpaid = 10_000_000;
	it.live('off-cycle in the same month it is refused', () => {
		const seed = seedOf(one, terms(one.salary));
		return inWorkspace(seed, NOW, (t) =>
			Effect.gen(function* () {
				yield* adhoc(t, seed, one.item, one.extra, '2026-06-10');
				yield* onCycle(t, '2026-06');
				const refused = yield* Effect.flip(
					offCycle(t, seed, one.item, one.extra, '2026-06', yield* sealedAdhoc(t))
				);
				assert.match(
					String(refused),
					/This run would take someone below zero\. A reversal goes in the next on-cycle run\./
				);
			})
		);
	});
	it.live('June’s tax counts the lower wages, no negative line', () => {
		const seed = seedOf(one, terms(one.salary), '2026-01-01', {}, '2026-05-15');
		const tax = `${one.tax}.employee`;
		return Effect.gen(function* () {
			const right = yield* inWorkspace(seed, NOW, (t) =>
				onCycle(t, '2026-05').pipe(
					Effect.andThen(onCycle(t, '2026-06')),
					Effect.andThen(charged(t, '2026-06'))
				)
			);
			const june = yield* inWorkspace(seed, NOW, (t) =>
				Effect.gen(function* () {
					yield* adhoc(t, seed, one.item, overpaid, '2026-05-10');
					yield* onCycle(t, '2026-05');
					yield* adhoc(t, seed, one.item, overpaid, '2026-06-10', yield* sealedAdhoc(t));
					yield* onCycle(t, '2026-06');
					for (const slip of [...(yield* slips(t, '2026-05')), ...(yield* slips(t, '2026-06'))]) {
						assert.ok(slip.lines.every((line) => line.amount >= 0));
						assert.ok(slip.statutory.every((row) => row.employee >= 0));
					}
					return yield* charged(t, '2026-06');
				})
			);
			assert.ok(Number(june[tax]) > 0);
			assert.ok(Number(june[tax]) < Number(right[tax]));
		});
	});
});

describe('corrected in the next month', () => {
	const contract = (one: Country) =>
		lasting(
			seedOf(
				one,
				terms(one.salary),
				'2026-11-01',
				one.code === 'VN'
					? { facts: { statutory: { PIT: { elections: { finalisation_authorised: true } } } } }
					: {},
				'2026-11-15'
			)
		);
	const tax = (t: Kit, one: Country) =>
		Effect.gen(function* () {
			const november = yield* charged(t, '2026-11');
			const december = yield* charged(t, '2026-12');
			return {
				december: Number(december[`${one.tax}.employee`] ?? 0),
				total: Number(
					(
						Number(november[`${one.tax}.employee`] ?? 0) +
						Number(december[`${one.tax}.employee`] ?? 0)
					).toFixed(2)
				)
			};
		});
	for (const [name, one] of countries) {
		it.live(`${name}: a top-up in the next run reaches the year's tax`, () => {
			const seed = contract(one);
			return Effect.gen(function* () {
				const on = yield* inWorkspace(seed, '2026-12-20T02:00:00.000Z', (t) =>
					Effect.gen(function* () {
						yield* adhoc(t, seed, one.item, one.extra, '2026-11-10');
						yield* onCycle(t, '2026-11');
						yield* onCycle(t, '2026-12');
						return yield* tax(t, one);
					})
				);
				const late = yield* inWorkspace(seed, '2026-12-20T02:00:00.000Z', (t) =>
					Effect.gen(function* () {
						yield* onCycle(t, '2026-11');
						yield* adhoc(t, seed, one.item, one.extra, '2026-12-10');
						yield* onCycle(t, '2026-12');
						return yield* tax(t, one);
					})
				);
				assert.equal(late.total, on.total);
				assert.ok(late.december > on.december);
			});
		});
		it.live(`${name}: a reversal in the next run takes it back out of the year's tax`, () => {
			const seed = contract(one);
			return Effect.gen(function* () {
				const right = yield* inWorkspace(seed, '2026-12-20T02:00:00.000Z', (t) =>
					Effect.gen(function* () {
						yield* onCycle(t, '2026-11');
						yield* onCycle(t, '2026-12');
						return yield* tax(t, one);
					})
				);
				const corrected = yield* inWorkspace(seed, '2026-12-20T02:00:00.000Z', (t) =>
					Effect.gen(function* () {
						yield* adhoc(t, seed, one.item, one.extra, '2026-11-10');
						yield* onCycle(t, '2026-11');
						yield* adhoc(t, seed, one.item, one.extra, '2026-12-10', yield* sealedAdhoc(t));
						yield* onCycle(t, '2026-12');
						return yield* tax(t, one);
					})
				);
				assert.equal(corrected.total, right.total);
			});
		});
	}
});

describe('twice a month', () => {
	const one = COUNTRIES['Philippines'];
	assert.ok(one !== undefined);
	for (const salary of [40_000, 120_000])
		it.live(
			`Philippines: the month's two runs withhold what one run withholds at ${salary}`,
			() => {
				const monthly = seedOf(one, terms(salary, { transport: { amount: 3100 } }));
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
					assert.ok(Number(whole['WTAX.employee']) > 0);
					assert.deepEqual(halves, whole);
				});
			}
		);

	it.live('Philippines: a second half with no pay still settles the month', () => {
		const seed = reschedule(seedOf(one, terms(120_000)), TWICE);
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
				within(checkpoint(second.checkpoints, 'ORDINARY_WAGES'), 0);
				assert.ok(Number(second.statutory.find((row) => row.code === 'WTAX')?.employee ?? 0) < 0);
			})
		);
	});

	it.live('Vietnam: two half-month cycles are one month of insurance and tax', () => {
		const vietnam = COUNTRIES['Vietnam'];
		assert.ok(vietnam !== undefined);
		const whole = seedOf(vietnam, terms(30_000_000));
		// a half-month cycle pays the contract's rate, so half the month's salary is the rate
		const twice = reschedule(seedOf(vietnam, terms(15_000_000)), TWICE);
		return Effect.gen(function* () {
			const one = yield* inWorkspace(whole, NOW, (t) =>
				onCycle(t, '2026-06').pipe(Effect.andThen(charged(t, '2026-06')))
			);
			const two = yield* inWorkspace(twice, '2026-07-05T02:00:00.000Z', (t) =>
				onCycle(t, '2026-06-1').pipe(
					Effect.andThen(onCycle(t, '2026-06-2')),
					Effect.andThen(charged(t, '2026-06'))
				)
			);
			assert.deepEqual(two, one);
		});
	});
});

describe('a second salary in a pay month stands alone', () => {
	for (const [name, one] of countries)
		it.live(`${name}: August's contributions are July's`, () => {
			const seed = reschedule(seedOf(one, terms(one.salary)), ON_THE_FIRST);
			return inWorkspace(seed, '2026-08-20T02:00:00.000Z', (t) =>
				Effect.gen(function* () {
					yield* onCycle(t, '2026-07');
					yield* onCycle(t, '2026-08');
					const pay = (yield* t.storedQuery({ payroll_run: { limit: 2 } })).payroll_run.rows;
					assert.deepEqual(pay.map((row) => String(row.pay_date).slice(0, 7)).sort(), [
						'2026-07',
						'2026-07'
					]);
					// Decree 253/2026 art.46(3): Vietnam's income is taxed when paid, so both salaries are one month's income
					const contributions = (rows: Readonly<Record<string, number>>) =>
						Object.entries(rows).filter(([key]) => !key.startsWith('PIT'));
					assert.deepEqual(
						contributions(yield* charged(t, '2026-08')),
						contributions(yield* charged(t, '2026-07'))
					);
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
	reverses: Id<'leave_catalog_entry'> | null = null,
	code = 'NPL'
) =>
	Effect.gen(function* () {
		const selected = reverses == null ? days : yield* reversalSlots(t, reverses);
		yield* t.as(t.admin).act('leave_catalog_entry.create', [
			leaveCreate({
				entity_id: ENTITY,
				employment_id: CONTRACT,
				catalog_id: catalogId(seed, 'leave_catalog', code),
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
	for (const [name, one] of countries) {
		const salary = one.code === 'PH' ? 44_000 : 22_000_000;
		const monthly = seedOf(one, terms(salary, one.allowances));
		// the day rate to the minor unit: ₱44,000 × 12 ÷ 261, or ₫22,000,000 ÷ June's 22 working days
		const day = one.code === 'PH' ? 2022.99 : 1_000_000;
		const dated = (days: ReturnType<typeof whole>) =>
			inWorkspace(monthly, NOW, (t) =>
				Effect.gen(function* () {
					if (days.length > 0) yield* leave(t, monthly, days);
					yield* onCycle(t, '2026-06');
					const [slip] = yield* slips(t, '2026-06');
					assert.ok(slip !== undefined);
					return { slip, tax: Number((yield* charged(t, '2026-06'))[`${one.tax}.employee`]) };
				})
			);

		it.live(`${name}: the line takes the days at the day rate, and the tax follows`, () =>
			Effect.gen(function* () {
				const line = yield* dated([...whole('2026-06-10'), ...whole('2026-06-11')]);
				const worked = yield* dated([]);
				// the salary stays the contract's; the no-pay days are a line at the checkpoint after it
				within(lineOf(line.slip.lines, 'NPL'), -2 * day);
				within(checkpoint(line.slip.checkpoints, 'BASIC'), salary);
				within(checkpoint(line.slip.checkpoints, 'PAID_BASIC'), salary - 2 * day);
				assert.ok(line.tax < worked.tax, `${line.tax} is not below ${worked.tax}`);
			})
		);

		it.live(`${name}: a half day is half`, () =>
			inWorkspace(monthly, NOW, (t) =>
				Effect.gen(function* () {
					yield* leave(t, monthly, [{ date: PlainDate('2026-06-10'), part: 'AM' }]);
					yield* onCycle(t, '2026-06');
					const [slip] = yield* slips(t, '2026-06');
					assert.ok(slip !== undefined);
					within(lineOf(slip.lines, 'NPL'), -day / 2);
					within(
						checkpoint(slip.checkpoints, 'PAID_BASIC'),
						one.code === 'PH' ? salary - (salary * 12) / 261 / 2 : salary - salary / 44
					);
				})
			)
		);

		it.live(`${name}: a daily rate takes its day at the rate`, () => {
			const rate = one.code === 'PH' ? 2000 : 1_000_000;
			const seed = seedOf(one, terms(rate, {}, 'DAILY'));
			return inWorkspace(seed, NOW, (t) =>
				Effect.gen(function* () {
					yield* leave(t, seed, whole('2026-06-10'));
					yield* onCycle(t, '2026-06');
					const [slip] = yield* slips(t, '2026-06');
					assert.ok(slip !== undefined);
					// June's 22 working days at the rate, less the day's line
					within(lineOf(slip.lines, 'NPL'), -rate);
					within(checkpoint(slip.checkpoints, 'BASIC'), rate * 22);
					within(checkpoint(slip.checkpoints, 'PAID_BASIC'), rate * 21);
				})
			);
		});

		it.live(
			`${name}: reversed across a 30/31-day boundary, the next run pays back what June took`,
			() =>
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
						const full = checkpoint(august.checkpoints, one.wages);
						const taken =
							checkpoint(august.checkpoints, one.wages) - checkpoint(june.checkpoints, one.wages);
						assert.ok(taken > 0);
						// a reversal is priced like the line it undoes; an allowance that fell with the day gives it back on its own line
						within(lineOf(july.lines, 'NPL'), -lineOf(june.lines, 'NPL'));
						for (const code of one.noPayLines.filter((line) => line !== 'NPL'))
							within(
								lineOf(july.lines, code) - lineOf(august.lines, code),
								lineOf(august.lines, code) - lineOf(june.lines, code)
							);
						within(checkpoint(july.checkpoints, one.wages), full + taken);
						assert.equal(lineOf(august.lines, 'NPL'), 0);
					})
				)
		);

		it.live(`${name}: a date in a period that has run is refused, and says why`, () =>
			inWorkspace(monthly, '2026-07-20T02:00:00.000Z', (t) =>
				Effect.gen(function* () {
					yield* leave(t, monthly, whole('2026-06-10'));
					yield* onCycle(t, '2026-06');
					const late = yield* Effect.flip(leave(t, monthly, whole('2026-06-11')));
					assert.match(String(late), /already run/);
					const missed = yield* Effect.flip(leave(t, monthly, whole('2026-06-12')));
					assert.match(String(missed), /already run/);
				})
			)
		);

		it.live(`${name}: twice a month, a reversal in the next half pays back that half's day`, () => {
			const seed = reschedule(monthly, TWICE);
			return inWorkspace(seed, '2026-07-05T02:00:00.000Z', (t) =>
				Effect.gen(function* () {
					yield* leave(t, seed, whole('2026-06-10'));
					yield* onCycle(t, '2026-06-1');
					yield* leave(t, seed, whole('2026-06-22'), yield* sealedLeave(t));
					yield* onCycle(t, '2026-06-2');
					const [first, second] = yield* slips(t, '2026-06');
					assert.ok(first !== undefined && second !== undefined);
					within(lineOf(first.lines, 'NPL'), -day);
					within(lineOf(second.lines, 'NPL'), day);
				})
			);
		});
	}
});
