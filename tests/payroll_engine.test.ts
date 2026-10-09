import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { Effect, Schema } from 'effect';
import { Decimal } from '@norbital-ai/std/decimal';
import { addDays } from '@norbital-ai/std/date';
import {
	Behaviour,
	behavioursOf,
	effectWrites,
	planBehaviours,
	resolveWhere,
	triggerMatches
} from '../src/lib/payroll_engine/behaviours.js';
// strict: a record expression failing inside `configured_eval`, even where CEL absorbs it, fails the suite
import { evaluateStrict as evaluateConfigured } from '../src/lib/payroll_engine/expressions.js';
import { moneyNumber, Reads } from '../src/lib/payroll_engine/foundation.js';
import { raiseDuties, withBalances } from './duties.ts';
import { leaveBalances } from '../src/lib/payroll_engine/leave.js';
import {
	admitAnonymise,
	admitCase,
	anonymousProfile,
	admitSuspension,
	admitContractTerms,
	admitPayrollRun,
	buildPayrollRun,
	currencyScale,
	leaveState,
	payScheduleRefusal,
	rosterFindings,
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

test('a run admitted once builds without re-reading its admission (the sync transform has 40 crossings)', async () => {
	reset();
	entry(
		'adhoc_catalog_entry',
		'b',
		'e2',
		catalog('adhoc_catalog', 'bonus', '2026-03'),
		'2026-03-05',
		{ amount: 1000 }
	);
	let count = 0;
	const counted = {
		read: (...args: Parameters<typeof reads.read>) => (count++, reads.read(...args))
	};
	const request = {
		company_id: COMPANY,
		period: '2026-03',
		kind: 'OFF_CYCLE' as const,
		sources: ['b']
	};
	const admitted = await Effect.runPromise(
		admitPayrollRun(request).pipe(Effect.provideService(Reads, counted))
	);
	const admission = count;
	count = 0;
	await Effect.runPromise(buildPayrollRun(request).pipe(Effect.provideService(Reads, counted)));
	const alone = count;
	count = 0;
	await Effect.runPromise(
		buildPayrollRun(request, admitted).pipe(Effect.provideService(Reads, counted))
	);
	assert.equal(count, alone - admission);
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
	// Statutory overtime is Part 4's: a non-workman on $2,600 or less (EA s.35), here exactly $2,600 basic.
	const e3 = tables.get('employment_contract')!.find((row) => row.id === 'k-e3')!;
	(e3.facts as { contract_terms: { base_salary: unknown }[] }).contract_terms[0]!.base_salary = {
		value: 2600,
		currency: 'SGD'
	};
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
	const leaving = tables
		.get('leave_catalog')!
		.find((row) => row.code === 'ANNUAL_LEAVE_ON_EXIT' && row.settings_id === versionId)!;
	// The balances cover every class; the rule's own read returns only the encash_on_exit classes.
	const balanced = withBalances({
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
		catalogues: [annual, leaving],
		movements: [
			{
				catalog_id: annual.id,
				activity: 'TIME_OFF',
				days: 1,
				reference: 'l1',
				occurred_on: '2026-02-10',
				from: '2026-02-10',
				to: '2026-02-13'
			}
		]
	});
	const writes = effectWrites(rule, { ...balanced, catalogues: [leaving] });
	// EA s.88A(2): leaving 31 March, 3 completed months of the 8th service year (84-month band, 14 days):
	// 14 × 3/12 = 3.5 → 4 days, less the 1 taken = 3, paid through the leaving-year class
	assert.deepEqual(writes, [
		{
			callable: 'leave_catalog_entry.create',
			collection: 'leave_catalog_entry',
			operation: 'create',
			data: {
				catalog_id: leaving.id,
				employment_id: 'k-e1',
				occurred_on: '2026-03-31',
				activity: 'ENCASHMENT',
				reference: 'exit:k-e1:ANNUAL_LEAVE_ON_EXIT:2026-03-31/',
				days: 3,
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
	// the shift's planned hour of break, centred on it (02:00–03:00), is cut out of the one clock pair
	assert.equal(shown(plan, 'e3', 'NIGHT'), 7);
	assert.equal(shown(plan, 'e3', 'WORKED'), 8);
});

test('worked hours net the planned break of a day clocked as one pair, for pay and for roster checks', async () => {
	reset();
	weekPattern();
	tables.get('entity')![0]!.time_zone = 'Asia/Singapore';
	shows('WORKED', 'sum(work.days.map(d, d.worked_hours))');
	shows('PIECES', 'double(sum(work.days.map(d, size(d.intervals))))');
	const day = (id: string, date: string, intervals: object[]) =>
		tables.get('roster_entry')!.push({
			id,
			employment_id: 'k-e3',
			approval_id: null,
			payslip_id: null,
			work_date: date,
			shift_definition_id: 'sd-day',
			worked_intervals: intervals
		});
	// 09:00–18:00 Singapore time, one pair: 8 hours, split around 13:00–14:00
	day('one', '2026-03-10', [
		{ start: '2026-03-10T01:00:00.000Z', end: '2026-03-10T10:00:00.000Z' }
	]);
	// a recorded break is the person's own: 09:00–12:00 and 12:30–18:00, nothing more is cut
	day('two', '2026-03-11', [
		{ start: '2026-03-11T01:00:00.000Z', end: '2026-03-11T04:00:00.000Z' },
		{ start: '2026-03-11T04:30:00.000Z', end: '2026-03-11T10:00:00.000Z' }
	]);
	// a morning half day ends before the planned break: nothing is cut
	day('half', '2026-03-12', [
		{ start: '2026-03-12T01:00:00.000Z', end: '2026-03-12T05:00:00.000Z' }
	]);
	const plan = await run('2026-03', 'REGULAR');
	assert.equal(shown(plan, 'e3', 'WORKED'), 8 + 8.5 + 4);
	assert.equal(shown(plan, 'e3', 'PIECES'), 2 + 2 + 1);
	tables.set('rule_set', [
		{
			settings_id: versionOn('2026-03'),
			family: 'VALIDATIONS',
			code: 'LONG_DAY',
			rules: {
				site: 'roster',
				kind: 'warn',
				when: 'day.worked_hours > 8.0 || day.intervals.exists(i, hours_between([i], "00:00", "00:00") > 5.0)',
				message: 'long day'
			}
		}
	]);
	assert.equal(shown(plan, 'e3', 'PIECES'), 2 + 2 + 1);
	const findings = await Effect.runPromise(
		rosterFindings(COMPANY, [
			{
				ref: 1,
				employment_id: 'k-e3',
				work_date: '2026-03-10',
				shift_definition_id: 'sd-day',
				worked_intervals: [{ start: '2026-03-10T01:00:00.000Z', end: '2026-03-10T10:00:00.000Z' }],
				approved_overtime_hours: null,
				banked_overtime_hours: null,
				incentive_hours: null,
				overtime_consented_at: null,
				leave_code: ''
			}
		]).pipe(Effect.provideService(Reads, reads))
	);
	assert.deepEqual(
		findings.map((row) => row.code),
		[]
	);
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
			'add_working_days(period.from, 3, holidays, ["SATURDAY", "SUNDAY"])'
		),
		task(
			'MATERNITY_NOTICE',
			{ collection: 'leave_catalog_entry', event: 'created' },
			'next_working_day(add_days(row.occurred_on, 5), holidays, ["SATURDAY", "SUNDAY"])',
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
		evaluateConfigured(
			'add_working_days("2026-10-01", 3, ["2026-10-06"], ["SATURDAY", "SUNDAY"])',
			{}
		),
		'2026-10-07'
	);
	assert.equal(
		evaluateConfigured('next_working_day("2026-10-03", [], ["SATURDAY", "SUNDAY"])', {}),
		'2026-10-05'
	);
	assert.equal(
		evaluateConfigured('add_working_days("2026-10-05", -1, [], ["SATURDAY", "SUNDAY"])', {}),
		'2026-10-02'
	);
	// A Friday–Saturday weekend (Kedah, Kelantan, Terengganu) is the record's: Thursday 1 Oct + 1 is Sunday 4 Oct.
	assert.equal(
		evaluateConfigured('add_working_days("2026-10-01", 1, [], ["FRIDAY", "SATURDAY"])', {}),
		'2026-10-04'
	);
	assert.throws(() =>
		evaluateConfigured('next_working_day("2026-10-03", [], ["SATURDAY", "SUNDAY", "FUNDAY"])', {})
	);
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

test('a leave row spanning periods is priced by its working-day share of each and settled by the last', async () => {
	reset();
	// Monday 16 March to Friday 24 April: 12 working days in March, 18 in April.
	entry(
		'leave_catalog_entry',
		'long',
		'e3',
		catalog('leave_catalog', 'UNPAID_LEAVE', '2026-03'),
		'2026-03-16',
		{ days: 30, from: '2026-03-16', to: '2026-04-24' },
		'TIME_OFF'
	);
	shows('SHARE', 'sum(leave.rows.map(r, r.days))');
	shows('TOTAL', 'sum(leave.rows.map(r, r.total_days))');
	shows('INSIDE', 'sum(leave.rows.map(r, r.period_working_days))');
	shows('UNPAID', 'period.unpaid_working_days');
	const march = await run('2026-03', 'REGULAR');
	assert.deepEqual(
		['SHARE', 'TOTAL', 'INSIDE', 'UNPAID'].map((code) => shown(march, 'e3', code)),
		[12, 30, 12, 12]
	);
	assert.equal(slip(march, 'e3').gross, 2181.82); // 4,800 − 12 × 4,800 / 22
	assert.equal(tables.get('leave_catalog_entry')![0]!.payslip_id, null);
	const april = await run('2026-04', 'REGULAR');
	assert.deepEqual(
		['SHARE', 'UNPAID'].map((code) => shown(april, 'e3', code)),
		[18, 18]
	);
	assert.equal(slip(april, 'e3').gross, 872.73); // 4,800 − 18 × 4,800 / 22
	assert.equal(tables.get('leave_catalog_entry')![0]!.payslip_id, `run-${runs}-k-e3`);
});

test('a holiday the person was rostered on but did not work is marked unworked', async () => {
	reset();
	tables.get('holiday')!.push({
		id: 'h1',
		company_id: COMPANY,
		date: '2026-03-10',
		kind: 'PUBLIC_HOLIDAY',
		published_at: '2026-01-01T00:00:00.000Z',
		given_to: 'EVERYONE'
	});
	tables.get('roster_entry')!.push(
		{
			id: 'off',
			employment_id: 'k-e1',
			work_date: '2026-03-10',
			approval_id: null,
			payslip_id: null
		},
		{
			id: 'on',
			employment_id: 'k-e2',
			work_date: '2026-03-10',
			approval_id: null,
			payslip_id: null,
			worksite: 'JURONG',
			facts: { units: 40 },
			worked_intervals: [{ start: '2026-03-10T01:00:00.000Z', end: '2026-03-10T09:00:00.000Z' }]
		}
	);
	shows('ROSTERED', 'double(size(work.holidays))');
	shows('WORKED', 'double(size(work.holidays.filter(h, h.worked)))');
	shows('HOURS', 'sum(work.holidays.map(h, h.worked_hours))');
	shows('UNITS', 'sum(work.days.filter(d, has(d.facts.units)).map(d, double(d.facts.units)))');
	shows('SITE', 'work.days.exists(d, d.worked && d.worksite == "JURONG") ? 1.0 : 0.0');
	const plan = await run('2026-03', 'REGULAR');
	assert.deepEqual(
		['ROSTERED', 'WORKED', 'HOURS'].map((code) => shown(plan, 'e1', code)),
		[1, undefined, undefined]
	);
	assert.deepEqual(
		['ROSTERED', 'WORKED', 'HOURS', 'UNITS', 'SITE'].map((code) => shown(plan, 'e2', code)),
		// 09:00–17:00 Singapore time less the shift's planned hour of break
		[1, 1, 7, 40, 1]
	);
});

test('the version’s public_holidays table becomes the entity’s holiday rows, once', () => {
	const settings = law('jurisdiction_settings').at(-1)!;
	const behaviours = behavioursOf(settings.behaviours)!;
	const trigger = { kind: 'row' as const, collection: 'entity', event: 'calendar' };
	const event = {
		collection: 'entity',
		action: 'calendar',
		row: { id: 'c1', region: 'NORTH', approval_id: null },
		settings_id: settings.id,
		company_id: 'c1'
	};
	// The entity calendar event also plans `raise-tasks` (entity date duties); this is the calendar's own rule.
	const rule = planBehaviours(behaviours, trigger, { event }).find(
		(planned) => planned.id === 'write-public-holidays'
	);
	assert.equal(rule!.id, 'write-public-holidays');
	const writes = effectWrites(rule!, {
		event,
		calendar: [
			{
				rules: {
					holidays: [
						{ date: '2027-01-01', name: 'New Year', kind: 'PUBLIC_HOLIDAY' },
						{ date: '2027-02-06', name: 'Lunar New Year' },
						{ date: '2027-03-01', name: 'Southern day', regions: ['SOUTH'] }
					]
				}
			}
		],
		held: [{ date: '2027-01-01' }]
	});
	assert.deepEqual(
		writes.map((write) => [write.callable, write.data]),
		[
			[
				'holiday.create',
				{
					company_id: 'c1',
					date: '2027-02-06',
					name: 'Lunar New Year',
					kind: 'PUBLIC_HOLIDAY',
					replaces: null,
					given_to: 'EVERYONE'
				}
			]
		]
	);
	assert.equal(effectWrites(rule!, { event, calendar: [], held: [] }).length, 0);
});

const payRun = (period: string, pay_due_date: string) =>
	Effect.runPromise(
		buildPayrollRun({ company_id: COMPANY, period, kind: 'REGULAR', pay_due_date }).pipe(
			Effect.provideService(Reads, reads)
		)
	);

test('a scheme governed by the pay date is assessed on the version in force on the pay day', async () => {
	reset();
	const cpfOf = (period: string) =>
		tables
			.get('statutory_contribution_catalog')!
			.find((row) => row.code === 'CPF' && row.settings_id === versionOn(period))!;
	shows('PAY_DATE', 'period.pay_date == "2027-01-05" ? 1.0 : 0.0');
	tables.get('work_catalog')!.at(-1)!.settings_id = versionOn('2026-12');
	cpfOf('2026-12').configuration = {
		...(cpfOf('2026-12').configuration as Row),
		governed_by: 'pay_date'
	};
	cpfOf('2027-01').configuration = { rules: [{ employee: '1.0', employer: '2.0' }] };
	const plan = await payRun('2026-12', '2027-01-05');
	assert.equal(plan.run.pay_date, '2027-01-05');
	assert.equal(shown(plan, 'e2', 'PAY_DATE'), 1);
	assert.deepEqual(
		[line(plan, 'e2', 'CPF')!.employee_amount, line(plan, 'e2', 'CPF')!.employer_amount],
		[1, 2]
	);
	// Paid inside its own period, the period's version prices it.
	assert.equal(line(await payRun('2026-12', '2026-12-31'), 'e2', 'CPF')!.employee_amount, 1100);
});

test('a scheme marked assess_without_wage charges a month the person was paid nothing', async () => {
	const flat = (assess: boolean) => {
		reset();
		entry(
			'leave_catalog_entry',
			'all',
			'e3',
			catalog('leave_catalog', 'UNPAID_LEAVE', '2026-03'),
			'2026-03-02',
			{ days: 22, from: '2026-03-02', to: '2026-03-31' },
			'TIME_OFF'
		);
		tables.get('statutory_contribution_catalog')!.push({
			id: 'flat',
			settings_id: versionOn('2026-03'),
			code: 'FLAT',
			configuration: {
				...(assess ? { assess_without_wage: true } : {}),
				rules: [{ employer: 'terms.base_salary * 0.01' }]
			}
		});
		return run('2026-03', 'REGULAR');
	};
	assert.equal(
		(await flat(false)).payslips.some((row) => row.employment_id === 'k-e3'),
		false
	);
	const plan = await flat(true);
	assert.equal(slip(plan, 'e3').gross, 0);
	assert.equal(line(plan, 'e3', 'FLAT')!.employer_amount, 48);
});

test('charged.previous_month and charged.previous_year, earned.months and hours.months', async () => {
	reset();
	tables.get('roster_entry')!.push({
		id: 'r-dec',
		employment_id: 'k-e3',
		work_date: '2025-12-10',
		approval_id: null,
		payslip_id: 'paid',
		approved_overtime_hours: 5
	});
	await run('2025-12', 'REGULAR');
	shows('PRIOR_GROSS', 'sum(earned.months.map(m, m.gross))', '0.01');
	shows('PRIOR_CPF_BASE', 'sum(earned.months.map(m, m.statutory.CPF.parts.ordinary))', '0.01');
	shows(
		'OT_SINCE_DEC',
		'sum(hours.months.filter(m, m.month >= "2025-12").map(m, m.overtime_hours))'
	);
	const cpf = tables
		.get('statutory_contribution_catalog')!
		.find((row) => row.code === 'CPF' && row.settings_id === versionOn('2026-01'))!;
	cpf.configuration = {
		...(cpf.configuration as Row),
		warn_when: [
			{ when: 'charged.previous_month.CPF.employee == 960.0', message: 'December deducted' },
			{ when: 'charged.previous_year.CPF.employee == 960.0', message: 'last year deducted' }
		]
	};
	tables
		.get('work_catalog')!
		.slice(-3)
		.forEach((row) => (row.settings_id = versionOn('2026-01')));
	const january = await run('2026-01', 'REGULAR');
	assert.deepEqual(
		['PRIOR_GROSS', 'PRIOR_CPF_BASE', 'OT_SINCE_DEC'].map((code) => shown(january, 'e3', code)),
		[48, 48, 5]
	);
	assert.ok(january.warnings.includes('Dernese: December deducted'));
	assert.ok(january.warnings.includes('Dernese: last year deducted'));
});

test('the statutory step reads the slip’s lines and leave rows; terms list their allowances and dates', async () => {
	reset();
	shows(
		'TERM_FROM',
		'terms.effective_from == "2019-01-01" && size(terms.allowances) == 0 ? 1.0 : 0.0'
	);
	entry(
		'leave_catalog_entry',
		'al',
		'e2',
		catalog('leave_catalog', 'ANNUAL_LEAVE', '2026-03'),
		'2026-03-10',
		{ days: 1, from: '2026-03-10' },
		'TIME_OFF'
	);
	const cpf = tables
		.get('statutory_contribution_catalog')!
		.find((row) => row.code === 'CPF' && row.settings_id === versionOn('2026-03'))!;
	cpf.configuration = {
		...(cpf.configuration as Row),
		warn_when: [
			{
				when: 'lines.exists(l, l.code == "BASIC" && l.amount == 5500.0) && size(leave.rows) == 1',
				message: 'lines and leave'
			}
		]
	};
	const plan = await run('2026-03', 'REGULAR');
	assert.equal(shown(plan, 'e2', 'TERM_FROM'), 1);
	assert.deepEqual(plan.warnings, ['Shelly: lines and leave']);
});

test('an EMPLOYER entry is not paid but counts toward its schemes, and is settled', async () => {
	reset();
	tables.get('adhoc_catalog')!.push({
		id: 'bik',
		settings_id: versionOn('2026-03'),
		code: 'BIK',
		name: 'Benefit in kind',
		destination: 'EMPLOYER',
		direction: 'ADD',
		counts_toward: ['CPF.ADDITIONAL']
	});
	entry('adhoc_catalog_entry', 'b', 'e2', 'bik', '2026-03-05', { amount: 1000 });
	const plan = await run('2026-03', 'REGULAR');
	assert.equal(slip(plan, 'e2').gross, 5500);
	assert.equal(line(plan, 'e2', 'CPF')!.base_amount, 6500);
	assert.equal(slip(plan, 'e2').adjustments.length, 0);
	assert.equal(tables.get('adhoc_catalog_entry')![0]!.payslip_id, `run-${runs}-k-e2`);
});

test('attendance: a class tallies the scheduled, worked and leave days of its window and the one before', async () => {
	reset();
	const version = versionOn('2026-03');
	const leaveClass = (code: string, days: string) =>
		tables.get('leave_catalog')!.push({
			id: `lc-${code}`,
			settings_id: version,
			code,
			name: code,
			entitlement: { window: 'CALENDAR_YEAR', days }
		});
	// Each tally as a number the balance shows: 1000 × scheduled + 10 × worked + annual-leave days.
	leaveClass(
		'ATTENDED',
		'double(attendance.window.scheduled) * 1000.0 + double(attendance.window.worked) * 10.0 + (has(attendance.window.leave.ANNUAL_LEAVE) ? double(attendance.window.leave.ANNUAL_LEAVE) : 0.0)'
	);
	leaveClass(
		'LAST_YEAR',
		'double(attendance.previous.scheduled) * 100.0 + double(size(attendance.window.months))'
	);
	// An 80% test where annual leave counts as attended (the grant the record decides).
	leaveClass(
		'EIGHTY',
		'(double(attendance.window.worked) + (has(attendance.window.leave.ANNUAL_LEAVE) ? double(attendance.window.leave.ANNUAL_LEAVE) : 0.0)) / double(attendance.window.scheduled) >= 0.8 ? 10.0 : 0.0'
	);
	const worked = (date: string) =>
		tables.get('roster_entry')!.push({
			id: `r-${date}`,
			employment_id: 'k-e1',
			work_date: date,
			approval_id: null,
			worked_intervals: [{ start: `${date}T01:00:00.000Z`, end: `${date}T09:00:00.000Z` }]
		});
	worked('2026-03-02');
	worked('2026-03-03');
	worked('2026-03-07'); // a Saturday: rest-day work is not a scheduled day attended
	entry(
		'leave_catalog_entry',
		'al',
		'e1',
		catalog('leave_catalog', 'ANNUAL_LEAVE', '2026-03'),
		'2026-03-04',
		{ days: 2, from: '2026-03-04', to: '2026-03-05' },
		'TIME_OFF'
	);
	const balances = async (asOf: string) => {
		const state = await Effect.runPromise(
			leaveState('k-e1', asOf).pipe(Effect.provideService(Reads, reads))
		);
		// Only this test's classes: the seeded ones read an `entry` a listing does not carry.
		return leaveBalances({
			...state,
			classes: state.classes.filter((cls) => cls.id.startsWith('lc-'))
		});
	};
	const shown = (rows: Awaited<ReturnType<typeof balances>>, code: string) =>
		rows.find((row) => row.code === code)?.entitlement;
	const march = await balances('2026-03-07');
	// 1 January to 7 March 2026: 22 + 20 + 5 weekdays; two attended; two of annual leave.
	assert.equal(shown(march, 'ATTENDED'), 47_022);
	// 2025 held 261 weekdays; this window has reached three months.
	assert.equal(shown(march, 'LAST_YEAR'), 26_103);
	assert.equal(shown(march, 'EIGHTY'), 0);
	// New Year's Day alone: one scheduled day, nothing attended yet.
	assert.equal(
		(await balances('2026-01-01')).find((row) => row.code === 'ATTENDED')?.entitlement,
		1000
	);
});

test('a class payable after exit takes entries past the employment and a salary run pays them alone', async () => {
	reset();
	const e3 = tables.get('employment_contract')!.find((row) => row.id === 'k-e3')!;
	e3.effective_range = { from: '2019-01-01', to: '2026-01-31' };
	tables.get('adhoc_catalog')!.push({
		id: 'nc',
		settings_id: versionOn('2026-03'),
		code: 'NON_COMPETE',
		name: 'Non-compete compensation',
		destination: 'PAY',
		direction: 'ADD',
		counts_toward: [],
		payable_after_exit: true,
		// Priced on the terms last in force: 30% of the leaving base salary.
		bands: [{ when: 'true', amount: 'round(0.3 * terms.base_salary, 0.01)' }]
	});
	const ctx = {
		existing: [],
		db: {
			read: (collection: never, query: never) => Effect.runPromise(reads.read(collection, query))
		},
		refuse: (message: string): never => {
			throw new Error(message);
		}
	};
	const [admitted] = await transformEntries(
		'adhoc_catalog_entry',
		[{ catalog_id: 'nc', employment_id: 'k-e3', occurred_on: '2026-03-15', amount: 1 }],
		ctx
	);
	tables.get('adhoc_catalog_entry')!.push({
		...(admitted as Row),
		id: 'nc-1',
		approval_id: null,
		payslip_id: null
	});
	await assert.rejects(
		transformEntries(
			'adhoc_catalog_entry',
			[
				{
					catalog_id: catalog('adhoc_catalog', 'bonus', '2026-03'),
					employment_id: 'k-e3',
					occurred_on: '2026-03-15',
					amount: 100
				}
			],
			ctx
		),
		/outside the employment/
	);
	const plan = await run('2026-03', 'REGULAR');
	const paid = slip(plan, 'e3');
	assert.deepEqual(paid.base, []);
	assert.deepEqual(
		paid.adjustments.map((line) => [line.component_code, line.amount]),
		[['NON_COMPETE', 1440]]
	);
	assert.equal(paid.gross, 1440);
	assert.equal(tables.get('adhoc_catalog_entry')![0]!.payslip_id, `run-${runs}-k-e3`);
	// A month with no such entry pays the leaver nothing.
	assert.equal(
		(await run('2026-04', 'REGULAR')).payslips.some((row) => row.employment_id === 'k-e3'),
		false
	);
});

test('a post-exit entry of a class payable after exit that pays nothing still keeps its slip and is settled', async () => {
	reset();
	const e3 = tables.get('employment_contract')!.find((row) => row.id === 'k-e3')!;
	e3.effective_range = { from: '2019-01-01', to: '2026-01-31' };
	tables.get('adhoc_catalog')!.push({
		id: 'nc0',
		settings_id: versionOn('2026-03'),
		code: 'NON_COMPETE_WAIVED',
		name: 'Non-compete compensation (waived)',
		destination: 'PAY',
		direction: 'ADD',
		counts_toward: [],
		payable_after_exit: true,
		bands: [{ when: 'true', amount: '0.0' }]
	});
	entry('adhoc_catalog_entry', 'nc0-1', 'e3', 'nc0', '2026-03-15', { amount: 0 });
	const plan = await run('2026-03', 'REGULAR');
	const kept = slip(plan, 'e3');
	assert.equal(kept.gross, 0);
	assert.deepEqual(kept.adjustments, []);
	// settled by this slip: the year's statutory export lists the entry
	assert.equal(tables.get('adhoc_catalog_entry')![0]!.payslip_id, `run-${runs}-k-e3`);
});

test('weekly and daily settlement periods: the Sunday weeks starting in the month, and single days', async () => {
	const settle = (period: string, frequency: string) =>
		Effect.runPromise(Effect.result(settlementPeriod(period, frequency)));
	const week = await settle('2026-03-2', 'WEEKLY');
	assert.ok(week._tag === 'Success');
	// March 2026 starts on a Sunday: weeks begin on the 1st, 8th, 15th, 22nd and 29th.
	assert.deepEqual(week.success, { from: '2026-03-08', to: '2026-03-14', part: 2, parts: 5 });
	const last = await settle('2026-03-5', 'WEEKLY');
	assert.ok(last._tag === 'Success' && last.success.to === '2026-04-04');
	const day = await settle('2026-03-17', 'DAILY');
	assert.ok(day._tag === 'Success');
	assert.deepEqual(day.success, { from: '2026-03-17', to: '2026-03-17', part: 17, parts: 31 });
	for (const [period, frequency] of [
		['2026-04-5', 'WEEKLY'],
		['2026-03', 'DAILY'],
		['2026-02-29', 'DAILY']
	] as const)
		assert.equal((await settle(period, frequency))._tag, 'Failure', `${frequency} ${period}`);
	// A weekly entity's run settles its week and names its place in the month.
	reset();
	tables.get('entity')![0]!.pay_frequency = 'WEEKLY';
	shows('PERIOD_PART', 'double(period.parts) * 10.0 + double(period.part)');
	const plan = await run('2026-03-2', 'REGULAR');
	assert.deepEqual(
		[plan.run.salary_from, plan.run.salary_to, plan.run.attendance_from],
		['2026-03-08', '2026-03-14', '2026-03-08']
	);
	assert.equal(shown(plan, 'e1', 'PERIOD_PART'), 52);
});

test('earned.history reaches 24 months: a top-n of the scheme bases charged', async () => {
	reset();
	await run('2025-12', 'REGULAR');
	const version = versionOn('2027-01');
	for (const [code, quantity] of [
		['HISTORY_SPAN', 'double(size(earned.history)) * 10.0 + double(size(earned.months))'],
		['TOP_CPF_BASE', 'sum(top(earned.history.map(m, m.statutory.CPF.base), 6))']
	] as const)
		tables.get('work_catalog')!.push({
			id: `w-${code}`,
			settings_id: version,
			code,
			name: code,
			component_code: code,
			eligibility: 'true',
			quantity,
			rate: '1.0',
			destination: 'DISPLAY',
			direction: 'ADD',
			counts_toward: []
		});
	const january = await run('2027-01', 'REGULAR');
	// December 2025 is beyond `earned.months` (12 months) and inside `earned.history`.
	assert.equal(shown(january, 'e3', 'HISTORY_SPAN'), 10);
	assert.equal(shown(january, 'e3', 'TOP_CPF_BASE'), 4800);
	assert.deepEqual(evaluateConfigured('top([3.0, 9.0, 1.0, 7.0], 2)', {}), [9, 7]);
});

test('a workplace case names a kind its governing version lists and takes its employment’s company', async () => {
	reset();
	tables.set('rule_set', [
		{
			settings_id: versionOn('2026-03'),
			family: 'PAYROLL',
			code: 'case_kinds',
			rules: { kinds: [{ code: 'FLEXIBLE_WORK_REQUEST', name: 'Flexible work request' }] }
		}
	]);
	const admit = (input: Partial<Parameters<typeof admitCase>[0]>) =>
		Effect.runPromise(
			Effect.result(
				admitCase({
					company_id: null,
					employment_id: 'k-e1',
					kind: 'FLEXIBLE_WORK_REQUEST',
					opened_on: '2026-03-02',
					closed_on: null,
					...input
				}).pipe(Effect.provideService(Reads, reads))
			)
		);
	const admitted = await admit({});
	assert.ok(admitted._tag === 'Success' && admitted.success === COMPANY);
	for (const input of [
		{ kind: 'DATA_BREACH' },
		{ closed_on: '2026-03-01' },
		{ opened_on: '2027-03-02' }
	]) {
		const refused = await admit(input);
		assert.equal(refused._tag, 'Failure', JSON.stringify(input));
	}
});

test('leave taken under an earlier version’s class of the same code counts after the version changes', async () => {
	reset();
	// One class code in two versions: SG's January–June 2026 version and its July successor.
	for (const period of ['2026-03', '2026-08'])
		tables.get('leave_catalog')!.push({
			id: `metered-${period}`,
			settings_id: versionOn(period),
			code: 'METERED_LEAVE',
			name: 'Metered leave',
			entitlement: { window: 'CALENDAR_YEAR', days: '10.0' }
		});
	// Two days in March, recorded under the earlier version's row.
	entry(
		'leave_catalog_entry',
		'march',
		'e1',
		'metered-2026-03',
		'2026-03-10',
		{ days: 2, from: '2026-03-10', to: '2026-03-11' },
		'TIME_OFF'
	);
	const state = await Effect.runPromise(
		leaveState('k-e1', '2026-08-03').pipe(Effect.provideService(Reads, reads))
	);
	const balance = leaveBalances({
		...state,
		classes: state.classes.filter((cls) => cls.code === 'METERED_LEAVE')
	})[0]!;
	assert.deepEqual([balance.taken, balance.available], [2, 8]);
	// A write under the later version is judged against the same year: nine days exceed the eight left.
	const ctx = {
		existing: [],
		db: {
			read: (collection: never, query: never) => Effect.runPromise(reads.read(collection, query))
		},
		refuse: (message: string): never => {
			throw new Error(message);
		}
	};
	await assert.rejects(
		transformEntries(
			'leave_catalog_entry',
			[
				{
					catalog_id: 'metered-2026-08',
					employment_id: 'k-e1',
					occurred_on: '2026-08-03',
					activity: 'TIME_OFF',
					days: 9,
					from: '2026-08-03',
					to: '2026-08-13'
				}
			],
			ctx
		),
		/available 8 day/
	);
});

test('a carry_uncovered scheme advances the share net cannot cover and recovers it from the next slip', async () => {
	reset();
	tables
		.get('statutory_contribution_catalog')!
		.filter((row) => row.code === 'CPF')
		.forEach((row) => {
			row.configuration = {
				...(row.configuration as Row),
				carry_uncovered: true,
				// `net_available`: what the slip's priced lines and the schemes assessed before it leave.
				warn_when: [
					{ when: 'net_available == 500.0 - charged.month.CDAC.employee', message: 'net seen' }
				]
			};
		});
	tables.get('adhoc_catalog')!.push({
		id: 'recover',
		settings_id: versionOn('2026-03'),
		code: 'ADVANCE_RECOVERY',
		name: 'Advance recovery',
		destination: 'NET',
		direction: 'SUBTRACT',
		counts_toward: []
	});
	entry('adhoc_catalog_entry', 'adv', 'e2', 'recover', '2026-03-05', { amount: 5000 });
	const march = await run('2026-03', 'REGULAR');
	const shelly = slip(march, 'e2');
	const employee = (plan: Plan) =>
		slip(plan, 'e2').statutory.reduce((sum, line) => sum + line.employee_amount, 0);
	// 5,500 gross less 5,000 recovered leaves 500 for the employee shares; CPF's uncovered part is advanced.
	const short = Math.round((employee(march) - 500) * 100) / 100;
	assert.ok(short > 0);
	assert.ok(march.warnings.includes('Shelly: net seen'));
	assert.equal(shelly.net, 0);
	assert.deepEqual(
		shelly.adjustments
			.filter((line) => line.family === 'STATUTORY_CARRY')
			.map((line) => [line.component_code, line.amount]),
		[['CPF_CARRIED', short]]
	);
	// CPF is still charged in full for the month: the advance is the employer's, not a smaller share.
	assert.equal(line(march, 'e2', 'CPF')!.employee_amount, 1100);
	const april = await run('2026-04', 'REGULAR');
	assert.deepEqual(
		slip(april, 'e2')
			.adjustments.filter((line) => line.family === 'STATUTORY_CARRY')
			.map((line) => [line.component_code, line.amount]),
		[['CPF_CARRIED', -short]]
	);
	assert.equal(slip(april, 'e2').net, Math.round((5500 - employee(april) - short) * 100) / 100);
	// Recovered once: May carries nothing.
	const may = await run('2026-05', 'REGULAR');
	assert.equal(
		slip(may, 'e2').adjustments.filter((line) => line.family === 'STATUTORY_CARRY').length,
		0
	);
});

test('an off-cycle run reads the period’s leave rows at the statutory step, settled or not', async () => {
	reset();
	entry(
		'leave_catalog_entry',
		'al',
		'e1',
		catalog('leave_catalog', 'ANNUAL_LEAVE', '2026-03'),
		'2026-03-10',
		{ days: 1, from: '2026-03-10', to: '2026-03-10' },
		'TIME_OFF'
	);
	tables
		.get('statutory_contribution_catalog')!
		.filter((row) => row.code === 'CPF')
		.forEach((row) => {
			row.configuration = {
				...(row.configuration as Row),
				warn_when: [
					{
						when: 'has(leave.rows) && leave.rows.exists(l, l.code == "ANNUAL_LEAVE")',
						message: 'leave seen'
					}
				]
			};
		});
	// The regular run settles the leave row; a bonus paid off-cycle afterwards still sees it.
	await run('2026-03', 'REGULAR');
	entry(
		'adhoc_catalog_entry',
		'bonus-1',
		'e1',
		catalog('adhoc_catalog', 'bonus', '2026-03'),
		'2026-03-20',
		{ amount: 1000 }
	);
	const bonus = await run('2026-03', 'OFF_CYCLE', ['bonus-1']);
	assert.deepEqual(bonus.warnings, ['Kavriel: leave seen']);
	// The off-cycle slip pins nothing of the leave it read.
	assert.deepEqual(
		slip(bonus, 'e1').pins.map((pin) => pin.collection),
		['adhoc_catalog_entry']
	);
});

test('banked overtime: hours elected as time off leave overtime pay and credit the attendance root', async () => {
	reset();
	tables.get('roster_entry')!.push({
		id: 'r-ot',
		employment_id: 'k-e1',
		work_date: '2026-03-03',
		approval_id: null,
		approved_overtime_hours: 4,
		banked_overtime_hours: 1.5
	});
	shows('PAID_OT', 'work.overtime_hours');
	shows('BANKED_OT', 'sum(work.days.map(d, d.banked_hours))');
	shows('WORKED_OT', 'hours.month.overtime_hours');
	const plan = await run('2026-03', 'REGULAR');
	assert.deepEqual(
		['PAID_OT', 'BANKED_OT', 'WORKED_OT'].map((code) => shown(plan, 'e1', code)),
		[2.5, 1.5, 4]
	);
	tables.get('leave_catalog')!.push({
		id: 'lc-toil',
		settings_id: versionOn('2026-03'),
		code: 'TIME_OFF_IN_LIEU',
		name: 'Time off in lieu',
		entitlement: { window: 'CALENDAR_YEAR', days: 'attendance.window.banked_hours / 7.5' }
	});
	const state = await Effect.runPromise(
		leaveState('k-e1', '2026-03-31').pipe(Effect.provideService(Reads, reads))
	);
	const toil = leaveBalances({
		...state,
		classes: state.classes.filter((cls) => cls.code === 'TIME_OFF_IN_LIEU')
	})[0]!;
	assert.equal(toil.entitlement, 0.2);
});

test('a work suspension: its days in work.days and the attendance root, its effects its kind’s CEL', async () => {
	reset();
	// One generic catalogue row: attended, still scheduled, paid 60% of a day's base.
	tables.set('suspension_kind', [
		{
			settings_id: versionOn('2026-03'),
			code: 'CLOSURE',
			name: 'Closure',
			counts_as_attended: 'true',
			scheduled: 'day.day_type == "WORK"',
			pay: '0.6 * terms.base_salary / 26.0'
		},
		{
			settings_id: versionOn('2026-03'),
			code: 'EXCLUDED',
			name: 'Excluded',
			scheduled: 'false'
		}
	]);
	const suspension = (id: string, kind: string, from: string, to: string, ids: string[]) => ({
		id,
		company_id: COMPANY,
		approval_id: null,
		kind,
		starts_on: from,
		ends_on: to,
		worksite: null,
		employment_ids: ids,
		facts: {}
	});
	tables.set('work_suspension', [
		suspension('s1', 'CLOSURE', '2026-03-04', '2026-03-05', ['k-e2']),
		suspension('s2', 'EXCLUDED', '2026-03-09', '2026-03-09', ['k-e2'])
	]);
	shows(
		'SUSPENDED_PAY',
		'sum(work.days.filter(d, d.suspended != null && d.suspended.counts_as_attended).map(d, d.suspended.pay))'
	);
	const plan = await run('2026-03', 'REGULAR');
	// Two closure days at 0.6 × 5,500 / 26 each, a day rounded to the cent.
	assert.equal(shown(plan, 'e2', 'SUSPENDED_PAY'), 2 * 126.92);
	// Only the employments it names: Kavriel works on.
	assert.equal(shown(plan, 'e1', 'SUSPENDED_PAY'), undefined);
	tables.get('leave_catalog')!.push({
		id: 'lc-susp',
		settings_id: versionOn('2026-03'),
		code: 'SUSPENSION_TALLY',
		name: 'Suspension tally',
		entitlement: {
			window: 'CALENDAR_YEAR',
			days: 'double(attendance.window.suspended.CLOSURE) * 1000.0 + double(attendance.window.scheduled) * 10.0 + double(attendance.window.worked)'
		}
	});
	const state = await Effect.runPromise(
		leaveState('k-e2', '2026-03-31').pipe(Effect.provideService(Reads, reads))
	);
	// 2 closure days, counted as attended; 64 weekdays to 31 March less the excluded one.
	assert.equal(
		leaveBalances({
			...state,
			classes: state.classes.filter((cls) => cls.code === 'SUSPENSION_TALLY')
		})[0]!.entitlement,
		2000 + 63 * 10 + 2
	);
	const admit = (input: Partial<Parameters<typeof admitSuspension>[0]>) =>
		Effect.runPromise(
			Effect.result(
				admitSuspension({
					company_id: COMPANY,
					kind: 'CLOSURE',
					starts_on: '2026-03-04',
					ends_on: '2026-03-05',
					...input
				}).pipe(Effect.provideService(Reads, reads))
			)
		);
	assert.equal((await admit({}))._tag, 'Success');
	assert.equal((await admit({ kind: 'STRIKE' }))._tag, 'Failure');
	assert.equal((await admit({ ends_on: '2026-03-03' }))._tag, 'Failure');
});

test('back-to-back leave rows of one class are one chain: chain_from and the month of the leave', async () => {
	reset();
	const annualLeave = catalog('leave_catalog', 'ANNUAL_LEAVE', '2026-03');
	entry(
		'leave_catalog_entry',
		'first',
		'e1',
		annualLeave,
		'2026-01-15',
		{ days: 32, from: '2026-01-15', to: '2026-02-28', payslip_id: 'paid' },
		'TIME_OFF'
	);
	entry(
		'leave_catalog_entry',
		'extension',
		'e1',
		annualLeave,
		'2026-03-01',
		{ days: 22, from: '2026-03-01', to: '2026-03-31' },
		'TIME_OFF'
	);
	shows('CHAIN_FROM', 'leave.rows.exists(l, l.chain_from == "2026-01-15") ? 1.0 : 0.0');
	shows('LEAVE_MONTH', 'sum(leave.rows.map(l, double(l.month_index)))');
	const plan = await run('2026-03', 'REGULAR');
	// The extension continues the leave from 15 January: March is its second month, not its first.
	assert.deepEqual(
		['CHAIN_FROM', 'LEAVE_MONTH'].map((code) => shown(plan, 'e1', code)),
		[1, 2]
	);
});

test('a PAYEE engagement: a non-employee paid through entries alone, outside the headcount', async () => {
	reset();
	tables.get('employment_profile')!.push({ id: 'x1', name: 'Consultant' });
	tables.get('employment_contract')!.push({
		id: 'k-x1',
		employee_id: 'x1',
		company_id: COMPANY,
		approval_id: null,
		engagement: 'PAYEE',
		effective_range: { from: '2026-01-01', to: null },
		facts: { contract_terms: [{ effective_range: { from: '2026-01-01', to: null } }] }
	});
	tables.get('adhoc_catalog')!.push({
		id: 'fee',
		settings_id: versionOn('2026-03'),
		code: 'SERVICE_FEE',
		name: 'Service fee',
		destination: 'PAY',
		direction: 'ADD',
		counts_toward: []
	});
	entry('adhoc_catalog_entry', 'fee-1', 'x1', 'fee', '2026-03-10', { amount: 2000 });
	shows('ENGAGED', 'employment.engagement == "PAYEE" ? 1.0 : 0.0 + double(company.headcount)');
	// The payee's slip: the fee alone, with no salary and no base salary demanded.
	const plan = await run('2026-03', 'REGULAR');
	assert.deepEqual(
		slip(plan, 'x1').adjustments.map((row) => [row.component_code, row.amount]),
		[['SERVICE_FEE', 2000]]
	);
	assert.deepEqual(slip(plan, 'x1').base, []);
	// An employee's slip counts three in the headcount, not four.
	assert.equal(shown(plan, 'e1', 'ENGAGED'), 3);
});

test('a weekly slip’s statutory `wage` is its own week, `month` the month to date', async () => {
	reset();
	tables.get('entity')![0]!.pay_frequency = 'WEEKLY';
	const cpf = tables.get('statutory_contribution_catalog')!.filter((row) => row.code === 'CPF');
	for (const row of cpf)
		row.configuration = {
			...(row.configuration as Row),
			warn_when: [
				{
					when: 'period.part == 2 && wage.ordinary > 0.0 && month.ordinary > wage.ordinary',
					message: 'own week'
				}
			]
		};
	await run('2026-03-1', 'REGULAR');
	const second = await run('2026-03-2', 'REGULAR');
	assert.ok(second.warnings.includes('Kavriel: own week'));
});

test('anonymising a former employee waits for the governing version’s record_retention date', async () => {
	reset();
	const e3 = tables.get('employment_contract')!.find((row) => row.id === 'k-e3')!;
	e3.effective_range = { from: '2019-01-01', to: '2026-03-31' };
	tables.set('rule_set', [
		{
			settings_id: versionOn('2026-03'),
			family: 'PAYROLL',
			code: 'record_retention',
			rules: { until: 'add_years(employment.exit_date, 5)' }
		}
	]);
	const admit = (employee: string, today: string) =>
		Effect.runPromise(
			Effect.result(admitAnonymise(employee, today).pipe(Effect.provideService(Reads, reads)))
		);
	// Still employed: refused.
	assert.equal((await admit('e1', '2040-01-01'))._tag, 'Failure');
	// Ended, but within the five years: refused with the day it becomes possible.
	const early = await admit('e3', '2031-03-30');
	assert.ok(early._tag === 'Failure' && /2031-03-31/.test(early.failure.message));
	const due = await admit('e3', '2031-03-31');
	assert.ok(due._tag === 'Success' && due.success === '2031-03-31');
	// A version without the rule never allows it.
	tables.set('rule_set', []);
	assert.equal((await admit('e3', '2040-01-01'))._tag, 'Failure');
	// The neutral values keep nothing personal.
	const blank = anonymousProfile();
	assert.equal(blank.date_of_birth, null);
	assert.equal(blank.identity_number, null);
	assert.deepEqual([blank.children, blank.facts], [[], {}]);
});

test('earned months carry the days and hours worked and the suspended days of each month', async () => {
	reset();
	tables.set('suspension_kind', [
		{ settings_id: versionOn('2026-02'), code: 'CLOSURE', name: 'Closure', authority: 'Act s.1' }
	]);
	tables.set('work_suspension', [
		{
			id: 's1',
			company_id: COMPANY,
			approval_id: null,
			kind: 'CLOSURE',
			starts_on: '2026-02-10',
			ends_on: '2026-02-11',
			worksite: null,
			employment_ids: ['k-e1'],
			facts: {}
		}
	]);
	for (const date of ['2026-02-02', '2026-02-03'])
		tables.get('roster_entry')!.push({
			id: `r-${date}`,
			employment_id: 'k-e1',
			work_date: date,
			approval_id: null,
			worked_intervals: [{ start: `${date}T01:00:00.000Z`, end: `${date}T09:00:00.000Z` }]
		});
	await run('2026-02', 'REGULAR');
	shows(
		'FEBRUARY',
		'sum(earned.months.filter(m, m.month == "2026-02").map(m, double(m.worked_days) * 1000.0 + m.worked_hours * 10.0 + double(m.suspended_days)))'
	);
	const march = await run('2026-03', 'REGULAR');
	// Two days of eight hours clocked (seven worked, less the planned hour of break), two days suspended.
	assert.equal(shown(march, 'e1', 'FEBRUARY'), 2142);
});

test('count_within stays O(log n) a call: a rolling test over every item of a long list is fast', () => {
	const list = Array.from({ length: 2000 }, (_, i) => ({
		d: String(addDays('2026-01-01', Math.floor(i / 10))),
		facts: { worksite: 'A', note: 'x'.repeat(40) }
	}));
	const started = performance.now();
	const any = evaluateConfigured(
		'l.exists(s, count_within(l, "d", s.d, add_days(s.d, 59)) > 600)',
		{ l: list }
	);
	const elapsed = performance.now() - started;
	assert.equal(any, false);
	// 2,000 calls over 2,000 items: a whole-list check per call would be ~4 million item checks.
	assert.ok(elapsed < 500, `${elapsed} ms`);
});

test('count_within counts a sorted list’s items whose field falls in a range', () => {
	const list = [{ d: '2026-01-01' }, { d: '2026-01-10' }, { d: '2026-02-01' }, { d: '2026-03-01' }];
	assert.equal(
		evaluateConfigured('count_within(l, "d", "2026-01-05", "2026-02-01")', { l: list }),
		2
	);
	assert.equal(
		evaluateConfigured('count_within(l, "d", "2027-01-01", "2027-12-31")', { l: list }),
		0
	);
	assert.equal(
		evaluateConfigured('count_within(l, "d", "2025-01-01", "2026-12-31")', { l: list }),
		4
	);
});

test('banked overtime carries its band on the work day', async () => {
	reset();
	tables.get('roster_entry')!.push({
		id: 'r-ot',
		employment_id: 'k-e1',
		work_date: '2026-03-03',
		approval_id: null,
		approved_overtime_hours: 4,
		banked_overtime_hours: 1.5,
		banked_overtime_band: 'FIRST_TWO'
	});
	shows(
		'BANKED_BAND',
		'sum(work.days.filter(d, d.banked_band == "FIRST_TWO").map(d, d.banked_hours))'
	);
	assert.equal(shown(await run('2026-03', 'REGULAR'), 'e1', 'BANKED_BAND'), 1.5);
});

test('a suspended day names its suspension’s range and the scheduled days elapsed since it began', async () => {
	reset();
	tables.set('suspension_kind', [
		{ settings_id: versionOn('2026-03'), code: 'CLOSURE', name: 'Closure', pay: '1.0' }
	]);
	// From Thursday 26 February into March: two February working days, then March.
	tables.set('work_suspension', [
		{
			id: 's1',
			company_id: COMPANY,
			approval_id: null,
			kind: 'CLOSURE',
			starts_on: '2026-02-26',
			ends_on: '2026-03-04',
			worksite: null,
			employment_ids: ['k-e1'],
			facts: {}
		}
	]);
	shows(
		'ELAPSED',
		'sum(work.days.filter(d, d.suspended != null && d.suspended.from == "2026-02-26" && d.suspended.to == "2026-03-04").map(d, double(d.suspended.working_days_elapsed)))'
	);
	// Sunday 1 March follows two working days; 2, 3 and 4 March are the 3rd, 4th and 5th.
	assert.equal(shown(await run('2026-03', 'REGULAR'), 'e1', 'ELAPSED'), 2 + 3 + 4 + 5);
	tables.get('leave_catalog')!.push({
		id: 'lc-s',
		settings_id: versionOn('2026-03'),
		code: 'SUSPENSIONS',
		name: 'Suspensions',
		entitlement: {
			window: 'CALENDAR_YEAR',
			days: 'double(size(attendance.window.suspensions.filter(s, s.kind == "CLOSURE" && s.from == "2026-02-26" && s.to == "2026-03-04")))'
		}
	});
	const state = await Effect.runPromise(
		leaveState('k-e1', '2026-03-31').pipe(Effect.provideService(Reads, reads))
	);
	assert.equal(
		leaveBalances({
			...state,
			classes: state.classes.filter((cls) => cls.code === 'SUSPENSIONS')
		})[0]!.entitlement,
		1
	);
});

test('the canonical window-end encashment pays a class’s untaken balance on its window’s last day, once', () => {
	const pack = behavioursOf(law('jurisdiction_settings')[0]!['behaviours']);
	assert.ok(pack);
	const context = (day: string, reference: string | null) => ({
		event: {
			collection: 'calendar',
			action: 'daily',
			settings_id: 's1',
			day,
			row: { id: 'k-e1', approval_id: null },
			leave_balances: [
				{ code: 'TIME_OFF_IN_LIEU', available: 3.5, window_to: '2026-12-31' },
				{ code: 'ANNUAL_LEAVE', available: 9, window_to: '2026-12-31' }
			]
		},
		catalogues: [{ id: 'toil', code: 'TIME_OFF_IN_LIEU' }],
		movements: reference == null ? [] : [{ reference }]
	});
	const writes = (day: string, reference: string | null = null) =>
		planBehaviours(
			pack,
			{ kind: 'row', collection: 'calendar', event: 'daily' },
			context(day, reference)
		)
			.filter((rule) => rule.id === 'encash-leave-at-window-end')
			.flatMap((rule) => effectWrites(rule, context(day, reference)))
			.map((write) => write.data);
	assert.deepEqual(writes('2026-12-31'), [
		{
			catalog_id: 'toil',
			employment_id: 'k-e1',
			occurred_on: '2026-12-31',
			activity: 'ENCASHMENT',
			reference: 'window:k-e1:TIME_OFF_IN_LIEU:2026-12-31',
			days: 3.5,
			incurred_on: '2026-12-31'
		}
	]);
	assert.deepEqual(writes('2026-12-30'), []);
	assert.deepEqual(writes('2026-12-31', 'window:k-e1:TIME_OFF_IN_LIEU:2026-12-31'), []);
});

test('earned months count leave days by class and suspended days by kind', async () => {
	reset();
	tables.set('suspension_kind', [
		{ settings_id: versionOn('2026-02'), code: 'CLOSURE', name: 'Closure' }
	]);
	tables.set('work_suspension', [
		{
			id: 's1',
			company_id: COMPANY,
			approval_id: null,
			kind: 'CLOSURE',
			starts_on: '2026-02-10',
			ends_on: '2026-02-11',
			worksite: null,
			employment_ids: ['k-e1'],
			facts: {}
		}
	]);
	// Thursday 5 to Monday 9 February: three scheduled days of annual leave.
	entry(
		'leave_catalog_entry',
		'al-feb',
		'e1',
		catalog('leave_catalog', 'ANNUAL_LEAVE', '2026-02'),
		'2026-02-05',
		{ days: 3, from: '2026-02-05', to: '2026-02-09' },
		'TIME_OFF'
	);
	await run('2026-02', 'REGULAR');
	shows(
		'FEB_LEAVE',
		'sum(earned.months.filter(m, m.month == "2026-02").map(m, (has(m.leave_days.ANNUAL_LEAVE) ? double(m.leave_days.ANNUAL_LEAVE) : 0.0) * 10.0 + (has(m.suspended_days_by_kind.CLOSURE) ? double(m.suspended_days_by_kind.CLOSURE) : 0.0)))'
	);
	assert.equal(shown(await run('2026-03', 'REGULAR'), 'e1', 'FEB_LEAVE'), 32);
});

test('a roster week splits its overtime by day type and holiday, so a cap can leave rest-day work out', async () => {
	reset();
	tables.set('rule_set', [
		{
			settings_id: versionOn('2026-03'),
			family: 'VALIDATIONS',
			code: 'WEEKLY_OT_CAP',
			rules: {
				site: 'roster',
				kind: 'warn',
				when: 'week.overtime_hours_by_day_type.WORK - week.overtime_hours_by_day_type.HOLIDAY > 3.0',
				message: 'over the weekly cap'
			}
		}
	]);
	tables.get('holiday')!.push({
		id: 'h1',
		company_id: COMPANY,
		date: '2026-03-04',
		name: 'Holiday',
		kind: 'PUBLIC_HOLIDAY',
		published_at: '2026-01-01T00:00:00.000Z'
	});
	const day = (ref: number, work_date: string, overtime: number) => ({
		ref,
		employment_id: 'k-e1',
		work_date,
		worked_intervals: [{ start: `${work_date}T01:00:00.000Z`, end: `${work_date}T11:00:00.000Z` }],
		approved_overtime_hours: overtime,
		leave_code: ''
	});
	const findings = (drafts: ReturnType<typeof day>[]) =>
		Effect.runPromise(
			rosterFindings(COMPANY, drafts).pipe(Effect.provideService(Reads, reads))
		).then((rows) => rows.map((row) => [row.ref, row.code]));
	// 2 h on Monday, 2 h on the Wednesday holiday, 6 h on Saturday's rest day: 2 h of capped overtime.
	assert.deepEqual(
		await findings([day(1, '2026-03-02', 2), day(2, '2026-03-04', 2), day(3, '2026-03-07', 6)]),
		[]
	);
	// 4 weekday hours trip it.
	assert.deepEqual(await findings([day(1, '2026-03-02', 2), day(2, '2026-03-03', 2)]), [
		[2, 'WEEKLY_OT_CAP']
	]);
});

test('a roster day carries its own overtime consent: a check keyed to the day, not the contract', async () => {
	reset();
	tables.set('rule_set', [
		{
			settings_id: versionOn('2026-03'),
			family: 'VALIDATIONS',
			code: 'OT_WITHOUT_CONSENT',
			rules: {
				site: 'roster',
				kind: 'warn',
				when: 'day.overtime_hours > 0.0 && !day.overtime_consented && day.overtime_consented_at == null',
				message: 'overtime without consent'
			}
		}
	]);
	const day = (ref: number, work_date: string, consent: string | null) => ({
		ref,
		employment_id: 'k-e1',
		work_date,
		worked_intervals: [{ start: `${work_date}T01:00:00.000Z`, end: `${work_date}T11:00:00.000Z` }],
		approved_overtime_hours: 2,
		overtime_consented_at: consent,
		leave_code: ''
	});
	const findings = await Effect.runPromise(
		rosterFindings(COMPANY, [
			day(1, '2026-03-02', null),
			day(2, '2026-03-03', '2026-03-03T00:00:00.000Z')
		]).pipe(Effect.provideService(Reads, reads))
	);
	assert.deepEqual(
		findings.map((row) => [row.ref, row.code]),
		[[1, 'OT_WITHOUT_CONSENT']]
	);
});

test('a roster week separates holiday overtime by the holiday’s day type and counts its normal holiday hours', async () => {
	reset();
	tables.set('rule_set', [
		{
			settings_id: versionOn('2026-03'),
			family: 'VALIDATIONS',
			code: 'HOLIDAY_SPLIT',
			rules: {
				site: 'roster',
				kind: 'warn',
				when: 'week.overtime_hours_holiday_by_day_type.REST == 3.0 && week.overtime_hours_holiday_by_day_type.WORK == 2.0 && week.holiday_worked_hours == 14.0',
				message: 'split'
			}
		}
	]);
	for (const [id, date] of [
		['h1', '2026-03-04'],
		['h2', '2026-03-07']
	] as const)
		tables.get('holiday')!.push({
			id,
			company_id: COMPANY,
			date,
			name: 'Holiday',
			kind: 'PUBLIC_HOLIDAY',
			published_at: '2026-01-01T00:00:00.000Z'
		});
	// Ten hours a day: a Wednesday holiday with 2 h overtime, a Saturday (rest-day) holiday with 3 h.
	const day = (ref: number, work_date: string, overtime: number) => ({
		ref,
		employment_id: 'k-e1',
		work_date,
		worked_intervals: [{ start: `${work_date}T01:00:00.000Z`, end: `${work_date}T11:00:00.000Z` }],
		approved_overtime_hours: overtime,
		leave_code: ''
	});
	const findings = await Effect.runPromise(
		rosterFindings(COMPANY, [day(1, '2026-03-04', 2), day(2, '2026-03-07', 3)]).pipe(
			Effect.provideService(Reads, reads)
		)
	);
	// (10 − 1 − 2) + (10 − 3) normal hours on the two holidays: the working day nets its planned hour of break.
	assert.deepEqual(
		findings.map((row) => [row.ref, row.code]),
		[[2, 'HOLIDAY_SPLIT']]
	);
});

test('money rounds to the payroll currency’s minor units, or the version’s payroll.minor_units', async () => {
	assert.equal(currencyScale('JPY'), 0);
	assert.equal(currencyScale('SGD'), 2);
	reset();
	shows('THIRD', '1.0', '1000.0 / 3.0');
	const sgd = await run('2026-03', 'REGULAR');
	assert.equal(shown(sgd, 'e1', 'THIRD'), 333.33);
	// The same record under a version paid in whole units.
	reset();
	const version = tables
		.get('jurisdiction_settings')!
		.find((row) => row.id === versionOn('2026-03'))!;
	version.payroll = { ...(version.payroll as Row), minor_units: 0 };
	shows('THIRD', '1.0', '1000.0 / 3.0');
	const whole = await run('2026-03', 'REGULAR');
	assert.equal(shown(whole, 'e1', 'THIRD'), 333);
	assert.ok(
		whole.payslips.every(
			(row) =>
				Number.isInteger(row.net) &&
				row.statutory.every((line) => Number.isInteger(line.employee_amount))
		)
	);
});

test('the year roots start in the version’s payroll.tax_year_start_month', async () => {
	reset();
	const version = tables
		.get('jurisdiction_settings')!
		.find((row) => row.id === versionOn('2026-03'))!;
	version.payroll = { ...(version.payroll as Row), tax_year_start_month: 4 };
	await run('2026-03', 'REGULAR');
	await run('2026-04', 'REGULAR');
	shows('YEAR_GROSS', 'earned.year.gross', '1.0', 'period.key == "2026-05"');
	const may = await run('2026-05', 'REGULAR');
	// April alone: March belongs to the tax year that ended.
	assert.equal(shown(may, 'e1', 'YEAR_GROSS'), 6500);
});

test('local days and clocks follow the entity zone, else the version’s payroll.timezone', async () => {
	reset();
	tables.get('roster_entry')!.push({
		id: 'r-am',
		employment_id: 'k-e1',
		work_date: '2026-03-03',
		approval_id: null,
		worked_intervals: [{ start: '2026-03-03T01:00:00.000Z', end: '2026-03-03T09:00:00.000Z' }]
	});
	shows(
		'OFFICE_HOURS',
		'sum(work.days.filter(d, d.date == "2026-03-03").map(d, hours_between(d.intervals, "09:00", "17:00")))'
	);
	// No entity zone: the SG version's Asia/Singapore puts 01:00–09:00 UTC at 09:00–17:00, less the planned break.
	assert.equal(shown(await run('2026-03', 'REGULAR'), 'e1', 'OFFICE_HOURS'), 7);
	reset();
	tables.get('entity')![0]!.time_zone = 'UTC';
	tables.get('roster_entry')!.push({
		id: 'r-am',
		employment_id: 'k-e1',
		work_date: '2026-03-03',
		approval_id: null,
		worked_intervals: [{ start: '2026-03-03T01:00:00.000Z', end: '2026-03-03T09:00:00.000Z' }]
	});
	shows(
		'OFFICE_HOURS',
		'sum(work.days.filter(d, d.date == "2026-03-03").map(d, hours_between(d.intervals, "09:00", "17:00")))'
	);
	assert.equal(shown(await run('2026-03', 'REGULAR'), 'e1', 'OFFICE_HOURS'), undefined);
});

test('audit roots: a rolling-hours span, a scheme order, validations that read worked days, one can_encash reading', async () => {
	reset();
	const version = tables
		.get('jurisdiction_settings')!
		.find((row) => row.id === versionOn('2026-03'))!;
	version.payroll = { ...(version.payroll as Row), rolling_hours_months: 2 };
	for (const [date, hours] of [
		['2026-01-10', 3],
		['2026-02-10', 4],
		['2026-03-10', 5]
	] as const)
		tables.get('roster_entry')!.push({
			id: `r-${date}`,
			employment_id: 'k-e1',
			work_date: date,
			approval_id: null,
			payslip_id: date < '2026-03-01' ? 'paid' : null,
			approved_overtime_hours: hours
		});
	// Two months rolling: February and March.
	shows('ROLLING_OT', 'hours.rolling.overtime_hours');
	// A class with no can_encash flag stored is encashable on the slip as in balances (the model's default).
	tables.get('leave_catalog')!.push({
		id: 'lc-x',
		settings_id: versionOn('2026-03'),
		code: 'FLAGLESS',
		name: 'Flagless'
	});
	entry(
		'leave_catalog_entry',
		'fx',
		'e1',
		'lc-x',
		'2026-03-11',
		{ days: 1, from: '2026-03-11', to: '2026-03-11' },
		'TIME_OFF'
	);
	shows('ENCASHABLE', 'leave.rows.exists(l, l.code == "FLAGLESS" && l.can_encash) ? 1.0 : 0.0');
	// A payslip validation alone reading earned worked days turns the tally on.
	tables.set('rule_set', [
		{
			settings_id: versionOn('2026-03'),
			family: 'VALIDATIONS',
			code: 'WORKED_SEEN',
			rules: {
				site: 'payslip',
				kind: 'warn',
				when: 'earned.months.exists(m, has(m.worked_days))',
				message: 'worked days seen'
			}
		}
	]);
	await run('2026-02', 'REGULAR');
	// Schemes ordered by configuration.order before their codes: CPF first, so net_available is CPF's whole net.
	const cpf = tables
		.get('statutory_contribution_catalog')!
		.filter((row) => row.code === 'CPF' && row.settings_id === versionOn('2026-03'));
	for (const row of cpf)
		row.configuration = {
			...(row.configuration as Row),
			order: 1,
			warn_when: [{ when: 'net_available == 6500.0', message: 'CPF first' }]
		};
	const march = await run('2026-03', 'REGULAR');
	assert.deepEqual(
		['ROLLING_OT', 'ENCASHABLE'].map((code) => shown(march, 'e1', code)),
		[9, 1]
	);
	assert.ok(march.warnings.includes('Kavriel: worked days seen'));
	assert.ok(march.warnings.includes('Kavriel: CPF first'));
});

/** Set keys on the version governing a month's `payroll` object. */
const payrollOf = (period: string, patch: Row) => {
	const version = tables.get('jurisdiction_settings')!.find((row) => row.id === versionOn(period))!;
	version.payroll = { ...(version.payroll as Row), ...patch };
};

test('audit 13: the run’s pay day is the version’s payroll.pay_date CEL', async () => {
	reset();
	assert.equal((await run('2026-03', 'REGULAR')).run.pay_date, '2026-03-31');
	reset();
	payrollOf('2026-03', { pay_date: 'add_days(period.to, 7)' });
	const plan = await run('2026-03', 'REGULAR');
	assert.deepEqual([plan.run.pay_date, plan.run.pay_due_date], ['2026-04-07', '2026-04-07']);
});

test('audit 14: payroll.week_start and payroll.semi_monthly_split move the period boundaries', async () => {
	const settle = (period: string, frequency: string, calendar: Row) =>
		Effect.runPromise(Effect.result(settlementPeriod(period, frequency, calendar)));
	// Monday weeks: March 2026's Mondays are the 2nd, 9th, 16th, 23rd and 30th.
	const monday = await settle('2026-03-1', 'WEEKLY', { week_start: 1 });
	assert.ok(monday._tag === 'Success');
	assert.deepEqual(monday.success, { from: '2026-03-02', to: '2026-03-08', part: 1, parts: 5 });
	const late = await settle('2026-03-2', 'SEMI_MONTHLY', { semi_monthly_split: 10 });
	assert.ok(late._tag === 'Success' && late.success.from === '2026-03-11');
	// The defaults are the seeded calendar: Sunday weeks, halves at the 15th.
	const plain = await settle('2026-03-1', 'WEEKLY', {});
	assert.ok(plain._tag === 'Success' && plain.success.from === '2026-03-01');
});

test('audit 15: payroll.roster_week CALENDAR sums the calendar week from week_start, not the last seven days', async () => {
	reset();
	tables.set('rule_set', [
		{
			settings_id: versionOn('2026-03'),
			family: 'VALIDATIONS',
			code: 'WEEK_DAYS',
			rules: { site: 'roster', kind: 'warn', when: 'week.worked_days >= 3', message: 'three' }
		}
	]);
	const day = (ref: number, work_date: string) => ({
		ref,
		employment_id: 'k-e1',
		work_date,
		worked_intervals: [{ start: `${work_date}T01:00:00.000Z`, end: `${work_date}T09:00:00.000Z` }],
		approved_overtime_hours: 0,
		leave_code: ''
	});
	// Saturday, Sunday, Monday: three in the last seven days; one in Monday's calendar week.
	const drafts = [day(1, '2026-03-07'), day(2, '2026-03-08'), day(3, '2026-03-09')];
	const codes = () =>
		Effect.runPromise(
			rosterFindings(COMPANY, drafts).pipe(Effect.provideService(Reads, reads))
		).then((rows) => rows.map((row) => row.ref));
	assert.deepEqual(await codes(), [3]);
	payrollOf('2026-03', { roster_week: 'CALENDAR', week_start: 1 });
	assert.deepEqual(await codes(), []);
});

test('audit 17: a class shares a leave row across periods by calendar days when its share_by says', async () => {
	reset();
	const annual = catalog('leave_catalog', 'ANNUAL_LEAVE', '2026-03');
	// Friday 27 March to Thursday 2 April: 5 working days, 7 calendar; 3 working and 5 calendar in March.
	entry(
		'leave_catalog_entry',
		'span',
		'e1',
		annual,
		'2026-03-27',
		{ days: 5, from: '2026-03-27', to: '2026-04-02' },
		'TIME_OFF'
	);
	shows('MARCH_SHARE', 'sum(leave.rows.map(l, l.days))');
	assert.equal(shown(await run('2026-03', 'REGULAR'), 'e1', 'MARCH_SHARE'), 3);
	tables.get('leave_catalog')!.find((row) => row.id === annual)!.share_by = 'CALENDAR_DAYS';
	tables.get('payroll_run')!.length = 0;
	tables.get('payslip')!.length = 0;
	tables.get('leave_catalog_entry')![0]!.payslip_id = null;
	// 5 days × 5 of 7 calendar days, shown to the cent.
	assert.equal(shown(await run('2026-03', 'REGULAR'), 'e1', 'MARCH_SHARE'), 3.57);
});

test('audit 18: a prorated line states the divisor its record names (work_catalog.denominator)', async () => {
	reset();
	const e1 = tables.get('employment_contract')!.find((row) => row.id === 'k-e1')!;
	e1.effective_range = { from: '2026-03-16', to: null };
	const basic = tables
		.get('work_catalog')!
		.find((row) => row.settings_id === versionOn('2026-03') && row.prorated === true)!;
	const before = slip(await run('2026-03', 'REGULAR'), 'e1');
	assert.equal(before.proration[0]!.denominator, 31);
	reset();
	tables.get('employment_contract')!.find((row) => row.id === 'k-e1')!.effective_range = {
		from: '2026-03-16',
		to: null
	};
	tables.get('work_catalog')!.find((row) => row.id === basic.id)!.denominator = '26.0';
	const after = slip(await run('2026-03', 'REGULAR'), 'e1');
	assert.equal(after.proration[0]!.denominator, 26);
	assert.equal(after.service_basis[0]!.denominator, 26);
});

test('audit 19: payroll.base_salary_required false pays a contract with no monthly base', async () => {
	reset();
	const term = (
		(tables.get('employment_contract')!.find((row) => row.id === 'k-e1')!.facts as Row)
			.contract_terms as Row[]
	)[0]!;
	term.base_salary = { value: 0, currency: 'SGD' };
	assert.match(await refused('2026-03', 'REGULAR'), /carries no base salary/);
	payrollOf('2026-03', { base_salary_required: false });
	// A day-rated line pays what the base does not.
	tables.get('work_catalog')!.push({
		id: 'w-day',
		settings_id: versionOn('2026-03'),
		code: 'DAY_RATE',
		name: 'Day rate',
		component_code: 'DAY_RATE',
		eligibility: 'terms.base_salary == 0.0',
		quantity: '22.0',
		rate: '100.0',
		destination: 'PAY',
		direction: 'ADD',
		counts_toward: []
	});
	assert.equal(shown(await run('2026-03', 'REGULAR'), 'e1', 'DAY_RATE'), 2200);
});

test('audit 20: a class with amount_required false takes an entry priced by its bands alone', async () => {
	reset();
	tables.get('adhoc_catalog')!.push({
		id: 'piece',
		settings_id: versionOn('2026-03'),
		code: 'PIECE',
		name: 'Piece rate',
		destination: 'PAY',
		direction: 'ADD',
		counts_toward: [],
		amount_required: false,
		bands: [{ when: 'true', amount: 'entry.quantity * 2.5' }]
	});
	const ctx = {
		existing: [],
		db: {
			read: (collection: never, query: never) => Effect.runPromise(reads.read(collection, query))
		},
		refuse: (message: string): never => {
			throw new Error(message);
		}
	};
	await transformEntries(
		'adhoc_catalog_entry',
		[{ catalog_id: 'piece', employment_id: 'k-e1', occurred_on: '2026-03-05', quantity: 40 }],
		ctx
	);
	await assert.rejects(
		transformEntries(
			'adhoc_catalog_entry',
			[
				{
					catalog_id: catalog('adhoc_catalog', 'bonus', '2026-03'),
					employment_id: 'k-e1',
					occurred_on: '2026-03-05'
				}
			],
			ctx
		),
		/Enter the amount/
	);
});

test('audit 21: payroll.off_cycle_families lets an off-cycle run settle loan entries', async () => {
	reset();
	tables.get('loan_catalog')!.push({
		id: 'loan',
		settings_id: versionOn('2026-03'),
		code: 'STAFF_LOAN',
		name: 'Staff loan',
		destination: 'NET',
		direction: 'SUBTRACT'
	});
	entry('loan_catalog_entry', 'l1', 'e1', 'loan', '2026-03-05', { amount: 300 });
	entry(
		'adhoc_catalog_entry',
		'b1',
		'e1',
		catalog('adhoc_catalog', 'bonus', '2026-03'),
		'2026-03-05',
		{ amount: 1000 }
	);
	assert.match(await refused('2026-03', 'OFF_CYCLE', ['b1', 'l1']), /not an approved, unpaid/);
	payrollOf('2026-03', { off_cycle_families: ['ADHOC', 'CLAIM', 'LOAN_REPAYMENT'] });
	// A final settlement recovers the loan from the bonus it pays.
	const plan = await run('2026-03', 'OFF_CYCLE', ['b1', 'l1']);
	assert.deepEqual(
		slip(plan, 'e1')
			.adjustments.map((row) => [row.component_code, row.amount])
			.toSorted(),
		[
			['STAFF_LOAN', -300],
			['bonus', 1000]
		]
	);
});

test('audit 22: a scheme reads its subject on configuration.as_of (period_end), not the period start', async () => {
	reset();
	// Dernese turns 29 on 30 June; a June slip read at the period end sees the new age.
	const cpf = tables
		.get('statutory_contribution_catalog')!
		.filter((row) => row.code === 'CPF' && row.settings_id === versionOn('2026-06'));
	for (const row of cpf)
		row.configuration = {
			...(row.configuration as Row),
			warn_when: [{ when: 'employee.age == 29', message: 'twenty-nine' }]
		};
	tables.get('employment_profile')!.find((row) => row.id === 'e3')!.date_of_birth = '1997-06-30';
	assert.ok(!(await run('2026-06', 'REGULAR')).warnings.includes('Dernese: twenty-nine'));
	for (const row of cpf) row.configuration = { ...(row.configuration as Row), as_of: 'period_end' };
	tables.get('payroll_run')!.length = 0;
	tables.get('payslip')!.length = 0;
	assert.ok((await run('2026-06', 'REGULAR')).warnings.includes('Dernese: twenty-nine'));
});

test('audit 23/24: terms.monthly_wage is the version’s payroll.monthly_wage CEL; terms carries every key', async () => {
	reset();
	const term = (
		(tables.get('employment_contract')!.find((row) => row.id === 'k-e1')!.facts as Row)
			.contract_terms as Row[]
	)[0]!;
	term.allowances = [
		{ code: 'TRANSPORT', amount: 200 },
		{ code: 'MEAL', amount: 100 }
	];
	term.pay_frequency = 'MONTHLY';
	term.grade = 'G7';
	tables.get('allowance_catalog')!.push(
		...['TRANSPORT', 'MEAL'].map((code) => ({
			id: `a-${code}`,
			settings_id: versionOn('2026-03'),
			code,
			name: code,
			destination: 'DISPLAY',
			direction: 'ADD',
			counts_toward: [],
			amount: 'allowance.amount'
		}))
	);
	shows(
		'WAGE',
		'terms.monthly_wage',
		'1.0',
		'has(terms.grade) && terms.grade == "G7" && terms.pay_frequency == "MONTHLY"'
	);
	assert.equal(shown(await run('2026-03', 'REGULAR'), 'e1', 'WAGE'), 6800);
	reset();
	const again = (
		(tables.get('employment_contract')!.find((row) => row.id === 'k-e1')!.facts as Row)
			.contract_terms as Row[]
	)[0]!;
	again.allowances = [{ code: 'TRANSPORT', amount: 200 }];
	payrollOf('2026-03', { monthly_wage: 'terms.base_salary' });
	shows('WAGE', 'terms.monthly_wage');
	tables.get('allowance_catalog')!.push({
		id: 'a-TRANSPORT',
		settings_id: versionOn('2026-03'),
		code: 'TRANSPORT',
		name: 'TRANSPORT',
		destination: 'DISPLAY',
		direction: 'ADD',
		counts_toward: [],
		amount: 'allowance.amount'
	});
	assert.equal(shown(await run('2026-03', 'REGULAR'), 'e1', 'WAGE'), 6500);
});

test('allowances captured under another version map to their class in one read for the whole run', async () => {
	reset();
	for (const contract of tables.get('employment_contract')!)
		for (const term of (contract.facts as Row).contract_terms as Row[])
			term.allowances = [{ catalogue_id: 'a-old', amount: 200 }];
	tables.get('allowance_catalog')!.push(
		...[
			{ id: 'a-old', settings_id: 'an-earlier-version' },
			{ id: 'a-TRANSPORT', settings_id: versionOn('2026-03') }
		].map((row) => ({
			...row,
			code: 'TRANSPORT',
			name: 'TRANSPORT',
			destination: 'PAY',
			direction: 'ADD',
			counts_toward: [],
			amount: 'allowance.amount'
		}))
	);
	let byId = 0;
	const counted = {
		read: (...args: Parameters<typeof reads.read>) => {
			const [collection, query] = args as [string, { where?: { id?: unknown } }];
			if (collection === 'allowance_catalog' && query.where?.id != null) byId++;
			return reads.read(...args);
		}
	};
	const plan = await Effect.runPromise(
		buildPayrollRun({ company_id: COMPANY, period: '2026-03', kind: 'REGULAR' }).pipe(
			Effect.provideService(Reads, counted)
		)
	);
	assert.ok(plan.payslips.length > 1);
	assert.equal(byId, 1);
});

test('audit 37: payroll.negative_net allow keeps a slip whose net is negative', async () => {
	reset();
	tables.get('adhoc_catalog')!.push({
		id: 'claw',
		settings_id: versionOn('2026-03'),
		code: 'CLAWBACK',
		name: 'Clawback',
		destination: 'NET',
		direction: 'SUBTRACT',
		counts_toward: []
	});
	entry('adhoc_catalog_entry', 'c1', 'e2', 'claw', '2026-03-05', { amount: 9000 });
	assert.match(await refused('2026-03', 'REGULAR'), /net pay would be negative/);
	payrollOf('2026-03', { negative_net: 'allow' });
	assert.ok(slip(await run('2026-03', 'REGULAR'), 'e2').net < 0);
});

test('leave entitlement contexts read the governing version’s tax year', async () => {
	reset();
	payrollOf('2026-03', { tax_year_start_month: 4 });
	await run('2026-03', 'REGULAR');
	tables.get('leave_catalog')!.push({
		id: 'lc-y',
		settings_id: versionOn('2026-04'),
		code: 'YEAR_GROSS',
		name: 'Year gross',
		entitlement: { window: 'CALENDAR_YEAR', days: 'earned.year.gross / 100.0' }
	});
	payrollOf('2026-04', { tax_year_start_month: 4 });
	const state = await Effect.runPromise(
		leaveState('k-e1', '2026-04-10').pipe(Effect.provideService(Reads, reads))
	);
	// April opens a new tax year: March's slip is last year's.
	assert.equal(
		leaveBalances({
			...state,
			classes: state.classes.filter((cls) => cls.code === 'YEAR_GROSS')
		})[0]!.entitlement,
		0
	);
});

test('work.week_before: the week’s days before the period, from payroll.week_start, marked in_period false', async () => {
	reset();
	payrollOf('2026-03', { week_start: 1 });
	for (const date of ['2026-02-26', '2026-02-27'])
		tables.get('roster_entry')!.push({
			id: `r-${date}`,
			employment_id: 'k-e1',
			work_date: date,
			approval_id: null,
			payslip_id: 'paid-in-february',
			worked_intervals: [{ start: `${date}T01:00:00.000Z`, end: `${date}T08:00:00.000Z` }]
		});
	// March 2026 opens on a Sunday: its Monday week began on 23 February. Each day is 09:00–16:00 Singapore time less
	// the planned hour of break.
	shows(
		'WEEK_BEFORE',
		'double(size(work.week_before)) * 100.0 + sum(work.week_before.filter(d, !d.in_period).map(d, d.worked_hours))'
	);
	assert.equal(shown(await run('2026-03', 'REGULAR'), 'e1', 'WEEK_BEFORE'), 612);
});

test('month to date: hours.month_to_date and work.month_days[] run from the 1st to the period’s end, earlier parts included', async () => {
	const worked = (date: string) =>
		tables.get('roster_entry')!.push({
			id: `r-${date}`,
			employment_id: 'k-e1',
			work_date: date,
			approval_id: null,
			payslip_id: null,
			worked_intervals: [{ start: `${date}T01:00:00.000Z`, end: `${date}T08:00:00.000Z` }]
		});
	const semiMonthly = () => {
		reset();
		tables.get('entity')![0]!.pay_frequency = 'SEMI_MONTHLY';
		worked('2026-03-05');
		worked('2026-03-20');
	};
	// Each day is 09:00–16:00 Singapore time less the planned hour of break: 6 hours.
	semiMonthly();
	shows('MONTH_TO_DATE', 'hours.month_to_date.worked_hours * 100.0 + hours.month.worked_hours');
	// The first half reads its own day to date; the calendar month already holds the second half's.
	assert.equal(shown(await run('2026-03-1', 'REGULAR'), 'e1', 'MONTH_TO_DATE'), 612);
	semiMonthly();
	shows(
		'MONTH_DAYS',
		'double(size(work.month_days.filter(d, d.worked))) * 10.0 + double(size(work.month_days.filter(d, d.worked && !d.in_period)))'
	);
	// The second half reads both days; the first half's is an earlier part's, not in this period.
	assert.equal(shown(await run('2026-03-2', 'REGULAR'), 'e1', 'MONTH_DAYS'), 21);
});

test('period.month_working_days: the whole month’s scheduled working days less holidays, the same in both halves', async () => {
	const halves = async () => {
		reset();
		tables.get('entity')![0]!.pay_frequency = 'SEMI_MONTHLY';
		// A published holiday on a Wednesday of the second half.
		tables.get('holiday')!.push({
			id: 'h-0318',
			company_id: COMPANY,
			date: '2026-03-18',
			name: 'Test holiday',
			kind: 'PUBLIC_HOLIDAY',
			published_at: '2026-01-01'
		});
		// and one on a Saturday, a rest day: no working day of the month
		tables.get('holiday')!.push({
			id: 'h-0321',
			company_id: COMPANY,
			date: '2026-03-21',
			name: 'Rest-day holiday',
			kind: 'PUBLIC_HOLIDAY',
			published_at: '2026-01-01'
		});
		shows(
			'MONTH_WORKING',
			'double(period.month_holiday_work_days) * 10000.0 + double(period.month_working_days) * 100.0 + double(period.working_days)'
		);
		return [
			shown(await run('2026-03-1', 'REGULAR'), 'e1', 'MONTH_WORKING'),
			shown(await run('2026-03-2', 'REGULAR'), 'e1', 'MONTH_WORKING')
		];
	};
	// March 2026 on a Monday–Friday week: 22 weekdays, one a holiday (the Saturday one falls on no working day). The
	// 1st–15th hold 10 weekdays, the 16th–31st 12; both halves read the month's 21 and its one working-day holiday, so a
	// divisor that counts holidays (SG s.20A) is 21 + 1.
	assert.deepEqual(await halves(), [12110, 12112]);
});

test('period.previous_month_working_days: the calendar month before’s planned working days and its working-day holidays', async () => {
	reset();
	tables.get('entity')![0]!.pay_frequency = 'SEMI_MONTHLY';
	// February 2026 on a Monday–Friday week: 20 weekdays; a published holiday on Tuesday the 17th
	tables.get('holiday')!.push({
		id: 'h-0217',
		company_id: COMPANY,
		date: '2026-02-17',
		name: 'February holiday',
		kind: 'PUBLIC_HOLIDAY',
		published_at: '2026-01-01'
	});
	shows(
		'PREVIOUS_WORKING',
		'double(period.previous_month_working_days) * 100.0 + double(period.previous_month_holiday_work_days)'
	);
	// both halves of March read February's 19 working days and its one working-day holiday
	assert.deepEqual(
		[
			shown(await run('2026-03-1', 'REGULAR'), 'e1', 'PREVIOUS_WORKING'),
			shown(await run('2026-03-2', 'REGULAR'), 'e1', 'PREVIOUS_WORKING')
		],
		[1901, 1901]
	);
});

test('contract validations read the employment’s other terms and the person’s earlier contracts', async () => {
	reset();
	tables.set('rule_set', [
		validation('ONE_PROBATION', {
			site: 'contract',
			kind: 'refuse',
			when: 'has(term.facts.probation) && term.facts.probation && (employment.terms.exists(t, has(t.facts.probation) && t.facts.probation) || person.contracts.exists(c, has(c.facts.probation) && c.facts.probation))',
			message: 'One probation per employee.'
		}),
		validation('OPEN_ENDED_RIGHT', {
			site: 'contract',
			kind: 'refuse',
			when: 'term.employment_type == "FIXED_TERM" && size(person.contracts.filter(c, c.contract_type == "FIXED_TERM")) >= 2',
			message: 'Two fixed terms already: the next contract is open-ended.'
		})
	]);
	const term = (from: string, extra: Row = {}) => ({
		base_salary: { value: 3000, currency: 'SGD' },
		effective_range: { from, to: null },
		allowances: [],
		...extra
	});
	const earlier = (id: string, from: string, to: string, extra: Row) => ({
		id,
		company_id: COMPANY,
		employee_id: 'e3',
		approval_id: null,
		effective_range: { from, to },
		facts: { contract_terms: [{ ...term(from, extra), effective_range: { from, to } }] }
	});
	tables.set('employment_contract', [
		earlier('k-a', '2024-01-01', '2024-12-31', {
			employment_type: 'FIXED_TERM',
			facts: { probation: true }
		}),
		earlier('k-b', '2025-01-01', '2025-12-31', { employment_type: 'FIXED_TERM', facts: {} })
	]);
	const admit = (terms: Row[]) =>
		Effect.runPromise(
			Effect.result(
				admitContractTerms({
					contract: {
						id: 'k-new',
						company_id: COMPANY,
						employee_id: 'e3',
						effective_range: { from: '2026-03-01', to: null },
						facts: { contract_terms: terms }
					},
					before: null
				}).pipe(Effect.provideService(Reads, reads))
			)
		);
	const message = async (terms: Row[]) => {
		const outcome = await admit(terms);
		return outcome._tag === 'Failure' ? outcome.failure.message : null;
	};
	assert.equal(
		await message([term('2026-03-01', { employment_type: 'FIXED_TERM', facts: {} })]),
		'Two fixed terms already: the next contract is open-ended.'
	);
	assert.equal(
		await message([
			term('2026-03-01', { employment_type: 'PERMANENT', facts: { probation: true } })
		]),
		'One probation per employee.'
	);
	assert.equal(
		await message([term('2026-03-01', { employment_type: 'PERMANENT', facts: {} })]),
		null
	);
});

test('hours.months[] and hours.month split worked and overtime hours by day type, holidays under HOLIDAY', async () => {
	reset();
	tables.get('holiday')!.push({
		id: 'h1',
		company_id: COMPANY,
		date: '2026-02-04',
		name: 'Holiday',
		kind: 'PUBLIC_HOLIDAY',
		published_at: '2026-01-01T00:00:00.000Z'
	});
	const day = (date: string, overtime: number) =>
		tables.get('roster_entry')!.push({
			id: `r-${date}`,
			employment_id: 'k-e1',
			work_date: date,
			approval_id: null,
			payslip_id: 'paid',
			approved_overtime_hours: overtime,
			worked_intervals: [{ start: `${date}T01:00:00.000Z`, end: `${date}T09:00:00.000Z` }]
		});
	// February: a Tuesday (2 h OT), the Wednesday holiday (1 h), a Saturday rest day (3 h).
	day('2026-02-03', 2);
	day('2026-02-04', 1);
	day('2026-02-07', 3);
	shows(
		'FEB_REST',
		'first(hours.months.filter(m, m.month == "2026-02")).day_type.REST.overtime_hours * 100.0 + first(hours.months.filter(m, m.month == "2026-02")).day_type.HOLIDAY.overtime_hours * 10.0 + first(hours.months.filter(m, m.month == "2026-02")).day_type.WORK.worked_hours / 8.0',
		'1.0',
		// Only Kavriel has February days.
		'terms.base_salary == 6500.0'
	);
	// the two working days' 8 clocked hours less each one's planned hour of break: 14 / 8
	assert.equal(shown(await run('2026-03', 'REGULAR'), 'e1', 'FEB_REST'), 300 + 10 + 1.75);
});

test('a leave row’s pay_fraction reads the days taken before it for the same event, and the average earnings', async () => {
	reset();
	const version = versionOn('2026-03');
	for (const [id, code] of [
		['lc-out', 'ACCIDENT_OUTPATIENT'],
		['lc-hosp', 'ACCIDENT_HOSPITAL']
	])
		tables.get('leave_catalog')!.push({
			id,
			settings_id: version,
			code,
			name: code,
			// Full pay for the first 3 days of the accident in this class, half after.
			pay_fraction: 'leave.taken_before >= 3.0 ? 0.5 : 1.0'
		});
	const leave = (
		id: string,
		catalogId: string,
		from: string,
		to: string,
		days: number,
		paid = false
	) =>
		entry(
			'leave_catalog_entry',
			id,
			'e1',
			catalogId,
			from,
			{ days, from, to, facts: { event_id: 'acc-1' }, ...(paid ? { payslip_id: 'paid' } : {}) },
			'TIME_OFF'
		);
	leave('o1', 'lc-out', '2026-02-10', '2026-02-12', 3, true);
	leave('h1', 'lc-hosp', '2026-02-16', '2026-02-17', 2, true);
	leave('o2', 'lc-out', '2026-03-03', '2026-03-04', 2);
	const february = await run('2026-02', 'REGULAR');
	shows(
		'TAKEN_BEFORE',
		'sum(leave.rows.filter(l, l.code == "ACCIDENT_OUTPATIENT").map(l, l.taken_before * 100.0 + l.taken_before_by_class.ACCIDENT_HOSPITAL * 10.0 + l.pay_fraction))',
		'1.0',
		'size(leave.rows) > 0'
	);
	shows('AVERAGE', 'earned.average.gross', '1.0', 'size(leave.rows) > 0');
	const march = await run('2026-03', 'REGULAR');
	assert.equal(shown(march, 'e1', 'TAKEN_BEFORE'), 300 + 20 + 0.5);
	// One earlier month with a slip: its gross is the average.
	assert.equal(shown(march, 'e1', 'AVERAGE'), slip(february, 'e1').gross);
});

test('person.contracts[] lists each earlier contract’s terms, so a first-term probation is seen', async () => {
	reset();
	tables.set('rule_set', [
		validation('ONE_PROBATION', {
			site: 'contract',
			kind: 'refuse',
			when: 'has(term.facts.probation) && term.facts.probation && person.contracts.exists(c, c.terms.exists(t, has(t.facts.probation) && t.facts.probation && t.from == "2024-01-01" && t.contract_type == "PERMANENT"))',
			message: 'One probation per employee.'
		})
	]);
	const term = (from: string, to: string | null, facts: Row) => ({
		base_salary: { value: 3000, currency: 'SGD' },
		employment_type: 'PERMANENT',
		effective_range: { from, to },
		allowances: [],
		facts
	});
	tables.set('employment_contract', [
		{
			id: 'k-a',
			company_id: COMPANY,
			employee_id: 'e3',
			approval_id: null,
			effective_range: { from: '2024-01-01', to: '2025-06-30' },
			// Probation in the first term only; the last term carries none.
			facts: {
				contract_terms: [
					term('2024-01-01', '2024-03-31', { probation: true }),
					term('2024-04-01', '2025-06-30', {})
				]
			}
		}
	]);
	const outcome = await Effect.runPromise(
		Effect.result(
			admitContractTerms({
				contract: {
					id: 'k-new',
					company_id: COMPANY,
					employee_id: 'e3',
					effective_range: { from: '2026-03-01', to: null },
					facts: { contract_terms: [term('2026-03-01', null, { probation: true })] }
				},
				before: null
			}).pipe(Effect.provideService(Reads, reads))
		)
	);
	assert.ok(
		outcome._tag === 'Failure' && outcome.failure.message === 'One probation per employee.'
	);
});

/** An ad hoc class of every version, flagged to raise itself on the exit its eligibility names. */
const exitPay = (extra: Row = {}) => {
	for (const settings of tables.get('jurisdiction_settings')!)
		tables.get('adhoc_catalog')!.push({
			id: `x-exit-${String(settings.id)}`,
			settings_id: settings.id,
			code: 'EXIT_PAY',
			name: 'Exit pay',
			destination: 'PAY',
			direction: 'ADD',
			counts_toward: [],
			eligibility: 'employment.exit_ground == "RETRENCHMENT"',
			bands: [{ when: '', amount: 'max(entry.amount, 1000.0)' }],
			raise_on_exit: true,
			amount_required: false,
			...extra
		});
};
const adjusted = (plan: Plan, person: string) =>
	(slip(plan, person)?.adjustments ?? []).map((row) => [
		row.family,
		row.component_code,
		row.amount
	]);
const paidAll = () => {
	for (const row of tables.get('payslip')!) row.status = 'PAID';
};

test('a final slip raises the exit pay its classes flag, once per exit; an entry HR made wins', async () => {
	reset();
	exitPay();
	const k1 = tables.get('employment_contract')!.find((row) => row.id === 'k-e1')!;
	Object.assign(k1, {
		effective_range: { from: '2019-01-01', to: '2026-03-15' },
		exit_ground: 'RETRENCHMENT',
		exit_facts: {}
	});
	const march = await run('2026-03', 'REGULAR');
	assert.deepEqual(adjusted(march, 'e1'), [['EXIT', 'EXIT_PAY', 1000]]);
	// another ground the class does not name raises nothing
	tables.get('payslip')!.length = 0;
	tables.get('payroll_run')!.length = 0;
	k1.exit_ground = 'RESIGNATION';
	assert.deepEqual(adjusted(await run('2026-03', 'REGULAR'), 'e1'), []);
	// HR's own entry of the class is paid instead, at its amount
	tables.get('payslip')!.length = 0;
	tables.get('payroll_run')!.length = 0;
	k1.exit_ground = 'RETRENCHMENT';
	tables.get('adhoc_catalog_entry')!.push({
		id: 'x1',
		catalog_id: `x-exit-${versionOn('2026-03')}`,
		employment_id: 'k-e1',
		occurred_on: '2026-03-15',
		amount: 1500,
		approval_id: null,
		payslip_id: null
	});
	const entered = await run('2026-03', 'REGULAR');
	assert.deepEqual(adjusted(entered, 'e1'), [['ADHOC', 'EXIT_PAY', 1500]]);
});

test('an exit undone after its final slip paid: the next run takes back the exit pay and pays the reopened days', async () => {
	reset();
	exitPay();
	const k1 = tables.get('employment_contract')!.find((row) => row.id === 'k-e1')!;
	Object.assign(k1, {
		effective_range: { from: '2019-01-01', to: '2026-03-15' },
		exit_ground: 'RETRENCHMENT',
		exit_facts: {}
	});
	const march = await run('2026-03', 'REGULAR');
	const basic = slip(march, 'e1').base.find((row) => row.component_code === 'BASIC')!.amount;
	assert.ok(basic < 6500);
	paidAll();
	// the resignation withdrawn: the contract reopens
	Object.assign(k1, {
		effective_range: { from: '2019-01-01', to: null },
		exit_ground: null,
		exit_facts: null
	});
	const april = await run('2026-04', 'REGULAR');
	assert.deepEqual(adjusted(april, 'e1'), [
		['EXIT', 'EXIT_PAY', -1000],
		['CORRECTION', 'BASIC', 6500 - basic]
	]);
	assert.equal(slip(april, 'e1').base.find((row) => row.component_code === 'BASIC')!.amount, 6500);
	// corrected once: May carries nothing more
	paidAll();
	assert.deepEqual(adjusted(await run('2026-05', 'REGULAR'), 'e1'), []);
});

test('an exit moved earlier after its final slip paid: the leaver’s next slip recovers the overpaid days', async () => {
	reset();
	const k1 = tables.get('employment_contract')!.find((row) => row.id === 'k-e1')!;
	Object.assign(k1, {
		effective_range: { from: '2019-01-01', to: '2026-03-31' },
		exit_ground: 'RESIGNATION',
		exit_facts: {}
	});
	await run('2026-03', 'REGULAR');
	paidAll();
	k1.effective_range = { from: '2019-01-01', to: '2026-03-15' };
	const april = await run('2026-04', 'REGULAR');
	// 16 of March's 31 days at the record's calendar divisor (6,500 × 16 / 31): a leaver is paid nothing to recover
	// it from, so the first run after it flags it instead of a negative slip
	assert.equal(slip(april, 'e1'), undefined);
	assert.ok(
		april.warnings.some((row) => /Kavriel: .*overpaid 3354.84 after the exit moved/.test(row))
	);
	paidAll();
	assert.ok(!(await run('2026-05', 'REGULAR')).warnings.some((row) => /overpaid/.test(row)));
});

test('an entry that prices to nothing is flagged on the run, never silent', async () => {
	reset();
	tables.get('adhoc_catalog')!.push({
		id: 'zero',
		settings_id: versionOn('2026-03'),
		code: 'ZERO',
		name: 'Zero',
		destination: 'PAY',
		direction: 'ADD',
		counts_toward: [],
		amount_required: false,
		bands: [{ when: '', amount: 'entry.amount' }]
	});
	tables.get('adhoc_catalog_entry')!.push({
		id: 'z1',
		catalog_id: 'zero',
		employment_id: 'k-e1',
		occurred_on: '2026-03-10',
		amount: 0,
		approval_id: null,
		payslip_id: null
	});
	const plan = await run('2026-03', 'REGULAR');
	assert.ok(plan.warnings.some((row) => /Zero 2026-03-10 prices to nothing/.test(row)));
});

test('a claim limit meters its window: BLOCK pays up to it, ALLOW pays all, and either flags the excess', async () => {
	reset();
	const claim = (on_exceed: string, window?: string) => {
		tables.get('claim_catalog')!.push({
			id: `cl-${on_exceed}`,
			settings_id: versionOn('2026-03'),
			code: `CL_${on_exceed}`,
			name: `Claim ${on_exceed}`,
			destination: 'NET',
			direction: 'ADD',
			counts_toward: [],
			bands: [
				{
					when: '',
					amount: 'entry.amount',
					limit: { on_exceed, amount: '100.0', ...(window == null ? {} : { window }) }
				}
			]
		});
	};
	claim('BLOCK', 'PERIOD');
	claim('ALLOW');
	const entry = (id: string, catalog_id: string, occurred_on: string, amount: number) =>
		tables.get('claim_catalog_entry')!.push({
			id,
			catalog_id,
			employment_id: 'k-e1',
			occurred_on,
			amount,
			approval_id: null,
			payslip_id: null
		});
	// two claims of 70 in one period against a 100 limit for the period; one claim of 150 against 100 a claim
	entry('b1', 'cl-BLOCK', '2026-03-02', 70);
	entry('b2', 'cl-BLOCK', '2026-03-09', 70);
	entry('a1', 'cl-ALLOW', '2026-03-03', 150);
	const plan = await run('2026-03', 'REGULAR');
	assert.deepEqual(
		slip(plan, 'e1')
			.adjustments.filter((row) => row.family === 'CLAIM')
			.map((row) => [row.source_id, row.amount]),
		[
			['b1', 70],
			['b2', 30],
			['a1', 150]
		]
	);
	const flagged = plan.warnings.filter((row) => /exceeds its limit/.test(row));
	assert.equal(flagged.length, 2);
	assert.ok(
		flagged.some((row) => /Claim BLOCK 2026-03-09 exceeds its limit by 40; paid up to it/.test(row))
	);
	assert.ok(
		flagged.some((row) => /Claim ALLOW 2026-03-03 exceeds its limit by 50; paid in full/.test(row))
	);
});

test('a run for an earlier period refuses while a later period has a run: the later year-to-date would go stale', async () => {
	reset();
	await run('2026-04', 'REGULAR');
	assert.match(
		await refused('2026-03', 'REGULAR'),
		/2026-04 already has a run: delete the runs after 2026-03, latest first, and rebuild them after it/
	);
});

test('a statutory line names the base it charged on: the assessment, not only the wage parts', async () => {
	reset();
	tables.get('statutory_contribution_catalog')!.push({
		id: 'on-contract',
		settings_id: versionOn('2026-03'),
		code: 'ON_CONTRACT',
		configuration: {
			assess_without_wage: true,
			// charged on the contract wage, whatever the month's lines paid toward it
			assessment: 'terms.base_salary',
			rules: [{ when: 'true', employer: 'base.assessed * 0.01' }]
		}
	});
	const plan = await run('2026-03', 'REGULAR');
	const charged = line(plan, 'e3', 'ON_CONTRACT')!;
	assert.equal(charged.base_amount, 0);
	assert.equal(charged.charged_base, 4800);
	assert.equal(charged.employer_amount, 48);
});

test('an exit encashment is judged without the exit’s own unpaid encashments, which a moved exit withdraws in the same act', async () => {
	reset();
	const annual = catalog('leave_catalog', 'ANNUAL_LEAVE', '2026-03');
	const ctx = {
		existing: [],
		db: {
			read: (collection: never, query: never) => Effect.runPromise(reads.read(collection, query))
		},
		refuse: (message: string): never => {
			throw new Error(message);
		}
	};
	// the exit as it stood encashed the whole balance; it is still unpaid
	tables.get('leave_catalog_entry')!.push({
		id: 'old-exit',
		catalog_id: annual,
		employment_id: 'k-e1',
		occurred_on: '2026-03-20',
		activity: 'ENCASHMENT',
		days: 14,
		reference: 'exit:k-e1:ANNUAL_LEAVE:2026-03-20/RESIGNATION',
		approval_id: null,
		payslip_id: null
	});
	const encash = (reference: string) =>
		transformEntries(
			'leave_catalog_entry',
			[
				{
					catalog_id: annual,
					employment_id: 'k-e1',
					occurred_on: '2026-03-31',
					activity: 'ENCASHMENT',
					days: 10,
					reference
				}
			],
			ctx
		);
	await encash('exit:k-e1:ANNUAL_LEAVE:2026-03-31/RESIGNATION');
	await assert.rejects(encash('manual'), /exceeds the available/);
});

test('the balances an employee is offered leave out the classes their eligibility excludes, through the real leave state', async () => {
	reset();
	// a fixed term's planned end is no departure: the leaving-year class is not offered
	tables.get('employment_contract')!.find((row) => row.id === 'k-e1')!.effective_range = {
		from: '2019-01-01',
		to: '2030-12-31'
	};
	const state = await Effect.runPromise(
		leaveState('k-e1', '2026-03-15').pipe(Effect.provideService(Reads, reads))
	);
	const codes = leaveBalances({ ...state, offeredOnly: true }).map((row) => row.code);
	assert.ok(codes.includes('ANNUAL_LEAVE'));
	assert.ok(!codes.includes('ANNUAL_LEAVE_ON_EXIT'), codes.join(','));
	assert.ok(!codes.includes('ANNUAL_LEAVE_PART_TIME'), codes.join(','));
});

/**
 * Every slip of the plans for one person summed: gross, each base line by code (a correction of a paid period's line
 * counted with it), each scheme's two shares.
 */
const settled = (plans: readonly Plan[], person: string) => {
	const cents = (value: number) => Math.round(value * 100) / 100;
	const out = { gross: 0, base: {} as Row, statutory: {} as Row };
	for (const plan of plans)
		for (const held of plan.payslips.filter((row) => row.employment_id === `k-${person}`)) {
			out.gross = cents(out.gross + held.gross);
			for (const line of [
				...held.base,
				...held.adjustments.filter((row) => row.family === 'CORRECTION')
			])
				out.base[line.component_code] = cents(
					Number(out.base[line.component_code] ?? 0) + line.amount
				);
			for (const line of held.statutory) {
				const [ee, er] = (out.statutory[line.scheme_code] as number[] | undefined) ?? [0, 0];
				out.statutory[line.scheme_code] = [
					cents(ee + line.employee_amount),
					cents(er + line.employer_amount)
				];
			}
		}
	return out;
};
/** The fixture entity on one frequency, switching on the days listed. */
const paying = (pay_frequency: string, changes: Row[] = []) => {
	reset();
	Object.assign(tables.get('entity')![0]!, { pay_frequency, pay_frequency_changes: changes });
};
const runAll = async (periods: readonly string[]) => {
	const plans: Plan[] = [];
	for (const period of periods) plans.push(await run(period, 'REGULAR'));
	return plans;
};
const sameAs = async (switched: readonly Plan[], periods: readonly string[], label: string) => {
	paying('MONTHLY');
	const monthly = await runAll(periods);
	for (const person of ['e1', 'e2', 'e3'])
		assert.deepEqual(settled(switched, person), settled(monthly, person), `${label} ${person}`);
};

test('semi-monthly to monthly mid-month: the first half and the monthly remainder settle exactly one month', async () => {
	paying('SEMI_MONTHLY', [{ from: '2026-03-16', frequency: 'MONTHLY' }]);
	const halves = await runAll(['2026-03-1', '2026-03']);
	// the monthly run covers what the semi-monthly half left: the 16th to the 31st
	assert.deepEqual(
		[halves[1]!.run.salary_from, halves[1]!.run.salary_to],
		['2026-03-16', '2026-03-31']
	);
	// the second half no longer exists: the entity pays monthly from the 16th
	await assert.rejects(run('2026-03-2', 'REGULAR'), /2026-03-2/);
	await sameAs(halves, ['2026-03'], 'March');
});

test('monthly to semi-monthly at a month start and mid-month each equal the monthly months', async () => {
	paying('MONTHLY', [{ from: '2026-04-01', frequency: 'SEMI_MONTHLY' }]);
	await sameAs(
		await runAll(['2026-03', '2026-04-1', '2026-04-2']),
		['2026-03', '2026-04'],
		'April start'
	);
	paying('MONTHLY', [{ from: '2026-03-16', frequency: 'SEMI_MONTHLY' }]);
	const switched = await runAll(['2026-03', '2026-03-2']);
	assert.deepEqual(
		[switched[0]!.run.salary_from, switched[0]!.run.salary_to],
		['2026-03-01', '2026-03-15']
	);
	await sameAs(switched, ['2026-03'], 'March mid-month');
});

test('switching inside a tax year: monthly, a semi-monthly month and back again equal the monthly year to date', async () => {
	paying('MONTHLY', [
		{ from: '2026-02-01', frequency: 'SEMI_MONTHLY' },
		{ from: '2026-03-16', frequency: 'MONTHLY' }
	]);
	const year = await runAll([
		'2026-01',
		'2026-02-1',
		'2026-02-2',
		'2026-03-1',
		'2026-03',
		'2026-04'
	]);
	await sameAs(year, ['2026-01', '2026-02', '2026-03', '2026-04'], 'January–April');
});

test('a period over days another frequency pays, or one already paid, is refused', async () => {
	paying('MONTHLY', [{ from: '2026-03-16', frequency: 'SEMI_MONTHLY' }]);
	await assert.rejects(run('2026-03-1', 'REGULAR'), /2026-03-1/);
	await run('2026-03', 'REGULAR');
	await run('2026-03-2', 'REGULAR');
	await assert.rejects(run('2026-03-2', 'REGULAR'), /already has a salary run/);
});

test('a pay frequency switch is history: never behind a paid period, never a rewrite of the frequency a run paid at', () => {
	const at = (pay_frequency: string, changes: Row[] = []) =>
		({ pay_frequency, pay_frequency_changes: changes }) as never;
	const switchOn = (from: string, frequency = 'SEMI_MONTHLY') => [{ from, frequency }];
	// no run yet: anything goes
	assert.equal(payScheduleRefusal(at('MONTHLY'), at('SEMI_MONTHLY'), null), undefined);
	// a run paid through 31 March: the frequency it paid at stays, a switch starts after it
	assert.match(
		String(payScheduleRefusal(at('MONTHLY'), at('SEMI_MONTHLY'), '2026-03-31')),
		/record a switch/
	);
	assert.match(
		String(payScheduleRefusal(at('MONTHLY'), at('MONTHLY', switchOn('2026-03-16')), '2026-03-31')),
		/2026-03-31/
	);
	assert.equal(
		payScheduleRefusal(at('MONTHLY'), at('MONTHLY', switchOn('2026-04-01')), '2026-03-31'),
		undefined
	);
	// a switch already behind the paid day cannot be withdrawn either
	assert.match(
		String(payScheduleRefusal(at('MONTHLY', switchOn('2026-03-16')), at('MONTHLY'), '2026-03-31')),
		/2026-03-31/
	);
	// one switch a day, to another frequency, among those that cut the month
	assert.match(
		String(
			payScheduleRefusal(
				at('MONTHLY'),
				at('MONTHLY', [...switchOn('2026-05-01'), ...switchOn('2026-05-01', 'MONTHLY')]),
				null
			)
		),
		/one switch/
	);
	assert.match(
		String(
			payScheduleRefusal(at('MONTHLY'), at('MONTHLY', switchOn('2026-05-01', 'MONTHLY')), null)
		),
		/already pays/
	);
	assert.match(
		String(
			payScheduleRefusal(at('MONTHLY'), at('MONTHLY', switchOn('2026-05-01', 'WEEKLY')), null)
		),
		/WEEKLY.*straddle/
	);
	// nor away from one
	assert.match(
		String(payScheduleRefusal(at('WEEKLY'), at('WEEKLY', switchOn('2026-05-01', 'MONTHLY')), null)),
		/from WEEKLY.*straddle/
	);
});

test('an exit inside a switched month, undone or moved after its slip paid, settles as the one-frequency months do', async () => {
	const exiting = (to: string) =>
		Object.assign(
			tables.get('employment_contract')!.find((row) => row.id === 'k-e1')!,
			{
				effective_range: { from: '2019-01-01', to },
				exit_ground: 'RETRENCHMENT',
				exit_facts: {}
			}
		);
	const reopen = () =>
		Object.assign(
			tables.get('employment_contract')!.find((row) => row.id === 'k-e1')!,
			{
				effective_range: { from: '2019-01-01', to: null },
				exit_ground: null,
				exit_facts: null
			}
		);
	const story = async (
		periods: readonly (readonly string[])[],
		change: () => void,
		switched: boolean
	) => {
		paying('SEMI_MONTHLY', switched ? [{ from: '2026-03-16', frequency: 'MONTHLY' }] : []);
		exitPay();
		exiting('2026-03-10');
		const plans: Plan[] = [];
		for (const [i, group] of periods.entries()) {
			if (i === 1) change();
			for (const period of group) plans.push(await run(period, 'REGULAR'));
			paidAll();
		}
		return settled(plans, 'e1');
	};
	// The one-frequency result: one monthly March run on the facts as they now stand.
	const monthly = async (change: () => void) => {
		paying('MONTHLY');
		exitPay();
		exiting('2026-03-10');
		change();
		return settled([await run('2026-03', 'REGULAR')], 'e1');
	};
	// undone: the first half paid ten days and the exit pay; the rest of the month pays as if it never was
	assert.deepEqual(
		await story([['2026-03-1'], ['2026-03']], reopen, true),
		await monthly(reopen),
		'exit undone'
	);
	// moved later, to the 25th: the days 11–25 are owed
	const moved = () => exiting('2026-03-25');
	assert.deepEqual(
		await story([['2026-03-1'], ['2026-03']], moved, true),
		await monthly(moved),
		'exit moved'
	);
	// After the month settled to date, the exit moved back to the 20th recovers the days 21–31 once, through the
	// month-to-date slip, at what a monthly March recovers.
	const late = async (switched: boolean) => {
		paying(
			switched ? 'SEMI_MONTHLY' : 'MONTHLY',
			switched ? [{ from: '2026-03-16', frequency: 'MONTHLY' }] : []
		);
		for (const period of switched ? ['2026-03-1', '2026-03'] : ['2026-03'])
			await run(period, 'REGULAR');
		paidAll();
		exiting('2026-03-20');
		const april = await run('2026-04', 'REGULAR');
		paidAll();
		const may = await run('2026-05', 'REGULAR');
		return [...april.warnings, ...may.warnings].filter((row) => /^Kavriel: .*overpaid/.test(row));
	};
	const once = await late(false);
	assert.equal(once.length, 1);
	assert.deepEqual(await late(true), once);
});

test('period.switched and the calendar month’s bounds reach the payslip and an entry’s bands', async () => {
	paying('SEMI_MONTHLY', [{ from: '2026-03-16', frequency: 'MONTHLY' }]);
	shows(
		'SWITCHED',
		'period.switched && period.month_from == "2026-03-01" && period.month_to == "2026-03-31" ? 1.0 : 2.0'
	);
	tables.get('adhoc_catalog')!.push({
		id: 'sw',
		settings_id: versionOn('2026-03'),
		code: 'SWITCH_AWARE',
		name: 'Switch aware',
		destination: 'PAY',
		direction: 'ADD',
		counts_toward: [],
		bands: [{ when: 'true', amount: 'period.switched ? 100.0 : 50.0' }]
	});
	entry('adhoc_catalog_entry', 'sw-1', 'e1', 'sw', '2026-03-05', { amount: 1 });
	const half = await run('2026-03-1', 'REGULAR');
	assert.equal(shown(half, 'e1', 'SWITCHED'), 1);
	assert.deepEqual(
		slip(half, 'e1').adjustments.map((row) => [row.component_code, row.amount]),
		[['SWITCH_AWARE', 100]]
	);
	// a month paid at one frequency is not switched
	await run('2026-03', 'REGULAR');
	assert.equal(shown(await run('2026-04', 'REGULAR'), 'e1', 'SWITCHED'), 2);
});

test('a leave class reads the governing version’s PAYROLL rule tables as `rules`: a regional entitlement', async () => {
	reset();
	tables.get('entity')![0]!.region = 'NORTH';
	const version = versionOn('2026-03');
	tables.set('rule_set', [
		...(tables.get('rule_set') ?? []),
		{
			id: 'rs-regions',
			settings_id: version,
			family: 'PAYROLL',
			code: 'regions',
			rules: { by_region: { NORTH: { local_leave_days: 3 } } },
			approval_id: null
		}
	]);
	tables.get('leave_catalog')!.push({
		id: 'lc-local',
		settings_id: version,
		code: 'LOCAL_LEAVE',
		name: 'Local leave',
		unit: 'DAY',
		approval_id: null,
		entitlement: {
			window: 'CALENDAR_YEAR',
			days: 'double(rules.regions.by_region[company.region].local_leave_days)'
		}
	});
	const state = await Effect.runPromise(
		leaveState('k-e1', '2026-03-15').pipe(Effect.provideService(Reads, reads))
	);
	assert.equal(
		leaveBalances({ ...state, classes: state.classes.filter((cls) => cls.id === 'lc-local') }).find(
			(row) => row.code === 'LOCAL_LEAVE'
		)?.entitlement,
		3
	);
});
