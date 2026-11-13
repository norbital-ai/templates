import { assert, describe, it } from '@effect/vitest';
import type { JsonObject } from '../src/lib/payroll_engine/contracts.js';
import { calculatePayroll, type PayrollInput } from '../src/lib/payroll_engine/engine.js';

const days = (off: readonly number[]) =>
	Array.from({ length: 31 }, (_, index) => ({
		date: `2026-03-${String(index + 1).padStart(2, '0')}`,
		work: !off.includes(index + 1)
	}));
// March 2026: Saturdays and Sundays off
const march = days([1, 7, 8, 14, 15, 21, 22, 28, 29]);
const salary = (settings: JsonObject, absent: readonly string[]) => {
	const input: PayrollInput = {
		run: {
			id: 'run',
			entity_id: 'entity',
			pay_date: '2026-03-31',
			salary_coverage: { from: '2026-03-01', to: '2026-03-31' }
		},
		settings,
		subtotals: [{ id: 'base', code: 'BASE', name: 'BASE', previous_id: null, settings_id: 'sg' }],
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
				rate: { amount: 3100, unit: 'MONTHLY' },
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
	return calculatePayroll(input).subtotals[0]?.value ?? 0;
};
const workDays = march.filter(({ work }) => work).map(({ date }) => date);
const calendar: JsonObject = {
	code: 'SG',
	conversions: {
		day: { basis: 'WORKING_DAYS' },
		hour: { basis: 'CONTRACT_HOURS' },
		proration: 'CALENDAR_DAYS',
		rounding: { mode: 'HALF_UP', scale: 2 }
	},
	ledger: { ytd_scope: 'JURISDICTION' }
};
const working: JsonObject = {
	...calendar,
	conversions: { ...(calendar.conversions as JsonObject), proration: 'WORKING_DAYS' }
};
// A Philippine six-day half: March 1–15, and the day rate is monthly × 12 ÷ 313 (600 on 15,650).
const sixDayMarch = days([1, 8, 15, 22, 29]);
const ph: JsonObject = {
	code: 'PH',
	conversions: {
		day: { basis: 'YEAR_REST_DAYS' },
		hour: { basis: 'CONTRACT_HOURS' },
		proration: 'DAY_RATE',
		rounding: { mode: 'HALF_UP', scale: 2 }
	},
	ledger: { ytd_scope: 'JURISDICTION' }
};
const phInput = (
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
		settings: ph,
		subtotals: [
			{
				id: 'base',
				code: 'BASE',
				name: 'BASE',
				previous_id: null,
				settings_id: 'ph',
				calculation: 'return ctx.base_pay / 2;'
			}
		],
		allowance: [],
		overtime: [],
		statutory,
		leave_catalog: [
			{
				id: 'leave',
				code: 'PARENTAL_LEAVE',
				settings_id: 'ph',
				subtotal_id: 'base',
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
				: { leave_catalog_entry: [{ id: 'entry', catalog_id: 'leave', days: halfDays }] },
		work: { days: absent.map((date) => ({ date, day_type: 'ABS' })) },
		projected_days: sixDayMarch
	};
	return input;
};
const phHalf = (
	halfDays: readonly { readonly date: string; readonly part: string }[],
	absent: readonly string[] = []
) => calculatePayroll(phInput(halfDays, absent)).subtotals[0]?.value ?? 0;

describe('proration basis', () => {
	it('takes a day of the wage period on calendar days', () => {
		assert.equal(salary(calendar, ['2026-03-04']), 3000);
	});

	it('takes one of the person’s own days on working days', () => {
		assert.closeTo(salary(working, ['2026-03-04']), 3100 * (21 / 22), 0.01);
	});

	it('takes the statute’s day rate on a day-rate basis', () => {
		assert.equal(phHalf([]), 7825);
		assert.equal(phHalf([], ['2026-03-04']), 7225);
		assert.equal(phHalf([{ date: '2026-03-04', part: 'AM' }]), 7525);
	});

	it('shows a statutory row the priced leave slots', () => {
		const result = calculatePayroll(
			phInput(
				[
					{ date: '2026-03-04', part: 'AM' },
					{ date: '2026-03-04', part: 'PM' }
				],
				[],
				[
					{
						id: 'scheme',
						code: 'TEST',
						settings_id: 'ph',
						subtotal_id: 'base',
						employee_amount:
							"return (ctx.leave ?? []).filter((slot) => slot.code === 'PARENTAL_LEAVE').length / 2;",
						employer_amount: 'return 0;'
					}
				]
			)
		);
		assert.equal(result.statutory[0]?.employee, 1);
	});

	it('deducts only the days absent, not the weekend between them', () => {
		assert.equal(salary(calendar, ['2026-03-06', '2026-03-09']), 2900);
	});

	it('pays the rest days when every work day is missed', () => {
		assert.equal(salary(calendar, workDays), 900);
		assert.equal(salary(working, workDays), 0);
	});
});
