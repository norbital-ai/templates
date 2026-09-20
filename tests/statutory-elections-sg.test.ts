import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import {
	assessStatutory,
	createStatutoryWorld,
	contributionSchemes,
	COMPANY_ID,
	expectStatutory,
	expectStatutorySkipped,
	type Person
} from './fixtures/statutory-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import { gatherPayrollRun, buildPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import registrations from '../src/collections/employment_statutory_facts/+collection.ts';
import { transformOne } from './helpers/transform.ts';

type Elections = NonNullable<NonNullable<Person['registrations']>[string]['elections']>;

test('SG: saved scheme declarations preserve zero and reach payroll without accepting wrong types', () => {
	const scheme = contributionSchemes('SG').find((row) => row.code === 'CDAC')!;
	const save = (elections: Elections) =>
		transformOne(
			registrations,
			{
				employee_id: 'a0000000-0000-4000-8000-000000000000',
				employment_id: 'e0000000-0000-4000-8000-000000000000',
				statutory_contribution_id: scheme.id,
				status: { kind: 'REGISTERED', elections },
				effective_range: { start: '2025-01-01', end: null }
			},
			undefined,
			{
				statutory_contributions: { findMany: () => Effect.succeed([scheme]) },
				employments: {
					findMany: () =>
						Effect.succeed([
							{
								id: 'e0000000-0000-4000-8000-000000000000',
								employee_id: 'a0000000-0000-4000-8000-000000000000'
							}
						])
				}
			}
		);
	const saved = save({ shg_monthly_amount: 0, shg_instruction_reference: 'FUND-NOTICE' });
	assert.equal(saved.status.elections.shg_monthly_amount, 0);
	const book = assessStatutory({
		code: 'SG',
		period: '2025-12',
		people: [
			{
				key: 'SAVED',
				wage: 3000,
				citizenship: 'CITIZEN',
				race: 'CHINESE',
				registrations: { CDAC: saved.status }
			}
		]
	});
	expectStatutory(book, 'SAVED', 'CDAC', 0, 0);
	assert.throws(() => save({ shg_monthly_amount: '0' }), /number/);
	assert.throws(() => save({ shg_monthly_amount: -1 }), /at least 0/);
	assert.throws(() => save({ shg_unknown: true }), /does not declare|not declared/);
});

test('SG: the PR date is required and must fall between birth and the assessment date', () => {
	for (const residency_since of [undefined, '2026-02-01', '1980-01-01'])
		assert.throws(
			() =>
				assessStatutory({
					code: 'SG',
					period: '2026-01',
					people: [
						{
							key: 'PR-DATE',
							wage: 3000,
							birth_date: '1990-01-01',
							citizenship: 'PERMANENT_RESIDENT',
							residency_since
						}
					]
				}),
			/Record a valid permanent residence date/
		);
	assert.doesNotThrow(() =>
		assessStatutory({
			code: 'SG',
			period: '2026-01',
			people: [
				{
					key: 'NO-WAGES',
					wage: 0,
					citizenship: 'PERMANENT_RESIDENT'
				}
			]
		})
	);
});

// CPF Board, Tables 4 and 5: full employer / graduated employee rates.
// https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf
// https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfcontributionrates.pdf
const versions = [
	{ period: '2025-12', employer: [17, 15.5, 12, 9, 7.5], ceiling: 7400 },
	{ period: '2026-01', employer: [17, 16, 12.5, 9, 7.5], ceiling: 8000 },
	{ period: '2026-04', employer: [17, 16, 12.5, 9, 7.5], ceiling: 8000 },
	{ period: '2027-01', employer: [17, 16.5, 13, 9, 7.5], ceiling: 8000 }
] as const;

function resident(period: string, year: 1 | 2, extra: Partial<Person> = {}): Person {
	return {
		key: 'SPR',
		wage: 3000,
		age: 30,
		citizenship: 'PERMANENT_RESIDENT',
		residency_since: new Date(
			Date.UTC(
				Number(period.slice(0, 4)),
				Number(period.slice(5, 7)) - 1 - (year === 1 ? 6 : 18),
				1
			)
		)
			.toISOString()
			.slice(0, 10),
		registrations: {
			CPF: {
				kind: 'REGISTERED',
				elections: {
					spr_full_employer_rate: true,
					spr_approval_reference: 'CPF-APPROVAL'
				}
			}
		},
		...extra
	};
}

