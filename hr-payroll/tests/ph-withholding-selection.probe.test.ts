import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readLawFile } from './fixtures/law-file.ts';
import { governed, isInForceCandidate, settingsInForce } from '../src/lib/jurisdiction_settings.ts';
import { contribute, selectRule } from '../src/lib/payroll/run/contribute.ts';
import { accumulatePayslip } from '../src/lib/payroll/run/accumulate.ts';
import { personContext } from '../src/lib/payroll/run/eligibility.ts';
import { cumulativeHistory } from '../src/lib/payroll/statutory-history.ts';
import { evaluateNumber, runtimeExpressionEngine } from '../src/lib/expressions/evaluate.ts';

type ContributionInput = Parameters<typeof contribute>[0];
type Scheme = ContributionInput['contributions'][number]['row'];
type Setting = Parameters<typeof settingsInForce>[0][number] & {
	readonly cloned_from_id: string | null;
	readonly change_summary: string;
	readonly work_rules: { readonly wages: { readonly by_region: Readonly<Record<string, number>> } };
};
const law = (name: string) =>
	readLawFile(fileURLToPath(new URL(`../seed/jurisdiction/PH/${name}`, import.meta.url)));
const settings = law('jurisdiction_settings') as Setting[];
const schemes = law('statutory_contributions') as Scheme[];
const active = settings.filter(isInForceCandidate);
const zero = () => ({
	base: 0,
	ordinary: 0,
	employee: 0,
	employer: 0,
	periods: 0,
	triggered: false,
	hasOpening: false,
	periodsRecorded: true
});

// BIR RR 11-2018 s.2.79(B)(3),(5)(a); Annex E, effective 2023 onward.
// Expected values are independent amounts. January's amount alone cannot establish the method:
// cumulative and ordinary withholding coincide in that first-period control.
const monthlyCases = [
	{
		name: 'overtime starts cumulative averaging',
		month: 7,
		basic: 20000,
		overtime: 10000,
		bonus: 0,
		expected: 0,
		cumulative: true
	},
	{
		name: 'night differential starts cumulative averaging',
		month: 7,
		basic: 20000,
		overtime: 0,
		night: 10000,
		bonus: 0,
		expected: 0,
		cumulative: true
	},
	{
		name: 'taxable sick-leave cash-out starts cumulative averaging',
		month: 7,
		basic: 20000,
		overtime: 0,
		encashment: 10000,
		bonus: 0,
		expected: 0,
		cumulative: true
	},
	{
		name: 'regular pay is tested after mandatory deductions',
		month: 7,
		basic: 22000,
		overtime: 0,
		bonus: 91000,
		expected: 0,
		cumulative: true
	},
	{
		name: 'supplement uses the regular-pay bracket',
		month: 7,
		basic: 30000,
		overtime: 0,
		bonus: 110000,
		expected: 4007.55,
		cumulative: false
	},
	{
		name: 'exempt maternity pay cannot raise the regular bracket',
		month: 7,
		basic: 50000,
		maternity: 20000,
		overtime: 0,
		bonus: 110000,
		expected: 3895.05,
		cumulative: false
	},
	{
		name: 'first-period overtime amount control',
		month: 1,
		basic: 20000,
		overtime: 10000,
		bonus: 0,
		expected: 1045.05,
		cumulative: true
	},
	{
		name: 'no-supplement control',
		month: 7,
		basic: 20000,
		overtime: 0,
		bonus: 0,
		expected: 0,
		cumulative: false
	}
];

