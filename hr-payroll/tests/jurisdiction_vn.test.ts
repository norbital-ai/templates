/** VN public lineage: snapshot structure, CEL on the engine context and statutory amounts per version. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
	effectWrites,
	planBehaviours,
	type Behaviours
} from '../src/lib/payroll_engine/behaviours.js';
import { configuredProgram, evaluateConfigured } from '../src/lib/payroll_engine/expressions.js';
import {
	classFromRow,
	entitlementDays,
	leaveBalances,
	movementFromRow,
	serviceMonthsAt
} from '../src/lib/payroll_engine/leave.js';
import { DUTY_KEYS, dutiesOf, raiseDuties, triggerOf } from './duties.ts';
import { Effect } from 'effect';
import { Reads } from '../src/lib/payroll_engine/foundation.js';
import { buildPayrollRun, type PayrollRunKind } from '../src/lib/payroll_engine/services.js';

type Row = { [key: string]: unknown };
type Rule = { when?: string; employee?: string; employer?: string };
type Configuration = {
	assessment?: string;
	assessable?: { ordinary?: string };
	rules?: Rule[];
	refuse_when?: { when: string; message: string }[];
};

const root = resolve(process.cwd(), 'seed/jurisdiction');
const lineage = resolve(root, 'VN');
const FILES = [
	'jurisdiction_settings',
	'rule_set',
	'statutory_contribution_catalog',
	'leave_catalog',
	'claim_catalog',
	'adhoc_catalog',
	'loan_catalog',
	'allowance_catalog',
	'work_catalog'
] as const;
const versionsOf = (directory: string) =>
	readdirSync(directory)
		.filter((name) => name.startsWith('version_'))
		.toSorted((left, right) => Number(left.slice(8)) - Number(right.slice(8)));
const VERSIONS = versionsOf(lineage);
const load = (directory: string, file: string): Row[] =>
	JSON.parse(readFileSync(resolve(directory, `${file}.json`), 'utf8')) as Row[];
const rows = (version: string, file: string) => load(resolve(lineage, version), file);
const settings = (version: string): Row => {
	const [row] = rows(version, 'jurisdiction_settings');
	assert.ok(row);
	return row;
};
const scheme = (version: string, code: string): Row & { configuration: Configuration } => {
	const row = rows(version, 'statutory_contribution_catalog').find((item) => item.code === code);
	assert.ok(row, `${version} ${code}`);
	return row as Row & { configuration: Configuration };
};

const payrollRule = (version: string, code: string) =>
	rows(version, 'rule_set').find((row) => row.family === 'PAYROLL' && row.code === code)
		?.rules as Row;
const minimumWage = (version: string) => payrollRule(version, 'minimum_wage');
const payrollRules = (version: string) => ({
	minimum_wage: minimumWage(version),
	working_time: payrollRule(version, 'working_time'),
	night_window: payrollRule(version, 'night_window')
});

/** The month's charge the way `assessStatutory` makes it for a salary-only month. */
const charge = (
	version: string,
	code: string,
	wage: number,
	person: Row = { residency_status: 'CITIZEN' },
	subject: {
		employee?: Row;
		company?: Row;
		elections?: Row;
		employment?: Row;
		unpaid?: number;
	} = {}
): { employee: number; employer: number } => {
	const { configuration } = scheme(version, code);
	// PIT deducts what SI, HI and UI charged this month; the State-sector union dues also read PIT (catalogue order).
	const before: { [code: string]: string[] } = {
		PIT: ['SI', 'HI', 'UI'],
		UNION_DUES: ['SI', 'HI', 'UI', 'PIT']
	};
	const charged = {
		month: Object.fromEntries(
			(before[code] ?? []).map((other) => [
				other,
				charge(version, other, wage, person, { ...subject, elections: {} })
			])
		)
	};
	const ceiling = configuration.assessable?.ordinary;
	const employee = { gender: '', dependents_count: 0, facts: {}, ...subject.employee };
	const company = { region: '', facts: {}, ...subject.company };
	const rules = payrollRules(version);
	const elections = subject.elections ?? {};
	const roots = {
		employee,
		company,
		rules,
		charged,
		employment: { start_date: '2020-01-01', exit_date: '', ...subject.employment },
		elections: { [code]: elections },
		scheme: { code, standing: '', elections }
	};
	const ordinary =
		ceiling == null
			? wage
			: Number(evaluateConfigured(ceiling, { month: { ordinary: wage }, ...roots }));
	const base = {
		ordinary,
		additional: 0,
		ordinary: ordinary,
		additional: 0,
		assessed: ordinary,
		amount: ordinary
	};
	const context = {
		base,
		...roots,
		person: {
			age: 30,
			race: null,
			religion: null,
			nationality: null,
			residency_since: null,
			...person
		},
		period: {
			key: '2026-10',
			from: '2026-10-01',
			days: 31,
			unpaid_working_days: subject.unpaid ?? 0
		},
		month: { ordinary: wage },
		year: { ordinary: 0, additional: 0 }
	};
	for (const guard of configuration.refuse_when ?? [])
		if (evaluateConfigured(guard.when, context) === true) throw new Error(guard.message);
	for (const rule of configuration.rules ?? []) {
		if (rule.when != null && evaluateConfigured(rule.when, context) !== true) continue;
		const assessed = Number(
			evaluateConfigured(configuration.assessment ?? 'base.assessed', context)
		);
		const ruled = { ...context, base: { ...base, assessed, amount: assessed } };
		return {
			employee: Number(evaluateConfigured(rule.employee ?? '0.0', ruled)),
			employer: Number(evaluateConfigured(rule.employer ?? '0.0', ruled))
		};
	}
	return { employee: 0, employer: 0 };
};

/** Every employee and entity fact the VN CEL reads, set. */
const SUBJECT_ALL = {
	employee: { gender: 'FEMALE', dependents_count: 2, facts: {} },
	elections: { union_member: true, dependants: 2 },
	company: {
		region: 'II',
		facts: {
			occupational_accident_reduced: true,
			union_fee_suspended: false,
			union_fee_reduction_percent: 20,
			stoppage_pay_percent: 70
		}
	}
};
/** The subject roots a leave entitlement reads (services.leaveState builds them). */
const LEAVE_SUBJECT = {
	terms: { work_classification: 'ORDINARY' },
	employee: { disabled: false, age: 30, facts: {} },
	employment: { start_date: '2020-01-01' }
};
/** `withBalances` from tests/duties.ts, with the subject roots the VN entitlements read. */
const withSubjectBalances = <C extends { event: Row; catalogues?: unknown; movements?: unknown }>(
	context: C
): C => {
	const row = context.event.row as Row;
	const range = (row.effective_range ?? {}) as { from?: string; to?: string | null };
	const asOf = range.to ?? range.from ?? '2026-01-01';
	return {
		...context,
		event: {
			...context.event,
			leave_balances: leaveBalances({
				classes: ((context.catalogues ?? []) as Row[]).map((held) =>
					classFromRow(held as unknown as Parameters<typeof classFromRow>[0])
				),
				movements: ((context.movements ?? []) as Row[]).map((held) =>
					movementFromRow(held as unknown as Parameters<typeof movementFromRow>[0])
				),
				serviceMonths: serviceMonthsAt(range.from ?? null, asOf, row.prior_service_months),
				asOf,
				employmentStart: range.from ?? null,
				context: LEAVE_SUBJECT
			})
		}
	};
};
/** The entity, contract and profile rows the obligation behaviours read. */
const COMPANY = { id: 'co1', region: 'I', risk_class: '', facts: {} };
const CONTRACT = {
	id: 'c1',
	company_id: 'co1',
	employee_id: 'e1',
	exit_ground: 'END_OF_CONTRACT',
	exit_facts: {},
	effective_range: { from: '2026-10-15', to: '2026-10-31' }
};
const PROFILE = {
	id: 'e1',
	nationality: 'VN',
	gender: 'FEMALE',
	date_of_birth: '1990-01-01',
	facts: {}
};
const employment = { classification: 'ORDINARY', service_months: 40, exit_date: '' };
const entry = (facts: Row) => ({
	amount: 20_000_000,
	quantity: 1,
	occurred_on: '2026-10-15',
	due_on: '2026-10-15',
	incurred_on: '2026-10-15',
	...facts,
	facts
});
/** The payslip build context (`buildPayslip`) and the entry admission context (`admitEntry`). */
const salaryContext = {
	employee: { gender: 'FEMALE', dependents_count: 0, facts: {} },
	company: { region: 'I', facts: {} },
	rules: payrollRules('version_4'),
	earned: { previous_month: { base_salary: 26_000_000 } },
	period: {
		key: '2026-10',
		from: '2026-10-01',
		to: '2026-10-31',
		days: 31,
		paid_days: 31,
		working_days: 26,
		covered_days: 31,
		part: 1,
		parts: 1
	},
	terms: {
		base_salary: 26_000_000,
		work_classification: 'ORDINARY',
		statutory_work_category: '',
		employment_type: 'PERMANENT',
		residency_status: 'CITIZEN'
	},
	employment,
	person: { employment },
	work: {
		overtime_hours: 4,
		incentive_hours: 0,
		dates: ['2026-03-10', '2026-03-11'],
		holidays: [{ date: '2026-03-10', kind: 'PUBLIC_HOLIDAY', given_to: 'EVERYONE', replaces: '' }],
		days: [
			{
				date: '2026-03-10',
				day_type: 'WORK',
				holiday_kind: 'PUBLIC_HOLIDAY',
				scheduled_hours: 8,
				worked_hours: 8,
				overtime_hours: 0,
				intervals: [{ start: '2026-03-10T08:00', end: '2026-03-10T16:00' }]
			},
			{
				date: '2026-03-11',
				day_type: 'WORK',
				holiday_kind: '',
				scheduled_hours: 8,
				worked_hours: 12,
				overtime_hours: 4,
				intervals: [{ start: '2026-03-11T08:00', end: '2026-03-11T20:00' }]
			}
		]
	},
	leave: {
		rows: [
			{ code: 'UNPAID_LEAVE', activity: 'TIME_OFF', days: 2, is_npl: true, can_encash: false },
			{ code: 'ANNUAL_LEAVE', activity: 'ENCASHMENT', days: 3, is_npl: false, can_encash: true }
		]
	}
};
const ENTRY_FACTS = { qualifying_months: 40, late_days: 20, deposit_rate_percent: 4.5 };
const payslipContext = { ...salaryContext, entry: entry(ENTRY_FACTS) };
const admitContext = {
	employee: { gender: 'FEMALE', dependents_count: 0, facts: {} },
	company: { region: 'I', facts: {} },
	employment,
	person: { employment },
	terms: { base_salary: 26_000_000, employment_type: 'PERMANENT' },
	entry: entry(ENTRY_FACTS)
};

