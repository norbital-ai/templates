// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { statutoryColumn } from '../src/collections/payroll_runs/lib/report.ts';

test('a statutory column is named from its scheme code, so a tenant-authored scheme exports too', () => {
	assert.equal(statutoryColumn('EPF', 'employee'), 'epfEmployee');
	assert.equal(statutoryColumn('EPF_NON_CITIZEN', 'employer'), 'epfNonCitizenEmployer');
	assert.equal(statutoryColumn('CPF', 'total'), 'totalCpf');
	assert.equal(statutoryColumn('PCB', 'base'), 'pcbGross');
	assert.equal(statutoryColumn('MY-LEVY', 'employee'), 'myLevyEmployee');
});
