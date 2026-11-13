// However pay reaches a month, the month owes the same: one on-cycle run, an off-cycle run before or after it, or two
// halves of a twice-monthly pay group. A second salary in a pay month is another wage month or another employer's, so it
// never merges with the first. Malaysia's law pack is only the fixture: every expectation compares runs with runs.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf, objectValue } from '../../src/lib/payroll_engine/reads.ts';
import { ENTITY, leaveCreate, pack, storedQuery, uuid, wholeDays, workspace } from '../kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
const SALARY = 8000;
const BONUS = 20_000;
type Seed = ReturnType<typeof pack>;
type Schedule = Seed[string][number][string];
/** One person on 8,000 a month from `from`. */
const seedOf = (from: string): Seed => {
	const seed = pack(
		'MY',
		'Asia/Kuala_Lumpur',
		{
			rate: { amount: SALARY, unit: 'MONTHLY' },
			statutory_work_category: 'NON_MANUAL',
			work_classification: 'EA_COVERED',
			residency_status: 'CITIZEN',
			wage_payment_method: 'BANK',
			allowances: {}
		},
		{},
		[],
		[]
	);
	return {
		...seed,
		employee_contract: (seed.employee_contract ?? []).map((row) => ({
			...row,
			effective_range: { from, to: null }
		}))
	};
};
const reschedule = (seed: Seed, payment_schedule: Schedule): Seed => ({
	...seed,
	pay_group: (seed.pay_group ?? []).map((row) => ({ ...row, payment_schedule }))
});
/** Every run is paid as it is made: nothing of a person moves while an unpaid run holds them. */
const settle = (t: Kit) =>
	Effect.gen(function* () {
		yield* t.run_due();
		const { payroll_run } = yield* storedQuery(t, {
			payroll_run: { where: { state: { eq: 'UNPAID' } }, limit: 100 }
		});
		if (payroll_run.rows.length > 0)
			yield* (yield* t.as(t.admin)).act({
				'payroll_run.update': payroll_run.rows.map((row) => ({
					target: row,
					set: { state: 'PAID' as const }
				}))
			});
		yield* t.run_due();
	});
const onCycle = (t: Kit, period: string) =>
	Effect.flatMap(t.as(t.admin), (caller) =>
		caller.act({ 'payroll_run.create': [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }] })
	).pipe(Effect.andThen(settle(t)));
const bonus = (t: Kit, amount: number, on: string) =>
	Effect.flatMap(t.as(t.admin), (caller) =>
		caller.act({
			'adhoc_catalog_entry.create': [
				{
					entity_id: ENTITY,
					employment_id: CONTRACT,
					catalog_code: 'BONUS',
					description: 'Bonus',
					quantity: String(amount),
					incurred_on: on
				}
			]
		})
	);
const offCycle = (t: Kit, amount: number, period: string, on: string) =>
	Effect.gen(function* () {
		yield* bonus(t, amount, on);
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
		yield* settle(t);
	});
/** Every statutory row the month charged, both sides, across its runs: a refund counts against it. */
const month = (t: Kit, period: string) =>
	storedQuery(t, { payslip: { limit: 100 }, payroll_run: { limit: 100 } }).pipe(
		Effect.map((got) => {
			const totals = new Map<string, number>();
			const add = (key: string, value: number) => totals.set(key, (totals.get(key) ?? 0) + value);
			for (const run of got.payroll_run.rows.filter((row) => row.period.startsWith(period))) {
				const slip = got.payslip.rows.find((row) => row.payroll_run_id === run.id);
				const { statutory } = Schema.decodeUnknownSync(PayslipBreakdown)(slip?.breakdown);
				for (const row of statutory) {
					add(`${row.code}.employee`, row.employee);
					add(`${row.code}.employer`, row.employer);
				}
			}
			return Object.fromEntries(
				[...totals]
					.map(([key, value]) => [key, Number(value.toFixed(2))] as const)
					.filter(([, value]) => value !== 0)
					.sort(([left], [right]) => left.localeCompare(right))
			);
		})
	);