const fieldsOf = async (collection: string, path: string): Promise<Set<string>> => {
	const model = (await import(`../src/data/model/${path}/+model.js`)) as {
		default: { fields: Row };
	};
	const relationships = (await import('../src/data/+relationship.js')) as { default: Row };
	return new Set([
		'id',
		...Object.keys(model.default.fields),
		...Object.keys(relationships.default)
			.filter((key) => key.startsWith(`${collection}.`))
			.map((key) => key.slice(collection.length + 1))
	]);
};

describe('VN jurisdiction seed', () => {
	it('every version holds settings, rule_set and every catalogue file', () => {
		assert.deepEqual(VERSIONS, ['version_1', 'version_2', 'version_3', 'version_4']);
		for (const version of VERSIONS)
			for (const file of FILES)
				assert.equal(
					existsSync(resolve(lineage, version, `${file}.json`)),
					true,
					`${version}/${file}`
				);
	});

	it('ids are unique across every lineage and version, and each row names its own version', () => {
		const seen = new Map<string, string>();
		for (const code of readdirSync(root))
			for (const version of versionsOf(resolve(root, code)))
				for (const file of readdirSync(resolve(root, code, version)).filter((name) =>
					name.endsWith('.json')
				))
					for (const row of load(resolve(root, code, version), file.slice(0, -5))) {
						const where = `${code}/${version}/${file}:${String(row.code)}`;
						assert.equal(
							seen.has(String(row.id)),
							false,
							`${where} reuses ${seen.get(String(row.id))}`
						);
						seen.set(String(row.id), where);
					}
		for (const version of VERSIONS) {
			const id = settings(version).id;
			for (const file of FILES.slice(1))
				for (const row of rows(version, file))
					assert.equal(row.settings_id, id, `${version}/${file}`);
		}
	});

	it('versions chain by cloned_from_id and cover time without a gap or an overlap', () => {
		let previous: Row | undefined;
		for (const version of VERSIONS) {
			const row = settings(version);
			const range = row.effective_range as { from: string; to: string | null };
			assert.equal(row.code, 'VN');
			assert.equal(row.jurisdiction_code, 'VN');
			assert.ok(row.sealed_at, `${version} is sealed`);
			assert.equal(row.voided_at, null);
			assert.match(range.from, /^\d{4}-\d{2}-\d{2}$/);
			if (previous === undefined) assert.equal(row.cloned_from_id, undefined);
			else {
				const before = previous.effective_range as { from: string; to: string | null };
				assert.equal(row.cloned_from_id, previous.id);
				assert.ok(before.to);
				const next = new Date(`${before.to}T00:00:00Z`);
				next.setUTCDate(next.getUTCDate() + 1);
				assert.equal(
					range.from,
					next.toISOString().slice(0, 10),
					`${version} starts the day after`
				);
			}
			previous = row;
		}
		assert.equal((previous?.effective_range as { to: unknown }).to, null);
	});

	it('every row key exists on its target model', async () => {
		for (const file of FILES) {
			const fields = await fieldsOf(file, `jurisdiction/${file}`);
			for (const version of VERSIONS)
				for (const row of rows(version, file))
					for (const key of Object.keys(row))
						assert.equal(fields.has(key), true, `${version}/${file}:${String(row.code)}.${key}`);
		}
	});

	it('settings declare both input schemas and the current reference tables only', () => {
		for (const version of VERSIONS) {
			const row = settings(version);
			const employee = row.employee_input_schema as { properties: Row };
			const entity = row.entity_input_schema as { properties: Row };
			assert.ok(employee.properties.contract_terms);
			assert.ok(employee.properties.employment_statutory_facts);
			assert.ok(employee.properties.facts);
			assert.ok(entity.properties.occupational_accident_reduced);
			assert.deepEqual(Object.keys(row.reference_tables as Row), ['TERMINATION_GROUND']);
			assert.deepEqual(row.payroll, {
				currency: 'VND',
				timezone: 'Asia/Ho_Chi_Minh',
				tax_year_start_month: 1
			});
		}
	});

	it('catalogue codes are the same in every version', () => {
		// rule_set codes move with the law: Decree 13/2023 gave way to the PDP Law 91/2025 on 1 January 2026.
		for (const file of FILES.slice(2)) {
			const codes = (version: string) => rows(version, file).map((row) => String(row.code));
			for (const version of VERSIONS) assert.deepEqual(codes(version), codes('version_1'), file);
		}
	});

	it('every catalogue and statutory CEL evaluates on the engine context', () => {
		const bool = (expression: unknown, context: Row, where: string) => {
			if (expression == null || String(expression).trim() === '') return;
			assert.equal(typeof evaluateConfigured(String(expression), context), 'boolean', where);
		};
		const number = (expression: unknown, context: Row, where: string) =>
			assert.equal(typeof evaluateConfigured(String(expression), context), 'number', where);
		for (const version of VERSIONS) {
			for (const row of rows(version, 'work_catalog')) {
				const where = `${version} work ${String(row.code)}`;
				bool(row.eligibility, salaryContext, where);
				number(row.quantity ?? '1.0', salaryContext, where);
				number(row.rate ?? '0.0', salaryContext, where);
			}
			for (const row of rows(version, 'allowance_catalog'))
				bool(row.eligibility, salaryContext, `${version} allowance ${String(row.code)}`);
			for (const file of ['adhoc_catalog', 'claim_catalog', 'loan_catalog'])
				for (const row of rows(version, file)) {
					const where = `${version} ${file} ${String(row.code)}`;
					for (const context of [admitContext, payslipContext]) {
						bool(row.eligibility, context, where);
						bool(row.qualifies_when, context, where);
					}
					for (const band of (row.bands ?? []) as { when?: string; amount: string }[]) {
						bool(band.when, payslipContext, where);
						number(band.amount, payslipContext, where);
					}
				}
			for (const row of rows(version, 'leave_catalog')) {
				bool(row.eligibility, admitContext, `${version} leave ${String(row.code)}`);
				if (String(row.pay_fraction ?? '') !== '')
					number(row.pay_fraction, salaryContext, `${version} leave ${String(row.code)}`);
			}
			for (const code of ['SI', 'HI', 'UI', 'UNION_FEE', 'UNION_DUES', 'PIT'])
				for (const [person, subject] of [
					[{ residency_status: 'CITIZEN' }, {}],
					[{ residency_status: 'NON_RESIDENT' }, { company: { region: 'IV' } }],
					[{ residency_status: 'RESIDENT' }, SUBJECT_ALL]
				] as const)
					for (const wage of [1_000_000, 30_000_000, 200_000_000]) {
						const { employee, employer } = charge(version, code, wage, person, subject);
						assert.ok(Number.isFinite(employee) && Number.isFinite(employer), `${version} ${code}`);
					}
			// Rule-set records carry no engine context; their CEL must still parse.
			const walk = (value: unknown, where: string): void => {
				if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${where}[${index}]`));
				else if (value != null && typeof value === 'object')
					for (const [key, item] of Object.entries(value)) {
						if ((key === 'when' || key === 'due') && typeof item === 'string' && item.trim() !== '')
							assert.doesNotThrow(() => configuredProgram(item), `${where}.${key}`);
						else walk(item, `${where}.${key}`);
					}
			};
			for (const row of rows(version, 'rule_set'))
				walk(row.rules, `${version} ${String(row.code)}`);
		}
	});

	it('work lines price VN overtime, holiday work, no-pay leave and encashment', () => {
		const amount = (code: string) => {
			const row = rows('version_4', 'work_catalog').find((item) => item.code === code);
			assert.ok(row);
			return (
				Number(evaluateConfigured(String(row.quantity), salaryContext)) *
				Number(evaluateConfigured(String(row.rate), salaryContext))
			);
		};
		assert.equal(amount('OVERTIME'), 4 * 1.5 * 125_000);
		assert.equal(amount('HOLIDAY_WORK'), 8 * 3 * 125_000);
		// Day wage = monthly ÷ the period's 26 planned working days (Decree 145/2020 art.54(1)(a3)).
		assert.equal(Math.round(amount('NO_PAY_LEAVE')), 2_000_000);
		assert.equal(Math.round(amount('ENCASHMENT')), 3_000_000);
		const counts = (version: string, code: string) =>
			rows(version, 'work_catalog').find((item) => item.code === code)?.counts_toward;
		assert.deepEqual(counts('version_1', 'OVERTIME'), ['PIT']);
		assert.deepEqual(counts('version_2', 'OVERTIME'), []);
		assert.deepEqual(counts('version_4', 'ENCASHMENT'), []);
	});

	it('overtime ladders, night work and the working-day divisor read the planned days', () => {
		const day = (date: string, extra: Row) => ({
			date,
			day_type: 'WORK',
			holiday_kind: '',
			scheduled_hours: 8,
			worked_hours: 0,
			overtime_hours: 0,
			intervals: [],
			...extra
		});
		const context = {
			...salaryContext,
			period: { ...salaryContext.period, working_days: 22 },
			work: {
				...salaryContext.work,
				dates: ['2026-10-03', '2026-10-05', '2026-10-06'],
				holidays: [],
				days: [
					// A Saturday rest day worked 08:00-14:00: six hours at 200%.
					day('2026-10-03', {
						day_type: 'REST',
						scheduled_hours: 0,
						worked_hours: 6,
						intervals: [{ start: '2026-10-03T08:00', end: '2026-10-03T14:00' }]
					}),
					// A normal day 08:00-24:00: eight normal hours, eight overtime, two of them at night.
					day('2026-10-05', {
						worked_hours: 16,
						overtime_hours: 8,
						intervals: [{ start: '2026-10-05T08:00', end: '2026-10-06T00:00' }]
					}),
					// A night shift 22:00-06:00 with no overtime: eight night hours at +30%.
					day('2026-10-06', {
						worked_hours: 8,
						intervals: [{ start: '2026-10-06T22:00', end: '2026-10-07T06:00' }]
					})
				]
			}
		};
		const amount = (version: string, code: string) => {
			const row = rows(version, 'work_catalog').find((item) => item.code === code);
			assert.ok(row, code);
			if (evaluateConfigured(String(row.eligibility), context) !== true) return 0;
			return Math.round(
				Number(evaluateConfigured(String(row.quantity), context)) *
					Number(evaluateConfigured(String(row.rate), context))
			);
		};
		const hour = 26_000_000 / 22 / 8;
		for (const version of VERSIONS) {
			assert.equal(amount(version, 'OVERTIME'), Math.round(8 * 1.5 * hour), version);
			assert.equal(amount(version, 'REST_DAY_OVERTIME'), Math.round(6 * 2 * hour), version);
			assert.equal(amount(version, 'NIGHT_WORK'), Math.round((2 + 8) * 0.3 * hour), version);
			// Two night overtime hours on a day with day-time overtime: 20% of the 150% hour.
			assert.equal(amount(version, 'NIGHT_OVERTIME'), Math.round(2 * 1.5 * 0.2 * hour), version);
			assert.equal(amount(version, 'NO_PAY_LEAVE'), Math.round((2 * 26_000_000) / 22), version);
		}
		// Without planned shifts the record's fallback divisor is 26 days of 8 hours.
		const unplanned = {
			...salaryContext,
			period: { ...salaryContext.period, working_days: 0 },
			work: {
				...salaryContext.work,
				days: [day('2026-10-05', { day_type: '', overtime_hours: 2 })]
			}
		};
		const ot = rows('version_4', 'work_catalog').find((item) => item.code === 'OVERTIME')!;
		assert.equal(Number(evaluateConfigured(String(ot.rate), unplanned)), 1.5 * 125_000);
	});

	it('SI, HI and the union fee follow the reference-level cap and floor of each version', () => {
		assert.deepEqual(charge('version_1', 'SI', 10_000_000), {
			employee: 800_000,
			employer: 1_750_000
		});
		assert.deepEqual(charge('version_1', 'SI', 60_000_000), {
			employee: 3_744_000,
			employer: 8_190_000
		});
		assert.deepEqual(charge('version_3', 'SI', 60_000_000), {
			employee: 3_744_000,
			employer: 8_190_000
		});
		assert.deepEqual(charge('version_4', 'SI', 60_000_000), {
			employee: 4_048_000,
			employer: 8_855_000
		});
		assert.deepEqual(charge('version_1', 'SI', 1_000_000), {
			employee: 187_200,
			employer: 409_500
		});
		assert.deepEqual(charge('version_1', 'HI', 60_000_000), {
			employee: 702_000,
			employer: 1_404_000
		});
		assert.deepEqual(charge('version_4', 'HI', 60_000_000), {
			employee: 759_000,
			employer: 1_518_000
		});
		assert.deepEqual(charge('version_2', 'UNION_FEE', 60_000_000), {
			employee: 0,
			employer: 936_000
		});
		assert.deepEqual(charge('version_4', 'UNION_FEE', 60_000_000), {
			employee: 0,
			employer: 1_012_000
		});
	});

	it('unemployment insurance covers citizens on 20 regional minimum wages', () => {
		assert.deepEqual(charge('version_1', 'UI', 120_000_000), {
			employee: 992_000,
			employer: 992_000
		});
		assert.deepEqual(charge('version_2', 'UI', 120_000_000), {
			employee: 1_062_000,
			employer: 1_062_000
		});
		assert.deepEqual(charge('version_2', 'UI', 120_000_000, { residency_status: 'RESIDENT' }), {
			employee: 0,
			employer: 0
		});
	});

	it('union dues charge members only: 0.5% within 10% of the reference level', () => {
		const citizen = { residency_status: 'CITIZEN' };
		const member = { elections: { union_member: true } };
		assert.deepEqual(charge('version_1', 'UNION_DUES', 30_000_000), { employee: 0, employer: 0 });
		assert.deepEqual(charge('version_1', 'UNION_DUES', 30_000_000, citizen, member), {
			employee: 150_000,
			employer: 0
		});
		assert.equal(charge('version_1', 'UNION_DUES', 60_000_000, citizen, member).employee, 234_000);
		assert.equal(charge('version_4', 'UNION_DUES', 60_000_000, citizen, member).employee, 253_000);
	});

	it('PIT: the 2025 seven-rung scale, the 2026 five-rung scale and the 20% non-resident rate', () => {
		assert.equal(charge('version_1', 'PIT', 30_000_000).employee, 1_627_500);
		assert.equal(charge('version_2', 'PIT', 30_000_000).employee, 635_000);
		assert.equal(charge('version_4', 'PIT', 30_000_000).employee, 635_000);
		assert.equal(
			charge(
				'version_4',
				'PIT',
				50_000_000,
				{ residency_status: 'CITIZEN' },
				{ elections: { dependants: 1 } }
			).employee,
			1_805_000
		);
		assert.equal(charge('version_4', 'PIT', 15_000_000).employee, 0);
		assert.equal(
			charge('version_4', 'PIT', 30_000_000, { residency_status: 'NON_RESIDENT' }).employee,
			6_000_000
		);
		assert.throws(() => charge('version_4', 'PIT', 30_000_000, { residency_status: 'FOREIGNER' }));
	});

	it('PIT from July 2026: voluntary pension deduction, 10% on short contracts above 5,000,000', () => {
		const citizen = { residency_status: 'CITIZEN' };
		const base = charge('version_4', 'PIT', 30_000_000, citizen).employee;
		assert.equal(base, 635_000);
		// At most 3,000,000 off taxable income: 11,350,000 falls to 8,350,000, all in the 5% rung.
		assert.equal(
			charge('version_4', 'PIT', 30_000_000, citizen, {
				elections: { voluntary_pension_contribution: 5_000_000 }
			}).employee,
			417_500
		);
		const short = { employment: { start_date: '2026-08-01', exit_date: '2026-09-30' } };
		assert.equal(charge('version_4', 'PIT', 30_000_000, citizen, short).employee, 3_000_000);
		assert.equal(charge('version_4', 'PIT', 4_000_000, citizen, short).employee, 0);
		assert.equal(
			charge('version_4', 'PIT', 30_000_000, citizen, {
				...short,
				elections: { commitment_form: true }
			}).employee,
			0
		);
		// Three months or longer is withheld on the progressive scale.
		const quarter = { employment: { start_date: '2026-07-01', exit_date: '2026-09-30' } };
		assert.equal(charge('version_4', 'PIT', 30_000_000, citizen, quarter).employee, base);
		assert.equal(
			charge('version_4', 'PIT', 30_000_000, { residency_status: 'NON_RESIDENT' }, short).employee,
			6_000_000
		);
	});

	it('the regional minimum wage per version', () => {
		const wage = (version: string) =>
			(
				rows(version, 'rule_set').find(
					(row) => row.family === 'PAYROLL' && row.code === 'minimum_wage'
				)?.rules as { by_region: Row }
			).by_region;
		assert.deepEqual(wage('version_1'), {
			I: 4_960_000,
			II: 4_410_000,
			III: 3_860_000,
			IV: 3_450_000
		});
		for (const version of ['version_2', 'version_3', 'version_4'])
			assert.deepEqual(wage(version), {
				I: 5_310_000,
				II: 4_730_000,
				III: 4_140_000,
				IV: 3_700_000
			});
	});

	it('annual leave: 12 days, pro rata in the first year, one more day every five years', () => {
		const annual = rows('version_4', 'leave_catalog').find((row) => row.code === 'ANNUAL_LEAVE');
		const entitlement = annual?.entitlement as Parameters<typeof entitlementDays>[0];
		assert.equal(entitlementDays(entitlement, 6, LEAVE_SUBJECT), 6);
		assert.equal(entitlementDays(entitlement, 12, LEAVE_SUBJECT), 12);
		assert.equal(entitlementDays(entitlement, 59, LEAVE_SUBJECT), 12);
		assert.equal(entitlementDays(entitlement, 60, LEAVE_SUBJECT), 13);
		assert.equal(entitlementDays(entitlement, 130, LEAVE_SUBJECT), 14);
		assert.equal(annual?.entitlement && (annual.entitlement as Row).window, 'CALENDAR_YEAR');
		// Labour Code art.113(1): 14 days for arduous work, a minor or a disabled employee, 16 for especially arduous.
		const as = (terms: Row, employee: Row = {}) => ({
			...LEAVE_SUBJECT,
			terms: { ...LEAVE_SUBJECT.terms, ...terms },
			employee: { ...LEAVE_SUBJECT.employee, ...employee }
		});
		assert.equal(entitlementDays(entitlement, 70, as({ work_classification: 'ARDUOUS' })), 15);
		assert.equal(
			entitlementDays(entitlement, 24, as({ work_classification: 'ESPECIALLY_ARDUOUS' })),
			16
		);
		assert.equal(entitlementDays(entitlement, 24, as({}, { age: 17 })), 14);
		assert.equal(entitlementDays(entitlement, 6, as({}, { disabled: true })), 7);
		// Law 41/2024 art.43(1): sick days a year by years of SI contribution, 10 more for arduous work.
		const sick = rows('version_4', 'leave_catalog').find((row) => row.code === 'SICK_LEAVE')
			?.entitlement as Parameters<typeof entitlementDays>[0] & { window?: string };
		assert.equal(sick.window, 'CALENDAR_YEAR');
		const sickDays = (years: number | null, terms: Row = {}) =>
			entitlementDays(
				sick,
				40,
				as(terms, { facts: years == null ? {} : { si_contribution_years: years } })
			);
		assert.equal(sickDays(10), 30);
		assert.equal(sickDays(15), 40);
		assert.equal(sickDays(30), 60);
		assert.equal(sickDays(10, { work_classification: 'ARDUOUS' }), 40);
		assert.equal(sickDays(null), 60);
		// Labour Code art.115: paid personal leave is a grant per event.
		for (const [code, grant] of [
			['MARRIAGE_LEAVE', 3],
			['CHILD_MARRIAGE_LEAVE', 1],
			['BEREAVEMENT_LEAVE', 3],
			['BEREAVEMENT_LEAVE_UNPAID', 1]
		] as const) {
			const row = rows('version_4', 'leave_catalog').find((item) => item.code === code);
			const held = row?.entitlement as Parameters<typeof entitlementDays>[0] & { window?: string };
			assert.equal(held.window, 'EVENT', code);
			assert.equal(entitlementDays(held, 40, LEAVE_SUBJECT), grant, code);
		}
		for (const version of VERSIONS)
			for (const row of rows(version, 'leave_catalog'))
				assert.equal(row.can_encash, row.code === 'ANNUAL_LEAVE', `${version} ${String(row.code)}`);
	});

	it('severance is half a month per year, odd months rounded to a half or a whole year', () => {
		const severance = (code: string, months: number) => {
			const row = rows('version_4', 'adhoc_catalog').find((item) => item.code === code);
			const [band] = row?.bands as { amount: string }[];
			assert.ok(band);
			return evaluateConfigured(band.amount, {
				...payslipContext,
				entry: entry({ qualifying_months: months })
			});
		};
		assert.equal(severance('SEVERANCE_ALLOWANCE', 36), 0.5 * 20_000_000 * 3);
		assert.equal(severance('SEVERANCE_ALLOWANCE', 41), 0.5 * 20_000_000 * 3.5);
		assert.equal(severance('SEVERANCE_ALLOWANCE', 42), 0.5 * 20_000_000 * 4);
		assert.equal(severance('JOB_LOSS_ALLOWANCE', 13), 20_000_000 * 2);
		assert.equal(severance('JOB_LOSS_ALLOWANCE', 48), 20_000_000 * 4);
	});

	it('behaviours admit payroll, and exit encashment prices VN annual leave', () => {
		for (const version of VERSIONS) {
			const behaviours = settings(version).behaviours as Behaviours;
			const planned = planBehaviours(
				behaviours,
				{ kind: 'catalog', catalog: 'WORK', event: 'PAYROLL_CREATE' },
				{ event: { data: { request: { kind: 'REGULAR', period: '2026-10' } } } }
			);
			assert.ok(planned.some((rule) => rule.id === 'payroll-run'));
			const annual = rows(version, 'leave_catalog').find((row) => row.code === 'ANNUAL_LEAVE');
			assert.ok(annual);
			const encash = behaviours.rules.find((rule) => rule.id === 'encash-leave-on-exit');
			assert.ok(encash);
			const days = (from: string, to: string, taken: number) =>
				effectWrites(
					encash,
					withSubjectBalances({
						event: {
							settings_id: settings(version).id,
							row: {
								id: 'c1',
								approval_id: null,
								exit_facts: {},
								prior_service_months: 0,
								effective_range: { from, to }
							}
						},
						catalogues: [
							{ id: annual.id, code: 'ANNUAL_LEAVE', unit: 'DAY', entitlement: annual.entitlement }
						],
						movements: [
							// Annual leave meters the calendar year: the days taken fall in the leaving year.
							{
								catalog_id: annual.id,
								activity: 'TIME_OFF',
								days: taken,
								reference: 'x',
								from: '2026-03-02',
								to: '2026-03-03',
								occurred_on: '2026-03-02'
							}
						]
					})
				).map((write) => (write.data as { days: number }).days);
			assert.deepEqual(days('2026-01-01', '2026-07-31', 2), [4]);
			assert.deepEqual(days('2020-01-01', '2026-07-31', 3), [10]);
		}
	});
	it('the UI cap follows the entity region; SI and the union fee read the entity facts', () => {
		const citizen = { residency_status: 'CITIZEN' };
		assert.deepEqual(
			charge('version_4', 'UI', 120_000_000, citizen, { company: { region: 'IV' } }),
			{
				employee: 740_000,
				employer: 740_000
			}
		);
		assert.equal(
			charge('version_1', 'UI', 120_000_000, citizen, { company: { region: 'II' } }).employee,
			882_000
		);
		assert.equal(charge('version_4', 'UI', 120_000_000).employee, 1_062_000);
		assert.equal(
			charge('version_4', 'PIT', 120_000_000, citizen, { company: { region: 'IV' } }).employee,
			20_185_900
		);
		assert.equal(charge('version_4', 'PIT', 120_000_000).employee, 20_089_300);
		const reduced = { company: { facts: { occupational_accident_reduced: true } } };
		for (const version of VERSIONS)
			assert.equal(charge(version, 'SI', 10_000_000, citizen, reduced).employer, 1_730_000);
		const cut = { company: { facts: { union_fee_reduction_percent: 20 } } };
		const suspended = { company: { facts: { union_fee_suspended: true } } };
		for (const version of ['version_3', 'version_4']) {
			assert.equal(charge(version, 'UNION_FEE', 10_000_000, citizen, cut).employer, 160_000);
			assert.equal(charge(version, 'UNION_FEE', 10_000_000, citizen, suspended).employer, 0);
		}
		assert.equal(
			charge('version_2', 'UNION_FEE', 10_000_000, citizen, suspended).employer,
			200_000
		);
	});

	it('maternity leave admits women and paternity leave men', () => {
		for (const version of VERSIONS) {
			const eligible = (code: string, gender: string) => {
				const row = rows(version, 'leave_catalog').find((item) => item.code === code);
				assert.ok(row);
				return evaluateConfigured(String(row.eligibility), {
					...admitContext,
					employee: { ...admitContext.employee, gender }
				});
			};
			assert.equal(eligible('MATERNITY_LEAVE', 'FEMALE'), true);
			assert.equal(eligible('MATERNITY_LEAVE', 'MALE'), false);
			assert.equal(eligible('PATERNITY_LEAVE', 'MALE'), true);
			assert.equal(eligible('PATERNITY_LEAVE', 'FEMALE'), false);
		}
	});

	it('stoppage for a co-worker or an objective cause pays the agreed share, floored at the regional minimum', () => {
		const line = (version: string, percent: number | null, region = 'I') => {
			const row = rows(version, 'work_catalog').find((item) => item.code === 'STOPPAGE_REDUCTION');
			assert.ok(row);
			const context = {
				...salaryContext,
				rules: payrollRules(version),
				company: { region, facts: percent == null ? {} : { stoppage_pay_percent: percent } },
				leave: {
					rows: [
						{
							code: 'STOPPAGE_OBJECTIVE',
							activity: 'TIME_OFF',
							days: 2,
							is_npl: false,
							can_encash: false
						},
						{
							code: 'STOPPAGE_EMPLOYER_FAULT',
							activity: 'TIME_OFF',
							days: 3,
							is_npl: false,
							can_encash: false
						}
					]
				}
			};
			if (evaluateConfigured(String(row.eligibility), context) !== true) return 0;
			return Math.round(
				Number(evaluateConfigured(String(row.quantity), context)) *
					Number(evaluateConfigured(String(row.rate), context))
			);
		};
		const day = 26_000_000 / 26;
		assert.equal(line('version_4', null), 0);
		assert.equal(line('version_4', 100), 0);
		assert.equal(line('version_4', 70), Math.round(2 * (day - 0.7 * day)));
		assert.equal(line('version_4', 10), Math.round(2 * (day - 5_310_000 / 26)));
		assert.equal(line('version_1', 10, 'IV'), Math.round(2 * (day - 3_450_000 / 26)));
	});

	it('obligations are rule_set rows whose due date evaluates for their trigger', () => {
		const contexts: { [trigger: string]: Row } = {
			PAYROLL_RUN: {
				period: { key: '2026-12', from: '2026-12-01', to: '2026-12-31' },
				company: COMPANY,
				headcount: 12
			},
			'leave_catalog_entry.created': {
				row: { catalog_code: 'SICK_LEAVE', from: '2026-10-05', to: '2026-10-09' },
				today: '2026-10-05',
				holidays: [],
				company: COMPANY
			},
			HIRE: { hired_on: '2026-10-15', contract: CONTRACT, employee: PROFILE, company: COMPANY },
			EXIT: { exit_on: '2026-10-31', contract: CONTRACT, employee: PROFILE, company: COMPANY },
			'entity.created': {
				row: COMPANY,
				period: { key: '2026-10', from: '2026-10-01', to: '2026-10-31' },
				company: COMPANY
			}
		};
		type Duty = {
			trigger: string;
			months?: string[];
			applies_when?: string;
			due: string;
			description: string;
			authority: string;
		};
		const duties = (version: string) =>
			new Map(
				dutiesOf(rows(version, 'rule_set')).map((row) => [
					String(row.code),
					{ ...(row.rules as Duty), trigger: triggerOf(row) }
				])
			);
		for (const version of VERSIONS) {
			const all = duties(version);
			assert.equal(all.size, version === 'version_4' ? 39 : 38, version);
			for (const [code, rules] of all) {
				const where = `${version} ${code}`;
				for (const key of Object.keys(rules)) assert.ok(DUTY_KEYS.includes(key), `${where}.${key}`);
				assert.ok(rules.description.length > 0 && rules.authority.length > 0, where);
				const context = contexts[rules.trigger];
				assert.ok(context, `${where} trigger ${rules.trigger}`);
				for (const month of rules.months ?? []) assert.match(month, /^(0[1-9]|1[0-2])$/, where);
				assert.match(String(evaluateConfigured(rules.due, context)), /^\d{4}-\d{2}-\d{2}$/, where);
				if (rules.applies_when !== undefined)
					assert.equal(typeof evaluateConfigured(rules.applies_when, context), 'boolean', where);
			}
		}
		const due = (version: string, code: string, context: Row) => {
			const rules = duties(version).get(code);
			assert.ok(rules, code);
			return evaluateConfigured(rules.due, context);
		};
		const period = (key: string, company: Row = COMPANY) => ({
			company,
			period: {
				key,
				from: `${key}-01`,
				to: String(evaluateConfigured(`month_end("${key}-01")`, {}))
			}
		});
		assert.equal(due('version_4', 'SI_HI_UI_MONTHLY_REMITTANCE', period('2026-10')), '2026-11-30');
		assert.equal(due('version_4', 'UNION_FEE_REMITTANCE', period('2026-10')), '2026-11-30');
		assert.equal(due('version_1', 'PIT_WITHHOLDING_DECLARATION', period('2025-12')), '2026-01-20');
		assert.equal(due('version_4', 'PIT_WITHHOLDING_DECLARATION', period('2026-09')), '2026-10-31');
		// A remittance raised every month; each month's tax is due with its quarter's return.
		assert.equal(due('version_4', 'PIT_WITHHOLDING_DECLARATION', period('2026-07')), '2026-10-31');
		assert.equal(due('version_4', 'PIT_WITHHOLDING_DECLARATION', period('2026-12')), '2027-01-31');
		assert.equal(due('version_4', 'DEPENDANT_TAX_REGISTRATION', period('2026-12')), '2026-12-31');
		assert.equal(due('version_2', 'LABOUR_USE_DECLARATION', period('2026-02')), '2026-03-03');
		assert.equal(due('version_4', 'PIT_ANNUAL_FINALISATION', period('2026-12')), '2027-03-31');
		assert.equal(due('version_4', 'LABOUR_USE_REPORT', period('2026-05')), '2026-06-04');
		assert.equal(due('version_4', 'LABOUR_USE_REPORT', period('2026-11')), '2026-12-04');
		assert.equal(
			due('version_4', 'SI_HI_UI_REGISTRATION', { hired_on: '2026-10-15' }),
			'2026-11-14'
		);
		assert.equal(
			due('version_4', 'PIT_TAX_REGISTRATION', { hired_on: '2026-10-15' }),
			'2027-01-31'
		);
		const exitOn = (exit_facts: Row) => ({
			exit_on: '2026-10-31',
			contract: { ...CONTRACT, exit_facts }
		});
		assert.equal(due('version_4', 'FINAL_SETTLEMENT', exitOn({})), '2026-11-14');
		assert.equal(
			due('version_4', 'FINAL_SETTLEMENT', exitOn({ final_settlement_extended: true })),
			'2026-11-30'
		);
		const quarterly = { ...COMPANY, facts: { pit_quarterly_filer: true } };
		assert.equal(
			due('version_3', 'PIT_WITHHOLDING_DECLARATION', period('2026-06', quarterly)),
			'2026-07-31'
		);
		const applies = (version: string, code: string, context: Row) => {
			const rules = duties(version).get(code);
			assert.ok(rules?.applies_when, code);
			return evaluateConfigured(rules.applies_when, context);
		};
		assert.equal(
			due('version_3', 'PIT_WITHHOLDING_DECLARATION', period('2026-05', quarterly)),
			'2026-07-31'
		);
		assert.equal(due('version_3', 'PIT_WITHHOLDING_DECLARATION', period('2026-05')), '2026-06-20');
		const hire = (nationality: string) => ({
			hired_on: '2026-10-15',
			contract: CONTRACT,
			employee: { ...PROFILE, nationality },
			company: COMPANY
		});
		assert.equal(applies('version_4', 'FOREIGN_WORK_PERMIT', hire('VN')), false);
		assert.equal(applies('version_4', 'FOREIGN_WORK_PERMIT', hire('JAPANESE')), true);
		const leaving = (exit_ground: string) => ({
			exit_on: '2026-10-31',
			contract: { ...CONTRACT, exit_ground },
			employee: PROFILE,
			company: COMPANY
		});
		assert.equal(applies('version_4', 'RESTRUCTURING_LABOUR_PLAN', leaving('RETRENCHMENT')), true);
		assert.equal(applies('version_4', 'RESTRUCTURING_LABOUR_PLAN', leaving('RESIGNATION')), false);
		assert.equal(applies('version_4', 'TERMINATION_NOTICE', leaving('DEATH')), false);
		assert.equal(applies('version_4', 'TERMINATION_NOTICE', leaving('END_OF_CONTRACT')), true);
		assert.equal(applies('version_4', 'OCCUPATIONAL_HEALTH_CHECK', period('2026-06')), false);
		assert.equal(
			applies(
				'version_4',
				'OCCUPATIONAL_HEALTH_CHECK',
				period('2026-06', { ...COMPANY, facts: { six_monthly_health_checks: true } })
			),
			true
		);
		assert.equal(
			applies(
				'version_4',
				'PDPL_IMPACT_ASSESSMENT',
				period('2026-12', { ...COMPANY, facts: { pdpl_exempt: true } })
			),
			false
		);
		assert.equal(
			applies(
				'version_4',
				'UNION_FEE_REMITTANCE',
				period('2026-10', { ...COMPANY, facts: { union_fee_suspended: true } })
			),
			false
		);
	});

	it('the canonical duty behaviours raise one obligation or task per duty, once', () => {
		for (const version of VERSIONS) {
			const row = settings(version);
			const behaviours = row.behaviours as Behaviours;
			const ruleRows = rows(version, 'rule_set');
			const duties = dutiesOf(ruleRows).map((item) => ({
				code: item.code,
				rules: { ...(item.rules as Row), trigger: triggerOf(item) } as Row
			}));
			const of = (trigger: string) => duties.filter((duty) => duty.rules.trigger === trigger);
			const company = [COMPANY];
			const employee = [{ ...PROFILE, nationality: 'JAPANESE' }];
			const raise = (collection: string, event: string, data: Row, raised: Row[] = []) =>
				raiseDuties({
					behaviours,
					settings_id: row.id,
					rows: ruleRows,
					collection,
					event,
					row: { id: 'c1', approval_id: null, company_id: 'co1', ...data },
					headcount: 12,
					reads: { company, employee, raised }
				});
			const run = (period: string, raised: Row[] = []) =>
				raise('payroll_run', 'created', { period }, raised);
			const december = run('2026-12');
			// COMPANY sets no fact, so every December or monthly duty applies (health checks: December only).
			const monthly = of('PAYROLL_RUN').filter((duty) => duty.rules.months == null);
			assert.equal(
				december.length,
				of('PAYROLL_RUN').filter(
					(duty) => duty.rules.months == null || (duty.rules.months as string[]).includes('12')
				).length
			);
			assert.equal(run('2026-10').length, monthly.length);
			for (const data of december) assert.match(String(data.due_on), /^\d{4}-\d{2}-\d{2}$/);
			const [first] = december;
			assert.ok(first);
			assert.equal(run('2026-12', [{ duty_code: first.duty_code }]).length, december.length - 1);
			const range = { from: '2026-10-15', to: '2026-12-31' };
			const hire = raise('employment_contract', 'created', {
				effective_range: range,
				exit_facts: null
			});
			assert.equal(hire.length, of('HIRE').length);
			assert.ok(hire.every((data) => data.triggered_on === '2026-10-15'));
			const exits = raise('employment_contract', 'updated', {
				effective_range: range,
				exit_facts: {},
				exit_ground: 'RETRENCHMENT'
			});
			assert.equal(exits.length, of('EXIT').length);
			assert.ok(exits.every((data) => data.triggered_on === '2026-12-31'));
			const opened = raise('entity', 'created', { id: 'co1', facts: {}, created_on: '2026-10-07' });
			assert.deepEqual(
				opened.map((data) => data.code ?? data.duty_code),
				['LABOUR_USE_DECLARATION']
			);
		}
	});

	it('validations: the regional minimum wage on contract terms, overtime limits and the 30% damage deduction', () => {
		const check = (version: string, code: string) => {
			const row = rows(version, 'rule_set').find(
				(item) => item.family === 'VALIDATIONS' && item.code === code
			);
			assert.ok(row, `${version} ${code}`);
			return row.rules as {
				site: string;
				kind: string;
				when: string;
				message: string;
				authority: string;
			};
		};
		for (const version of VERSIONS)
			for (const code of [
				'MINIMUM_WAGE_FLOOR',
				'OVERTIME_MONTHLY_CAP',
				'OVERTIME_DAILY_CAP',
				'DAMAGE_DEDUCTION_CEILING'
			]) {
				const rules = check(version, code);
				assert.ok(
					['contract', 'payslip'].includes(rules.site) && rules.message && rules.authority,
					code
				);
			}
		const floor = check('version_4', 'MINIMUM_WAGE_FLOOR');
		assert.equal(floor.site, 'contract');
		assert.equal(floor.kind, 'refuse');
		const term = (base_salary: number, region: string, employment_type = 'PERMANENT') => {
			const terms = { base_salary, employment_type, work_classification: 'ORDINARY', facts: {} };
			return evaluateConfigured(floor.when, {
				terms,
				term: terms,
				company: { region, facts: {} },
				rules: payrollRules('version_4'),
				employment: { start_date: '2024-01-01' }
			});
		};
		assert.equal(term(5_000_000, 'I'), true);
		assert.equal(term(5_310_000, 'I'), false);
		assert.equal(term(4_000_000, 'III'), true);
		assert.equal(term(3_800_000, ''), false); // an unrecorded region is held to Region IV
		assert.equal(term(3_600_000, ''), true);
		assert.equal(term(2_000_000, 'I', 'PART_TIME'), false);
		// Decree 293/2025 art.5(5): an incumbent whose worksite moved down keeps the prior region's 2025 floor.
		const reclassified = (start_date: string) =>
			evaluateConfigured(floor.when, {
				terms: {
					base_salary: 4_800_000,
					employment_type: 'PERMANENT',
					facts: { prior_floor_region: 'I', prior_floor_reclassified: true }
				},
				company: { region: 'II', facts: {} },
				rules: payrollRules('version_4'),
				employment: { start_date }
			});
		assert.equal(reclassified('2024-01-01'), true);
		assert.equal(reclassified('2026-02-01'), false);
		assert.equal(
			evaluateConfigured(check('version_1', 'MINIMUM_WAGE_FLOOR').when, {
				terms: { base_salary: 5_000_000, employment_type: 'PERMANENT', facts: {} },
				company: { region: 'I', facts: {} },
				rules: payrollRules('version_1'),
				employment: { start_date: '2024-01-01' }
			}),
			false
		);
		const day = (overtime_hours: number, extra: Row = {}) => ({
			date: '2026-10-05',
			day_type: 'WORK',
			holiday_kind: '',
			scheduled_hours: 8,
			worked_hours: 8 + overtime_hours,
			overtime_hours,
			intervals: [],
			...extra
		});
		const slip = (days: Row[], facts: Row = {}, payslip: Row = {}) => ({
			...salaryContext,
			terms: { ...salaryContext.terms, facts },
			work: { ...salaryContext.work, holidays: [], days },
			payslip: { gross: 30_000_000, statutory_employee: 3_000_000, lines: {}, ...payslip }
		});
		const trips = (code: string, context: Row) =>
			evaluateConfigured(check('version_4', code).when, context);
		assert.equal(
			trips('OVERTIME_MONTHLY_CAP', slip(Array.from({ length: 10 }, () => day(4)))),
			false
		);
		assert.equal(
			trips(
				'OVERTIME_MONTHLY_CAP',
				slip([
					...Array.from({ length: 10 }, () => day(4)),
					day(0, { day_type: 'REST', scheduled_hours: 0, worked_hours: 1 })
				])
			),
			true
		);
		assert.equal(trips('OVERTIME_DAILY_CAP', slip([day(4)])), false);
		assert.equal(trips('OVERTIME_DAILY_CAP', slip([day(5)])), true);
		assert.equal(
			trips(
				'OVERTIME_DAILY_CAP',
				slip([day(4, { scheduled_hours: 9 })], { normal_hours_arrangement: 'WEEKLY' })
			),
			true
		);
		assert.equal(check('version_4', 'DAMAGE_DEDUCTION_CEILING').kind, 'hold');
		assert.equal(
			trips(
				'DAMAGE_DEDUCTION_CEILING',
				slip([], {}, { lines: { PROPERTY_DAMAGE_COMPENSATION: -8_100_000 } })
			),
			false
		);
		assert.equal(
			trips(
				'DAMAGE_DEDUCTION_CEILING',
				slip([], {}, { lines: { PROPERTY_DAMAGE_COMPENSATION: -8_200_000 } })
			),
			true
		);
	});

	it('tasks read the headcount and the leave class; a half-month pays half the month', () => {
		for (const version of VERSIONS) {
			const row = settings(version);
			const ruleRows = rows(version, 'rule_set');
			const raise = (collection: string, event: string, data: Row, headcount: number) =>
				raiseDuties({
					behaviours: row.behaviours as Behaviours,
					settings_id: row.id,
					rows: ruleRows,
					collection,
					event,
					row: { id: 'r1', approval_id: null, company_id: 'co1', ...data },
					headcount,
					reads: { company: [COMPANY], employee: [PROFILE], raised: [] }
				}).map((data) => String(data.code ?? data.duty_code));
			assert.ok(
				raise('payroll_run', 'created', { period: '2026-12' }, 10).includes('INTERNAL_LABOUR_RULES')
			);
			assert.ok(
				!raise('payroll_run', 'created', { period: '2026-12' }, 9).includes('INTERNAL_LABOUR_RULES')
			);
			const leave = (catalog_code: string) =>
				raise(
					'leave_catalog_entry',
					'created',
					{
						catalog_code,
						employment_id: 'k1',
						from: '2026-10-05',
						to: '2026-10-09',
						occurred_on: '2026-10-05'
					},
					3
				);
			assert.deepEqual(leave('SICK_LEAVE'), ['SI_BENEFIT_CLAIMS']);
			assert.deepEqual(leave('ANNUAL_LEAVE'), []);
			const claim = dutiesOf(ruleRows).find((duty) => duty.code === 'SI_BENEFIT_CLAIMS')!;
			assert.equal(
				evaluateConfigured(String((claim.rules as Row).due), {
					row: { to: '2026-10-09' },
					today: '2026-10-05',
					holidays: []
				}),
				'2026-10-20'
			);
		}
		const half = {
			...salaryContext,
			period: {
				...salaryContext.period,
				key: '2026-10-1',
				from: '2026-10-01',
				to: '2026-10-15',
				days: 15,
				paid_days: 15,
				working_days: 13,
				part: 1,
				parts: 2
			}
		};
		const amount = (code: string) => {
			const line = rows('version_4', 'work_catalog').find((item) => item.code === code)!;
			return Math.round(
				Number(evaluateConfigured(String(line.quantity), half)) *
					Number(evaluateConfigured(String(line.rate), half))
			);
		};
		assert.equal(amount('BASIC'), 13_000_000);
		assert.equal(amount('NO_PAY_LEAVE'), 2_000_000); // two days of 26,000,000 ÷ 26 working days
	});

	it('14 unpaid working days, the annual overtime cap, per-birth paternity and the customer-input facts', () => {
		const citizen = { residency_status: 'CITIZEN' };
		for (const version of VERSIONS) {
			for (const code of ['SI', 'UI', 'UNION_FEE'])
				assert.deepEqual(
					charge(version, code, 10_000_000, citizen, { unpaid: 14 }),
					{ employee: 0, employer: 0 },
					`${version} ${code}`
				);
			assert.notEqual(charge(version, 'SI', 10_000_000, citizen, { unpaid: 13 }).employee, 0);
			// Continued SI by agreement keeps SI; UI stays exempt (Law 74/2025 art.33(4)).
			assert.notEqual(
				charge(version, 'SI', 10_000_000, citizen, {
					unpaid: 14,
					elections: { unpaid_leave_continuation: true }
				}).employee,
				0
			);
			assert.equal(
				charge(version, 'UI', 10_000_000, citizen, {
					unpaid: 14,
					elections: { unpaid_leave_continuation: true }
				}).employee,
				0
			);
			// HI is not exempted: the unpaid-day waiver is not verified for health insurance.
			assert.notEqual(charge(version, 'HI', 10_000_000, citizen, { unpaid: 20 }).employee, 0);
			// The State-sector dues base: 0.5% of take-home pay after SI, HI, UI and PIT.
			const member = { elections: { union_member: true } };
			const soe = charge(version, 'UNION_DUES', 10_000_000, citizen, {
				...member,
				company: { facts: { state_owned_enterprise: true } }
			});
			assert.equal(soe.employee, Math.round((10_000_000 - 1_050_000) * 0.005));
		}
		const annual = rows('version_4', 'rule_set').find((row) => row.code === 'OVERTIME_ANNUAL_CAP')!
			.rules as Row;
		const year = (overtime: number, rest: number, facts: Row = {}) =>
			evaluateConfigured(String(annual.when), {
				company: { region: 'I', facts },
				hours: {
					year: {
						overtime_hours: overtime + rest,
						day_type: { WORK: { overtime_hours: overtime }, REST: { worked_hours: rest } },
						holiday_kind: {}
					}
				}
			});
		assert.equal(year(190, 10), false);
		assert.equal(year(190, 11), true);
		assert.equal(year(250, 0, { overtime_300h_sector: true }), false);
		assert.equal(
			evaluateConfigured(String(annual.when), { company: { facts: {} }, hours: { year: {} } }),
			false
		);
		const paternity = (version: string, facts: Row) =>
			entitlementDays(
				rows(version, 'leave_catalog').find((row) => row.code === 'PATERNITY_LEAVE')!
					.entitlement as Parameters<typeof entitlementDays>[0],
				12,
				{ ...LEAVE_SUBJECT, entry: { facts } }
			);
		assert.equal(paternity('version_4', {}), 5);
		assert.equal(paternity('version_4', { caesarean: true }), 7);
		assert.equal(paternity('version_4', { premature_under_32_weeks: true }), 7);
		assert.equal(paternity('version_4', { children_born: 2 }), 10);
		assert.equal(paternity('version_4', { children_born: 3 }), 13);
		assert.equal(paternity('version_4', { children_born: 2, caesarean: true }), 14);
		assert.equal(paternity('version_4', { second_child: true }), 10);
		assert.equal(paternity('version_3', { second_child: true }), 5);
		const remit = rows('version_4', 'rule_set').find((row) => row.code === 'UNION_FEE_REMITTANCE')!
			.rules as Row;
		const due = (facts: Row) =>
			evaluateConfigured(String(remit.due), {
				period: { key: '2026-07', from: '2026-07-01', to: '2026-07-31' },
				company: { facts }
			});
		assert.equal(due({}), '2026-08-31');
		assert.equal(due({ union_fee_quarterly: true }), '2026-10-31');
	});

	it('an off-cycle bonus before or after the regular run settles the same month totals', async () => {
		const COMPANY_ID = 'c0000000-0000-4000-8000-0000000000vn';
		const law = (name: string): Row[] =>
			VERSIONS.flatMap((version) => rows(version, name)).map((row) => ({
				approval_id: null,
				...row
			}));
		let tables = new Map<string, Row[]>();
		const reset = () => {
			tables = new Map<string, Row[]>([
				...[...FILES].map((name) => [name, law(name)] as [string, Row[]]),
				[
					'entity',
					[
						{
							id: COMPANY_ID,
							name: 'Sông Hồng',
							settings_code: 'VN',
							pay_frequency: 'MONTHLY',
							region: 'I',
							facts: {},
							approval_id: null
						}
					]
				],
				[
					'employment_profile',
					[
						{
							id: 'e1',
							name: 'Lan',
							date_of_birth: '1990-05-01',
							nationality: 'VN',
							gender: 'FEMALE'
						},
						{
							id: 'e2',
							name: 'Minh',
							date_of_birth: '1985-02-11',
							nationality: 'VN',
							gender: 'MALE'
						}
					]
				],
				[
					'employment_contract',
					[
						['e1', 30_000_000],
						['e2', 70_000_000]
					].map(([id, salary]) => ({
						id: `k-${String(id)}`,
						employee_id: id,
						company_id: COMPANY_ID,
						approval_id: null,
						effective_range: { from: '2024-01-01', to: null },
						facts: {
							contract_terms: [
								{
									base_salary: { value: salary, currency: 'VND' },
									effective_range: { from: '2024-01-01', to: null },
									residency_status: 'CITIZEN',
									work_classification: 'ORDINARY',
									employment_type: 'PERMANENT',
									allowances: []
								}
							]
						}
					}))
				]
			]);
		};
		const clause = (row: Row, key: string, spec: unknown): boolean => {
			const value = row[key] as string | number | null | undefined;
			if (spec == null || typeof spec !== 'object') return value === spec;
			return Object.entries(spec as Row).every(([op, operand]) => {
				if (op === 'eq') return value === operand;
				if (op === 'in') return Array.isArray(operand) && operand.includes(value);
				if (op === 'isNull') return operand ? value == null : value != null;
				if (op === 'gte') return value != null && value >= (operand as string);
				if (op === 'lte') return value != null && value <= (operand as string);
				throw new Error(`fixture reader: unsupported operator ${op}`);
			});
		};
		const reads = {
			read: (collection: unknown, query: unknown) => {
				const { where = {}, select = {} } = query as { where?: Row; select?: Row };
				return Effect.succeed({
					rows: (tables.get(String(collection)) ?? [])
						.filter((row) => Object.entries(where).every(([key, spec]) => clause(row, key, spec)))
						.map((row) =>
							Object.fromEntries(
								Object.keys(select)
									.filter((key) => key in row)
									.map((key) => [key, row[key]])
							)
						)
				});
			}
		};
		let runs = 0;
		const run = async (kind: PayrollRunKind, sources?: string[]) => {
			const plan = await Effect.runPromise(
				buildPayrollRun({
					company_id: COMPANY_ID,
					period: '2026-08',
					kind,
					...(sources == null ? {} : { sources })
				}).pipe(Effect.provideService(Reads, reads))
			);
			const id = `run-${++runs}`;
			const held = (name: string) => {
				if (!tables.has(name)) tables.set(name, []);
				return tables.get(name)!;
			};
			held('payroll_run').push({ ...plan.run, id });
			for (const slip of plan.payslips) {
				const slipId = `${id}-${slip.employment_id}`;
				held('payslip').push({ ...slip, id: slipId, payroll_run_id: id });
				for (const pin of slip.pins) {
					const row = held(pin.collection).find((candidate) => candidate.id === pin.id)!;
					row.payslip_id = slipId;
				}
			}
			return plan;
		};
		const bonus = () => {
			const v4 = settings('version_4').id;
			const catalogId = law('adhoc_catalog').find(
				(row) => row.code === 'BONUS' && row.settings_id === v4
			)!.id;
			if (!tables.has('adhoc_catalog_entry')) tables.set('adhoc_catalog_entry', []);
			tables.get('adhoc_catalog_entry')!.push({
				id: 'bonus-1',
				employment_id: 'k-e1',
				company_id: COMPANY_ID,
				catalog_id: catalogId,
				approval_id: null,
				payslip_id: null,
				occurred_on: '2026-08-05',
				amount: 40_000_000
			});
		};
		type Plan = Awaited<ReturnType<typeof run>>;
		const totals = (plans: Plan[]) => {
			const out: { [key: string]: number } = {};
			for (const line of plans.flatMap((plan) => plan.payslips).flatMap((slip) => slip.statutory)) {
				out[`${line.scheme_code}.employee`] =
					(out[`${line.scheme_code}.employee`] ?? 0) + line.employee_amount;
				out[`${line.scheme_code}.employer`] =
					(out[`${line.scheme_code}.employer`] ?? 0) + line.employer_amount;
			}
			return Object.fromEntries(
				Object.entries(out).map(([key, value]) => [key, Math.round(value * 100) / 100])
			);
		};
		reset();
		bonus();
		const before = [await run('OFF_CYCLE', ['bonus-1']), await run('REGULAR')];
		reset();
		const regular = await run('REGULAR');
		bonus();
		const after = [regular, await run('OFF_CYCLE', ['bonus-1'])];
		const first = totals(before);
		assert.deepEqual(first, totals(after));
		for (const scheme of ['SI', 'HI', 'UI', 'UNION_FEE', 'PIT'])
			assert.ok(
				(first[`${scheme}.employee`] ?? 0) + (first[`${scheme}.employer`] ?? 0) > 0,
				scheme
			);
		// The 40,000,000 bonus sits outside the insurance salary: SI on 30,000,000 and 50,600,000 only, and PIT
		// deducts the insurance actually charged — taxable 70,000,000 − 3,150,000 − 15,500,000 for Lan.
		assert.equal(first['SI.employee'], 30_000_000 * 0.08 + 50_600_000 * 0.08);
		const lan = 70_000_000 - 3_150_000 - 15_500_000;
		const minh = 70_000_000 - 50_600_000 * 0.095 - 700_000 - 15_500_000;
		// Both fall in the 20% rung (30,000,000 to 60,000,000).
		const pit = (taxable: number) => Math.round(500_000 + 2_000_000 + (taxable - 30_000_000) * 0.2);
		assert.equal(first['PIT.employee'], pit(lan) + pit(minh));
	});

	it('both input schemas are JSON Schema 2020-12 and declare every fact the CEL reads', () => {
		const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
		const valid = (node: unknown, where: string): void => {
			assert.ok(node != null && typeof node === 'object' && !Array.isArray(node), where);
			const schema = node as Row;
			for (const type of [schema.type ?? []].flat())
				assert.ok(TYPES.has(String(type)), `${where}.type`);
			if (schema.enum !== undefined)
				assert.ok(Array.isArray(schema.enum) && schema.enum.length > 0, `${where}.enum`);
			if (schema.required !== undefined)
				assert.ok(Array.isArray(schema.required), `${where}.required`);
			if (schema.items !== undefined) valid(schema.items, `${where}.items`);
			if (schema.properties !== undefined)
				for (const [key, child] of Object.entries(schema.properties as Row))
					valid(child, `${where}.${key}`);
		};
		const CEL = new Set([
			'eligibility',
			'qualifies_when',
			'quantity',
			'rate',
			'amount',
			'when',
			'employee',
			'employer',
			'contribution',
			'assessment',
			'due',
			'days',
			'effect'
		]);
		for (const version of VERSIONS) {
			const row = settings(version);
			const employee = row.employee_input_schema as Row & { properties: Row };
			const entity = row.entity_input_schema as Row & { properties: Row };
			for (const [name, schema] of [
				['employee', employee],
				['entity', entity]
			] as const) {
				assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', name);
				valid(schema, `${version} ${name}`);
			}
			assert.deepEqual(Object.keys(employee.properties).toSorted(), [
				'contract_terms',
				'employment_statutory_facts',
				'exit_facts',
				'facts'
			]);
			const status = (
				(employee.properties.employment_statutory_facts as Row).items as { properties: Row }
			).properties;
			assert.deepEqual(Object.keys(status).toSorted(), [
				'effective_range',
				'status',
				'statutory_contribution_id'
			]);
			for (const column of ['region', 'risk_class', 'gender', 'dependents_count', 'nationality'])
				assert.equal(
					column in entity.properties ||
						column in (employee.properties.facts as { properties: Row }).properties,
					false,
					column
				);
			const props = (schema: unknown) =>
				new Set(Object.keys(((schema as Row | undefined)?.properties ?? {}) as Row));
			const declared = {
				employee: props(employee.properties.facts),
				company: props(entity),
				terms: props((employee.properties.contract_terms as Row).items),
				term_facts: props(
					((employee.properties.contract_terms as Row).items as { properties: Row }).properties
						.facts
				),
				exit: props(employee.properties.exit_facts),
				elections: props((status.status as { properties: Row }).properties.elections)
			};
			const expressions: string[] = [];
			const walk = (value: unknown, key = ''): void => {
				if (typeof value === 'string') {
					if (CEL.has(key)) expressions.push(value);
				} else if (Array.isArray(value)) value.forEach((item) => walk(item, key));
				else if (value != null && typeof value === 'object')
					for (const [child, item] of Object.entries(value))
						walk(item, key === 'assessable' || key === 'person' ? 'when' : child);
			};
			for (const file of FILES) walk(rows(version, file));
			assert.ok(
				expressions.some((expression) => expression.includes('company.facts.')),
				version
			);
			assert.ok(
				expressions.some((expression) => expression.includes('scheme.elections.')),
				version
			);
			for (const expression of expressions) {
				for (const [, root, fact] of expression.matchAll(
					/\b(employee|company)\.facts\.([a-z0-9_]+)/g
				))
					assert.ok(
						declared[root as 'employee' | 'company'].has(String(fact)),
						`${version} ${root}.facts.${fact}`
					);
				for (const [, fact] of expression.matchAll(
					/\b(?:scheme\.elections|elections\.[A-Z_]+)\.([a-z_]+)/g
				))
					assert.ok(declared.elections.has(String(fact)), `${version} elections.${fact}`);
				for (const [, fact] of expression.matchAll(/\bterms\.facts\.([a-z_]+)/g))
					assert.ok(declared.term_facts.has(String(fact)), `${version} terms.facts.${fact}`);
				for (const [, fact] of expression.matchAll(
					/\b(?:contract|employment)\.exit_facts\.([a-z_]+)/g
				))
					assert.ok(declared.exit.has(String(fact)), `${version} exit_facts.${fact}`);
				for (const [, fact] of expression.matchAll(/\bterms\.(?!facts\.)([a-z_]+)/g))
					assert.ok(
						declared.terms.has(String(fact)) || fact === 'monthly_wage',
						`${version} terms.${fact}`
					);
			}
		}
	});
});
