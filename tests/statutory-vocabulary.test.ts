// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	statutoryNaming,
	statutoryOutputIds
} from '../src/collections/payroll_runs/lib/vocabulary.ts';

/**
 * Every statutory scheme the shipped seed bank charges, by jurisdiction. A scheme a run charges
 * without a workbook column refuses the whole export — SKBBK did, the day the June 2026 Malaysian
 * version began charging it — so this list is the gate that catches a renamed or added scheme
 * before a payroll clerk meets a 422.
 */
const SEEDED_CODES = [
	// Malaysia
	'EPF',
	'EPF_NON_CITIZEN',
	'SOCSO',
	'EIS',
	'PCB',
	'HRDF',
	'ZAKAT',
	'SKBBK',
	// Philippines
	'SSS',
	'SSS_EC',
	'PHIC',
	'HDMF',
	'WTAX',
	// Singapore
	'CPF',
	'SDL',
	// Vietnam
	'SI',
	'HI',
	'UI',
	'UNION_FEE',
	'PIT',
	// Taiwan
	'LI',
	'NHI',
	'LABOR_PENSION',
	'INCOME_TAX',
	// Indonesia
	'JHT',
	'JP',
	'JKK',
	'JKM',
	'JKP',
	'KESEHATAN',
	'PPH21'
] as const;

test('every seeded statutory scheme names at least one workbook column', () => {
	for (const code of SEEDED_CODES) {
		const naming = statutoryNaming(code);
		const columns = [naming.employee, naming.employer, naming.total, naming.base].filter(
			(column) => column != null
		);
		assert.ok(columns.length > 0, `${code} names no column`);
	}
});

test('a scheme with no vocabulary entry refuses instead of exporting a zero', () => {
	assert.throws(() => statutoryNaming('NOT_A_SCHEME'), /has no workbook column/);
});

test('the statutory column list has no duplicate ids', () => {
	const ids = statutoryOutputIds(['employee', 'employer', 'total', 'base']);
	assert.equal(new Set(ids).size, ids.length);
});
