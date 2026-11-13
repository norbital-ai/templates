// The share of a period a salary pays: by calendar days, the person's working days or a day rate, with the rate rounded
// before or after it multiplies; a leaver's days employed; and a contract version starting inside the period. The
// law is the Malaysian fixture's, varied per test; every expected figure is worked from the test's own inputs.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import type { JsonObject } from '../../src/lib/payroll_engine/contracts.ts';
import { calculatePayroll, type PayrollInput } from '../../src/lib/payroll_engine/engine.ts';
import { PayslipBreakdown } from '../../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf, objectValue } from '../../src/lib/payroll_engine/reads.ts';
import { ownLines, run } from '../amendment_kit.ts';
import {
	ENTITY,
	OFF,
	lawWith,
	leaveCreate,
	REST,
	WORK,
	pack,
	storedQuery,
	uuid,
	workspace,
	decimalNumber
} from '../kit.ts';

const days = (off: readonly number[]) =>
	Array.from({ length: 31 }, (_, index) => ({
		date: `2026-03-${String(index + 1).padStart(2, '0')}`,
		work: !off.includes(index + 1)
	}));
// March 2026: Saturdays and Sundays off
const march = days([1, 7, 8, 14, 15, 21, 22, 28, 29]);
const salary = (
	settings: JsonObject,
	absent: readonly string[],
	amount = 3100,
	prorated = false
) => {
	const input: PayrollInput = {
		run: {
			id: 'run',
			entity_id: 'entity',
			pay_date: '2026-03-31',
			salary_coverage: { from: '2026-03-01', to: '2026-03-31' }
		},
		settings,
		subtotals: [
			{ code: 'BASE', name: 'BASE', previous: null },
			...(prorated
				? [
						{
							code: 'PRORATED',
							name: 'PRORATED',
							previous: 'BASE',
							calculation: 'return -(ctx.proration_amount + ctx.abs_amount);'
						}
					]
				: [])
		],
		allowance: [],
		overtime: [],
		statutory: [],
		leave_catalog: [],
		claim_catalog: [],
		adhoc_catalog: [],
		loan_catalog: [],
		employee: {},
		employment: {
			id: 'contract',
			terms: {
				rate: { amount, unit: 'MONTHLY' },
				normal_hours_per_day: 8,
				normal_hours_per_week: 40,
				normal_days_per_week: 5
			}
		},
		employer: {},
		balance: { account: {} },
		entries: {},
		work: { days: absent.map((date) => ({ date, day_type: 'ABS' })) },
		projected_days: march
	};
	return calculatePayroll(input).subtotals.at(-1)?.value ?? 0;
};
const workDays = march.filter(({ work }) => work).map(({ date }) => date);
const conversions = {
	day: { basis: 'WORKING_DAYS' },
	hour: { basis: 'CONTRACT_HOURS' },
	proration: 'CALENDAR_DAYS',
	rounding: { mode: 'HALF_UP', scale: 2 }
};
const settingsWith = (over: JsonObject): JsonObject => ({
	code: 'MY',
	conversions: { ...conversions, ...over },
	ledger: { ytd_scope: 'JURISDICTION' }
});
const calendar = settingsWith({});
const working = settingsWith({ proration: 'WORKING_DAYS' });
// A six-day half month, March 1–15: the day rate is monthly × 12 ÷ (365 − 52 rest days), 600 on 15,650.
const sixDayMarch = days([1, 8, 15, 22, 29]);
const yearRestDays = settingsWith({ day: { basis: 'YEAR_REST_DAYS' }, proration: 'DAY_RATE' });
const halfInput = (
	halfDays: readonly { readonly date: string; readonly part: string }[],
	absent: readonly string[] = [],
	statutory: readonly JsonObject[] = []
) => {
	const input: PayrollInput = {
		run: {
			id: 'run',
			entity_id: 'entity',
			pay_date: '2026-03-20',
			salary_coverage: { from: '2026-03-01', to: '2026-03-15' }
		},
		settings: yearRestDays,
		subtotals: [
			{
				code: 'BASE',
				name: 'BASE',
				previous: null,
				calculation: 'return ctx.base_pay / 2;'
			}
		],
		allowance: [],
		overtime: [],
		statutory,
		leave_catalog: [
			{
				code: 'UNPAID_LEAVE',
				subtotal: 'BASE',
				paid_share: '0'
			}
		],
		claim_catalog: [],
		adhoc_catalog: [],
		loan_catalog: [],
		employee: {},
		employment: {
			id: 'contract',
			terms: {
				rate: { amount: 15650, unit: 'MONTHLY' },
				normal_hours_per_day: 8,
				normal_hours_per_week: 48,
				normal_days_per_week: 6
			}
		},
		employer: {
			payment_schedule: { frequency: 'SEMI_MONTHLY', non_working_weekdays: [0] }
		},
		balance: { account: {} },
		entries:
			halfDays.length === 0
				? {}
				: { leave_catalog_entry: [{ id: 'entry', catalog_code: 'UNPAID_LEAVE', days: halfDays }] },
		work: { days: absent.map((date) => ({ date, day_type: 'ABS' })) },
		projected_days: sixDayMarch
	};
	return input;
};
const half = (
	halfDays: readonly { readonly date: string; readonly part: string }[],
	absent: readonly string[] = []
) => calculatePayroll(halfInput(halfDays, absent)).subtotals[0]?.value ?? 0;
const cents = (value: number) => Math.round(value * 100) / 100;

