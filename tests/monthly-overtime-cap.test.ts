// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Regulated overtime beyond the month's ceiling is incentive, not a refusal and not silently
 * overtime: Nihon's rule for the 104-hour cap. The cap counts the month's earlier paid runs.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { funnelMonthlyOvertime } from '../src/lib/payroll/work.ts';

const overtime = {
	family: 'WORK',
	output: 'OVERTIME:OT-1.5X',
	destination: 'EARNINGS',
	direction: 'CREDIT',
	code: 'OT'
};
const incentive = {
	family: 'WORK',
	output: 'INCENTIVE:OT-1.5X',
	destination: 'EARNINGS',
	direction: 'CREDIT',
	code: 'PINCEN'
};
const limits = [
	{
		key: 'monthly_ot',
		period: 'MONTH',
		measure: 'OVERTIME_HOURS',
		max_hours: 10,
		unit: 'WORKED_HOURS'
	}
];
const row = (id, hours, amount) => ({
	input: { family: 'WORK_DAY', id },
	catalogueComponent: overtime,
	bucket: 'EARNINGS',
	label: 'OT-1.5X',
	amount,
	quantity: hours,
	rate: 10,
	statutoryRuleKey: 'OVERTIME:OT-1.5X'
});
const days = [
	{ workDayId: 'd1', date: '2026-03-02' },
	{ workDayId: 'd2', date: '2026-03-03' },
	{ workDayId: 'd3', date: '2026-04-01' }
];

test('hours past the monthly ceiling move to incentive at the band’s own rate, split at the boundary', () => {
	const out = funnelMonthlyOvertime({
		rows: [row('d2', 6, 90), row('d1', 6, 90), row('d3', 3, 45)],
		days,
		limits,
		prior: new Map(),
		catalogueComponents: [overtime, incentive]
	});
	const march = out.rows.filter(
		(r) => days.find((d) => d.workDayId === r.input.id).date < '2026-04'
	);
	assert.deepEqual(
		march.map((r) => [r.input.id, r.catalogueComponent.output, r.quantity, r.amount]),
		[
			['d1', 'OVERTIME:OT-1.5X', 6, 90],
			['d2', 'OVERTIME:OT-1.5X', 4, 60],
			['d2', 'INCENTIVE:OT-1.5X', 2, 30]
		]
	);
	assert.deepEqual(
		out.rows.filter((r) => r.input.id === 'd3').map((r) => r.catalogueComponent.output),
		['OVERTIME:OT-1.5X']
	);
	assert.deepEqual([...out.funnelledHours], [['2026-03', 2]]);
});

test('the month’s earlier paid runs count toward the ceiling first', () => {
	const out = funnelMonthlyOvertime({
		rows: [row('d1', 4, 60)],
		days,
		limits,
		prior: new Map([['2026-03', 9]]),
		catalogueComponents: [overtime, incentive]
	});
	assert.deepEqual(
		out.rows.map((r) => [r.catalogueComponent.output, r.quantity, r.amount]),
		[
			['OVERTIME:OT-1.5X', 1, 15],
			['INCENTIVE:OT-1.5X', 3, 45]
		]
	);
});

test('a jurisdiction with no monthly ceiling funnels nothing', () => {
	const out = funnelMonthlyOvertime({
		rows: [row('d1', 40, 600)],
		days,
		limits: [],
		prior: new Map(),
		catalogueComponents: [overtime]
	});
	assert.equal(out.rows.length, 1);
	assert.equal(out.funnelledHours.size, 0);
});
