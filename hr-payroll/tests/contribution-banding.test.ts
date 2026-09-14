/**
 * How a statutory scheme's rules select and price a charge (RFC 0002).
 *
 * The engine has no modes: the first rule whose `when` holds governs, its `employee`/`employer`
 * expressions produce the money, and every piece of arithmetic that used to be typed — base
 * transform, relief, household share, rounding, threshold, annualisation — is an expression the
 * rule carries. These tests pin the decisions the sources call out as expensive to get wrong:
 *
 *   E3   a wage band is chosen by its **ceiling**, because the published schedules read "wages
 *        exceeding X but not exceeding Y". A seeded rung is inclusive at its top (`base <= 4800.0`)
 *        and exclusive at its floor (`base > 3000.0`), so a wage exactly on a boundary belongs to
 *        the band that ends there.
 *   E24  a wage no band matches charges **nothing** (RFC 0002 §6), never the last rung.
 *   E1   a progressive rung's `constant` is the **accumulated** charge on every band below it, not
 *        a flat addend. The annual helpers read a published ladder as data.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { selectRule } from '../src/collections/payroll_runs/lib/rules.ts';
import { accumulateBases } from '../src/collections/payroll_runs/lib/accumulate.ts';
import { contribute } from '../src/collections/payroll_runs/lib/contribute.ts';
import { personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';
import { runtimeExpressionEngine } from '../src/lib/expressions/evaluate.ts';
import type { ContributionConfig } from '../src/collections/payroll_runs/lib/configuration.ts';

const engine = runtimeExpressionEngine({ minimumWage: (region) => (region === 'I' ? 2500 : 0) });

/** A person with nothing recorded, and ones with standings a predicate can read. */
const NOBODY = personContext({
	employee: null,
	employment: { service_start: '' },
	terms: null,
	asOf: '2026-03-31'
});
const FOREIGNER = personContext({
	employee: { marital_status: 'MARRIED' },
	employment: { service_start: '2024-01-01' },
	terms: { residency_status: 'FOREIGNER', residency_since: '2025-02-15' },
	company: { region: 'I' },
	asOf: '2026-03-31'
});
const FAMILY = personContext({
	employee: { dependents_count: 4, spouse_status: 'NONE' },
	employment: { service_start: '2024-01-01' },
	terms: null,
	asOf: '2026-03-31'
});
const SINGLE = personContext({
	employee: { dependents_count: 0, spouse_status: 'NONE' },
	employment: { service_start: '2024-01-01' },
	terms: null,
	asOf: '2026-03-31'
});

type Band = ContributionConfig['rules'][number];
const band = (when: string, employee: string, employer: string): Band => ({
	when,
	employee,
	employer
});
const percent = (when: string, employee: number, employer: number): Band =>
	band(
		when,
		`round_cent(base * ${employee}.0 / 100.0)`,
		`round_cent(base * ${employer}.0 / 100.0)`
	);

/** Two closed bands and an open terminal one, in the declaration order the engine reads. */
const LADDER = [
	percent('base <= 3000.0', 1, 2),
	percent('base > 3000.0 && base <= 4800.0', 3, 4),
	percent('base > 4800.0', 5, 6)
];

/** One scheme as `contribute` reads it: a code and its rule ladder. */
const schemeOf = (
	code: string,
	rules: readonly Band[],
	over: Partial<ContributionConfig['row']> = {}
): ContributionConfig =>
	({
		row: {
			id: `id-${code}`,
			code,
			assessment_period: 'PAY_PERIOD',
			employee_share_annual_cap: null,
			shared_cap_group: null,
			project_relief_annually: false,
			rules,
			...over
		},
		rules
	}) as unknown as ContributionConfig;

const charge = (
	schemes: readonly ContributionConfig[],
	base: number,
	over: Partial<Parameters<typeof contribute>[0]> = {}
) =>
	contribute({
		bases: schemes.map((contribution) => ({ contribution, base, lines: [] })),
		facts: new Map(),
		yearToDate: () => ({ employee: 0, employer: 0, base: 0 }),
		age: 40,
		headcount: 10,
		riskClass: null,
		projection: { payslipsRemaining: 1, futurePayslipEquivalents: 0 },
		person: NOBODY,
		minimumWage: null,
		...over
	});

