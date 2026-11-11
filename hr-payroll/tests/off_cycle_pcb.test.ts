// A bonus paid off-cycle withholds the same PCB as one paid on-cycle, whichever run reaches the month first.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, pack, uuid, workspace } from './kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
const terms = (residency = 'CITIZEN') => ({
	rate: { amount: 8000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: residency,
	wage_payment_method: 'BANK',
	allowances: {}
});
const malaysia = (residency?: string, on = '2026-06-15') =>
	pack('MY', 'Asia/Kuala_Lumpur', terms(residency), {}, [], [], on);
type Seed = ReturnType<typeof malaysia>;

const itemId = (seed: Seed, code: string) => {
	const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
	const row = (seed.adhoc_catalog ?? []).find((r) => r.code === code && r.settings_id === version);
	assert.ok(row !== undefined, code);
	return idOf('adhoc_catalog', String(row.id));
};
const onCycle = (t: Kit, period: string) =>
	t
		.as(t.admin)
		.act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }])
		.pipe(Effect.andThen(t.runDue()));
const owed = (t: Kit, seed: Seed, on: string, quantity = 20_000) =>
	t.as(t.admin).act('adhoc_catalog_entry.create', [
		{
			entity_id: ENTITY,
			employment_id: CONTRACT,
			catalog_id: itemId(seed, 'BONUS'),
			description: 'Bonus',
			quantity,
			incurred_on: PlainDate(on)
		}
	]);
const offCycle = (t: Kit, seed: Seed, period: string, on: string, quantity?: number) =>
	Effect.gen(function* () {
		yield* owed(t, seed, on, quantity);
		const open = (yield* t.storedQuery({
			adhoc_catalog_entry: { where: { payroll_run_id: { isNull: true } }, limit: 1 }
		})).adhoc_catalog_entry.rows[0];
		assert.ok(open !== undefined);
		yield* t.as(t.admin).act('payroll_run.create', [
			{
				entity_id: ENTITY,
				period,
				kind: 'OFF_CYCLE',
				attaches: { adhoc: [idOf('adhoc_catalog_entry', open.id)] }
			}
		]);
		yield* t.runDue();
	});
/** What each on-cycle period withheld, and each off-cycle run. */
const withheld = (t: Kit) =>
	t.storedQuery({ payslip: { limit: 100 }, payroll_run: { limit: 100 } }).pipe(
		Effect.map((got) => {
			const pcb = (run: (typeof got.payroll_run.rows)[number]) => {
				const slip = got.payslip.rows.find((row) => row.payroll_run_id === run.id);
				const { statutory } = Schema.decodeUnknownSync(PayslipBreakdown)(slip?.breakdown);
				return statutory.find((row) => row.code === 'PCB')?.employee ?? 0;
			};
			const of = (kind: string) => got.payroll_run.rows.filter((run) => run.kind === kind);
			return {
				on: Object.fromEntries(of('ON_CYCLE').map((run) => [run.period, pcb(run)])),
				off: of('OFF_CYCLE').map(pcb)
			};
		})
	);
const months = (last: number) =>
	Array.from({ length: last }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);
const JUNE = workspace({ seed: malaysia(), now: '2026-06-20T02:00:00.000Z' });

describe('PCB on a bonus', () => {
	it.live('off-cycle, then the on-cycle run: the bonus alone, then a normal June', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			for (const period of months(5)) yield* onCycle(t, period);
			yield* offCycle(t, malaysia(), '2026-06', '2026-06-10');
			yield* onCycle(t, '2026-06');
			const { on, off } = yield* withheld(t);
			assert.equal(on['2026-06'], on['2026-05']);
			assert.equal(Number(off[0]) + Number(on['2026-06']), 4494.2);
		}).pipe(Effect.provide(JUNE))
	);

	it.live('the on-cycle run, then off-cycle: the same bonus, June not counted twice', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			for (const period of months(6)) yield* onCycle(t, period);
			yield* offCycle(t, malaysia(), '2026-06', '2026-06-10');
			const { on, off } = yield* withheld(t);
			assert.equal(on['2026-06'], on['2026-05']);
			assert.equal(Number(off[0]) + Number(on['2026-06']), 4494.2);
		}).pipe(Effect.provide(JUNE))
	);
});
