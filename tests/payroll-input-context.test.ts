import assert from 'node:assert/strict';
import test from 'node:test';
import {
	isEligible,
	personContext,
	type PersonInput
} from '../src/collections/payroll_runs/lib/eligibility.ts';
import { compileExpression } from '../src/lib/expressions/compile.ts';
import { evaluateBoolean, expressionEngine } from '../src/lib/expressions/evaluate.ts';
import { schemeFault } from '../src/lib/catalogue_rules.ts';
import { factStatusesOn, personFacts } from '../src/lib/payroll/facts.ts';
import { createStatutoryWorld } from './fixtures/statutory-world.ts';
import statutoryContributions from '../src/collections/statutory_contributions/+collection.ts';
import { transformSync } from './helpers/transform.ts';
import { Effect } from 'effect';
import { resolveExitFacts } from '../src/lib/declared-facts.ts';

const input: PersonInput = {
	employee: { date_of_birth: '1966-06-15' },
	employment: { service_start: '2026-01-01' },
	terms: { residency_since: '2026-03-10T00:00:00.000Z' },
	asOf: '2026-06-30'
};

test('payroll context keeps wage fractions separate from whole unpaid and benefit days', () => {
	const person = personContext({
		...input,
		period: {
			working_days: 22,
			unpaid_days: 14,
			unpaid_full_days: 13,
			leave_full_days: { SICK_LEAVE: 10, MATERNITY_LEAVE: 3 },
			leave_days: { SICK_LEAVE: 10.5, MATERNITY_LEAVE: 3 }
		}
	});
	assert.deepEqual(person.period, {
		working_days: 22,
		unpaid_days: 14,
		unpaid_full_days: 13,
		leave_full_days: { SICK_LEAVE: 10, MATERNITY_LEAVE: 3 },
		leave_days: { SICK_LEAVE: 10.5, MATERNITY_LEAVE: 3 }
	});
	assert.deepEqual(personContext(input).period, {
		working_days: 0,
		unpaid_days: 0,
		unpaid_full_days: 0,
		leave_full_days: {},
		leave_days: {}
	});
	for (const [site, prefix] of [
		['person', ''],
		['scheme', 'person.']
	] as const) {
		const expression = `${prefix}period.unpaid_full_days < 14 && ${prefix}period.leave_full_days.SICK_LEAVE > 0`;
		assert.equal(compileExpression({ site, expression, type: 'boolean' }), null);
	}
});

test('residency commencement remains an exact date for missing and future checks', () => {
	assert.equal(personContext(input).terms.residency_since, '2026-03-10');
	assert.equal(personContext({ ...input, terms: null }).terms.residency_since, '');
	const future = personContext({ ...input, terms: { residency_since: '2026-07-01' } });
	assert.equal(future.terms.residency_since, '2026-07-01');
	assert.equal(future.employee.residency_months, 0);
	assert.equal(
		compileExpression({
			site: 'scheme',
			type: 'boolean',
			expression: 'person.terms.residency_since != "" && person.terms.residency_since <= period.end'
		}),
		null
	);
});

test('birthday comparisons use the exact anniversary in both expression engines', () => {
	const person = personContext(input);
	const expression = 'employee.birthday(60) == "2026-06-15"';
	assert.equal(isEligible(expression, person), true);
	assert.equal(evaluateBoolean(expressionEngine, `person.${expression}`, { person }), true);
	assert.equal(compileExpression({ site: 'person', type: 'boolean', expression }), null);
	assert.equal(
		isEligible('employee.birthday(60) == ""', personContext({ ...input, employee: null })),
		true
	);
	assert.equal(
		isEligible(
			'employee.birthday(60) == "2024-02-29"',
			personContext({
				...input,
				employee: { date_of_birth: '1964-02-29' }
			})
		),
		true
	);
});

test('cross-scheme elections retain supplied-key presence separately from resolved values', () => {
	const person = personContext({
		...input,
		facts: [
			{
				code: 'NHI',
				registered: true,
				since: '2026-01-01',
				elections: { insured_amount: 48200, agreed: false },
				election_keys: ['insured_amount']
			}
		]
	});
	assert.equal(person.facts.NHI?.elections.insured_amount, 48200);
	assert.deepEqual(person.facts.NHI?.election_keys, ['insured_amount']);
	assert.equal(
		evaluateBoolean(
			expressionEngine,
			'"insured_amount" in person.facts.NHI.election_keys && person.facts.NHI.elections.insured_amount == 48200.0',
			{ person }
		),
		true
	);
	const schemeElections = {
		NHI: [
			{ key: 'insured_amount', type: 'number' },
			{ key: 'agreed', type: 'boolean' }
		]
	} as const;
	assert.equal(
		compileExpression({
			site: 'scheme',
			type: 'boolean',
			schemeElections,
			expression:
				'person.facts.NHI.elections.agreed == false && person.facts.NHI.elections.insured_amount > 0.0'
		}),
		null
	);
	assert.match(
		compileExpression({
			site: 'scheme',
			type: 'boolean',
			schemeElections,
			expression: 'person.facts.NHI.elections.typo > 0.0'
		}) ?? '',
		/does not declare/
	);
	assert.match(
		compileExpression({
			site: 'scheme',
			type: 'money',
			schemeElections,
			expression: 'person.facts.NHI.elections.agreed + 1.0'
		}) ?? '',
		/does not compile/
	);
});

