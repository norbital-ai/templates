/** Moving or undoing a departure retracts its unpaid effects; paid encashment remains. */
import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { Effect } from 'effect';
import { runBehaviours, versionLookup } from '../src/lib/payroll_engine/behaviour_runner.ts';
import {
	isJsonObject,
	moneyNumber,
	type CallerRead
} from '../src/lib/payroll_engine/foundation.ts';
import { fixtureId, nativeId } from './fixture_values.ts';
import { lineage, world, type Row } from './jurisdiction_kit.ts';

const LAW = lineage('SG');
const settings = LAW.settingsOf('version_4');
const COMPANY = nativeId('entity', fixtureId('c1'));
const EMPLOYMENT = nativeId('employment_contract', fixtureId('k1'));
const PERSON = nativeId('employment_profile', fixtureId('p1'));
const START = '2020-01-01';
const tables = new Map<string, Row[]>();
const reset = () => {
	tables.clear();
	tables.set('jurisdiction_settings', [
		{ ...settings, cloned_from_id: null, effective_range: { from: START, to: null } }
	]);
	tables.set('entity', [
		{
			id: COMPANY,
			name: 'Omni',
			settings_code: 'SG',
			pay_cutoff_day: 1,
			effective_range: { from: START, to: null },
			facts: {}
		}
	]);
	tables.set('employment_contract', [
		{
			id: EMPLOYMENT,
			company_id: COMPANY,
			employee_id: PERSON,
			employee_number: 'E1',
			contract_number: 1,
			effective_range: { from: START, to: null },
			exit_ground: null,
			exit_facts: null,
			facts: {}
		}
	]);
	tables.set('employment_profile', [{ id: PERSON, name: 'Test employee', facts: {} }]);
	tables.set('leave_catalog', [
		{
			...LAW.byCode('version_4', 'leave_catalog', 'ANNUAL_LEAVE'),
			id: fixtureId('al'),
			settings_id: settings['id'],
			unit: 'DAY',
			can_encash: true,
			encash_on_exit: true,
			entitlement: { days: '14.0' }
		}
	]);
	tables.set('leave_catalog_entry', []);
	tables.set('rule_set', [
		{
			id: fixtureId('exit-notice-rule'),
			settings_id: settings['id'],
			family: 'TASKS',
			code: 'EXIT_NOTICE',
			name: 'Exit notice',
			rules: {
				description: 'A record-driven exit duty.',
				authority: 'Test',
				trigger: { collection: 'employment_contract', event: 'updated' },
				when: 'contract != null && contract.exit_facts != null && contract.effective_range.to != null',
				due: 'add_days(exit_on, 7)'
			}
		}
	]);
	tables.set('holiday', []);
	tables.set('regulatory_task', []);
};

const snapshot = Effect.fnUntraced(function* (read: CallerRead) {
	const got = yield* read({
		entries: {
			collection: 'leave_catalog_entry',
			select: {
				reference: true,
				occurred_on: true,
				activity: true,
				days: true,
				from: true,
				to: true,
				amount: true,
				half_day_start: true,
				half_day_end: true,
				incurred_on: true,
				label: true,
				facts: true,
				company_id: true,
				employment_id: true,
				catalog_id: true,
				payslip_id: true
			},
			all: true
		},
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
			orderBy: [{ due_on: 'asc' }, { code: 'asc' }],
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
			orderBy: { duty_code: 'asc' },
			all: true
		}
	});
	tables.set('leave_catalog_entry', [...got.entries.rows]);
	tables.set('regulatory_task', [...got.tasks.rows]);
	tables.set('obligation', [...got.obligations.rows]);
});

/** Seed the actual pre-image, then perform the event's writes through the native caller. */
const update = Effect.fnUntraced(function* (set: Row, available: number, day: string) {
	const contract = tables.get('employment_contract')?.[0];
	assert.ok(contract);
	const before = Object.fromEntries(Object.keys(set).map((key) => [key, contract[key] ?? null]));
	Object.assign(contract, set, { before });
	yield* world(tables).withRead((read) =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* runBehaviours({
				collection: 'employment_contract',
				action: 'updated',
				row: { ...contract },
				day,
				subjects: [{ company_id: COMPANY, employment_id: EMPLOYMENT, employee_id: PERSON }],
				leave_balances: [{ code: 'ANNUAL_LEAVE', available }],
				fields: () => Effect.succeed({}),
				versionFor: yield* versionLookup(read),
				read,
				act: t.bodyActs(t.admin)
			});
			yield* snapshot(read);
		})
	);
});
const exit = (to: string, ground: string) => ({
	effective_range: { from: START, to },
	exit_ground: ground,
	exit_facts: {}
});
const encashed = () =>
	(tables.get('leave_catalog_entry') ?? []).map((row) => [
		row['reference'],
		moneyNumber(row['days']),
		row['occurred_on']
	]);
const tasks = () =>
	(tables.get('regulatory_task') ?? []).map((row) => [
		row['state'],
		row['due_on'],
		isJsonObject(row['facts']) ? row['facts']['exit_key'] : undefined
	]);

