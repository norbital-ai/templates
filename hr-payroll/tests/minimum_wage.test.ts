// Every seeded minimum-wage rule is exercised at its floor and one unit below it, including a regional or job-nature
// variant where the rule has one. The PH case also covers the agriculture/retail nature key and the domestic table.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';

type Rule = {
	readonly code: string;
	readonly validate?: string;
	readonly condition?: string;
	readonly lookup?: Record<string, unknown>;
	readonly reads?: object;
};

const latest = (code: string): string => {
	const dir = new URL(`../seed/public/jurisdiction/${code}/`, import.meta.url);
	const versions = readdirSync(dir)
		.filter((name) => /^version_\d+$/.test(name))
		.sort((left, right) => Number(left.slice(8)) - Number(right.slice(8)));
	const found = versions.at(-1);
	assert.ok(found !== undefined);
	return `${dir.href}${found}`;
};
const load = <T>(path: string): T => JSON.parse(readFileSync(new URL(path), 'utf8')) as T;
const withGlobals = (code: string, rule: Rule): Rule => {
	const [settings] = load<readonly Rule[]>(`${latest(code)}/jurisdiction_settings.json`);
	return { ...rule, lookup: { ...settings?.lookup, ...rule.lookup } };
};
const ruleOf = (code: string, ruleCode: string): Rule => {
	const rule = load<readonly Rule[]>(`${latest(code)}/registered_rule.json`).find(
		(row) => row.code === ruleCode
	);
	assert.ok(rule?.validate !== undefined);
	return withGlobals(code, rule);
};
const effectOf = (code: string, effectCode: string): Rule => {
	const effect = load<readonly Rule[]>(`${latest(code)}/registered_effect.json`).find(
		(row) => row.code === effectCode
	);
	assert.ok(effect?.condition !== undefined);
	return withGlobals(code, effect);
};
/** A floor on a finished payslip raises an obligation: it passes when the effect stays quiet. */
const clear = (effect: Rule, context: object) =>
	!evaluate(
		effect.condition!,
		'CALCULATION',
		{ lookup: effect.lookup ?? {}, ...context },
		effect.code
	);
const valid = (rule: Rule, context: object) =>
	evaluate(rule.validate!, 'CALCULATION', { lookup: rule.lookup ?? {}, ...context }, rule.code);
const run = { salary_coverage: { from: '2026-01-01', to: '2026-01-31' } };

