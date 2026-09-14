/**
 * Which band a statutory contribution is read on, and what that band then charges.
 *
 * The engine's bands are expressions now (RFC 0001 §8): the first band whose `when` holds governs,
 * and the band's `employee`/`employer` expressions produce the money. Every decision below is one
 * the source calls out as expensive to get wrong:
 *
 *   E3   a wage band is chosen by its **ceiling**, because the published schedules read "wages
 *        exceeding X but not exceeding Y". A seeded rung is inclusive at its top (`base <= 4800.0`)
 *        and exclusive at its floor (`base > 3000.0`), so a wage exactly on a boundary belongs to
 *        the band that ends there.
 *   E24  a wage no band matches is an **error**. A terminal rung is an open-ended condition
 *        (`base > 4800.0`); reusing the last finite rung is a wrong-answer generator.
 *   E1   a progressive band's `constant` is the **accumulated** charge on every band below it, not
 *        a flat addend. Read as an addend, a chargeable income of 44,111.40 yields 3,246.68 where
 *        the answer is 1,146.68 — a 175.00 monthly error that grows without bound.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { selectBand } from '../src/collections/payroll_runs/lib/bands.ts';
import { contribute, scaleProgressive } from '../src/collections/payroll_runs/lib/contribute.ts';
import { personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';
import { runtimeExpressionEngine } from '../src/lib/expressions/evaluate.ts';
import type { ContributionConfig } from '../src/collections/payroll_runs/lib/configuration.ts';
import type { StatutoryRules } from '../src/datatypes/statutory_rules/+definition.ts';

const engine = runtimeExpressionEngine({ minimumWage: (region) => (region === 'I' ? 2500 : 0) });

/** A person with nothing recorded, and one with a standing a predicate can read. */
const NOBODY = personContext({
	employee: null,
	employment: { hire_date: '' },
	terms: null,
	asOf: '2026-03-31'
});
const FOREIGNER = personContext({
	employee: { marital_status: 'MARRIED' },
	employment: { hire_date: '2024-01-01' },
	terms: { residency_status: 'FOREIGNER', residency_since: '2025-02-15' },
	company: { region: 'I' },
	asOf: '2026-03-31'
});
const FAMILY = personContext({
	employee: { dependents_count: 4, spouse_status: 'NONE' },
	employment: { hire_date: '2024-01-01' },
	terms: null,
	asOf: '2026-03-31'
});
const SINGLE = personContext({
	employee: { dependents_count: 0, spouse_status: 'NONE' },
	employment: { hire_date: '2024-01-01' },
	terms: null,
	asOf: '2026-03-31'
});

type Band = ContributionConfig['rates'][number];
const band = (when: string, employee: string, employer: string): Band => ({
	when,
	employee,
	employer
});
const percent = (when: string, employee: number, employer: number): Band =>
	band(when, `base * ${employee}.0 / 100.0`, `base * ${employer}.0 / 100.0`);

/** Two closed bands and an open terminal one, in the declaration order the engine reads. */
const LADDER = [
	percent('base <= 3000.0', 1, 2),
	percent('base > 3000.0 && base <= 4800.0', 3, 4),
	percent('base > 4800.0', 5, 6)
];

const DEFAULT_RULES: StatutoryRules = {
	relief: '',
	base_transform: '',
	share_for_dependants: '',
	rounding: ['NEAREST_CENT'],
	no_withholding_below: 0,
	use_period_table: true,
	additional_remuneration_channel: false,
	employee_share_annual_cap: null,
	shared_cap_group: null,
	project_relief_annually: false,
	total_rounded_employee_floored: false
};

/** One scheme as `contribute` reads it: a code, its bands, and the rules that wrap them. */
const schemeOf = (
	code: string,
	rates: readonly Band[],
	rules: Partial<StatutoryRules> = {}
): ContributionConfig =>
	({
		row: {
			id: `id-${code}`,
			code,
			assessment_period: 'PAY_PERIOD',
			eligibility: '',
			rules: { ...DEFAULT_RULES, ...rules },
			bands: rates
		},
		rates,
		relievedIds: []
	}) as unknown as ContributionConfig;

