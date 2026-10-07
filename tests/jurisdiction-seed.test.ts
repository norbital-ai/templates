/** L-TPL-hr-payroll-108–112 public lineage seed: CEL rates on the current engine context. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { planBehaviours, type Behaviours } from '../src/lib/payroll_engine/behaviours.js';
import { evaluateConfigured } from '../src/lib/payroll_engine/expressions.js';

type Row = Record<string, unknown>;
type Scheme = Row & {
	code: string;
	configuration?: {
		rules?: readonly { when?: string; employee?: string; employer?: string }[];
		limitation?: string;
	};
};

/** Every seeded lineage: one directory per jurisdiction code. */
const LINEAGES = readdirSync(resolve(process.cwd(), 'seed/jurisdiction')).toSorted();
const law = (lineage: string) => resolve(process.cwd(), 'seed/jurisdiction', lineage);
const latest = (lineage: string): string => {
	const versions = readdirSync(law(lineage))
		.filter((entry) => entry.startsWith('version_'))
		.toSorted((left, right) => Number(left.slice(8)) - Number(right.slice(8)));
	const directory = versions.at(-1);
	assert.ok(directory, `${lineage} needs a versioned public seed.`);
	return resolve(law(lineage), directory);
};
const rows = (lineage: string, name: string): Row[] => {
	const path = resolve(latest(lineage), `${name}.json`);
	assert.equal(existsSync(path), true, path);
	return JSON.parse(readFileSync(path, 'utf8')) as Row[];
};
const codes = (lineage: string, name: string): Set<string> =>
	new Set(rows(lineage, name).map((row) => String(row.code)));
const scheme = (lineage: string, code: string): Scheme => {
	const row = rows(lineage, 'statutory_contribution_catalog').find((item) => item.code === code);
	assert.ok(row, `${lineage} ${code}`);
	return row as Scheme;
};
const settings = (lineage: string): Row => {
	const [row] = rows(lineage, 'jurisdiction_settings');
	assert.ok(row);
	return row;
};

const cents = (value: unknown): number => Math.round(Number(value) * 100) / 100;

const charge = (
	row: Scheme,
	assessed: number,
	person: { age?: number | null; residency_status: string }
): { employee: number; employer: number } => {
	const context = {
		base: { assessed, ordinary: assessed, additional: 0 },
		person,
		employee: { facts: {}, dependents_count: 0 },
		company: { region: '', risk_class: '', facts: {} },
		scheme: { code: row.code, standing: '', elections: {} },
		elections: {},
		charged: { month: {}, year: {} },
		rules: {},
		period: { unpaid_working_days: 0 }
	};
	for (const rule of row.configuration?.rules ?? []) {
		if (rule.when != null && evaluateConfigured(rule.when, context) !== true) continue;
		return {
			employee: rule.employee == null ? 0 : cents(evaluateConfigured(rule.employee, context)),
			employer: rule.employer == null ? 0 : cents(evaluateConfigured(rule.employer, context))
		};
	}
	return { employee: 0, employer: 0 };
};

