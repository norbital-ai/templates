import assert from 'node:assert/strict';
import test from 'node:test';
import { gatherPayrollRun } from '../src/lib/payroll/run/engine.ts';
import { createPublicPayrollWorld, COMPANY_ID } from './fixtures/public-payroll-world.ts';
import { payrollWorld } from './fixtures/memory-payroll-api.ts';

test('two contract stints for one employee in the same entity count as one person', async () => {
	const world = createPublicPayrollWorld();
	const first = world.employments[0]!;
	first.effective_range = { start: '2021-06-01', end: '2026-01-10' };
	world.employments.push({
		...structuredClone(first),
		id: 'return-contract',
		employee_number: 'RETURN',
		effective_range: { start: '2026-01-15', end: null }
	});
	world.employment_terms.push({
		...structuredClone(world.employment_terms[0]),
		id: 'return-terms',
		employment_id: 'return-contract',
		effective_range: { start: '2026-01-15', end: null }
	});
	world.employments.push({
		...structuredClone(first),
		id: 'other-entity-contract',
		company_id: 'other-company'
	});
	const prepared = gatherPayrollRun({
		world: payrollWorld(world),
		companyId: COMPANY_ID,
		period: '2026-01'
	});
	assert.equal(prepared.gathered.bundles.length, 2);
	assert.equal(prepared.gathered.headcount, 1);
	assert.ok(
		prepared.gathered.bundles.every((bundle) => bundle.employment.company_id === COMPANY_ID)
	);
});