test('a wage exactly on a boundary belongs to the band that ends there, not the one that starts', () => {
	// E3. 4,800.00 reads as "exceeding 3,000 but not exceeding 4,800", which is the middle band.
	assert.equal(selectRule(LADDER, { base: 4800 }, engine)?.when, 'base > 3000.0 && base <= 4800.0');
	// A cent more crosses into the next one, which is the whole of what the boundary means.
	assert.equal(selectRule(LADDER, { base: 4800.01 }, engine)?.when, 'base > 4800.0');
	assert.equal(selectRule(LADDER, { base: 3000 }, engine)?.when, 'base <= 3000.0');
	assert.equal(
		selectRule(LADDER, { base: 3000.01 }, engine)?.when,
		'base > 3000.0 && base <= 4800.0'
	);
});

test('the rule chosen is the one whose money is charged, so a boundary is money', () => {
	assert.deepEqual(selectRule(LADDER, { base: 4800 }, engine), {
		when: 'base > 3000.0 && base <= 4800.0',
		employee: 'round_cent(base * 3.0 / 100.0)',
		employer: 'round_cent(base * 4.0 / 100.0)'
	});
	assert.equal(charge([schemeOf('PUB', LADDER)], 4800)[0]!.employee, 144);
	assert.equal(charge([schemeOf('PUB', LADDER)], 4800.01)[0]!.employee, 240, '5% of 4,800.01');
});

test('a wage no rule matches charges nothing, never the last rung', () => {
	// E24. A closed ladder states no terminal rung, so a wage past it has no answer.
	const closed = [
		percent('base <= 3000.0', 1, 2),
		percent('base > 3000.0 && base <= 4800.0', 3, 4)
	];
	assert.equal(selectRule(closed, { base: 5000 }, engine), null);
	assert.equal(selectRule([], { base: 5000 }, engine), null);
	// No rule matches: the scheme charges nothing and appears on no payslip.
	assert.deepEqual(charge([schemeOf('PUB', closed)], 5000), []);
});

test('an age condition filters before the wage', () => {
	const aged = [
		band('base >= 0.0 && age >= 0.0 && age < 60.0', 'base * 11.0 / 100.0', 'base * 13.0 / 100.0'),
		band('base >= 0.0 && age >= 60.0', 'base * 6.5 / 100.0', 'base * 8.0 / 100.0')
	];
	assert.equal(selectRule(aged, { base: 3000, age: 45 }, engine)?.employee, 'base * 11.0 / 100.0');
	assert.equal(selectRule(aged, { base: 3000, age: 60 }, engine)?.employee, 'base * 6.5 / 100.0');
	// The window is half-open — `[age_from, age_to)` — so a one-band ladder matches no year above it.
	assert.equal(selectRule([aged[0]!], { base: 3000, age: 61 }, engine), null);
});

test('a condition over the person is read exactly as written', () => {
	const scale = [
		band('person.employee.marital_status != "MARRIED"', 'base * 7.0 / 100.0', '0.0'),
		band('person.employee.marital_status == "MARRIED"', 'base * 4.0 / 100.0', '0.0')
	];
	const nobody = { base: 3000, person: NOBODY, age: 40, headcount: 1, risk_class: '' };
	const married = { ...nobody, person: FOREIGNER };
	assert.equal(selectRule(scale, nobody, engine)?.employee, 'base * 7.0 / 100.0');
	assert.equal(selectRule(scale, married, engine)?.employee, 'base * 4.0 / 100.0');
});

test('a person a scheme does not cover charges zero, and a consumer reads zero', () => {
	// Ineligibility is a rule (RFC 0002 §0): the condition sits on the rule, not on the scheme.
	const fund = schemeOf(
		'FUND',
		LADDER.map((rule) => ({
			...rule,
			when: `person.employee.citizenship != "FOREIGNER" && (${rule.when})`
		}))
	);
	const levy = schemeOf('LEVY', [percent('base >= 0.0', 0, 2)]);
	const local = charge([fund, levy], 3000);
	assert.deepEqual(
		local.map((row) => [row.contribution.row.code, row.employee, row.employer]),
		[
			['FUND', 30, 60],
			['LEVY', 0, 60]
		]
	);
	const foreign = charge([fund, levy], 3000, { person: FOREIGNER });
	assert.deepEqual(
		foreign.map((row) => [row.contribution.row.code, row.employee, row.employer]),
		[['LEVY', 0, 60]]
	);
});

