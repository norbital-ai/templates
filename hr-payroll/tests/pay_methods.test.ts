// An employer's own pay method stands only where it pays at least the law. A sealed law pack as the fixture, a synthetic
// employee and a month, end to end through `payroll_run.create`: each method is judged against the same run without it,
// never against a figure worked from the statute.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import type { JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf, objectValue } from '../src/lib/payroll_engine/reads.ts';
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
/** The method pays more than the statute alone, which pays something. */
const lifted = (method: number, statutory: number, what: string) =>
	assert.ok(
		statutory > 0 && method > statutory,
		`${what}: ${method} with the method, ${statutory} without`
	);

// the weekly basis divides by the contract's weekly hours, so it lifts the hour only where the week is shorter than its
// days × daily hours
const OVERTIME_DAY = (hours: number) => ({
	date: '2026-02-02',
	shift: WORK,
	hours: hours + 2,
	overtime: 2
});
const LONG_REST_DAY = { date: '2026-02-01', shift: REST, hours: 11 };
const SHORT_REST_DAY = { date: '2026-02-08', shift: REST, hours: 1 };
const malaysia = (
	hours: number,
	days: number,
	employer: JsonObject,
	week = hours * days,
	roster: Parameters<typeof pack>[4] = [OVERTIME_DAY(hours), LONG_REST_DAY, SHORT_REST_DAY]
) =>
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
			roster,
			[]
		),
		employer
	);
const FEBRUARY = '2026-02-20T02:00:00.000Z';

describe('employer pay methods', () => {
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
				lifted(
					amount(weekly.breakdown, 'OVERTIME'),
					amount(statutory.breakdown, 'OVERTIME'),
					'OVERTIME'
				);
				// the 11 h rest day runs 3 h beyond the 8 normal hours
				lifted(
					amount(weekly.breakdown, 'REST_DAY_OVERTIME'),
					amount(statutory.breakdown, 'REST_DAY_OVERTIME'),
					'REST_DAY_OVERTIME'
				);
				assert.ok(amount(statutory.breakdown, 'REST_DAY_WORK') > 0);
				assert.equal(
					amount(weekly.breakdown, 'REST_DAY_WORK'),
					amount(statutory.breakdown, 'REST_DAY_WORK')
				);
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
			assert.ok(amount(statutory.breakdown, 'OVERTIME') > 0);
			assert.equal(amount(weekly.breakdown, 'OVERTIME'), amount(statutory.breakdown, 'OVERTIME'));
		})
	);

	it.live(
		'a rest-day multiple of 2 lifts a long rest day; a 1 h shift keeps the statute’s day, which pays more',
		() =>
			Effect.gen(function* () {
				const method = { pay_methods: { rest_day_hourly_multiplier: 2 } };
				const restDay = (employer: JsonObject, day: typeof LONG_REST_DAY) =>
					slip(malaysia(9, 5, employer, 45, [day]), '2026-02', FEBRUARY).pipe(
						Effect.map(({ breakdown }) => amount(breakdown, 'REST_DAY_WORK'))
					);
				lifted(
					yield* restDay(method, LONG_REST_DAY),
					yield* restDay({}, LONG_REST_DAY),
					'REST_DAY_WORK'
				);
				const floor = yield* restDay({}, SHORT_REST_DAY);
				assert.ok(floor > 0);
				assert.equal(yield* restDay(method, SHORT_REST_DAY), floor);
			})
	);
});

