import assert from 'node:assert/strict';
import test from 'node:test';
import { personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';
import { schemeFault } from '../src/lib/catalogue_rules.ts';
import { resolveCompanyFacts, resolveExitFacts } from '../src/lib/declared-facts.ts';
import { compileExpression } from '../src/lib/expressions/compile.ts';

test('declared fact validity is compiled and enforced against resolved sibling values', () => {
	const fields = [
		{ key: 'enabled', type: 'boolean', required: true },
		{
			key: 'category',
			type: 'string',
			options: ['NONE', 'SPECIAL'],
			valid_when: 'company.facts.enabled || company.facts.category == "NONE"',
			validation_message: 'Special category requires enablement.'
		}
	] as const;
	const company = {
		settings_code: 'TEST',
		region: null,
		pay_frequency: 'MONTHLY'
	};
	assert.throws(
		() =>
			resolveCompanyFacts(fields, { ...company, facts: { enabled: false, category: 'SPECIAL' } }),
		/Special category requires enablement/
	);
	assert.deepEqual(
		resolveCompanyFacts(fields, { ...company, facts: { enabled: true, category: 'SPECIAL' } }),
		{ enabled: true, category: 'SPECIAL' }
	);
	assert.equal(
		compileExpression({
			expression: fields[1].valid_when,
			site: 'entity',
			type: 'boolean',
			facts: fields
		}),
		null
	);
});

test('departure inputs keep typed values and enforce final-day validity before calculation', () => {
	const fields = [
		{ key: 'legal_cause', type: 'string', required: true },
		{
			key: 'pension_offset_claimed',
			type: 'boolean',
			valid_when:
				'!employment.exit_facts.pension_offset_claimed || employment.exit_reason == "RETIREMENT"',
			validation_message: 'Pension offset requires retirement.'
		}
	] as const;
	const person = personContext({
		employee: null,
		employment: {
			service_start: '2020-01-01',
			exit_date: '2026-06-30',
			exit_reason: 'RESIGNATION'
		},
		terms: null,
		asOf: '2026-06-30'
	});
	assert.throws(
		() =>
			resolveExitFacts(fields, { legal_cause: 'VOLUNTARY', pension_offset_claimed: true }, person),
		/Pension offset requires retirement/
	);
	assert.throws(
		() =>
			resolveExitFacts(
				fields,
				{ legal_cause: 'VOLUNTARY', pension_offset_claimed: 'yes' as never },
				person
			),
		/pension_offset_claimed/
	);
	const resolved = resolveExitFacts(
		fields,
		{ legal_cause: 'VOLUNTARY', pension_offset_claimed: false },
		person
	);
	assert.equal(resolved.employment.exit_facts.pension_offset_claimed, false);
});

test('scheme fact validity compiles with declared elections', () => {
	const elections = [
		{ key: 'eligible', type: 'boolean' },
		{
			key: 'category',
			type: 'string',
			valid_when: 'scheme.elections.eligible && scheme.elections.category == "BIRTH"',
			validation_message: 'Category requires eligibility.'
		}
	] as const;
	const scheme = {
		assessed_on: 'BASE',
		elections,
		rules: [{ when: 'true', employee: '0.0', employer: '0.0' }]
	};
	assert.equal(schemeFault(scheme), null);
	assert.match(
		schemeFault({
			...scheme,
			elections: [elections[0], { ...elections[1], valid_when: 'scheme.elections.missing == true' }]
		}) ?? '',
		/validation:.*does not declare/
	);
});

test('scheme expressions compile against typed cumulative history', () => {
	assert.equal(
		compileExpression({
			site: 'scheme',
			type: 'boolean',
			expression: 'history.WTAX.triggered || history.WTAX.has_opening'
		}),
		null
	);
	assert.equal(
		compileExpression({
			site: 'assessment',
			type: 'money',
			expression:
				'history.WTAX.base + history.WTAX.ordinary + history.WTAX.employee + history.WTAX.employer + history.WTAX.periods'
		}),
		null
	);
});