for (const { period, employer, ceiling } of versions) {
	for (const year of [1, 2] as const) {
		test(`SG ${period} SPR year ${year}: full employer rates retain graduated employee shares across age bands`, () => {
			const ages = [30, 57, 62, 67, 72];
			const employee = year === 1 ? [5, 5, 5, 5, 5] : [15, 12.5, 7.5, 5, 5];
			const book = assessStatutory({
				code: 'SG',
				period,
				people: ages.map((age) => resident(period, year, { key: String(age), age }))
			});
			for (const [index, age] of ages.entries())
				expectStatutory(book, String(age), 'CPF', 30 * employee[index]!, 30 * employer[index]!);
		});
		test(`SG ${period} SPR year ${year}: wage boundaries, dollar rounding and OW ceiling`, () => {
			const wages = [50, 50.01, 500, 500.01, 600.01, 750, 750.01, ceiling + 0.01];
			const book = assessStatutory({
				code: 'SG',
				period,
				people: wages.map((wage) => resident(period, year, { key: String(wage), wage }))
			});
			const amounts =
				year === 1
					? [
							[0, 0],
							[0, 9],
							[0, 85],
							[0, 85],
							[15, 102],
							[37, 128],
							[37, 128],
							[ceiling * 0.05, ceiling * 0.17]
						]
					: [
							[0, 0],
							[0, 9],
							[0, 85],
							[0, 85],
							[45, 102],
							[112, 128],
							[112, 128],
							[ceiling * 0.15, ceiling * 0.17]
						];
			for (const [index, wage] of wages.entries())
				expectStatutory(book, String(wage), 'CPF', amounts[index]![0]!, amounts[index]![1]!);
		});
	}
}

test('SG: higher CPF rates require approval evidence and conflicting rate elections are refused', () => {
	for (const elections of [{ spr_full_employer_rate: true }, { spr_full_rate: true }])
		assert.throws(
			() =>
				assessStatutory({
					code: 'SG',
					period: '2026-01',
					people: [
						resident('2026-01', 1, {
							registrations: { CPF: { kind: 'REGISTERED', elections } }
						})
					]
				}),
			/CPF approval reference is required/
		);
	assert.throws(
		() =>
			assessStatutory({
				code: 'SG',
				period: '2026-01',
				people: [
					resident('2026-01', 1, {
						registrations: {
							CPF: {
								kind: 'REGISTERED',
								elections: {
									spr_full_rate: true,
									spr_full_employer_rate: true,
									spr_approval_reference: 'CPF-APPROVAL'
								}
							}
						}
					})
				]
			}),
		/Choose one approved CPF rate option/
	);
});

// CPF Board SHG guidance and the funds' notification/change forms permit a different amount.
// https://www.cpf.gov.sg/employer/employer-obligations/contributions-to-self-help-groups
// https://www.sinda.org.sg/donate/sindafundcontribution/
// https://www.muis.gov.sg/give-back/mbmf/mbmf-forms/
const funds = [
	{ code: 'CDAC', race: 'CHINESE', religion: '', standard: 1 },
	{ code: 'ECF', race: 'EURASIAN', religion: '', standard: 9 },
	{ code: 'MBMF', race: 'MALAY', religion: 'ISLAM', standard: 6.5 },
	{ code: 'SINDA', race: 'INDIAN', religion: '', standard: 7 }
] as const;

for (const { period } of versions)
	for (const fund of funds) {
		test(`SG ${period} ${fund.code}: default, explicit zero, changed amount and opt-out`, () => {
			const cases: { key: string; elections: Elections; expected: number }[] = [
				{ key: 'DEFAULT', elections: {}, expected: fund.standard },
				{
					key: 'ZERO',
					elections: { shg_monthly_amount: 0, shg_instruction_reference: 'FUND-NOTICE' },
					expected: 0
				},
				{
					key: 'REDUCED',
					elections: { shg_monthly_amount: 0.25, shg_instruction_reference: 'FUND-NOTICE' },
					expected: 0.25
				},
				{
					key: 'INCREASED',
					elections: { shg_monthly_amount: 12.34, shg_instruction_reference: 'FUND-NOTICE' },
					expected: 12.34
				},
				{
					key: 'OUT',
					elections: { shg_opt_out: true, shg_instruction_reference: 'FUND-NOTICE' },
					expected: 0
				}
			];
			const book = assessStatutory({
				code: 'SG',
				period,
				people: cases.map((row) => ({
					key: row.key,
					wage: 3000,
					citizenship: 'CITIZEN',
					race: fund.race,
					religion: fund.religion,
					registrations: { [fund.code]: { kind: 'REGISTERED', elections: row.elections } }
				}))
			});
			for (const row of cases) {
				if (row.key === 'OUT') expectStatutorySkipped(book, row.key, fund.code);
				else expectStatutory(book, row.key, fund.code, row.expected, 0);
			}
		});
	}

