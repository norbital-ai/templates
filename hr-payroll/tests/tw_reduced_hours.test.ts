// 因應景氣影響勞雇雙方協商減少工時應行注意事項: the written agreement is notified, and each extension needs renewed
// consent and its own notice. A description-only edit or a shortening raises nothing.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, catalogRow, pack, workspace } from './kit.ts';

const terms = {
	rate: { amount: 30_900, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const seed = pack('TW', 'Asia/Taipei', terms, {}, [], [], '2027-01-15');
const CATALOG = idOf('work_event_catalog', catalogRow(seed, 'work_event_catalog', 'REDUCED_WORK_AGREEMENT'));
const live = workspace({ seed, now: '2027-01-20T02:00:00.000Z' });
const notices = (t: Kit) =>
	t.storedQuery({ obligation: { limit: 100 } }).pipe(
		Effect.map(({ obligation }) =>
			obligation.rows.filter((row) => String(row.occurrence_key).startsWith('REDUCED_HOURS_NOTICE:'))
		)
	);
const create = (t: Kit, to = '2027-01-31') =>
	t.as(t.admin).act('work_event.create', [
		{
			entity_id: ENTITY,
			catalog_id: CATALOG,
			from: PlainDate('2027-01-04'),
			to: PlainDate(to),
			description: 'Reduced hours agreement'
		}
	]);

describe('TW reduced-hours notice', () => {
	it('notifies the agreement and each extension, once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const created = yield* create(t);
			const id = created.records.find((row) => row.model === 'work_event')?.id;
			assert.ok(id !== undefined);
			yield* t.runDue();
			const first = yield* notices(t);
			assert.equal(first.length, 1);
			assert.equal(String(first[0]?.due_on), '2027-01-04');
			assert.equal(String(first[0]?.title), 'Reduced-hours agreement notified');
			yield* t.as(t.admin).act('work_event.update', [
				{ target: id, set: { to: PlainDate('2027-02-28') } }
			]);
			yield* t.runDue();
			const extended = yield* notices(t);
			assert.equal(extended.length, 2);
			const second = extended.find((row) => String(row.occurrence_key).endsWith(':2027-02-28'));
			assert.ok(second !== undefined);
			assert.equal(String(second.due_on), '2027-02-01');
			assert.equal(String(second.title), 'Reduced-hours agreement extension notified');
			yield* t.as(t.admin).act('work_event.update', [
				{ target: id, set: { description: 'Description only' } }
			]);
			yield* t.runDue();
			assert.equal((yield* notices(t)).length, 2);
			yield* t.as(t.admin).act('work_event.update', [
				{ target: id, set: { to: PlainDate('2027-02-15') } }
			]);
			yield* t.runDue();
			assert.equal((yield* notices(t)).length, 2);
		}).pipe(Effect.provide(live))
	);
	it('keeps the full-time monthly minimum floor and insurance for the reduced month', () => {
		const event = (seed.work_event_catalog ?? []).find(
			(row) => row.code === 'REDUCED_WORK_AGREEMENT'
		);
		assert.ok(event !== undefined);
		const payment = (event as { events?: { 'work.payment'?: Record<string, unknown> } }).events?.[
			'work.payment'
		];
		assert.equal(payment?.['monthly_minimum_wage_floor'], true);
		assert.equal(payment?.['insurance_and_pension_retained'], true);
	});
});
