/** Native behaviour events over the authored SG law and a real seeded workspace. */
import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { vi } from 'vitest';
import { isMasked } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect, Schema } from 'effect';
import {
	describeTrigger,
	leaveBalancesOn,
	leaveTaken,
	runBehaviours,
	runTotals,
	versionLookup,
	type VersionFor
} from '../src/lib/payroll_engine/behaviour_runner.ts';
import {
	beforeOf,
	moneyNumber,
	type CallerRead,
	Refusal
} from '../src/lib/payroll_engine/foundation.ts';
import { termsFromFacts } from '../src/lib/payroll_engine/contract_terms.ts';
import { assertFailure, lineage, world, type Row } from './jurisdiction_kit.ts';
import { evaluateStrict } from '../src/lib/payroll_engine/expressions.ts';
import { fixtureId, nativeId } from './fixture_values.ts';

const LAW = lineage('SG');
const settings = LAW.settingsOf('version_2');
const COMPANY = nativeId('entity', fixtureId('c1'));
const CHILDCARE = {
	settings_id: settings['id'],
	code: 'CHILDCARE_LEAVE',
	name: 'Childcare leave',
	can_encash: false
};
const CLAIM = {
	...LAW.byCode('version_2', 'claim_catalog', 'MEDICAL_TREATMENT_REIMBURSEMENT'),
	id: fixtureId('cc1'),
	code: 'MEDICAL',
	name: 'Medical'
};
const contract = (label: string, from: string, to: string | null = null): Row => ({
	id: fixtureId(label),
	company_id: COMPANY,
	employee_id: fixtureId(`p-${label}`),
	employee_number: label,
	contract_number: 1,
	effective_range: { from, to },
	facts: {}
});
const tables = new Map<string, Row[]>([
	['jurisdiction_settings', [{ ...settings, cloned_from_id: null }]],
	[
		'entity',
		[
			{
				id: COMPANY,
				name: 'Omni',
				settings_code: 'SG',
				pay_cutoff_day: 1,
				effective_range: { from: '2020-01-01', to: null },
				facts: {}
			}
		]
	],
	[
		'employment_contract',
		[
			contract('k1', '2020-03-16'),
			contract('k2', '2024-01-01'),
			contract('k3', '2021-01-01', '2025-12-31')
		]
	],
	[
		'employment_profile',
		['p-k1', 'p-k2', 'p-k3', 'p-k4', 'p-prior-year-only'].map((label) => ({
			id: fixtureId(label),
			name: label,
			nationality: 'SG',
			facts: {}
		}))
	],
	[
		'rule_set',
		[
			{
				id: fixtureId('service-anniversary-rule'),
				settings_id: settings['id'],
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
	['obligation', []],
	['claim_catalog', [CLAIM]]
]);
const written: { callable: string; data: Row }[] = [];
type Native = {
	readonly read: CallerRead;
	readonly act: ReturnType<Kit['bodyActs']>;
	readonly versionFor: VersionFor;
};
const withNative = <A, E>(use: (native: Native) => Effect.Effect<A, E>, source = tables) =>
	world(source).withRead((read) =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const previousTasks = new Set((source.get('regulatory_task') ?? []).map((row) => row['id']));
			const previousObligations = new Set((source.get('obligation') ?? []).map((row) => row['id']));
			const value = yield* use({
				read,
				act: t.bodyActs(t.admin),
				versionFor: yield* versionLookup(read)
			});
			const got = yield* read({
				tasks: {
					collection: 'regulatory_task',
					select: {
						code: true,
						title: true,
						authority: true,
						subject_collection: true,
						subject_id: true,
						trigger_ref: true,
						triggered_on: true,
						due_on: true,
						state: true,
						done_on: true,
						dismiss_reason: true,
						evidence_file: true,
						occurrence_key: true,
						facts: true,
						company_id: true,
						settings_id: true
					},
					all: true
				},
				obligations: {
					collection: 'obligation',
					select: {
						duty_code: true,
						authority: true,
						occurrence_key: true,
						trigger_ref: true,
						triggered_on: true,
						due_on: true,
						currency: true,
						amount_due: true,
						amount_settled: true,
						state: true,
						fulfilled_on: true,
						waive_reason: true,
						reference: true,
						evidence_file: true,
						facts: true,
						company_id: true,
						settings_id: true
					},
					all: true
				}
			});
			for (const row of got.tasks.rows)
				if (!previousTasks.has(row.id))
					written.push({ callable: 'regulatory_task.create', data: row });
			for (const row of got.obligations.rows)
				if (!previousObligations.has(row.id))
					written.push({ callable: 'obligation.create', data: row });
			source.set('regulatory_task', [...got.tasks.rows]);
			source.set('obligation', [...got.obligations.rows]);
			return value;
		})
	);
const perform = (input: Omit<Parameters<typeof runBehaviours>[0], 'read' | 'act' | 'versionFor'>) =>
	withNative(({ read, act, versionFor }) => runBehaviours({ ...input, read, act, versionFor }));
const tick = (day: string) =>
	withNative(({ read, act, versionFor }) =>
		Effect.gen(function* () {
			const contracts = (yield* read('employment_contract', {
				select: {
					company_id: true,
					employee_id: true,
					effective_range: true,
					facts: true,
					engagement: true
				},
				all: true
			})).rows;
			const current = contracts.filter((row) => {
				assert.ok(!isMasked(row.effective_range));
				return (
					row.effective_range.from <= day &&
					(row.effective_range.to === null || row.effective_range.to >= day)
				);
			});
			yield* Effect.forEach(
				current,
				(row) => {
					assert.ok(!isMasked(row.company_id) && row.company_id !== null);
					assert.ok(!isMasked(row.employee_id) && row.employee_id !== null);
					return runBehaviours({
						collection: 'calendar',
						action: 'daily',
						row,
						day,
						subjects: [
							{ company_id: row.company_id, employment_id: row.id, employee_id: row.employee_id }
						],
						fields: () => Effect.succeed({}),
						versionFor,
						read,
						act
					});
				},
				{ concurrency: 'unbounded' }
			);
		})
	);
const enrich = (
	collection: 'claim_catalog_entry' | 'payslip' | 'employment_contract' | 'leave_catalog_entry',
	row: Row
) =>
	withNative(({ read }) => {
		if (collection === 'claim_catalog_entry')
			return describeTrigger(
				{
					collection,
					row: {
						...row,
						catalog_id: nativeId('claim_catalog', row['catalog_id'])
					}
				},
				read
			);
		if (collection === 'payslip')
			return describeTrigger(
				{
					collection,
					row: {
						...row,
						id: nativeId('payslip', row['id'])
					}
				},
				read
			);
		if (collection === 'employment_contract')
			return describeTrigger(
				{
					collection,
					row: {
						...row,
						id: nativeId('employment_contract', row['id'])
					}
				},
				read
			);
		return describeTrigger(
			{
				collection,
				row: {
					...row,
					catalog_id: nativeId('leave_catalog', row['catalog_id']),
					employment_id:
						row['employment_id'] === null
							? null
							: nativeId('employment_contract', row['employment_id'])
				}
			},
			read
		);
	});
const taken = (where: Parameters<typeof leaveTaken>[1], since?: string) =>
	withNative(({ read }) => leaveTaken(read, where, since));
const balancesOn = (employment: Parameters<typeof leaveBalancesOn>[1], day: string) =>
	withNative(({ read }) => leaveBalancesOn(read, employment, day));
const leaveRows = (value: unknown) => {
	const rows = Schema.Array(Schema.Record(Schema.String, Schema.Unknown));
	assert.ok(Schema.is(rows)(value));
	return value;
};

it.effect(
	'the daily tick raises a calendar task once a day for the employment it falls on',
	Effect.fnUntraced(function* () {
		yield* tick('2026-03-16');
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
					`SERVICE_ANNIVERSARY:${COMPANY}:${fixtureId('k1')}:2026-03-16`
				]
			]
		);
		// The same day again raises nothing: the occurrence key holds the day.
		yield* tick('2026-03-16');
		assert.equal(written.length, 1);
		// Another day is another occurrence; this one is nobody's anniversary.
		yield* tick('2026-03-17');
		assert.equal(written.length, 1);
	})
);