for (const fund of funds)
	test(`SG ${fund.code}: missing evidence, negative, fractional-cent and conflicting instructions are refused`, () => {
		const invalid: [Elections, RegExp][] = [
			[{ shg_monthly_amount: 0 }, /Fund instruction reference is required/],
			[{ shg_opt_out: true }, /Fund instruction reference is required/],
			[{ shg_monthly_amount: -1, shg_instruction_reference: 'FUND-NOTICE' }, /at least 0/],
			[{ shg_monthly_amount: 1.001, shg_instruction_reference: 'FUND-NOTICE' }, /whole cents/],
			[
				{ shg_monthly_amount: 1, shg_opt_out: true, shg_instruction_reference: 'FUND-NOTICE' },
				/Choose an opt-out or a monthly amount/
			]
		];
		for (const [elections, reason] of invalid)
			assert.throws(
				() =>
					assessStatutory({
						code: 'SG',
						period: '2026-01',
						people: [
							{
								key: 'INVALID',
								wage: 3000,
								citizenship: 'CITIZEN',
								race: fund.race,
								religion: fund.religion,
								registrations: { [fund.code]: { kind: 'REGISTERED', elections } }
							}
						]
					}),
				reason
			);
	});

for (const cutoff of ['FIRST', 'SPLIT', 'LAST'])
	test(`SG ${cutoff}: elected CPF rates and monthly fund amount reconcile across two instalments`, () => {
		const world = createStatutoryWorld({
			code: 'SG',
			period: '2026-01-1',
			payFrequency: 'SEMI_MONTHLY',
			people: [
				resident('2026-01', 1, {
					pay_frequency: 'SEMI_MONTHLY',
					race: 'CHINESE',
					registrations: {
						CPF: {
							kind: 'REGISTERED',
							elections: { spr_full_employer_rate: true, spr_approval_reference: 'CPF-APPROVAL' }
						},
						CDAC: {
							kind: 'REGISTERED',
							elections: { shg_monthly_amount: 3.33, shg_instruction_reference: 'FUND-NOTICE' }
						}
					}
				})
			]
		});
		world.companies[0]!.semi_monthly_statutory_cutoff = cutoff;
		const totals = { employee: 0, employer: 0, fund: 0 };
		for (const period of ['2026-01-1', '2026-01-2']) {
			const prepared = Effect.runSync(
				gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period })
			);
			const built = buildPayrollRun(prepared);
			world.payroll_runs.push({
				id: period,
				company_id: COMPANY_ID,
				period,
				company_charges: built.company_charges
			});
			for (const slip of built.payslip_payroll_run) {
				world.payslips.push({ ...slip, payroll_run_id: period, paid_at: prepared.window.payDate });
				for (const charge of slip.statutory) {
					if (charge.scheme_code === 'CPF') {
						totals.employee += charge.employee_amount;
						totals.employer += charge.employer_amount;
					}
					if (charge.scheme_code === 'CDAC') totals.fund += charge.employee_amount;
				}
			}
		}
		assert.deepEqual(totals, { employee: 150, employer: 510, fund: 3.33 });
	});

for (const fund of funds)
	test(`SG ${fund.code}: a changed amount starts on its recorded effective month`, () => {
		for (const [period, expected] of [
			['2026-01', fund.standard],
			['2026-02', 0.25]
		] as const) {
			const book = assessStatutory(
				{
					code: 'SG',
					period,
					people: [
						{
							key: 'DATED',
							wage: 3000,
							citizenship: 'CITIZEN',
							race: fund.race,
							religion: fund.religion
						}
					]
				},
				(world) => {
					const ids = new Set(
						world.statutory_contributions
							.filter((row) => row.code === fund.code)
							.map((row) => row.id)
					);
					for (const fact of [...world.employment_statutory_facts]) {
						if (!ids.has(fact.statutory_contribution_id) || fact.status.kind !== 'REGISTERED')
							continue;
						fact.effective_range = { start: '2000-01-01', end: '2026-01-31' };
						world.employment_statutory_facts.push({
							...fact,
							id: `${fact.id}-CHANGED`,
							employment_id: world.employments.find(
								(employment) => employment.employee_id === fact.employee_id
							)!.id,
							effective_range: { start: '2026-02-01', end: null },
							status: {
								...fact.status,
								elections: { shg_monthly_amount: 0.25, shg_instruction_reference: 'FUND-FEBRUARY' }
							}
						});
					}
				}
			);
			expectStatutory(book, 'DATED', fund.code, expected, 0);
		}
	});