describe('the proration basis', () => {
	it('takes a day of the wage period on calendar days', () => {
		assert.equal(salary(calendar, ['2026-03-04']), 3100 - 3100 / 31);
	});

	it('takes one of the person’s own days on working days', () => {
		assert.ok(Math.abs(salary(working, ['2026-03-04']) - 3100 * (21 / 22)) < 0.01);
	});

	it('takes the day rate per day on a day-rate basis, half a day per half slot', () => {
		const day = (15650 * 12) / (365 - 52);
		assert.equal(half([]), 15650 / 2);
		assert.equal(half([], ['2026-03-04']), 15650 / 2 - day);
		assert.equal(half([{ date: '2026-03-04', part: 'AM' }]), 15650 / 2 - day / 2);
	});

	it('shows a statutory row the priced leave slots', () => {
		const result = calculatePayroll(
			halfInput(
				[
					{ date: '2026-03-04', part: 'AM' },
					{ date: '2026-03-04', part: 'PM' }
				],
				[],
				[
					{
						code: 'TEST',
						subtotal: 'BASE',
						employee_amount:
							"return (ctx.leave ?? []).filter((slot) => slot.code === 'UNPAID_LEAVE').length / 2;",
						employer_amount: 'return 0;'
					}
				]
			)
		);
		assert.equal(result.statutory[0]?.employee, 1);
	});

	it('deducts only the days absent, not the weekend between them', () => {
		assert.equal(salary(calendar, ['2026-03-06', '2026-03-09']), 3100 - (2 * 3100) / 31);
	});

	it('pays the rest days when every work day is missed', () => {
		assert.equal(salary(calendar, workDays), (3100 * (31 - workDays.length)) / 31);
		assert.equal(salary(working, workDays), 0);
	});
});

describe('a day rate’s rounding', () => {
	// the absent days come off at PRORATED. 3,001 × 12 ÷ (52 × 5) does not end at the cent, so rounding it before or after it multiplies three days differs
	const amount = 3001;
	const day = (amount * 12) / (52 * 5);
	const absent = ['2026-03-04', '2026-03-05', '2026-03-06'];
	const rated = (rounding: JsonObject) =>
		salary(
			settingsWith({
				day: { basis: 'YEAR' },
				proration: 'DAY_RATE',
				rounding: { mode: 'HALF_UP', scale: 2, ...rounding }
			}),
			absent,
			amount,
			true
		);
	it('RATE, the default, rounds the day before it multiplies the days', () => {
		assert.equal(rated({}), cents(amount - absent.length * cents(day)));
	});
	it('AMOUNT rounds only what the days come to', () => {
		assert.equal(rated({ day_rate: 'AMOUNT' }), cents(amount - absent.length * day));
		assert.notEqual(rated({ day_rate: 'AMOUNT' }), rated({}));
	});
});

describe('a leaver on a shift pattern', () => {
	// paid by working days: the days after the last day are still working days of the period, unpaid
	const PATTERN = uuid(950);
	const SALARY = 6600;
	const base = pack(
		'MY',
		'Asia/Kuala_Lumpur',
		{
			rate: { amount: SALARY, unit: 'MONTHLY' },
			statutory_work_category: 'NON_MANUAL',
			work_classification: 'EA_COVERED',
			residency_status: 'CITIZEN',
			wage_payment_method: 'BANK',
			allowances: {},
			shift_pattern_id: PATTERN
		},
		{},
		[],
		[]
	);
	const seed = {
		...lawWith(base, { conversions: { proration: 'WORKING_DAYS' } }),
		shift_pattern: [
			{
				id: PATTERN,
				entity_id: ENTITY,
				code: 'WEEKDAYS',
				name: 'Weekdays',
				effective_range: { from: '2026-01-01', to: null },
				pattern: {
					week_start: 'MONDAY',
					days: {
						MONDAY: WORK,
						TUESDAY: WORK,
						WEDNESDAY: WORK,
						THURSDAY: WORK,
						FRIDAY: WORK,
						SATURDAY: REST,
						SUNDAY: OFF
					}
				}
			}
		],
		employee_contract: (base.employee_contract ?? []).map((row) => ({
			...row,
			effective_range: { from: '2026-01-01', to: '2026-06-12' }
		}))
	};

	it.live('is paid the working days employed, not the calendar days', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			yield* admin.act({
				'payroll_run.create': [{ entity_id: ENTITY, period: '2026-06', kind: 'ON_CYCLE' }]
			});
			const [slip] = (yield* storedQuery(t, { payslip: { limit: 1 } })).payslip.rows;
			// BASIC is the contract salary; PRORATED is what the days employed leave of it
			assert.equal(decimalNumber(slip?.basic_earnings), SALARY);
			const { checkpoints } = Schema.decodeUnknownSync(PayslipBreakdown)(slip?.breakdown);
			// June 2026 has 22 weekdays; the 1st to the 12th hold 10 of them (12 of 30 calendar days would pay less)
			assert.equal(
				checkpoints.find((point) => point.code === 'PRORATED')?.value,
				(SALARY * 10) / 22
			);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-06-20T02:00:00.000Z' })))
	);
});