describe('public jurisdiction seed', () => {
	it('a substitute holiday is worked holiday only when the person was off on the date it replaces', () => {
		const row = rows('MY', 'work_catalog').find((item) => item.code === 'HOLIDAY_WORK')!;
		const substitute = {
			date: '2026-03-10',
			kind: 'SUBSTITUTE',
			given_to: 'ONLY_IF_OFF_ON_REPLACED_DATE',
			replaces: '2026-03-08'
		};
		const days = (dates: string[]) =>
			evaluateConfigured(String(row.quantity), { work: { dates, holidays: [substitute] } });
		assert.equal(days(['2026-03-10']), 1);
		assert.equal(days(['2026-03-08', '2026-03-10']), 0);
	});

	it('MY prices a day at a twenty-sixth of the monthly salary (EA s.60I)', () => {
		const work = Object.fromEntries(
			rows('MY', 'work_catalog').map((item) => [String(item.code), item])
		);
		const context = (paid_days: number) => ({
			period: { days: 31, paid_days },
			terms: { base_salary: 2600 },
			leave: {
				rows: [
					{ code: 'UNPAID_LEAVE', activity: 'TIME_OFF', days: 2, is_npl: true, can_encash: false }
				]
			}
		});
		// EA s.18A: part months and no-pay leave divide by the month's calendar days (owner ruling, not ÷26).
		const price = (code: string, paid_days: number) =>
			cents(
				Number(evaluateConfigured(String(work[code]!.quantity), context(paid_days))) *
					Number(evaluateConfigured(String(work[code]!.rate), context(paid_days)))
			);
		assert.equal(price('BASIC', 31), 2600);
		assert.equal(price('BASIC', 10), 838.71);
		assert.equal(price('NO_PAY_LEAVE', 31), 167.74);
		const allowance = String(rows('MY', 'allowance_catalog')[0]!.amount);
		assert.equal(
			cents(evaluateConfigured(allowance, { ...context(13), allowance: { amount: 260 } })),
			109.03
		);
	});

	it('a minimum-wage read with no minimum-wage record refuses rather than passing', () => {
		const pesangon = rows('ID', 'adhoc_catalog').find((item) => item.code === 'PESANGON')!;
		const expression = String((pesangon.bands as { amount: string }[])[0]!.amount);
		assert.match(expression, /rules\.minimum_wage\.by_region\[company\.region\]/);
		assert.throws(() =>
			evaluateConfigured('rules.minimum_wage.by_region[company.region]', {
				rules: {},
				company: { region: 'JAKARTA' }
			})
		);
		const vn = rows('VN', 'rule_set').find((item) => item.code === 'minimum_wage')!;
		assert.equal(
			evaluateConfigured('rules.minimum_wage.by_region[company.region]', {
				rules: { minimum_wage: vn.rules },
				company: { region: 'I' }
			}),
			5310000
		);
	});

	it('MY HOLIDAY_WORK CEL evaluates on the payroll work context without throwing', () => {
		const row = rows('MY', 'work_catalog').find((item) => item.code === 'HOLIDAY_WORK');
		assert.ok(row);
		const context = {
			period: { key: '2026-10', from: '2026-10-01', to: '2026-10-31', days: 31, paid_days: 31 },
			terms: {
				base_salary: 5000,
				work_classification: '',
				statutory_work_category: '',
				employment_type: '',
				residency_status: 'CITIZEN'
			},
			work: {
				overtime_hours: 0,
				incentive_hours: 0,
				dates: ['2026-03-10'],
				holidays: [
					{ date: '2026-03-10', kind: 'PUBLIC_HOLIDAY', given_to: 'EVERYONE', replaces: '' }
				]
			},
			leave: { rows: [] }
		};
		for (const field of ['eligibility', 'quantity', 'rate'] as const) {
			const expression = String(
				row[field] ?? (field === 'quantity' ? '1.0' : field === 'rate' ? '0.0' : 'true')
			);
			const value = evaluateConfigured(expression, context);
			if (field === 'eligibility') assert.equal(value, true);
			else assert.equal(typeof value, 'number');
		}
		assert.equal(
			Number(evaluateConfigured(String(row.quantity), context)) *
				Number(evaluateConfigured(String(row.rate), context)),
			(5000 / 26) * 2
		);
	});

	it('L-TPL-hr-payroll-108 seeds MY EPF/SOCSO/SKBBK/EIS/HRD/PCB, 104-hour OT and the RM1,700 floor', () => {
		const statutory = codes('MY', 'statutory_contribution_catalog');
		for (const code of ['EPF', 'SOCSO', 'SKBBK', 'EIS', 'HRDF', 'PCB'])
			assert.equal(statutory.has(code), true);
		assert.equal(codes('MY', 'adhoc_catalog').has('TERMINATION_BENEFIT'), true);
		const work = JSON.stringify(rows('MY', 'work_catalog'));
		assert.match(work, /104/);
		const version = settings('MY');
		assert.equal(version.code, 'MY');
		assert.match(JSON.stringify(version.reference_tables), /104/);
		assert.match(JSON.stringify(version.reference_tables), /1700/);
		assert.match(JSON.stringify(version.reference_tables), /tp1_/);
		const citizen = { age: 30, residency_status: 'CITIZEN' };
		assert.deepEqual(charge(scheme('MY', 'EPF'), 5000, citizen), { employee: 550, employer: 650 });
		assert.deepEqual(charge(scheme('MY', 'SOCSO'), 5000, citizen), {
			employee: 24.75,
			employer: 86.65
		});
		assert.deepEqual(charge(scheme('MY', 'EIS'), 5000, citizen), { employee: 9.9, employer: 9.9 });
		assert.deepEqual(charge(scheme('MY', 'HRDF'), 5000, citizen), { employee: 0, employer: 50 });
		assert.deepEqual(
			charge(scheme('MY', 'SKBBK'), 5000, { age: 30, residency_status: 'FOREIGNER' }),
			{
				employee: 61.9,
				employer: 0
			}
		);
		const mtd = charge(scheme('MY', 'PCB'), 5000, citizen);
		assert.ok(mtd.employee > 0);
		assert.equal(mtd.employer, 0);
	});

	it('L-TPL-hr-payroll-109 seeds PH SSS, PhilHealth, Pag-IBIG, withholding, 13th month and holiday premiums', () => {
		const statutory = codes('PH', 'statutory_contribution_catalog');
		for (const code of ['SSS', 'PHIC', 'HDMF', 'WTAX']) assert.equal(statutory.has(code), true);
		const adhoc = codes('PH', 'adhoc_catalog');
		assert.equal(adhoc.has('THIRTEENTH_MONTH_PAY'), true);
		assert.equal(adhoc.has('SEPARATION_PAY'), true);
		assert.equal(adhoc.has('RETIREMENT_PAY'), true);
		assert.equal(codes('PH', 'leave_catalog').has('ANNUAL_LEAVE'), true);
		assert.equal(codes('PH', 'work_catalog').has('HOLIDAY_WORK'), true);
		assert.equal(codes('PH', 'work_catalog').has('SPECIAL_HOLIDAY_WORK'), true);
		const wages = JSON.stringify(settings('PH').reference_tables);
		assert.match(wages, /IX-/);
		const sss = charge(scheme('PH', 'SSS'), 20000, { age: 30, residency_status: 'CITIZEN' });
		assert.equal(sss.employee, 1000);
		assert.equal(sss.employer, 2000);
		const philhealth = charge(scheme('PH', 'PHIC'), 20000, {
			age: 30,
			residency_status: 'CITIZEN'
		});
		assert.equal(philhealth.employee, 500);
		assert.equal(philhealth.employer, 500);
	});

	it('L-TPL-hr-payroll-110 seeds ID BPJS, PPh21, PKWT compensation, uang pisah, THR and leave cash-out', () => {
		const statutory = codes('ID', 'statutory_contribution_catalog');
		for (const code of ['JHT', 'JP', 'JKK', 'JKM', 'JKP', 'KESEHATAN', 'PPH21'])
			assert.equal(statutory.has(code), true);
		const adhoc = codes('ID', 'adhoc_catalog');
		assert.equal(adhoc.has('PKWT_COMPENSATION'), true);
		assert.equal(adhoc.has('UANG_PISAH'), true);
		assert.equal(adhoc.has('THR'), true);
		assert.equal(codes('ID', 'leave_catalog').has('ANNUAL_LEAVE'), true);
		const jht = charge(scheme('ID', 'JHT'), 10_000_000, { age: 30, residency_status: 'CITIZEN' });
		assert.equal(jht.employee, 200000);
		assert.equal(jht.employer, 370000);
	});

	it('L-TPL-hr-payroll-111 seeds VN SI/HI/UI, PIT, union dues, overtime and severance', () => {
		const statutory = codes('VN', 'statutory_contribution_catalog');
		for (const code of ['SI', 'HI', 'UI', 'PIT', 'UNION_DUES'])
			assert.equal(statutory.has(code), true);
		assert.equal(codes('VN', 'adhoc_catalog').has('SEVERANCE_ALLOWANCE'), true);
		assert.equal(codes('VN', 'work_catalog').has('OVERTIME'), true);
		const si = charge(scheme('VN', 'SI'), 10_000_000, { age: 30, residency_status: 'CITIZEN' });
		assert.equal(si.employee, 800000);
		assert.equal(si.employer, 1750000);
	});

	it('L-TPL-hr-payroll-112 seeds TW LI/EI, occupational accident, NHI, labour pension, withholding, 補休 and cash-out', () => {
		const statutory = codes('TW', 'statutory_contribution_catalog');
		for (const code of [
			'LI',
			'EI',
			'OCC_INJURY',
			'NHI',
			'LABOR_PENSION',
			'LABOR_PENSION_RESERVE',
			'INCOME_TAX'
		])
			assert.equal(statutory.has(code), true);
		assert.equal(codes('TW', 'leave_catalog').has('COMPENSATORY_TIME_OFF'), true);
		const annual = rows('TW', 'leave_catalog').find((row) => row.code === 'ANNUAL_LEAVE');
		assert.equal(annual?.encash_on_exit, true);
		assert.equal(codes('TW', 'adhoc_catalog').has('SEVERANCE_PAY'), true);
		const li = charge(scheme('TW', 'LI'), 45800, { age: 30, residency_status: 'CITIZEN' });
		assert.equal(li.employee, 1053);
		assert.equal(li.employer, 3687);
	});

	it('every cloned_from_id names another seeded settings row or is omitted', () => {
		const settings: Row[] = [];
		for (const lineage of LINEAGES) {
			for (const version of readdirSync(law(lineage)).filter((entry) =>
				entry.startsWith('version_')
			)) {
				const path = resolve(law(lineage), version, 'jurisdiction_settings.json');
				if (!existsSync(path)) continue;
				settings.push(...(JSON.parse(readFileSync(path, 'utf8')) as Row[]));
			}
		}
		const ids = new Set(settings.map((row) => String(row.id)));
		const dangling = settings.filter(
			(row) => typeof row.cloned_from_id === 'string' && !ids.has(String(row.cloned_from_id))
		);
		assert.equal(
			dangling.length,
			0,
			dangling.map((row) => `${row.code}:${row.id}→${row.cloned_from_id}`).join(', ')
		);
	});

	it('MY CEL admits a REGULAR PAYROLL_CREATE the way admitPayrollRun plans it', () => {
		const behaviours = settings('MY').behaviours as Behaviours;
		const planned = planBehaviours(
			behaviours,
			{ kind: 'catalog', catalog: 'WORK', event: 'PAYROLL_CREATE' },
			{ event: { data: { request: { kind: 'REGULAR', period: '2026-10' } } } }
		);
		assert.ok(planned.some((rule) => rule.id === 'payroll-run'));
	});

	it('every lineage admits REGULAR/OFF_CYCLE payroll and pins settled entries', () => {
		for (const lineage of LINEAGES) {
			for (const version of readdirSync(law(lineage)).filter((entry) =>
				entry.startsWith('version_')
			)) {
				const path = resolve(law(lineage), version, 'jurisdiction_settings.json');
				if (!existsSync(path)) continue;
				for (const row of JSON.parse(readFileSync(path, 'utf8')) as Row[]) {
					const rules = (
						row.behaviours as
							{ rules?: { id?: string; catalog?: string; events?: string[] }[] } | undefined
					)?.rules;
					assert.ok(rules, `${lineage}/${version} needs behaviours.rules`);
					const payroll = rules.find((rule) => rule.id === 'payroll-run');
					assert.ok(payroll, `${lineage}/${version} needs payroll-run`);
					assert.equal(payroll.catalog, 'WORK');
					assert.ok(payroll.events?.includes('PAYROLL_CREATE'));
					assert.ok(rules.some((rule) => rule.id === 'pin-settled-entries'));
					assert.ok(rules.some((rule) => rule.id === 'encash-leave-on-exit'));
				}
			}
		}
	});
});