test('a period-table progressive rung charges the cumulative constant and its employer on the whole wage', () => {
	const graduated = schemeOf('CPF', [
		band('base <= 500.0', '0.0', 'base * 17.0 / 100.0'),
		band(
			'base > 500.0 && base <= 750.0',
			'0.0 + (base - 500.0) * 60.0 / 100.0',
			'base * 17.0 / 100.0'
		),
		band('base > 750.0', '150.0 + (base - 750.0) * 20.0 / 100.0', 'base * 17.0 / 100.0')
	]);
	const [row] = charge([graduated], 1000);
	assert.equal(row!.employee, 150 + 250 * 0.2);
	assert.equal(row!.employer, 170, '17% of the whole 1,000, not of the slice above 750');
});

test('minimum-wage floors and caps bound the base, and an unstated wage stops the run', () => {
	const flooredBase = '(base < minimum_wage(region) ? minimum_wage(region) : base)';
	const cappedBase = '(base > 20.0 * minimum_wage(region) ? 20.0 * minimum_wage(region) : base)';
	const floorRule = (when: string, employee: string, employer: string): Band =>
		band(
			when,
			employee.replaceAll('base', `(${flooredBase})`),
			employer.replaceAll('base', `(${flooredBase})`)
		);
	const capRule = (when: string, employee: string, employer: string): Band =>
		band(
			when,
			employee.replaceAll('base', `(${cappedBase})`),
			employer.replaceAll('base', `(${cappedBase})`)
		);
	const floored = schemeOf(
		'BPJS',
		LADDER.map((rule) => floorRule(rule.when, rule.employee, rule.employer))
	);
	const capped = schemeOf(
		'UI',
		LADDER.map((rule) => capRule(rule.when, rule.employee, rule.employer))
	);
	assert.equal(charge([floored], 1000, { minimumWage: 2500 })[0]!.employee, 25);
	assert.equal(charge([floored], 4000, { minimumWage: 2500 })[0]!.employee, 120);
	assert.equal(charge([capped], 100_000, { minimumWage: 2500 })[0]!.employee, 2500);
	assert.throws(
		() => charge([floored], 1000, { minimumWage: null }),
		/BPJS bounds its base by the regional minimum wage/
	);
});

test('a household scheme bills the share per insured head, rounded per head', () => {
	const household =
		'1.0 + (person.employee.spouse_status != "NONE" ? 1.0 : 0.0) + person.employee.dependents_count';
	const excess = `(${household} - 1.0)`;
	const heads = `(1.0 + (${excess} > 0.0 ? (${excess} < 3.0 ? ${excess} : 3.0) : 0.0))`;
	const nhi = schemeOf('NHI', [
		band('base >= 0.0', `round_cent(base * 5.0 / 100.0 * (${heads}))`, '0.0')
	]);
	const single = charge([nhi], 1000, { person: SINGLE })[0]!;
	assert.equal(single.employee, 50, 'one head at 5%');
	const family = charge([nhi], 1000, { person: FAMILY })[0]!;
	assert.equal(family.employee, 200, 'four heads at 5%, billed per head');
});

test('a paired-share scheme rounds the total, floors the employee and gives the remainder away', () => {
	const cpf = schemeOf('CPF', [
		band('base >= 0.0', 'floor_unit(12.0)', 'round_unit(12.0 + 12.5) - floor_unit(12.0)')
	]);
	const [row] = charge([cpf], 1000);
	assert.equal(row!.employee, 12, 'floored to the dollar');
	assert.equal(row!.employer, 13, 'the remainder of the rounded 24.5 total');
});

test('an annual scale projects, relieves, scales and spreads', () => {
	const chargeable = 'year_to_date.base + base * (1.0 + projection.future_equivalents) - 9000.0';
	const clamp = `(${chargeable} > 0.0 ? ${chargeable} : 0.0)`;
	const tax = `progressive(${clamp}, [0.0, 0.0, 0.0, 5000.0, 0.0, 1.0, 20000.0, 150.0, 3.0])`;
	const difference = `(${tax} - year_to_date.employee)`;
	const tax_RULES = [
		band(
			'true',
			`truncate_cent(${difference} > 0.0 ? ${difference} / (projection.payslips_remaining > 1.0 ? projection.payslips_remaining : 1.0) : 0.0)`,
			'0.0'
		)
	];
	// A January monthly payslip: annual gross 48,000 (4,000 × 12) less 9,000 relief = 39,000.
	// The annual tax is 150 + 19,000 × 3% = 720, spread over the twelve payslips of the year.
	const [row] = charge([schemeOf('TAX', tax_RULES)], 4000, {
		projection: { payslipsRemaining: 12, futurePayslipEquivalents: 11 }
	});
	assert.equal(row!.employee, 60);
});