test('another scheme reads the declaration effective on the assessment day', () => {
	const world = createStatutoryWorld({
		code: 'TW',
		period: '2026-06',
		people: [{ key: 'DATED', wage: 48200 }]
	});
	const scheme = world.statutory_contributions.find((row) => row.code === 'NHI');
	assert.ok(scheme);
	const existing = world.employment_statutory_facts.find(
		(row) => row.statutory_contribution_id === scheme.id
	);
	assert.ok(existing);
	const rows = [
		{
			...existing,
			effective_range: { start: '2026-01-01', end: '2026-06-30' },
			status: {
				kind: 'REGISTERED',
				reference_number: 'EARLIER',
				rate_override: null,
				elections: { insured_amount: 45800 }
			}
		},
		{
			...existing,
			effective_range: { start: '2026-07-01', end: null },
			status: {
				kind: 'REGISTERED',
				reference_number: 'LATER',
				rate_override: null,
				elections: { insured_amount: 48200 }
			}
		}
	] as const;
	const contributions = [{ row: scheme, rules: scheme.rules }];
	for (const [asOf, expected] of [
		['2026-06-30', 45800],
		['2026-07-01', 48200]
	] as const) {
		const facts = personFacts(
			contributions,
			factStatusesOn(rows, asOf, 'employment', contributions)
		);
		const person = personContext({ ...input, asOf, facts });
		assert.equal(person.facts.NHI?.elections.insured_amount, expected);
		assert.deepEqual(person.facts.NHI?.election_keys, ['insured_amount']);
	}
});

test('scheme validation checks cross-scheme keys and types in every rule field', () => {
	const elections = { NHI: [{ key: 'insured_amount', type: 'number' }] } as const;
	const base = {
		assessed_on: 'BASE',
		elections: [],
		rules: [{ when: 'true', employee: '0.0', employer: '0.0' }]
	};
	for (const formula of [
		'person.facts.NHI.elections.typo',
		'person.facts.NHI.elections.insured_amount == true'
	]) {
		assert.notEqual(schemeFault({ ...base, assessed_on: formula }, elections), null);
		assert.notEqual(
			schemeFault({ ...base, rules: [{ ...base.rules[0]!, employee: formula }] }, elections),
			null
		);
	}
	assert.equal(
		schemeFault({ ...base, assessed_on: 'person.facts.NHI.elections.insured_amount' }, elections),
		null
	);
});

test('a batch can declare a scheme input and consume it without requiring an earlier write', () => {
	const empty = { findMany: () => Effect.succeed([]) };
	const db = {
		jurisdiction_settings: { findMany: () => Effect.succeed([{ id: 'draft', sealed_at: null }]) },
		allowance_catalogue: empty,
		adhoc_catalogue: empty,
		claim_catalogue: empty,
		loan_catalogue: empty,
		leave_catalogue: empty,
		statutory_contributions: empty
	};
	const rows = [
		{
			settings_id: 'draft',
			code: 'NHI',
			assessed_on: 'BASE',
			elections: [{ key: 'insured_amount', type: 'number' }],
			rules: [{ when: 'true', employee: '0.0', employer: '0.0' }]
		},
		{
			settings_id: 'draft',
			code: 'SUPPLEMENT',
			assessed_on: 'person.facts.NHI.elections.insured_amount',
			elections: [],
			rules: [{ when: 'true', employee: '0.0', employer: '0.0' }]
		}
	];
	assert.doesNotThrow(() => transformSync(statutoryContributions, rows, { db }));
	assert.throws(
		() =>
			transformSync(
				statutoryContributions,
				[rows[0], { ...rows[1], assessed_on: 'person.facts.NHI.elections.typo' }],
				{ db }
			),
		/does not declare election typo/
	);
});

test('departure declarations keep explicit false and require evidence only when applicable', () => {
	const fields = [
		{ key: 'legal_cause', type: 'string', required: true, options: ['RETIREMENT'] },
		{ key: 'pension_offset_claimed', type: 'boolean', required: true },
		{
			key: 'pension_employer_amount',
			type: 'number',
			minimum: 0,
			required_when: 'employment.exit_facts.pension_offset_claimed'
		}
	] as const;
	const person = personContext({
		...input,
		employment: { ...input.employment, exit_date: '2026-06-30' }
	});
	assert.throws(() => resolveExitFacts(fields, {}, person), /legal_cause is required/);
	assert.throws(
		() =>
			resolveExitFacts(fields, { legal_cause: 'RETIREMENT', pension_offset_claimed: true }, person),
		/pension_employer_amount is required/
	);
	const resolved = resolveExitFacts(
		fields,
		{ legal_cause: 'RETIREMENT', pension_offset_claimed: false },
		person
	);
	assert.equal(resolved.employment.exit_facts.pension_offset_claimed, false);
	assert.equal(resolved.employment.exit_facts.pension_employer_amount, 0);
	assert.deepEqual(resolved.employment.exit_fact_keys, ['legal_cause', 'pension_offset_claimed']);
	assert.equal(
		compileExpression({
			site: 'person',
			type: 'boolean',
			exitFacts: fields,
			expression:
				'employment.exit_facts.pension_offset_claimed && employment.exit_facts.pension_employer_amount > 0.0'
		}),
		null
	);
	assert.match(
		compileExpression({
			site: 'person',
			type: 'boolean',
			exitFacts: fields,
			expression: 'employment.exit_facts.typo > 0.0'
		}) ?? '',
		/does not declare departure input typo/
	);
	assert.match(
		compileExpression({
			site: 'entry',
			type: 'money',
			exitFacts: fields,
			expression: 'person.employment.exit_facts.pension_offset_claimed + 1.0'
		}) ?? '',
		/does not compile/
	);
});
