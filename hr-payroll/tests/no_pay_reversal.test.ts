// A no-pay day is a catalog line. A correction after payment is a reversal entry on the same catalog item, entered by the
// HR controller and dated in the next period to run. That run pays it, once.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, pack, uuid, workspace } from './kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
const NOW = '2026-06-20T02:00:00.000Z';
const terms = (
	allowances: Record<string, { readonly amount: number; readonly variability?: string }> = {}
) =>
	({
		rate: { amount: 3120, unit: 'MONTHLY' },
		normal_hours_per_day: 8,
		normal_hours_per_week: 40,
		normal_days_per_week: 5,
		statutory_work_category: 'MANUAL_LABOUR',
		work_classification: 'EA_COVERED',
		residency_status: 'CITIZEN',
		wage_payment_method: 'BANK',
		allowances
	}) as const;
type Seed = ReturnType<typeof pack>;
const malaysia = (allowances = {}): Seed => {
	const seed = pack('MY', 'Asia/Kuala_Lumpur', terms(allowances), {}, [], [], '2026-06-15');
	return {
		...seed,
		employee_balance: (seed.employee_balance ?? []).map((row) => ({
			...row,
			account: { leave: { UNPAID_LEAVE: 30 } }
		}))
	};
};
const noPay = (seed: Seed) => {
	const version = seed.employee_contract?.[0]?.input_schema_version_id;
	const row = seed.leave_catalog?.find(
		(item) => item.code === 'UNPAID_LEAVE' && item.settings_id === version
	);
	assert.ok(row !== undefined);
	return idOf('leave_catalog', String(row.id));
};
const whole = (date: string) => [
	{ date: PlainDate(date), part: 'AM' as const },
	{ date: PlainDate(date), part: 'PM' as const }
];
const entry = (t: Kit, seed: Seed, days: ReturnType<typeof whole>, is_reversal = false) =>
	t
		.as(t.admin)
		.act('leave_catalog_entry.create', [
			{ entity_id: ENTITY, employment_id: CONTRACT, catalog_id: noPay(seed), days, is_reversal }
		]);
const run = (t: Kit, period: string) =>
	t
		.as(t.admin)
		.act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }])
		.pipe(Effect.andThen(t.runDue()));
const paid = (t: Kit, period: string) =>
	t.storedQuery({ payslip: { limit: 12 } }).pipe(
		Effect.map((got) => {
			const lines = got.payslip.rows
				.filter((slip) => slip.period === period)
				.flatMap((slip) => Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown).lines);
			return Object.fromEntries(
				lines
					.filter((line) => ['BASIC', 'SUA', 'UNPAID_LEAVE'].includes(line.code))
					.map((line) => [
						line.code,
						Number(line.amount.toFixed(2)) * (line.direction === 'DEDUCT' ? -1 : 1)
					])
			);
		})
	);

