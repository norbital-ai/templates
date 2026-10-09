/**
 * A departure moved or undone (a withdrawn resignation) re-evaluates what the exit raised, through the canonical
 * behaviours: `retract-exit-effects` withdraws the unpaid exit encashment and dismisses the open exit tasks keyed to
 * the exit as it stood, and `encash-leave-on-exit` / `raise-tasks` raise them again for the exit as it now stands. A
 * paid encashment stays (its days were cashed); nothing is raised twice.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { Act } from '@norbital-ai/bolt';
import { runBehaviours, versionLookup } from '../src/lib/payroll_engine/behaviour_runner.ts';
import type { HostRead } from '../src/lib/payroll_engine/foundation.ts';

type Row = Record<string, unknown>;
const [settings] = JSON.parse(
	readFileSync(
		resolve(process.cwd(), 'seed/jurisdiction/SG/version_4/jurisdiction_settings.json'),
		'utf8'
	)
) as Row[];
const COMPANY = 'c1';
const START = '2020-01-01';

const tables = new Map<string, Row[]>();
const reset = () => {
	tables.clear();
	tables.set('jurisdiction_settings', [
		{ ...settings, effective_range: { from: '2020-01-01', to: null }, approval_id: null }
	]);
	tables.set('entity', [
		{ id: COMPANY, name: 'Omni', settings_code: 'SG', facts: {}, approval_id: null }
	]);
	tables.set('employment_contract', [
		{
			id: 'k1',
			company_id: COMPANY,
			employee_id: 'p1',
			approval_id: null,
			effective_range: { from: START, to: null },
			exit_ground: null,
			exit_facts: null,
			facts: {}
		}
	]);
	tables.set('employment_profile', [{ id: 'p1', facts: {} }]);
	tables.set('leave_catalog', [
		{
			id: 'al',
			settings_id: settings!.id,
			code: 'ANNUAL_LEAVE',
			unit: 'DAY',
			encash_on_exit: true,
			entitlement: { days: '14.0' }
		}
	]);
	tables.set('leave_catalog_entry', []);
	tables.set('rule_set', [
		{
			settings_id: settings!.id,
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

const matches = (row: Row, where: Row): boolean =>
	Object.entries(where).every(([key, spec]) =>
		Object.entries(spec as Row).every(([op, operand]) => {
			const value = row[key];
			if (op === 'eq') return value === operand;
			if (op === 'in') return Array.isArray(operand) && operand.includes(value);
			if (op === 'isNull') return operand ? value == null : value != null;
			if (op === 'gte') return value != null && String(value) >= String(operand);
			if (op === 'lte') return value != null && String(value) <= String(operand);
			throw new Error(`fixture reader: unsupported operator ${op}`);
		})
	);
const read = (async (collection: string, query: { where?: Row }) => ({
	rows: (tables.get(collection) ?? []).filter((row) => matches(row, query.where ?? {}))
})) as unknown as HostRead;

let ids = 0;
// An act as the host's: a create adds rows, an update merges its `set`, a delete removes its targets.
const act = (async (callable: string, input: Row | readonly Row[]) => {
	const [collection, verb] = callable.split('.') as [string, string];
	const rows = tables.get(collection)!;
	for (const data of Array.isArray(input) ? input : [input]) {
		const targets = new Set([data['target']].flat().map(String));
		if (verb === 'create')
			rows.push({
				id: `${collection}-${++ids}`,
				company_id: COMPANY,
				// the model's default
				...(collection === 'regulatory_task' ? { state: 'OPEN' } : {}),
				...data
			});
		else if (verb === 'delete')
			tables.set(
				collection,
				tables.get(collection)!.filter((row) => !targets.has(String(row['id'])))
			);
		else
			for (const row of rows)
				if (targets.has(String(row['id']))) Object.assign(row, data['set'] as Row);
	}
	return { kind: 'committed', output: undefined, records: [] };
}) as unknown as Act;

/** The contract written with `set` and the update event the tap would run, on its day, with `available` days. */
const update = async (set: Row, available: number, day: string) => {
	const contract = tables.get('employment_contract')![0]!;
	const before = Object.fromEntries(Object.keys(set).map((key) => [key, contract[key] ?? null]));
	Object.assign(contract, set, { before });
	await runBehaviours({
		collection: 'employment_contract',
		action: 'updated',
		row: { ...contract },
		day,
		subjects: [{ company_id: COMPANY, employment_id: 'k1', employee_id: 'p1' }],
		leave_balances: [{ code: 'ANNUAL_LEAVE', available }],
		fields: async () => ({}),
		versionFor: versionLookup(read),
		read,
		act
	});
};
const exit = (to: string, ground: string) => ({
	effective_range: { from: START, to },
	exit_ground: ground,
	exit_facts: {}
});
const encashed = () =>
	tables
		.get('leave_catalog_entry')!
		.map((row) => [row['reference'], row['days'], row['occurred_on']]);
