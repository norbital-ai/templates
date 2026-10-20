import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { Effect } from 'effect';
import type { SalaryReport } from '../src/lib/payroll_engine/salary_report.js';
import { fixtureId, nativeId } from './fixture_values.js';
import { lineage, world, type Tables } from './jurisdiction_kit.js';

const LAW = lineage('SG');
const COMPANY = nativeId('entity', fixtureId('salary-report-query-company'));
const PERSON = nativeId('employment_profile', fixtureId('salary-report-query-person'));
const EMPLOYMENT = nativeId('employment_contract', fixtureId('salary-report-query-employment'));
const BANK = nativeId('bank', fixtureId('salary-report-query-draft-bank'));
const SCENARIOS = [
	{ period: '2025-12', day: '2025-12-31', suffix: 'earlier', payment: 'EXTERNAL' },
	{ period: '2026-03', day: '2026-03-31', suffix: 'later', payment: 'INTERNAL' }
] as const;
const RUNS = SCENARIOS.map(({ suffix }) =>
	nativeId('payroll_run', fixtureId(`salary-report-query-run-${suffix}`))
);

function tables(): Tables {
	const rows = LAW.law();
	const settings = SCENARIOS.map(({ day }) => LAW.settingsOf(LAW.versionOn(day)).id);
	assert.notEqual(settings[0], settings[1]);
	const ruleSets = rows.get('rule_set');
	const adhoc = rows.get('adhoc_catalog');
	assert.ok(ruleSets);
	assert.ok(adhoc);
	const profiles = SCENARIOS.map(({ suffix, payment }, index) => {
		const source = ruleSets.find(
			(row) => row.settings_id === settings[index] && row.family === 'PAYROLL'
		);
		assert.ok(source);
		const catalog = adhoc.find((row) => row.settings_id === settings[index]);
		assert.ok(catalog);
		adhoc.push({
			...catalog,
			id: fixtureId(`salary-report-query-recovery-${suffix}`),
			code: 'CUSTOM_RECOVERY',
			name: 'Custom recovery',
			direction: 'SUBTRACT',
			destination: 'NET'
		});
		return {
			...source,
			id: fixtureId(`salary-report-query-profile-${suffix}`),
			code: 'salary_report',
			name: `Captured salary report ${suffix}`,
			rules: {
				group_order: [`${suffix} recoveries`, `${suffix} earnings`, 'Net pay'],
				items: [
					{ family: 'WORK', code: 'CUSTOM_WAGE', group: `${suffix} earnings` },
					{
						family: 'ADHOC',
						code: 'CUSTOM_RECOVERY',
						group: `${suffix} recoveries`,
						payment
					}
				]
			}
		};
	});
	rows.set('rule_set', [
		...ruleSets.filter(
			(row) =>
				!(
					settings.includes(row.settings_id) &&
					row.family === 'PAYROLL' &&
					row.code === 'salary_report'
				)
		),
		...profiles
	]);
	rows.set('bank', [
		{ id: BANK, code: 'SYNTHETIC-DRAFT', name: 'Unconfigured draft bank', enabled: false }
	]);
	rows.set('entity', [
		{
			id: COMPANY,
			name: 'Salary report example company',
			settings_code: 'SG',
			pay_cutoff_day: 1,
			effective_range: { from: '2020-01-01', to: null },
			facts: {},
			payment_bank_id: BANK
		}
	]);
	rows.set('employment_profile', [
		{ id: PERSON, name: 'Salary report example employee', facts: {} }
	]);
	rows.set('employment_contract', [
		{
			id: EMPLOYMENT,
			employee_id: PERSON,
			company_id: COMPANY,
			employee_number: 'REPORT-001',
			contract_number: 1,
			effective_range: { from: '2020-01-01', to: null },
			facts: {}
		}
	]);
	rows.set(
		'payroll_run',
		SCENARIOS.map(({ period, day }, index) => ({
			id: RUNS[index],
			company_id: COMPANY,
			settings_id: settings[index],
			period,
			kind: 'REGULAR',
			pay_date: day
		}))
	);
	rows.set(
		'payslip',
		SCENARIOS.map(({ day, suffix }, index) => ({
			id: nativeId('payslip', fixtureId(`salary-report-query-slip-${suffix}`)),
			payroll_run_id: RUNS[index],
			employment_id: EMPLOYMENT,
			terms_through: day,
			currency: 'SGD',
			base: [{ component_code: 'CUSTOM_WAGE', label: 'Custom wage', amount: 1000 }],
			adjustments: [
				{
					family: 'ADHOC',
					source_id: fixtureId(`salary-report-query-entry-${suffix}`),
					component_code: 'CUSTOM_RECOVERY',
					bucket: 'DEDUCTION',
					destination: 'NET',
					amount: -25,
					label: 'Custom recovery'
				}
			],
			statutory: [
				{
					scheme_code: 'SYNTHETIC_SCHEME',
					base_amount: 1000,
					employee_amount: 50,
					employer_amount: 20,
					parts: {}
				}
			],
			gross: '1000',
			total_deductions: '75',
			net: '925',
			employer_cost: '1020',
			bank_charges: '0',
			status: 'DRAFT'
		}))
	);
	return rows;
}

