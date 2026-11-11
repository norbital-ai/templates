// However a bonus reaches a month, the month owes the same: inside the on-cycle run, or off-cycle before or after it.
// A second salary in a pay month is another wage month or another employer's, so it never merges with the first.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, pack, uuid, workspace } from './kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
const terms = (amount: number, residency: string) => ({
	rate: { amount, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: residency,
	wage_payment_method: 'BANK',
	allowances: {}
});
type Seed = ReturnType<typeof pack>;
type Case = {
	readonly code: string;
	readonly zone: string;
	readonly terms: ReturnType<typeof terms>;
	readonly item: string;
	readonly bonus: number;
	readonly facts?: Parameters<typeof pack>[3];
};
/** Two law packs as fixtures: one whose tax is reckoned month by month, one that settles the year in December. */
const MONTHLY: Case = {
	code: 'MY',
	zone: 'Asia/Kuala_Lumpur',
	terms: terms(8000, 'CITIZEN'),
	item: 'BONUS',
	bonus: 20_000
};
const YEARLY: Case = {
	code: 'PH',
	zone: 'Asia/Manila',
	terms: terms(120_000, 'RESIDENT'),
	item: 'bonus',
	bonus: 360_000
};

const seedOf = ({ code, zone, terms, facts = {} }: Case, from: string, on = '2026-06-15'): Seed => {
	const seed = pack(code, zone, terms, facts, [], [], on);
	return {
		...seed,
		employee_contract: (seed.employee_contract ?? []).map((row) => ({
			...row,
			effective_range: { from, to: null }
		}))
	};
};
const onCycle = (t: Kit, period: string) =>
	t
		.as(t.admin)
		.act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }])
		.pipe(Effect.andThen(t.runDue()));
