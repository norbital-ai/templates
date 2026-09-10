/**
 * Which band a statutory contribution is read on, and what that band then charges.
 *
 * Nothing tested this. `scripts/verify-payroll-arithmetic.mjs` imports `selectBand`, `bandFloor`,
 * `contribute` and `scaleProgressive` and never calls any of them, and the public seed carries two
 * schemes with one open-ended `{ by: 'WAGE', from: 0, to: null }` band apiece — so no seeded
 * scenario has ever had a second tier to choose between. Every decision below is one the source
 * calls out as expensive to get wrong, and each was unguarded:
 *
 *   E3   a wage band is chosen by its **ceiling**, because the published schedules read "wages
 *        exceeding X but not exceeding Y". Keying on the floor moves every SOCSO and EIS figure by
 *        one band, on every payslip in the company.
 *   E24  a wage above every ceiling is an **error**. A ceiling is an open-ended terminal band, not
 *        the absence of one; quietly reusing the last finite band is a wrong-answer generator.
 *   E1   a progressive band's `constant` is the **accumulated** charge on every band below it, not
 *        a flat addend. Read as an addend, a chargeable income of 44,111.40 yields 3,246.68 where
 *        the answer is 1,146.68 — a 175.00 monthly error that grows without bound.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
	bandCeiling,
	bandFloor,
	bandReference,
	selectBand,
	type BandContext
} from '../src/collections/payroll_runs/lib/bands.ts';
import { contribute, scaleProgressive } from '../src/collections/payroll_runs/lib/contribute.ts';
import { personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';
import type {
	ContributionConfig,
	ContributionRate
} from '../src/collections/payroll_runs/lib/configuration.ts';

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

const rate = (
	selector: ContributionRate['selector'],
	award: ContributionRate['award']
): ContributionRate => ({ selector, award }) as ContributionRate;

const wage = (from: number, to: number | null): ContributionRate['selector'] =>
	({ by: 'WAGE', from, to }) as ContributionRate['selector'];

const percent = (employee: number, employer: number): ContributionRate['award'] =>
	({ kind: 'PERCENT', employee, employer }) as ContributionRate['award'];

const context = (base: number, over: Partial<BandContext> = {}): BandContext => ({
	base,
	age: null,
	headcount: 10,
	riskClass: null,
	person: NOBODY,
	...over
});

/** One scheme as `contribute` reads it: a code, its bands, no special rules. */
const schemeOf = (
	code: string,
	rates: readonly ContributionRate[],
	row: Record<string, unknown> = {}
): ContributionConfig =>
	({
		row: {
			id: `id-${code}`,
			code,
			rounding: 'NEAREST_CENT',
			relief_for: [],
			special_rules: [],
			eligibility: '',
			...row
		},
		rates
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
		spouseIsDependent: false,
		dependents: 0,
		person: NOBODY,
		minimumWage: null,
		...over
	});

/** Two closed bands and an open terminal one, in the ascending-ceiling order the engine promises. */
const LADDER = [
	rate(wage(0, 3000), percent(1, 2)),
	rate(wage(3000, 4800), percent(3, 4)),
	rate(wage(4800, null), percent(5, 6))
];

test('a wage exactly on a boundary belongs to the band that ends there, not the one that starts', () => {
	// E3. 4800.00 reads as "exceeding 3000 but not exceeding 4800", which is the middle band.
	assert.equal(bandReference(selectBand(LADDER, context(4800), 'PUB').selector), '3000 – 4800');
	// A cent more crosses into the next one, which is the whole of what the boundary means.
	assert.equal(bandReference(selectBand(LADDER, context(4800.01), 'PUB').selector), '4800 – ∞');
	assert.equal(bandReference(selectBand(LADDER, context(3000), 'PUB').selector), '0 – 3000');
	assert.equal(bandReference(selectBand(LADDER, context(3000.01), 'PUB').selector), '3000 – 4800');
});

test('the band chosen is the one whose award is charged, so a boundary is money', () => {
	assert.deepEqual(selectBand(LADDER, context(4800), 'PUB').award, {
		kind: 'PERCENT',
		employee: 3,
		employer: 4
	});
	assert.deepEqual(selectBand(LADDER, context(4800.01), 'PUB').award, {
		kind: 'PERCENT',
		employee: 5,
		employer: 6
	});
});

test('a wage above every ceiling is refused by name, never folded into the last band', () => {
	// E24. Closed ladder: the schedule states no terminal band, so a wage past it has no answer.
	const closed = [rate(wage(0, 3000), percent(1, 2)), rate(wage(3000, 4800), percent(3, 4))];
	assert.throws(
		() => selectBand(closed, context(5000), 'PUB'),
		/PUB has no band covering a base of 5000: the highest band ends at 4800/
	);
	assert.throws(() => selectBand(closed, context(5000), 'PUB'), /open-ended terminal band/);
});