const NIGHT = uuid(14);
// Clocked 21:55 to 06:05 on a 22:00–06:00 shift with an unpaid 00:30–01:30 break: fewer night hours worked than the
// clocked span holds, so the span pays more on a working day; on a regular holiday the statute's premium pays more.
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
const WORKING_NIGHT = '2026-02-10';
const HOLIDAY_NIGHT = '2026-02-11';
const philippines = (employer: JsonObject, nights = [WORKING_NIGHT, HOLIDAY_NIGHT]) => {
	const base = filipino([{ date: HOLIDAY_NIGHT, kind: 'PUBLIC_HOLIDAY' }]);
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
			roster_entry: nights.map((date, index) => ({
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
	const premium = (employer: JsonObject, nights?: string[]) =>
		slip(philippines(employer, nights), '2026-02', FEBRUARY).pipe(
			Effect.map(({ breakdown }) => amount(breakdown, 'NIGHT_SHIFT_DIFFERENTIAL'))
		);
	it.live('CLOCK_SPAN pays the clocked span per shift, never below the statute', () =>
		Effect.gen(function* () {
			const span = { pay_methods: { night_differential_basis: 'CLOCK_SPAN' } };
			lifted(
				yield* premium(span, [WORKING_NIGHT]),
				yield* premium({}, [WORKING_NIGHT]),
				'a working night'
			);
			// on the holiday the statute's premium is the greater: the shift keeps it
			const statute = yield* premium({}, [HOLIDAY_NIGHT]);
			assert.ok(statute > 0);
			assert.equal(yield* premium(span, [HOLIDAY_NIGHT]), statute);
		})
	);

	it.live('WHOLE_NIGHT pays a worked night shift the whole shift’s premium at the day’s rate', () =>
		Effect.gen(function* () {
			const whole = { pay_methods: { night_differential_basis: 'WHOLE_NIGHT' } };
			lifted(
				yield* premium(whole, [WORKING_NIGHT]),
				yield* premium({}, [WORKING_NIGHT]),
				'a working night'
			);
			lifted(
				yield* premium(whole, [HOLIDAY_NIGHT]),
				yield* premium({}, [HOLIDAY_NIGHT]),
				'a holiday night'
			);
		})
	);
});

describe('contribution split', () => {
	// Paid twice a month. The first run charges the whole month on its estimate; three no-pay days then lower the second
	// half's wages, and the second run settles the month on what was paid: what the first over-charged comes back.
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
				const first = yield* shares('2026-02-1');
				for (const [code, [employee = 0, employer = 0]] of Object.entries(first))
					assert.ok(employee >= 0 && employer > 0, `${code} is charged on the first run`);
				yield* t.as(t.admin).act('leave_catalog_entry.create', [
					leaveCreate({
						entity_id: ENTITY,
						employment_id: idOf('employee_contract', uuid(6)),
						catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', 'NPL')),
						days: wholeDays('2026-02-17', '2026-02-18', '2026-02-19')
					})
				]);
				const second = yield* shares('2026-02-2');
				// nothing is charged twice: the second run only settles, and what the lower wages over-charged comes back
				for (const [code, [employee = 0, employer = 0]] of Object.entries(second)) {
					assert.ok(employee <= 0 && employer <= 0, `${code} is not charged again`);
					const [paid = 0, cost = 0] = first[code] ?? [];
					assert.ok(paid + employee >= 0 && cost + employer >= 0, `${code} gives back no more`);
				}
				assert.ok(
					Object.values(second).some(([employee = 0]) => employee < 0),
					JSON.stringify(second)
				);
			}).pipe(Effect.provide(workspace({ seed, now: '2026-03-05T02:00:00.000Z' })));
		}
	);
});

describe('benefit exclusion', () => {
	// A monthly benefit past its own tax-free limit. Pooled, the excess sits in the yearly exclusion and the month
	// withholds nothing on it; taxed as paid, the month's withholding rises by a share of the benefit.
	it.live('EXCESS_TAXED taxes a benefit past its own limit in the month it is paid', () =>
		Effect.gen(function* () {
			const seed = (employer: JsonObject): Seed =>
				withEmployer(
					pack(
						'PH',
						'Asia/Manila',
						{
							rate: { amount: 130_000, unit: 'MONTHLY' },
							normal_hours_per_day: 8,
							normal_hours_per_week: 48,
							normal_days_per_week: 6,
							statutory_work_category: 'NON_FIELD',
							work_classification: 'RANK_AND_FILE',
							residency_status: 'CITIZEN',
							wage_payment_method: 'BANK',
							allowances: { meal: { amount: 4500 } }
						},
						{ days_per_year: 313, nationality: 'PH' },
						[],
						[]
					),
					employer
				);
			const tax = (breakdown: PayslipBreakdown) =>
				breakdown.statutory.find((row) => row.code === 'WTAX')?.employee ?? 0;
			const paid = yield* slip(seed({}), '2026-02', FEBRUARY);
			const projected = yield* slip(
				seed({ pay_methods: { benefit_exclusion: 'EXCESS_TAXED' } }),
				'2026-02',
				FEBRUARY
			);
			const more = tax(projected.breakdown) - tax(paid.breakdown);
			assert.ok(more > 0 && more < 4500, `WTAX on the excess: ${more}`);
		})
	);
});

describe('employer-share correction', () => {
	// The employer's side of a closed month's SSS correction: employer cost only, the payslip's net is untouched.
	it.live('an employer-share adjustment adds to employer cost and leaves net pay alone', () =>
		Effect.gen(function* () {
			const seed = filipino([]);
			// a correction is dated in a month a run has closed: January runs first, February carries the entry
			const february = (correct: boolean) =>
				Effect.gen(function* () {
					const t = yield* TestWorkspace;
					const run = (period: string) =>
						t
							.as(t.admin)
							.act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }]);
					yield* run('2026-01');
					yield* t.runDue();
					if (correct)
						yield* t.as(t.admin).act('adhoc_catalog_entry.create', [
							{
								entity_id: ENTITY,
								employment_id: idOf('employee_contract', uuid(6)),
								catalog_id: idOf(
									'adhoc_catalog',
									catalogRow(seed, 'adhoc_catalog', 'SSS_EMPLOYER_ADJUSTMENT')
								),
								description: 'Correction',
								quantity: 450,
								incurred_on: PlainDate('2026-01-15'),
								reverses: null
							}
						]);
					yield* run('2026-02');
					yield* t.runDue();
					const { payslip, payroll_run } = yield* t.storedQuery({
						payslip: { limit: 2 },
						payroll_run: { limit: 2 }
					});
					const row = payslip.rows.find(
						(slip) =>
							slip.payroll_run_id === payroll_run.rows.find((r) => r.period === '2026-02')?.id
					);
					assert.ok(row !== undefined, 'the February run wrote a payslip');
					return row;
				}).pipe(Effect.provide(workspace({ seed, now: '2026-03-05T02:00:00.000Z' })));
			const plain = { payslip: yield* february(false) };
			const corrected = yield* february(true);
			near(corrected.net_pay.toNumber(), plain.payslip.net_pay.toNumber(), 'net pay');
			near(
				corrected.employer_cost.toNumber() - plain.payslip.employer_cost.toNumber(),
				450,
				'employer cost'
			);
		})
	);
});

