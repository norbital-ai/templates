import assert from 'node:assert/strict';
import test from 'node:test';
import { assessContributions } from '../src/lib/payroll/contribution.ts';
import { contribute } from '../src/collections/payroll_runs/lib/contribute.ts';
import type { ContributionConfig } from '../src/collections/payroll_runs/lib/configuration.ts';
import { personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';
import { accumulatePayslip } from '../src/collections/payroll_runs/lib/accumulate.ts';

/** A person with nothing recorded: every scheme and rule without a predicate covers them. */
const NOBODY = personContext({
	employee: null,
	employment: { service_start: '' },
	terms: null,
	asOf: '2026-12-31'
});

type Contract = Parameters<typeof assessContributions>[0][number];

/** A payslip whose only money is a salary of `base`. */
const accumulationOf = (base: number) => {
	const accumulated = accumulatePayslip({ items: [] });
	return { ...accumulated, reserved: { ...accumulated.reserved, BASE: base } };
};

test('ordinary wages retain their contract shares when only one contract has additional wages', () => {
	const config = scheme('BASES', [{ when: 'true', employee: 'base * 0.1', employer: '0.0' }]);
	config.row.assessed_on = 'BASE + ENCASHMENT';
	config.row.ordinary_on = 'BASE';
	const own = accumulationOf(1000);
	const result = assessContributions([
		contract('a', 1000, [config], {
			accumulation: { ...own, reserved: { ...own.reserved, ENCASHMENT: 4000 } }
		}),
		contract('b', 3000, [config])
	]);
	assert.deepEqual(
		[...result.values()].map((rows) => [rows[0]!.base, rows[0]!.ordinary]),
		[
			[5000, 1000],
			[3000, 3000]
		]
	);
});
type Band = ContributionConfig['rules'][number];

function scheme(
	code: string,
	bands: readonly Band[],
	pool: {
		readonly employee_share_annual_cap?: number | null;
		readonly shared_cap_group?: string | null;
		readonly project_relief_annually?: boolean;
	} = {}
): ContributionConfig {
	return {
		row: {
			id: code,
			code,
			name: code,
			settings_id: 'settings',
			authority: 'Invented regression fixture',
			assessment_period: 'PAY_PERIOD',
			assessment_scope: 'EMPLOYMENT',
			elections: [],
			employee_share_annual_cap: pool.employee_share_annual_cap ?? null,
			shared_cap_group: pool.shared_cap_group ?? null,
			project_relief_annually: pool.project_relief_annually ?? false,
			rules: [...bands],
			assessed_on: 'BASE'
		},
		rules: bands
	} as unknown as ContributionConfig;
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
			accumulation: accumulationOf(base),
			contributions,
			facts: new Map(),
			yearToDate: () => ({ base: 0, employee: 0, employer: 0 }),
			yearEarned: new Map(),
			period: {
				key: '2026-12',
				start: '2026-12-01',
				end: '2026-12-31',
				index: 1,
				instalments: 1,
				monthlyOn: 'FIRST',
				lastOfYear: true
			},
			year: { start: '2026-01-01', end: '2026-12-31', months_employed: 12 },
			projection: { payslipsRemaining: 1, futurePayslipEquivalents: 0 },
			person: NOBODY,
			minimumWage: null,
			...calculation
		}
	};
}

const fixed = scheme('PUB_FIXED', [
	{ when: 'base >= 0.0', employee: 'round_cent(100.01)', employer: 'round_cent(200.03)' }
]);

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