test('a scheme reads another scheme by mention, and the read is the relievable amount', () => {
	// FUND charges 100; TAX subtracts `produced.FUND.employee` as a relief. The mention is the
	// whole dependency: no sequence, no junction.
	const fund = schemeOf('FUND', [band('base >= 0.0', '100.0', '0.0')], {
		employee_share_annual_cap: 4000,
		project_relief_annually: true
	});
	const tax = schemeOf('TAX', [
		band(
			'base >= 0.0',
			'(base - produced.FUND.employee > 0.0 ? base - produced.FUND.employee : 0.0)',
			'0.0'
		)
	]);
	const [, row] = charge([fund, tax], 1000);
	assert.deepEqual([row!.employee, row!.employer], [900, 0]);
	// The annual cap applies to the read: a year-to-date charge plus this one is the pension pool.
	const [, capped] = charge([fund, tax], 1000, {
		projection: { payslipsRemaining: 1, futurePayslipEquivalents: 0 },
		yearToDate: () => ({ employee: 4000, employer: 0, base: 0 })
	});
	assert.equal(capped!.employee, 0, 'the relief is capped out; the base is fully relieved');
});

test('the calculation trace keeps each base line and the reads a charge made', () => {
	// The flow stored on the run is copied from the charge: base lines in accumulation order, then
	// the produced reads the rule made. Nothing is recalculated for the reader.
	const fund = schemeOf('FUND', [band('base >= 0.0', '100.0', '0.0')]);
	const tax = schemeOf('TAX', [band('base >= 0.0', 'produced.FUND.employee', '0.0')]);
	const priced = (
		label: string,
		contribution: ContributionConfig,
		effect: 'INCLUDE' | 'REDUCE',
		amount: number
	) =>
		({
			catalogueComponent: { code: label },
			bucket: 'EARNING',
			optIns: [{ contribution_id: contribution.row.id, effect }],
			label,
			amount
		}) as never;
	const bases = accumulateBases({
		configuration: { contributions: [fund, tax] } as never,
		items: [
			priced('BASIC', fund, 'INCLUDE', 1000),
			priced('UNPAID_LEAVE', fund, 'REDUCE', 200),
			priced('BASIC', tax, 'INCLUDE', 500)
		],
		employeeNumber: 'X'
	});
	const charges = contribute({
		bases,
		facts: new Map(),
		yearToDate: () => ({ employee: 0, employer: 0, base: 0 }),
		age: 40,
		headcount: 10,
		riskClass: null,
		projection: { payslipsRemaining: 1, futurePayslipEquivalents: 0 },
		person: NOBODY,
		minimumWage: null
	});
	assert.deepEqual(charges[0]!.inputs, [
		{ code: 'BASIC', label: 'BASIC', effect: 'INCLUDE', amount: 1000 },
		{ code: 'UNPAID_LEAVE', label: 'UNPAID_LEAVE', effect: 'REDUCE', amount: 200 }
	]);
	assert.deepEqual(charges[1]!.inputs, [
		{ code: 'BASIC', label: 'BASIC', effect: 'INCLUDE', amount: 500 }
	]);
	assert.deepEqual(charges[1]!.reads, [{ code: 'FUND', employee_amount: 100, employer_amount: 0 }]);
});

test('a MONTH-assessed scheme charges once, on the month wage, and nothing in the closing period', () => {
	const monthly = schemeOf('MONTHLY', LADDER, { assessment_period: 'MONTH' });
	const opening = charge([monthly], 2000, {
		assessment: { periodsPerMonth: 2, periodIndex: 1 }
	})[0]!;
	assert.equal(opening.base, 4000, 'the base is grossed to the month');
	assert.equal(opening.employee, 120, '3% of 4,000');
	assert.equal(opening.employer, 160, '4% of 4,000');

	const closing = charge([monthly], 2000, {
		assessment: { periodsPerMonth: 2, periodIndex: 2 }
	})[0]!;
	assert.deepEqual([closing.base, closing.employee, closing.employer], [0, 0, 0]);

	const perPeriod = charge([schemeOf('PERIOD', LADDER)], 1000, {
		assessment: { periodsPerMonth: 2, periodIndex: 1 }
	})[0]!;
	assert.equal(perPeriod.base, 1000);
});