const charge = (
	schemes: readonly ContributionConfig[],
	base: number,
	over: Partial<Parameters<typeof contribute>[0]> = {}
) =>
	contribute({
		bases: schemes.map((contribution) => ({ contribution, base, special: {} })),
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
	assert.equal(
		selectBand(LADDER, { base: 4800 }, engine, 'PUB').when,
		'base > 3000.0 && base <= 4800.0'
	);
	// A cent more crosses into the next one, which is the whole of what the boundary means.
	assert.equal(selectBand(LADDER, { base: 4800.01 }, engine, 'PUB').when, 'base > 4800.0');
	assert.equal(selectBand(LADDER, { base: 3000 }, engine, 'PUB').when, 'base <= 3000.0');
	assert.equal(
		selectBand(LADDER, { base: 3000.01 }, engine, 'PUB').when,
		'base > 3000.0 && base <= 4800.0'
	);
});

test('the band chosen is the one whose money is charged, so a boundary is money', () => {
	assert.deepEqual(selectBand(LADDER, { base: 4800 }, engine, 'PUB'), {
		when: 'base > 3000.0 && base <= 4800.0',
		employee: 'base * 3.0 / 100.0',
		employer: 'base * 4.0 / 100.0'
	});
	assert.equal(charge([schemeOf('PUB', LADDER)], 4800)[0]!.employee, 144);
	assert.equal(
		charge([schemeOf('PUB', LADDER)], 4800.01)[0]!.employee,
		240,
		'5% of 4,800.01, to the cent'
	);
});

test('a wage no band matches is refused by name, never folded into the last band', () => {
	// E24. A closed ladder states no terminal rung, so a wage past it has no answer.
	const closed = [
		percent('base <= 3000.0', 1, 2),
		percent('base > 3000.0 && base <= 4800.0', 3, 4)
	];
	assert.throws(
		() => selectBand(closed, { base: 5000 }, engine, 'PUB'),
		/PUB has no band whose condition holds for a base of 5000/
	);
	assert.throws(() => selectBand([], { base: 5000 }, engine, 'PUB'), /no band whose condition/);
});

test('an age condition filters before the wage, and the year named by `age_to` opens the next band', () => {
	const aged = [
		band('base >= 0.0 && age >= 0.0 && age < 60.0', 'base * 11.0 / 100.0', 'base * 13.0 / 100.0'),
		band('base >= 0.0 && age >= 60.0', 'base * 6.5 / 100.0', 'base * 8.0 / 100.0')
	];
	assert.equal(
		selectBand(aged, { base: 3000, age: 45 }, engine, 'PUB').employee,
		'base * 11.0 / 100.0'
	);
	assert.equal(
		selectBand(aged, { base: 3000, age: 0 }, engine, 'PUB').employee,
		'base * 11.0 / 100.0'
	);
	assert.equal(
		selectBand(aged, { base: 3000, age: 59 }, engine, 'PUB').employee,
		'base * 11.0 / 100.0'
	);
	assert.equal(
		selectBand(aged, { base: 3000, age: 60 }, engine, 'PUB').employee,
		'base * 6.5 / 100.0'
	);
	// The window is half-open — `[age_from, age_to)` — so a one-band ladder refuses the year above it.
	const only = [aged[0]!];
	assert.throws(
		() => selectBand(only, { base: 3000, age: 61 }, engine, 'PUB'),
		/no band whose condition/
	);
});

