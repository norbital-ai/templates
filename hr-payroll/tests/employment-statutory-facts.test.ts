// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A statutory fact names a person, a scheme and optionally one of that person's employments; its elections are the
 * keys the scheme declares, of the declared types; its claims name what the scheme's formulas read. The title is
 * derived.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import facts from '../src/data/collection/employment_statutory_facts/+collection.ts';
import { transform } from './helpers/bodies.ts';

const tables = {
	statutory_contributions: [
		{
			id: 'cpf',
			code: 'CPF',
			assessed_on: 'ORDINARY.WAGES',
			ordinary_on: '',
			rules: [{ when: 'true', employee: 'scheme.child_claims.QCR', employer: '0' }],
			elections: [
				{ key: 'higher_rate', type: 'boolean' },
				{ key: 'employer_reference', type: 'string', scope: 'EMPLOYMENT' }
			]
		}
	],
	employments: [{ id: 'contract', employee_id: 'person' }]
};
const fact = (status, over = {}) => ({
	employee_id: 'person',
	statutory_contribution_id: 'cpf',
	status,
	effective_range: { from: '2026-01-01', to: null },
	...over
});
const registered = (extra = {}) => ({ kind: 'REGISTERED', reference_number: 'S123', ...extra });

test('elections are declared keys of declared types, employment-scoped ones on an employment', async () => {
	const [out] = await transform(facts, [fact(registered({ elections: { higher_rate: true } }))], {
		tables
	});
	assert.equal(out.summary, 'Registered · S123 · from 2026-01-01');
	for (const [elections, refusal] of [
		[{ typo: true }, /does not declare the election typo/],
		[{ higher_rate: 'yes' }, /as a boolean; this value is a string/],
		[{ employer_reference: 'X' }, /requires a named employment/]
	])
		await assert.rejects(transform(facts, [fact(registered({ elections }))], { tables }), refusal);
	await transform(
		facts,
		[fact(registered({ elections: { employer_reference: 'X' } }), { employment_id: 'contract' })],
		{
			tables
		}
	);
});

test('a fact binds only its person’s employment and never moves', async () => {
	await assert.rejects(
		transform(facts, [fact(registered(), { employee_id: 'other', employment_id: 'contract' })], {
			tables
		}),
		/must belong to this employee profile/
	);
	const stored = { id: 'f1', ...fact(registered()), employment_id: 'contract' };
	await assert.rejects(
		transform(facts, [{ employment_id: null }], { existing: [stored], tables }),
		/cannot move to another employment/
	);
});

test('child claims name a relief class the scheme reads, once per tax year', async () => {
	const claim = {
		year: '2026',
		relief_class: 'QCR',
		full_count: 1,
		half_count: 0,
		reference: 'D-1'
	};
	await transform(facts, [fact(registered({ child_claims: [claim] }))], { tables });
	await assert.rejects(
		transform(facts, [fact(registered({ child_claims: [{ ...claim, relief_class: 'WMCR' }] }))], {
			tables
		}),
		/does not use child relief class WMCR/
	);
	await assert.rejects(
		transform(facts, [fact(registered({ child_claims: [claim, claim] }))], { tables }),
		/one child-claim row per tax year/
	);
});