const owed = (t: Kit, seed: Seed, { item, bonus }: Case, on: string) => {
	const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
	const row = (seed.adhoc_catalog ?? []).find((r) => r.code === item && r.settings_id === version);
	assert.ok(row !== undefined, item);
	return t.as(t.admin).act('adhoc_catalog_entry.create', [
		{
			entity_id: ENTITY,
			employment_id: CONTRACT,
			catalog_id: idOf('adhoc_catalog', String(row.id)),
			description: 'Bonus',
			quantity: bonus,
			incurred_on: PlainDate(on)
		}
	]);
};
const offCycle = (t: Kit, seed: Seed, one: Case, period: string, on: string) =>
	Effect.gen(function* () {
		yield* owed(t, seed, one, on);
		const open = (yield* t.storedQuery({
			adhoc_catalog_entry: {
				where: { payroll_run_id: { isNull: true }, reverses: { isNull: true } },
				limit: 1
			}
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
/** Every statutory row the month charged, both sides, across its runs: a refund counts against it. */
const month = (t: Kit, period: string) =>
	t.storedQuery({ payslip: { limit: 100 }, payroll_run: { limit: 100 } }).pipe(
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

const sameMonth = (
	one: Case,
	from: string,
	earlier: readonly string[],
	period: string,
	now: string
) => {
	const seed = seedOf(one, from, `${period}-15`);
	const on = `${period}-10`;
	const after = (bonus: (t: Kit) => Effect.Effect<unknown, unknown>) =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			for (const cycle of earlier) yield* onCycle(t, cycle);
			yield* bonus(t);
			return yield* month(t, period);
		}).pipe(Effect.provide(workspace({ seed, now })));
	return Effect.gen(function* () {
		const inside = yield* after((t) =>
			owed(t, seed, one, on).pipe(Effect.andThen(onCycle(t, period)))
		);
		const first = yield* after((t) =>
			offCycle(t, seed, one, period, on).pipe(Effect.andThen(onCycle(t, period)))
		);
		const second = yield* after((t) =>
			onCycle(t, period).pipe(Effect.andThen(offCycle(t, seed, one, period, on)))
		);
		assert.deepEqual(first, inside, 'off-cycle, then on-cycle');
		assert.deepEqual(second, inside, 'on-cycle, then off-cycle');
	});
};

describe('a bonus in the month', () => {
	it.live('inside the on-cycle run, or off-cycle before or after it, the month owes the same', () =>
		sameMonth(MONTHLY, '2026-04-01', ['2026-04', '2026-05'], '2026-06', '2026-06-20T02:00:00.000Z')
	);

	// December settles the year: a bonus ahead of its salary is withheld and the settlement nets it, and a bonus after it
	// settles the rest. The December the template's law holds is 2025's, its first month: the person starts in it with
	// their year accounted for, so December alone finds nothing overpaid.
	it.live(
		'in the month that settles the year, the settlement counts it whichever run paid it',
		() =>
			sameMonth(
				{
					...YEARLY,
					facts: {
						previous_employer_taxable_compensation: 1_039_950,
						previous_employer_tax_withheld: 207_000
					}
				},
				'2025-12-01',
				[],
				'2025-12',
				'2025-12-20T02:00:00.000Z'
			)
	);

	it.live('a second bonus before the salary stacks on the first', () => {
		const half = { ...YEARLY, bonus: YEARLY.bonus / 2 };
		const seed = seedOf(half, '2026-04-01');
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
				owed(t, seed, half, '2026-06-10').pipe(
					Effect.andThen(owed(t, seed, half, '2026-06-11')),
					Effect.andThen(onCycle(t, '2026-06'))
				)
			);
			const split = yield* after((t) =>
				offCycle(t, seed, half, '2026-06', '2026-06-10').pipe(
					Effect.andThen(offCycle(t, seed, half, '2026-06', '2026-06-11')),
					Effect.andThen(onCycle(t, '2026-06'))
				)
			);
			assert.deepEqual(split, inside);
		});
	});
});

const runsIn = (t: Kit, period: string) =>
	t.storedQuery({ payslip: { limit: 100 }, payroll_run: { limit: 100 } }).pipe(
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
	const paidOnTheFirst = (seed: Seed): Seed => ({
		...seed,
		pay_group: (seed.pay_group ?? []).map((row) => ({
			...row,
			payment_schedule: {
				frequency: 'MONTHLY',
				business_day: 'PREVIOUS',
				non_working_weekdays: [0, 6],
				short_month: 'LAST_DAY',
				pay_days: [1]
			}
		}))
	});
	// 1 August 2026 is a Saturday, so August's salary is paid on 31 July, in July's pay month
	const NOW = '2026-08-20T02:00:00.000Z';
	it.live('August owes what July owed', () => {
		const seed = paidOnTheFirst(seedOf(MONTHLY, '2026-04-01'));
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* onCycle(t, '2026-07');
			yield* onCycle(t, '2026-08');
			const pay = (yield* t.storedQuery({ payroll_run: { limit: 2 } })).payroll_run.rows;
			assert.deepEqual(pay.map((row) => String(row.pay_date).slice(0, 7)).sort(), [
				'2026-07',
				'2026-07'
			]);
			// contributions follow the salary period; income tax accumulates by the pay month, so it is left out
			const owed = (totals: Record<string, number>) =>
				Object.fromEntries(Object.entries(totals).filter(([key]) => !key.startsWith('PCB.')));
			assert.deepEqual(owed(yield* month(t, '2026-08')), owed(yield* month(t, '2026-07')));
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});

	const OTHER = idOf('entity', uuid(900));
	/** The same person moves to a sister company on 16 June. */
	const moved = (one: Case): Seed => {
		const seed = seedOf(one, '2026-04-01');
		const contract = seed.employee_contract?.[0] ?? {};
		const profile = seed.entity_profile_version?.[0] ?? {};
		return {
			...seed,
			entity: [
				...(seed.entity ?? []),
				{ id: OTHER, code: 'E2', name: 'Sister', settings_code: one.code }
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
			yield* t
				.as(t.admin)
				.act('payroll_run.create', [{ entity_id: OTHER, period: '2026-06', kind: 'ON_CYCLE' }]);
			yield* t.runDue();
			return yield* runsIn(t, '2026-06');
		});
	const NOW_JUNE = '2026-06-20T02:00:00.000Z';
	it.live('each company in a transfer month is its own employer', () => {
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const [first, second] = yield* transfer(t);
			assert.ok(first !== undefined && second !== undefined);
			assert.equal(charged(first, 'EPF')?.employer, charged(second, 'EPF')?.employer);
		}).pipe(Effect.provide(workspace({ seed: moved(MONTHLY), now: NOW_JUNE })));
	});
	it.live('each company pays its own days, and the month pays once', () => {
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* transfer(t);
			const { payslip } = yield* t.storedQuery({ payslip: { limit: 10 } });
			// BASIC is each contract's salary; PRORATED is what its days employed leave of it
			const [first, second] = payslip.rows.map(
				(row) =>
					Schema.decodeUnknownSync(PayslipBreakdown)(row.breakdown).checkpoints.find(
						(point) => point.code === 'PRORATED'
					)?.value ?? 0
			);
			assert.equal(first, second);
			assert.equal((first ?? 0) + (second ?? 0), MONTHLY.terms.rate.amount);
		}).pipe(Effect.provide(workspace({ seed: moved(MONTHLY), now: NOW_JUNE })));
	});
});
