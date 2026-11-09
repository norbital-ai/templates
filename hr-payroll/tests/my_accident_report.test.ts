// A reportable employment injury is a WORKPLACE_ACCIDENT case; the effect keys on the case kind, not on an undeclared
// boolean. PERKESO's 48 hours from notice is expressed as the next two calendar days from opened_on.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import type { JsonObject } from '../src/lib/payroll_engine/foundation.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, catalogRow, pack, workspace } from './kit.ts';

const CONTRACT = idOf('employee_contract', '11111111-1111-4111-8111-000000000006');
const terms = {
	rate: { amount: 5000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const seed = pack('MY', 'Asia/Kuala_Lumpur', terms, {}, [], [], '2026-06-15');
const ACCIDENT = idOf(
	'workplace_case_catalog',
	catalogRow(seed, 'workplace_case_catalog', 'WORKPLACE_ACCIDENT')
);
const OTHER = idOf(
	'workplace_case_catalog',
	catalogRow(seed, 'workplace_case_catalog', 'FLEXIBLE_WORKING_REQUEST')
);
const live = workspace({ seed, now: '2026-06-20T02:00:00.000Z' });
const file = (t: Kit, catalog_id: typeof ACCIDENT, kind: string, inputs: JsonObject) =>
	t.as(t.admin).act('workplace_case_catalog_entry.create', [
		{
			catalog_id,
			entity_id: ENTITY,
			employment_id: CONTRACT,
			kind,
			opened_on: PlainDate('2026-06-10'),
			inputs
		}
	]);
const reports = (t: Kit) =>
	t.storedQuery({ obligation: { limit: 100 } }).pipe(
		Effect.map(({ obligation }) =>
			obligation.rows.filter((row) => String(row.occurrence_key).startsWith('MY:SOCSO_ACCIDENT_REPORT:'))
		)
	);

describe('MY SOCSO accident report', () => {
	it('a workplace accident raises one report due two days after notice', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* file(t, ACCIDENT, 'WORKPLACE_ACCIDENT', { accident_type: 'INDUSTRIAL' });
			yield* t.runDue();
			const raised = yield* reports(t);
			assert.equal(raised.length, 1);
			assert.equal(String(raised[0]?.due_on), '2026-06-12');
			assert.equal(String(raised[0]?.title), 'Report a workplace accident to SOCSO');
		}).pipe(Effect.provide(live))
	);
	it('a commuting accident counts, and each case has its own report', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* file(t, ACCIDENT, 'WORKPLACE_ACCIDENT', { accident_type: 'COMMUTING' });
			yield* file(t, ACCIDENT, 'WORKPLACE_ACCIDENT', { accident_type: 'EMERGENCY' });
			yield* t.runDue();
			assert.equal((yield* reports(t)).length, 2);
		}).pipe(Effect.provide(live))
	);
	it('another case kind raises no accident report', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* file(t, OTHER, 'FLEXIBLE_WORKING_REQUEST', {});
			yield* t.runDue();
			assert.equal((yield* reports(t)).length, 0);
		}).pipe(Effect.provide(live))
	);
	it('an accident without its type is refused', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* Effect.flip(
				file(t, ACCIDENT, 'WORKPLACE_ACCIDENT', {})
			);
			assert.match(String(refused), /CASE_INPUTS_REQUIRED|accident_type/);
		}).pipe(Effect.provide(live))
	);
});
