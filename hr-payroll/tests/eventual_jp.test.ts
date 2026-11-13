// On Japan's law pack: a month's ceiling counts every run of the month, and a no-pay day is a catalog line at PAID_BASIC.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, pack, uuid, workspace, leaveCreate, storedQuery } from './kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
const JUNE = '2026-06-20T02:00:00.000Z';
const NO_PAY = [
	'PRENATAL_LEAVE',
	'POSTNATAL_LEAVE',
	'CHILDCARE_LEAVE',
	'POSTNATAL_PATERNITY_LEAVE',
	'FAMILY_CARE_LEAVE',
	'CHILD_NURSING_LEAVE',
	'FAMILY_CARE_DAYS',
	'MENSTRUAL_LEAVE',
	'CIVIC_DUTY_LEAVE',
	'SICKNESS_ABSENCE',
	'OCCUPATIONAL_INJURY_ABSENCE',
	'NPL',
	'NURSING_TIME',
	'MATERNAL_HEALTH_CHECK'
];
/** The rows that follow the month's pay. The monthly premiums sit on the grade, fixed here by the election. */
const FOLLOWING = [
	'ASBESTOS_LEVY',
	'CHILD_CONTRIBUTION',
	'CHILD_SUPPORT_BONUS',
	'EI',
	'EI_BONUS',
	'HEALTH_BONUS',
	'INCOME_TAX',
	'PENSION_BONUS',
	'WORKERS_ACCIDENT'
];
const FACTS = {
	insured_office_region: 'HOKKAIDO',
	statutory: {
		HEALTH: { standard_monthly_remuneration: 500_000 },
		INCOME_TAX: { dependency_declaration_filed: true },
		YEAR_END_ADJUSTMENT: { prior_employer_income: 6_000_000 }
	}
};
const terms = (amount: number, allowances: Record<string, { readonly amount: number }> = {}) => ({
	rate: { amount, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'SOCIAL_AND_EMPLOYMENT',
	work_classification: 'EMPLOYEE',
	residency_status: 'RESIDENT',
	wage_payment_method: 'BANK',
	allowances
});
type Seed = ReturnType<typeof pack>;
const seedOf = (
	salary: number,
	allowances: Record<string, { readonly amount: number }> = {},
	days: Parameters<typeof pack>[4] = []
): Seed => {
	const seed = pack('JP', 'Asia/Tokyo', terms(salary, allowances), FACTS, days, [], '2026-06-15');
	return {
		...seed,
		entity_profile_version: (seed.entity_profile_version ?? []).map((row) => ({
			...row,
			entity_extension_data: { workers_accident_rate_per_mille: 3 }
		})),
		employee_contract: (seed.employee_contract ?? []).map((row) => ({
			...row,
			effective_range: { from: '2026-01-01', to: null }
		}))
	};
};
const onCycle = (t: Kit, period: string) =>
	t
		.as(t.admin)
		.pipe(
			Effect.andThen((caller) =>
				caller.act({ 'payroll_run.create': [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }] })
			)
		)
		.pipe(Effect.andThen(t.run_due()));
/** The period's on-cycle run, paid: what is entered for the period after it no longer waits on its review. */
const paidCycle = (t: Kit, period: string) =>
	Effect.gen(function* () {
		yield* onCycle(t, period);
		const [run] = (yield* storedQuery(t, {
			payroll_run: { where: { period: { eq: period } }, limit: 1 }
		})).payroll_run.rows;
		assert.ok(run !== undefined);
		yield* t
			.as(t.admin)
			.pipe(
				Effect.andThen((caller) =>
					caller.act({ 'payroll_run.update': [{ target: run, set: { state: 'PAID' } }] })
				)
			);
		yield* t.run_due();
	});
