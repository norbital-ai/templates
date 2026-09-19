/**
 * How a statutory scheme's rules select and price a charge.
 *
 * The engine has no modes: `assessed_on` states the wage, the first rule whose `when` holds
 * governs, its `employee`/`employer` expressions produce the money, and every piece of arithmetic
 * that used to be typed — base transform, relief, household share, rounding, threshold,
 * annualisation — is an expression the rule carries. These tests pin the decisions the sources
 * call out as expensive to get wrong:
 *
 *   E3   a wage band is chosen by its **ceiling**, because the published schedules read "wages
 *        exceeding X but not exceeding Y". A seeded rung is inclusive at its top (`base <= 4800.0`)
 *        and exclusive at its floor (`base > 3000.0`), so a wage exactly on a boundary belongs to
 *        the band that ends there.
 *   E24  a wage no band matches charges **nothing**, never the last rung.
 *   E1   a progressive rung's `constant` is the **accumulated** charge on every band below it, not
 *        a flat addend. The annual helpers read a published ladder as data.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { selectRule } from '../src/collections/payroll_runs/lib/rules.ts';
import {
	accumulatePayslip,
	type AccumulatedPayslip,
	type ReservedLine
} from '../src/collections/payroll_runs/lib/accumulate.ts';
import { contribute, contributeCompany } from '../src/collections/payroll_runs/lib/contribute.ts';
import {
	personContext,
	type PersonContext
} from '../src/collections/payroll_runs/lib/eligibility.ts';
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

/** The same person in an entity of a given size, for a rule that reads `person.company.headcount`. */
const withHeadcount = (headcount: number): PersonContext => ({
	...NOBODY,
	company: { ...NOBODY.company, headcount }
});

/** A person at a given age, for a rule that reads `person.employee.age`. */
const atAge = (age: number): PersonContext => ({
	...NOBODY,
	employee: { ...NOBODY.employee, age }
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

/** One scheme as `contribute` reads it: a code, its formula and its rule ladder. */
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
			assessment_scope: 'EMPLOYMENT',
			elections: [],
			employee_share_annual_cap: null,
			shared_cap_group: null,
			project_relief_annually: false,
			rules,
			assessed_on: 'BASE',
			...over
		},
		rules
	}) as unknown as ContributionConfig;

/** A payslip whose only money is a salary of `base`. */
const accumulationOf = (base: number): AccumulatedPayslip => {
	const reserved: Record<ReservedLine, number> = {
		BASE: base,
		OVERTIME: 0,
		NIGHT_PREMIUM: 0,
		ABSENCE: 0,
		NO_PAY_LEAVE: 0,
		ENCASHMENT: 0,
		INCENTIVE: 0
	};
	return { reserved, codes: new Map(), familyOf: new Map(), fixedOf: new Map(), lines: [] };
};

const PERIOD = {
	key: '2026-03',
	start: '2026-03-01',
	end: '2026-03-31',
	index: 1,
	instalments: 1,
	monthlyOn: 'FIRST',
	lastOfYear: false
};

const charge = (
	schemes: readonly ContributionConfig[],
	base: number,
	over: Partial<Parameters<typeof contribute>[0]> = {}
) =>
	contribute({
		accumulation: accumulationOf(base),
		contributions: schemes,
		facts: new Map(),
		yearToDate: () => ({ employee: 0, employer: 0, base: 0 }),
		yearEarned: new Map(),
		period: PERIOD,
		year: { start: '2026-01-01', end: '2026-12-31', months_employed: 3 },
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
		band(
			'base >= 0.0 && person.employee.age >= 0.0 && person.employee.age < 60.0',
			'base * 11.0 / 100.0',
			'base * 13.0 / 100.0'
		),
		band('base >= 0.0 && person.employee.age >= 60.0', 'base * 6.5 / 100.0', 'base * 8.0 / 100.0')
	];
	assert.equal(
		selectRule(aged, { base: 3000, person: atAge(45) }, engine)?.employee,
		'base * 11.0 / 100.0'
	);
	assert.equal(
		selectRule(aged, { base: 3000, person: atAge(60) }, engine)?.employee,
		'base * 6.5 / 100.0'
	);
	// The window is half-open — `[age_from, age_to)` — so a one-band ladder matches no year above it.
	assert.equal(selectRule([aged[0]!], { base: 3000, person: atAge(61) }, engine), null);
});

