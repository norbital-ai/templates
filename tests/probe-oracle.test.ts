/**
 * Self-test of the payroll probe's oracles beyond the payslip (capability plan H1): a saved duty instance and a
 * generated file judged against the cited result, without a host.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileDifferences, fileRefs, savedDifferences } from './e2e/probe-oracle.ts';

const instance = {
	id: 'i1',
	duty_code: 'REMIT',
	due_on: '2026-02-15',
	amount_due: 1234.5,
	subject: { kind: 'RUN', id: 'r1' }
};

test('a saved row matches on the fields the case lists, numbers to the cent', () => {
	assert.deepEqual(
		savedDifferences(
			[{ duty_code: 'REMIT', due_on: '2026-02-15', amount_due: 1234.504 }],
			[instance]
		),
		[]
	);
	assert.deepEqual(
		savedDifferences([{ 'subject.kind': 'RUN', fulfilled_on: null }], [instance]),
		[]
	);
});

test('a wrong figure, a missing row and an extra row each fail', () => {
	assert.equal(savedDifferences([{ amount_due: 1234.51 }], [instance]).length, 2);
	assert.deepEqual(savedDifferences([{ due_on: '2026-02-15' }], []), [
		'no saved row matches {"due_on":"2026-02-15"}'
	]);
	assert.deepEqual(
		savedDifferences(
			[{ due_on: '2026-02-15' }],
			[instance, { ...instance, id: 'i2', due_on: '2026-03-15' }]
		),
		['unexpected saved row {"due_on":"2026-03-15"}']
	);
	// `rows: []` pins that nothing was saved
	assert.equal(savedDifferences([], [instance]).length, 1);
});

test('file references are found anywhere in a run result', () => {
	const ref = (id: string, name: string) => ({ id, name, mime: 'text/csv', size: 1 });
	assert.deepEqual(
		fileRefs({
			artefacts: [
				{ label: 'bank', files: [ref('f1', 'bank.csv')] },
				{ files: [ref('f2', 'r.txt')] }
			]
		}),
		[
			{ id: 'f1', name: 'bank.csv' },
			{ id: 'f2', name: 'r.txt' }
		]
	);
	assert.deepEqual(fileRefs(null), []);
});

test('a generated file must match its bytes exactly', () => {
	const bytes = new TextEncoder().encode('﻿H,1\r\nD,100.00\r\n');
	assert.deepEqual(fileDifferences({ text: '﻿H,1\r\nD,100.00\r\n' }, bytes), []);
	// the byte-order mark is part of the file
	assert.equal(fileDifferences({ text: 'H,1\r\nD,100.00\r\n' }, bytes).length, 1);
	assert.match(fileDifferences({ text: '﻿H,1\r\nD,100.01\r\n' }, bytes)[0]!, /character 13/);
	// sha256 of "abc", FIPS 180-2 appendix B.1
	const abc = new TextEncoder().encode('abc');
	const digest = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
	assert.deepEqual(fileDifferences({ sha256: digest }, abc), []);
	assert.equal(fileDifferences({ sha256: digest }, bytes).length, 1);
	assert.deepEqual(fileDifferences({}, abc), ['the case pins neither text nor sha256']);
});