const enter = (t: Kit, seed: Seed, item: string, quantity: number, on: string) => {
	const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
	const row = (seed.adhoc_catalog ?? []).find((r) => r.code === item && r.settings_id === version);
	assert.ok(row !== undefined, item);
	return t.as(t.admin).pipe(
		Effect.andThen((caller) =>
			caller.act({
				'adhoc_catalog_entry.create': [
					{
						entity_id: ENTITY,
						employment_id: CONTRACT,
						catalog_id: idOf('adhoc_catalog', String(row.id)),
						description: 'Correction',
						quantity,
						incurred_on: PlainDate(on)
					}
				]
			})
		)
	);
};
/** The open entry goes out in its own run. */
const offCycle = (t: Kit, period: string) =>
	Effect.gen(function* () {
		const open = (yield* storedQuery(t, {
			adhoc_catalog_entry: { where: { payroll_run_id: { is_null: true } }, limit: 1 }
		})).adhoc_catalog_entry.rows[0];
		assert.ok(open !== undefined);
		yield* t.as(t.admin).pipe(
			Effect.andThen((caller) =>
				caller.act({
					'payroll_run.create': [
						{
							entity_id: ENTITY,
							period,
							kind: 'OFF_CYCLE',
							adhoc: [{ id: open.id, revision: open.revision }]
						}
					]
				})
			)
		);
		yield* t.run_due();
	});
const runs = (t: Kit, period: string) =>
	storedQuery(t, { payslip: { limit: 100 }, payroll_run: { limit: 100 } }).pipe(
		Effect.map((got) =>
			got.payroll_run.rows
				.filter((row) => row.period.startsWith(period))
				.toSorted((left, right) => right.kind.localeCompare(left.kind))
				.map((run) => {
					const slip = got.payslip.rows.find((row) => row.payroll_run_id === run.id);
					return Schema.decodeUnknownSync(PayslipBreakdown)(slip?.breakdown);
				})
		)
	);
/** What a month's runs charged on these rows: a refund counts against it. */
const month = (t: Kit, period: string, codes: readonly string[], sides: readonly string[]) =>
	runs(t, period).pipe(
		Effect.map((slips) => {
			const totals = new Map<string, number>();
			const add = (key: string, value: number) => totals.set(key, (totals.get(key) ?? 0) + value);
			for (const { code, employee, employer } of slips.flatMap((s) => s.statutory)) {
				if (!codes.includes(code)) continue;
				add(`${code}.employee`, employee);
				add(`${code}.employer`, employer);
			}
			return Object.fromEntries(
				[...totals]
					.filter(([key, value]) => value !== 0 && sides.some((side) => key.endsWith(side)))
					.sort(([left], [right]) => left.localeCompare(right))
			);
		})
	);
const BOTH = ['.employee', '.employer'];

/** One month of one on-cycle run, with whatever it is told to pay. */
const oneRun = (
	seed: Seed,
	sides: readonly string[],
	pays: (t: Kit) => Effect.Effect<unknown, unknown> = () => Effect.void
) =>
	Effect.gen(function* () {
		const t = yield* TestWorkspace;
		yield* pays(t);
		yield* onCycle(t, '2026-06');
		return yield* month(t, '2026-06', FOLLOWING, sides);
	}).pipe(Effect.provide(workspace({ seed, now: JUNE })));

describe('short, then topped up off-cycle in the month', () => {
	it.live('a bonus past the pension ceiling: one standard bonus for the month', () => {
		const seed = seedOf(500_000);
		return Effect.gen(function* () {
			const twice = yield* Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* enter(t, seed, 'BONUS', 1_000_500, '2026-06-10');
				yield* paidCycle(t, '2026-06');
				yield* enter(t, seed, 'BONUS', 700_800, '2026-06-15');
				yield* offCycle(t, '2026-06');
				return yield* month(t, '2026-06', FOLLOWING, BOTH);
			}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
			const once = yield* oneRun(seed, BOTH, (t) =>
				enter(t, seed, 'BONUS', 1_701_300, '2026-06-10')
			);
			assert.deepEqual(twice, once);
		});
	});
});