for (const scenario of monthlyCases)
	test(`PH withholding selection: ${scenario.name}`, () => {
		const month = String(scenario.month).padStart(2, '0');
		const start = `2026-${month}-01`,
			end = `2026-${month}-31`,
			key = `2026-${month}`;
		const setting = settingsInForce(settings, 'PH', start);
		assert(setting);
		const contributions = ['SSS', 'SSS_MPF', 'PHIC', 'HDMF', 'WTAX'].map((code) => {
			const stored = schemes.find((row) => row.settings_id === setting.id && row.code === code);
			assert(stored);
			const row = {
				...stored,
				elections: stored.elections ?? [],
				assessment_scope: stored.assessment_scope ?? 'EMPLOYMENT'
			};
			return { row, rules: row.rules };
		});
		const prior: Parameters<typeof cumulativeHistory>[0]['periods'] = Array.from(
			{ length: scenario.month - 1 },
			(_, index) => ({
				period: `2026-${String(index + 1).padStart(2, '0')}`,
				frequency: 'MONTHLY',
				charges: {
					WTAX: {
						base: scenario.basic,
						ordinary: scenario.basic,
						employee: scenario.basic === 50000 ? 4568.4 : scenario.basic === 30000 ? 1007.55 : 0,
						employer: 0
					},
					SSS: { base: scenario.basic, ordinary: null, employee: 1000, employer: 2000 },
					SSS_MPF: {
						base: scenario.basic,
						ordinary: null,
						employee: Math.min(750, Math.max(0, scenario.basic * 0.05 - 1000)),
						employer: Math.min(1500, Math.max(0, scenario.basic * 0.1 - 2000))
					},
					PHIC: {
						base: scenario.basic,
						ordinary: null,
						employee: scenario.basic * 0.025,
						employer: scenario.basic * 0.025
					},
					HDMF: { base: scenario.basic, ordinary: null, employee: 200, employer: 200 }
				}
			})
		);
		const trigger = contributions.find((entry) => entry.row.code === 'WTAX')!.row.history_trigger;
		assert(trigger);
		const history = cumulativeHistory({
			periods: prior,
			openings: new Map(),
			frequency: 'MONTHLY',
			requirePeriodsFor: new Set(['WTAX', 'SSS', 'SSS_MPF', 'PHIC', 'HDMF']),
			triggers: new Map([['WTAX', trigger]])
		});
		const person = personContext({
			employee: { date_of_birth: '1990-01-01' },
			employment: { service_start: '2026-01-01' },
			terms: {
				employment_type: 'PERMANENT',
				residency_status: 'CITIZEN',
				tax_residency: 'RESIDENT',
				pay_frequency: 'MONTHLY',
				base_salary: scenario.basic
			},
			week: { ordinary_hours_per_week: 48, working_days_per_week: 6 },
			company: { region: 'NCR' },
			period: { leave_pay: { MATERNITY_LEAVE: scenario.maternity ?? 0 } },
			wageFloor: setting.work_rules.wages.by_region.NCR,
			asOf: end
		});
		assert.equal(person.terms.monthly_basic, scenario.basic);
		const item = (
			code: string,
			amount: number,
			family: 'WORK' | 'ADHOC' | 'LEAVE',
			output: string | undefined,
			counts: string[] = []
		): Parameters<typeof accumulatePayslip>[0]['items'][number] => ({
			catalogueComponent: {
				id: `synthetic-${code}`,
				settings_id: setting.id,
				code,
				family,
				output,
				counts_toward: counts,
				destination: 'PAY',
				direction: 'ADD',
				bands: [],
				eligibility: ''
			},
			label: code,
			bucket: 'EARNING',
			amount
		});
		const charges = contribute({
			accumulation: accumulatePayslip({
				items: [
					item('BASIC', scenario.basic, 'WORK', 'salary'),
					item('OVERTIME', scenario.overtime, 'WORK', 'overtime'),
					item('NIGHT', scenario.night ?? 0, 'WORK', 'night'),
					item('SICK_LEAVE', scenario.encashment ?? 0, 'LEAVE', undefined),
					item('bonus', scenario.bonus, 'ADHOC', undefined, ['WTAX.SPECIAL'])
				]
			}),
			contributions,
			facts: new Map(
				contributions.map(({ row }) => [
					row.id,
					{ kind: 'REGISTERED', reference_number: 'SYNTHETIC', since: '2026-01-01', elections: {} }
				])
			),
			yearToDate: (code) => history.get(code) ?? zero(),
			yearEarned: new Map([['BASIC', scenario.basic * (scenario.month - 1)]]),
			history: (code) => history.get(code) ?? zero(),
			period: {
				key,
				start,
				end,
				index: 1,
				instalments: 1,
				lastOfYear: false,
				monthlyOn: 'LAST',
				monthFactor: 1,
				daysEmployed: 31,
				daysInMonth: 31
			},
			currency: 'PHP',
			year: { start: '2026-01-01', end: '2026-12-31', months_employed: scenario.month },
			projection: {
				payslipsRemaining: 13 - scenario.month,
				futurePayslipEquivalents: 12 - scenario.month
			},
			person,
			minimumWage: setting.work_rules.wages.by_region.NCR
		});
		const tax = charges.find((charge) => charge.contribution.row.code === 'WTAX');
		assert(tax);
		assert.equal(tax.employee, scenario.expected);
		assert.equal(tax.ordinary, scenario.basic - (scenario.maternity ?? 0));
		assert.equal(tax.ruleReference?.includes('history.WTAX'), scenario.cumulative);
	});

