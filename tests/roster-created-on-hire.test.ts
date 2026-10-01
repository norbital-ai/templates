/**
 * A company that creates its roster on its first hire's day: the window's days before the hire have no terms and no
 * roster code in force, and are only projected for measurement — the run prices the joiner rather than crashing.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPayrollRun, gatherPayrollRun } from '../src/lib/payroll/run/engine.ts';
import { createPublicPayrollWorld, COMPANY_ID } from './fixtures/public-payroll-world.ts';
import { payrollWorld } from './fixtures/memory-payroll-api.ts';

test('a roster whose codes start on the hire day prices the joiner’s first month', async () => {
	const world = createPublicPayrollWorld();
	const hire = '2026-01-05';
	world.employments[0]!.effective_range = { start: hire, end: null };
	for (const row of [
		...world.employment_terms,
		...world.shift_definitions,
		...world.shift_patterns
	])
		row.effective_range = { start: hire, end: null };
	// A five-day week from the pattern, no roster rows: the pattern projects every day.
	const [work] = world.shift_definitions;
	world.shift_definitions.push({ ...work!, id: 'rest', code: 'REST', variant: { kind: 'REST' } });
	world.shift_patterns[0]!.pattern = {
		days: [
			...Array.from({ length: 5 }, () => ({ roster_code_id: work!.id })),
			{ roster_code_id: 'rest' },
			{ roster_code_id: 'rest' }
		]
	};
	world.work_days = [];
	const built = buildPayrollRun(
		await gatherPayrollRun({ world: payrollWorld(world), companyId: COMPANY_ID, period: '2026-01' })
	);
	// CALENDAR_DAYS proration: 3,451 × 27 ÷ 31 = 3,005.71.
	assert.deepEqual(
		built.payslip_payroll_run.map(
			(slip) => slip.base.find((line) => line.component_code === 'BASIC')?.amount
		),
		[3005.71]
	);
});