test('a condition over the person is read exactly as written', () => {
	// A scale published twice, once per marital category, is two conditions over one wage.
	const scale = [
		band('person.employee.marital_status != "MARRIED"', 'base * 7.0 / 100.0', '0.0'),
		band('person.employee.marital_status == "MARRIED"', 'base * 4.0 / 100.0', '0.0')
	];
	const nobody = { base: 3000, person: NOBODY, age: 40, headcount: 1, risk_class: '' };
	const married = { ...nobody, person: FOREIGNER };
	assert.equal(selectBand(scale, nobody, engine, 'PUB').employee, 'base * 7.0 / 100.0');
	assert.equal(selectBand(scale, married, engine, 'PUB').employee, 'base * 4.0 / 100.0');
	// A residency ladder: the first year reads one rate, the second another.
	const cpf = [
		band('person.employee.residency_months < 12.0', 'base * 5.0 / 100.0', '0.0'),
		band(
			'person.employee.residency_months >= 12.0 && person.employee.residency_months < 24.0',
			'base * 15.0 / 100.0',
			'0.0'
		)
	];
	assert.equal(selectBand(cpf, married, engine, 'PUB').employee, 'base * 15.0 / 100.0');
	assert.throws(() => selectBand(cpf.slice(1), nobody, engine, 'PUB'), /no band whose condition/);
});

test('a scheme the person is outside is skipped whole: no charge, no zero row', () => {
	const fund = schemeOf('FUND', LADDER, {
		// The scheme's own eligibility stays a person predicate, unprefixed.
		...DEFAULT_RULES
	});
	fund.row.eligibility = 'employee.citizenship != "FOREIGNER"';
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
	const graduated = schemeOf(
		'CPF',
		[
			band('base <= 500.0', '0.0', 'base * 17.0 / 100.0'),
			band(
				'base > 500.0 && base <= 750.0',
				'0.0 + (base - 500.0) * 60.0 / 100.0',
				'base * 17.0 / 100.0'
			),
			band('base > 750.0', '150.0 + (base - 750.0) * 20.0 / 100.0', 'base * 17.0 / 100.0')
		],
		{ use_period_table: true }
	);
	const [row] = charge([graduated], 1000);
	assert.equal(row!.employee, 150 + 250 * 0.2);
	assert.equal(row!.employer, 170, '17% of the whole 1,000, not of the slice above 750');
	// Without an employer leg the scheme charges the employee only.
	const employeeOnly = schemeOf('TAX', [band('base >= 0.0', 'base * 10.0 / 100.0', '0.0')]);
	assert.equal(charge([employeeOnly], 1000)[0]!.employer, 0);
});

test('minimum-wage floors and caps bound the base, and an unstated wage stops the run', () => {
	const floored = schemeOf('BPJS', LADDER, {
		base_transform: '(base < minimum_wage(region) ? minimum_wage(region) : base)'
	});
	const capped = schemeOf('UI', LADDER, {
		base_transform: '(base > 20.0 * minimum_wage(region) ? 20.0 * minimum_wage(region) : base)'
	});
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
	const excess = `(${household} - 1.0 - 0.0)`;
	const heads = `(1.0 + (${excess} > 0.0 ? (${excess} < 3.0 ? ${excess} : 3.0) : 0.0))`;
	const nhi = schemeOf('NHI', [percent('base >= 0.0', 5, 0)], {
		// One head for the person, one per dependant past the covered count, capped at three.
		share_for_dependants: `${heads} * share`
	});
	const single = charge([nhi], 1000, { person: SINGLE })[0]!;
	assert.equal(single.employee, 50, 'one head at 5%');
	const family = charge([nhi], 1000, { person: FAMILY })[0]!;
	assert.equal(family.employee, 200, 'four heads at 5%, billed per head');
});

test('a paired-share scheme rounds the total, floors the employee and gives the remainder away', () => {
	const cpf = schemeOf('CPF', [band('base >= 0.0', '12.0', '12.5')], {
		rounding: [],
		total_rounded_employee_floored: true
	});
	const [row] = charge([cpf], 1000);
	assert.equal(row!.employee, 12, 'floored to the dollar');
	assert.equal(row!.employer, 13, 'the remainder of the rounded 24.5 total');
});

