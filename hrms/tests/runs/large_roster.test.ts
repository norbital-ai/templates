// A month of rosters for a whole workforce: the run seals more roster days than a database list holds in one read
// (Bolt caps an `in` list at 1,000 values), and it still runs, linking every day it priced.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { ENTITY, WORK, pack, storedQuery, uuid, workspace } from '../kit.ts';

const MONTH = '2026-03';
const days = Array.from({ length: 31 }, (_, at) => `${MONTH}-${String(at + 1).padStart(2, '0')}`);
const PEOPLE = 34; // 34 × 31 = 1,054 roster days
const base = pack(
	'MY',
	'Asia/Kuala_Lumpur',
	{
		rate: { amount: 3120, unit: 'MONTHLY' },
		statutory_work_category: 'MANUAL_LABOUR',
		work_classification: 'EA_COVERED',
		residency_status: 'CITIZEN',
		wage_payment_method: 'BANK',
		allowances: {}
	},
	{},
	days.map((date) => ({ date, shift: WORK, hours: 8 })),
	[]
);
const [profile] = base.employee_profile ?? [];
const [stint] = base.employment ?? [];
const [terms] = base.contract_terms ?? [];
const [parameters] = base.statutory_parameters ?? [];
const [day] = base.roster_entry ?? [];
const people = Array.from({ length: PEOPLE - 1 }, (_, at) => 1000 + at * 10);
const seed = {
	...base,
	sys_user: [
		...(base.sys_user ?? []),
		...people.map((n) => ({
			id: uuid(n),
			name: `P${n}`,
			email: `p${n}@example.test`,
			kind: 'staff'
		}))
	],
	employee_profile: [
		...(base.employee_profile ?? []),
		...people.map((n) => ({ ...profile, id: uuid(n + 1), user_id: uuid(n), name: `P${n}` }))
	],
	employee_balance: [
		...(base.employee_balance ?? []),
		...people.map((n) => ({ id: uuid(n + 2), employee_id: uuid(n + 1), account: {} }))
	],
	employment: [
		...(base.employment ?? []),
		...people.map((n) => ({
			...stint,
			id: uuid(n + 3),
			employee_id: uuid(n + 1),
			employee_number: `W${n}`
		}))
	],
	contract_terms: [
		...(base.contract_terms ?? []),
		...people.map((n) => ({ ...terms, id: uuid(n + 4), employment_id: uuid(n + 3) }))
	],
	statutory_parameters: [
		...(base.statutory_parameters ?? []),
		...people.map((n) => ({ ...parameters, id: uuid(n + 5), employment_id: uuid(n + 3) }))
	],
	roster_entry: [
		...(base.roster_entry ?? []),
		...people.flatMap((n) =>
			days.map((date, at) => ({
				...day,
				id: uuid(100000 + n * 40 + at),
				employment_id: uuid(n + 3),
				work_date: date
			}))
		)
	]
};

describe('a run over a whole month of rosters', () => {
	it.live('seals more than a thousand roster days in one run', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* (yield* t.as(t.admin)).act({
				'payroll_run.create': [{ entity_id: ENTITY, period: MONTH, kind: 'ON_CYCLE' }]
			});
			assert.deepEqual((yield* t.run_due()).failed, []);
			const { roster_entry, payslip } = yield* storedQuery(t, {
				roster_entry: {
					where: { payroll_run_id: { is_null: false } },
					fields: ['id'],
					limit: 5000
				},
				payslip: { fields: ['id'], limit: 100 }
			});
			assert.equal(payslip.rows.length, PEOPLE);
			assert.equal(roster_entry.rows.length, PEOPLE * days.length);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-04-05T02:00:00.000Z' })))
	);
});
