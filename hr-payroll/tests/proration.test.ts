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
		employment: { id: 'contract', terms: { rate: { amount: 3100, unit: 'MONTHLY' }, normal_hours_per_day: 8, normal_hours_per_week: 40, normal_days_per_week: 5 } },
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

describe('proration basis', () => {
	it('takes a day of the wage period on calendar days', () => {
		assert.equal(salary(calendar, ['2026-03-04']), 3000);
	});

	it('takes one of the person’s own days on working days', () => {
		assert.closeTo(salary(working, ['2026-03-04']), 3100 * (21 / 22), 0.01);
	});

	it('counts the weekend inside a stretch of missed days', () => {
		assert.equal(salary(calendar, ['2026-03-06', '2026-03-09']), 2700);
	});

	it('pays nothing for a month with no paid work day', () => {
		assert.equal(salary(calendar, workDays), 0);
		assert.equal(salary(working, workDays), 0);
	});
});
