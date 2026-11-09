// PAYEE is a Bukan Pegawai: tax withholding continues, but the employee registration and separation duties do not.
// Personal-data disposal still applies because the person remains a data subject.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';

type Effect = { readonly code: string; readonly condition?: string; readonly lookup?: Record<string, unknown> };
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
const DUTIES = [
	'BPJS_KETENAGAKERJAAN_REGISTRATION',
	'BPJS_KESEHATAN_REGISTRATION',
	'PTKP_STATUS_AT_HIRE',
	'PKWT_REGISTRATION',
	'PPH21_BPA1_EXIT',
	'JKP_PHK_NOTIFICATION',
	'TERMINATION_REPORT',
	'PKWT_TERM_END_COMPENSATION',
	'WAGE_SCALE_NOTICE_AT_HIRE',
	'BPJS_KETENAGAKERJAAN_WAGE_CHANGE',
	'BPJS_KETENAGAKERJAAN_EXIT_REPORT',
	'BPJS_KETENAGAKERJAAN_FAMILY_DATA_CHANGE',
	'PRE_EMPLOYMENT_HEALTH_EXAMINATION'
] as const;
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
const holds = (code: string, entry: object) =>
	evaluate(
		effectOf(code).condition!,
		'CALCULATION',
		{ lookup: effectOf(code).lookup ?? {}, entry, reads: { obligation: [], employee_contract: [] } },
		code
	);

describe('ID PAYEE statutory duties', () => {
	it('no employee registration, PKWT, exit or health duty reaches a payee', () => {
		for (const code of DUTIES) assert.equal(holds(code, payee), false, code);
	});
	it('personal-data disposal still reaches the payee', () => {
		assert.equal(holds('PERSONAL_DATA_DISPOSAL', payee), true);
	});
});
