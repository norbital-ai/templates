// An employer's own pay method stands only where it pays at least the law; an employee-borne share of a borne income
// tax is a contract term. Real sealed law, a synthetic employee and a month, end to end through `payroll_run.create`.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import type { JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { ENTITY, REST, WORK, pack, uuid, workspace } from './kit.ts';

type Seed = ReturnType<typeof pack>;
const slip = (seed: Seed, period: string, now: string) =>
	Effect.gen(function* () {
		const t = yield* TestWorkspace;
		yield* t
			.as(t.admin)
			.act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }]);
		yield* t.runDue();
		const payslip = (yield* t.storedQuery({ payslip: { limit: 1 } })).payslip.rows[0];
		assert.ok(payslip !== undefined, 'the run wrote a payslip');
		return { payslip, breakdown: Schema.decodeUnknownSync(PayslipBreakdown)(payslip.breakdown) };
	}).pipe(Effect.provide(workspace({ seed, now })));
const withEmployer = (seed: Seed, employer: JsonObject): Seed => ({
	...seed,
	entity_profile_version: (seed.entity_profile_version ?? []).map((row) => ({
		...row,
		...employer
	}))
});
const amount = (breakdown: PayslipBreakdown, code: string) =>
	breakdown.lines.find((line) => line.code === code)?.amount ?? 0;
const near = (actual: number, expected: number, what: string) =>
	assert.ok(Math.abs(actual - expected) < 0.01, `${what}: paid ${actual}, expected ${expected}`);

// RM1,927 a month: the Act's hour is ÷ 26 ÷ the contract's daily hours (EA s.60I); the weekly basis is × 12 ÷ (52 × weekly hours)
const malaysia = (hours: number, days: number, employer: JsonObject) =>
	withEmployer(
		pack(
			'MY',
			'Asia/Kuala_Lumpur',
			{
				rate: { amount: 1927, unit: 'MONTHLY' },
				normal_hours_per_day: hours,
				normal_hours_per_week: hours * days,
				normal_days_per_week: days,
				statutory_work_category: 'MANUAL_LABOUR',
				work_classification: 'EA_COVERED',
				residency_status: 'CITIZEN',
				wage_payment_method: 'BANK',
				allowances: {}
			},
			{},
			[
				{ date: '2026-02-02', shift: WORK, hours: hours + 2, overtime: 2 },
				{ date: '2026-02-01', shift: REST, hours: 11 },
				{ date: '2026-02-08', shift: REST, hours: 1 }
			],
			[]
		),
		employer
	);
const FEBRUARY = '2026-02-20T02:00:00.000Z';
const STATUTORY_HOUR = 1927 / 26 / 9;
const WEEKLY_HOUR = (1927 * 12) / (52 * 45);
const DAY = 1927 / 26;

describe('employer pay methods', () => {
	it('the hours read as the law and the employer method say', () => {
		assert.equal(STATUTORY_HOUR.toFixed(2), '8.24');
		assert.equal(WEEKLY_HOUR.toFixed(2), '9.88');
	});

	it.live('without methods a 9 h × 5 worker is paid the Act’s hour', () =>
		Effect.gen(function* () {
			const { breakdown } = yield* slip(malaysia(9, 5, {}), '2026-02', FEBRUARY);
			near(amount(breakdown, 'OVERTIME'), 2 * 1.5 * STATUTORY_HOUR, 'OVERTIME');
			near(amount(breakdown, 'REST_DAY_WORK'), DAY + DAY / 2, 'REST_DAY_WORK');
			near(amount(breakdown, 'REST_DAY_OVERTIME'), 2 * 2 * STATUTORY_HOUR, 'REST_DAY_OVERTIME');
		})
	);

	it.live('CONTRACT_WEEKLY lifts a 9 h × 5 worker’s overtime hour, not the rest-day day', () =>
		Effect.gen(function* () {
			const { breakdown } = yield* slip(
				malaysia(9, 5, { pay_methods: { overtime_hour_basis: 'CONTRACT_WEEKLY' } }),
				'2026-02',
				FEBRUARY
			);
			near(amount(breakdown, 'OVERTIME'), 2 * 1.5 * WEEKLY_HOUR, 'OVERTIME');
			near(amount(breakdown, 'REST_DAY_WORK'), DAY + DAY / 2, 'REST_DAY_WORK');
			near(amount(breakdown, 'REST_DAY_OVERTIME'), 2 * 2 * WEEKLY_HOUR, 'REST_DAY_OVERTIME');
		})
	);

	it.live('a 7.5 h × 6 contract is paid the same hour either way', () =>
		Effect.gen(function* () {
			const statutory = yield* slip(malaysia(7.5, 6, {}), '2026-02', FEBRUARY);
			const weekly = yield* slip(
				malaysia(7.5, 6, { pay_methods: { overtime_hour_basis: 'CONTRACT_WEEKLY' } }),
				'2026-02',
				FEBRUARY
			);
			near(amount(statutory.breakdown, 'OVERTIME'), 2 * 1.5 * (1927 / 26 / 7.5), 'statutory');
			near(amount(weekly.breakdown, 'OVERTIME'), amount(statutory.breakdown, 'OVERTIME'), 'weekly');
		})
	);

	it.live(
		'a rest-day multiple of 2 pays 11 h at 2 × the hour; a 1 h shift keeps the half day',
		() =>
			Effect.gen(function* () {
				const { breakdown } = yield* slip(
					malaysia(9, 5, { pay_methods: { rest_day_hourly_multiplier: 2 } }),
					'2026-02',
					FEBRUARY
				);
				// the 11 h day: 9 h within normal hours and 2 beyond, each at 2 × the hour; the 1 h day: the Act's half day
				near(amount(breakdown, 'REST_DAY_WORK'), 9 * 2 * STATUTORY_HOUR + DAY / 2, 'REST_DAY_WORK');
				near(amount(breakdown, 'REST_DAY_OVERTIME'), 2 * 2 * STATUTORY_HOUR, 'REST_DAY_OVERTIME');
				near(amount(breakdown, 'OVERTIME'), 2 * 1.5 * STATUTORY_HOUR, 'OVERTIME');
			})
	);
});