test('a combination no band admits is refused rather than charged on the nearest one', () => {
	const aged = [
		rate(
			{ by: 'WAGE_AND_AGE', from: 0, to: null, age_from: 0, age_to: 60 } as never,
			percent(11, 13)
		)
	];
	assert.equal(selectBand(aged, context(3000, { age: 45 }), 'PUB').award.employee, 11);
	assert.throws(
		() => selectBand(aged, context(3000, { age: 61 }), 'PUB'),
		/PUB has no band for a base of 3000 at age 61/
	);
	// Age is a filter applied before the wage ceiling, so an unknown age matches no age band at all.
	assert.throws(() => selectBand(aged, context(3000), 'PUB'), /no band for a base of 3000/);
	// The boundary itself, which the two probes above straddle without touching. An age window is
	// half-open — `[age_from, age_to)` — so the year named by `age_to` belongs to the NEXT band. A
	// seeded ladder is written against this rule: Singapore's CPF bands were authored a year high
	// and every probe in the suite sat mid-band, so eleven months of every senior employee's
	// contributions were charged on the ladder below theirs and nothing failed.
	assert.equal(selectBand(aged, context(3000, { age: 0 }), 'PUB').award.employee, 11);
	assert.equal(selectBand(aged, context(3000, { age: 59 }), 'PUB').award.employee, 11);
	assert.throws(
		() => selectBand(aged, context(3000, { age: 60 }), 'PUB'),
		/PUB has no band for a base of 3000 at age 60/,
		'the year named by age_to opens the next band, it does not close this one'
	);
});

test('a band whose predicate does not hold is skipped before the wage ceiling is read', () => {
	// A scale published twice, once per marital category, is two predicate ladders over one wage.
	const scale = [
		{ ...rate(wage(0, null), percent(7, 0)), eligibility: 'employee.marital_status != "MARRIED"' },
		{ ...rate(wage(0, null), percent(4, 0)), eligibility: 'employee.marital_status == "MARRIED"' }
	] as ContributionRate[];
	assert.equal(selectBand(scale, context(3000), 'PUB').award.employee, 7);
	assert.equal(selectBand(scale, context(3000, { person: FOREIGNER }), 'PUB').award.employee, 4);
	// A residency-year ladder: the first year reads one rate, the second another, everyone else none.
	const cpf = [
		{ ...rate(wage(0, null), percent(5, 4)), eligibility: 'employee.residency_months < 12' },
		{
			...rate(wage(0, null), percent(15, 9)),
			eligibility: 'employee.residency_months >= 12 && employee.residency_months < 24'
		},
		{ ...rate(wage(0, null), percent(20, 17)), eligibility: 'employee.residency_months >= 24' }
	] as ContributionRate[];
	assert.equal(selectBand(cpf, context(3000, { person: FOREIGNER }), 'PUB').award.employee, 15);
	// Unrecorded standing is zero months: the first-year ladder, never a later one.
	assert.equal(selectBand(cpf, context(3000), 'PUB').award.employee, 5);
	assert.throws(() => selectBand(cpf.slice(1), context(3000), 'PUB'), /no band for a base of 3000/);
});

