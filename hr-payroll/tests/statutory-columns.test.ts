// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { statutoryColumn } from '../src/collections/payroll_runs/lib/report.ts';

test('a statutory column is named from the charge’s listing, so a tenant-authored scheme exports too', () => {
	assert.equal(statutoryColumn({ scheme_code: 'EPF' }, 'employee'), 'epfEmployee');
	// The three Third Schedule Parts fold into one EPF column where the row says so
	// (`listing_group`): a person matches exactly one.
	assert.equal(
		statutoryColumn({ scheme_code: 'EPF_NON_CITIZEN', listing_group: 'EPF' }, 'employer'),
		'epfEmployer'
	);
	assert.equal(
		statutoryColumn({ scheme_code: 'EPF_PR', listing_group: 'EPF' }, 'employee'),
		'epfEmployee'
	);
	// A row with no group and no short name is its own column, by code.
	assert.equal(statutoryColumn({ scheme_code: 'EPF_PR' }, 'employee'), 'epfPrEmployee');
	assert.equal(statutoryColumn({ scheme_code: 'CPF' }, 'total'), 'totalCpf');
	assert.equal(statutoryColumn({ scheme_code: 'PCB' }, 'base'), 'pcbGross');
	assert.equal(statutoryColumn({ scheme_code: 'MY-LEVY' }, 'employee'), 'myLevyEmployee');
	// A short name names the column where it is stated: HDMF prints and exports as Pag-IBIG.
	assert.equal(
		statutoryColumn({ scheme_code: 'HDMF', label: 'Pag-IBIG' }, 'employee'),
		'pagIbigEmployee'
	);
});
