// What an off-cycle run may pay and what it refuses, and a no-pay day on a six-day week. Singapore and Malaysia are only
// the fixtures.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, pack, uuid, workspace, leaveCreate, storedQuery, refusal } from './kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
const JUNE = '2026-06-20T02:00:00.000Z';
const terms = (amount: number) => ({
	rate: { amount, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
});
type Seed = ReturnType<typeof pack>;
type Place = {
	readonly code: string;
	readonly zone: string;
	readonly facts?: Parameters<typeof pack>[3];
};
const SINGAPORE: Place = { code: 'SG', zone: 'Asia/Singapore', facts: { race: 'CHINESE' } };
const MALAYSIA: Place = { code: 'MY', zone: 'Asia/Kuala_Lumpur' };

const seedOf = ({ code, zone, facts = {} }: Place, amount: number): Seed => {
	const seed = pack(code, zone, terms(amount), facts, [], [], '2026-06-15');
	return {
		...seed,
		employee_contract: (seed.employee_contract ?? []).map((row) => ({
			...row,
			effective_range: { from: '2026-01-01', to: null }
		}))
	};
};
const onCycle = (t: Kit, period: string) =>
	t
		.as(t.admin)
		.pipe(
			Effect.andThen((caller) =>
				caller.act({ 'payroll_run.create': [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }] })
			)
		)
		.pipe(Effect.andThen(t.run_due()));
/** The period's on-cycle run, paid: what is entered for the period after it no longer waits on its review. */
const paidCycle = (t: Kit, period: string) =>
	Effect.gen(function* () {
		yield* onCycle(t, period);
		const [run] = (yield* storedQuery(t, {
			payroll_run: { where: { period: { eq: period } }, limit: 1 }
		})).payroll_run.rows;
		assert.ok(run !== undefined);
		yield* (yield* t.as(t.admin)).act({
			'payroll_run.update': [{ target: run, set: { state: 'PAID' } }]
		});
		yield* t.run_due();
	});
const enter = (t: Kit, seed: Seed, item: string, quantity: number, on: string) => {
	const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
	const row = (seed.adhoc_catalog ?? []).find((r) => r.code === item && r.settings_id === version);
	assert.ok(row !== undefined, item);
	return t.as(t.admin).pipe(
		Effect.andThen((caller) =>
			caller.act({
				'adhoc_catalog_entry.create': [
					{
						entity_id: ENTITY,
						employment_id: CONTRACT,
						catalog_id: idOf('adhoc_catalog', String(row.id)),
						description: 'Correction',
						quantity,
						incurred_on: PlainDate(on)
					}
				]
			})
		)
	);
};
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
const runs = (t: Kit, period: string) =>
	storedQuery(t, { payslip: { limit: 100 }, payroll_run: { limit: 100 } }).pipe(
		Effect.map((got) =>
			got.payroll_run.rows
				.filter((row) => row.period.startsWith(period))
				.toSorted((left, right) => right.kind.localeCompare(left.kind))
				.map((run) => {
					const slip = got.payslip.rows.find((row) => row.payroll_run_id === run.id);
					return Schema.decodeUnknownSync(PayslipBreakdown)(slip?.breakdown);
				})
		)
	);
const charged = (slip: PayslipBreakdown | undefined, code: string) =>
	slip?.statutory.find((row) => row.code === code);

describe('a deduction alone', () => {
	it.live('off-cycle is refused: nothing negative posts to a balance', () => {
		const seed = seedOf(MALAYSIA, 4800);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* enter(t, seed, 'NOTICE_INDEMNITY', 400, '2026-06-15');
			const refused = yield* refusal(offCycle(t, '2026-06'));
			assert.equal(refused.key, 'errors.payroll_run_below_zero');
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
	});
});

describe('a transfer month', () => {
	it.live('an off-cycle run is refused: on-cycle, each company stands alone', () => {
		const base = seedOf(MALAYSIA, 4800);
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

describe('someone on a six-day week', () => {
	it.live('a no-pay day counts the contract’s days, not the company’s', () => {
		const base = seedOf(SINGAPORE, 5200);
		const seed: Seed = {
			...base,
			employee_contract: (base.employee_contract ?? []).map((row) => ({
				...row,
				terms: { ...terms(5200), normal_days_per_week: 6 }
			}))
		};
		const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
		const row = seed.leave_catalog?.find(
			(item) => item.code === 'NPL' && item.settings_id === version
		);
		assert.ok(row !== undefined);
		const take = (t: Kit, date: string) =>
			t.as(t.admin).pipe(
				Effect.andThen((caller) =>
					caller.act({
						'leave_catalog_entry.create': [
							leaveCreate({
								entity_id: ENTITY,
								employment_id: CONTRACT,
								catalog_id: idOf('leave_catalog', String(row.id)),
								days: [
									{ date: PlainDate(date), part: 'AM' as const },
									{ date: PlainDate(date), part: 'PM' as const }
								]
							})
						]
					})
				)
			);
		const line = (slip: PayslipBreakdown | undefined) =>
			slip?.lines.find((item) => item.code === 'NPL');
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, '2026-06-10');
			yield* onCycle(t, '2026-06');
			const [june] = yield* runs(t, '2026-06');
			// June has 26 days to work on a six-day week, the fixture's own term: the day is a line off PAID_BASIC
			assert.equal(line(june)?.amount, 5200 / 26);
			assert.equal(line(june)?.direction, 'DEDUCT');
			assert.equal(
				june?.checkpoints.find((point) => point.code === 'PAID_BASIC')?.value,
				5200 - 5200 / 26
			);
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
	});
});

describe('a leaver with no further on-cycle run', () => {
	it.live(
		'Malaysia: an adjustment goes out off-cycle on their last period, and its EPF counts it',
		() => {
			const base = seedOf(MALAYSIA, 4800);
			const seed: Seed = {
				...base,
				employee_contract: (base.employee_contract ?? []).map((row) => ({
					...row,
					effective_range: { from: '2026-01-01', to: '2026-05-31' }
				}))
			};
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* paidCycle(t, '2026-05');
				yield* enter(t, seed, 'ADJ', 1000, '2026-05-25');
				yield* offCycle(t, '2026-05');
				const [, adjustment] = yield* runs(t, '2026-05');
				assert.equal(adjustment?.lines.find((line) => line.code === 'ADJ')?.amount, 1000);
				assert.ok((charged(adjustment, 'EPF')?.employee ?? 0) > 0);
			}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
		}
	);
	it.live('Malaysia: a run on a later period refuses, so the entry is never lost', () => {
		const base = seedOf(MALAYSIA, 4800);
		const seed: Seed = {
			...base,
			employee_contract: (base.employee_contract ?? []).map((row) => ({
				...row,
				effective_range: { from: '2026-01-01', to: '2026-05-31' }
			}))
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* paidCycle(t, '2026-05');
			yield* enter(t, seed, 'ADJ', 1000, '2026-05-25');
			const refused = yield* refusal(offCycle(t, '2026-06'));
			assert.equal(refused.key, 'errors.payroll_run_not_in_group');
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
	});
});
