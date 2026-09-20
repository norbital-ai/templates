import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { factKeysValueSchema } from '../src/datatypes/fact_keys/+definition.ts';
import companies from '../src/collections/companies/+collection.ts';
import registrations from '../src/collections/employment_statutory_facts/+collection.ts';
import settings from '../src/collections/jurisdiction_settings/+collection.ts';
import { buildStatutory } from './fixtures/statutory-world.ts';
import { transformOne } from './helpers/transform.ts';
import { schemeFault } from '../src/lib/catalogue_rules.ts';
import { compileExpression } from '../src/lib/expressions/compile.ts';
import { personFactsOn } from '../src/lib/payroll/facts.ts';

const count = {
	key: 'declared_count',
	type: 'number',
	label: 'Declared count',
	integer: true,
	minimum: 0,
	maximum: 3,
	required: true
} as const;
const decode = Schema.decodeUnknownSync(factKeysValueSchema);

test('draft settings reject invalid entity conditions and seals include every scheme expression', () => {
	const empty = { findMany: () => Effect.succeed([]) };
	const draft = {
		id: 'draft',
		code: 'TEST',
		jurisdiction_code: 'SG',
		payroll: { currency: 'SGD' },
		effective_range: { start: '2026-01-01', end: null },
		facts: [],
		sealed_at: null
	};
	for (const required_when of ['company.facts.typo > 0.0', 'company.facts.consent + 1.0'])
		assert.throws(
			() =>
				transformOne(
					settings,
					{ ...draft, facts: [{ key: 'consent', type: 'boolean', required_when }] },
					undefined,
					{ jurisdiction_settings: empty }
				),
			/requirement:/
		);
	for (const extra of [
		{ ordinary_on: 'person.company.facts.typo' },
		{
			elections: [
				{ key: 'count', type: 'number', required_when: 'person.company.facts.typo > 0.0' }
			]
		},
		{
			rules: [
				{ when: 'true', employee: '0.0', employer: '0.0', rebate: 'person.company.facts.typo' }
			]
		},
		{
			rules: [
				{ when: 'true', employee: '0.0', employer: '0.0', deduction: 'person.company.facts.typo' }
			]
		}
	]) {
		const db = {
			jurisdiction_settings: empty,
			allowance_catalogue: empty,
			adhoc_catalogue: empty,
			claim_catalogue: empty,
			loan_catalogue: empty,
			leave_catalogue: empty,
			statutory_contributions: {
				findMany: () =>
					Effect.succeed([
						{
							settings_id: 'draft',
							code: 'SCHEME',
							assessed_on: 'BASE',
							elections: [],
							rules: [{ when: 'true', employee: '0.0', employer: '0.0' }],
							...extra
						}
					])
			}
		};
		assert.throws(
			() => transformOne(settings, { sealed_at: '2026-01-01T00:00:00Z' }, draft, db),
			/company.facts.typo.*does not declare/
		);
	}
});

test('entity requirements follow declared conditions without confusing false with missing', () => {
	for (const [consent, value, refusal] of [
		[false, undefined, false],
		[true, undefined, true],
		[true, 0, false]
	] as const) {
		const calculate = () =>
			buildStatutory(
				{ code: 'SG', period: '2026-01', people: [{ key: 'INPUT', wage: 3000 }] },
				(world) => {
					for (const version of world.jurisdiction_settings)
						version.facts = [
							{ key: 'consent', type: 'boolean', required: true },
							{
								...count,
								required: false,
								default_value: 0,
								required_when: 'company.facts.consent && company.pay_frequency == "MONTHLY"'
							}
						];
					world.companies[0]!.facts = {
						consent,
						...(value === undefined ? {} : { declared_count: value })
					};
				}
			);
		if (refusal) assert.throws(calculate, /Declared count is required/);
		else assert.doesNotThrow(calculate);
	}
});

