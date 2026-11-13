// An allowance whose conversion reads the share of the period paid falls with the salary for a joiner or leaver, and a
// month split across contracts pays the agreed amount once between them. Malaysia's law pack is only the fixture.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import { run } from '../amendment_kit.ts';
import { ENTITY, pack, storedQuery, uuid, workspace } from '../kit.ts';

const NOW = '2026-06-20T02:00:00.000Z';
const ALLOWANCE = 300;
type Seed = ReturnType<typeof pack>;
const seed: Seed = pack(
	'MY',
	'Asia/Kuala_Lumpur',
	{
		rate: { amount: 3120, unit: 'MONTHLY' },
		statutory_work_category: 'MANUAL_LABOUR',
		work_classification: 'EA_COVERED',
		residency_status: 'CITIZEN',
		wage_payment_method: 'BANK',
		allowances: { SUA: { amount: ALLOWANCE } }
	},
	{},
	[],
	[],
	'2026-06-15'
);
const dated = (from: Seed, range: { from: string; to: string | null }): Seed => ({
	...from,
	employee_contract: (from.employee_contract ?? []).map((row) => ({
		...row,
		effective_range: range
	}))
});
/** Each payslip's SUA lines, summed. */
const allowance = (t: Kit) =>
	storedQuery(t, { payslip: { limit: 12 } }).pipe(
		Effect.map((got) =>
			got.payslip.rows.map((slip) =>
				Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown).lines.reduce(
					(total, line) => total + (line.code === 'SUA' ? line.amount : 0),
					0
				)
			)
		)
	);
/** June's run in a workspace of its own: each payslip's allowance. */
const june = (from: Seed) =>
	Effect.gen(function* () {
		const t = yield* TestWorkspace;
		yield* run(t, '2026-06');
		return yield* allowance(t);
	}).pipe(Effect.provide(workspace({ seed: from, now: NOW })));

describe('an allowance and the share of the period paid', () => {
	const joiner = (prorate: boolean): Seed => {
		const held = dated(seed, { from: '2026-06-16', to: null });
		return {
			...held,
			allowance_catalog: (held.allowance_catalog ?? []).map((row) =>
				row.code === 'SUA' && !prorate
					? { ...row, conversion: String(row.conversion).replace(' * ctx.paid_share', '') }
					: row
			)
		};
	};

	it.live('read, a joiner’s allowance takes the days employed', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-06');
			const { payslip } = yield* storedQuery(t, { payslip: { limit: 1 } });
			const { checkpoints } = Schema.decodeUnknownSync(PayslipBreakdown)(
				payslip.rows[0]?.breakdown
			);
			const at = (code: string) => checkpoints.find((point) => point.code === code)?.value ?? 0;
			const part = at('PRORATED') / at('BASIC');
			assert.ok(part > 0 && part < 1, String(part));
			assert.deepEqual(yield* allowance(t), [Number((ALLOWANCE * part).toFixed(2))]);
		}).pipe(Effect.provide(workspace({ seed: joiner(true), now: NOW })))
	);

	it.live('unread, it pays whole', () =>
		june(joiner(false)).pipe(Effect.map((paid) => assert.deepEqual(paid, [ALLOWANCE])))
	);
});

describe('an allowance across a month of contracts', () => {
	/** Each part is a share, and the parts make the agreed amount once. */
	const shared = (parts: readonly number[]) => {
		assert.ok(
			parts.every((part) => part > 0 && part < ALLOWANCE),
			String(parts)
		);
		assert.equal(
			parts.reduce((total, part) => total + part, 0),
			ALLOWANCE
		);
	};

	it.live('a joiner and a leaver pay their days', () =>
		Effect.gen(function* () {
			// one joins the day after the other leaves: between them the month is whole
			const joiner = yield* june(dated(seed, { from: '2026-06-16', to: null }));
			const leaver = yield* june(dated(seed, { from: '2025-01-01', to: '2026-06-15' }));
			assert.equal(joiner.length + leaver.length, 2);
			shared([...joiner, ...leaver]);
		})
	);

	it.live('a new contract in the same company pays the whole month once', () => {
		const contract = seed.employee_contract?.[0] ?? {};
		return june({
			...seed,
			employee_contract: [
				{ ...contract, effective_range: { from: '2025-01-01', to: '2026-06-15' } },
				{ ...contract, id: uuid(907), effective_range: { from: '2026-06-16', to: null } }
			]
		}).pipe(Effect.map((paid) => assert.deepEqual(paid, [ALLOWANCE])));
	});

	it.live('a transfer to a sister company pays each its share, once between them', () => {
		const OTHER = idOf('entity', uuid(900));
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
			// the sister company's own payroll, on the same schedule
			pay_group: [
				...(seed.pay_group ?? []),
				...(seed.pay_group ?? []).map((row) => ({ ...row, id: uuid(908), entity_id: OTHER }))
			],
			employee_contract: [
				{ ...contract, effective_range: { from: '2025-01-01', to: '2026-06-15' } },
				{
					...contract,
					id: uuid(907),
					entity_id: OTHER,
					pay_group_id: uuid(908),
					effective_range: { from: '2026-06-16', to: null }
				}
			]
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-06');
			yield* run(t, '2026-06', uuid(908), OTHER);
			const parts = yield* allowance(t);
			assert.equal(parts.length, 2);
			shared(parts);
		}).pipe(Effect.provide(workspace({ seed: moved, now: NOW })));
	});
});
