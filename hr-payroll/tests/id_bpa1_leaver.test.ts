// A December leaver gets one employee BPA1 and the entity's annual BPA1 batch still covers everyone still employed at
// year end. The batch is not suppressed by the exit task; its title says so.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';

type Effect = { readonly code: string; readonly effects: string; readonly lookup?: Record<string, unknown> };
const effects = JSON.parse(
	readFileSync(
		new URL('../seed/public/jurisdiction/ID/version_3/registered_effect.json', import.meta.url),
		'utf8'
	)
) as readonly Effect[];
const effectOf = (code: string) => {
	const row = effects.find((item) => item.code === code);
	assert.ok(row !== undefined);
	return row;
};
type Task = { readonly title: string; readonly occurrence_key: string; readonly employee_id?: string };
const run = (code: string, entry: object, obligation: readonly object[]) =>
	evaluate(
		effectOf(code).effects,
		'CALCULATION',
		{ lookup: effectOf(code).lookup ?? {}, entry, reads: { obligation } },
		code
	) as readonly Task[];

const batch = {
	entity_id: 'entity-1',
	salary_coverage: { from: '2026-12-21', to: '2026-12-31' }
};
const leaver = {
	id: 'contract-1',
	entity_id: 'entity-1',
	employee_id: 'employee-1',
	engagement: 'EMPLOYEE',
	status: 'SEALED',
	effective_range: { from: '2024-01-01', to: '2026-12-20' },
	employee_extension_data: { termination_cause: 'RESIGNATION' }
};

describe('ID BPA1 for a December leaver', () => {
	it('keeps the entity batch and adds the employee exit task', () => {
		const yearEnd = run('PPH21_BPA1_YEAR_END', batch, []);
		const exit = run('PPH21_BPA1_EXIT', leaver, yearEnd);
		assert.equal(yearEnd.length, 1);
		assert.equal(exit.length, 1);
		assert.match(String(yearEnd[0]?.title), /BPA1 batch/);
		assert.match(String(exit[0]?.title), /for a leaver/);
		assert.notEqual(yearEnd[0]?.occurrence_key, exit[0]?.occurrence_key);
		assert.equal(exit[0]?.employee_id, 'employee-1');
	});
	it('an exit task does not suppress the batch for the remaining employees', () => {
		const exit = run('PPH21_BPA1_EXIT', leaver, []);
		const yearEnd = run('PPH21_BPA1_YEAR_END', batch, exit);
		assert.equal(yearEnd.length, 1);
	});
});
