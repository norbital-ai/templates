/**
 * The five CEL contexts: what each site exposes, and what it refuses.
 *
 * The compiler runs at catalogue write time against the blank instance, so an unknown member,
 * an undeclared identifier, an unparseable expression or a wrong result type is refused before
 * any payroll can read it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { compileExpression, assessedOnMentions } from '../src/lib/expressions/compile.ts';
import { EXPRESSION_CONTEXTS } from '../src/lib/expressions/contexts.ts';
import { evaluateNumber, runtimeExpressionEngine } from '../src/lib/expressions/evaluate.ts';

test('every site compiles expressions over its own context', () => {
	const cases = [
		['person', 'employment.service_months >= 12 && company.region == "I"', 'boolean'],
		['person', 'children.under(7) >= 1', 'boolean'],
		['person', "company.facts.sector == 'RETAIL'", 'boolean'],
		['entry', 'entry.days * rates.ordinary_day', 'money'],
		['entry', 'leave.days("ANNUAL_LEAVE") > 0 && entry.captures.remaining > 0', 'boolean'],
		['entry', 'entry.amount * period.instalments', 'money'],
		['work_day', 'total_work_hours > limits.daily_total', 'boolean'],
		[
			'work_day',
			'(total_work_hours > limits.daily_total ? total_work_hours - limits.daily_total : 0.0) * ordinary_hour',
			'money'
		],
		['work_day', 'day_type == "PUBLIC_HOLIDAY" && break_minutes < 30', 'boolean'],
		['assessment', "BASE + catalog('ALLOWANCE', {'pick': ['SUA', 'BPAYBS']}) - ABSENCE", 'money'],
		['assessment', "code('BPAYBS') + annual_exempt(100.0, 0.0, 90000.0)", 'money'],
		['assessment', 'year.earned.BASIC + ENCASHMENT - NO_PAY_LEAVE', 'money'],
		['scheme', 'base > 5000 && person.employee.age >= 60', 'boolean'],
		['scheme', 'scheme.year_to_date.employee + produced.EPF.employee', 'money'],
		[
			'scheme',
			'minimum_wage(person.company.region) > 0 && person.company.headcount > 10',
			'boolean'
		],
		[
			'scheme',
			'scheme.elections.SHG == true && annual_exempt(base, year.earned.bonus, 90000.0) > 0',
			'boolean'
		]
	] as const;
	for (const [site, expression, type] of cases)
		assert.equal(compileExpression({ expression, site, type }), null, `${site}: ${expression}`);
});

test('unknown members, undeclared identifiers, bad syntax and wrong types are refused', () => {
	assert.match(
		compileExpression({
			expression: 'employee.spouse == "NONE"',
			site: 'person',
			type: 'boolean'
		}) ?? '',
		/employee\.spouse, which the person context does not carry/
	);
	assert.match(
		compileExpression({ expression: 'company.name == "X"', site: 'person', type: 'boolean' }) ?? '',
		/company\.region/
	);
	assert.match(
		compileExpression({ expression: 'bsae > 1', site: 'scheme', type: 'boolean' }) ?? '',
		/bsae/
	);
	assert.match(
		compileExpression({ expression: 'entry.amount', site: 'entry', type: 'boolean' }) ?? '',
		/must produce a boolean/
	);
	assert.match(
		compileExpression({ expression: 'employee.age >', site: 'person', type: 'boolean' }) ?? '',
		/does not compile/
	);
	assert.match(
		compileExpression({
			expression: 'maximum(1, 2) > 0',
			site: 'work_day',
			type: 'boolean'
		}) ?? '',
		/does not compile/
	);
	// Another site's members are not in scope.
	assert.match(
		compileExpression({ expression: 'base > 1', site: 'work_day', type: 'boolean' }) ?? '',
		/base/
	);
	assert.match(
		compileExpression({ expression: 'BASE > 1', site: 'scheme', type: 'boolean' }) ?? '',
		/BASE/
	);
});

test('every declared path in the catalogue compiles as a value', () => {
	const isFunction = (path: string) =>
		['under', 'days', 'balance', 'minimum_wage'].includes(path.split('.').at(-1) ?? '');
	for (const context of Object.values(EXPRESSION_CONTEXTS))
		for (const field of context.fields) {
			const path = field.path.replace(/\(.*$/, '').replace(/<.*$/, '').trim();
			if (isFunction(path) || field.path.includes('<')) continue;
			const expression = `${path} != null`;
			assert.equal(
				compileExpression({ expression, site: context.site, type: 'boolean' }),
				null,
				`${context.site}: ${expression}`
			);
		}
});

test('the runtime closures compute what the seeds name', () => {
	const engine = runtimeExpressionEngine({
		minimumWage: (region) => (region === 'I' ? 1700 : 0)
	});
	const run = (expression: string, context: Record<string, unknown>) =>
		evaluateNumber(engine, expression, context);

	assert.equal(run('bracket(base, 5000.0, 100.0)', { base: 3395.34 }), 3400);
	assert.equal(run('bracket(base, 5000.0, 100.0)', { base: 5000 }), 5000);
	assert.equal(run('bracket(base, 5000.0, 100.0)', { base: 5000.01 }), 5000.01);
	// The EPF Third Schedule rounds in tens to RM20, twenties to RM5,000 and hundreds to RM20,000.
	// That is a ladder of brackets chosen by the wage, never a composition: nesting
	// `bracket(bracket(base, 5000, 20), 20000, 100)` re-rounds 980 to 1,000 and lands one row high.
	const epf =
		'base <= 20.0 ? bracket(base, 20.0, 10.0) : (base <= 5000.0 ? bracket(base, 5000.0, 20.0) : bracket(base, 20000.0, 100.0))';
	assert.equal(run(epf, { base: 15 }), 20);
	assert.equal(run(epf, { base: 970 }), 980);
	assert.equal(run(epf, { base: 3395.34 }), 3400);
	assert.equal(run(epf, { base: 5000.01 }), 5100);
	assert.equal(run(epf, { base: 20000.01 }), 20000.01);
	assert.equal(run('bracket(bracket(base, 5000.0, 20.0), 20000.0, 100.0)', { base: 970 }), 1000);
	assert.equal(run('ladder(base, [1000.0, 5000.0, 10000.0])', { base: 3200 }), 5000);
	assert.equal(run('ladder(base, [1000.0, 5000.0, 10000.0])', { base: 12000 }), 10000);
	assert.equal(run('minimum_wage(region) * 0.5', { region: 'I' }), 850);
	assert.equal(
		run('total_work_hours > limits.daily_total ? total_work_hours - limits.daily_total : 0.0', {
			total_work_hours: 13,
			limits: { daily_total: 11 }
		}),
		2
	);
});

test('the assessment closures select catalogue rows and exempt annually', () => {
	const engine = runtimeExpressionEngine({
		code: (code) => (code === 'BPAYBS' ? 500 : code === 'ALPAY' ? 200 : 0),
		catalog: (catalogue, selection) => {
			assert.equal(catalogue, 'ALLOWANCE');
			const rows: Record<string, number> = { SUA: 100, BPAYBS: 500, ADJ: 50 };
			if (selection?.pick != null)
				return selection.pick.reduce((sum, code) => sum + (rows[code] ?? 0), 0);
			if (selection?.exclude != null)
				return Object.entries(rows).reduce(
					(sum, [code, amount]) => (selection.exclude!.includes(code) ? sum : sum + amount),
					0
				);
			return Object.values(rows).reduce((sum, amount) => sum + amount, 0);
		}
	});
	const run = (expression: string) => evaluateNumber(engine, expression, {});

	assert.equal(run("code('BPAYBS') + code('ALPAY')"), 700);
	assert.equal(run("catalog('ALLOWANCE', {'pick': ['SUA', 'BPAYBS']})"), 600);
	assert.equal(run("catalog('ALLOWANCE', {'exclude': ['BPAYBS']})"), 150);
	assert.equal(run("catalog('ALLOWANCE')"), 650);
	assert.equal(run('annual_exempt(1000.0, 89500.0, 90000.0)'), 500);
	assert.equal(run('annual_exempt(1000.0, 90000.0, 90000.0)'), 0);
	assert.equal(run('annual_exempt(1000.0, 0.0, 90000.0)'), 1000);
});

test('the AST literal walk reads the version-bound mentions', () => {
	const mentions = assessedOnMentions(
		"code('BPAYBS') + catalog('ALLOWANCE', {'exclude': ['BACKPAY_ADD_WAGES']}) + year.earned.THIRTEENTH_MONTH_PAY"
	);
	assert.deepEqual(mentions.codes, ['BPAYBS']);
	assert.deepEqual(mentions.catalogues, [
		{ catalogue: 'ALLOWANCE', pick: [], exclude: ['BACKPAY_ADD_WAGES'] }
	]);
	assert.deepEqual(mentions.yearEarned, ['THIRTEENTH_MONTH_PAY']);
});
