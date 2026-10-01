import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatutory } from './fixtures/statutory-world.ts';
import { computePayslip, type Scenario } from './e2e/oracle/SG.ts';

/** EA s38(4), Fourth Schedule formula; source has no monetary aggregation unit.
 * Owner-delegated rule2026-10-02: exact hourly rate, each dated band amount half-up
 * to cents, then sum settlements. Independent oracle imports no engine or seed.
 * https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days
 */
test('Singapore dated overtime rounding — eighteen four-hour payments sum1019.52 with unrounded Fourth Schedule rate', () => {
	const dates = [1, 2, 5, 6, 7, 8, 9, 12, 13, 14, 15, 16, 19, 20, 21, 22, 23, 26].map(
		(day) => `2026-10-${String(day).padStart(2, '0')}`
	);
	const scenario: Scenario = {
		id: 'SG-DATED-ROUNDING',
		profile: 'SG',
		rows: ['SG-EA46-R01'],
		branches: ['18 dated four-hour payments'],
		description: 'Independent monetary settlement-unit golden',
		period: '2026-10',
		holidays: [],
		employee: { birth_date: '1990-01-01', residency: 'CITIZEN', race: 'OTHER', religion: 'OTHER' },
		employment: {
			start: '2024-01-01',
			monthly_basic: 1800,
			workman: false,
			managerial: false,
			daily_hours: 8
		},
		month: { overtime: dates.map((date) => ({ date, hours: 4 })) }
	};
	assert.equal(computePayslip(scenario).components.overtime, 1019.52);
	assert.equal(computePayslip(scenario).gross, 2819.52);
	const slip = buildStatutory(
		{
			code: 'SG',
			period: '2026-10',
			people: [{ key: 'DATED', wage: 1800, citizenship: 'CITIZEN' }]
		},
		(world) => {
			world.companies[0]!.pay_cutoff_day = 1;
			for (const date of dates)
				world.work_days.push({
					id: `dated-${date}`,
					employment_id: world.employments[0]!.id,
					work_date: date,
					shift_definition_id: null,
					worked_intervals: [
						{ start: `${date}T09:00:00+08:00`, end: `${date}T13:00:00+08:00` },
						{ start: `${date}T14:00:00+08:00`, end: `${date}T22:00:00+08:00` }
					],
					approved_overtime_hours: 4,
					approval_id: null
				} as never);
		}
	).slips.get('DATED')!;
	const overtime = slip.adjustments.filter((row) => row.label === 'OT-1.5X');
	assert.equal(overtime.length, 18);
	assert.ok(overtime.every((row) => row.amount === 56.64));
	assert.equal(slip.gross, 2819.52);
});