test('a progressive scale charges the accumulated constant plus the marginal slice', () => {
	const contribution = schemeOf('PUB-TAX', [
		band('base <= 5000.0', '0.0 + base * 1.0 / 100.0', '0.0'),
		band('base > 5000.0 && base <= 20000.0', '50.0 + (base - 5000.0) * 3.0 / 100.0', '0.0'),
		band('base > 20000.0', '600.0 + (base - 20000.0) * 6.0 / 100.0', '0.0')
	]);

	assert.equal(
		scaleProgressive(contribution, 44_111.4, { base: 0 }, engine),
		600 + ((44_111.4 - 20_000) * 6) / 100,
		'the constant is the charge accumulated below the band, not a flat addend'
	);
	assert.notEqual(
		Math.round(scaleProgressive(contribution, 44_111.4, { base: 0 }, engine) * 100) / 100,
		Math.round((44_111.4 * 0.06 + 600) * 100) / 100,
		'read as an addend this is the 175.00-a-month error decision E1 names'
	);
	assert.equal(scaleProgressive(contribution, 20_000, { base: 0 }, engine), 50 + 15_000 * 0.03);
	assert.equal(scaleProgressive(contribution, 0, { base: 0 }, engine), 0);
	assert.equal(scaleProgressive(contribution, -1, { base: 0 }, engine), 0);
});

test('an annual scale projects, relieves, scales and spreads; a period table does not', () => {
	const tax = schemeOf(
		'TAX',
		[
			band('base <= 5000.0', '0.0', '0.0'),
			band('base > 5000.0 && base <= 20000.0', '0.0 + (base - 5000.0) * 1.0 / 100.0', '0.0'),
			band('base > 20000.0', '150.0 + (base - 20000.0) * 3.0 / 100.0', '0.0')
		],
		{ use_period_table: false, relief: '9000.0', rounding: ['TRUNCATE_CENT'] }
	);
	// A January monthly payslip: annual gross 48,000 (4,000 × 12) less 9,000 relief = 39,000.
	// The annual tax is 150 + 19,000 × 3% = 720, spread over the twelve payslips of the year.
	const [row] = charge([tax], 4000, {
		projection: { payslipsRemaining: 12, futurePayslipEquivalents: 11 }
	});
	assert.equal(row!.employee, 60);

	// The same scheme as a period table charges the period's own figure and spreads nothing.
	const periodTable = schemeOf('PT', tax.rates, { use_period_table: true, relief: '9000.0' });
	const [direct] = charge([periodTable], 4000, {
		projection: { payslipsRemaining: 12, futurePayslipEquivalents: 11 }
	});
	assert.equal(direct!.employee, 0, '4,000 is below the 5,000 floor: nothing is withheld');
});

test('a MONTH-assessed scheme charges once, on the month wage, and nothing in the closing period', () => {
	// A monthly schedule at a semi-monthly company: the first period carries the month's charge on
	// the month's wage (2 × the half), the closing period carries none.
	const monthly = schemeOf('MONTHLY', LADDER);
	monthly.row.assessment_period = 'MONTH';
	const opening = charge([monthly], 2000, {
		assessment: { periodsPerMonth: 2, periodIndex: 1 }
	})[0]!;
	assert.equal(opening.base, 4000, 'the base is grossed to the month');
	assert.equal(opening.employee, 120, '3% of 4,000');
	assert.equal(opening.employer, 160, '4% of 4,000');

	const closing = charge([monthly], 2000, {
		assessment: { periodsPerMonth: 2, periodIndex: 2 }
	})[0]!;
	assert.equal(closing.base, 0, 'the closing period charges nothing');
	assert.equal(closing.employee, 0);
	assert.equal(closing.employer, 0);

	const perPeriod = charge([schemeOf('PERIOD', LADDER)], 1000, {
		assessment: { periodsPerMonth: 2, periodIndex: 1 }
	})[0]!;
	assert.equal(perPeriod.base, 1000);
});