it.effect(
	'an entry trigger carries its class code and a paid payslip its paid day and its run’s pay days',
	Effect.fnUntraced(function* () {
		const described = yield* enrich('claim_catalog_entry', {
			id: nativeId('claim_catalog_entry', fixtureId('e1')),
			catalog_id: nativeId('claim_catalog', fixtureId('cc1'))
		});
		const catalog = described['catalog'];
		assert.ok(Schema.is(Schema.Record(Schema.String, Schema.Unknown))(catalog));
		assert.deepEqual(
			{
				id: described['id'],
				catalog_id: described['catalog_id'],
				catalog_code: described['catalog_code'],
				catalog: { id: catalog['id'], code: catalog['code'], name: catalog['name'] }
			},
			{
				id: nativeId('claim_catalog_entry', fixtureId('e1')),
				catalog_id: nativeId('claim_catalog', fixtureId('cc1')),
				catalog_code: 'MEDICAL',
				catalog: {
					id: nativeId('claim_catalog', fixtureId('cc1')),
					code: 'MEDICAL',
					name: 'Medical'
				}
			}
		);
		tables.set('payslip', [
			{
				id: nativeId('payslip', fixtureId('s1')),
				payroll_run_id: nativeId('payroll_run', fixtureId('r1')),
				employment_id: nativeId('employment_contract', fixtureId('k1')),
				terms_through: '2026-03-31',
				currency: 'SGD',
				gross: 0,
				total_deductions: 0,
				net: 0,
				employer_cost: 0,
				base: [{ component_code: 'BASIC', amount: 0 }],
				adjustments: [
					{
						component_code: 'BONUS',
						family: 'ADHOC',
						source_id: 'bonus-line',
						bucket: 'EARNING',
						destination: 'PAY',
						amount: 0
					},
					{
						component_code: 'BASIC',
						family: 'ADHOC',
						source_id: 'basic-line',
						bucket: 'EARNING',
						destination: 'PAY',
						amount: 0
					}
				]
			}
		]);
		// A late payment reads its run's due day beside its paid day (an interest or fine owed to the worker).
		tables.set('payroll_run', [
			{
				id: nativeId('payroll_run', fixtureId('r1')),
				company_id: COMPANY,
				settings_id: settings['id'],
				period: '2026-03',
				kind: 'REGULAR',
				pay_date: '2026-03-31',
				pay_due_date: '2026-03-31'
			}
		]);
		assert.deepEqual(
			yield* enrich('payslip', {
				id: nativeId('payslip', fixtureId('s1')),
				payroll_run_id: nativeId('payroll_run', fixtureId('r1')),
				paid_at: '2026-04-02T03:00:00.000Z'
			}),
			{
				id: nativeId('payslip', fixtureId('s1')),
				payroll_run_id: nativeId('payroll_run', fixtureId('r1')),
				paid_at: '2026-04-02T03:00:00.000Z',
				line_codes: ['BASIC', 'BONUS'],
				pay_date: '2026-03-31',
				pay_due_date: '2026-03-31',
				paid_on: '2026-04-02'
			}
		);
	})
);