for (const cutoff of ['FIRST', 'SPLIT'] as const)
	test(`monthly ${cutoff} assessment bases are allocated once across concurrent contracts`, () => {
		const monthly = {
			...fixed,
			row: { ...fixed.row, assessment_period: 'MONTH' as const, ordinary_on: 'BASE' }
		};
		const half = (index: number) => ({
			...contract('a', 0, [monthly]).calculation.period,
			key: `2026-12-${index}`,
			index,
			instalments: 2,
			monthlyOn: cutoff
		});
		const first = assessContributions([
			contract('a', 1000, [monthly], { period: half(1) }),
			contract('b', 2000, [monthly], { period: half(1) })
		]);
		const amounts = [...first.values()].flat();
		const fraction = cutoff === 'SPLIT' ? 0.5 : 1;
		assert.deepEqual(
			amounts.map((row) => row.base),
			[2000 * fraction, 4000 * fraction]
		);
		assert.deepEqual(
			amounts.map((row) => row.ordinary),
			[2000 * fraction, 4000 * fraction]
		);
		const monthPrior = {
			accumulation: accumulationOf(3000),
			charged: new Map([
				[
					monthly.row.code,
					{
						base: amounts.reduce((sum, row) => sum + row.base, 0),
						ordinary: amounts.reduce((sum, row) => sum + row.ordinary!, 0),
						employee: amounts.reduce((sum, row) => sum + row.employee, 0),
						employer: amounts.reduce((sum, row) => sum + row.employer, 0)
					}
				]
			])
		};
		const last = assessContributions([
			contract('a', 1000, [monthly], { period: half(2), monthPrior }),
			contract('b', 2000, [monthly], { period: half(2), monthPrior })
		]);
		for (const [id, expected] of [
			['a', 2000],
			['b', 4000]
		] as const) {
			assert.equal(first.get(id)![0]!.base + last.get(id)![0]!.base, expected);
			assert.equal(first.get(id)![0]!.ordinary! + last.get(id)![0]!.ordinary!, expected);
		}
	});

test('a periodic progressive threshold applies to combined contract remuneration', () => {
	const ladder = scheme('PUB_PERIOD', [
		{ when: 'base <= 1000.0', employee: 'round_cent(0.0)', employer: '0.0' },
		{
			when: 'base > 1000.0',
			employee: 'round_cent(0.0 + (base - 1000.0) * 10.0 / 100.0)',
			employer: '0.0'
		}
	]);
	const result = assessContributions([contract('a', 750, [ladder]), contract('b', 750, [ladder])]);
	assert.equal(result.get('a')![0]!.employee + result.get('b')![0]!.employee, 50);
	assert.equal(result.get('a')![0]!.ruleReference, 'base > 1000.0');
});

test('rebatable payments are recorded once and allocated across the person’s contracts', () => {
	const tax = scheme('PUB_REBATE', [
		{ when: 'true', employee: '0.0', employer: '0.0', rebate: '100.01' }
	]);
	const result = assessContributions([contract('a', 1000, [tax]), contract('b', 1000, [tax])]);
	assert.deepEqual(
		[...result.values()].map((charges) => charges[0]!.rebate),
		[50.01, 50]
	);
	const invalid = scheme('PUB_REBATE', [
		{ when: 'true', employee: '0.0', employer: '0.0', rebate: '-1.0' }
	]);
	assert.throws(
		() => assessContributions([contract('a', 1000, [invalid])]),
		/rebatable payments must be finite and nonnegative/
	);
});

test('deduction declarations apply once per person and conflicting contract histories refuse', () => {
	const tax = scheme('PUB_TAX', [
		{
			when: 'true',
			deduction: 'scheme.deductions.EDUCATION',
			employee: 'base - scheme.deduction',
			employer: '0.0'
		}
	]);
	const status = {
		kind: 'REGISTERED' as const,
		reference_number: 'R',
		rate_override: null,
		deduction_claims: [
			{
				period: '2026-12',
				category: 'EDUCATION',
				amount: 150,
				source: 'EMPLOYEE' as const,
				reference: 'Synthetic TP1'
			}
		]
	};
	const facts = new Map([['PUB_TAX', status]]);
	const result = assessContributions([
		contract('a', 1000, [tax], { facts }),
		contract('b', 1000, [tax], { facts })
	]);
	assert.equal(result.get('a')![0]!.employee + result.get('b')![0]!.employee, 1850);
	assert.throws(
		() =>
			assessContributions([
				contract('a', 1000, [tax], { facts }),
				contract('b', 1000, [tax], {
					facts: new Map([['PUB_TAX', { ...status, deduction_claims: [] }]])
				})
			]),
		/conflicting.*registrations/
	);
});