test('scheme requirements use the assessed base and refuse missing values before charging', () => {
	for (const [wage, value, refusal] of [
		[0, undefined, false],
		[3000, undefined, true],
		[3000, 0, false]
	] as const) {
		const calculate = () =>
			buildStatutory(
				{ code: 'SG', period: '2026-01', people: [{ key: 'INPUT', wage }] },
				(world) => {
					const ids = new Set(
						world.statutory_contributions
							.filter((row) => row.code === 'CPF')
							.map((row) => {
								row.elections = [
									...row.elections,
									{ ...count, required: false, required_when: 'base > 0.0' }
								];
								return row.id;
							})
					);
					for (const fact of world.employment_statutory_facts)
						if (ids.has(fact.statutory_contribution_id) && fact.status.kind === 'REGISTERED')
							fact.status.elections = {
								...fact.status.elections,
								...(value === undefined ? {} : { declared_count: value })
							};
				}
			);
		if (refusal) assert.throws(calculate, /Declared count is required/);
		else assert.doesNotThrow(calculate);
	}
});

test('scheme conditions compile against the declared inputs and cannot read a later deduction', () => {
	const scheme = {
		assessed_on: 'BASE',
		rules: [{ when: 'true', employee: '0.0', employer: '0.0' }]
	};
	for (const condition of ['base + 1.0', 'scheme.elections.typo > 0.0', 'scheme.deduction > 0.0']) {
		assert.notEqual(
			schemeFault({
				...scheme,
				elections: [{ ...count, required: false, required_when: condition }]
			}),
			null
		);
	}
	assert.equal(
		schemeFault({
			...scheme,
			elections: [{ ...count, required: false, required_when: 'base > 0.0' }]
		}),
		null
	);
});

test('a formula referring to an undeclared entity input cannot silently read zero', () => {
	assert.throws(
		() =>
			buildStatutory(
				{ code: 'SG', period: '2026-01', people: [{ key: 'INPUT', wage: 3000 }] },
				(world) => {
					for (const scheme of world.statutory_contributions)
						if (scheme.code === 'CPF')
							scheme.rules = [
								{
									when: 'true',
									employee: 'person.company.facts.misspelled_rate * base',
									employer: '0.0'
								}
							];
				}
			),
		/misspelled_rate.*not declared/
	);
});

test('fact declarations validate constraints, unique keys and explicit defaults', () => {
	assert.doesNotThrow(() =>
		decode([count, { key: 'consent', type: 'boolean', default_value: false }])
	);
	for (const declarations of [
		[count, count],
		[{ ...count, minimum: 4 }],
		[{ ...count, type: 'boolean' }],
		[{ ...count, default_value: 0 }],
		[{ ...count, required_when: 'true' }],
		[{ ...count, required: false, required_when: ' ' }],
		[{ ...count, required: false, default_value: -1 }],
		[{ key: 'category', type: 'string', options: ['A', 1] }],
		[{ key: 'category', type: 'string', options: ['A', 'A'] }],
		[{ key: 'reference', type: 'string', min_length: -1 }],
		[{ key: 'not a key', type: 'string' }]
	])
		assert.throws(() => decode(declarations));
});

test('entity conditions compile only against declared, correctly typed entity inputs', () => {
	const compile = (expression: string) =>
		compileExpression({
			expression,
			site: 'entity',
			type: 'boolean',
			facts: [{ key: 'consent', type: 'boolean' }]
		});
	assert.equal(compile('company.facts.consent && company.region == "TEST"'), null);
	assert.equal(compile('"consent" in company.fact_keys'), null);
	for (const expression of [
		'company.facts.typo > 0.0',
		'company.facts.consent + 1.0',
		'person.terms.basic_salary > 0.0'
	])
		assert.notEqual(compile(expression), null);
});

const versions = [{ code: 'TEST', facts: [count], sealed_at: '2026-01-01', voided_at: null }];
const companyDb = { jurisdiction_settings: { findMany: () => Effect.succeed(versions) } };

