// The statutory headcount is distinct people in force, not contract versions: a renewal of one employee must not push
// an employer over ten.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { ENTITY, pack, sealEvents, uuid, workspace } from './kit.ts';

const terms = {
	rate: { amount: 30_000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'ORDINARY',
	work_classification: 'EA_COVERED',
	residency_status: 'RESIDENT',
	wage_payment_method: 'BANK',
	allowances: {}
};
const base = pack('TH', 'Asia/Bangkok', terms, {}, [], [], '2026-06-15');
const contract = base.employee_contract?.[0];
assert.ok(contract !== undefined);
const extras = (count: number) =>
	Array.from({ length: count }, (_, index) => ({
		...contract,
		id: uuid(100 + index),
		employee_id: uuid(200 + index),
		employee_number: `T${index + 1}`,
		effective_range: { from: '2026-01-01', to: null },
		status: 'SEALED' as const
	}));
const withPeople = (people: number) => ({
	...base,
	employee_profile: [
		...(base.employee_profile ?? []),
		...Array.from({ length: people - 1 }, (_, index) => ({
			id: uuid(200 + index),
			name: `Person ${index + 1}`
		}))
	],
	employee_contract: [contract, ...extras(people - 1)]
});
const obligations = (people: number) =>
	Effect.gen(function* () {
		const t = yield* TestWorkspace;
		yield* sealEvents(t, '2026-04-01', []);
		yield* t.runDue();
		const { obligation } = yield* t.storedQuery({ obligation: { limit: 300 } });
		return obligation.rows;
	}).pipe(Effect.provide(workspace({ seed: withPeople(people), now: '2026-06-20T02:00:00.000Z' })));
const count = (rows: readonly { occurrence_key: string }[], prefix: string) =>
	rows.filter((row) => String(row.occurrence_key).startsWith(prefix)).length;
const employee = String(contract.employee_id);
const person = (rows: readonly { occurrence_key: string }[], code: string) =>
	count(rows, `${code}:${ENTITY}:${employee}`);

describe('TH statutory headcount', () => {
	it.live('nine distinct employees plus a renewal stay below ten', () =>
		Effect.gen(function* () {
			const rows = yield* obligations(9);
			assert.equal(count(rows, 'WORK_RULES:'), 0);
			assert.equal(person(rows, 'SSO_REGISTRATION'), 1);
			assert.equal(person(rows, 'PDPA_PRIVACY_NOTICE'), 1);
			assert.equal(person(rows, 'PDPA_SENSITIVE_DATA_CONSENT'), 1);
			assert.equal(person(rows, 'EMPLOYEE_REGISTER'), 0);
		})
	);
	it.live('ten distinct employees plus a renewal raise work rules and employer duties once', () =>
		Effect.gen(function* () {
			const rows = yield* obligations(10);
			assert.equal(count(rows, 'WORK_RULES:'), 1);
			assert.equal(count(rows, 'SKILL_DEVELOPMENT_REGISTRATION:'), 0);
			assert.equal(person(rows, 'SSO_REGISTRATION'), 1);
			assert.equal(person(rows, 'PDPA_PRIVACY_NOTICE'), 1);
			assert.equal(person(rows, 'PDPA_SENSITIVE_DATA_CONSENT'), 1);
			assert.equal(person(rows, 'EMPLOYEE_REGISTER'), 1);
		})
	);
});
