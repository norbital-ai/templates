// PAYEE is a Bukan Pegawai: tax withholding continues, but the employee registration and separation duties do not.
// Personal-data disposal still applies because the person remains a data subject. A moved or cancelled exit waives the
// open duties of the exit it replaced.
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
		{
			lookup: effectOf(code).lookup ?? {},
			entry,
			after: entry,
			reads: { obligation: [], employee_contract: [] }
		},
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

describe('ID exit duties', () => {
	const run = (code: string, after: object | null, obligation: readonly object[]) =>
		evaluate(
			effectOf(code).effects!,
			'CALCULATION',
			{ lookup: effectOf(code).lookup ?? {}, entry: payee, after, reads: { obligation } },
			code
		) as readonly { readonly target?: string; readonly occurrence_key?: string }[];
	const task = (code: string, to: string, state = 'OPEN') => ({
		id: `${code}@${to}`,
		occurrence_key: `${code}:contract-1:exit:${to}`,
		state
	});
	const held = [
		task('PERSONAL_DATA_DISPOSAL', '2026-05-31'),
		task('TERMINATION_REPORT', '2026-05-31', 'DONE'),
		task('PERSONAL_DATA_DISPOSAL', '2026-06-30'),
		{ id: 'hire', occurrence_key: 'PTKP_STATUS_AT_HIRE:contract-1', state: 'OPEN' }
	];
	it('are keyed by employment and exit date', () => {
		assert.equal(
			run('PERSONAL_DATA_DISPOSAL', payee, [])[0]?.occurrence_key,
			'PERSONAL_DATA_DISPOSAL:contract-1:exit:2026-06-30'
		);
	});
	it('a moved exit waives the open duties of the earlier date', () => {
		assert.equal(holds('retract-exit-effects', payee), false);
		assert.deepEqual(
			run('retract-exit-effects', payee, held).map((change) => change.target),
			['PERSONAL_DATA_DISPOSAL@2026-05-31']
		);
	});
	it('a cancelled exit waives every open exit duty', () => {
		assert.deepEqual(
			run('retract-exit-effects', null, held).map((change) => change.target),
			['PERSONAL_DATA_DISPOSAL@2026-05-31', 'PERSONAL_DATA_DISPOSAL@2026-06-30']
		);
	});
});
