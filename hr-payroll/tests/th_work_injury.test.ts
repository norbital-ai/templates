// A work-injury entry needs its first day.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, pack, storedQuery, workspace, leaveCreate } from './kit.ts';

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
const base = pack('TH', 'Asia/Bangkok', terms, {}, [], [], '2026-03-15');
const contract = base.employee_contract?.[0];
const injury = base.leave_catalog?.find((row) => row.code === 'WORK_INJURY_LEAVE');
assert.ok(contract !== undefined && injury !== undefined);
const CONTRACT = idOf('employee_contract', String(contract.id));
const CATALOG = idOf('leave_catalog', String(injury.id));
const live = workspace({ seed: base, now: '2026-03-20T02:00:00.000Z' });
const whole = (date: string) => [
	{ date: PlainDate(date), part: 'AM' as const },
	{ date: PlainDate(date), part: 'PM' as const }
];

describe('a work-injury leave entry', () => {
	it.live('without a day is refused', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			const refused = yield* Effect.flip(
				admin.act({
					'leave_catalog_entry.create': [
						{ entity_id: ENTITY, employment_id: CONTRACT, catalog_id: CATALOG }
					]
				})
			);
			assert.ok(refused._tag === 'ActRefused');
			assert.equal(refused.key, 'errors.leave_entry_needs_day');
		}).pipe(Effect.provide(live))
	);
	it.live('cannot have its only day deleted', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			yield* admin.act({
				'leave_catalog_entry.create': [
					leaveCreate({
						entity_id: ENTITY,
						employment_id: CONTRACT,
						catalog_id: CATALOG,
						days: whole('2026-03-01')
					})
				]
			});
			const [entry] = (yield* storedQuery(t, { leave_catalog_entry: { limit: 1 } }))
				.leave_catalog_entry.rows;
			assert.ok(entry !== undefined);
			const { leave_catalog_entry_day } = yield* storedQuery(t, {
				leave_catalog_entry_day: {
					where: { leave_entry_id: { eq: entry.id } },
					fields: ['id', 'revision'],
					limit: 10
				}
			});
			const ids = leave_catalog_entry_day.rows;
			const refused = yield* Effect.flip(
				admin.act({
					'leave_catalog_entry.update': [
						{ target: entry, set: { leave_catalog_entry_day: { delete: ids } } }
					]
				})
			);
			assert.ok(refused._tag === 'ActRefused');
			assert.equal(refused.key, 'errors.leave_entry_needs_day');
		}).pipe(Effect.provide(live))
	);
});