it.effect(
	'a moved exit withdraws its unpaid encashment and open tasks and raises them for the new day',
	Effect.fnUntraced(function* () {
		reset();
		yield* update(exit('2026-03-31', 'RESIGNATION'), 5, '2026-03-31');
		assert.deepEqual(encashed(), [
			[`exit:${EMPLOYMENT}:ANNUAL_LEAVE:2026-03-31/RESIGNATION`, 5, '2026-03-31']
		]);
		assert.deepEqual(tasks(), [['OPEN', '2026-04-07', '2026-03-31/RESIGNATION']]);
		yield* update(exit('2026-04-30', 'RETRENCHMENT'), 6, '2026-04-30');
		assert.deepEqual(encashed(), [
			[`exit:${EMPLOYMENT}:ANNUAL_LEAVE:2026-04-30/RETRENCHMENT`, 6, '2026-04-30']
		]);
		assert.deepEqual(tasks(), [
			['DISMISSED', '2026-04-07', '2026-03-31/RESIGNATION'],
			['OPEN', '2026-05-07', '2026-04-30/RETRENCHMENT']
		]);
		yield* update({ exit_facts: { notice_served: true } }, 6, '2026-04-30');
		assert.equal(encashed().length, 1);
		assert.equal(tasks().filter(([state]) => state === 'OPEN').length, 1);
	})
);

it.effect(
	'an undone exit reopens the contract: its unpaid effects go, a paid encashment stays',
	Effect.fnUntraced(function* () {
		reset();
		yield* update(exit('2026-03-31', 'RESIGNATION'), 5, '2026-03-31');
		const paid = tables.get('leave_catalog_entry')?.[0];
		assert.ok(paid);
		const runId = fixtureId('paid-run');
		const slipId = fixtureId('s1');
		tables.set('payroll_run', [
			{
				id: runId,
				company_id: COMPANY,
				settings_id: settings['id'],
				period: '2026-03',
				kind: 'OFF_CYCLE'
			}
		]);
		tables.set('payslip', [
			{
				id: slipId,
				payroll_run_id: runId,
				employment_id: EMPLOYMENT,
				terms_through: '2026-03-31',
				currency: 'SGD',
				gross: 0,
				total_deductions: 0,
				net: 0,
				employer_cost: 0,
				status: 'PAID'
			}
		]);
		paid['payslip_id'] = slipId;
		yield* update(
			{ effective_range: { from: START, to: null }, exit_ground: null, exit_facts: null },
			0,
			'2026-04-02'
		);
		assert.deepEqual(encashed(), [
			[`exit:${EMPLOYMENT}:ANNUAL_LEAVE:2026-03-31/RESIGNATION`, 5, '2026-03-31']
		]);
		assert.deepEqual(tasks(), [['DISMISSED', '2026-04-07', '2026-03-31/RESIGNATION']]);
		reset();
		yield* update(exit('2026-03-31', 'RESIGNATION'), 5, '2026-03-31');
		yield* update(
			{ effective_range: { from: START, to: null }, exit_ground: null, exit_facts: null },
			0,
			'2026-04-02'
		);
		assert.deepEqual(encashed(), []);
	})
);

it.effect(
	'a deleted run withdraws the open obligations and tasks it raised, so a recreated run raises them once',
	Effect.fnUntraced(function* () {
		reset();
		const run1 = fixtureId('run-1'),
			run2 = fixtureId('run-2');
		const obligation = (
			id: string,
			trigger_ref: string,
			state: string,
			amount_settled: number | null,
			occurrence_key: string
		) => ({
			id: fixtureId(id),
			company_id: COMPANY,
			settings_id: settings['id'],
			duty_code: id,
			authority: 'Test',
			triggered_on: '2026-03-01',
			due_on: '2026-03-31',
			currency: 'SGD',
			trigger_ref,
			state,
			amount_settled,
			occurrence_key
		});
		tables.set('obligation', [
			obligation('o1', run1, 'OPEN', null, `PIT:${run1}`),
			obligation('o2', run1, 'FULFILLED', 5, `SI:${run1}`),
			obligation('o3', run2, 'OPEN', null, `PIT:${run2}`)
		]);
		const task = (id: string, state: string, occurrence_key: string) => ({
			id: fixtureId(id),
			company_id: COMPANY,
			settings_id: settings['id'],
			code: id,
			title: id,
			subject_collection: 'payroll_run',
			subject_id: run1,
			trigger_ref: run1,
			triggered_on: '2026-03-01',
			due_on: '2026-03-31',
			state,
			occurrence_key
		});
		tables.set('regulatory_task', [
			task('t1', 'OPEN', `RETURN:${COMPANY}:2026-03`),
			task('t2', 'DONE', `FILED:${COMPANY}:2026-03`)
		]);
		yield* world(tables).withRead((read) =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* runBehaviours({
					collection: 'payroll_run',
					action: 'deleted',
					row: { id: run1, company_id: COMPANY, period: '2026-03', kind: 'OFF_CYCLE' },
					day: '2026-03-01',
					subjects: [{ company_id: COMPANY, employment_id: null, employee_id: null }],
					fields: () => Effect.succeed({}),
					versionFor: yield* versionLookup(read),
					read,
					act: t.bodyActs(t.admin)
				});
				yield* snapshot(read);
			})
		);
		assert.deepEqual(
			tables.get('obligation')?.map((row) => row['id']),
			[fixtureId('o2'), fixtureId('o3')]
		);
		assert.deepEqual(
			tables.get('regulatory_task')?.map((row) => [row['id'], row['state'], row['occurrence_key']]),
			[
				[fixtureId('t1'), 'DISMISSED', `RETURN:${COMPANY}:2026-03:withdrawn:2026-03-01`],
				[fixtureId('t2'), 'DONE', `FILED:${COMPANY}:2026-03`]
			]
		);
	})
);
