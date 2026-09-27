// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A statutory scheme is written only into a draft version, and only when every expression it holds compiles
 * against what it declares: its rules, formula and rebates read declared elections of the declared type, its
 * `code(...)` mentions name rows of its own version, and its `produced.<code>` mentions close no loop. A scheme
 * another scheme still reads stays.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import schemes from '../src/data/collection/statutory_contributions/+collection.ts';
import { runDelete, runTransform } from './helpers/ctx.ts';

const scheme = {
	id: 'pcb',
	settings_id: 'draft',
	code: 'PCB',
	elections: [{ key: 'disabled', type: 'boolean' }],
	assessed_on: 'BASE',
	rules: [{ when: 'scheme.elections.disabled', employee: '0.0', employer: '0.0' }]
};
const tables = (extra = {}) => ({
	jurisdiction_settings: [
		{ id: 'draft', code: 'PUB', name: 'Public fixture', sealed_at: null },
		{ id: 'sealed', code: 'PUB', name: 'Sealed fixture', sealed_at: '2026-01-01T00:00:00.000Z' }
	],
	statutory_contributions: [],
	...extra
});
const write = (rows, extra) =>
	runTransform(schemes, Array.isArray(rows) ? rows : [rows], { tables: tables(extra) });
const rule = (fields) => ({
	...scheme,
	rules: [{ when: 'true', employee: '0.0', employer: '0.0', ...fields }]
});

test('a scheme of a sealed version is refused; a new one takes empty lists where it names none', async () => {
	await assert.rejects(write({ ...scheme, settings_id: 'sealed' }), /which is sealed/);
	const [saved] = await write({ settings_id: 'draft', code: 'X', assessed_on: 'BASE' });
	assert.deepEqual([saved.elections, saved.rules, saved.parts], [[], [], []]);
});

test('rules, formula and rebate read only declared elections, as the declared type', async () => {
	await write(scheme);
	await write({
		...scheme,
		rules: [{ when: 'base > 0.0 && scheme.elections.disabled', employee: '0.0', employer: '0.0' }]
	});
	await assert.rejects(
		write(rule({ when: 'scheme.elections.zakat > 0.0' })),
		/Rule 1: .*reads scheme.elections.zakat, which the scheme does not declare/
	);
	await assert.rejects(
		write({ ...scheme, assessed_on: 'BASE + scheme.elections.extra' }),
		/Assessed-on: .*reads scheme.elections.extra/
	);
	await assert.rejects(
		write(rule({ employee: 'scheme.elections.disabled' })),
		/Rule 1 employee: .*must produce a money amount/
	);
	await write(rule({ rebate: 'scheme.elections.disabled ? 100.0 : 0.0' }));
	await assert.rejects(
		write(rule({ rebate: 'scheme.elections.disabled' })),
		/Rule 1 rebate: .*must produce a money amount/
	);
});

test('a computed deduction cannot select its own rule or depend on itself', async () => {
	await write(
		rule({ deduction: 'scheme.deductions.EDUCATION', employee: 'base - scheme.deduction' })
	);
	for (const [field, expression] of [
		['when', 'scheme.deduction > 0.0'],
		['deduction', 'scheme.deduction + 1.0']
	])
		await assert.rejects(write(rule({ [field]: expression })), /deduction.*evaluated after/);
	await assert.rejects(
		write(rule({ deduction: 'scheme.elections.disabled' })),
		/deduction: .*money amount/
	);
});

test('a batch may declare a scheme input and consume it in the same write', async () => {
	const nhi = {
		settings_id: 'draft',
		code: 'NHI',
		assessed_on: 'BASE',
		elections: [{ key: 'insured_amount', type: 'number' }],
		rules: []
	};
	const supplement = {
		settings_id: 'draft',
		code: 'SUPPLEMENT',
		assessed_on: 'person.facts.NHI.elections.insured_amount',
		rules: []
	};
	await write([nhi, supplement]);
	await assert.rejects(
		write([nhi, { ...supplement, assessed_on: 'person.facts.NHI.elections.typo' }]),
		/does not declare election typo/
	);
});

test('a code the version does not carry, and a produced loop, are refused at the write', async () => {
	await assert.rejects(
		write({ ...scheme, assessed_on: "BASE + code('NOPE')" }),
		/names NOPE, which is not a row of its settings version/
	);
	const a = {
		id: 'a',
		settings_id: 'draft',
		code: 'A',
		assessed_on: 'BASE',
		rules: [{ when: 'true', employee: 'produced.B.employee', employer: '0.0' }]
	};
	const b = {
		id: 'b',
		settings_id: 'draft',
		code: 'B',
		assessed_on: 'BASE',
		rules: [{ when: 'true', employee: 'produced.A.employee', employer: '0.0' }]
	};
	await assert.rejects(write(b, { statutory_contributions: [a] }), /dependency loop: A → B/);
});

test('a scheme another scheme of its version still reads stays', async () => {
	const producer = { id: 'p', settings_id: 'draft', code: 'EPF', rules: [] };
	const reader = {
		id: 'r',
		settings_id: 'draft',
		code: 'PCB',
		rules: [{ when: 'true', employee: 'produced.EPF.employee', employer: '0.0' }]
	};
	const stored = { statutory_contributions: [producer, reader] };
	await assert.rejects(
		runDelete(schemes, [producer], { tables: tables(stored) }),
		/PCB reads produced.EPF/
	);
	await runDelete(schemes, [producer, reader], { tables: tables(stored) });
});