test('a scheme the person is outside is skipped whole: no charge, no zero row', () => {
	const fund = schemeOf('FUND', LADDER, { eligibility: 'employee.citizenship != "FOREIGNER"' });
	const levy = schemeOf('LEVY', [rate(wage(0, null), percent(0, 2))]);
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

test('a PROGRESSIVE band with an employer percentage charges it on the whole wage', () => {
	// The employee climbs the ladder; the employer pays a flat share of the full base.
	const graduated = schemeOf(
		'CPF',
		[
			rate(wage(0, 500), { kind: 'PROGRESSIVE', rate: 0, constant: 0, employer: 17 } as never),
			rate(wage(500, 750), { kind: 'PROGRESSIVE', rate: 60, constant: 0, employer: 17 } as never),
			rate(wage(750, null), { kind: 'PROGRESSIVE', rate: 20, constant: 150, employer: 17 } as never)
		],
		{ special_rules: ['PERIODIC_PROGRESSIVE'] }
	);
	const [row] = charge([graduated], 1000);
	assert.equal(row!.employee, 150 + 250 * 0.2);
	assert.equal(row!.employer, 170, '17% of the whole 1,000, not of the slice above 750');
	// Without the member the employer leg stays what it always was: nothing.
	const employeeOnly = schemeOf(
		'TAX',
		[rate(wage(0, null), { kind: 'PROGRESSIVE', rate: 10, constant: 0 } as never)],
		{ special_rules: ['PERIODIC_PROGRESSIVE'] }
	);
	assert.equal(charge([employeeOnly], 1000)[0]!.employer, 0);
});

test("FLOOR:MINIMUM_WAGE and CAP:MINIMUM_WAGE_X bound the base by the region's wage", () => {
	const floored = schemeOf('BPJS', LADDER, { special_rules: ['FLOOR:MINIMUM_WAGE'] });
	const capped = schemeOf('UI', LADDER, { special_rules: ['CAP:MINIMUM_WAGE_X:20'] });
	// Base 1,000 floored to a 2,500 wage: 1% of 2,500; the band is still chosen on the real base.
	assert.equal(charge([floored], 1000, { minimumWage: 2500 })[0]!.employee, 25);
	assert.equal(charge([floored], 4000, { minimumWage: 2500 })[0]!.employee, 120);
	// Base 100,000 capped at 20 × 2,500 = 50,000, on the terminal band's 5%.
	assert.equal(charge([capped], 100_000, { minimumWage: 2500 })[0]!.employee, 2500);
	assert.throws(
		() => charge([floored], 1000, { minimumWage: null }),
		/BPJS bounds its base by the regional minimum wage/
	);
});

test('a band with no selector or no award stops the run rather than paying nothing', () => {
	assert.throws(
		() => selectBand([rate(null, percent(1, 2))], context(100), 'PUB'),
		/PUB rate band has no selector/
	);
	assert.throws(
		() => selectBand([rate(wage(0, null), null)], context(100), 'PUB'),
		/PUB rate band has no award/
	);
});

test('a headcount or risk band accepts any wage, because its dimension already decided', () => {
	assert.equal(
		bandCeiling({ by: 'HEADCOUNT', from: 0, to: 50 } as never),
		Number.POSITIVE_INFINITY
	);
	assert.equal(bandCeiling({ by: 'RISK_CLASS', class: 'A' } as never), Number.POSITIVE_INFINITY);
	assert.equal(bandFloor({ by: 'RISK_CLASS', class: 'A' } as never), 0);
	const byHeadcount = [rate({ by: 'HEADCOUNT', from: 0, to: 5 } as never, percent(1, 1))];
	assert.equal(
		selectBand(byHeadcount, context(999_999, { headcount: 4 }), 'PUB').award.employee,
		1
	);
	assert.throws(
		() => selectBand(byHeadcount, context(1000, { headcount: 5 }), 'PUB'),
		/no band for a base of 1000/
	);
});

/**
 * The cumulative constant, on the exact figure the source names as the expensive one.
 *
 * `constant + (chargeable − band_from) × rate%`. Read as a flat addend the same inputs give
 * 3,246.68, so the assertion below is the difference between two readings of one column.
 */
test('a progressive band charges the accumulated constant plus the marginal slice', () => {
	const contribution = {
		row: { code: 'PUB-TAX' },
		rates: [
			rate(wage(0, 5000), { kind: 'PROGRESSIVE', constant: 0, rate: 1 } as never),
			rate(wage(5000, 20_000), { kind: 'PROGRESSIVE', constant: 50, rate: 3 } as never),
			rate(wage(20_000, null), { kind: 'PROGRESSIVE', constant: 600, rate: 6 } as never)
		]
	} as unknown as ContributionConfig;

	assert.equal(
		scaleProgressive(contribution, 44_111.4, context(0)),
		600 + 24_111.4 * 0.06,
		'the constant is the charge accumulated below the band, not a flat addend'
	);
	assert.notEqual(
		scaleProgressive(contribution, 44_111.4, context(0)),
		44_111.4 * 0.06 + 600,
		'read as an addend this is the 175.00-a-month error decision E1 names'
	);
	// The bottom of a band charges its constant and nothing more; a zero or negative base charges 0.
	assert.equal(scaleProgressive(contribution, 20_000, context(0)), 50 + 15_000 * 0.03);
	assert.equal(scaleProgressive(contribution, 0, context(0)), 0);
	assert.equal(scaleProgressive(contribution, -1, context(0)), 0);
});

test('scaling through a band that is not progressive is refused by name', () => {
	const flat = {
		row: { code: 'PUB-EPF' },
		rates: [rate(wage(0, null), percent(11, 13))]
	} as unknown as ContributionConfig;
	assert.throws(
		() => scaleProgressive(flat, 1000, context(0)),
		/PUB-EPF band 0 – ∞ is not a progressive award/
	);
});