test('entity writes reject unknown keys and invalid values, while preserving an incomplete record', () => {
	const write = (facts: Record<string, unknown>) =>
		transformOne(companies, { settings_code: 'TEST', facts }, undefined, companyDb);
	assert.doesNotThrow(() => write({}));
	assert.doesNotThrow(() => write({ declared_count: 0 }));
	assert.throws(() => write({ wrong_key: 0 }), /does not declare.*wrong_key/);
	for (const value of ['0', -1, 0.5, 4])
		assert.throws(() => write({ declared_count: value }), /Declared count/);
	assert.throws(
		() =>
			transformOne(
				companies,
				{ settings_code: 'OTHER' },
				{ settings_code: 'TEST', facts: { declared_count: 0 } },
				companyDb
			),
		/does not declare/
	);
});

test('scheme declaration constraints are enforced on employee writes', () => {
	const db = {
		statutory_contributions: {
			findMany: () => Effect.succeed([{ id: 'scheme', code: 'SCHEME', elections: [count] }])
		}
	};
	const write = (elections: Record<string, unknown>) =>
		transformOne(
			registrations,
			{
				employee_id: 'employee',
				statutory_contribution_id: 'scheme',
				status: { kind: 'REGISTERED', reference_number: 'DECL', elections }
			},
			undefined,
			db
		);
	assert.doesNotThrow(() => write({}));
	assert.doesNotThrow(() => write({ declared_count: 0 }));
	for (const value of [-1, 0.5, 4])
		assert.throws(() => write({ declared_count: value }), /Declared count/);
});

test('employment declarations override personal facts and never leak across employments', () => {
	const schemes = [
		{
			id: 'scheme',
			code: 'SCHEME',
			elections: [
				{ key: 'category', type: 'string' },
				{ key: 'instruction', type: 'string', scope: 'EMPLOYMENT' }
			]
		}
	] as const;
	const row = (employment_id: string | null, elections: Record<string, string>) => ({
		employment_id,
		statutory_contribution_id: 'scheme',
		effective_range: { start: '2026-01-01', end: null },
		status: { kind: 'REGISTERED' as const, elections }
	});
	const rows = [
		row(null, { category: 'PERSON' }),
		row('employment-a', { category: 'A', instruction: 'ONLY-A' }),
		row('employment-b', { category: 'B', instruction: 'ONLY-B' })
	];
	assert.deepEqual(personFactsOn(rows, schemes, '2026-06-01', 'employment-a')[0]?.elections, {
		category: 'A',
		instruction: 'ONLY-A'
	});
	assert.deepEqual(personFactsOn(rows, schemes, '2026-06-01', 'employment-c')[0]?.elections, {
		category: 'PERSON',
		instruction: ''
	});
	assert.throws(
		() =>
			personFactsOn(
				[row(null, { category: 'PERSON', instruction: 'UNSCOPED' })],
				schemes,
				'2026-06-01',
				'employment-a'
			),
		/instruction requires a named employment/
	);
});

test('employment-scoped declarations require an employment owned by the employee', () => {
	const db = {
		statutory_contributions: {
			findMany: () =>
				Effect.succeed([
					{
						id: 'scheme',
						code: 'SCHEME',
						elections: [{ key: 'instruction', type: 'string', scope: 'EMPLOYMENT' }]
					}
				])
		},
		employments: {
			findMany: () => Effect.succeed([{ id: 'employment', employee_id: 'employee' }])
		}
	};
	const write = (employment_id?: string, employee_id = 'employee') =>
		transformOne(
			registrations,
			{
				employee_id,
				...(employment_id == null ? {} : { employment_id }),
				statutory_contribution_id: 'scheme',
				status: { kind: 'REGISTERED', elections: { instruction: 'NOTICE' } }
			},
			undefined,
			db
		);
	assert.throws(() => write(), /requires a named employment/);
	assert.throws(() => write('employment', 'someone-else'), /must belong to this employee/);
	assert.doesNotThrow(() =>
		transformOne(
			registrations,
			{
				employee_id: 'employee',
				employment_id: 'employment',
				statutory_contribution_id: 'scheme',
				status: { kind: 'REGISTERED', elections: { instruction: 'NOTICE' } }
			},
			undefined,
			db
		)
	);
});