describe('seeded minimum wage rules', () => {
	it('Taiwan monthly and hourly floors', () => {
		const monthly = ruleOf('TW', 'MINIMUM_WAGE_FLOOR');
		const hourly = ruleOf('TW', 'MINIMUM_WAGE_HOURLY');
		const floor = Number(
			(monthly.lookup?.['constants'] as { monthly_wage?: number } | undefined)?.monthly_wage
		);
		const hourFloor = Number(hourly.lookup?.['hourly_wage']);
		const context = (amount: number, unit: string, engagement = 'EMPLOYEE') => ({
			entry: {
				engagement,
				terms: { rate: { amount, unit }, allowances: {} },
				employee_extension_data: {}
			}
		});
		assert.equal(valid(monthly, context(floor, 'MONTHLY')), true);
		assert.equal(valid(monthly, context(floor - 1, 'MONTHLY')), false);
		assert.equal(valid(hourly, context(hourFloor, 'HOURLY')), true);
		assert.equal(valid(hourly, context(hourFloor - 1, 'HOURLY')), false);
		assert.equal(valid(monthly, context(floor - 1, 'MONTHLY', 'PART_TIME')), true);
		// a domestic worker is outside the general floor; the domestic rule decides
		const domestic = ruleOf('TW', 'DOMESTIC_MIGRANT_WAGE');
		const domesticContext = (amount: number) => ({
			entry: {
				engagement: 'EMPLOYEE',
				effective_range: { from: '2026-01-01', to: null },
				terms: { rate: { amount, unit: 'MONTHLY' } },
				employee_extension_data: { worker_category: 'DOMESTIC_CAREGIVER' }
			}
		});
		assert.equal(valid(monthly, domesticContext(19_999)), true);
		assert.equal(valid(domestic, domesticContext(20_000)), true);
		assert.equal(valid(domestic, domesticContext(19_999)), false);
	});

	it('Malaysia monthly, hourly and task-basis exemptions', () => {
		const monthly = ruleOf('MY', 'MINIMUM_WAGE_MONTHLY');
		const hourly = ruleOf('MY', 'MINIMUM_WAGE_HOURLY');
		const floor = Number(monthly.lookup?.['monthly_wage']);
		const hourFloor = Number(hourly.lookup?.['hourly_wage']);
		const context = (amount: number, unit: string, over: object = {}) => ({
			entry: {
				engagement: 'EMPLOYEE',
				terms: { rate: { amount, unit }, statutory_work_category: 'NON_MANUAL' },
				employee_extension_data: {},
				...over
			}
		});
		assert.equal(valid(monthly, context(floor, 'MONTHLY')), true);
		assert.equal(valid(monthly, context(floor - 1, 'MONTHLY')), false);
		assert.equal(valid(hourly, context(hourFloor, 'HOURLY')), true);
		assert.equal(valid(hourly, context(hourFloor - 1, 'HOURLY')), false);
		assert.equal(
			valid(
				monthly,
				context(floor - 1, 'MONTHLY', {
					terms: {
						rate: { amount: floor - 1, unit: 'MONTHLY' },
						statutory_work_category: 'TASK_BASIS'
					}
				})
			),
			true
		);
	});

	it('Singapore PWM role floor', () => {
		const pwm = effectOf('SG', 'PWM_WAGE_FLOOR');
		const roles = pwm.lookup?.['pwm_roles'] as Record<string, { monthly_floor: number }>;
		const role = roles['ADMIN_ASSISTANT'];
		assert.ok(role !== undefined);
		const context = (gross: number) => ({
			subject: {
				employment: {
					terms: { residency_status: 'CITIZEN' },
					effective_range: { from: '2024-01-01', to: null },
					employee_extension_data: { pwm_role: 'ADMIN_ASSISTANT' }
				}
			},
			entry: { id: 'slip', period: '2026-01', basic_earnings: gross, ordinary_wages: gross },
			reads: { obligation: [] }
		});
		assert.equal(clear(pwm, context(role.monthly_floor)), true);
		assert.equal(clear(pwm, context(role.monthly_floor - 1)), false);
	});

	it('Vietnam regional monthly and hourly floors', () => {
		const monthly = ruleOf('VN', 'MINIMUM_WAGE_FLOOR');
		const hourly = ruleOf('VN', 'HOURLY_MINIMUM_WAGE');
		const byRegion = (monthly.lookup?.['minimum_wage'] as { by_region: Record<string, number> })
			.by_region;
		const region = Object.keys(byRegion)[0]!;
		const floor = byRegion[region]!;
		const context = (amount: number, unit: string) => ({
			entry: {
				engagement: 'EMPLOYEE',
				effective_range: { from: '2026-01-01', to: null },
				terms: { rate: { amount, unit } },
				employee_extension_data: {}
			},
			reads: {
				entity_profile_version: [
					{
						status: 'SEALED',
						effective_range: { from: '2024-01-01', to: null },
						entity_extension_data: { region }
					}
				]
			}
		});
		assert.equal(valid(monthly, context(floor, 'MONTHLY')), true);
		assert.equal(valid(monthly, context(floor - 1, 'MONTHLY')), false);
		const hourByRegion = hourly.lookup?.['hourly_by_region'] as Record<string, number>;
		const hourFloor = hourByRegion[region]!;
		assert.equal(valid(hourly, context(hourFloor, 'HOURLY')), true);
		assert.equal(valid(hourly, context(hourFloor - 1, 'HOURLY')), false);
	});

	it('Japan regional hourly floor', () => {
		const rule = ruleOf('JP', 'MINIMUM_WAGE_CONTRACT');
		const table = rule.lookup?.['minimum_wage'] as readonly {
			region: string;
			from: string;
			amount: number;
		}[];
		const row = table[0]!;
		const context = (amount: number) => ({
			entry: {
				entity_id: 'entity-1',
				effective_range: { from: '2027-01-01', to: null },
				terms: { rate: { amount, unit: 'HOURLY' } },
				employee_extension_data: { insured_office_region: row.region }
			},
			reads: {
				entity_profile_version: [
					{
						entity_id: 'entity-1',
						status: 'SEALED',
						effective_range: { from: '2024-01-01', to: null },
						entity_extension_data: { region: row.region }
					}
				]
			}
		});
		assert.equal(valid(rule, context(row.amount)), true);
		assert.equal(valid(rule, context(row.amount - 1)), false);
	});

	it('Japan annual prescribed hours convert a monthly wage', () => {
		const rule = ruleOf('JP', 'MINIMUM_WAGE_CONTRACT');
		const table = rule.lookup?.['minimum_wage'] as readonly {
			region: string;
			from: string;
			amount: number;
		}[];
		const row = table[0]!;
		const context = (amount: number, normal_hours_per_year?: number) => ({
			entry: {
				entity_id: 'entity-1',
				effective_range: { from: '2027-01-01', to: null },
				terms: {
					rate: { amount, unit: 'MONTHLY' },
					normal_hours_per_week: 40,
					work_classification: 'ORDINARY'
				},
				employee_extension_data: {
					insured_office_region: row.region,
					...(normal_hours_per_year === undefined ? {} : { normal_hours_per_year })
				}
			},
			reads: {
				entity_profile_version: [
					{
						entity_id: 'entity-1',
						status: 'SEALED',
						effective_range: { from: '2024-01-01', to: null },
						entity_extension_data: { region: row.region }
					}
				]
			}
		});
		// 180,000 / (1,820 / 12) = 1,186.81, above the floor; the weekly fallback would say 1,038.46
		assert.equal(valid(rule, context(180_000, 1_820)), true);
		assert.equal(valid(rule, context(180_000)), false);
	});

	it('China regional monthly floor', () => {
		const rule = effectOf('CN', 'MINIMUM_WAGE');
		const table = rule.lookup?.['minimum_wage_by_zone'] as readonly {
			region: string;
			zone: string;
			monthly: number;
		}[];
		const row = table[0]!;
		const context = (amount: number) => ({
			entry: { id: 'slip', employee_statutory: 0 },
			reads: { obligation: [], payroll_run: [run] },
			subject: {
				employer: { entity_extension_data: { region: row.region } },
				employment: {
					engagement: 'EMPLOYEE',
					effective_range: { from: '2024-01-01', to: null },
					terms: { rate: { amount, unit: 'MONTHLY' }, allowances: {} },
					employee_extension_data: {}
				}
			}
		});
		assert.equal(clear(rule, context(row.monthly)), true);
		assert.equal(clear(rule, context(row.monthly - 1)), false);
	});

	it('China part-time monthly rate meets the hourly floor at the worksite', () => {
		const rule = ruleOf('CN', 'MINIMUM_WAGE_HOURLY');
		const table = rule.lookup?.['minimum_wage_by_zone'] as readonly {
			region: string;
			zone: string;
			hourly: number;
		}[];
		const sh = table.find((row) => row.region === 'SH' && row.zone === '1');
		const km = table.find((row) => row.region === 'KM' && row.zone === '1');
		assert.ok(sh !== undefined && km !== undefined);
		const context = (amount: number, work_region: string) => ({
			entry: {
				engagement: 'PART_TIME',
				effective_range: { from: '2024-01-01', to: null },
				terms: {
					rate: { amount, unit: 'MONTHLY' },
					normal_hours_per_week: 24,
					...(work_region === '' ? {} : { work_region })
				}
			},
			reads: {
				entity_profile_version: [
					{
						status: 'SEALED',
						effective_range: { from: '2024-01-01', to: null },
						entity_extension_data: { region: 'SH' }
					}
				]
			}
		});
		const monthly = (hourly: number) => hourly * 24 * (52 / 12);
		assert.equal(valid(rule, context(monthly(sh.hourly), 'SH')), true);
		assert.equal(valid(rule, context(monthly(sh.hourly) - 0.01, 'SH')), false);
		// the worksite floor governs over the employer's registered region
		assert.equal(valid(rule, context(monthly(km.hourly), 'KM')), true);
		assert.equal(valid(rule, context(monthly(km.hourly), '')), false);
	});

	it('Indonesia regional floor', () => {
		const rule = ruleOf('ID', 'MINIMUM_WAGE_FLOOR');
		const byRegion = rule.lookup?.['by_region'] as Record<string, number>;
		const region = Object.keys(byRegion)[0]!;
		const floor = byRegion[region]!;
		const context = (amount: number) => ({
			entry: {
				engagement: 'EMPLOYEE',
				terms: { rate: { amount, unit: 'MONTHLY' }, allowances: {} },
				employee_extension_data: { work_region: region }
			},
			reads: {
				entity_profile_version: [
					{ entity_extension_data: { region, enterprise_size_class: 'LARGE' } }
				]
			}
		});
		assert.equal(valid(rule, context(floor)), true);
		assert.equal(valid(rule, context(floor - 1)), false);
	});

	it('Thailand skill-standard trade floor', () => {
		const rule = ruleOf('TH', 'SKILL_STANDARD_WAGE');
		const context = (amount: number) => ({
			entry: {
				terms: { rate: { amount, unit: 'DAILY' }, normal_hours_per_day: 8 },
				employee_extension_data: { skill_standard_day_rate: 600 }
			}
		});
		assert.equal(valid(rule, context(600)), true);
		assert.equal(valid(rule, context(599)), false);
	});

	it('Philippines regional nature keys, domestic table and exemptions', () => {
		const rule = ruleOf('PH', 'MINIMUM_WAGE_FLOOR');
		const context = (
			region: string,
			category: string,
			amount: number,
			employer: Record<string, unknown> = {}
		) => ({
			entry: {
				status: 'SEALED',
				effective_range: { from: '2026-01-08' },
				terms: {
					rate: { amount, unit: 'MONTHLY' },
					normal_hours_per_day: 8,
					statutory_work_category: category
				}
			},
			subject: {
				employer: { entity_extension_data: { region, ...employer } },
				employment: { employee_extension_data: {} }
			},
			lookup: rule.lookup ?? {}
		});
		assert.equal(valid(rule, context('BARMM-CITY-NONAGRI', 'NON_FIELD', 11000)), true);
		assert.equal(valid(rule, context('BARMM-CITY-NONAGRI', 'NON_FIELD', 10000)), false);
		assert.equal(valid(rule, context('BARMM-CITY-AGRI-RETAIL', 'FIELD_PERSONNEL', 10500)), true);
		assert.equal(valid(rule, context('BARMM-CITY-AGRI-RETAIL', 'FIELD_PERSONNEL', 10000)), false);
		assert.equal(valid(rule, context('BARMM', 'DOMESTIC', 5500)), true);
		assert.equal(valid(rule, context('BARMM', 'DOMESTIC', 4500)), false);
		assert.equal(
			valid(
				rule,
				context('BARMM-CITY-NONAGRI', 'NON_FIELD', 1000, { bmbe_certificate_of_authority: true })
			),
			true
		);
		assert.equal(valid(rule, context('NOT-A-WAGE-ORDER', 'NON_FIELD', 20000)), false);
	});

	it('Thailand provincial daily floor', () => {
		const rule = ruleOf('TH', 'MINIMUM_WAGE_FLOOR');
		const table = rule.lookup?.['by_region'] as Record<string, number>;
		const region = 'BANGKOK';
		const floor = table[region]!;
		const context = (amount: number, unit: string, employerRegion = region, worksite = '') => ({
			entry: {
				engagement: 'EMPLOYEE',
				terms: {
					rate: { amount, unit },
					normal_hours_per_day: 8,
					...(worksite === '' ? {} : { work_region: worksite })
				},
				employee_extension_data: {}
			},
			subject: { employer: { entity_extension_data: { region: employerRegion } } }
		});
		assert.equal(valid(rule, context(floor, 'DAILY')), true);
		assert.equal(valid(rule, context(floor - 1, 'DAILY')), false);
		assert.equal(valid(rule, context(floor * 30, 'MONTHLY')), true);
		assert.equal(valid(rule, context(floor * 30 - 30, 'MONTHLY')), false);
		assert.equal(valid(rule, context(floor / 8, 'HOURLY')), true);
		assert.equal(valid(rule, context(floor / 8 - 1, 'HOURLY')), false);
		// the worksite floor governs over the employer's registered province
		const other = Object.keys(table).find((name) => name !== region && table[name]! < floor);
		assert.ok(other !== undefined);
		assert.equal(valid(rule, context(table[other]!, 'DAILY', region, other)), true);
		assert.equal(valid(rule, context(table[other]!, 'DAILY', region)), false);
	});

	it('Thailand Bangkok worksite sets the floor and the arrears over a Chiang Rai employer', () => {
		const rule = ruleOf('TH', 'MINIMUM_WAGE_FLOOR');
		const table = rule.lookup?.['by_region'] as Record<string, number>;
		const bangkok = table['BANGKOK']!;
		const chiangRai = table['CHIANG_RAI']!;
		assert.ok(chiangRai < bangkok);
		const context = (amount: number, unit: string, worksite: string) => ({
			entry: {
				engagement: 'EMPLOYEE',
				terms: {
					rate: { amount, unit },
					normal_hours_per_day: 8,
					...(worksite === '' ? {} : { work_region: worksite })
				},
				employee_extension_data: {}
			},
			subject: { employer: { entity_extension_data: { region: 'CHIANG_RAI' } } }
		});
		// 11,000 / 30 = 366.67: below Bangkok's 400 even though the employer province is cheaper
		assert.equal(valid(rule, context(11_000, 'MONTHLY', 'BANGKOK')), false);
		assert.equal(valid(rule, context(12_000, 'MONTHLY', 'BANGKOK')), true);
		assert.equal(valid(rule, context(11_000, 'MONTHLY', '')), true);
		const afile = load<readonly { code: string; eligibility?: string; conversion?: string }[]>(
			`${latest('TH')}/adhoc_catalog.json`
		);
		const arrears = afile.find((row) => row.code === 'MINIMUM_WAGE_ARREARS');
		assert.ok(arrears?.conversion !== undefined);
		const [settings] = load<readonly { lookup?: Record<string, unknown> }[]>(
			`${latest('TH')}/jurisdiction_settings.json`
		);
		const amount = (worksite: string) =>
			evaluate(
				arrears.conversion!,
				'CALCULATION',
				{
					lookup: { ...settings?.lookup, ...rule.lookup },
					day_rate: 350,
					entry: { quantity: 2, unit: 'DAY', incurred_on: '2026-11-02' },
					subject: {
						employment: {
							effective_range: { from: '2026-01-01', to: null },
							terms: { work_region: worksite }
						},
						employer: { entity_extension_data: { region: 'CHIANG_RAI' } }
					}
				},
				'MINIMUM_WAGE_ARREARS'
			);
		// Bangkok's 400 minus the 350 paid, for two days: 100, not Chiang Rai's 2 a day
		assert.equal(Number(amount('BANGKOK')), 100);
		assert.equal(Number(amount('')), (chiangRai - 350) * 2);
	});
});