describe('contribution correction and tax', () => {
	// A contribution correction deducted in February is a contribution deducted: February's withholding falls by a
	// share of it.
	it.live('a correction entry of the run lowers the taxable pay it is deducted from', () =>
		Effect.gen(function* () {
			const seed = pack(
				'PH',
				'Asia/Manila',
				{
					rate: { amount: 130_000, unit: 'MONTHLY' },
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
				[]
			);
			const february = (correct: boolean) =>
				Effect.gen(function* () {
					const t = yield* TestWorkspace;
					const run = (period: string) =>
						t
							.as(t.admin)
							.act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }]);
					yield* run('2026-01');
					yield* t.runDue();
					if (correct)
						yield* t.as(t.admin).act('adhoc_catalog_entry.create', [
							{
								entity_id: ENTITY,
								employment_id: idOf('employee_contract', uuid(6)),
								catalog_id: idOf(
									'adhoc_catalog',
									catalogRow(seed, 'adhoc_catalog', 'PHIC_ADJUSTMENT')
								),
								description: 'Correction',
								quantity: 100,
								incurred_on: PlainDate('2026-01-15'),
								reverses: null
							}
						]);
					yield* run('2026-02');
					yield* t.runDue();
					const { payslip, payroll_run } = yield* t.storedQuery({
						payslip: { limit: 2 },
						payroll_run: { limit: 2 }
					});
					const row = payslip.rows.find(
						(slip) =>
							slip.payroll_run_id === payroll_run.rows.find((r) => r.period === '2026-02')?.id
					);
					assert.ok(row !== undefined, 'the February run wrote a payslip');
					return row.tax_withheld.toNumber();
				}).pipe(Effect.provide(workspace({ seed, now: '2026-03-05T02:00:00.000Z' })));
			const less = (yield* february(false)) - (yield* february(true));
			assert.ok(less > 0 && less < 100, `tax on the correction: ${less}`);
		})
	);
});

describe('overtime hour', () => {
	// The hour is the month's wage over the fixture law's fixed hours, and two hours past the day run through the
	// overtime row's bands: all three are read from the fixture rows.
	it.live('without an employer method the hour is not rounded before it multiplies', () =>
		Effect.gen(function* () {
			const seed = pack(
				'ID',
				'Asia/Jakarta',
				{
					rate: { amount: 5_000_000, unit: 'MONTHLY' },
					normal_hours_per_day: 8,
					normal_hours_per_week: 40,
					normal_days_per_week: 5,
					statutory_work_category: 'NON_MANUAL',
					work_classification: 'EA_COVERED',
					residency_status: 'CITIZEN',
					wage_payment_method: 'BANK',
					allowances: {}
				},
				{},
				[{ date: '2026-02-02', shift: WORK, hours: 10, overtime: 2 }],
				[]
			);
			const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
			const settings = (seed.jurisdiction_settings ?? []).find((row) => row.id === version);
			const { hour } = Schema.decodeUnknownSync(
				Schema.Struct({ hour: Schema.Struct({ hours: Schema.Number }) })
			)(settings?.conversions);
			const bands = Schema.decodeUnknownSync(
				Schema.Array(Schema.Struct({ up_to: Schema.NullOr(Schema.Number), rate: Schema.Number }))
			)(
				objectValue(
					(seed.overtime_catalog ?? []).find(
						(row) => row.id === catalogRow(seed, 'overtime_catalog', 'OVERTIME')
					)?.lookup
				).ordinary_bands
			);
			// the two overtime hours, each at the rate of the band it falls in
			const multiple = [1, 2].reduce(
				(total, nth) =>
					total + (bands.find((band) => band.up_to === null || nth <= band.up_to)?.rate ?? 0),
				0
			);
			const unrounded = Math.round((multiple * 5_000_000) / hour.hours);
			assert.notEqual(unrounded, multiple * Math.round(5_000_000 / hour.hours));
			const { breakdown } = yield* slip(seed, '2026-02', FEBRUARY);
			assert.equal(amount(breakdown, 'OVERTIME'), unrounded);
		})
	);
});