test('departure levy declarations require a journey reference on write', () => {
	const db = {
		statutory_contributions: {
			findMany: () =>
				Effect.succeed([
					{
						id: 'scheme',
						code: 'PCB',
						elections: [],
						assessed_on: 'scheme.deductions.DEPARTURE_LEVY',
						rules: []
					}
				])
		}
	};
	const write = (event_reference?: string) =>
		transformOne(
			registrations,
			{
				employee_id: 'employee',
				statutory_contribution_id: 'scheme',
				status: {
					kind: 'REGISTERED',
					reference_number: 'DECL',
					elections: {},
					deduction_claims: [
						{
							period: '2026-01',
							category: 'DEPARTURE_LEVY',
							amount: 100,
							source: 'EMPLOYEE',
							reference: 'TP1-001',
							event_reference
						}
					]
				}
			},
			undefined,
			db
		);
	assert.throws(() => write(), /journey reference/);
	assert.throws(() => write('  '), /journey reference/);
	assert.doesNotThrow(() => write('TRIP-001'));
});

test('payroll validates entity facts before absent values become numeric or boolean defaults', () => {
	for (const facts of [
		{},
		{ declared_count: '0' },
		{ declared_count: -1 },
		{ declared_count: 0.5 }
	]) {
		assert.throws(
			() =>
				buildStatutory(
					{ code: 'SG', period: '2026-01', people: [{ key: 'INPUT', wage: 3000 }] },
					(world) => {
						for (const version of world.jurisdiction_settings) version.facts = [count];
						world.companies[0]!.facts = facts;
					}
				),
			/Declared count/
		);
	}
	assert.doesNotThrow(() =>
		buildStatutory(
			{ code: 'SG', period: '2026-01', people: [{ key: 'INPUT', wage: 3000 }] },
			(world) => {
				for (const version of world.jurisdiction_settings)
					version.facts = [count, { key: 'consent', type: 'boolean', required: true }];
				world.companies[0]!.facts = { declared_count: 0, consent: false };
			}
		)
	);
});

test('payroll revalidates employee declarations after settings-version alignment', () => {
	for (const value of [undefined, -1, 0.5, 4]) {
		assert.throws(
			() =>
				buildStatutory(
					{ code: 'SG', period: '2026-01', people: [{ key: 'INPUT', wage: 3000 }] },
					(world) => {
						const ids = new Set(
							world.statutory_contributions
								.filter((row) => row.code === 'CPF')
								.map((row) => {
									row.elections = [...row.elections, count];
									return row.id;
								})
						);
						for (const fact of world.employment_statutory_facts)
							if (ids.has(fact.statutory_contribution_id) && fact.status.kind === 'REGISTERED')
								fact.status.elections = {
									...fact.status.elections,
									...(value === undefined ? {} : { declared_count: value })
								};
					}
				),
			/Declared count/
		);
	}
});

test('a configured statutory default reaches the formula without replacing explicit false', () => {
	for (const [value, expected] of [
		[undefined, 10],
		[false, 0],
		[true, 10]
	] as const) {
		const { slips } = buildStatutory(
			{ code: 'SG', period: '2026-01', people: [{ key: 'INPUT', wage: 3000 }] },
			(world) => {
				const ids = new Set(
					world.statutory_contributions
						.filter((row) => row.code === 'CPF')
						.map((row) => {
							row.elections = [{ key: 'declared_choice', type: 'boolean', default_value: true }];
							row.rules = [
								{
									when: 'true',
									employee: 'scheme.elections.declared_choice ? 10.0 : 0.0',
									employer: '0.0'
								}
							];
							return row.id;
						})
				);
				for (const fact of world.employment_statutory_facts)
					if (ids.has(fact.statutory_contribution_id) && fact.status.kind === 'REGISTERED')
						fact.status.elections = value === undefined ? {} : { declared_choice: value };
			}
		);
		assert.equal(
			slips.get('INPUT')!.statutory.find((row) => row.scheme_code === 'CPF')?.employee_amount ?? 0,
			expected
		);
	}
});
