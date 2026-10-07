import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { Effect, Schema } from 'effect';
import { Decimal } from '@norbital-ai/std/decimal';
import {
	Behaviour,
	behavioursOf,
	effectWrites,
	planBehaviours,
	resolveWhere,
	triggerMatches
} from '../src/lib/payroll_engine/behaviours.js';
import { evaluateConfigured } from '../src/lib/payroll_engine/expressions.js';
import { moneyNumber, Reads } from '../src/lib/payroll_engine/foundation.js';
import { raiseDuties, withBalances } from './duties.ts';
import {
	admitContractTerms,
	buildPayrollRun,
	type PayrollRunKind,
	settlementPeriod,
	transformEntries
} from '../src/lib/payroll_engine/services.js';

/**
 * The engine's probes over the public SG seed: regular runs, the salary-less settlement paid before its month's
 * regular run, and one regression per statutory and settlement defect. People are fixtures here, never the bank.
 */

type Row = Record<string, unknown>;
const seed = resolve(process.cwd(), 'seed/jurisdiction/SG');
const law = (name: string): Row[] =>
	readdirSync(seed)
		.filter((entry) => entry.startsWith('version_'))
		.flatMap((dir) => {
			const path = resolve(seed, dir, `${name}.json`);
			return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Row[]) : [];
		});

const COMPANY = 'c0000000-0000-4000-8000-000000000001';
const people = [
	{
		id: 'e1',
		name: 'Kavriel',
		date_of_birth: '1993-04-18',
		race: 'CHINESE',
		religion: 'OTHER',
		salary: 6500,
		residency: 'PERMANENT_RESIDENT',
		since: '2019-01-01'
	},
	{
		id: 'e2',
		name: 'Shelly',
		date_of_birth: '1990-11-02',
		race: 'CHINESE',
		religion: 'OTHER',
		salary: 5500,
		residency: 'CITIZEN'
	},
	{
		id: 'e3',
		name: 'Dernese',
		date_of_birth: '1997-06-30',
		race: 'CHINESE',
		religion: 'OTHER',
		salary: 4800,
		residency: 'CITIZEN'
	}
];
const contractOf = (person: (typeof people)[number], extra: Row = {}): Row => ({
	id: `k-${person.id}`,
	employee_id: person.id,
	company_id: COMPANY,
	approval_id: null,
	effective_range: { from: '2019-01-01', to: null },
	facts: {
		contract_terms: [
			{
				base_salary: { value: person.salary, currency: 'SGD' },
				effective_range: { from: '2019-01-01', to: null },
				residency_status: person.residency,
				...(person.since == null ? {} : { residency_since: person.since }),
				work_classification: 'EA_COVERED',
				statutory_work_category: 'NON_MANUAL',
				employment_type: 'PERMANENT',
				// a Monday-to-Friday week: s.20A prices a part month and a day by its working days
				shift_pattern_id: 'p-week',
				allowances: [],
				...extra
			}
		]
	}
});

let tables: Map<string, Row[]>;
const reset = () => {
	tables = new Map<string, Row[]>([
		...[
			'jurisdiction_settings',
			'statutory_contribution_catalog',
			'work_catalog',
			'allowance_catalog',
			'adhoc_catalog',
			'claim_catalog',
			'leave_catalog',
			'loan_catalog'
		].map(
			(name) => [name, law(name).map((row) => ({ approval_id: null, ...row }))] as [string, Row[]]
		),
		[
			'entity',
			[
				{
					id: COMPANY,
					name: 'Omni',
					settings_code: 'SG',
					pay_frequency: 'MONTHLY',
					approval_id: null
				}
			]
		],
		[
			'employment_profile',
			people.map(({ salary: _s, residency: _r, since: _x, ...person }) => ({ ...person }))
		],
		['employment_contract', people.map((person) => contractOf(person))],
		[
			'shift_definition',
			[
				{
					id: 'sd-work',
					company_id: COMPANY,
					code: 'DAY',
					variant: { day_type: 'WORK', start_time: '09:00', end_time: '18:00', break_minutes: 60 }
				},
				{ id: 'sd-rest', company_id: COMPANY, code: 'REST', variant: { day_type: 'REST' } }
			]
		],
		[
			'shift_pattern',
			[
				{
					id: 'p-week',
					company_id: COMPANY,
					// anchored on Monday 31 December 2018
					effective_range: { from: '2018-12-31', to: null },
					pattern: {
						days: [
							...Array.from({ length: 5 }, () => ({ roster_code_id: 'sd-work' })),
							{ roster_code_id: 'sd-rest' },
							{ roster_code_id: 'sd-rest' }
						]
					}
				}
			]
		],
		...[
			'adhoc_catalog_entry',
			'claim_catalog_entry',
			'leave_catalog_entry',
			'loan_catalog_entry',
			'roster_entry',
			'holiday',
			'payslip',
			'payroll_run'
		].map((name) => [name, []] as [string, Row[]])
	]);
};

