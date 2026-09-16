// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { statutoryColumn } from '../src/collections/payroll_runs/lib/report.ts';

test('a statutory column is named from its scheme code, so a tenant-authored scheme exports too', () => {
	assert.equal(statutoryColumn('EPF', 'employee'), 'epfEmployee');
	// The three Third Schedule Parts are one fund on the sheet: a person matches exactly one.
	assert.equal(statutoryColumn('EPF_NON_CITIZEN', 'employer'), 'epfEmployer');
	assert.equal(statutoryColumn('EPF_PR', 'employee'), 'epfEmployee');
	assert.equal(statutoryColumn('CPF', 'total'), 'totalCpf');
	assert.equal(statutoryColumn('PCB', 'base'), 'pcbGross');
	assert.equal(statutoryColumn('MY-LEVY', 'employee'), 'myLevyEmployee');
});