const NIGHT = uuid(14);
// ₱15,650 × 12 ÷ 313 = ₱600 a day, ₱75 an hour. Clocked 21:55 to 06:05, a 22:00–06:00 shift with an unpaid 00:30–01:30
// break works 7 night hours: the law pays 7 × 10% × ₱75 = ₱52.50 on a working day and 7 × 200% × 10% × ₱75 = ₱105 on
// a regular holiday (Labor Code arts.86, 94); over its clocked span the shift is 8 h, 8 × 10% × ₱75 = ₱60.
const philippines = (employer: JsonObject) => {
	const base = pack(
		'PH',
		'Asia/Manila',
		{
			rate: { amount: 15650, unit: 'MONTHLY' },
			normal_hours_per_day: 8,
			normal_hours_per_week: 48,
			normal_days_per_week: 6,
			statutory_work_category: 'NON_FIELD',
			work_classification: 'RANK_AND_FILE',
			residency_status: 'CITIZEN',
			wage_payment_method: 'BANK',
			allowances: {}
		},
		{ days_per_year: 313, nationality: 'PH' },
		[],
		[{ date: '2026-02-11', kind: 'PUBLIC_HOLIDAY' }]
	);
	return withEmployer(
		{
			...base,
			shift_definition: [
				...(base.shift_definition ?? []),
				{
					id: NIGHT,
					entity_id: ENTITY,
					code: 'NIGHT',
					name: 'NIGHT',
					effective_range: { from: '2025-01-01', to: null },
					variant: {
						day_type: 'WORK',
						start_time: '22:00',
						end_time: '06:00',
						ends_next_day: true,
						breaks: [{ start_time: '00:30', end_time: '01:30', paid: false }]
					}
				}
			],
			roster_entry: ['2026-02-10', '2026-02-11'].map((date, index) => ({
				id: uuid(200 + index),
				employment_id: uuid(6),
				work_date: date,
				shift_definition_id: NIGHT,
				actual_worked_intervals: [{ start: `${date}T13:55:00.000Z`, end: `${date}T22:05:00.000Z` }],
				planned_overtime_intervals: null,
				findings: []
			}))
		},
		employer
	);
};

describe('night differential basis', () => {
	it.live('WORKED pays the statute on the worked night hours', () =>
		Effect.gen(function* () {
			const { breakdown } = yield* slip(philippines({}), '2026-02', FEBRUARY);
			near(amount(breakdown, 'NIGHT_SHIFT_DIFFERENTIAL'), 52.5 + 105, 'NIGHT_SHIFT_DIFFERENTIAL');
		})
	);

	it.live('CLOCK_SPAN pays the clocked span per shift, never below the statute', () =>
		Effect.gen(function* () {
			const { breakdown } = yield* slip(
				philippines({ pay_methods: { night_differential_basis: 'CLOCK_SPAN' } }),
				'2026-02',
				FEBRUARY
			);
			// the working day pays its 8 clocked hours; on the holiday the statute's ₱105 beats ₱60
			near(amount(breakdown, 'NIGHT_SHIFT_DIFFERENTIAL'), 60 + 105, 'NIGHT_SHIFT_DIFFERENTIAL');
		})
	);
});

describe('employee-borne income tax', () => {
	// Rp8,000,000 salary and a Rp2,000,000 special allowance; JKK 0.24%, JKM 0.30% and Kesehatan 4% on Rp10,000,000
	// put Rp10,454,000 in the month (PMK 168/2023 art.5(3)), TER A at 2.5%: Rp261,350 of PPh 21. The employee bears
	// 2.5% of the allowance, Rp50,000; the employer the remaining Rp211,350.
	it.live('the employer bears PPh 21 but the allowance the contract names', () =>
		Effect.gen(function* () {
			const seed = withEmployer(
				pack(
					'ID',
					'Asia/Jakarta',
					{
						rate: { amount: 8_000_000, unit: 'MONTHLY' },
						statutory_work_category: 'NON_MANUAL',
						work_classification: 'EA_COVERED',
						residency_status: 'CITIZEN',
						wage_payment_method: 'BANK',
						allowances: { SPECIAL_ALLOWANCE: { amount: 2_000_000 } },
						employer_bears_income_tax: true,
						employee_borne_tax_items: ['SPECIAL_ALLOWANCE']
					},
					{},
					[],
					[],
					'2026-06-15'
				),
				{ entity_extension_data: { risk_class: 'I' } }
			);
			const { payslip, breakdown } = yield* slip(seed, '2026-06', '2026-06-20T02:00:00.000Z');
			const borne = breakdown.statutory.find((row) => row.code === 'PPH21_EMPLOYER_BORNE');
			assert.equal(amount(breakdown, 'PPH21'), 261_350);
			assert.deepEqual(borne, {
				code: 'PPH21_EMPLOYER_BORNE',
				kind: 'TAX',
				employee: -211_350,
				employer: 211_350
			});
			assert.equal(payslip.tax_withheld.toNumber(), 50_000);
		})
	);
});