it.effect(
	'duty contexts name the coming published holidays: a task due a week before a named one',
	Effect.fnUntraced(function* () {
		tables.get('rule_set')!.push({
			id: fixtureId('extra-rule-1'),
			settings_id: settings['id'],
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
				id: fixtureId('holiday-new-year'),
				company_id: COMPANY,
				date: '2026-01-01',
				name: 'New Year',
				kind: 'PUBLIC_HOLIDAY',
				published_at: '2025-12-01T00:00:00.000Z'
			},
			{
				id: fixtureId('holiday-idul-2026'),
				company_id: COMPANY,
				date: '2026-03-20',
				name: 'Idul Fitri',
				kind: 'PUBLIC_HOLIDAY',
				published_at: '2025-12-01T00:00:00.000Z'
			},
			{
				id: fixtureId('holiday-idul-2027'),
				company_id: COMPANY,
				date: '2027-03-10',
				name: 'Idul Fitri',
				kind: 'PUBLIC_HOLIDAY',
				published_at: '2025-12-01T00:00:00.000Z'
			}
		]);
		written.length = 0;
		yield* tick('2026-02-02');
		assert.deepEqual(
			written
				.filter(({ data }) => data.code === 'FESTIVE_ALLOWANCE')
				.map(({ data }) => data.due_on),
			['2026-03-13', '2026-03-13']
		);
	})
);

const task = (code: string, rules: Row): Row => ({
	id: fixtureId(`task-rule:${code}`),
	settings_id: settings['id'],
	family: 'TASKS',
	code,
	name: code,
	rules: { description: code, authority: 'Test', ...rules }
});
const fire = (collection: string, action: string, row: Row, day: string, employment?: Row) =>
	perform({
		collection,
		action,
		row,
		day,
		subjects: [
			{
				company_id: COMPANY,
				employment_id:
					employment === undefined ? null : nativeId('employment_contract', employment['id']),
				employee_id:
					employment === undefined
						? null
						: nativeId('employment_profile', employment['employee_id'])
			}
		],
		fields: () => Effect.succeed({})
	});
const raised = (code: string) =>
	written.filter(({ data }) => data.code === code).map(({ data }) => data.occurrence_key);