describe('a no-pay day', () => {
	const noPay = (seed: Seed) => {
		const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
		const row = seed.leave_catalog?.find(
			(item) => item.code === 'NPL' && item.settings_id === version
		);
		assert.ok(row !== undefined);
		return idOf('leave_catalog', String(row.id));
	};
	const whole = (date: string) => [
		{ date: PlainDate(date), part: 'AM' as const },
		{ date: PlainDate(date), part: 'PM' as const }
	];
	const take = (t: Kit, seed: Seed, days: ReturnType<typeof whole>) =>
		t.as(t.admin).pipe(
			Effect.andThen((caller) =>
				caller.act({
					'leave_catalog_entry.create': [
						leaveCreate({
							entity_id: ENTITY,
							employment_id: CONTRACT,
							catalog_id: noPay(seed),
							days
						})
					]
				})
			)
		);
	const line = (slip: PayslipBreakdown | undefined) =>
		slip?.lines.find((row) => row.code === 'NPL');
	const FIXED = { FIXED_ALLOWANCE: { amount: 22_000 } };

	const at = (slip: PayslipBreakdown | undefined, code: string) =>
		slip?.checkpoints.find((row) => row.code === code)?.value;
	const allowance = (slip: PayslipBreakdown | undefined) =>
		slip?.lines.find((row) => row.code === 'FIXED_ALLOWANCE')?.amount ?? 0;

	it.live('comes off as a line at PAID_BASIC, and the fixed allowance loses the same share', () => {
		const seed = seedOf(440_000, FIXED);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, seed, whole('2026-06-10'));
			yield* onCycle(t, '2026-06');
			const [june] = yield* runs(t, '2026-06');
			const cut = line(june)?.amount ?? 0;
			assert.ok(cut > 0 && cut < 440_000);
			assert.equal(line(june)?.direction, 'DEDUCT');
			assert.equal(at(june, 'BASIC'), 440_000);
			assert.equal(at(june, 'PAID_BASIC'), 440_000 - cut);
			assert.equal(allowance(june), Math.round(FIXED.FIXED_ALLOWANCE.amount * (1 - cut / 440_000)));
			assert.equal(at(june, 'ORDINARY_WAGES'), 440_000 - cut + allowance(june));
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
	});

	it.live('the roster’s days are the month’s working days', () => {
		// a roster is the cycle's plan: every weekday worked and clocked, bar two it turns into rest days
		const rested = ['2026-06-11', '2026-06-12'];
		const seed = seedOf(
			440_000,
			{},
			Array.from({ length: 30 }, (_, index) => `2026-06-${String(index + 1).padStart(2, '0')}`)
				.filter((date) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()))
				.map((date) =>
					rested.includes(date)
						? { date, shift: uuid(12), hours: 1 }
						: { date, shift: uuid(11), hours: 8 }
				)
		);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, seed, whole('2026-06-10'));
			yield* onCycle(t, '2026-06');
			const [june] = yield* runs(t, '2026-06');
			// 22 weekdays on the roster, two of them rest days
			assert.equal(line(june)?.amount, 440_000 / 20);
			assert.equal(at(june, 'PAID_BASIC'), 440_000 - 440_000 / 20);
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
	});

	/** The month the salary basis would have paid, on the same seed with the rows back as UNPAID. */
	const onTheBasis = (seed: Seed): Seed => ({
		...seed,
		leave_catalog: (seed.leave_catalog ?? []).map((row) =>
			NO_PAY.includes(String(row.code)) ? { ...row, paid_share: '0' } : row
		)
	});
	const paid = (seed: Seed, days: ReturnType<typeof whole>) =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, seed, days);
			yield* onCycle(t, '2026-06');
			const [june] = yield* runs(t, '2026-06');
			const [slip] = (yield* storedQuery(t, { payslip: { limit: 1 } })).payslip.rows;
			return {
				net: slip?.net_pay,
				ordinary: june?.checkpoints.find((row) => row.code === 'ORDINARY_WAGES')?.value,
				statutory: june?.statutory.map(({ code, employee, employer }) => [code, employee, employer])
			};
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
	const everyDay = Array.from({ length: 30 }, (_, index) =>
		whole(`2026-06-${String(index + 1).padStart(2, '0')}`)
	).flat();
	const SAME: readonly (readonly [string, ReturnType<typeof whole>])[] = [
		['a half day', [{ date: PlainDate('2026-06-10'), part: 'AM' }]],
		['three days', [...whole('2026-06-10'), ...whole('2026-06-11'), ...whole('2026-06-12')]],
		['the whole month', everyDay]
	];
	for (const [name, days] of SAME)
		it.live(
			`${name}: net pay and every statutory figure stand as the salary basis left them`,
			() => {
				const seed = seedOf(500_000, { FIXED_ALLOWANCE: { amount: 30_000 } });
				return Effect.gen(function* () {
					assert.deepEqual(yield* paid(seed, days), yield* paid(onTheBasis(seed), days));
				});
			}
		);
});
