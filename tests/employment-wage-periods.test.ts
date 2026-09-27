// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/** Wage evidence: complete, in the jurisdiction's currency and precision, and frozen once a payslip used it. */
import assert from 'node:assert/strict';
import test from 'node:test';
import wagePeriods from '../src/data/collection/employment_wage_periods/+collection.ts';
import { transform } from './helpers/bodies.ts';

const tables = {
	employments: [{ id: 'contract', company_id: 'entity' }],
	companies: [{ id: 'entity', settings_code: 'MY', employments: [{ id: 'contract' }] }],
	jurisdiction_settings: [
		{
			id: 'v1',
			code: 'MY',
			sealed_at: '2026-01-01T00:00:00.000Z',
			voided_at: null,
			approval_id: null,
			payroll: { currency: 'MYR' },
			effective_range: { from: '2025-01-01', to: null }
		}
	]
};
const period = (over = {}) => ({
	employment_id: 'contract',
	period: { from: '2026-01-01', to: '2026-01-31' },
	currency: 'MYR',
	normal_wages: '3000.00',
	due_on: '2026-01-31',
	reference: 'Payroll Jan',
	...over
});

test('a wage period is complete, in the jurisdiction currency and precision', async () => {
	await transform(wagePeriods, [period()], { tables });
	for (const [over, refusal] of [
		[{ currency: 'SGD' }, /currency must match/],
		[{ normal_wages: '3000.005' }, /currency precision/],
		[{ normal_wages: null }, /normal wages or ordinary earnings/],
		[{ ordinary_wages: '100.00' }, /supplied together/],
		[{ ordinary_wages: '100.00', ordinary_days: '32' }, /cannot exceed/],
		[{ reference: ' ' }, /source reference/],
		[{ period: { from: '2026-01-01', to: null } }, /finite inclusive period/]
	])
		await assert.rejects(transform(wagePeriods, [period(over)], { tables }), refusal);
});

test('a wage period a payslip used is immutable', async () => {
	const stored = { id: 'w1', ...period() };
	await assert.rejects(
		transform(wagePeriods, [{ reference: 'Fixed' }], {
			existing: [stored],
			tables: { ...tables, payslip_wage_periods: [{ wage_period_id: 'w1' }] }
		}),
		/used by a payslip is immutable/
	);
});