/** The month a bonus is paid inside its on-cycle run, against the same bonus off-cycle before or after that run. */
const sameMonth = (
	from: string,
	earlier: readonly string[],
	period: string,
	now: string,
	order: 'before' | 'after'
) => {
	const seed = seedOf(from);
	const on = `${period}-10`;
	const after = (pays: (t: Kit) => Effect.Effect<unknown, unknown>) =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			for (const cycle of earlier) yield* onCycle(t, cycle);
			yield* pays(t);
			return yield* month(t, period);
		}).pipe(Effect.provide(workspace({ seed, now })));
	return Effect.gen(function* () {
		const inside = yield* after((t) =>
			bonus(t, BONUS, on).pipe(Effect.andThen(onCycle(t, period)))
		);
		const split = yield* after((t) =>
			order === 'before'
				? offCycle(t, BONUS, period, on).pipe(Effect.andThen(onCycle(t, period)))
				: onCycle(t, period).pipe(Effect.andThen(offCycle(t, BONUS, period, on)))
		);
		assert.ok(Object.keys(inside).length > 0);
		assert.deepEqual(split, inside);
	});
};

describe('a bonus in the month', () => {
	for (const order of ['before', 'after'] as const)
		it.live(`off-cycle ${order} the on-cycle run, the month owes what it owes inside it`, () =>
			sameMonth('2026-05-01', ['2026-05'], '2026-06', '2026-06-20T02:00:00.000Z', order)
		);

	// the tax year's last month settles the year: what it withholds reads every run of the year
	for (const order of ['before', 'after'] as const)
		it.live(
			`in the tax year's last month, off-cycle ${order} the on-cycle run, it owes the same`,
			() => sameMonth('2026-11-01', ['2026-11'], '2026-12', '2026-12-20T02:00:00.000Z', order)
		);

	it.live('a second bonus before the salary stacks on the first', () => {
		const seed = seedOf('2026-04-01');
		const after = (bonuses: (t: Kit) => Effect.Effect<unknown, unknown>) =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* onCycle(t, '2026-04');
				yield* onCycle(t, '2026-05');
				yield* bonuses(t);
				return yield* month(t, '2026-06');
			}).pipe(Effect.provide(workspace({ seed, now: '2026-06-20T02:00:00.000Z' })));
		return Effect.gen(function* () {
			const inside = yield* after((t) =>
				bonus(t, BONUS / 2, '2026-06-10').pipe(
					Effect.andThen(bonus(t, BONUS / 2, '2026-06-11')),
					Effect.andThen(onCycle(t, '2026-06'))
				)
			);
			const split = yield* after((t) =>
				offCycle(t, BONUS / 2, '2026-06', '2026-06-10').pipe(
					Effect.andThen(offCycle(t, BONUS / 2, '2026-06', '2026-06-11')),
					Effect.andThen(onCycle(t, '2026-06'))
				)
			);
			assert.deepEqual(split, inside);
		});
	});
});

describe('income tax on a bonus', () => {
	// The tax on the month's pay and the tax the bonus adds are each cut to the sen, and what is deducted is rounded up
	// to five sen once. January, 8,000 a month, EPF 880: the year's income is 7,120 + 11 × (8,000 − 283.63) − 9,000 =
	// 83,000.07, its tax 6,170.01, a twelfth 514.16. With a 20,000 bonus (EPF 2,200 more, 83.63 a month left of the
	// 4,000 relief) the income is 103,000.07 and its tax 10,150.01; less 12 × 514.16 the bonus adds 3,980.09.
	it.live('is rounded once, on the amount deducted', () => {
		const seed = seedOf('2026-01-01');
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* bonus(t, BONUS, '2026-01-10');
			yield* onCycle(t, '2026-01');
			assert.equal((yield* month(t, '2026-01'))['PCB.employee'], 514.16 + 3980.09);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-01-20T02:00:00.000Z' })));
	});
});

