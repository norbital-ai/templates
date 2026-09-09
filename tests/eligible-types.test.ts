// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The type picker's offer: the engine's predicate grammar over the facts one browser query reads.
 *
 * What is pinned: the context is built from the joined employment row the same way the hook's
 * `capSubject` builds it (terms in force on the day, children alive on it, the entity's region),
 * an empty rule offers everyone, and an offer of nothing is a predicate no row satisfies rather
 * than `in ()`, which is not SQL. No person yet means the in-force clause alone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	NO_ROW,
	eligibleTypeIds,
	eligibleTypeWhere,
	personAsOf
} from '../src/lib/eligible-types.ts';

const range = (start: string, end = '9999-12-31') => ({
	start: `${start}T00:00:00.000Z`,
	end: `${end}T00:00:00.000Z`
});

const facts = {
	hire_date: '2024-03-01',
	effective_range: range('2024-03-01'),
	exit_date: null,
	children: [
		{ child_birthdate: '2020-06-01', relationship: 'CHILD', effective_range: null },
		// Closed before the day: not counted.
		{
			child_birthdate: '2010-01-01',
			relationship: 'LEGAL_WARD',
			effective_range: range('2010-01-01', '2024-12-31')
		}
	],
	employment_employee: { gender: 'F', date_of_birth: '1990-05-10', nationality: 'MY' },
	employment_company: { region: 'KL' },
	term_employment: [
		{ effective_range: range('2024-03-01', '2025-12-31'), department: 'FINANCE', grade: 'G2' },
		{ effective_range: range('2026-01-01'), department: 'LOGISTICS', grade: 'G3' }
	]
};

const rows = [
	{ id: 'fuel', eligibility: 'terms.department == "LOGISTICS"' },
	{ id: 'senior', eligibility: 'terms.grade == "M1"' },
	{ id: 'parent', eligibility: 'children.under(7) >= 1' },
	{ id: 'veteran', eligibility: 'employment.service_months >= 36' },
	{ id: 'local', eligibility: 'company.region == "KL"' },
	{ id: 'anyone', eligibility: '' }
];

test('the person is read as of the day: the terms in force, the children alive, the entity', () => {
	const today = personAsOf(facts, '2026-09-10');
	assert.equal(today.terms.department, 'LOGISTICS');
	assert.equal(today.terms.grade, 'G3');
	assert.equal(today.children.count, 1);
	assert.equal(today.employment.service_months, 30);
	assert.equal(today.company.region, 'KL');
	assert.equal(today.employee.age, 36);
	const earlier = personAsOf(facts, '2024-06-01');
	assert.equal(earlier.terms.department, 'FINANCE');
	assert.equal(earlier.children.count, 2);
});

test('the offer is the rows whose rule holds; an empty rule holds for everyone', () => {
	assert.deepEqual(eligibleTypeIds(rows, personAsOf(facts, '2026-09-10')), [
		'fuel',
		'parent',
		'local',
		'anyone'
	]);
	assert.deepEqual(eligibleTypeIds(rows, personAsOf(facts, '2024-06-01')), [
		'parent',
		'local',
		'anyone'
	]);
	assert.deepEqual(eligibleTypeIds(rows, personAsOf(facts, '2027-04-01')), [
		'fuel',
		'parent',
		'veteran',
		'local',
		'anyone'
	]);
});

test('the predicate keeps the in-force clause and never asks the server for `in ()`', () => {
	const inForce = { claim_catalogue_settings: { some: { code: { eq: 'MY' } } } };
	assert.equal(
		eligibleTypeWhere(inForce, null),
		inForce,
		'no person yet offers every row in force'
	);
	assert.deepEqual(eligibleTypeWhere(inForce, ['fuel', 'anyone']), {
		...inForce,
		id: { in: ['fuel', 'anyone'] }
	});
	assert.deepEqual(eligibleTypeWhere(inForce, []), { ...inForce, id: { in: [NO_ROW] } });
	assert.deepEqual(eligibleTypeWhere(undefined, ['fuel']), { id: { in: ['fuel'] } });
});