test('personal relief, a shared relief cap and prior YTD are applied once for the person', () => {
	const chargeable =
		'(scheme.year_to_date.base + base * (1.0 + scheme.projection.future_equivalents) - produced.PUB_FUND_A.employee - produced.PUB_FUND_B.employee - 1200.0)';
	const clamped = `(${chargeable} > 0.0 ? ${chargeable} : 0.0)`;
	const scaled = `progressive(${clamped}, [0.0, 0.0, 10.0])`;
	const tax = scheme('PUB_TAX', [
		{
			when: 'true',
			employee: `round_cent((${scaled} - scheme.year_to_date.employee > 0.0 ? (${scaled} - scheme.year_to_date.employee) / (scheme.projection.payslips_remaining > 1.0 ? scheme.projection.payslips_remaining : 1.0) : 0.0))`,
			employer: '0.0'
		}
	]);
	const relieving = (code: string, employee: number): ContributionConfig =>
		scheme(
			code,
			[
				{
					when: 'base >= 0.0',
					employee: `round_cent(base * ${employee}.0 / 100.0)`,
					employer: '0.0'
				}
			],
			{ employee_share_annual_cap: 100, shared_cap_group: 'shared' }
		);
	const schemes = [relieving('PUB_FUND_A', 10), relieving('PUB_FUND_B', 5), tax];
	const prior = new Map([['PUB_TAX', { base: 2000, employee: 100, employer: 0 }]]);
	const yearToDate = (code: string) => prior.get(code) ?? { base: 0, employee: 0, employer: 0 };
	const contracts = [
		contract('a', 1000, schemes, { yearToDate }),
		contract('b', 1000, schemes, { yearToDate })
	];
	const result = assessContributions(contracts);
	assert.equal(result.get('a')![2]!.employee + result.get('b')![2]!.employee, 170);
	assert.deepEqual(assessContributions(contracts.toReversed()), result);
	assert.deepEqual(prior.get('PUB_TAX'), { base: 2000, employee: 100, employer: 0 });
});

test('rounding leftovers never create a negative allocation on a small final contract', () => {
	const tiny = scheme('PUB_TINY', [
		{ when: 'base >= 0.0', employee: 'round_cent(0.02)', employer: 'round_cent(0.01)' }
	]);
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

test('conflicting first-liability dates cannot be merged across concurrent contracts', () => {
	const fact = { kind: 'REGISTERED' as const, reference_number: 'R', rate_override: null };
	assert.throws(
		() =>
			assessContributions([
				contract('a', 1000, [fixed], {
					facts: new Map([[fixed.row.id, { ...fact, first_contribution_due_on: '2010-01-01' }]])
				}),
				contract('b', 1000, [fixed], {
					facts: new Map([[fixed.row.id, { ...fact, first_contribution_due_on: '2020-01-01' }]])
				})
			]),
		/conflicting.*registrations/
	);
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
			/conflicting PUB_FIXED registrations or rate overrides/
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

test('OVERTIME_PREMIUM is the part of every overtime line above the ordinary hour', () => {
	// Two hours at 1.5× on a 10.00 hour: the line is 30.00, the wage inside it 20.00, the premium
	// 10.00 — the quantity a regime exempts where it exempts the premium and not the wage.
	const work = (label: string, amount: number, quantity: number | null) => ({
		catalogueComponent: {
			id: label,
			settings_id: 's',
			code: 'OVERTIME',
			family: 'WORK' as const,
			output: 'overtime',
			destination: 'PAY' as const,
			direction: 'ADD' as const
		},
		bucket: 'EARNING' as const,
		label,
		amount,
		quantity
	});
	const accumulated = accumulatePayslip({
		items: [work('OT-1.5X', 30, 2), work('OT-2.0X', 40, 2)],
		ordinaryHour: 10
	});
	assert.equal(accumulated.reserved.OVERTIME, 70);
	assert.equal(accumulated.reserved.OVERTIME_PREMIUM, 30);
	assert.equal(
		accumulatePayslip({ items: [work('OT-1.5X', 30, 2)] }).reserved.OVERTIME_PREMIUM,
		30
	);
});