describe('twice a month', () => {
	const TWICE = {
		frequency: 'SEMI_MONTHLY',
		business_day: 'PREVIOUS',
		non_working_weekdays: [0, 6],
		short_month: 'LAST_DAY',
		pay_cutoff_day: 1,
		pay_days: [15, 31]
	};
	const NOW = '2026-07-05T02:00:00.000Z';
	/** What a month's payslips paid as ordinary wages, across its runs. */
	const wages = (t: Kit, period: string) =>
		storedQuery(t, { payslip: { limit: 100 } }).pipe(
			Effect.map(({ payslip }) =>
				payslip.rows
					.filter((row) => row.period?.startsWith(period) === true)
					.reduce(
						(total, row) =>
							total +
							(Schema.decodeUnknownSync(PayslipBreakdown)(row.breakdown).checkpoints.find(
								(point) => point.code === 'ORDINARY_WAGES'
							)?.value ?? 0),
						0
					)
			)
		);
	const noPay = (t: Kit, dates: readonly string[]) =>
		Effect.flatMap(t.as(t.admin), (caller) =>
			caller.act({
				'leave_catalog_entry.create': [
					leaveCreate({
						entity_id: ENTITY,
						employment_id: CONTRACT,
						catalog_code: 'NPL',
						days: wholeDays(...dates)
					})
				]
			})
		);
	// the second half's weekdays
	const SECOND = ['16', '17', '18', '19', '22', '23', '24', '25', '26', '29', '30'].map(
		(day) => `2026-06-${day}`
	);
	for (const [name, missed] of [
		['every day worked', []],
		['the second half on no-pay leave', SECOND]
	] as const)
		it.live(
			`${name}: the month's two runs owe the contributions one run of the month's wages owes`,
			() => {
				const twice = reschedule(seedOf('2026-01-01'), TWICE);
				return Effect.gen(function* () {
					const halves = yield* Effect.gen(function* () {
						const t = yield* TestWorkspace;
						yield* onCycle(t, '2026-06-1');
						if (missed.length > 0) yield* noPay(t, missed);
						yield* onCycle(t, '2026-06-2');
						return { owed: yield* month(t, '2026-06'), wages: yield* wages(t, '2026-06') };
					}).pipe(Effect.provide(workspace({ seed: twice, now: NOW })));
					// one monthly run of what the two halves paid in wages
					const once = seedOf('2026-01-01');
					const whole = yield* Effect.gen(function* () {
						const t = yield* TestWorkspace;
						yield* onCycle(t, '2026-06');
						return yield* month(t, '2026-06');
					}).pipe(
						Effect.provide(
							workspace({
								seed: {
									...once,
									employee_contract: (once.employee_contract ?? []).map((row) => ({
										...row,
										terms: {
											...objectValue(row.terms),
											rate: { amount: halves.wages, unit: 'MONTHLY' }
										}
									}))
								},
								now: NOW
							})
						)
					);
					// income tax is the month's too: the second run settles it on the month's wages. What the first run took
					// on a full month is not handed back by the second, so a half on no-pay leave leaves the tax out
					const contributions = (totals: Record<string, number>) =>
						Object.fromEntries(
							Object.entries(totals).filter(
								([key]) => missed.length === 0 || !key.startsWith('PCB.')
							)
						);
					assert.ok(Object.keys(contributions(whole)).length > 0);
					assert.deepEqual(contributions(halves.owed), contributions(whole));
				});
			}
		);
});

const runsIn = (t: Kit, period: string) =>
	storedQuery(t, { payslip: { limit: 100 }, payroll_run: { limit: 100 } }).pipe(
		Effect.map((got) =>
			got.payroll_run.rows
				.filter((row) => row.period === period)
				.map((run) => {
					const slip = got.payslip.rows.find((row) => row.payroll_run_id === run.id);
					return Schema.decodeUnknownSync(PayslipBreakdown)(slip?.breakdown).statutory;
				})
		)
	);
const charged = (rows: PayslipBreakdown['statutory'], code: string) =>
	rows.find((row) => row.code === code);