const clause = (row: Row, key: string, spec: unknown): boolean => {
	const value = row[key] as string | number | null | undefined;
	if (spec == null || typeof spec !== 'object') return value === spec;
	const held = spec as Record<string, unknown>;
	return Object.entries(held).every(([op, operand]) => {
		if (op === 'eq') return value === operand;
		if (op === 'in') return Array.isArray(operand) && operand.includes(value);
		if (op === 'isNull') return operand ? value == null : value != null;
		if (op === 'gte') return value != null && value >= (operand as string);
		if (op === 'lte') return value != null && value <= (operand as string);
		throw new Error(`fixture reader: unsupported operator ${op}`);
	});
};
/** Like the host: a read without `select` would leave json fields out, so the fixture refuses one, and projects. */
const reads = {
	read: (collection: unknown, query: unknown) => {
		const { where = {}, select } = query as { where?: Row; select?: Row };
		if (select == null)
			throw new Error(`fixture reader: ${String(collection)} read without select`);
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
const run = async (period: string, kind: PayrollRunKind, sources?: string[]) => {
	const plan = await Effect.runPromise(
		buildPayrollRun({
			company_id: COMPANY,
			period,
			kind,
			...(sources == null ? {} : { sources })
		}).pipe(Effect.provideService(Reads, reads))
	);
	const id = `run-${++runs}`;
	tables.get('payroll_run')!.push({ ...plan.run, id });
	for (const slip of plan.payslips) {
		const slipId = `${id}-${slip.employment_id}`;
		tables.get('payslip')!.push({ ...slip, id: slipId, payroll_run_id: id });
		for (const pin of slip.pins) {
			const row = tables.get(pin.collection)!.find((candidate) => candidate.id === pin.id)!;
			row.payslip_id = slipId;
		}
	}
	return plan;
};
const refused = (period: string, kind: PayrollRunKind, sources?: string[]) =>
	Effect.runPromise(
		Effect.flip(
			buildPayrollRun({
				company_id: COMPANY,
				period,
				kind,
				...(sources == null ? {} : { sources })
			}).pipe(Effect.provideService(Reads, reads))
		)
	).then((error) => error.message);

type Plan = Awaited<ReturnType<typeof run>>;
const slip = (plan: Plan, person: string) =>
	plan.payslips.find((row) => row.employment_id === `k-${person}`)!;
const line = (plan: Plan, person: string, scheme: string) =>
	slip(plan, person).statutory.find((row) => row.scheme_code === scheme);
const total = (plans: Plan[], scheme: string, field: 'employee_amount' | 'employer_amount') =>
	plans
		.flatMap((plan) => plan.payslips)
		.flatMap((row) => row.statutory)
		.filter((row) => row.scheme_code === scheme)
		.reduce((sum, row) => sum + row[field], 0);
const catalog = (name: string, code: string, period: string) =>
	String(
		tables.get(name)!.find((row) => {
			const version = tables
				.get('jurisdiction_settings')!
				.find((settings) => settings.id === row.settings_id)!;
			const range = version.effective_range as { from: string; to: string | null };
			return (
				row.code === code &&
				range.from <= `${period}-01` &&
				(range.to == null || range.to >= `${period}-01`)
			);
		})!.id
	);
const entry = (
	collection: string,
	id: string,
	person: string,
	catalogId: string,
	occurred_on: string,
	fields: Row,
	activity?: string
) =>
	tables.get(collection)!.push({
		id,
		employment_id: `k-${person}`,
		company_id: COMPANY,
		catalog_id: catalogId,
		approval_id: null,
		payslip_id: null,
		occurred_on,
		// Each entry family stores its own columns; there is no union blob any more.
		...fields,
		...(activity == null ? {} : { activity })
	});

/** A money column reaches a record view as a number, a decimal string, a `$dec` tag or a `{ value }` envelope; an
 * unsettled column must read as "no amount" rather than refuse, or the payslip view takes the whole page down. */
test('moneyNumber reads every wire shape of a money column, and null when there is none', () => {
	assert.equal(moneyNumber(1234.5), 1234.5);
	assert.equal(moneyNumber(Decimal.of('7397.00')), 7397);
	assert.equal(moneyNumber(Decimal.of('-1600.00')), -1600);
	assert.equal(moneyNumber('-0.07'), -0.07);
	assert.equal(moneyNumber({ value: 3193.55, currency: 'SGD' }), 3193.55);
	assert.equal(moneyNumber({ $dec: '12.30' }), 12.3);
	assert.equal(moneyNumber(null), null);
	assert.equal(moneyNumber(undefined), null);
	assert.equal(moneyNumber({}), null);
	assert.equal(moneyNumber('  '), null);
	assert.equal(moneyNumber(Number.NaN), null);
	assert.equal(moneyNumber(Number.POSITIVE_INFINITY), null);
});

test('SG regular run: 2026 Table 1 rates, CDAC bands, SDL cap', async () => {
	reset();
	const plan = await run('2026-01', 'REGULAR');
	assert.deepEqual(
		plan.payslips.map((row) => row.net).sort((a, b) => a - b),
		[3838.5, 4398, 5198]
	);
	assert.equal(total([plan], 'CPF', 'employee_amount'), 3360);
	assert.equal(total([plan], 'CPF', 'employer_amount'), 2856);
	assert.equal(total([plan], 'CDAC', 'employee_amount'), 5.5);
	assert.equal(total([plan], 'SDL', 'employer_amount'), 33.75);
});

test('a bonus paid before the month run carries no salary and settles the month exactly', async () => {
	const bonusFirst = async () => {
		reset();
		entry(
			'adhoc_catalog_entry',
			'bonus-1',
			'e1',
			catalog('adhoc_catalog', 'bonus', '2026-02'),
			'2026-02-05',
			{ amount: 5000 }
		);
		return [await run('2026-02', 'OFF_CYCLE', ['bonus-1']), await run('2026-02', 'REGULAR')];
	};
	// Without an earlier settlement the month's regular run pays the approved bonus itself.
	const withSalary = async () => {
		reset();
		entry(
			'adhoc_catalog_entry',
			'bonus-1',
			'e1',
			catalog('adhoc_catalog', 'bonus', '2026-02'),
			'2026-02-05',
			{ amount: 5000 }
		);
		const salary = await run('2026-02', 'REGULAR');
		assert.equal(slip(salary, 'e1').adjustments.length, 1);
		assert.match(await refused('2026-02', 'OFF_CYCLE', ['bonus-1']), /not an approved, unpaid/);
		return [salary];
	};
	const first = await bonusFirst();
	const bonus = slip(first[0]!, 'e1');
	assert.equal(first[0]!.payslips.length, 1);
	assert.equal(bonus.gross, 5000);
	assert.equal(bonus.base.length, 0);
	assert.deepEqual(
		[line(first[0]!, 'e1', 'CPF')!.employee_amount, line(first[0]!, 'e1', 'CPF')!.employer_amount],
		[1000, 850]
	);
	assert.equal(line(first[1]!, 'e1', 'CPF')!.employee_amount, 1300);
	assert.equal(line(first[1]!, 'e1', 'CDAC')!.employee_amount, 1.5);
	assert.equal(line(first[1]!, 'e1', 'SDL')!.employer_amount, 0);
	const second = await withSalary();
	for (const scheme of ['CPF', 'CDAC', 'SDL'])
		for (const field of ['employee_amount', 'employer_amount'] as const)
			assert.equal(total(first, scheme, field), total(second, scheme, field), `${scheme} ${field}`);
	// Paid after the month run: the off-cycle slip charges the month-to-date delta, to the same totals.
	reset();
	const salaryFirst = [await run('2026-02', 'REGULAR')];
	entry(
		'adhoc_catalog_entry',
		'bonus-1',
		'e1',
		catalog('adhoc_catalog', 'bonus', '2026-02'),
		'2026-02-05',
		{ amount: 5000 }
	);
	const after = [...salaryFirst, await run('2026-02', 'OFF_CYCLE', ['bonus-1'])];
	assert.equal(slip(after[1]!, 'e1').base.length, 0);
	for (const scheme of ['CPF', 'CDAC', 'SDL'])
		for (const field of ['employee_amount', 'employer_amount'] as const)
			assert.equal(
				total(first, scheme, field),
				total(after, scheme, field),
				`after ${scheme} ${field}`
			);
});

test('the age band changes the month after the birthday', async () => {
	reset();
	tables.get('employment_profile')!.find((row) => row.id === 'e2')!.date_of_birth = '1971-02-10';
	const march = await run('2026-03', 'REGULAR');
	assert.equal(line(march, 'e2', 'CPF')!.employee_amount, 990); // 5,500 × 18%
	reset();
	tables.get('employment_profile')!.find((row) => row.id === 'e2')!.date_of_birth = '1971-03-10';
	const stillMarch = await run('2026-03', 'REGULAR');
	assert.equal(line(stillMarch, 'e2', 'CPF')!.employee_amount, 1100); // 5,500 × 20%
});

test('the AW ceiling projects the year from capped ordinary wages', async () => {
	reset();
	tables.get('employment_contract')!.splice(0, 3, contractOf({ ...people[1]!, salary: 10000 }));
	entry(
		'adhoc_catalog_entry',
		'b',
		'e2',
		catalog('adhoc_catalog', 'bonus', '2026-03'),
		'2026-03-05',
		{ amount: 20000 }
	);
	const plan = await run('2026-03', 'OFF_CYCLE', ['b']);
	// 102,000 − 8,000 × 10 (March to December, nothing charged yet) = 22,000 of room: the whole bonus is assessed.
	assert.equal(line(plan, 'e2', 'CPF')!.base_amount, 20000);
	assert.equal(line(plan, 'e2', 'CPF')!.employee_amount, 4000);
});

test('MBMF is charged on the ISLAM religion code; SPR year one uses the graduated rates', async () => {
	reset();
	tables.get('employment_profile')!.find((row) => row.id === 'e3')!.religion = 'ISLAM';
	tables
		.get('employment_contract')!
		.splice(0, 1, contractOf({ ...people[0]!, since: '2025-10-15' }));
	const plan = await run('2026-03', 'REGULAR');
	assert.equal(line(plan, 'e3', 'MBMF')!.employee_amount, 19.5);
	assert.equal(line(plan, 'e1', 'CPF')!.employee_amount, 325); // 6,500 × 5%
	assert.equal(line(plan, 'e1', 'CPF')!.employer_amount, 260); // round(6,500 × 9%) − 325
});

test('settlement runs refuse without sources and salary runs refuse a second time', async () => {
	reset();
	assert.match(await refused('2026-03', 'OFF_CYCLE', []), /select at least one/);
	assert.match(await refused('2026-03', 'OFF_CYCLE', ['nope']), /not an approved, unpaid/);
	await run('2026-03', 'REGULAR');
	assert.match(await refused('2026-03', 'REGULAR'), /already has a salary run/);
});

test('a reversal subtracts, a loan deducts from net, no-pay leave prorates', async () => {
	reset();
	entry(
		'adhoc_catalog_entry',
		'v',
		'e2',
		catalog('adhoc_catalog', 'bonus', '2026-03'),
		'2026-03-05',
		{ amount: 500 },
		'REVERSAL'
	);
	entry(
		'loan_catalog_entry',
		'l',
		'e2',
		catalog('loan_catalog', 'SALARY_ADVANCE', '2026-03'),
		'2026-03-20',
		{ amount: 300 }
	);
	entry(
		'leave_catalog_entry',
		'n',
		'e3',
		catalog('leave_catalog', 'UNPAID_LEAVE', '2026-03'),
		'2026-03-10',
		{ days: 2 },
		'TIME_OFF'
	);
	const plan = await run('2026-03', 'REGULAR');
	const shelly = slip(plan, 'e2');
	assert.equal(shelly.gross, 5000);
	// The reversal cannot take the month's additional wage below zero: CPF stays on 5,500 of ordinary wage; CDAC sees 5,000.
	assert.equal(line(plan, 'e2', 'CPF')!.employee_amount, 1100);
	assert.equal(shelly.total_deductions, 1100 + 1.5 + 300);
	assert.equal(shelly.net, 5000 - 1401.5);
	const dernese = slip(plan, 'e3');
	assert.equal(dernese.gross, 4363.64); // EA s.20A: 4,800 − 2 × 4,800 / 22 working days
	assert.ok(tables.get('leave_catalog_entry')![0]!.payslip_id != null);
});

test('missing statutory facts refuse instead of charging nothing', async () => {
	reset();
	tables.get('employment_profile')!.find((row) => row.id === 'e2')!.date_of_birth = '';
	assert.match(
		await refused('2026-03', 'REGULAR'),
		/Shelly: CPF needs the employee’s date of birth/
	);
});

test('approved overtime pays 1.5× the hourly basic rate, on SGD 2,250 for a non-workman above it', async () => {
	reset();
	tables.get('roster_entry')!.push({
		id: 'd1',
		employment_id: 'k-e3',
		approval_id: null,
		payslip_id: null,
		work_date: '2026-03-10',
		approved_overtime_hours: 4
	});
	const plan = await run('2026-03', 'REGULAR');
	const overtime = slip(plan, 'e3').base.find((row) => row.component_code === 'OVERTIME')!;
	assert.equal(overtime.amount, 70.8); // 4 × 1.5 × 2,250 × 12 ÷ 2,288
	assert.equal(tables.get('roster_entry')![0]!.payslip_id, `run-${runs}-k-e3`);
});

test('entry admission pins the class in force, refuses an entry without its amount and locks settled entries', async () => {
	reset();
	const refusals: string[] = [];
	const ctx = (existing: object[] = []) => ({
		existing,
		db: {
			read: (collection: never, query: never) => Effect.runPromise(reads.read(collection, query))
		},
		refuse: (message: string): never => {
			refusals.push(message);
			throw new Error(message);
		}
	});
	// a December 2025 bonus row, entered for March 2026, is priced by the January 2026 version's row of the same code
	const december = catalog('adhoc_catalog', 'bonus', '2025-12');
	const [admitted] = await transformEntries(
		'adhoc_catalog_entry',
		[
			{
				catalog_id: december,
				employment_id: 'k-e1',
				occurred_on: '2026-03-05',
				amount: 100
			}
		],
		ctx()
	);
	assert.equal(
		(admitted as { catalog_id: string }).catalog_id,
		catalog('adhoc_catalog', 'bonus', '2026-03')
	);
	assert.equal((admitted as { company_id: string }).company_id, COMPANY);
	await assert.rejects(
		transformEntries(
			'adhoc_catalog_entry',
			[{ catalog_id: december, employment_id: 'k-e1', occurred_on: '2026-03-05' }],
			ctx()
		)
	);
	assert.match(refusals.at(-1)!, /Enter the amount/);
	await assert.rejects(
		transformEntries('adhoc_catalog_entry', [{ amount: 1 }], ctx([{ payslip_id: 'p' }]))
	);
	assert.match(refusals.at(-1)!, /settled on a payslip/);
	const [pin] = await transformEntries('adhoc_catalog_entry', [{ payslip_id: 'p2' }], ctx([{}]));
	assert.deepEqual(pin, { payslip_id: 'p2' });
});

const ruleOf = (value: unknown): Behaviour => {
	if (!Schema.is(Behaviour)(value)) throw new Error('expected a behaviour rule');
	return value;
};

test('behaviours: a trigger plans its rules, reads its where through CEL, and returns act-shaped writes', () => {
	const pack = behavioursOf(law('jurisdiction_settings')[0]!['behaviours']);
	assert.ok(pack);
	const engine = ruleOf(pack.rules.find((rule) => rule.catalog === 'WORK'));
	const pins = ruleOf(pack.rules.find((rule) => rule.target_collection === 'payroll_run'));
	assert.equal(
		triggerMatches(engine, { kind: 'catalog', catalog: 'WORK', event: 'PAYROLL_CREATE' }),
		true
	);
	assert.equal(
		triggerMatches(engine, { kind: 'catalog', catalog: 'OTHER', event: 'PAYROLL_CREATE' }),
		false
	);
	assert.deepEqual(
		planBehaviours(
			{ version: 1, rules: [pins] },
			{ kind: 'catalog', catalog: 'WORK', event: 'PAYROLL_CREATE' },
			{}
		),
		[]
	);
	const run = {
		id: 'r1',
		approval_id: null,
		pins: [
			{ employment_id: 'k-e1', collection: 'claim_catalog_entry', id: 'c1' },
			{ employment_id: 'k-e2', collection: 'roster_entry', id: 'x1' }
		]
	};
	const context = { event: { collection: 'payroll_run', action: 'created', row: run } };
	assert.equal(
		planBehaviours(
			{ version: 1, rules: [pins] },
			{ kind: 'row', collection: 'payroll_run', event: 'created' },
			context
		).length,
		1
	);
	assert.equal(
		planBehaviours(
			{ version: 1, rules: [pins] },
			{ kind: 'row', collection: 'payroll_run', event: 'created' },
			{ event: { row: { ...run, approval_id: 'a' } } }
		).length,
		0
	);
	assert.deepEqual(resolveWhere({ payroll_run_id: { eq: 'event.row.id' } }, context), {
		payroll_run_id: { eq: 'r1' }
	});
	const writes = effectWrites(pins, {
		...context,
		slips: [{ id: 's1', employment_id: 'k-e1' }]
	});
	assert.deepEqual(writes, [
		{
			callable: 'claim_catalog_entry.update',
			collection: 'claim_catalog_entry',
			operation: 'update',
			data: { target: ['c1'], set: { payslip_id: 's1' } }
		}
	]);
});

test('behaviours: every seeded rule names at most one trigger and every row rule names its effect', () => {
	for (const settings of law('jurisdiction_settings')) {
		const pack = behavioursOf(settings['behaviours']);
		assert.ok(pack, `settings ${String(settings['id'])} behaviours`);
		for (const rule of pack.rules) {
			// a row rule without a target collection answers every collection the taps fire for
			const trigger = [rule.catalog, rule.target_collection].filter((key) => key != null);
			assert.ok(trigger.length <= 1, `rule ${rule.id} has ${trigger.length} triggers`);
			assert.ok(rule.events.length > 0, `rule ${rule.id} has no events`);
			if (rule.catalog == null)
				assert.equal(typeof rule.effect, 'string', `rule ${rule.id} has no effect`);
		}
	}
});

test('an exit encashment pays through the work catalogue line and pins its leave entry', async () => {
	reset();
	entry(
		'leave_catalog_entry',
		'enc',
		'e1',
		catalog('leave_catalog', 'ANNUAL_LEAVE', '2026-03'),
		'2026-03-31',
		{ days: 5, incurred_on: '2026-03-31' },
		'ENCASHMENT'
	);
	const plan = await run('2026-03', 'REGULAR');
	const kavriel = slip(plan, 'e1');
	// 6,500 + 5 × 6,500/22 working days = 7,977.27, priced by the ENCASHMENT work-catalogue line
	assert.equal(kavriel.gross, 7977.27);
	assert.ok(
		kavriel.base.some((row) => row.component_code === 'ENCASHMENT' && row.amount === 1477.27)
	);
	assert.ok(tables.get('leave_catalog_entry')![0]!.payslip_id != null);
});

const versionOn = (period: string): string =>
	String(
		tables.get('jurisdiction_settings')!.find((settings) => {
			const range = settings.effective_range as { from: string; to: string | null };
			return range.from <= `${period}-01` && (range.to == null || range.to >= `${period}-01`);
		})!.id
	);

const holidayWork = () =>
	tables.get('work_catalog')!.push({
		id: 'hw',
		settings_id: versionOn('2026-03'),
		code: 'HOLIDAY_WORK',
		name: 'Public-holiday work',
		component_code: 'HOLIDAY_WORK',
		eligibility: 'work.holidays.exists(h, h.kind == "PUBLIC_HOLIDAY")',
		quantity: '1.0',
		rate: '2.0 * (terms.base_salary / 26.0)',
		destination: 'PAY',
		direction: 'ADD',
		counts_toward: []
	});

test('HOLIDAY_WORK stays off when no published holiday falls on a roster day', async () => {
	reset();
	holidayWork();
	const plan = await run('2026-03', 'REGULAR');
	assert.equal(
		slip(plan, 'e1').base.some((row) => row.component_code === 'HOLIDAY_WORK'),
		false
	);
});

test('roster work on a published public holiday prices HOLIDAY_WORK', async () => {
	reset();
	holidayWork();
	tables.get('holiday')!.push({
		id: 'h1',
		company_id: COMPANY,
		date: '2026-03-10',
		kind: 'PUBLIC_HOLIDAY',
		published_at: '2026-01-01T00:00:00.000Z',
		given_to: 'EVERYONE'
	});
	tables.get('roster_entry')!.push({
		id: 'r-hol',
		employment_id: 'k-e1',
		work_date: '2026-03-10',
		approval_id: null,
		payslip_id: null
	});
	const plan = await run('2026-03', 'REGULAR');
	const kavriel = slip(plan, 'e1');
	assert.ok(
		kavriel.base.some((row) => row.component_code === 'HOLIDAY_WORK' && row.amount === 500)
	);
	assert.ok(kavriel.pins.some((pin) => pin.collection === 'roster_entry' && pin.id === 'r-hol'));
	assert.equal(
		slip(plan, 'e2').base.some((row) => row.component_code === 'HOLIDAY_WORK'),
		false
	);
});

test('an unpublished holiday does not price HOLIDAY_WORK', async () => {
	reset();
	holidayWork();
	tables.get('holiday')!.push({
		id: 'h-draft',
		company_id: COMPANY,
		date: '2026-03-10',
		kind: 'PUBLIC_HOLIDAY',
		published_at: null,
		given_to: 'EVERYONE'
	});
	tables.get('roster_entry')!.push({
		id: 'r-hol',
		employment_id: 'k-e1',
		work_date: '2026-03-10',
		approval_id: null,
		payslip_id: null
	});
	const plan = await run('2026-03', 'REGULAR');
	assert.equal(
		slip(plan, 'e1').base.some((row) => row.component_code === 'HOLIDAY_WORK'),
		false
	);
});

test('L-TPL-hr-payroll-076/077 the seeded encash rule returns the create write for the balance over the movements', async () => {
	reset();
	const pack = behavioursOf(law('jurisdiction_settings')[0]!['behaviours']);
	assert.ok(pack);
	const rule = ruleOf(pack.rules.find((row) => row.id === 'encash-leave-on-exit'));
	const versionId = String(
		tables.get('jurisdiction_settings')!.find((settings) => {
			const range = settings.effective_range as { from: string; to: string | null };
			return range.from <= '2026-03-01' && (range.to == null || range.to >= '2026-03-01');
		})!.id
	);
	const annual = tables
		.get('leave_catalog')!
		.find((row) => row.code === 'ANNUAL_LEAVE' && row.settings_id === versionId)!;
	const writes = effectWrites(
		rule,
		withBalances({
			event: {
				collection: 'employment_contract',
				action: 'updated',
				settings_id: annual.settings_id,
				row: {
					id: 'k-e1',
					approval_id: null,
					prior_service_months: null,
					effective_range: { from: '2019-01-01', to: '2026-03-31' },
					exit_facts: { ground: 'RESIGNATION' }
				}
			},
			catalogues: [annual],
			movements: [
				{
					catalog_id: annual.id,
					activity: 'TIME_OFF',
					days: 4,
					reference: 'l1',
					occurred_on: '2026-02-10',
					from: '2026-02-10',
					to: '2026-02-13'
				}
			]
		})
	);
	// 86 completed months falls in the 84-month band (8th year of service): 14 days − 4 taken = 10
	assert.deepEqual(writes, [
		{
			callable: 'leave_catalog_entry.create',
			collection: 'leave_catalog_entry',
			operation: 'create',
			data: {
				catalog_id: annual.id,
				employment_id: 'k-e1',
				occurred_on: '2026-03-31',
				activity: 'ENCASHMENT',
				reference: 'exit:k-e1:ANNUAL_LEAVE',
				days: 10,
				incurred_on: '2026-03-31'
			}
		}
	]);
});

test('a part month prorates salary and allowances through their records and records the proration', async () => {
	reset();
	tables.get('employment_contract')!.splice(
		0,
		3,
		contractOf(people[1]!, {
			effective_range: { from: '2026-03-16', to: null },
			allowances: [{ code: 'FIXED_MONTHLY', amount: { value: 310 } }]
		})
	);
	tables.get('employment_contract')![0]!.effective_range = { from: '2026-03-16', to: null };
	const plan = await run('2026-03', 'REGULAR');
	const shelly = slip(plan, 'e2');
	// EA s.20A: 5,500 and the 310 allowance × 12 of the month's 22 working days (16–31 March)
	assert.equal(shelly.base.find((row) => row.component_code === 'BASIC')!.amount, 3000);
	assert.equal(shelly.base.find((row) => row.component_code === 'FIXED_MONTHLY')!.amount, 169.09);
	assert.deepEqual(shelly.proration, [
		{
			component_code: 'BASIC',
			from: '2026-03-16',
			to: '2026-03-31',
			days: 16,
			denominator: 31,
			contract_amount: 5500,
			prorated_amount: 3000
		}
	]);
	assert.deepEqual(line(plan, 'e2', 'CPF')!.parts, { ordinary: 3169.09, additional: 0 });
});

test('a run refuses a version that names no payroll currency', async () => {
	reset();
	for (const settings of tables.get('jurisdiction_settings')!) settings.payroll = {};
	assert.match(await refused('2026-03', 'REGULAR'), /names no payroll currency/);
});

/** A work-catalogue line that only shows a figure: DISPLAY moves neither gross nor net. */
const shows = (code: string, quantity: string, rate = '1.0', eligibility = 'true') =>
	tables.get('work_catalog')!.push({
		id: `w-${code}`,
		settings_id: versionOn('2026-03'),
		code,
		name: code,
		component_code: code,
		eligibility,
		quantity,
		rate,
		destination: 'DISPLAY',
		direction: 'ADD',
		counts_toward: []
	});
const shown = (plan: Plan, person: string, code: string) =>
	slip(plan, person).base.find((row) => row.component_code === code)?.amount;

/** A Monday-anchored week of five working days, an off day and a rest day, named by e3's terms. */
const weekPattern = () => {
	tables.set('shift_definition', [
		{
			id: 'sd-day',
			company_id: COMPANY,
			code: 'D0900',
			variant: { day_type: 'WORK', start_time: '09:00', end_time: '18:00', break_minutes: 60 }
		},
		{ id: 'sd-off', company_id: COMPANY, code: 'OFF', variant: { day_type: 'OFF' } },
		{ id: 'sd-rest', company_id: COMPANY, code: 'REST', variant: { day_type: 'REST' } },
		{
			id: 'sd-night',
			company_id: COMPANY,
			code: 'N2200',
			variant: { day_type: 'WORK', start_time: '22:00', end_time: '07:00', break_minutes: 60 }
		}
	]);
	tables.set('shift_pattern', [
		{
			id: 'sp-week',
			company_id: COMPANY,
			effective_range: { from: '2026-03-02', to: null },
			pattern: {
				days: [
					...Array.from({ length: 5 }, () => ({ roster_code_id: 'sd-day' })),
					{ roster_code_id: 'sd-off' },
					{ roster_code_id: 'sd-rest' }
				]
			}
		}
	]);
	tables
		.get('employment_contract')!
		.splice(2, 1, contractOf(people[2]!, { shift_pattern_id: 'sp-week' }));
};

test('day types come from the shift codes: working days, and rest-day overtime priced by its own line', async () => {
	reset();
	weekPattern();
	shows('WORKING_DAYS', 'period.working_days');
	shows(
		'REST_DAY_OT',
		'sum(work.days.filter(d, d.day_type == "REST").map(d, d.overtime_hours))',
		'10.0',
		'work.days.exists(d, d.day_type == "REST" && d.overtime_hours > 0.0)'
	);
	shows('SCHEDULED', 'sum(work.days.filter(d, d.date == "2026-03-03").map(d, d.scheduled_hours))');
	tables.get('roster_entry')!.push({
		id: 'rest-ot',
		employment_id: 'k-e3',
		approval_id: null,
		payslip_id: null,
		work_date: '2026-03-08',
		approved_overtime_hours: 4
	});
	const plan = await run('2026-03', 'REGULAR');
	// 2 March opens the cycle: 22 weekdays from it; 1 March precedes the pattern and names no shift.
	assert.equal(shown(plan, 'e3', 'WORKING_DAYS'), 22);
	assert.equal(shown(plan, 'e3', 'REST_DAY_OT'), 40); // Sunday 8 March is the cycle's rest day
	assert.equal(shown(plan, 'e3', 'SCHEDULED'), 8); // 09:00–18:00 less the hour's break
	assert.equal(shown(plan, 'e1', 'WORKING_DAYS'), undefined); // no pattern, no roster: nothing planned
});

test('night hours: hours_between over local intervals crossing midnight, in the entity zone', async () => {
	assert.equal(
		evaluateConfigured('hours_between(i, "22:00", "06:00")', {
			i: [{ start: '2026-03-10T21:00', end: '2026-03-11T07:30' }]
		}),
		8
	);
	assert.equal(
		evaluateConfigured('hours_between(i, "09:00", "18:00")', {
			i: [
				{ start: '2026-03-10T08:00', end: '2026-03-10T12:00' },
				{ start: '2026-03-10T13:00', end: '2026-03-10T20:00' },
				{ start: '2026-03-10T21:00', end: null }
			]
		}),
		8
	);
	reset();
	weekPattern();
	tables.get('entity')![0]!.time_zone = 'Asia/Singapore';
	shows('NIGHT', 'sum(work.days.map(d, hours_between(d.intervals, "22:00", "06:00")))');
	shows('WORKED', 'sum(work.days.map(d, d.worked_hours))');
	tables.get('roster_entry')!.push({
		id: 'night',
		employment_id: 'k-e3',
		approval_id: null,
		payslip_id: null,
		work_date: '2026-03-10',
		shift_definition_id: 'sd-night',
		// 22:00 to 07:00 Singapore time
		worked_intervals: [{ start: '2026-03-10T14:00:00.000Z', end: '2026-03-10T23:00:00.000Z' }]
	});
	const plan = await run('2026-03', 'REGULAR');
	assert.equal(shown(plan, 'e3', 'NIGHT'), 8);
	assert.equal(shown(plan, 'e3', 'WORKED'), 9);
});

test('earned: the previous month’s salary-run slip and the year so far', async () => {
	reset();
	shows('PREVIOUS_GROSS', 'earned.previous_month.gross', '0.01');
	shows(
		'PREVIOUS_BASIC',
		'has(earned.previous_month.BASIC) ? earned.previous_month.BASIC : 0.0',
		'0.01'
	);
	shows('PREVIOUS_SALARY', 'earned.previous_month.base_salary', '0.01');
	shows('YEAR_GROSS', 'earned.year.gross', '0.01');
	shows('START', 'employment.start_date == "2019-01-01" && period.covered_days == 31 ? 1.0 : 0.0');
	shows('MONTH_GROSS', 'earned.month.gross', '0.01');
	shows(
		'MONTH_CPF',
		'earned.month.statutory.CPF.employee',
		'0.01',
		'has(earned.month.statutory.CPF)'
	);
	await run('2026-01', 'REGULAR');
	await run('2026-02', 'REGULAR');
	// A bonus paid off-cycle before the month run is the month's earlier slip.
	entry(
		'adhoc_catalog_entry',
		'b3',
		'e2',
		catalog('adhoc_catalog', 'bonus', '2026-03'),
		'2026-03-05',
		{ amount: 1000 }
	);
	await run('2026-03', 'OFF_CYCLE', ['b3']);
	const march = await run('2026-03', 'REGULAR');
	assert.equal(shown(march, 'e2', 'MONTH_GROSS'), 10);
	assert.equal(shown(march, 'e2', 'MONTH_CPF'), 2); // 20% of the 1,000 bonus
	assert.equal(shown(march, 'e2', 'PREVIOUS_GROSS'), 55);
	assert.equal(shown(march, 'e2', 'PREVIOUS_BASIC'), 55);
	assert.equal(shown(march, 'e2', 'PREVIOUS_SALARY'), 55);
	assert.equal(shown(march, 'e2', 'YEAR_GROSS'), 110);
	assert.equal(shown(march, 'e2', 'START'), 1);
});

test('leave rows carry their class pay_fraction and the month of their absence event', async () => {
	reset();
	const annual = catalog('leave_catalog', 'ANNUAL_LEAVE', '2026-03');
	tables.get('leave_catalog')!.find((row) => row.id === annual)!.pay_fraction =
		'leave.month_index >= 3 ? 0.5 : 1.0';
	shows('UNPAID_PART', 'sum(leave.rows.map(r, r.days * (1.0 - r.pay_fraction)))', '100.0');
	shows('EVENT_MONTH', 'size(leave.rows) > 0 ? first(leave.rows.map(r, r.month_index)) : 0.0');
	// The event began on 12 January (already paid); 12 March opens its third month.
	entry(
		'leave_catalog_entry',
		'jan',
		'e2',
		annual,
		'2026-01-12',
		{
			days: 1,
			from: '2026-01-12',
			facts: { event_id: 'illness-1' },
			payslip_id: 'paid'
		},
		'TIME_OFF'
	);
	entry(
		'leave_catalog_entry',
		'mar',
		'e2',
		annual,
		'2026-03-12',
		{ days: 2, from: '2026-03-12', facts: { event_id: 'illness-1' } },
		'TIME_OFF'
	);
	const plan = await run('2026-03', 'REGULAR');
	assert.equal(shown(plan, 'e2', 'EVENT_MONTH'), 3);
	assert.equal(shown(plan, 'e2', 'UNPAID_PART'), 100); // 2 days × (1 − 0.5)
});

test('raise-obligations prices each remittance from the run’s scheme totals', () => {
	const [settings] = law('jurisdiction_settings').filter(
		(row) => (row.effective_range as { to: string | null }).to == null
	);
	const rows = readdirSync(seed)
		.filter((entry) => entry.startsWith('version_'))
		.flatMap((dir) =>
			(JSON.parse(readFileSync(resolve(seed, dir, 'rule_set.json'), 'utf8')) as Row[]).filter(
				(row) => row.settings_id === settings!.id
			)
		);
	const writes = raiseDuties({
		behaviours: behavioursOf(settings!.behaviours)!,
		settings_id: settings!.id,
		rows,
		collection: 'payroll_run',
		event: 'created',
		row: { id: 'r1', company_id: 'c1', period: '2026-03', approval_id: null },
		run: {
			totals: {
				gross: 10000,
				net: 8000,
				employer_cost: 11700,
				schemes: {
					CPF: { employee: 2000, employer: 1700 },
					CDAC: { employee: 3, employer: 0 },
					SINDA: { employee: 5, employer: 0 }
				}
			}
		}
	});
	const due = (code: string) => writes.find((write) => write.duty_code === code);
	assert.equal(due('CPF_MONTHLY_SUBMISSION_AND_PAYMENT')!.amount_due, 3700);
	assert.equal(due('SHG_DEDUCTION_REMITTANCE')!.amount_due, 8);
	assert.equal(
		due('CPF_MONTHLY_SUBMISSION_AND_PAYMENT')!.occurrence_key,
		'CPF_MONTHLY_SUBMISSION_AND_PAYMENT:r1'
	);
	// No SDL charged this run: no liability is raised for it; the filings still are.
	assert.equal(due('SDL_REMITTANCE'), undefined);
	assert.equal(due('ITEMISED_PAYSLIP'), undefined);
	// The itemised payslip is owed once the slip is paid: three working days after its paid day.
	const paid = (status: string) =>
		raiseDuties({
			behaviours: behavioursOf(settings!.behaviours)!,
			settings_id: settings!.id,
			rows,
			collection: 'payslip',
			event: 'updated',
			row: {
				id: 's1',
				company_id: 'c1',
				employment_id: 'k-e1',
				status,
				paid_on: '2026-04-02',
				approval_id: null
			},
			reads: { holidays: [{ date: '2026-04-03', kind: 'PUBLIC_HOLIDAY' }] }
		}).find((write) => write.duty_code === 'ITEMISED_PAYSLIP');
	assert.equal(paid('DRAFT'), undefined);
	assert.equal(paid('PAID')!.subject_collection, 'payslip');
	assert.equal(paid('PAID')!.due_on, '2026-04-08');
	assert.equal(paid('PAID')!.occurrence_key, 'ITEMISED_PAYSLIP:c1:s1');
});

test('regulatory tasks rise on entity, leave and contract events, due on a working day', () => {
	const [settings] = law('jurisdiction_settings').filter(
		(row) => (row.effective_range as { to: string | null }).to == null
	);
	const task = (code: string, trigger: Row, due: string, when?: string): Row => ({
		family: 'TASKS',
		code,
		name: code,
		rules: { description: code, authority: 'Act', trigger, ...(when ? { when } : {}), due }
	});
	const rows = [
		task(
			'EMPLOYER_REGISTRATION',
			{ collection: 'entity', event: 'created' },
			'add_working_days(period.from, 3, holidays)'
		),
		task(
			'MATERNITY_NOTICE',
			{ collection: 'leave_catalog_entry', event: 'created' },
			'next_working_day(add_days(row.occurred_on, 5), holidays)',
			'has(row.facts.event_kind) && row.facts.event_kind == "BIRTH"'
		),
		task(
			'NEW_HIRE_REPORT',
			{ collection: 'employment_contract', event: 'created' },
			'add_days(hired_on, 30)'
		)
	];
	const raise = (collection: string, row: Row, reads: Row = {}) =>
		raiseDuties({
			behaviours: behavioursOf(settings!.behaviours)!,
			settings_id: settings!.id,
			rows,
			collection,
			event: 'created',
			row: { approval_id: null, ...row },
			reads
		});
	// The fixture's day is Thursday 1 January 2026: three working days skip the weekend and a published Monday.
	const entity = raise(
		'entity',
		{ id: 'c9', facts: {} },
		{ holidays: [{ date: '2026-01-05', kind: 'PUBLIC_HOLIDAY' }] }
	);
	assert.deepEqual(
		entity.map((write) => [write.code, write.subject_collection, write.company_id, write.due_on]),
		[['EMPLOYER_REGISTRATION', 'entity', 'c9', '2026-01-07']]
	);
	const leave = (event_kind: string) =>
		raise('leave_catalog_entry', {
			id: 'l1',
			company_id: 'c1',
			employment_id: 'k1',
			occurred_on: '2026-10-05',
			facts: { event_kind }
		});
	// Saturday 10 October rolls to Monday 12 October.
	assert.deepEqual(
		leave('BIRTH').map((write) => [write.code, write.due_on]),
		[['MATERNITY_NOTICE', '2026-10-12']]
	);
	assert.deepEqual(leave('ILLNESS'), []);
	const hired = raise('employment_contract', {
		id: 'k2',
		company_id: 'c1',
		employee_id: 'p1',
		effective_range: { from: '2026-03-02', to: null }
	});
	assert.deepEqual(
		hired.map((write) => [write.code, write.due_on, write.occurrence_key]),
		[['NEW_HIRE_REPORT', '2026-04-01', 'NEW_HIRE_REPORT:c1:k2']]
	);
	assert.equal(
		evaluateConfigured('add_working_days("2026-10-01", 3, ["2026-10-06"])', {}),
		'2026-10-07'
	);
	assert.equal(evaluateConfigured('next_working_day("2026-10-03")', {}), '2026-10-05');
	assert.equal(evaluateConfigured('add_working_days("2026-10-05", -1)', {}), '2026-10-02');
});

test('the exit encashment pays the current leave-year balance, carried days included', () => {
	const pack = behavioursOf(law('jurisdiction_settings')[0]!['behaviours']);
	const rule = ruleOf(pack!.rules.find((row) => row.id === 'encash-leave-on-exit'));
	const annual = {
		id: 'ay',
		code: 'ANNUAL_LEAVE',
		unit: 'DAY',
		entitlement: { days: '12.0', window: 'CALENDAR_YEAR', carry_forward: '5.0' }
	};
	const movement = (reference: string, days: number, from: string) => ({
		catalog_id: 'ay',
		activity: 'TIME_OFF',
		days,
		from,
		occurred_on: from,
		reference
	});
	const writes = effectWrites(
		rule,
		withBalances({
			event: {
				collection: 'employment_contract',
				action: 'updated',
				settings_id: 's',
				row: {
					id: 'k-e1',
					approval_id: null,
					prior_service_months: null,
					effective_range: { from: '2020-01-01', to: '2026-06-30' },
					exit_facts: { ground: 'RESIGNATION' }
				}
			},
			catalogues: [annual],
			// 2025 leaves 8 unused (5 carry); 2026 has taken 3 of 12 + 5.
			movements: [movement('a', 4, '2025-04-01'), movement('b', 3, '2026-02-02')]
		})
	);
	assert.equal(writes.length, 1);
	assert.equal((writes[0]!.data as { days: number }).days, 14);
});

/** A `VALIDATIONS` rule-set row of the version governing March 2026. */
const validation = (code: string, rules: Row): Row => ({
	id: `v-${code}`,
	settings_id: versionOn('2026-03'),
	family: 'VALIDATIONS',
	code,
	name: code,
	rules
});

test('payslip validations warn, hold and refuse, and read the slip, its statutory and the headcount', async () => {
	reset();
	tables.set('rule_set', [
		validation('GROSS_ABOVE', {
			site: 'payslip',
			kind: 'warn',
			when: 'payslip.gross > 6000.0 && statutory.CPF.employee > 0.0',
			message: 'gross above 6,000'
		}),
		validation('PR_CLEARANCE', {
			site: 'payslip',
			kind: 'hold',
			when: 'person.residency_status == "PERMANENT_RESIDENT" && company.headcount == 3.0',
			message: 'awaiting tax clearance'
		})
	]);
	const plan = await run('2026-03', 'REGULAR');
	assert.deepEqual(plan.warnings, [
		'Kavriel: gross above 6,000',
		'Kavriel: awaiting tax clearance'
	]);
	assert.equal(slip(plan, 'e1').hold, 'awaiting tax clearance');
	assert.equal(slip(plan, 'e2').hold, null);
	reset();
	tables.set('rule_set', [
		validation('FLOOR', {
			site: 'payslip',
			kind: 'refuse',
			when: 'terms.base_salary < 5000.0',
			message: 'basic below the floor'
		})
	]);
	assert.match(await refused('2026-03', 'REGULAR'), /^Dernese: basic below the floor$/);
	tables.set('rule_set', [validation('BROKEN', { site: 'payslip', when: 'true' })]);
	assert.match(await refused('2026-03', 'REGULAR'), /BROKEN: a validation names its site/);
});

test('a statutory warn_when pays the slip and lands in the run warnings', async () => {
	reset();
	const cpf = tables
		.get('statutory_contribution_catalog')!
		.find((row) => row.code === 'CPF' && row.settings_id === versionOn('2026-03'))!;
	cpf.configuration = {
		...(cpf.configuration as Row),
		warn_when: [{ when: 'employee.date_of_birth > "1995-01-01"', message: 'young' }]
	};
	const plan = await run('2026-03', 'REGULAR');
	assert.deepEqual(plan.warnings, ['Dernese: young']);
	assert.ok(line(plan, 'e3', 'CPF')!.employee_amount > 0);
});

test('contract validations judge every new or changed term against the version governing its start', async () => {
	reset();
	tables.set('rule_set', [
		validation('MINIMUM_BASE', {
			site: 'contract',
			kind: 'refuse',
			when: 'term.base_salary < 1500.0 && company.headcount >= 1.0',
			message: 'The base salary is below the minimum.'
		})
	]);
	const contract = (salary: number) => ({
		company_id: COMPANY,
		employee_id: 'e3',
		effective_range: { from: '2026-03-01', to: null },
		facts: {
			contract_terms: [
				{
					base_salary: { value: salary, currency: 'SGD' },
					effective_range: { from: '2026-03-01', to: null },
					allowances: []
				}
			]
		}
	});
	const admit = (next: Row, before: unknown = null) =>
		Effect.runPromise(
			Effect.result(
				admitContractTerms({ contract: next, before }).pipe(Effect.provideService(Reads, reads))
			)
		);
	const low = await admit(contract(1000));
	assert.equal(low._tag, 'Failure');
	assert.equal(
		low._tag === 'Failure' && low.failure.message,
		'The base salary is below the minimum.'
	);
	assert.equal((await admit(contract(2000)))._tag, 'Success');
	// A term the write leaves as it was is not judged again.
	assert.equal((await admit(contract(1000), contract(1000).facts))._tag, 'Success');
});

test('a sub-monthly period names its part of the calendar month', async () => {
	const settle = (period: string, frequency: string) =>
		Effect.runPromise(Effect.result(settlementPeriod(period, frequency)));
	const half = await settle('2026-02-2', 'SEMI_MONTHLY');
	assert.ok(half._tag === 'Success');
	assert.deepEqual(half.success, { from: '2026-02-16', to: '2026-02-28', part: 2, parts: 2 });
	const third = await settle('2026-03-3', 'TEN_DAY');
	assert.ok(third._tag === 'Success' && third.success.from === '2026-03-21');
	for (const [period, frequency] of [
		['2026-02', 'SEMI_MONTHLY'],
		['2026-02-1', 'MONTHLY'],
		['2026-02-3', 'SEMI_MONTHLY'],
		['2026-02', 'WEEKLY']
	] as const)
		assert.equal((await settle(period, frequency))._tag, 'Failure', `${frequency} ${period}`);
});

test('a class reads the employment’s earlier entries of its code: a per-child cap across claims', async () => {
	reset();
	const version = versionOn('2026-03');
	tables.get('claim_catalog')!.push({
		id: 'cc-child',
		settings_id: version,
		code: 'CHILD_CARE',
		name: 'Child care',
		destination: 'PAY',
		direction: 'ADD',
		eligibility: 'true',
		counts_toward: [],
		bands: [
			{
				when: '',
				amount:
					'min(entry.amount, max(0.0, 500.0 - sum(earlier.rows.filter(r, r.child_id == entry.child_id).map(r, r.amount))))'
			}
		]
	});
	entry('claim_catalog_entry', 'c1', 'e2', 'cc-child', '2026-03-05', {
		amount: 300,
		facts: { child_id: 'A' }
	});
	entry('claim_catalog_entry', 'c2', 'e2', 'cc-child', '2026-03-10', {
		amount: 300,
		facts: { child_id: 'A' }
	});
	entry('claim_catalog_entry', 'c3', 'e2', 'cc-child', '2026-03-12', {
		amount: 300,
		facts: { child_id: 'B' }
	});
	const plan = await run('2026-03', 'REGULAR');
	assert.deepEqual(
		slip(plan, 'e2')
			.adjustments.filter((row) => row.component_code === 'CHILD_CARE')
			.map((row) => [row.source_id, row.amount]),
		[
			['c1', 300],
			['c2', 200],
			['c3', 300]
		]
	);
});

test('hours sums the employment’s roster days to date, by window, day type and holiday kind', async () => {
	reset();
	const day = (id: string, work_date: string, fields: Row) =>
		tables.get('roster_entry')!.push({
			id,
			employment_id: 'k-e2',
			work_date,
			approval_id: null,
			payslip_id: null,
			...fields
		});
	day('r-dec', '2025-12-20', { approved_overtime_hours: 5 });
	day('r-jan', '2026-01-15', { approved_overtime_hours: 4, payslip_id: 'paid' });
	day('r-feb', '2026-02-10', { approved_overtime_hours: 3 });
	// Saturday 7 March is a rest day of the week pattern; 10 March a published public holiday.
	day('r-sat', '2026-03-07', {
		worked_intervals: [{ start: '2026-03-07T01:00:00.000Z', end: '2026-03-07T05:00:00.000Z' }]
	});
	day('r-hol', '2026-03-10', { approved_overtime_hours: 2 });
	tables.get('holiday')!.push({
		id: 'h-mar',
		company_id: COMPANY,
		date: '2026-03-10',
		name: 'Test Day',
		kind: 'PUBLIC_HOLIDAY',
		published_at: '2026-01-01T00:00:00.000Z',
		given_to: 'EVERYONE'
	});
	shows('MONTH_OT', 'hours.month.overtime_hours');
	shows('PREVIOUS_OT', 'hours.previous_month.overtime_hours');
	shows('YEAR_OT', 'hours.year.overtime_hours');
	shows('ROLLING_OT', 'hours.rolling.overtime_hours');
	shows(
		'REST_WORKED',
		'hours.month.day_type.REST.worked_hours',
		'1.0',
		'has(hours.month.day_type.REST)'
	);
	shows(
		'HOLIDAY_OT',
		'hours.month.holiday_kind.PUBLIC_HOLIDAY.overtime_hours',
		'1.0',
		'has(hours.month.holiday_kind.PUBLIC_HOLIDAY)'
	);
	tables.set('rule_set', [
		validation('ANNUAL_OT_CAP', {
			site: 'payslip',
			kind: 'warn',
			when: 'hours.year.overtime_hours > 8.0',
			message: 'annual overtime above 8 h'
		})
	]);
	const cpf = tables
		.get('statutory_contribution_catalog')!
		.find((row) => row.code === 'CPF' && row.settings_id === versionOn('2026-03'))!;
	cpf.configuration = {
		...(cpf.configuration as Row),
		warn_when: [{ when: 'hours.rolling.overtime_hours == 9.0', message: 'rolling 9 h' }]
	};
	const plan = await run('2026-03', 'REGULAR');
	assert.deepEqual(
		['MONTH_OT', 'PREVIOUS_OT', 'YEAR_OT', 'ROLLING_OT', 'REST_WORKED', 'HOLIDAY_OT'].map((code) =>
			shown(plan, 'e2', code)
		),
		[2, 3, 9, 9, 4, 2]
	);
	assert.deepEqual(plan.warnings, ['Shelly: rolling 9 h', 'Shelly: annual overtime above 8 h']);
});

test('the statutory step reads the working days no-pay leave covers (period.unpaid_working_days)', async () => {
	reset();
	// Friday 6 to Tuesday 10 March: the weekend between is not a working day.
	entry(
		'leave_catalog_entry',
		'npl',
		'e3',
		catalog('leave_catalog', 'UNPAID_LEAVE', '2026-03'),
		'2026-03-06',
		{ days: 3, from: '2026-03-06', to: '2026-03-10' },
		'TIME_OFF'
	);
	const cpf = tables
		.get('statutory_contribution_catalog')!
		.find((row) => row.code === 'CPF' && row.settings_id === versionOn('2026-03'))!;
	cpf.configuration = {
		...(cpf.configuration as Row),
		warn_when: [
			{ when: 'period.unpaid_working_days > 0.0', message: 'unpaid days' },
			{ when: 'period.unpaid_working_days == 3.0', message: 'three unpaid working days' }
		]
	};
	const plan = await run('2026-03', 'REGULAR');
	assert.deepEqual(plan.warnings, ['Dernese: unpaid days', 'Dernese: three unpaid working days']);
});