describe('a contract version that starts inside the period', () => {
	const terms = (amount: number) => ({
		rate: { amount, unit: 'MONTHLY' },
		statutory_work_category: 'MANUAL_LABOUR',
		work_classification: 'EA_COVERED',
		residency_status: 'CITIZEN',
		wage_payment_method: 'BANK',
		allowances: {}
	});
	/** One person paid 3,000 to 15 February and 3,600 from the 16th, with two overtime hours on one day if named. */
	const raised = (overtimeOn?: string) => {
		const seed = pack(
			'MY',
			'Asia/Kuala_Lumpur',
			terms(3000),
			{},
			// a roster makes every day it leaves out an absence: the salary case keeps none
			overtimeOn === undefined ? [] : [{ date: overtimeOn, shift: WORK, hours: 10, overtime: 2 }],
			[]
		);
		const [first] = seed.employee_contract ?? [];
		assert.ok(first !== undefined);
		return {
			...seed,
			employee_contract: [
				{ ...first, effective_range: { from: '2025-01-01', to: '2026-02-15' } },
				{
					...first,
					id: uuid(60),
					effective_range: { from: '2026-02-16', to: null },
					terms: { ...objectValue(first.terms), ...terms(3600) }
				}
			]
		};
	};
	const february = (overtimeOn?: string) =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-02');
			return yield* ownLines(t, '2026-02');
		}).pipe(
			Effect.provide(workspace({ seed: raised(overtimeOn), now: '2026-02-20T02:00:00.000Z' }))
		);

	it.live('pays the days before it at the earlier salary', () =>
		Effect.gen(function* () {
			const lines = yield* february();
			// 15 of February's 28 days at 3,000 and 13 at 3,600
			const basic = (lines['BASIC/EMPLOYEE'] ?? 0) + (lines['PRORATED/EMPLOYEE'] ?? 0);
			assert.equal(cents(basic), cents((3000 * 15) / 28 + (3600 * 13) / 28));
		})
	);

	it.live('prices a no-pay day by the version in force on its date', () => {
		const noPayOn = (date: string, employment: string) =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* (yield* t.as(t.admin)).act({
					'leave_catalog_entry.create': [
						leaveCreate({
							entity_id: ENTITY,
							employment_id: idOf('employee_contract', employment),
							catalog_code: 'NPL',
							days: [
								{ date, part: 'AM' },
								{ date, part: 'PM' }
							]
						})
					]
				});
				yield* run(t, '2026-02');
				return -((yield* ownLines(t, '2026-02'))['NPL/EMPLOYEE'] ?? 0);
			}).pipe(Effect.provide(workspace({ seed: raised(), now: '2026-02-20T02:00:00.000Z' })));
		return Effect.gen(function* () {
			const before = yield* noPayOn('2026-02-10', uuid(6));
			const after = yield* noPayOn('2026-02-18', uuid(60));
			assert.ok(before > 0 && after > 0);
			// the same whole day, at 3,000 and at 3,600
			assert.ok(
				Math.abs(after / before - 3600 / 3000) < 0.01,
				`${String(before)} then ${String(after)}`
			);
		});
	});

	it.live('prices overtime by the version it was worked under', () =>
		Effect.gen(function* () {
			const before = yield* february('2026-02-10');
			const after = yield* february('2026-02-18');
			const early = before['OVERTIME/EMPLOYEE'] ?? 0,
				late = after['OVERTIME/EMPLOYEE'] ?? 0;
			assert.ok(early > 0 && late > 0);
			// the same two hours, at 3,000 and at 3,600
			assert.ok(
				Math.abs(late / early - 3600 / 3000) < 0.01,
				`${String(early)} then ${String(late)}`
			);
		})
	);
});
