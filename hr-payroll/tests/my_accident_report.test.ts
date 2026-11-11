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

describe('MY SOCSO accident report', () => {
	it.live('an accident without its type is refused', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* Effect.flip(file(t, ACCIDENT, 'WORKPLACE_ACCIDENT', {}));
			assert.match(String(refused), /CASE_INPUTS_REQUIRED|accident_type/);
		}).pipe(Effect.provide(live))
	);
});
