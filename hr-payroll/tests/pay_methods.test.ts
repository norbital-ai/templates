// An employer's own pay method stands only where it pays at least the law; an employee-borne share of a borne income
// tax is a contract term. Real sealed law, a synthetic employee and a month, end to end through `payroll_run.create`.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import type { JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	REST,
	WORK,
	catalogRow,
	leaveCreate,
	pack,
	uuid,
	wholeDays,
	workspace
} from './kit.ts';

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

// RM1,927 a month: the day is × 12 ÷ (52 × the contract's days a week) and the hour that ÷ its daily hours; the weekly
// basis is × 12 ÷ (52 × weekly hours), so it lifts the hour only where the week is shorter than its days × daily hours
const malaysia = (hours: number, days: number, employer: JsonObject, week = hours * days) =>
	withEmployer(
		pack(
			'MY',
			'Asia/Kuala_Lumpur',
			{
				rate: { amount: 1927, unit: 'MONTHLY' },
				normal_hours_per_day: hours,
				normal_hours_per_week: week,
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
// 9 h × 5: the day, and its hour to the sen
const DAY = (1927 * 12) / (52 * 5);
const ROUNDED_STATUTORY_HOUR = 9.88;
// 8 h × 6 on a 45 h week (a short sixth day): the day, its hour to the sen and the weekly hour to the sen
const SIX_DAY = (1927 * 12) / (52 * 6);
const SIX_DAY_HOUR = 9.26;
const WEEKLY_HOUR = 9.88;

describe('employer pay methods', () => {
	it('the hours read as the law and the employer method say', () => {
		assert.equal((DAY / 9).toFixed(2), String(ROUNDED_STATUTORY_HOUR));
		assert.equal((SIX_DAY / 8).toFixed(2), String(SIX_DAY_HOUR));
		assert.equal(((1927 * 12) / (52 * 45)).toFixed(2), String(WEEKLY_HOUR));
	});

	it.live('without methods a 9 h × 5 worker is paid the Act’s hour', () =>
		Effect.gen(function* () {
			const { breakdown } = yield* slip(malaysia(9, 5, {}), '2026-02', FEBRUARY);
			near(amount(breakdown, 'OVERTIME'), 2 * 1.5 * ROUNDED_STATUTORY_HOUR, 'OVERTIME');
			near(amount(breakdown, 'REST_DAY_WORK'), DAY + DAY / 2, 'REST_DAY_WORK');
			near(
				amount(breakdown, 'REST_DAY_OVERTIME'),
				2 * 2 * ROUNDED_STATUTORY_HOUR,
				'REST_DAY_OVERTIME'
			);
		})
	);

	it.live(
		'CONTRACT_WEEKLY lifts an 8 h × 6 worker’s overtime hour on a 45 h week, not the rest-day day',
		() =>
			Effect.gen(function* () {
				const statutory = yield* slip(malaysia(8, 6, {}, 45), '2026-02', FEBRUARY);
				const weekly = yield* slip(
					malaysia(8, 6, { pay_methods: { overtime_hour_basis: 'CONTRACT_WEEKLY' } }, 45),
					'2026-02',
					FEBRUARY
				);
				// the premium hour is rounded to the sen before it multiplies the hours: 1.5 × 9.26 = 13.89, 1.5 × 9.88 = 14.82
				near(amount(statutory.breakdown, 'OVERTIME'), 2 * 13.89, 'statutory OVERTIME');
				near(amount(weekly.breakdown, 'OVERTIME'), 2 * 14.82, 'OVERTIME');
				// the 11 h rest day runs 3 h beyond the 8 normal hours
				near(
					amount(statutory.breakdown, 'REST_DAY_OVERTIME'),
					3 * 2 * SIX_DAY_HOUR,
					'statutory REST_DAY_OVERTIME'
				);
				near(
					amount(weekly.breakdown, 'REST_DAY_OVERTIME'),
					3 * 2 * WEEKLY_HOUR,
					'REST_DAY_OVERTIME'
				);
				for (const { breakdown } of [statutory, weekly])
					near(amount(breakdown, 'REST_DAY_WORK'), SIX_DAY + SIX_DAY / 2, 'REST_DAY_WORK');
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
			near(amount(statutory.breakdown, 'OVERTIME'), 2 * 1.5 * 9.88, 'statutory');
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
				near(
					amount(breakdown, 'REST_DAY_WORK'),
					9 * 2 * ROUNDED_STATUTORY_HOUR + DAY / 2,
					'REST_DAY_WORK'
				);
				near(
					amount(breakdown, 'REST_DAY_OVERTIME'),
					2 * 2 * ROUNDED_STATUTORY_HOUR,
					'REST_DAY_OVERTIME'
				);
				near(amount(breakdown, 'OVERTIME'), 2 * 1.5 * ROUNDED_STATUTORY_HOUR, 'OVERTIME');
			})
	);
});

const NIGHT = uuid(14);
// ₱15,650 × 12 ÷ 313 = ₱600 a day, ₱75 an hour. Clocked 21:55 to 06:05, a 22:00–06:00 shift with an unpaid 00:30–01:30
// break works 7 night hours: the law pays 7 × 10% × ₱75 = ₱52.50 on a working day and 7 × 200% × 10% × ₱75 = ₱105 on
// a regular holiday (Labor Code arts.86, 94); over its clocked span the shift is 8 h, 8 × 10% × ₱75 = ₱60.
const filipino = (holidays: Parameters<typeof pack>[5]) =>
	pack(
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
		holidays
	);
const philippines = (employer: JsonObject) => {
	const base = filipino([{ date: '2026-02-11', kind: 'PUBLIC_HOLIDAY' }]);
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

	it.live(
		'WHOLE_NIGHT pays a worked night shift eight hours of the premium at the day’s rate',
		() =>
			Effect.gen(function* () {
				const { breakdown } = yield* slip(
					philippines({ pay_methods: { night_differential_basis: 'WHOLE_NIGHT' } }),
					'2026-02',
					FEBRUARY
				);
				// 7 night hours clocked: the working day pays 8 × 10% × ₱75 = ₱60, the regular holiday 8 × 200% × 10% × ₱75 = ₱120
				near(amount(breakdown, 'NIGHT_SHIFT_DIFFERENTIAL'), 60 + 120, 'NIGHT_SHIFT_DIFFERENTIAL');
			})
	);
});

describe('contribution split', () => {
	// ₱15,650 a month, paid twice a month. The first run estimates the month at its own ₱7,825 plus the second half's
	// ₱7,825: a ₱15,500 salary credit, SSS 5% ₱775 and 10% ₱1,550, EC ₱30 from ₱15,000; Pag-IBIG 2% of the ₱10,000
	// ceiling each side; PhilHealth 5% of the basic rate, ₱782.50, halved. Three no-pay days at ₱600 then leave the
	// second half ₱6,025 and the month ₱13,850: a ₱14,000 credit owes ₱700 and ₱1,400, so ₱75 and ₱150 come back.
	it.live(
		'FIRST_RUN charges the month on the first run and settles its actual wages on the second',
		() => {
			const base = withEmployer(filipino([]), { pay_methods: { contribution_split: 'FIRST_RUN' } });
			const seed: Seed = {
				...base,
				pay_group: (base.pay_group ?? []).map((row) => ({
					...row,
					payment_schedule: {
						frequency: 'SEMI_MONTHLY',
						business_day: 'PREVIOUS',
						non_working_weekdays: [0, 6],
						short_month: 'LAST_DAY',
						pay_days: [15, 31]
					}
				}))
			};
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const shares = (period: string) =>
					Effect.gen(function* () {
						yield* t
							.as(t.admin)
							.act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }]);
						yield* t.runDue();
						const { payslip, payroll_run } = yield* t.storedQuery({
							payslip: { limit: 2 },
							payroll_run: { limit: 2 }
						});
						const row = payslip.rows.find(
							(slip) =>
								slip.payroll_run_id === payroll_run.rows.find((run) => run.period === period)?.id
						);
						assert.ok(row !== undefined, period);
						const { statutory } = Schema.decodeUnknownSync(PayslipBreakdown)(row.breakdown);
						return Object.fromEntries(
							['SSS', 'SSS_EC', 'PHIC', 'HDMF'].map((code) => {
								const paid = statutory.find((scheme) => scheme.code === code);
								return [code, [paid?.employee ?? 0, paid?.employer ?? 0]];
							})
						);
					});
				assert.deepEqual(yield* shares('2026-02-1'), {
					SSS: [775, 1550],
					SSS_EC: [0, 30],
					PHIC: [391.25, 391.25],
					HDMF: [200, 200]
				});
				yield* t.as(t.admin).act('leave_catalog_entry.create', [
					leaveCreate({
						entity_id: ENTITY,
						employment_id: idOf('employee_contract', uuid(6)),
						catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', 'NPL')),
						days: wholeDays('2026-02-17', '2026-02-18', '2026-02-19')
					})
				]);
				assert.deepEqual(yield* shares('2026-02-2'), {
					SSS: [-75, -150],
					SSS_EC: [0, 0],
					PHIC: [0, 0],
					HDMF: [0, 0]
				});
			}).pipe(Effect.provide(workspace({ seed, now: '2026-03-05T02:00:00.000Z' })));
		}
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