test('a condition over the person is read exactly as written', () => {
	const scale = [
		band('person.employee.marital_status != "MARRIED"', 'base * 7.0 / 100.0', '0.0'),
		band('person.employee.marital_status == "MARRIED"', 'base * 4.0 / 100.0', '0.0')
	];
	const nobody = { base: 3000, person: NOBODY };
	const married = { ...nobody, person: FOREIGNER };
	assert.equal(selectRule(scale, nobody, engine)?.employee, 'base * 7.0 / 100.0');
	assert.equal(selectRule(scale, married, engine)?.employee, 'base * 4.0 / 100.0');
});

test('a person a scheme does not cover charges zero, and a consumer reads zero', () => {
	// Ineligibility is a rule: the condition sits on the rule, not on the scheme.
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
	const flooredBase =
		'(base < minimum_wage(person.company.region) ? minimum_wage(person.company.region) : base)';
	const cappedBase =
		'(base > 20.0 * minimum_wage(person.company.region) ? 20.0 * minimum_wage(person.company.region) : base)';
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
	const chargeable =
		'scheme.year_to_date.base + base * (1.0 + scheme.projection.future_equivalents) - 9000.0';
	const clamp = `(${chargeable} > 0.0 ? ${chargeable} : 0.0)`;
	const tax = `progressive(${clamp}, [0.0, 0.0, 0.0, 5000.0, 0.0, 1.0, 20000.0, 150.0, 3.0])`;
	const difference = `(${tax} - scheme.year_to_date.employee)`;
	const tax_RULES = [
		band(
			'true',
			`truncate_cent(${difference} > 0.0 ? ${difference} / (scheme.projection.payslips_remaining > 1.0 ? scheme.projection.payslips_remaining : 1.0) : 0.0)`,
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

test('the calculation trace keeps each selected line and the reads a charge made', () => {
	// The flow stored on the run is copied from the charge: the lines the formula selected, then
	// the produced reads the rule made. Nothing is recalculated for the reader.
	const fund = schemeOf('FUND', [band('base >= 0.0', '100.0', '0.0')], {
		assessed_on: 'BASE - ABSENCE'
	});
	// TAX is assessed on one payment row and no work line, so only the BONUS line feeds it.
	const tax = schemeOf('TAX', [band('base >= 0.0', 'produced.FUND.employee', '0.0')], {
		assessed_on: "code('BONUS')"
	});
	const priced = (label: string, effect: 'INCLUDE' | 'REDUCE', amount: number) =>
		({
			// A work line the formula admits by reserved line (BASIC by `BASE`, an unpaid day by
			// `ABSENCE`), or a payment row it names with `code`.
			catalogueComponent:
				label === 'BONUS'
					? { code: label, family: 'ALLOWANCE' }
					: { code: label, family: 'WORK', output: label === 'BASIC' ? 'salary' : 'absence' },
			bucket: effect === 'REDUCE' ? 'ABSENCE' : 'EARNING',
			label,
			amount
		}) as never;
	const accumulation = accumulatePayslip({
		items: [
			priced('BASIC', 'INCLUDE', 1000),
			priced('UNPAID_LEAVE', 'REDUCE', 200),
			priced('BONUS', 'INCLUDE', 500)
		]
	});
	const charges = contribute({
		accumulation,
		contributions: [fund, tax],
		facts: new Map(),
		yearToDate: () => ({ employee: 0, employer: 0, base: 0 }),
		yearEarned: new Map(),
		period: PERIOD,
		year: { start: '2026-01-01', end: '2026-12-31', months_employed: 1 },
		projection: { payslipsRemaining: 1, futurePayslipEquivalents: 0 },
		person: NOBODY,
		minimumWage: null
	});
	assert.deepEqual(
		charges[0]!.inputs.map(({ code, effect, amount }) => ({ code, effect, amount })),
		[
			{ code: 'BASIC', effect: 'INCLUDE', amount: 1000 },
			{ code: 'UNPAID_LEAVE', effect: 'REDUCE', amount: 200 }
		]
	);
	assert.deepEqual(
		charges[1]!.inputs.map(({ code, effect, amount }) => ({ code, effect, amount })),
		[{ code: 'BONUS', effect: 'INCLUDE', amount: 500 }]
	);
	assert.deepEqual(charges[1]!.reads, [{ code: 'FUND', employee_amount: 100, employer_amount: 0 }]);
});

test('a directed instalment is added after the ladder and carried apart', () => {
	// Form CP38 names one employee, an amount and a run of months; it is a fact of the employment
	// under its scheme, never a formula's business.
	const pcb = schemeOf('PCB', [band('base >= 0.0', 'round_cent(100.0)', '0.0')]);
	const fact = {
		kind: 'REGISTERED' as const,
		reference_number: 'SG22974731000',
		rate_override: null,
		instalments: [
			{ amount: 1115, from: '2026-01', to: '2026-01', reference: 'direction-1' },
			{ amount: 1114.18, from: '2026-02', to: '2026-02', reference: 'direction-2' }
		]
	};
	const charges = charge([pcb], 3000, {
		facts: new Map([[pcb.row.id, fact]]),
		period: { ...PERIOD, key: '2026-01' }
	});
	assert.equal(charges[0]!.employee, 1215, 'the ladder share plus January direction');
	assert.equal(charges[0]!.directed, 1115);
	assert.equal(charges[0]!.employer, 0);
	// A period no direction covers adds nothing.
	const february = charge([pcb], 3000, {
		facts: new Map([[pcb.row.id, fact]]),
		period: { ...PERIOD, key: '2026-03' }
	});
	assert.equal(february[0]!.employee, 100);
	assert.equal(february[0]!.directed, 0);
});

test('a declared election reads the fact’s value, or the type’s empty value when the fact holds none', () => {
	// PTKP is a string election: a married woman is TK/0 unless her fact says KI. A fact without
	// the election reads '' — never null, never 0 — so a comparison against a code is simply false.
	const tax = schemeOf(
		'TAX',
		[
			band('scheme.elections.ptkp == "KI"', '200.0', '0.0'),
			band('scheme.elections.ptkp == ""', '100.0', '0.0')
		],
		{ elections: [{ key: 'ptkp', type: 'string' }] }
	);
	const registered = { kind: 'REGISTERED' as const, reference_number: 'NPWP', rate_override: null };
	assert.equal(
		charge([tax], 1000, { facts: new Map([[tax.row.id, registered]]) })[0]!.employee,
		100
	);
	assert.equal(
		charge([tax], 1000, {
			facts: new Map([[tax.row.id, { ...registered, elections: { ptkp: 'KI' } }]])
		})[0]!.employee,
		200
	);
	// A boolean election is false until elected; a number is 0.
	const shg = schemeOf('SHG', [band('!scheme.elections.opt_out', 'scheme.elections.rate', '0.0')], {
		elections: [
			{ key: 'opt_out', type: 'boolean' },
			{ key: 'rate', type: 'number' }
		]
	});
	assert.equal(charge([shg], 1000)[0]!.employee, 0);
	assert.equal(
		charge([shg], 1000, {
			facts: new Map([[shg.row.id, { ...registered, elections: { rate: 7 } }]])
		})[0]!.employee,
		7
	);
	assert.deepEqual(
		charge([shg], 1000, {
			facts: new Map([[shg.row.id, { ...registered, elections: { opt_out: true } }]])
		}),
		[]
	);
});

test('a scheme registered since a day reads the day and the completed months on the scheme root', () => {
	const socso = schemeOf('SOCSO', [
		band('scheme.since_months >= 12', '12.0', '0.0'),
		band('scheme.since == ""', '0.0', '0.0'),
		band('true', 'scheme.since_months * 1.0', '0.0')
	]);
	const fact = { kind: 'REGISTERED' as const, reference_number: 'R', rate_override: null };
	assert.equal(charge([socso], 1000)[0]!.employee, 0, 'unrecorded: since is empty');
	assert.equal(
		charge([socso], 1000, {
			facts: new Map([[socso.row.id, { ...fact, since: '2025-12-15' }]])
		})[0]!.employee,
		3,
		'2025-12-15 to 2026-03-31 is three completed months'
	);
	assert.equal(
		charge([socso], 1000, {
			facts: new Map([[socso.row.id, { ...fact, since: '2024-01-01' }]])
		})[0]!.employee,
		12
	);
});

test('a formula may read produced.<code> of a scheme already charged', () => {
	// An employer premium taxed as the employee's income: the base of one scheme reads the charge
	// of another, so the formula is evaluated inside the ordered loop.
	const jkk = schemeOf('JKK', [band('true', '0.0', 'round_cent(base * 1.0 / 100.0)')]);
	const tax = schemeOf('TAX', [band('true', 'round_cent(base * 10.0 / 100.0)', '0.0')], {
		assessed_on: 'BASE + produced.JKK.employer'
	});
	const [, row] = charge([jkk, tax], 1000);
	assert.equal(row!.base, 1010, 'the salary plus the employer premium');
	assert.equal(row!.employee, 101);
});

test('a company-assessed scheme is charged once on the run, and its employee expression must be 0.0', () => {
	const levy = schemeOf('LEVY', [band('true', '0.0', 'round_cent(base * 2.0 / 100.0)')], {
		assessment_scope: 'COMPANY'
	});
	const company = (contributions: readonly ContributionConfig[]) =>
		contributeCompany({
			accumulation: accumulationOf(3000),
			contributions,
			period: PERIOD,
			year: { start: '2026-01-01', end: '2026-12-31', months_employed: 0 },
			person: withHeadcount(5),
			minimumWage: null,
			projection: { payslipsRemaining: 1, futurePayslipEquivalents: 0 }
		});
	assert.deepEqual(
		company([levy]).map((row) => [row.contribution.row.code, row.employee, row.employer]),
		[['LEVY', 0, 60]]
	);
	// The levy is the employer's own; an employee leg on a company scheme is a written mistake.
	const wrong = schemeOf('BAD', [band('true', '1.0', '0.0')], { assessment_scope: 'COMPANY' });
	assert.throws(() => company([wrong]), /employee expression must be 0.0/);
	// The per-employment loop skips COMPANY schemes; they are nobody's payslip.
	assert.deepEqual(charge([levy], 3000), []);
});

test('the company context sums every payslip and reads the entity roots', () => {
	const levy = schemeOf(
		'LEVY',
		[band('true', '0.0', 'round_cent((base + person.company.headcount * 10.0) * 1.0 / 100.0)')],
		{ assessment_scope: 'COMPANY' }
	);
	const charges = contributeCompany({
		accumulation: accumulationOf(3000),
		contributions: [levy],
		period: PERIOD,
		year: { start: '2026-01-01', end: '2026-12-31', months_employed: 0 },
		person: withHeadcount(5),
		minimumWage: null,
		projection: { payslipsRemaining: 1, futurePayslipEquivalents: 0 }
	});
	assert.equal(charges[0]!.employer, 30.5, '1% of the salary fund plus the headcount test');
});

test('a MONTH-assessed scheme charges once, on the month wage, and nothing in the closing period', () => {
	const monthly = schemeOf('MONTHLY', LADDER, { assessment_period: 'MONTH' });
	const opening = charge([monthly], 2000, {
		period: { ...PERIOD, key: '2026-03-1', index: 1, instalments: 2 }
	})[0]!;
	assert.equal(opening.base, 4000, 'the base is grossed to the month');
	assert.equal(opening.employee, 120, '3% of 4,000');
	assert.equal(opening.employer, 160, '4% of 4,000');

	// The closing instalment prices the month on what the opening one settled plus its own, and
	// charges the difference: nothing where the month came out as estimated, the shortfall where
	// the second half earned more (2,000 + 3,000 = 5,000, the top band: 5% and 6% = 250 / 300,
	// less the 120 / 160 the estimate took).
	const opened = {
		accumulation: accumulationOf(2000),
		charged: new Map([['MONTHLY', { employee: 120, employer: 160, base: 4000, ordinary: 0 }]])
	};
	const closing = charge([monthly], 2000, {
		period: { ...PERIOD, key: '2026-03-2', index: 2, instalments: 2 },
		monthPrior: opened
	})[0]!;
	assert.deepEqual([closing.base, closing.employee, closing.employer], [0, 0, 0]);
	const closingMore = charge([monthly], 3000, {
		period: { ...PERIOD, key: '2026-03-2', index: 2, instalments: 2 },
		monthPrior: opened
	})[0]!;
	assert.deepEqual(
		[closingMore.base, closingMore.employee, closingMore.employer],
		[1000, 130, 140]
	);
	// With no settled opening on record (a joiner in the second half) the month is this half:
	// 2,000, the lowest band, 1% and 2%.
	const alone = charge([monthly], 2000, {
		period: { ...PERIOD, key: '2026-03-2', index: 2, instalments: 2 }
	})[0]!;
	assert.deepEqual([alone.base, alone.employee, alone.employer], [2000, 20, 40]);

	const perPeriod = charge([schemeOf('PERIOD', LADDER)], 1000, {
		period: { ...PERIOD, key: '2026-03-1', index: 1, instalments: 2 }
	})[0]!;
	assert.equal(perPeriod.base, 1000);
});
