/** The shared behaviour pipeline of the row taps and the daily tick, over the canonical SG rules and fixture rows. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { Act } from '@norbital-ai/bolt';
import {
	describeTrigger,
	leaveBalancesOn,
	leaveTaken,
	runBehaviours,
	runTotals,
	versionLookup
} from '../src/lib/payroll_engine/behaviour_runner.ts';
import { beforeOf, type HostRead } from '../src/lib/payroll_engine/foundation.ts';

type Row = Record<string, unknown>;
const [settings] = JSON.parse(
	readFileSync(
		resolve(process.cwd(), 'seed/jurisdiction/SG/version_2/jurisdiction_settings.json'),
		'utf8'
	)
) as Row[];
const COMPANY = 'c1';
const contract = (id: string, from: string, to: string | null = null): Row => ({
	id,
	company_id: COMPANY,
	employee_id: `p-${id}`,
	approval_id: null,
	effective_range: { from, to },
	facts: {}
});

const tables = new Map<string, Row[]>([
	['jurisdiction_settings', [{ ...settings, approval_id: null }]],
	['entity', [{ id: COMPANY, name: 'Omni', settings_code: 'SG', facts: {}, approval_id: null }]],
	[
		'employment_contract',
		[
			contract('k1', '2020-03-16'),
			contract('k2', '2024-01-01'),
			contract('k3', '2021-01-01', '2025-12-31')
		]
	],
	['employment_profile', [{ id: 'p-k1', nationality: 'SG', facts: {} }]],
	[
		'rule_set',
		[
			{
				settings_id: settings!.id,
				family: 'TASKS',
				code: 'SERVICE_ANNIVERSARY',
				name: 'Service anniversary',
				rules: {
					description: 'A record-driven anniversary duty.',
					authority: 'Test',
					trigger: { collection: 'calendar', event: 'daily' },
					when: 'today.substring(5) == contract.effective_range.from.substring(5)',
					applies_when: 'company.headcount == 2.0 && headcount == 2.0',
					due: 'add_days(today, 7)'
				}
			}
		]
	],
	['holiday', []],
	['regulatory_task', []],
	['claim_catalog', [{ id: 'cc1', code: 'MEDICAL', name: 'Medical' }]]
]);

const matches = (row: Row, where: Row): boolean =>
	Object.entries(where).every(([key, spec]) => {
		const value = row[key];
		const ops = spec as Row;
		return Object.entries(ops).every(([op, operand]) => {
			if (op === 'eq') return value === operand;
			if (op === 'in') return Array.isArray(operand) && operand.includes(value);
			if (op === 'isNull') return operand ? value == null : value != null;
			if (op === 'gte') return value != null && String(value) >= String(operand);
			if (op === 'lte') return value != null && String(value) <= String(operand);
			throw new Error(`fixture reader: unsupported operator ${op}`);
		});
	});
const read = (async (collection: string, query: { where?: Row; select?: Row }) => ({
	rows: (tables.get(collection) ?? [])
		.filter((row) => matches(row, query.where ?? {}))
		.map((row) =>
			query.select == null
				? row
				: Object.fromEntries(
						Object.keys({ id: true, ...query.select })
							.filter((key) => key in row)
							.map((key) => [key, row[key]])
					)
		)
})) as unknown as HostRead;

const written: { callable: string; data: Row }[] = [];
// An act takes one row or a list of them, as the host's does.
const act = (async (callable: string, input: Row | readonly Row[]) => {
	for (const data of Array.isArray(input) ? input : [input]) {
		written.push({ callable, data });
		tables.get('regulatory_task')!.push({ company_id: COMPANY, ...data });
	}
	return { kind: 'committed', output: undefined, records: [] };
}) as unknown as Act;

const tick = (day: string) =>
	Promise.all(
		tables
			.get('employment_contract')!
			.filter((row) => {
				const range = row.effective_range as { from: string; to: string | null };
				return range.from <= day && (range.to == null || range.to >= day);
			})
			.map((row) =>
				runBehaviours({
					collection: 'calendar',
					action: 'daily',
					row,
					day,
					subjects: [
						{
							company_id: COMPANY,
							employment_id: String(row.id),
							employee_id: String(row.employee_id)
						}
					],
					fields: async () => ({}),
					versionFor: versionLookup(read),
					read,
					act
				})
			)
	);

test('the daily tick raises a calendar task once a day for the employment it falls on', async () => {
	await tick('2026-03-16');
	assert.deepEqual(
		written.map(({ callable, data }) => [
			callable,
			data.code,
			data.subject_collection,
			data.due_on,
			data.occurrence_key
		]),
		[
			[
				'regulatory_task.create',
				'SERVICE_ANNIVERSARY',
				'calendar',
				'2026-03-23',
				'SERVICE_ANNIVERSARY:c1:k1:2026-03-16'
			]
		]
	);
	// The same day again raises nothing: the occurrence key holds the day.
	await tick('2026-03-16');
	assert.equal(written.length, 1);
	// Another day is another occurrence; this one is nobody's anniversary.
	await tick('2026-03-17');
	assert.equal(written.length, 1);
});

test('an entry trigger carries its class code and a paid payslip its paid day and its run’s pay days', async () => {
	assert.deepEqual(
		await describeTrigger('claim_catalog_entry', { id: 'e1', catalog_id: 'cc1' }, read),
		{
			id: 'e1',
			catalog_id: 'cc1',
			catalog_code: 'MEDICAL',
			catalog: { id: 'cc1', code: 'MEDICAL', name: 'Medical' }
		}
	);
	tables.set('payslip', [
		{
			id: 's1',
			payroll_run_id: 'r1',
			base: [{ component_code: 'BASIC' }],
			adjustments: [{ component_code: 'BONUS' }, { component_code: 'BASIC' }]
		}
	]);
	// A late payment reads its run's due day beside its paid day (an interest or fine owed to the worker).
	tables.set('payroll_run', [{ id: 'r1', pay_date: '2026-03-31', pay_due_date: '2026-03-31' }]);
	assert.deepEqual(
		await describeTrigger(
			'payslip',
			{ id: 's1', payroll_run_id: 'r1', paid_at: '2026-04-02T03:00:00.000Z' },
			read
		),
		{
			id: 's1',
			payroll_run_id: 'r1',
			paid_at: '2026-04-02T03:00:00.000Z',
			line_codes: ['BASIC', 'BONUS'],
			pay_date: '2026-03-31',
			pay_due_date: '2026-03-31',
			paid_on: '2026-04-02'
		}
	);
});

test('duty contexts name the coming published holidays: a task due a week before a named one', async () => {
	tables.get('rule_set')!.push({
		settings_id: settings!.id,
		family: 'TASKS',
		code: 'FESTIVE_ALLOWANCE',
		name: 'Festive allowance',
		rules: {
			description: 'Paid seven days before the named holiday.',
			authority: 'Test',
			trigger: { collection: 'calendar', event: 'daily' },
			when: 'today == "2026-02-02" && holidays_named.exists(h, h.name == "Idul Fitri")',
			due: 'add_days(first(holidays_named.filter(h, h.name == "Idul Fitri")).date, -7)'
		}
	});
	tables.set('holiday', [
		{
			company_id: COMPANY,
			date: '2026-01-01',
			name: 'New Year',
			kind: 'PUBLIC_HOLIDAY',
			published_at: '2025-12-01'
		},
		{
			company_id: COMPANY,
			date: '2026-03-20',
			name: 'Idul Fitri',
			kind: 'PUBLIC_HOLIDAY',
			published_at: '2025-12-01'
		},
		{
			company_id: COMPANY,
			date: '2027-03-10',
			name: 'Idul Fitri',
			kind: 'PUBLIC_HOLIDAY',
			published_at: '2025-12-01'
		}
	]);
	written.length = 0;
	await tick('2026-02-02');
	assert.deepEqual(
		written.filter(({ data }) => data.code === 'FESTIVE_ALLOWANCE').map(({ data }) => data.due_on),
		['2026-03-13', '2026-03-13']
	);
});

const task = (code: string, rules: Row): Row => ({
	settings_id: settings!.id,
	family: 'TASKS',
	code,
	name: code,
	rules: { description: code, authority: 'Test', ...rules }
});
const fire = (collection: string, action: string, row: Row, day: string, employment?: Row) =>
	runBehaviours({
		collection,
		action,
		row,
		day,
		subjects: [
			{
				company_id: COMPANY,
				employment_id: employment == null ? null : String(employment.id),
				employee_id: employment == null ? null : String(employment.employee_id)
			}
		],
		fields: async () => ({}),
		versionFor: versionLookup(read),
		read,
		act
	});
const raised = (code: string) =>
	written.filter(({ data }) => data.code === code).map(({ data }) => data.occurrence_key);

test('task contexts: dependants, separations, leave history and a repeat key per period', async () => {
	const k1 = tables.get('employment_contract')![0]!;
	Object.assign(tables.get('employment_contract')![2]!, {
		exit_ground: 'REDUNDANCY',
		exit_facts: {}
	});
	tables.set('leave_catalog', [{ id: 'lc-cc', code: 'CHILDCARE_LEAVE' }]);
	tables.set('leave_catalog_entry', [
		{
			id: 'cc-1',
			employment_id: 'k1',
			company_id: COMPANY,
			catalog_id: 'lc-cc',
			activity: 'TIME_OFF',
			approval_id: null,
			occurred_on: '2026-03-01',
			from: '2026-03-01',
			to: '2026-08-31',
			days: 130,
			facts: {}
		}
	]);
	tables.get('rule_set')!.push(
		// A dependant change: one notice per change of the children listed, not once per person.
		task('DEPENDANT_CHANGE', {
			trigger: { collection: 'employment_profile', event: 'updated' },
			when: 'size(employee.children) > 0',
			repeat_key: 'string(size(employee.children))',
			due: 'add_days(today, 5)'
		}),
		// A mass-layoff threshold over the entity's employer-initiated separations of the last 60 days.
		task('MASS_LAYOFF', {
			trigger: { collection: 'employment_contract', event: 'updated' },
			when: 'size(separations.filter(s, s.exit_ground == "REDUNDANCY" && s.exit_date >= add_days(today, -60))) >= 1',
			due: 'today'
		}),
		// An application repeated each month the childcare leave runs through.
		task('CHILDCARE_APPLICATION', {
			trigger: { collection: 'calendar', event: 'daily' },
			when: 'row.leave.exists(l, l.code == "CHILDCARE_LEAVE" && l.from <= today && l.to >= today)',
			repeat_key: 'period.key',
			due: 'month_end(today)'
		})
	);
	written.length = 0;
	const profile = (children: Row[]) => ({
		id: 'p-k1',
		approval_id: null,
		nationality: 'SG',
		children,
		facts: {}
	});
	const child = { child_birthdate: '2026-02-20', relationship: 'CHILD' };
	tables.set('employment_profile', [profile([child])]);
	await fire('employment_profile', 'updated', profile([child]), '2026-03-02', k1);
	await fire('employment_profile', 'updated', profile([child]), '2026-03-03', k1);
	tables.set('employment_profile', [profile([child, child])]);
	await fire('employment_profile', 'updated', profile([child, child]), '2026-03-09', k1);
	// The same child list on another day is the same occurrence; a second child is a new one.
	assert.deepEqual(raised('DEPENDANT_CHANGE'), [
		'DEPENDANT_CHANGE:c1:p-k1:1',
		'DEPENDANT_CHANGE:c1:p-k1:2'
	]);
	const k3 = tables.get('employment_contract')![2]!;
	await fire('employment_contract', 'updated', k3, '2026-01-20', k3);
	await fire('employment_contract', 'updated', k3, '2026-04-20', k3);
	// k3's redundancy on 31 December 2025 is inside 60 days of 20 January, not of 20 April.
	assert.deepEqual(raised('MASS_LAYOFF'), ['MASS_LAYOFF:c1:k3']);
	const daily = async (day: string) => {
		const leave = await leaveTaken(read, { company_id: { eq: COMPANY } }, '2024-01-01');
		await fire('calendar', 'daily', { ...k1, leave: leave.get('k1') ?? [] }, day, k1);
	};
	for (const day of ['2026-03-16', '2026-03-17', '2026-04-01', '2026-09-01']) await daily(day);
	assert.deepEqual(raised('CHILDCARE_APPLICATION'), [
		'CHILDCARE_APPLICATION:c1:k1:2026-03',
		'CHILDCARE_APPLICATION:c1:k1:2026-04'
	]);
	// A contract trigger row carries its employment's time off.
	const described = await describeTrigger('employment_contract', k1, read);
	assert.deepEqual(described.leave, [
		{
			id: 'cc-1',
			code: 'CHILDCARE_LEAVE',
			from: '2026-03-01',
			to: '2026-08-31',
			chain_from: '2026-03-01',
			days: 130,
			facts: {}
		}
	]);
});

test('a workplace case raises its tasks when opened and once when still open; a closed task raises its own', async () => {
	tables.get('rule_set')!.push(
		task('FWA_REPLY', {
			trigger: { collection: 'workplace_case', event: 'created' },
			when: 'row.kind == "FLEXIBLE_WORK_REQUEST"',
			due: 'add_months(row.opened_on, 2)'
		}),
		task('BREACH_NOTICE_OVERDUE', {
			trigger: { collection: 'workplace_case', event: 'daily' },
			when: 'row.kind == "DATA_BREACH" && row.closed_on == null && today >= add_days(row.opened_on, 3)',
			due: 'today'
		}),
		task('LATE_ANNUAL_SURCHARGE', {
			trigger: { collection: 'regulatory_task', event: 'updated' },
			when: 'row.state == "DONE" && row.done_on > row.due_on',
			due: 'row.done_on'
		})
	);
	written.length = 0;
	await fire(
		'workplace_case',
		'created',
		{ id: 'case-1', approval_id: null, kind: 'FLEXIBLE_WORK_REQUEST', opened_on: '2026-03-02' },
		'2026-03-02'
	);
	const breach = {
		id: 'case-2',
		approval_id: null,
		kind: 'DATA_BREACH',
		opened_on: '2026-03-02',
		closed_on: null
	};
	for (const day of ['2026-03-04', '2026-03-05', '2026-03-06'])
		await fire('workplace_case', 'daily', breach, day);
	await fire(
		'regulatory_task',
		'updated',
		{ id: 't-1', approval_id: null, state: 'DONE', due_on: '2026-01-31', done_on: '2026-02-10' },
		'2026-02-10'
	);
	assert.deepEqual(
		written.map(({ data }) => [data.code, data.due_on]),
		[
			['FWA_REPLY', '2026-05-02'],
			['BREACH_NOTICE_OVERDUE', '2026-03-05'],
			['LATE_ANNUAL_SURCHARGE', '2026-02-10']
		]
	);
});

test('task contexts II: worksite headcounts, a window-keyed duty, leave balances, chains and what a write changed', async () => {
	const [k1, k2, k3] = tables.get('employment_contract')!;
	const terms = (facts: Row) => ({
		contract_terms: [{ effective_range: { from: '2020-01-01', to: null }, facts }]
	});
	k1!.facts = terms({ worksite: 'NORTH' });
	k2!.facts = terms({ worksite: 'SOUTH' });
	k3!.facts = terms({ worksite: 'NORTH', fixed_term: true });
	tables.get('rule_set')!.push(
		// A worksite threshold over its own headcount and a fixed-term separation there.
		task('WORKSITE_NOTICE', {
			trigger: { collection: 'employment_contract', event: 'updated' },
			when: 'headcount_by_worksite.NORTH == 1.0 && separations.exists(s, s.worksite == "NORTH" && s.fixed_term)',
			due: 'today'
		}),
		// One duty per threshold crossing: keyed to the separation that crossed it, not to the row that fired.
		task('CROSSING_DUTY', {
			trigger: { collection: 'employment_contract', event: 'updated' },
			when: 'size(separations) >= 1',
			occurrence: 'first(separations).exit_date',
			due: 'today'
		}),
		// Raised only when the grant passed its attendance test.
		task('GRANT_DESIGNATION', {
			trigger: { collection: 'calendar', event: 'daily' },
			when: 'row.leave_balances.exists(b, b.code == "ATTENDED_GRANT" && b.entitlement >= 10.0)',
			due: 'add_days(today, 30)'
		}),
		// A term written for any day raises on the write.
		task('TERM_CHANGE', {
			trigger: { collection: 'employment_contract', event: 'updated' },
			when: 'size(row.terms_written) > 0',
			repeat_key: 'first(row.terms_written).effective_range.from',
			due: 'add_days(today, 7)'
		})
	);
	written.length = 0;
	await fire('employment_contract', 'updated', { ...k3, terms_written: [] }, '2026-01-20', k3);
	await fire('employment_contract', 'updated', { ...k2, terms_written: [] }, '2026-01-21', k2);
	// Keyed per row (no repeat_key), each row that meets the condition raises its own.
	assert.deepEqual(raised('WORKSITE_NOTICE'), ['WORKSITE_NOTICE:c1:k3', 'WORKSITE_NOTICE:c1:k2']);
	// Keyed to the crossing, k2's later edit meets the same window: no second duty.
	assert.deepEqual(raised('CROSSING_DUTY'), ['CROSSING_DUTY:c1:2025-12-31']);

	// A grant whose attendance test fails raises nothing; one that passes raises the designation.
	const grant = (days: string) =>
		tables.set('leave_catalog', [
			{ id: 'lc-cc', code: 'CHILDCARE_LEAVE' },
			{
				id: 'lc-ag',
				settings_id: settings!.id,
				code: 'ATTENDED_GRANT',
				name: 'Attended grant',
				entitlement: { window: 'CALENDAR_YEAR', days }
			}
		]);
	grant('attendance.window.scheduled > 0 ? 10.0 : 0.0');
	const balances = await leaveBalancesOn(read, 'k1', '2026-03-16');
	assert.ok(balances.some((row) => (row as Row).attendance != null));
	// A calendar row carries the employment's time off (`row.leave`), as the tick builds it.
	await fire('calendar', 'daily', { ...k1, leave: [], leave_balances: balances }, '2026-03-16', k1);
	grant('10.0');
	await fire(
		'calendar',
		'daily',
		{ ...k1, leave: [], leave_balances: await leaveBalancesOn(read, 'k1', '2026-03-17') },
		'2026-03-17',
		k1
	);
	assert.deepEqual(raised('GRANT_DESIGNATION'), ['GRANT_DESIGNATION:c1:k1:2026-03-17']);

	// An extension entered as a new row continues the leave it follows.
	tables.get('leave_catalog_entry')!.push({
		id: 'cc-2',
		employment_id: 'k1',
		company_id: COMPANY,
		catalog_id: 'lc-cc',
		activity: 'TIME_OFF',
		approval_id: null,
		occurred_on: '2026-09-01',
		from: '2026-09-01',
		to: '2026-10-31',
		days: 44,
		facts: {}
	});
	const leave = (await leaveTaken(read, { employment_id: { eq: 'k1' } })).get('k1')!;
	assert.deepEqual(
		leave.map((row) => [row.from, row.chain_from]),
		[
			['2026-03-01', '2026-03-01'],
			['2026-09-01', '2026-03-01']
		]
	);

	// What an update changed, as the transform records it, and the terms a contract write added.
	assert.deepEqual(
		beforeOf({ marital_status: 'SINGLE', name: 'A' }, { marital_status: 'MARRIED', name: 'A' }),
		{
			marital_status: 'SINGLE'
		}
	);
	const late = { effective_range: { from: '2025-07-01', to: null }, facts: { worksite: 'NORTH' } };
	const described = await describeTrigger(
		'employment_contract',
		{
			...k1,
			facts: { contract_terms: [...(k1!.facts as { contract_terms: Row[] }).contract_terms, late] },
			before: { facts: k1!.facts }
		},
		read
	);
	assert.deepEqual(described.terms_written, [late]);
	await fire('employment_contract', 'updated', described, '2026-02-01', k1);
	assert.deepEqual(raised('TERM_CHANGE'), ['TERM_CHANGE:c1:k1:2025-07-01']);
});

test('an obligation priced from entity facts and the months the headcount reached a threshold', async () => {
	tables.get('rule_set')!.push({
		settings_id: settings!.id,
		family: 'OBLIGATIONS',
		code: 'YEARLY_LEVY',
		name: 'Yearly levy',
		rules: {
			description: 'A levy per month the entity employed three or more.',
			authority: 'Test',
			schemes: [],
			due: 'add_days(period.to, 30)',
			amount:
				'double(size(headcount_months.filter(m, m.headcount >= 3.0))) * company.facts.levy_per_month'
		}
	});
	tables.get('entity')![0]!.facts = { levy_per_month: 100 };
	tables.set('obligation', []);
	written.length = 0;
	await runBehaviours({
		collection: 'payroll_run',
		action: 'created',
		row: { id: 'r-levy', company_id: COMPANY, period: '2026-01', approval_id: null, pins: [] },
		day: '2026-01-01',
		subjects: [{ company_id: COMPANY, employment_id: null, employee_id: null }],
		fields: async () => ({}),
		versionFor: versionLookup(read),
		read,
		act,
		run: { totals: { gross: 0, net: 0, employer_cost: 0, schemes: {} } }
	});
	// Three in force at each month end from February to December 2025; two at the end of January 2026.
	assert.deepEqual(
		written
			.filter(({ data }) => data.duty_code === 'YEARLY_LEVY')
			.map(({ data }) => data.amount_due),
		[1100]
	);
});

test('an obligation amount reads the run’s statutory totals: a unit premium on the insured amounts summed', async () => {
	const line = (base: number, charged: number, employer: number) => ({
		scheme_code: 'UNIT_FUND',
		base_amount: base,
		charged_base: charged,
		parts: { ordinary: base },
		employee_amount: 0,
		employer_amount: employer
	});
	const run = runTotals([
		{ gross: 30000, net: 30000, employer_cost: 30010, statutory: [line(30000, 30300, 10)] },
		{ gross: 45000, net: 45000, employer_cost: 45015, statutory: [line(45000, 45800, 15)] }
	]);
	assert.deepEqual(run.statutory, {
		UNIT_FUND: {
			base: 75000,
			charged_base: 76100,
			employee: 0,
			employer: 25,
			parts: { ordinary: 75000 }
		}
	});
	tables.get('rule_set')!.push({
		settings_id: settings!.id,
		family: 'OBLIGATIONS',
		code: 'UNIT_PREMIUM',
		name: 'Unit premium',
		rules: {
			description: 'The rate on the run’s insured amounts, not the sum of the per-slip shares.',
			authority: 'Test',
			schemes: ['UNIT_FUND'],
			due: 'add_days(period.to, 30)',
			amount: 'round(run.statutory.UNIT_FUND.charged_base * 0.000333, 0.01)'
		}
	});
	tables.set('obligation', []);
	written.length = 0;
	await runBehaviours({
		collection: 'payroll_run',
		action: 'created',
		row: { id: 'r-unit', company_id: COMPANY, period: '2026-01', approval_id: null, pins: [] },
		day: '2026-01-01',
		subjects: [{ company_id: COMPANY, employment_id: null, employee_id: null }],
		fields: async () => ({}),
		versionFor: versionLookup(read),
		read,
		act,
		run
	});
	assert.deepEqual(
		written
			.filter(({ data }) => data.duty_code === 'UNIT_PREMIUM')
			.map(({ data }) => data.amount_due),
		[25.34]
	);
	tables.get('rule_set')!.pop();
});

test('a leave-entry trigger sees the employment’s other leave rows and its own chain start', async () => {
	tables.set('leave_catalog', [{ id: 'lc-cc', code: 'CHILDCARE_LEAVE' }]);
	tables.set('leave_catalog_entry', [
		{
			id: 'first',
			employment_id: 'k1',
			catalog_id: 'lc-cc',
			activity: 'TIME_OFF',
			approval_id: null,
			occurred_on: '2026-03-01',
			from: '2026-03-01',
			to: '2026-08-31',
			days: 130,
			facts: {}
		},
		{
			id: 'next',
			employment_id: 'k1',
			catalog_id: 'lc-cc',
			activity: 'TIME_OFF',
			approval_id: null,
			occurred_on: '2026-09-01',
			from: '2026-09-01',
			to: '2026-10-31',
			days: 44,
			facts: {}
		}
	]);
	const described = await describeTrigger(
		'leave_catalog_entry',
		tables.get('leave_catalog_entry')![1]!,
		read
	);
	// A continuation: its chain starts with the first row, so a "first application" task can skip it.
	assert.equal(described.chain_from, '2026-03-01');
	assert.deepEqual(
		(described.leave as Row[]).map((row) => [row.id, row.chain_from]),
		[
			['first', '2026-03-01'],
			['next', '2026-03-01']
		]
	);
});

test('task contexts III: permanent headcount, separations by exit day, count_within and suspension triggers', async () => {
	const [k1, k2, k3] = tables.get('employment_contract')!;
	const terms = (facts: Row) => ({
		contract_terms: [{ effective_range: { from: '2020-01-01', to: null }, facts }]
	});
	k1!.facts = terms({ fixed_term: true });
	k2!.facts = terms({});
	tables.get('employment_contract')!.push({
		...k3!,
		id: 'k4',
		employee_id: 'p-k4',
		effective_range: { from: '2021-01-01', to: '2025-11-15' }
	});
	tables.get('rule_set')!.push(
		task('PERMANENT_COUNT', {
			trigger: { collection: 'work_suspension', event: 'created' },
			when: 'headcount_permanent == 1.0 && headcount == 2.0 && headcount_permanent_by_worksite[""] == 1.0 && headcount_by_worksite[""] == 2.0 && row.kind == "CLOSURE"',
			due: 'row.starts_on'
		}),
		// Separations come sorted by exit day, so a window count is a binary search.
		task('WINDOW_COUNT', {
			trigger: { collection: 'work_suspension', event: 'updated' },
			when: 'separations[0].exit_date <= separations[1].exit_date && separations.exists(s, count_within(separations, "exit_date", s.exit_date, add_days(s.exit_date, 59)) >= 2)',
			due: 'today'
		})
	);
	written.length = 0;
	const suspension = {
		id: 'ws-1',
		company_id: COMPANY,
		approval_id: null,
		kind: 'CLOSURE',
		starts_on: '2026-01-05',
		ends_on: '2026-01-06'
	};
	await fire('work_suspension', 'created', suspension, '2026-01-05');
	await fire('work_suspension', 'updated', suspension, '2026-01-06');
	assert.deepEqual(
		written.map(({ data }) => [data.code, data.due_on]),
		[
			['PERMANENT_COUNT', '2026-01-05'],
			['WINDOW_COUNT', '2026-01-06']
		]
	);
});

test('an entity update’s row carries what it changed: a re-registration on a new address', async () => {
	tables.get('rule_set')!.push(
		task('ESTABLISHMENT_UPDATE', {
			trigger: { collection: 'entity', event: 'updated' },
			when: 'has(row.before) && ("address" in row.before || "name" in row.before)',
			repeat_key: 'today',
			due: 'add_days(today, 30)'
		})
	);
	written.length = 0;
	const entity = tables.get('entity')![0]!;
	await fire(
		'entity',
		'updated',
		{ ...entity, approval_id: null, before: { address: 'Old street 1' } },
		'2026-04-01'
	);
	await fire(
		'entity',
		'updated',
		{ ...entity, approval_id: null, before: { facts: {} } },
		'2026-04-02'
	);
	assert.deepEqual(raised('ESTABLISHMENT_UPDATE'), ['ESTABLISHMENT_UPDATE:c1:c1:2026-04-01']);
});

test('task contract rows carry the engagement: a yearly return per payee', async () => {
	const payee = { ...tables.get('employment_contract')![1]!, engagement: 'PAYEE' };
	tables.get('employment_contract')![1] = payee;
	tables.get('rule_set')!.push(
		task('PAYEE_RETURN', {
			trigger: { collection: 'calendar', event: 'daily' },
			when: 'today.endsWith("-06-30") && row.engagement == "PAYEE" && contract.engagement == "PAYEE"',
			due: 'add_days(today, 59)'
		})
	);
	written.length = 0;
	await fire('calendar', 'daily', { ...payee, leave: [], leave_balances: [] }, '2026-06-30', payee);
	assert.deepEqual(raised('PAYEE_RETURN'), ['PAYEE_RETURN:c1:k2:2026-06-30']);
});

test('an entity calendar task recurs once per its repeat key', async () => {
	tables.get('rule_set')!.push(
		task('MONTHLY_RENEWAL', {
			trigger: { collection: 'entity', event: 'calendar' },
			when: 'today.substring(8) == "15"',
			repeat_key: 'period.key',
			due: 'month_end(today)'
		})
	);
	written.length = 0;
	const entity = { ...tables.get('entity')![0]!, approval_id: null };
	for (const day of ['2026-01-15', '2026-01-15', '2026-01-16', '2026-02-15'])
		await fire('entity', 'calendar', entity, day);
	assert.deepEqual(raised('MONTHLY_RENEWAL'), [
		'MONTHLY_RENEWAL:c1:c1:2026-01',
		'MONTHLY_RENEWAL:c1:c1:2026-02'
	]);
});

test('a rule whose expression fails fails the run with the rule code and the message, even where CEL absorbs it', async () => {
	// `when` fails and `applies_when` is false: CEL's commutative `&&` reads the pair as false, the duty silently not
	// raised and the run a success.
	tables.get('rule_set')!.push(
		task('BROKEN_NOTICE', {
			trigger: { collection: 'workplace_case', event: 'created' },
			when: 'row.no_such_field.flag == true',
			applies_when: 'false',
			due: 'today'
		})
	);
	written.length = 0;
	await assert.rejects(
		fire(
			'workplace_case',
			'created',
			{ id: 'case-9', approval_id: null, kind: 'DATA_BREACH', opened_on: '2026-03-02' },
			'2026-03-02'
		),
		/raise-tasks.*BROKEN_NOTICE.*no_such_field/s
	);
	assert.deepEqual(written, []);
	tables.get('rule_set')!.pop();
});

test('duty contexts read the governing version’s PAYROLL rule tables as `rules`: a region table in a task and an obligation', async () => {
	tables.get('entity')![0]!.region = 'NORTH';
	tables.get('rule_set')!.push(
		{
			settings_id: settings!.id,
			family: 'PAYROLL',
			code: 'regions',
			name: 'Regions',
			rules: { by_region: { NORTH: { notice_days: 5, levy: 12.5 } } }
		},
		task('REGIONAL_NOTICE', {
			trigger: { collection: 'workplace_case', event: 'created' },
			when: 'rules.regions.by_region[company.region].notice_days > 0',
			due: 'add_days(row.opened_on, int(rules.regions.by_region[company.region].notice_days))'
		}),
		{
			settings_id: settings!.id,
			family: 'OBLIGATIONS',
			code: 'REGIONAL_LEVY',
			name: 'Regional levy',
			rules: {
				description: 'A levy by the entity’s region.',
				authority: 'Test',
				schemes: [],
				applies_when: 'company.region in rules.regions.by_region',
				due: 'add_days(period.to, 10)',
				amount: 'rules.regions.by_region[company.region].levy'
			}
		}
	);
	written.length = 0;
	await fire(
		'workplace_case',
		'created',
		{ id: 'case-r', approval_id: null, kind: 'ANY', opened_on: '2026-03-02' },
		'2026-03-02'
	);
	await runBehaviours({
		collection: 'payroll_run',
		action: 'created',
		row: { id: 'r-region', company_id: COMPANY, period: '2026-01', approval_id: null, pins: [] },
		day: '2026-01-01',
		subjects: [{ company_id: COMPANY, employment_id: null, employee_id: null }],
		fields: async () => ({}),
		versionFor: versionLookup(read),
		read,
		act,
		run: { totals: { gross: 0, net: 0, employer_cost: 0, schemes: {} }, statutory: {} }
	});
	assert.deepEqual(
		written
			.filter(({ data }) =>
				['REGIONAL_NOTICE', 'REGIONAL_LEVY'].includes(String(data.code ?? data.duty_code))
			)
			.map(({ data }) => [data.code ?? data.duty_code, data.due_on, data.amount_due ?? null]),
		[
			['REGIONAL_NOTICE', '2026-03-07', null],
			['REGIONAL_LEVY', '2026-02-10', 12.5]
		]
	);
	tables.get('rule_set')!.splice(-3);
});
