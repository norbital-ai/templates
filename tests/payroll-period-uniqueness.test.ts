import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPayrollPeriodAvailable } from '../src/collections/payroll_runs/lib/period.ts';
import payrollRuns from '../src/collections/payroll_runs/+collection.ts';

test('a company cannot create a second payroll for a draft or paid period', () => {
	for (const lifecycle of ['DRAFT', 'PAID'])
		assert.throws(
			() => assertPayrollPeriodAvailable([{ period: '2026-01', lifecycle }], '2026-01'),
			/already exists/
		);
});

test('the next regular period may stand on an unsettled one, and cannot backfill an older run', () => {
	// A standing draft used to refuse the next period outright, so one person's correction froze
	// the whole company's next payroll. Runs may now stand in order unpaid; what stays ordered is
	// payment and deletion.
	assert.doesNotThrow(() =>
		assertPayrollPeriodAvailable([{ period: '2026-01', lifecycle: 'DRAFT' }], '2026-02')
	);
	assert.throws(
		() => assertPayrollPeriodAvailable([{ period: '2026-02' }], '2026-01'),
		/next payroll period/
	);
	assert.doesNotThrow(() => assertPayrollPeriodAvailable([{ period: '2026-01' }], '2026-02'));
	assert.doesNotThrow(() => assertPayrollPeriodAvailable([{ period: '2026-01-1' }], '2026-01-2'));
});

test('a skipped period is refused: the run must stand on the one before it', () => {
	// The first run of a company may start anywhere; after that the lineage has no holes.
	assert.doesNotThrow(() => assertPayrollPeriodAvailable([], '2026-04'));
	assert.throws(
		() => assertPayrollPeriodAvailable([{ period: '2026-01' }, { period: '2026-02' }], '2026-04'),
		/2026-03 was never run/
	);
	assert.throws(
		() => assertPayrollPeriodAvailable([{ period: '2026-01-2' }], '2026-02-2'),
		/2026-02-1 was never run/
	);
	assert.doesNotThrow(() => assertPayrollPeriodAvailable([{ period: '2025-12-2' }], '2026-01-1'));
	assert.doesNotThrow(() => assertPayrollPeriodAvailable([{ period: '2025-12' }], '2026-01'));
});

test('payroll creation accepts company and period and nothing else', () => {
	// The declared input is the whole of what a caller may submit; every other column is derived.
	assert.deepEqual(Object.keys(payrollRuns.create.input.columns), ['company_id', 'period']);
	assert.equal(payrollRuns.create.input.with, undefined);
});