const tasks = () =>
	tables
		.get('regulatory_task')!
		.map((row) => [row['state'], row['due_on'], (row['facts'] as Row | undefined)?.['exit_key']]);

test('a moved exit withdraws its unpaid encashment and open tasks and raises them for the new day', async () => {
	reset();
	await update(exit('2026-03-31', 'RESIGNATION'), 5, '2026-03-31');
	assert.deepEqual(encashed(), [['exit:k1:ANNUAL_LEAVE:2026-03-31/RESIGNATION', 5, '2026-03-31']]);
	assert.deepEqual(tasks(), [['OPEN', '2026-04-07', '2026-03-31/RESIGNATION']]);
	// a month later, on another ground: the balance (read without the withdrawn encashment) is 6
	await update(exit('2026-04-30', 'RETRENCHMENT'), 6, '2026-04-30');
	assert.deepEqual(encashed(), [['exit:k1:ANNUAL_LEAVE:2026-04-30/RETRENCHMENT', 6, '2026-04-30']]);
	assert.deepEqual(tasks(), [
		['DISMISSED', '2026-04-07', '2026-03-31/RESIGNATION'],
		['OPEN', '2026-05-07', '2026-04-30/RETRENCHMENT']
	]);
	// the same exit written again raises nothing more
	await update({ exit_facts: { notice_served: true } }, 6, '2026-04-30');
	assert.equal(encashed().length, 1);
	assert.equal(tasks().filter(([state]) => state === 'OPEN').length, 1);
});

test('an undone exit reopens the contract: its unpaid effects go, a paid encashment stays', async () => {
	reset();
	await update(exit('2026-03-31', 'RESIGNATION'), 5, '2026-03-31');
	// the final run paid it
	tables.get('leave_catalog_entry')![0]!['payslip_id'] = 's1';
	await update(
		{ effective_range: { from: START, to: null }, exit_ground: null, exit_facts: null },
		0,
		'2026-04-02'
	);
	assert.deepEqual(encashed(), [['exit:k1:ANNUAL_LEAVE:2026-03-31/RESIGNATION', 5, '2026-03-31']]);
	assert.deepEqual(tasks(), [['DISMISSED', '2026-04-07', '2026-03-31/RESIGNATION']]);
	// unpaid, it is withdrawn
	reset();
	await update(exit('2026-03-31', 'RESIGNATION'), 5, '2026-03-31');
	await update(
		{ effective_range: { from: START, to: null }, exit_ground: null, exit_facts: null },
		0,
		'2026-04-02'
	);
	assert.deepEqual(encashed(), []);
});

test('a deleted run withdraws the open obligations and tasks it raised, so a recreated run raises them once', async () => {
	reset();
	tables.set('obligation', [
		{
			id: 'o1',
			trigger_ref: 'run-1',
			state: 'OPEN',
			amount_settled: null,
			occurrence_key: 'PIT:run-1'
		},
		{
			id: 'o2',
			trigger_ref: 'run-1',
			state: 'FULFILLED',
			amount_settled: 5,
			occurrence_key: 'SI:run-1'
		},
		{
			id: 'o3',
			trigger_ref: 'run-2',
			state: 'OPEN',
			amount_settled: null,
			occurrence_key: 'PIT:run-2'
		}
	]);
	tables.set('regulatory_task', [
		{ id: 't1', subject_id: 'run-1', state: 'OPEN', occurrence_key: `RETURN:${COMPANY}:2026-03` },
		{ id: 't2', subject_id: 'run-1', state: 'DONE', occurrence_key: `FILED:${COMPANY}:2026-03` }
	]);
	await runBehaviours({
		collection: 'payroll_run',
		action: 'deleted',
		row: {
			id: 'run-1',
			company_id: COMPANY,
			period: '2026-03',
			kind: 'OFF_CYCLE',
			approval_id: null
		},
		day: '2026-03-01',
		subjects: [{ company_id: COMPANY, employment_id: null, employee_id: null }],
		fields: async () => ({}),
		versionFor: versionLookup(read),
		read,
		act
	});
	assert.deepEqual(
		tables.get('obligation')!.map((row) => row['id']),
		['o2', 'o3']
	);
	assert.deepEqual(
		tables.get('regulatory_task')!.map((row) => [row['id'], row['state'], row['occurrence_key']]),
		[
			['t1', 'DISMISSED', `RETURN:${COMPANY}:2026-03:withdrawn:2026-03-01`],
			['t2', 'DONE', `FILED:${COMPANY}:2026-03`]
		]
	);
});
