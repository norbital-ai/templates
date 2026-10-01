import assert from 'node:assert/strict';
import test from 'node:test';
import { Decimal } from '@norbital-ai/std/decimal';
import { employmentCheckIssues } from '../src/lib/checks.ts';
import { caller } from './helpers/bodies.ts';
import { createPublicPayrollWorld } from './fixtures/public-payroll-world.ts';

test('terms-change checks normalize persisted candidate decimals and retain the weekly-hours guard', async () => {
	const world = createPublicPayrollWorld();
	world.jurisdiction_settings[0]!.checks = [
		{
			code: 'NORMAL_WEEK_OVER_48_HOURS',
			at: 'TERMS_CHANGE',
			when: 'after.ordinary_hours_per_week > 48.0',
			severity: 'REFUSE',
			message: 'Normal weekly hours exceed 48.'
		}
	];
	const employment = world.employments[0]!;
	const candidate = world.employment_terms[0]!;
	const judge = (hours: string) =>
		employmentCheckIssues(caller({ tables: world }), {
			at: 'TERMS_CHANGE',
			employment,
			terms: [{ ...candidate, ordinary_hours_per_week: Decimal.of(hours) }],
			date: '2026-01-01'
		});
	assert.deepEqual(await judge('40'), []);
	const issues = await judge('49');
	assert.equal(issues.length, 1);
	assert.equal(issues[0]!.code, 'NORMAL_WEEK_OVER_48_HOURS');
	assert.match(issues[0]!.message, /Normal weekly hours exceed 48/);
	assert.doesNotMatch(issues[0]!.message, /could not be evaluated/);
});
