// What an off-cycle run may pay and what it refuses: never a deduction alone, never across a company move, and only in a
// period of the person's pay group. Malaysia's law pack is only the fixture.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { plain_date } from '../../src/lib/date.ts';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import { pay } from '../amendment_kit.ts';
import { ENTITY, catalogRow, pack, refusal, storedQuery, uuid, workspace } from '../kit.ts';
import { decimalText } from '../../src/lib/payroll_engine/money.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
const JUNE = '2026-06-20T02:00:00.000Z';
type Seed = ReturnType<typeof pack>;
/** One person on 4,800 a month from January, to `to` if named. */
const seedOf = (to: string | null = null): Seed => {
	const seed = pack(
		'MY',
		'Asia/Kuala_Lumpur',
		{
			rate: { amount: 4800, unit: 'MONTHLY' },
			statutory_work_category: 'NON_MANUAL',
			work_classification: 'EA_COVERED',
			residency_status: 'CITIZEN',
			wage_payment_method: 'BANK',
			allowances: {}
		},
		{},
		[],
		[],
		'2026-06-15'
	);
	return {
		...seed,
		employee_contract: (seed.employee_contract ?? []).map((row) => ({
			...row,
			effective_range: { from: '2026-01-01', to }
		}))
	};
};
const enter = (t: Kit, seed: Seed, item: string, quantity: number, on: string) =>
	Effect.flatMap(t.as(t.admin), (caller) =>
		caller.act({
			'adhoc_catalog_entry.create': [
				{
					entity_id: ENTITY,
					employment_id: CONTRACT,
					catalog_id: idOf('adhoc_catalog', catalogRow(seed, 'adhoc_catalog', item)),
					description: 'Correction',
					quantity: decimalText(quantity),
					incurred_on: plain_date(on)
				}
			]
		})
	);
/** The open entry goes out in its own run. */
const offCycle = (t: Kit, period: string) =>
	Effect.gen(function* () {
		const open = (yield* storedQuery(t, {
			adhoc_catalog_entry: { where: { payroll_run_id: { is_null: true } }, limit: 1 }
		})).adhoc_catalog_entry.rows[0];
		assert.ok(open !== undefined);
		yield* (yield* t.as(t.admin)).act({
			'payroll_run.create': [
				{
					entity_id: ENTITY,
					period,
					kind: 'OFF_CYCLE',
					adhoc: [{ id: idOf('adhoc_catalog_entry', open.id), revision: open.revision }]
				}
			]
		});
		yield* t.run_due();
	});

describe('an off-cycle run', () => {
	it.live('of a deduction alone is refused: nothing negative posts to a balance', () => {
		const seed = seedOf();
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* enter(t, seed, 'NOTICE_INDEMNITY', 400, '2026-06-15');
			const refused = yield* refusal(offCycle(t, '2026-06'));
			assert.equal(refused.key, 'errors.payroll_run_below_zero');
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
	});

	it.live('in a transfer month is refused: on-cycle, each company stands alone', () => {
		const base = seedOf();
		const contract = base.employee_contract?.[0] ?? {};
		const profile = base.entity_profile_version?.[0] ?? {};
		const OTHER = idOf('entity', uuid(900));
		const seed: Seed = {
			...base,
			entity: [
				...(base.entity ?? []),
				{ id: OTHER, code: 'E2', name: 'Sister', settings_code: 'MY' }
			],
			entity_profile_version: [
				...(base.entity_profile_version ?? []),
				{ ...profile, id: uuid(902), entity_id: OTHER, name: 'Sister' }
			],
			employee_contract: [
				{ ...contract, effective_range: { from: '2026-01-01', to: '2026-06-15' } },
				{
					...contract,
					id: uuid(907),
					entity_id: OTHER,
					effective_range: { from: '2026-06-16', to: null }
				}
			]
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* enter(t, seed, 'BONUS', 2000, '2026-06-10');
			const refused = yield* refusal(offCycle(t, '2026-06'));
			assert.equal(refused.key, 'errors.payroll_run_moved_company');
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
	});
});

describe('a leaver with no further on-cycle run', () => {
	const seed = seedOf('2026-05-31');
	it.live(
		'is paid an adjustment off-cycle on their last period, and its statutory rows count it',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, '2026-05');
				yield* enter(t, seed, 'ADJ', 1000, '2026-05-25');
				yield* offCycle(t, '2026-05');
				const { payslip, payroll_run } = yield* storedQuery(t, {
					payslip: { limit: 10 },
					payroll_run: { where: { kind: { eq: 'OFF_CYCLE' } }, limit: 1 }
				});
				const [run] = payroll_run.rows;
				assert.ok(run !== undefined);
				const adjustment = Schema.decodeUnknownSync(PayslipBreakdown)(
					payslip.rows.find((row) => row.payroll_run_id === run.id)?.breakdown
				);
				assert.equal(adjustment.lines.find((line) => line.code === 'ADJ')?.amount, 1000);
				assert.ok((adjustment.statutory.find((row) => row.code === 'EPF')?.employee ?? 0) > 0);
			}).pipe(Effect.provide(workspace({ seed, now: JUNE })))
	);
	it.live('cannot be paid on a later period, so the entry is never lost', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* pay(t, '2026-05');
			yield* enter(t, seed, 'ADJ', 1000, '2026-05-25');
			const refused = yield* refusal(offCycle(t, '2026-06'));
			assert.equal(refused.key, 'errors.payroll_run_not_in_group');
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })))
	);
});
