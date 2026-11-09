// A sealed contract adds its exit answers in the save that ends it, as Malaysia's native exit ground already does:
// Indonesia's exit duties read `termination_cause` from the jurisdiction facts. Facts it already holds stand.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { pack, uuid, workspace } from './kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
const terms = {
	rate: { amount: 11_000_000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const base = pack(
	'ID',
	'Asia/Jakarta',
	terms,
	{ work_region: 'Provinsi Aceh/Kabupaten Aceh Barat' },
	[],
	[],
	'2026-06-15'
);
const seed = {
	...base,
	entity_profile_version: (base.entity_profile_version ?? []).map((row) => ({
		...row,
		entity_extension_data: { risk_class: 'I' }
	})),
	employee_contract: (base.employee_contract ?? []).map((row) => ({
		...row,
		effective_range: { from: '2026-01-01', to: null },
		payroll: { date_of_birth: '1990-01-01', gender: 'FEMALE', marital_status: 'MARRIED' }
	}))
};
const held = (t: Kit) =>
	t
		.storedQuery({ employee_contract: { where: { id: { eq: CONTRACT } }, limit: 1 } })
		.pipe(
			Effect.map(
				({ employee_contract }) => employee_contract.rows[0]?.employee_extension_data ?? {}
			)
		);
const save = (t: Kit, facts: Readonly<Record<string, string>>, to: string | null = '2026-06-30') =>
	held(t).pipe(
		Effect.andThen((extension) =>
			t.as(t.admin).act('employee_contract.update', [
				{
					target: CONTRACT,
					set: {
						employee_extension_data: { ...extension, ...facts },
						...(to === null
							? {}
							: { effective_range: { from: PlainDate('2026-01-01'), to: PlainDate(to) } })
					}
				}
			])
		)
	);
const reports = (t: Kit) =>
	t
		.storedQuery({ obligation: { limit: 100 } })
		.pipe(
			Effect.map(({ obligation }) =>
				obligation.rows.filter((row) =>
					String(row.occurrence_key).startsWith('TERMINATION_REPORT:')
				)
			)
		);
const live = () => workspace({ seed, now: '2026-07-01T02:00:00.000Z' });

describe('exit answers on a sealed contract', () => {
	it.live('the save that ends it states the termination cause, and the exit duty follows', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* save(t, { termination_cause: 'EFFICIENCY_ACTUAL_LOSS' });
			yield* t.runDue();
			assert.equal((yield* reports(t)).length, 1);
		}).pipe(Effect.provide(live()))
	);

	it.live('a save that does not end it cannot add one', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* Effect.flip(
				save(t, { termination_cause: 'EFFICIENCY_ACTUAL_LOSS' }, null)
			);
			assert.match(String(refused), /exit answers/);
		}).pipe(Effect.provide(live()))
	);

	it.live('the ending save cannot rewrite a fact the version holds', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* save(t, { termination_cause: 'EFFICIENCY_ACTUAL_LOSS' });
			const refused = yield* Effect.flip(
				save(t, { termination_cause: 'VOLUNTARY_RESIGNATION' }, '2026-07-31')
			);
			assert.match(String(refused), /exit answers/);
		}).pipe(Effect.provide(live()))
	);
});
