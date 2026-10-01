// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The facts-owed queue lists, key by key, exactly what the run's declared-fact checks refuse on: a required value
 * missing, a code outside its table, an unevidenced value, a conditional requirement that holds. Fixtures are
 * jurisdiction-free; every expected sentence is `factValuesFault`'s own, hand-written here.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { entityFactsOwed, factsOwed, owedIssues } from '../src/lib/facts-owed.ts';

const subject = (overrides) => ({
	collection: 'employment_terms',
	id: 't1',
	label: 'E001: terms on 2026-09-01',
	fields: [
		{ key: 'a', type: 'number', label: 'A', required: true },
		{ key: 'b', type: 'code', table: 'T' },
		{ key: 'c', type: 'string', evidence: { kind: 'REFERENCE' } },
		{ key: 'd', type: 'string', required_when: 'x' }
	],
	values: { b: 'ZZ', c: 'v' },
	when: () => true,
	evidenced: () => false,
	codes: (table, code) => (table === 'T' && code === 'A1' ? { parent_code: null } : null),
	...overrides
});

test('every owed key is listed, not only the first the run stops at', () => {
	assert.deepEqual(
		factsOwed([subject()]).map((fact) => [fact.key, fact.message]),
		[
			['a', 'A is required before calculation.'],
			['b', 'b: ZZ is not a code of table T in force on this date.'],
			['c', 'c counts only once its evidence (reference) is recorded.'],
			['d', 'd is required before calculation.']
		]
	);
});

test('a condition that does not hold, a code in force and recorded evidence owe nothing', () => {
	assert.deepEqual(
		factsOwed([
			subject({ values: { a: 1, b: 'A1', c: 'v' }, when: () => false, evidenced: () => true })
		]),
		[]
	);
});

test('an owed fact is a blocking run issue naming its record', () => {
	assert.deepEqual(
		owedIssues(
			factsOwed([subject({ values: { b: 'A1', c: 'v', d: 'y' }, evidenced: () => true })])
		),
		[
			{
				code: 'FACTS_OWED',
				message: 'E001: terms on 2026-09-01: A is required before calculation.',
				collection: 'employment_terms',
				recordId: 't1'
			}
		]
	);
});

const version = {
	facts: [{ key: 'registered', type: 'boolean', required: true }],
	terms_facts: [{ key: 'grade', type: 'string', required: true }],
	person_facts: [{ key: 'status', type: 'string', required: true }]
};
const input = (overrides = {}) => ({
	asOf: '2026-09-30',
	window: { start: '2026-09-01', end: '2026-09-30' },
	versionOn: () => version,
	company: {
		id: 'co',
		name: 'Co',
		settings_code: 'LX',
		region: null,
		pay_frequency: 'MONTHLY',
		facts: {}
	},
	companyFactRevisions: [],
	employments: [
		{
			id: 'e1',
			employee_id: 'p1',
			employee_number: 'E001',
			effective_range: { from: '2025-01-01', to: null }
		},
		// left before the window: owes nothing to this run
		{
			id: 'e2',
			employee_id: 'p2',
			employee_number: 'E002',
			effective_range: { from: '2025-01-01', to: '2026-08-31' }
		}
	],
	employees: [{ id: 'p1' }, { id: 'p2' }],
	terms: [
		{
			id: 't0',
			employment_id: 'e1',
			effective_range: { from: '2025-01-01', to: '2025-12-31' },
			facts: {}
		},
		{ id: 't1', employment_id: 'e1', effective_range: { from: '2026-01-01', to: null }, facts: {} },
		{
			id: 't2',
			employment_id: 'e2',
			effective_range: { from: '2025-01-01', to: '2026-08-31' },
			facts: {}
		}
	],
	personFacts: [],
	evidence: new Set(),
	...overrides
});

test('the run window owes the entity fact, the terms that price in it and the person facts of who it pays', () => {
	assert.deepEqual(
		entityFactsOwed(input()).map((fact) => [
			fact.collection,
			fact.id,
			fact.label,
			fact.key,
			fact.message
		]),
		[
			['companies', 'co', 'Co', 'registered', 'registered is required before calculation.'],
			[
				'employment_terms',
				't1',
				'E001: terms on 2026-09-01',
				'grade',
				'grade is required before calculation.'
			],
			[
				'person_facts',
				'',
				'E001: person facts on 2026-09-30',
				'status',
				'status is required before calculation.'
			]
		]
	);
});

test('a company revision in force, recorded terms and an employment row over the personal one clear the queue', () => {
	assert.deepEqual(
		entityFactsOwed(
			input({
				companyFactRevisions: [
					{
						id: 'r1',
						facts: { registered: true },
						effective_range: { from: '2026-01-01', to: null }
					}
				],
				terms: [
					{
						id: 't1',
						employment_id: 'e1',
						effective_range: { from: '2026-01-01', to: null },
						facts: { grade: 'G1' }
					}
				],
				personFacts: [
					{
						employee_id: 'p1',
						employment_id: 'e1',
						facts: { status: 'S' },
						effective_range: { from: '2026-09-01', to: null }
					}
				]
			})
		),
		[]
	);
});

test('a person fact recorded only after the run date is still owed', () => {
	const owed = entityFactsOwed(
		input({
			companyFactRevisions: [
				{ id: 'r1', facts: { registered: true }, effective_range: { from: '2026-01-01', to: null } }
			],
			terms: [
				{
					id: 't1',
					employment_id: 'e1',
					effective_range: { from: '2026-01-01', to: null },
					facts: { grade: 'G1' }
				}
			],
			personFacts: [
				{
					employee_id: 'p1',
					employment_id: null,
					facts: { status: 'S' },
					effective_range: { from: '2026-10-01', to: null }
				}
			]
		})
	);
	assert.deepEqual(
		owed.map((fact) => fact.key),
		['status']
	);
});
