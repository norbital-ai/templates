import assert from 'node:assert/strict';
import test from 'node:test';
import { assessContributions } from '../src/lib/payroll/contribution.ts';
import { contribute } from '../src/collections/payroll_runs/lib/contribute.ts';
import type { ContributionConfig } from '../src/collections/payroll_runs/lib/configuration.ts';
import { personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';

/** A person with nothing recorded: every scheme and band without a predicate covers them. */
const NOBODY = personContext({
	employee: null,
	employment: { hire_date: '' },
	terms: null,
	asOf: '2026-12-31'
});

type Contract = Parameters<typeof assessContributions>[0][number];

function scheme(
	code: string,
	award: ContributionConfig['rates'][number]['award'],
	specialRules: string[] = []
): ContributionConfig {
	return {
		row: {
			id: code,
			code,
			name: code,
			settings_id: 'settings',
			is_statutory: true,
			authority: 'Invented regression fixture',
			rounding: 'NEAREST_CENT',
			relief_for: [],
			sequence: 1,
			special_rules: specialRules,
			approval_id: null
		},
		rates: [
			{
				id: `${code}-rate`,
				statutory_contribution_id: code,
				selector: { by: 'WAGE', from: 0, to: null },
				award,
				summary: code,
				approval_id: null
			}
		]
	} as ContributionConfig;
}

function contract(
	id: string,
	base: number,
	contributions: readonly ContributionConfig[],
	calculation: Partial<Contract['calculation']> = {}
): Contract {
	return {
		employment: { id, employee_id: 'person', company_id: 'company', employee_number: 'Fixture 1' },
		window: { payFrequency: 'MONTHLY', salary: { start: '2026-12-01', end: '2026-12-31' } },
		calculation: {
			bases: contributions.map((contribution) => ({ contribution, base, special: {} })),
			facts: new Map(),
			yearToDate: () => ({ base: 0, employee: 0, employer: 0 }),
			age: 40,
			headcount: 1,
			riskClass: null,
			projection: { payslipsRemaining: 1, futurePayslipEquivalents: 0 },
			spouseIsDependent: false,
			dependents: 0,
			person: NOBODY,
			minimumWage: null,
			...calculation
		}
	};
}

const fixed = scheme('PUB-FIXED', { kind: 'FIXED', employee: 100.01, employer: 200.03 });

test('two contracts receive one fixed assessment, with deterministic cent allocations and their own bases', () => {
	const contracts = [contract('a', 1000, [fixed]), contract('b', 1000, [fixed])];
	const result = assessContributions(contracts);
	assert.equal(result.get('a')![0]!.employee, 50.01);
	assert.equal(result.get('b')![0]!.employee, 50);
	assert.equal(result.get('a')![0]!.employer, 100.02);
	assert.equal(result.get('b')![0]!.employer, 100.01);
	assert.equal(result.get('a')![0]!.base, 1000);
	assert.equal(result.get('b')![0]!.base, 1000);
	assert.deepEqual(assessContributions(contracts.toReversed()), result);
});

test('a periodic progressive threshold applies to combined contract remuneration', () => {
	const tax = scheme('PUB-PERIOD', { kind: 'PROGRESSIVE', rate: 10, constant: 0 }, [
		'PERIODIC_PROGRESSIVE'
	]);
	const rate = tax.rates[0]!;
	const ladder: ContributionConfig = {
		...tax,
		rates: [
			{
				...rate,
				selector: { by: 'WAGE', from: 0, to: 1000 },
				award: { kind: 'PROGRESSIVE', rate: 0, constant: 0 }
			},
			{ ...rate, id: 'upper', selector: { by: 'WAGE', from: 1000, to: null } }
		]
	};
	const result = assessContributions([contract('a', 750, [ladder]), contract('b', 750, [ladder])]);
	assert.equal(result.get('a')![0]!.employee + result.get('b')![0]!.employee, 50);
	assert.equal(result.get('a')![0]!.bandReference, '1000 – ∞');
});

test('personal relief, a shared relief cap and prior YTD are applied once for the person', () => {
	const tax = scheme('PUB-TAX', { kind: 'PROGRESSIVE', rate: 10, constant: 0 }, [
		'PERSONAL_RELIEF:1200'
	]);
	const relieving = (code: string, employee: number): ContributionConfig => {
		const fund = scheme(code, { kind: 'PERCENT', employee, employer: 0 }, [
			'RELIEF_CAP:100',
			'RELIEF_POOL:shared'
		]);
		return { ...fund, row: { ...fund.row, relief_for: [tax.row.id] } };
	};
	const schemes = [relieving('PUB-FUND-A', 10), relieving('PUB-FUND-B', 5), tax];
	const prior = new Map([['PUB-TAX', { base: 2000, employee: 100, employer: 0 }]]);
	const yearToDate = (code: string) => prior.get(code) ?? { base: 0, employee: 0, employer: 0 };
	const contracts = [
		contract('a', 1000, schemes, { yearToDate }),
		contract('b', 1000, schemes, { yearToDate })
	];
	const result = assessContributions(contracts);
	assert.equal(result.get('a')![2]!.employee + result.get('b')![2]!.employee, 170);
	assert.deepEqual(assessContributions(contracts.toReversed()), result);
	assert.deepEqual(prior.get('PUB-TAX'), { base: 2000, employee: 100, employer: 0 });
});

test('ordinary and additional remuneration retain contract provenance while sharing one assessment', () => {
	const tax = scheme('PUB-TAX', { kind: 'PROGRESSIVE', rate: 10, constant: 0 }, [
		'ADDITIONAL_REMUNERATION'
	]);
	const ordinary = contract('a', 1000, [tax]);
	const additional = contract('b', 0, [tax], {
		bases: [{ contribution: tax, base: 0, special: { ADDITIONAL_REMUNERATION: 1000 } }]
	});
	const result = assessContributions([ordinary, additional]);
	assert.equal(result.get('a')![0]!.employee, 100);
	assert.equal(result.get('b')![0]!.employee, 100);
	assert.deepEqual(result.get('b')![0]!.special, { ADDITIONAL_REMUNERATION: 1000 });
	assert.equal(result.get('b')![0]!.base, 0);
});

test('rounding leftovers never create a negative allocation on a small final contract', () => {
	const tiny = scheme('PUB-TINY', { kind: 'FIXED', employee: 0.02, employer: 0.01 });
	const result = assessContributions(['c', 'b', 'a'].map((id) => contract(id, 1, [tiny])));
	assert.deepEqual(
		[...result.values()].map((charges) => charges[0]!.employee),
		[0.01, 0.01, 0]
	);
	assert.deepEqual(
		[...result.values()].map((charges) => charges[0]!.employer),
		[0.01, 0, 0]
	);
});

test('another entity and another person each retain their own assessment', () => {
	const first = contract('a', 1000, [fixed]);
	const second = contract('b', 1000, [fixed]);
	const third = contract('c', 1000, [fixed]);
	const result = assessContributions([
		first,
		{ ...second, employment: { ...second.employment, company_id: 'other-company' } },
		{ ...third, employment: { ...third.employment, employee_id: 'other-person' } }
	]);
	for (const id of ['a', 'b', 'c']) assert.equal(result.get(id)![0]!.employee, 100.01);
});

test('single-contract calculation is unchanged', () => {
	const only = contract('a', 1234.56, [fixed]);
	assert.deepEqual(assessContributions([only]).get('a'), contribute(only.calculation));
});

for (const status of [
	{ kind: 'NOT_REGISTERED' as const, rate_override: null },
	{ kind: 'REGISTERED' as const, rate_override: 15 }
]) {
	test(`conflicting ${status.kind} or override refuses the whole assessment`, () => {
		assert.throws(
			() =>
				assessContributions([
					contract('a', 1000, [fixed]),
					contract('b', 1000, [fixed], { facts: new Map([[fixed.row.id, status]]) })
				]),
			/conflicting PUB-FIXED registrations or rate overrides/
		);
	});
}

test('an explicit default registration matches an absent registration', () => {
	const result = assessContributions([
		contract('a', 1000, [fixed]),
		contract('b', 1000, [fixed], {
			facts: new Map([[fixed.row.id, { kind: 'REGISTERED', rate_override: null }]])
		})
	]);
	assert.equal(result.get('b')![0]!.employee, 50);
});

test('conflicting intervals and projection cadences refuse instead of selecting one contract', () => {
	const first = contract('a', 1000, [fixed]);
	const second = contract('b', 1000, [fixed]);
	assert.throws(
		() =>
			assessContributions([
				first,
				{
					...second,
					window: {
						payFrequency: 'SEMI_MONTHLY',
						salary: { start: '2026-12-16', end: '2026-12-31' }
					}
				}
			]),
		/conflicting Contribution assessment intervals or cadences/
	);
	assert.throws(
		() =>
			assessContributions([
				first,
				contract('b', 1000, [fixed], {
					projection: { payslipsRemaining: 2, futurePayslipEquivalents: 1 }
				})
			]),
		/conflicting Contribution assessment intervals or cadences/
	);
});
