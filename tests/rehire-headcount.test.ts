import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { createPublicPayrollWorld, COMPANY_ID } from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';

test('two contract stints for one employee in the same entity count as one person', async () => {
	const world = createPublicPayrollWorld();
	const first = world.employments[0]!;
	first.exit_date = '2026-01-10';
	first.exit_reason = 'RESIGNATION';
	world.employments.push({
		...structuredClone(first),
		id: 'return-contract',
		employee_number: 'RETURN',
		hire_date: '2026-01-15',
		effective_range: { start: '2026-01-15', end: null },
		exit_date: null,
		exit_reason: null
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
		company_id: 'other-company',
		exit_date: null,
		exit_reason: null
	});
	const prepared = await Effect.runPromise(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-01' })
	);
	assert.equal(prepared.gathered.bundles.length, 2);
	assert.equal(prepared.gathered.headcount, 1);
	assert.ok(
		prepared.gathered.bundles.every((bundle) => bundle.employment.company_id === COMPANY_ID)
	);
});
