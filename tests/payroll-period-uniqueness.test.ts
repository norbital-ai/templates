import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from 'effect';
import { assertPayrollPeriodAvailable } from '../src/collections/payroll_runs/lib/period.ts';
import hooks from '../src/collections/payroll_runs/+hooks.ts';

test('a company cannot create a second payroll for a draft or paid period', () => {
	for (const lifecycle of ['DRAFT', 'PAID'])
		assert.throws(
			() => assertPayrollPeriodAvailable([{ period: '2026-01', lifecycle }], '2026-01'),
			/already exists/
		);
});

test('the next regular period requires prior settlement and cannot backfill an older run', () => {
	assert.throws(
		() => assertPayrollPeriodAvailable([{ period: '2026-01', lifecycle: 'DRAFT' }], '2026-02'),
		/still a draft/
	);
	assert.throws(
		() => assertPayrollPeriodAvailable([{ period: '2026-02', lifecycle: 'PAID' }], '2026-01'),
		/next payroll period/
	);
	assert.doesNotThrow(() =>
		assertPayrollPeriodAvailable([{ period: '2026-01', lifecycle: 'PAID' }], '2026-02')
	);
	assert.doesNotThrow(() =>
		assertPayrollPeriodAvailable([{ period: '2026-01-1', lifecycle: 'PAID' }], '2026-01-2')
	);
});

test('payroll creation accepts company and period without a run type', () => {
	const input = { company_id: '00000000-0000-4000-8000-000000000001', period: '2026-01' };
	const decode = Schema.decodeUnknownSync(hooks.input);
	assert.deepEqual(decode(input, { onExcessProperty: 'error' }), input);
	assert.throws(() => decode({ ...input, run_kind: 'AD_HOC' }, { onExcessProperty: 'error' }));
});