it.effect(
	'task contexts: dependants, separations, leave history and a repeat key per period',
	Effect.fnUntraced(function* () {
		const k1 = tables.get('employment_contract')![0]!;
		Object.assign(tables.get('employment_contract')![2]!, {
			exit_ground: 'REDUNDANCY',
			exit_facts: {}
		});
		tables.set('leave_catalog', [
			{ ...CHILDCARE, id: nativeId('leave_catalog', fixtureId('lc-cc')) }
		]);
		tables.set('leave_catalog_entry', [
			{
				id: nativeId('leave_catalog_entry', fixtureId('cc-1')),
				employment_id: nativeId('employment_contract', fixtureId('k1')),
				company_id: COMPANY,
				catalog_id: nativeId('leave_catalog', fixtureId('lc-cc')),
				activity: 'TIME_OFF',
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
			name: 'Test employee',
			id: nativeId('employment_profile', fixtureId('p-k1')),
			nationality: 'SG',
			children,
			facts: {}
		});
		const child = { child_birthdate: '2026-02-20', relationship: 'CHILD' };
		tables.set('employment_profile', [
			...(tables.get('employment_profile') ?? []).filter((row) => row['id'] !== fixtureId('p-k1')),
			profile([child])
		]);
		yield* fire('employment_profile', 'updated', profile([child]), '2026-03-02', k1);
		yield* fire('employment_profile', 'updated', profile([child]), '2026-03-03', k1);
		tables.set('employment_profile', [
			...(tables.get('employment_profile') ?? []).filter((row) => row['id'] !== fixtureId('p-k1')),
			profile([child, child])
		]);
		yield* fire('employment_profile', 'updated', profile([child, child]), '2026-03-09', k1);
		// The same child list on another day is the same occurrence; a second child is a new one.
		assert.deepEqual(raised('DEPENDANT_CHANGE'), [
			`DEPENDANT_CHANGE:${COMPANY}:${fixtureId('p-k1')}:1`,
			`DEPENDANT_CHANGE:${COMPANY}:${fixtureId('p-k1')}:2`
		]);
		const k3 = tables.get('employment_contract')![2]!;
		yield* fire('employment_contract', 'updated', k3, '2026-01-20', k3);
		yield* fire('employment_contract', 'updated', k3, '2026-04-20', k3);
		// k3's redundancy on 31 December 2025 is inside 60 days of 20 January, not of 20 April.
		assert.deepEqual(raised('MASS_LAYOFF'), [`MASS_LAYOFF:${COMPANY}:${fixtureId('k3')}`]);
		const daily = Effect.fnUntraced(function* (day: string) {
			const leave = yield* taken({ company_id: { eq: COMPANY } }, '2024-01-01');
			yield* fire(
				'calendar',
				'daily',
				{ ...k1, leave: leave.get(nativeId('employment_contract', fixtureId('k1'))) ?? [] },
				day,
				k1
			);
		});
		for (const day of ['2026-03-16', '2026-03-17', '2026-04-01', '2026-09-01']) yield* daily(day);
		assert.deepEqual(raised('CHILDCARE_APPLICATION'), [
			`CHILDCARE_APPLICATION:${COMPANY}:${fixtureId('k1')}:2026-03`,
			`CHILDCARE_APPLICATION:${COMPANY}:${fixtureId('k1')}:2026-04`
		]);
		// A contract trigger row carries its employment's time off.
		const described = yield* enrich('employment_contract', k1);
		assert.deepEqual(described.leave, [
			{
				id: nativeId('leave_catalog_entry', fixtureId('cc-1')),
				code: 'CHILDCARE_LEAVE',
				from: '2026-03-01',
				to: '2026-08-31',
				chain_from: '2026-03-01',
				days: 130,
				facts: {}
			}
		]);
	})
);

it.effect(
	'a workplace case raises its tasks when opened and once when still open; a closed task raises its own',
	Effect.fnUntraced(function* () {
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
		yield* fire(
			'workplace_case',
			'created',
			{
				id: nativeId('workplace_case', fixtureId('case-1')),
				kind: 'FLEXIBLE_WORK_REQUEST',
				opened_on: '2026-03-02'
			},
			'2026-03-02'
		);
		const breach = {
			id: nativeId('workplace_case', fixtureId('case-2')),
			kind: 'DATA_BREACH',
			opened_on: '2026-03-02',
			closed_on: null
		};
		for (const day of ['2026-03-04', '2026-03-05', '2026-03-06'])
			yield* fire('workplace_case', 'daily', breach, day);
		yield* fire(
			'regulatory_task',
			'updated',
			{
				id: nativeId('regulatory_task', fixtureId('t-1')),
				state: 'DONE',
				due_on: '2026-01-31',
				done_on: '2026-02-10'
			},
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
	})
);

it.effect(
	'task contexts II: worksite headcounts, a window-keyed duty, leave balances, chains and what a write changed',
	Effect.fnUntraced(function* () {
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
		yield* fire('employment_contract', 'updated', { ...k3, terms_written: [] }, '2026-01-20', k3);
		yield* fire('employment_contract', 'updated', { ...k2, terms_written: [] }, '2026-01-21', k2);
		// Keyed per row (no repeat_key), each row that meets the condition raises its own.
		assert.deepEqual(raised('WORKSITE_NOTICE'), [
			`WORKSITE_NOTICE:${COMPANY}:${fixtureId('k3')}`,
			`WORKSITE_NOTICE:${COMPANY}:${fixtureId('k2')}`
		]);
		// Keyed to the crossing, k2's later edit meets the same window: no second duty.
		assert.deepEqual(raised('CROSSING_DUTY'), [`CROSSING_DUTY:${COMPANY}:2025-12-31`]);

		// A grant whose attendance test fails raises nothing; one that passes raises the designation.
		const grant = (days: string) =>
			tables.set('leave_catalog', [
				{ ...CHILDCARE, id: nativeId('leave_catalog', fixtureId('lc-cc')) },
				{
					...CHILDCARE,
					id: nativeId('leave_catalog', fixtureId('lc-ag')),
					settings_id: settings['id'],
					code: 'ATTENDED_GRANT',
					name: 'Attended grant',
					entitlement: { window: 'CALENDAR_YEAR', days }
				}
			]);
		grant('attendance.window.scheduled > 0 ? 10.0 : 0.0');
		const balances = yield* balancesOn(
			nativeId('employment_contract', fixtureId('k1')),
			'2026-03-16'
		);
		assert.ok(balances.some((row) => row.attendance != null));
		// A calendar row carries the employment's time off (`row.leave`), as the tick builds it.
		yield* fire(
			'calendar',
			'daily',
			{ ...k1, leave: [], leave_balances: balances },
			'2026-03-16',
			k1
		);
		grant('10.0');
		yield* fire(
			'calendar',
			'daily',
			{
				...k1,
				leave: [],
				leave_balances: yield* balancesOn(
					nativeId('employment_contract', fixtureId('k1')),
					'2026-03-17'
				)
			},
			'2026-03-17',
			k1
		);
		assert.deepEqual(raised('GRANT_DESIGNATION'), [
			`GRANT_DESIGNATION:${COMPANY}:${fixtureId('k1')}:2026-03-17`
		]);

		// An extension entered as a new row continues the leave it follows.
		tables.get('leave_catalog_entry')!.push({
			id: nativeId('leave_catalog_entry', fixtureId('cc-2')),
			employment_id: nativeId('employment_contract', fixtureId('k1')),
			company_id: COMPANY,
			catalog_id: nativeId('leave_catalog', fixtureId('lc-cc')),
			activity: 'TIME_OFF',
			occurred_on: '2026-09-01',
			from: '2026-09-01',
			to: '2026-10-31',
			days: 44,
			facts: {}
		});
		const leave = (yield* taken({
			employment_id: { eq: nativeId('employment_contract', fixtureId('k1')) }
		})).get(nativeId('employment_contract', fixtureId('k1')))!;
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
		const late = {
			effective_range: { from: '2025-07-01', to: null },
			facts: { worksite: 'NORTH' }
		};
		const described = yield* enrich('employment_contract', {
			...k1,
			facts: { contract_terms: [...termsFromFacts(k1?.facts), late] },
			before: { facts: k1!.facts }
		});
		assert.deepEqual(described.terms_written, [late]);
		yield* fire('employment_contract', 'updated', described, '2026-02-01', k1);
		assert.deepEqual(raised('TERM_CHANGE'), [
			`TERM_CHANGE:${COMPANY}:${fixtureId('k1')}:2025-07-01`
		]);
	})
);

it.effect(
	'an obligation priced from entity facts and the months the headcount reached a threshold',
	Effect.fnUntraced(function* () {
		tables.get('rule_set')!.push({
			id: fixtureId('extra-rule-2'),
			settings_id: settings['id'],
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
		yield* perform({
			collection: 'payroll_run',
			action: 'created',
			row: {
				id: nativeId('payroll_run', fixtureId('r-levy')),
				company_id: COMPANY,
				period: '2026-01',
				pins: []
			},
			day: '2026-01-01',
			subjects: [{ company_id: COMPANY, employment_id: null, employee_id: null }],
			fields: () => Effect.succeed({}),

			run: { totals: { gross: 0, net: 0, employer_cost: 0, schemes: {} } }
		});
		// Three in force at each month end from February to December 2025; two at the end of January 2026.
		assert.deepEqual(
			written
				.filter(({ data }) => data.duty_code === 'YEARLY_LEVY')
				.map(({ data }) => moneyNumber(data.amount_due)),
			[1100]
		);
	})
);

it.effect(
	'an obligation amount reads the run’s statutory totals: a unit premium on the insured amounts summed',
	Effect.fnUntraced(function* () {
		const line = (base: number, charged: number, employer: number) => ({
			scheme_code: 'UNIT_FUND',
			base_amount: base,
			charged_base: charged,
			parts: { ordinary: base },
			employee_amount: 0,
			employer_amount: employer
		});
		const run = runTotals([
			{
				gross: Decimal.of('30000'),
				net: Decimal.of('30000'),
				employer_cost: Decimal.of('30010'),
				statutory: [line(30000, 30300, 10)]
			},
			{
				gross: Decimal.of('45000'),
				net: Decimal.of('45000'),
				employer_cost: Decimal.of('45015'),
				statutory: [line(45000, 45800, 15)]
			}
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
			id: fixtureId('extra-rule-3'),
			settings_id: settings['id'],
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
		yield* perform({
			collection: 'payroll_run',
			action: 'created',
			row: {
				id: nativeId('payroll_run', fixtureId('r-unit')),
				company_id: COMPANY,
				period: '2026-01',
				pins: []
			},
			day: '2026-01-01',
			subjects: [{ company_id: COMPANY, employment_id: null, employee_id: null }],
			fields: () => Effect.succeed({}),

			run
		});
		assert.deepEqual(
			written
				.filter(({ data }) => data.duty_code === 'UNIT_PREMIUM')
				.map(({ data }) => moneyNumber(data.amount_due)),
			[25.34]
		);
		tables.get('rule_set')!.pop();
	})
);

it.effect(
	'a leave-entry trigger sees the employment’s other leave rows and its own chain start',
	Effect.fnUntraced(function* () {
		tables.set('leave_catalog', [
			{ ...CHILDCARE, id: nativeId('leave_catalog', fixtureId('lc-cc')) }
		]);
		tables.set('leave_catalog_entry', [
			{
				company_id: COMPANY,
				id: nativeId('leave_catalog_entry', fixtureId('first')),
				employment_id: nativeId('employment_contract', fixtureId('k1')),
				catalog_id: nativeId('leave_catalog', fixtureId('lc-cc')),
				activity: 'TIME_OFF',
				occurred_on: '2026-03-01',
				from: '2026-03-01',
				to: '2026-08-31',
				days: 130,
				facts: {}
			},
			{
				company_id: COMPANY,
				id: nativeId('leave_catalog_entry', fixtureId('next')),
				employment_id: nativeId('employment_contract', fixtureId('k1')),
				catalog_id: nativeId('leave_catalog', fixtureId('lc-cc')),
				activity: 'TIME_OFF',
				occurred_on: '2026-09-01',
				from: '2026-09-01',
				to: '2026-10-31',
				days: 44,
				facts: {}
			}
		]);
		const described = yield* enrich('leave_catalog_entry', tables.get('leave_catalog_entry')![1]!);
		// A continuation: its chain starts with the first row, so a "first application" task can skip it.
		assert.equal(described.chain_from, '2026-03-01');
		assert.deepEqual(
			leaveRows(described['leave']).map((row) => [row.id, row.chain_from]),
			[
				[nativeId('leave_catalog_entry', fixtureId('first')), '2026-03-01'],
				[nativeId('leave_catalog_entry', fixtureId('next')), '2026-03-01']
			]
		);
	})
);

it.effect(
	'task contexts III: permanent headcount, separations by exit day, count_within and suspension triggers',
	Effect.fnUntraced(function* () {
		const [k1, k2, k3] = tables.get('employment_contract')!;
		const terms = (facts: Row) => ({
			contract_terms: [{ effective_range: { from: '2020-01-01', to: null }, facts }]
		});
		k1!.facts = terms({ fixed_term: true });
		k2!.facts = terms({});
		tables.get('employment_contract')!.push({
			...k3!,
			id: nativeId('employment_contract', fixtureId('k4')),
			employee_id: nativeId('employment_profile', fixtureId('p-k4')),
			employee_number: 'k4',
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
			id: nativeId('work_suspension', fixtureId('ws-1')),
			company_id: COMPANY,
			kind: 'CLOSURE',
			starts_on: '2026-01-05',
			ends_on: '2026-01-06'
		};
		yield* fire('work_suspension', 'created', suspension, '2026-01-05');
		yield* fire('work_suspension', 'updated', suspension, '2026-01-06');
		assert.deepEqual(
			written.map(({ data }) => [data.code, data.due_on]),
			[
				['PERMANENT_COUNT', '2026-01-05'],
				['WINDOW_COUNT', '2026-01-06']
			]
		);
	})
);

it.effect(
	'an entity update’s row carries what it changed: a re-registration on a new address',
	Effect.fnUntraced(function* () {
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
		yield* fire(
			'entity',
			'updated',
			{ ...entity, before: { address: 'Old street 1' } },
			'2026-04-01'
		);
		yield* fire('entity', 'updated', { ...entity, before: { facts: {} } }, '2026-04-02');
		assert.deepEqual(raised('ESTABLISHMENT_UPDATE'), [
			`ESTABLISHMENT_UPDATE:${COMPANY}:${COMPANY}:2026-04-01`
		]);
	})
);

it.effect(
	'task contract rows carry the engagement: a yearly return per payee',
	Effect.fnUntraced(function* () {
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
		yield* fire(
			'calendar',
			'daily',
			{ ...payee, leave: [], leave_balances: [] },
			'2026-06-30',
			payee
		);
		assert.deepEqual(raised('PAYEE_RETURN'), [
			`PAYEE_RETURN:${COMPANY}:${fixtureId('k2')}:2026-06-30`
		]);
	})
);

it.effect(
	'entity calendar tasks receive prior-year staffing even after every employee has left',
	Effect.fnUntraced(function* () {
		tables.get('rule_set')!.push(
			task('PRIOR_YEAR_RETURN', {
				trigger: { collection: 'entity', event: 'calendar' },
				when: 'headcount == 0.0 && size(previous_year_headcount_months) == 12 && previous_year_headcount_months.all(m, m.headcount == 1.0 && m.month.startsWith("2025-"))',
				occurrence: 'add_years(today, -1).substring(0, 4)',
				due: 'month_end(today)'
			})
		);
		written.length = 0;
		const prior = new Map(tables);
		prior.set('employment_contract', [contract('prior-year-only', '2025-01-01', '2025-12-31')]);
		prior.set('leave_catalog_entry', []);
		prior.set('payslip', []);
		prior.set('payroll_run', []);
		yield* withNative(
			({ read, act, versionFor }) =>
				runBehaviours({
					collection: 'entity',
					action: 'calendar',
					row: { ...tables.get('entity')?.[0] },
					day: '2026-03-01',
					subjects: [{ company_id: COMPANY, employment_id: null, employee_id: null }],
					fields: () => Effect.succeed({}),
					read,
					act,
					versionFor
				}),
			prior
		);
		assert.deepEqual(raised('PRIOR_YEAR_RETURN'), [`PRIOR_YEAR_RETURN:${COMPANY}:2025`]);
	})
);

it.effect(
	'an entity calendar task recurs once per its repeat key',
	Effect.fnUntraced(function* () {
		tables.get('rule_set')!.push(
			task('MONTHLY_RENEWAL', {
				trigger: { collection: 'entity', event: 'calendar' },
				when: 'today.substring(8) == "15"',
				repeat_key: 'period.key',
				due: 'month_end(today)'
			})
		);
		written.length = 0;
		const entity = { ...tables.get('entity')![0]! };
		for (const day of ['2026-01-15', '2026-01-15', '2026-01-16', '2026-02-15'])
			yield* fire('entity', 'calendar', entity, day);
		assert.deepEqual(raised('MONTHLY_RENEWAL'), [
			`MONTHLY_RENEWAL:${COMPANY}:${COMPANY}:2026-01`,
			`MONTHLY_RENEWAL:${COMPANY}:${COMPANY}:2026-02`
		]);
	})
);

it.effect(
	'a rule whose expression fails fails the run with the rule code and the message, even where CEL absorbs it',
	Effect.fnUntraced(function* () {
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
		yield* assertFailure(
			fire(
				'workplace_case',
				'created',
				{
					id: nativeId('workplace_case', fixtureId('case-9')),
					kind: 'DATA_BREACH',
					opened_on: '2026-03-02'
				},
				'2026-03-02'
			),
			/raise-tasks.*BROKEN_NOTICE.*no_such_field/s
		);
		assert.deepEqual(written, []);
		tables.get('rule_set')!.pop();
	})
);

it.effect(
	'duty contexts read the governing version’s PAYROLL rule tables as `rules`: a region table in a task and an obligation',
	Effect.fnUntraced(function* () {
		tables.get('entity')![0]!.region = 'NORTH';
		tables.get('rule_set')!.push(
			{
				id: fixtureId('extra-rule-4'),
				settings_id: settings['id'],
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
				id: fixtureId('extra-rule-5'),
				settings_id: settings['id'],
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
		yield* fire(
			'workplace_case',
			'created',
			{ id: nativeId('workplace_case', fixtureId('case-r')), kind: 'ANY', opened_on: '2026-03-02' },
			'2026-03-02'
		);
		yield* perform({
			collection: 'payroll_run',
			action: 'created',
			row: {
				id: nativeId('payroll_run', fixtureId('r-region')),
				company_id: COMPANY,
				period: '2026-01',
				pins: []
			},
			day: '2026-01-01',
			subjects: [{ company_id: COMPANY, employment_id: null, employee_id: null }],
			fields: () => Effect.succeed({}),

			run: { totals: { gross: 0, net: 0, employer_cost: 0, schemes: {} }, statutory: {} }
		});
		assert.deepEqual(
			written
				.filter(({ data }) =>
					['REGIONAL_NOTICE', 'REGIONAL_LEVY'].includes(String(data.code ?? data.duty_code))
				)
				.map(({ data }) => [
					data.code ?? data.duty_code,
					data.due_on,
					moneyNumber(data.amount_due)
				]),
			[
				['REGIONAL_NOTICE', '2026-03-07', null],
				['REGIONAL_LEVY', '2026-02-10', 12.5]
			]
		);
		tables.get('rule_set')!.splice(-3);
	})
);

it.effect(
	'two rules share their identical declared read and both persist their task outputs',
	Effect.fnUntraced(function* () {
		const source = new Map(tables);
		source.set('regulatory_task', []);
		source.set('obligation', []);
		source.set('rule_set', []);
		source.set('jurisdiction_settings', [
			{
				...settings,
				cloned_from_id: null,
				behaviours: {
					version: 1,
					rules: ['SHARED_FIRST', 'SHARED_SECOND'].map((code) => ({
						id: code,
						target_collection: 'entity',
						events: ['probed'],
						reads: {
							company: {
								collection: 'entity',
								where: { id: { eq: 'event.company_id' } },
								select: ['name']
							}
						},
						effect: `{"collection":"regulatory_task","operation":"create","data":{
							"code":${JSON.stringify(code)},"title":company[0].name + ${JSON.stringify(` ${code}`)},
							"subject_collection":"entity","subject_id":event.company_id,"trigger_ref":"shared-read-probe",
							"triggered_on":event.day,"due_on":event.day,"occurrence_key":${JSON.stringify(code)},
							"company_id":event.company_id,"settings_id":event.settings_id}}`
					}))
				}
			}
		]);
		const declaredEntityRead = Schema.is(
			Schema.Tuple([Schema.Literal('entity'), Schema.Struct({ mode: Schema.Literal('declared') })])
		);
		yield* withNative(
			({ read, act, versionFor }) =>
				Effect.scoped(
					Effect.gen(function* () {
						const reader = { read };
						const spy = yield* Effect.acquireRelease(
							Effect.sync(() => vi.spyOn(reader, 'read')),
							(held) => Effect.sync(() => held.mockRestore())
						);
						yield* runBehaviours({
							collection: 'entity',
							action: 'probed',
							row: { id: COMPANY },
							day: '2026-03-02',
							subjects: [{ company_id: COMPANY, employment_id: null, employee_id: null }],
							fields: () => Effect.succeed({}),
							read: reader.read,
							act,
							versionFor
						});
						assert.equal(spy.mock.calls.filter((call) => declaredEntityRead(call)).length, 1);
						const tasks = yield* read('regulatory_task', {
							select: { code: true, title: true },
							all: true
						});
						assert.deepEqual(
							tasks.rows
								.toSorted((left, right) => String(left.code).localeCompare(String(right.code)))
								.map((row) => [row.code, row.title]),
							[
								['SHARED_FIRST', 'Omni SHARED_FIRST'],
								['SHARED_SECOND', 'Omni SHARED_SECOND']
							]
						);
					})
				),
			source
		);
	})
);

it.effect(
	'a declared read with an operator the run cannot judge on its own writes refuses the run',
	Effect.fnUntraced(function* () {
		// The database judges `like`; an earlier rule's write in the same run is judged here, and taking it as met
		// would show the later rule a row the database would not.
		const version = tables.get('jurisdiction_settings')![0]!;
		const saved = version.behaviours;
		version.behaviours = {
			version: 1,
			rules: [
				{
					id: 'stage-entry',
					target_collection: 'work_suspension',
					events: ['probed'],
					effect:
						'{"collection": "adhoc_catalog_entry", "operation": "create", "data": {"label": "probe-1"}}'
				},
				{
					id: 'read-staged',
					target_collection: 'work_suspension',
					events: ['probed'],
					reads: {
						staged: {
							collection: 'adhoc_catalog_entry',
							where: { label: { like: '"probe%"' } }
						}
					}
				}
			]
		};
		const refused =
			"Behaviour read-staged reads adhoc_catalog_entry with the operator like, which the run's earlier writes cannot be judged by.";
		written.length = 0;
		try {
			yield* assertFailure(
				fire(
					'work_suspension',
					'probed',
					{ id: nativeId('work_suspension', fixtureId('ws-probe')), company_id: COMPANY },
					'2026-03-02'
				),
				(error: unknown) => error instanceof Refusal && error.message === refused
			);
			assert.deepEqual(written, []);
		} finally {
			version.behaviours = saved;
		}
	})
);

it.effect(
	'old sealed JP emergency-payment deadlines use the typed advance date without storing the retired loan column',
	Effect.fnUntraced(function* () {
		const jp = lineage('JP');
		const jpSettings = jp.settingsOf('version_1');
		const catalogue = jp.byCode('version_1', 'loan_catalog', 'EMERGENCY_ADVANCE');
		const source = new Map(tables);
		source.set('jurisdiction_settings', [
			...(tables.get('jurisdiction_settings') ?? []),
			jpSettings
		]);
		source.set('loan_catalog', [catalogue]);
		yield* withNative(
			({ read }) =>
				Effect.gen(function* () {
					const input = {
						catalog_id: nativeId('loan_catalog', catalogue.id),
						advance_made_on: PlainDate('2026-05-20')
					};
					const row = yield* describeTrigger(
						{ collection: 'loan_catalog_entry', row: input },
						read
					);
					assert.equal(evaluateStrict('row.occurred_on', { row }), '2026-05-20');
					assert.equal(row['advance_made_on'], '2026-05-20');
					assert.equal(Object.hasOwn(input, 'occurred_on'), false);
					const unknown = yield* describeTrigger(
						{
							collection: 'loan_catalog_entry',
							row: {
								catalog_id: input.catalog_id,
								repayment_period: { from: '2026-06-01', to: '2026-07-01' }
							}
						},
						read
					);
					assert.equal(unknown['occurred_on'], null);
				}),
			source
		);
	})
);