test('PH replacement snapshots govern both ends of every corrected interval', () => {
	// A replacement replaces a voided snapshot; a later law change inside its interval (RIX-DW-06 on
	// 20 May 2026) is a successor cloned from the replacement, which carries the rest of it.
	const replacements = active.filter(
		(row) =>
			row.change_summary?.includes('R45') &&
			!active.some((other) => other.id === row.cloned_from_id)
	);
	assert.equal(replacements.length, 6);
	for (const replacement of replacements) {
		const original = settings.find((row) => row.id === replacement.cloned_from_id);
		assert(original);
		assert(original.voided_at);
		const chain = [replacement];
		for (let next; (next = active.find((row) => row.cloned_from_id === chain.at(-1)!.id));)
			chain.push(next);
		assert.deepEqual(
			{ start: chain[0]!.effective_range.start, end: chain.at(-1)!.effective_range.end },
			original.effective_range
		);
		for (const version of chain) {
			const range = governed(version.effective_range);
			assert(range);
			assert.equal(settingsInForce(settings, 'PH', range.from)?.id, version.id);
			if (range.to) assert.equal(settingsInForce(settings, 'PH', range.to)?.id, version.id);
		}
	}
});

// Formula-level goldens isolate table selection from the contribution tables. The full monthly
// cases above separately execute those tables. Each active snapshot is exercised here.
const cadenceCases = [
	{
		name: 'monthly regular bracket',
		instalments: 1,
		ordinary: 30000,
		deduction: 2450,
		supplement: 20000,
		previous: 0,
		expected: 4007.55,
		cumulative: false
	},
	{
		name: 'semi-monthly regular bracket',
		instalments: 2,
		ordinary: 15000,
		deduction: 1225,
		supplement: 10000,
		previous: 0,
		expected: 2003.7,
		cumulative: false
	},
	{
		name: 'weekly regular bracket',
		instalments: 4,
		ordinary: 7000,
		deduction: 600,
		supplement: 5000,
		previous: 0,
		expected: 988.8,
		cumulative: false
	},
	{
		name: 'monthly net exemption seam',
		instalments: 1,
		ordinary: 22000,
		deduction: 1167,
		supplement: 1,
		previous: 20000,
		expected: 0,
		cumulative: true
	},
	{
		name: 'semi-monthly net exemption seam',
		instalments: 2,
		ordinary: 11000,
		deduction: 583,
		supplement: 1,
		previous: 10000,
		expected: 0,
		cumulative: true
	},
	{
		name: 'weekly net exemption seam',
		instalments: 5,
		ordinary: 5000,
		deduction: 192,
		supplement: 1,
		previous: 4700,
		expected: 0,
		cumulative: true
	},
	{
		name: 'monthly above exemption seam',
		instalments: 1,
		ordinary: 22000.01,
		deduction: 1167,
		supplement: 1,
		previous: 20000,
		expected: 0.15,
		cumulative: false
	},
	{
		name: 'semi-monthly above exemption seam',
		instalments: 2,
		ordinary: 11000.01,
		deduction: 583,
		supplement: 1,
		previous: 10000,
		expected: 0.15,
		cumulative: false
	},
	{
		name: 'weekly above exemption seam',
		instalments: 4,
		ordinary: 5000.01,
		deduction: 192,
		supplement: 1,
		previous: 4700,
		expected: 0.15,
		cumulative: false
	}
];
for (const setting of active)
	test(`PH table goldens: ${setting.id}`, () => {
		const scheme = schemes.find((row) => row.settings_id === setting.id && row.code === 'WTAX');
		assert(scheme);
		const engine = runtimeExpressionEngine();
		for (const scenario of cadenceCases) {
			const empty = {
				base: 0,
				ordinary: 0,
				employee: 0,
				employer: 0,
				periods: 0,
				has_opening: false,
				triggered: false,
				periods_recorded: true
			};
			const context = {
				base: scenario.ordinary + scenario.supplement,
				ordinary: scenario.ordinary,
				person: {
					terms: { tax_residency: 'RESIDENT' },
					employment: { type: 'PERMANENT' },
					wage_floor: 1
				},
				period: { instalments: scenario.instalments, last_of_year: false },
				produced: Object.fromEntries(
					['SSS', 'SSS_MPF', 'PHIC', 'HDMF'].map((code) => [
						code,
						{ employee_this_period: code === 'SSS' ? scenario.deduction : 0 }
					])
				),
				history: {
					SSS: empty,
					SSS_MPF: empty,
					PHIC: empty,
					HDMF: empty,
					WTAX: { ...empty, base: scenario.previous, periods: scenario.previous ? 1 : 0 }
				}
			};
			const rule = selectRule(scheme.rules, context, engine);
			assert(rule, scenario.name);
			assert.equal(
				evaluateNumber(engine, rule.employee, context),
				scenario.expected,
				scenario.name
			);
			assert.equal(
				rule.when.includes('history.WTAX'),
				scenario.cumulative,
				`${scenario.name}: method`
			);
		}
	});