function amount(report: SalaryReport, family: string, code: string): number | null {
	const column = report.columns.findIndex((item) => item.family === family && item.code === code);
	assert.ok(column >= 0, `${family}:${code} is reported`);
	assert.equal(report.rows.length, 1);
	const value = report.rows[0]?.amounts[column];
	assert.ok(value !== undefined);
	return value;
}

it.effect(
	'salary export uses each run captured profile for custom groups and recipients despite a disabled draft bank',
	Effect.fnUntraced(function* () {
		yield* world(tables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				const output = yield* hr.query('payroll_run.export_payroll', { ids: RUNS, kind: 'SALARY' });
				assert.deepEqual(output.documents, []);
				assert.equal(output.salary_reports.length, 2);
				for (const [index, scenario] of SCENARIOS.entries()) {
					const report = output.salary_reports.find((item) => item.run_reference === RUNS[index]);
					assert.ok(report);
					assert.equal(report.period, scenario.period);
					assert.equal(report.company, 'Salary report example company');
					assert.equal(report.currency, 'SGD');
					assert.deepEqual(report.warnings, []);
					assert.equal(report.columns[0]?.group, `${scenario.suffix} recoveries`);
					assert.equal(report.columns[1]?.group, `${scenario.suffix} earnings`);
					const recovery = report.columns.find((item) => item.code === 'CUSTOM_RECOVERY');
					assert.ok(recovery);
					assert.equal(recovery.external, scenario.payment === 'EXTERNAL');
					assert.equal(amount(report, 'WORK', 'CUSTOM_WAGE'), 1000);
					assert.equal(amount(report, 'ADHOC', 'CUSTOM_RECOVERY'), 25);
					assert.equal(amount(report, 'TOTAL', 'GROSS'), 1000);
					assert.equal(amount(report, 'TOTAL', 'NET'), 925);
					assert.equal(
						amount(report, 'TOTAL', 'COMPANY_PAYMENT'),
						scenario.payment === 'EXTERNAL' ? 1020 : 995
					);
				}
			})
		);
	}),
	15_000
);

it.effect(
	'a missing captured salary profile warns only its run and preserves gross and net without a selected bank',
	Effect.fnUntraced(function* () {
		const fixture = tables();
		const company = fixture.get('entity')?.[0];
		const earlierRun = fixture.get('payroll_run')?.[0];
		const rules = fixture.get('rule_set');
		assert.ok(company);
		assert.ok(earlierRun);
		assert.ok(rules);
		company.payment_bank_id = null;
		fixture.set(
			'rule_set',
			rules.filter(
				(row) =>
					!(
						row.settings_id === earlierRun.settings_id &&
						row.family === 'PAYROLL' &&
						row.code === 'salary_report'
					)
			)
		);
		yield* world(fixture).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const output = yield* t.as(t.member(['hr_manager'])).query('payroll_run.export_payroll', {
					ids: RUNS,
					kind: 'SALARY'
				});
				assert.deepEqual(output.documents, []);
				assert.equal(output.salary_reports.length, 2);
				const missing = output.salary_reports.find((report) => report.run_reference === RUNS[0]);
				const configured = output.salary_reports.find((report) => report.run_reference === RUNS[1]);
				assert.ok(missing);
				assert.ok(configured);
				assert.equal(amount(missing, 'TOTAL', 'COMPANY_PAYMENT'), null);
				assert.match(missing.warnings.join('\n'), /profile.*missing/i);
				assert.equal(amount(missing, 'TOTAL', 'GROSS'), 1000);
				assert.equal(amount(missing, 'TOTAL', 'DEDUCTIONS'), 75);
				assert.equal(amount(missing, 'TOTAL', 'NET'), 925);
				assert.equal(amount(configured, 'TOTAL', 'COMPANY_PAYMENT'), 995);
				assert.deepEqual(configured.warnings, []);
			})
		);
	}),
	15_000
);
