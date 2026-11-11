// A payee's exit duties are keyed by employment and exit date. Waiving them when the exit moves is the dependants
// routine's, proved on a real workspace in contract_exit.test.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';

type Effect = {
	readonly code: string;
	readonly condition?: string;
	readonly effects?: string;
	readonly lookup?: Record<string, unknown>;
};
const effects = JSON.parse(
	readFileSync(
		new URL('../seed/public/jurisdiction/ID/version_3/registered_effect.json', import.meta.url),
		'utf8'
	)
) as readonly Effect[];
const effectOf = (code: string) => {
	const row = effects.find((item) => item.code === code);
	assert.ok(row?.condition !== undefined);
	return row;
};
const payee = {
	id: 'contract-1',
	entity_id: 'entity-1',
	employee_id: 'employee-1',
	engagement: 'PAYEE',
	status: 'SEALED',
	effective_range: { from: '2026-01-01', to: '2026-06-30' },
	terms: { residency_status: 'CITIZEN', statutory_work_category: 'NON_MANUAL' },
	employee_extension_data: {
		termination_cause: 'RESIGNATION',
		pre_employment_exam_on: '2025-12-01'
	}
};

describe('ID exit duties', () => {
	const run = (code: string, after: object | null, obligation: readonly object[]) =>
		evaluate(
			effectOf(code).effects!,
			'CALCULATION',
			{ lookup: effectOf(code).lookup ?? {}, entry: payee, after, reads: { obligation } },
			code
		) as readonly { readonly target?: string; readonly occurrence_key?: string }[];
	it('are keyed by employment and exit date', () => {
		assert.equal(
			run('PERSONAL_DATA_DISPOSAL', payee, [])[0]?.occurrence_key,
			'PERSONAL_DATA_DISPOSAL:contract-1:exit:2026-06-30'
		);
	});
});
