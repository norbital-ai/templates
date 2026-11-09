// 職業安全衛生法 §37(2): a death, a hospitalising injury or three-or-more injured workers is reportable within eight
// hours. The workplace case carries the counts; the catalog code, not the free-text kind, decides the duty.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import type { JsonObject } from '../src/lib/payroll_engine/foundation.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, catalogRow, pack, uuid, workspace } from './kit.ts';

const CASE = 'OCCUPATIONAL_ACCIDENT';
type Severity =
	| 'DEATH'
	| 'PERMANENT_TOTAL_DISABILITY'
	| 'SERIOUS_INJURY'
	| 'MINOR_INJURY'
	| 'NEAR_MISS'
	| 'PROPERTY_DAMAGE'
	| 'N/A';
const CONTRACT = idOf('employee_contract', uuid(6));
const terms = {
	rate: { amount: 40_000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const seed = pack('TW', 'Asia/Taipei', terms, {}, [], [], '2026-06-15');
const CATALOG = idOf('workplace_case_catalog', catalogRow(seed, 'workplace_case_catalog', CASE));
const inputs = (deaths: number, injured: number, hospitalised: number): JsonObject => ({
	accident_on: '2026-06-10',
	deaths,
	injured,
	hospitalised
});
const file = (t: Kit, values: JsonObject, severity: Severity = 'MINOR_INJURY') =>
	t.as(t.admin).act('workplace_case_catalog_entry.create', [
		{
			catalog_id: CATALOG,
			entity_id: ENTITY,
			employment_id: CONTRACT,
			kind: CASE,
			severity,
			opened_on: PlainDate('2026-06-10'),
			inputs: values
		}
	]);
const reports = (t: Kit, prefix = 'WORK_ACCIDENT_REPORT:') =>
	t
		.storedQuery({ obligation: { limit: 200 } })
		.pipe(
			Effect.map(({ obligation }) =>
				obligation.rows.filter((row) => String(row.occurrence_key).startsWith(prefix))
			)
		);
const live = workspace({ seed, now: '2026-06-20T02:00:00.000Z' });

describe('TW occupational accident report', () => {
	it.live('a death is one report, due on the opened date', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* file(t, inputs(1, 0, 0), 'DEATH');
			yield* t.runDue();
			const raised = yield* reports(t);
			assert.equal(raised.length, 1);
			assert.equal(String(raised[0]?.due_on), '2026-06-10');
		}).pipe(Effect.provide(live))
	);
	it.live('three injured or one hospitalisation is a report; two injured is not', () =>
		Effect.gen(function* () {
			const three = yield* TestWorkspace;
			yield* file(three, inputs(0, 3, 0));
			yield* three.runDue();
			assert.equal((yield* reports(three)).length, 1);
		}).pipe(Effect.provide(live))
	);
	it.live('two injured with one hospitalised is a report', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* file(t, inputs(0, 2, 1), 'SERIOUS_INJURY');
			yield* t.runDue();
			assert.equal((yield* reports(t)).length, 1);
		}).pipe(Effect.provide(live))
	);
	it.live('two injured and no hospitalisation is not reportable', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const created = yield* file(t, inputs(0, 2, 0));
			const id = created.records.find((row) => row.model === 'workplace_case_catalog_entry')?.id;
			assert.ok(id !== undefined);
			yield* t.runDue();
			assert.equal((yield* reports(t)).length, 0);
		}).pipe(Effect.provide(live))
	);
	it.live('a near miss is not reportable', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* file(t, inputs(0, 0, 0), 'NEAR_MISS');
			yield* t.runDue();
			assert.equal((yield* reports(t)).length, 0);
		}).pipe(Effect.provide(live))
	);
	it.live('a later hospitalisation raises one supplemental report, keyed by branch', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const created = yield* file(t, inputs(0, 2, 0));
			const id = created.records.find((row) => row.model === 'workplace_case_catalog_entry')?.id;
			assert.ok(id !== undefined);
			yield* t.runDue();
			assert.equal((yield* reports(t)).length, 0);
			yield* t
				.as(t.admin)
				.act('workplace_case_catalog_entry.update', [
					{ target: id, set: { inputs: inputs(0, 2, 1), description: 'later hospitalisation' } }
				]);
			yield* t.runDue();
			const updated = yield* reports(t, 'WORK_ACCIDENT_REPORT_UPDATED:');
			assert.equal(updated.length, 1);
			assert.match(String(updated[0]?.occurrence_key), /:hospitalised$/);
			yield* t
				.as(t.admin)
				.act('workplace_case_catalog_entry.update', [
					{ target: id, set: { description: 'description only' } }
				]);
			yield* t.runDue();
			assert.equal((yield* reports(t, 'WORK_ACCIDENT_REPORT_UPDATED:')).length, 1);
		}).pipe(Effect.provide(live))
	);
});