describe('a second salary in a pay month', () => {
	// 1 August 2026 is a Saturday, so August's salary is paid on 31 July, in July's pay month
	it.live('is its own wage month: August owes what July owed', () => {
		const seed = reschedule(seedOf('2026-04-01'), {
			frequency: 'MONTHLY',
			business_day: 'PREVIOUS',
			non_working_weekdays: [0, 6],
			short_month: 'LAST_DAY',
			pay_days: [1]
		});
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* onCycle(t, '2026-07');
			yield* onCycle(t, '2026-08');
			const pay = (yield* storedQuery(t, { payroll_run: { limit: 2 } })).payroll_run.rows;
			assert.deepEqual(pay.map((row) => String(row.pay_date).slice(0, 7)).sort(), [
				'2026-07',
				'2026-07'
			]);
			// contributions follow the salary period; income tax accumulates by the pay month, so it is left out
			const owed = (totals: Record<string, number>) =>
				Object.fromEntries(Object.entries(totals).filter(([key]) => !key.startsWith('PCB.')));
			assert.deepEqual(owed(yield* month(t, '2026-08')), owed(yield* month(t, '2026-07')));
		}).pipe(Effect.provide(workspace({ seed, now: '2026-08-20T02:00:00.000Z' })));
	});

	const OTHER = idOf('entity', uuid(900));
	/** The same person moves to a sister company on 16 June. */
	const moved = (): Seed => {
		const seed = seedOf('2026-04-01');
		const contract = seed.employee_contract?.[0] ?? {};
		const profile = seed.entity_profile_version?.[0] ?? {};
		return {
			...seed,
			entity: [
				...(seed.entity ?? []),
				{ id: OTHER, code: 'E2', name: 'Sister', settings_code: 'MY' }
			],
			entity_profile_version: [
				...(seed.entity_profile_version ?? []),
				{ ...profile, id: uuid(902), entity_id: OTHER, name: 'Sister' }
			],
			// the sister company's own payroll, on the same schedule
			pay_group: [
				...(seed.pay_group ?? []),
				...(seed.pay_group ?? []).map((row) => ({ ...row, id: uuid(908), entity_id: OTHER }))
			],
			employee_contract: [
				{ ...contract, effective_range: { from: '2026-04-01', to: '2026-06-15' } },
				{
					...contract,
					id: uuid(907),
					entity_id: OTHER,
					pay_group_id: uuid(908),
					effective_range: { from: '2026-06-16', to: null }
				}
			]
		};
	};
	const transfer = (t: Kit) =>
		Effect.gen(function* () {
			yield* onCycle(t, '2026-06');
			yield* (yield* t.as(t.admin)).act({
				'payroll_run.create': [{ entity_id: OTHER, period: '2026-06', kind: 'ON_CYCLE' }]
			});
			yield* t.run_due();
			return yield* runsIn(t, '2026-06');
		});
	const JUNE = '2026-06-20T02:00:00.000Z';
	it.live('from another company in a transfer month is its own employer’s', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const [first, second] = yield* transfer(t);
			assert.ok(first !== undefined && second !== undefined);
			assert.equal(charged(first, 'EPF')?.employer, charged(second, 'EPF')?.employer);
		}).pipe(Effect.provide(workspace({ seed: moved(), now: JUNE })))
	);
	it.live('from another company pays its own days, and the month pays once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* transfer(t);
			const { payslip } = yield* storedQuery(t, { payslip: { limit: 10 } });
			// BASIC is each contract's salary; PRORATED is what its days employed leave of it
			const [first, second] = payslip.rows.map(
				(row) =>
					Schema.decodeUnknownSync(PayslipBreakdown)(row.breakdown).checkpoints.find(
						(point) => point.code === 'PRORATED'
					)?.value ?? 0
			);
			assert.equal(first, second);
			assert.equal((first ?? 0) + (second ?? 0), SALARY);
		}).pipe(Effect.provide(workspace({ seed: moved(), now: JUNE })))
	);
});