describe('a no-pay day', () => {
	const inMonth = (seed: Seed, now = NOW) => workspace({ seed, now });

	it.live('comes off at the month’s wages ÷ its calendar days, fixed allowances with it', () => {
		const seed = malaysia({ SUA: { amount: 300 } });
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* entry(t, seed, whole('2026-06-10'));
			yield* run(t, '2026-06');
			assert.deepEqual(yield* paid(t, '2026-06'), { BASIC: 3120, SUA: 300, UNPAID_LEAVE: -114 });
		}).pipe(Effect.provide(inMonth(seed)));
	});

	it.live('a half day is half, a variable allowance stays out', () => {
		const seed = malaysia({ ONCALL: { amount: 300, variability: 'VARIABLE' } });
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* entry(t, seed, [{ date: PlainDate('2026-06-10'), part: 'AM' }]);
			yield* run(t, '2026-06');
			assert.equal((yield* paid(t, '2026-06'))['UNPAID_LEAVE'], -52);
		}).pipe(Effect.provide(inMonth(seed)));
	});

	it.live('a weekend between two missed days goes with them', () => {
		const seed = malaysia();
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* entry(t, seed, [...whole('2026-06-12'), ...whole('2026-06-15')]);
			yield* run(t, '2026-06');
			assert.equal((yield* paid(t, '2026-06'))['UNPAID_LEAVE'], -416);
		}).pipe(Effect.provide(inMonth(seed)));
	});

	it.live('an entry not yet paid is deleted, not reversed', () => {
		const seed = malaysia();
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* entry(t, seed, whole('2026-06-10'));
			const refused = yield* Effect.flip(entry(t, seed, whole('2026-06-10'), true));
			assert.match(String(refused), /not been paid yet/);
			const [open] = (yield* t.storedQuery({ leave_catalog_entry: { limit: 1 } }))
				.leave_catalog_entry.rows;
			assert.ok(open !== undefined);
			yield* t.as(t.admin).act('leave_catalog_entry.delete', [{ target: open.id }]);
			yield* run(t, '2026-06');
			assert.deepEqual(yield* paid(t, '2026-06'), { BASIC: 3120 });
		}).pipe(Effect.provide(inMonth(seed)));
	});

	it.live('reversed after payment on the same item, the next run pays it, once', () => {
		const seed = malaysia();
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* entry(t, seed, whole('2026-06-10'));
			yield* run(t, '2026-06');
			yield* entry(t, seed, whole('2026-07-06'), true);
			yield* run(t, '2026-07');
			// June took a thirtieth; July gives back the same, though it has 31 days
			assert.equal((yield* paid(t, '2026-07'))['UNPAID_LEAVE'], 104);
			yield* run(t, '2026-08');
			assert.equal((yield* paid(t, '2026-08'))['UNPAID_LEAVE'], undefined);
		}).pipe(Effect.provide(inMonth(seed, '2026-07-20T02:00:00.000Z')));
	});

	it.live('an entry dated in a period that has run is refused, and says why', () => {
		const seed = malaysia();
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-06');
			const late = yield* Effect.flip(entry(t, seed, whole('2026-06-10'), true));
			assert.match(String(late), /already run/);
			const missed = yield* Effect.flip(entry(t, seed, whole('2026-06-11')));
			assert.match(String(missed), /already run/);
		}).pipe(Effect.provide(inMonth(seed, '2026-07-20T02:00:00.000Z')));
	});

	it.live('a late cutoff: the 28th belongs to next month’s run', () => {
		const base = malaysia();
		const seed: Seed = {
			...base,
			entity_profile_version: (base.entity_profile_version ?? []).map((row) => ({
				...row,
				pay_cutoff_day: 25
			}))
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-06');
			yield* entry(t, seed, whole('2026-06-29'));
			yield* run(t, '2026-07');
			assert.ok(((yield* paid(t, '2026-07'))['UNPAID_LEAVE'] ?? 0) < 0);
		}).pipe(Effect.provide(inMonth(seed, '2026-07-20T02:00:00.000Z')));
	});
});

describe('an allowance across a month of contracts', () => {
	const SUA = { SUA: { amount: 300 } };
	const OTHER = idOf('entity', uuid(900));
	const allowance = (t: Kit) =>
		t
			.storedQuery({ payslip: { limit: 12 } })
			.pipe(
				Effect.map((got) =>
					got.payslip.rows.map((slip) =>
						Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown).lines.reduce(
							(total, line) => total + (line.code === 'SUA' ? line.amount : 0),
							0
						)
					)
				)
			);
	const one = (seed: Seed, expected: readonly number[]) =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-06');
			assert.deepEqual(yield* allowance(t), expected);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	const dated = (seed: Seed, range: { from: string; to: string | null }): Seed => ({
		...seed,
		employee_contract: (seed.employee_contract ?? []).map((row) => ({
			...row,
			effective_range: range
		}))
	});

	it.live('a joiner and a leaver pay their days', () => {
		const seed = malaysia(SUA);
		return Effect.gen(function* () {
			yield* one(dated(seed, { from: '2026-06-16', to: null }), [150]);
			yield* one(dated(seed, { from: '2025-01-01', to: '2026-06-15' }), [150]);
		});
	});

	it.live('a new contract in the same company pays the whole month once', () => {
		const seed = malaysia(SUA);
		const contract = seed.employee_contract?.[0] ?? {};
		return one(
			{
				...seed,
				employee_contract: [
					{ ...contract, effective_range: { from: '2025-01-01', to: '2026-06-15' } },
					{ ...contract, id: uuid(907), effective_range: { from: '2026-06-16', to: null } }
				]
			},
			[300]
		);
	});

	it.live('a transfer to a sister company pays each its share, once between them', () => {
		const seed = malaysia(SUA);
		const contract = seed.employee_contract?.[0] ?? {};
		const profile = seed.entity_profile_version?.[0] ?? {};
		const moved: Seed = {
			...seed,
			entity: [
				...(seed.entity ?? []),
				{ id: OTHER, code: 'E2', name: 'Sister', settings_code: 'MY' }
			],
			entity_profile_version: [
				...(seed.entity_profile_version ?? []),
				{ ...profile, id: uuid(902), entity_id: OTHER, name: 'Sister' }
			],
			employee_contract: [
				{ ...contract, effective_range: { from: '2025-01-01', to: '2026-06-15' } },
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
			yield* run(t, '2026-06');
			yield* t
				.as(t.admin)
				.act('payroll_run.create', [{ entity_id: OTHER, period: '2026-06', kind: 'ON_CYCLE' }]);
			yield* t.runDue();
			assert.deepEqual(yield* allowance(t), [150, 150]);
		}).pipe(Effect.provide(workspace({ seed: moved, now: NOW })));
	});
});
