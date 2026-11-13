// An allowance whose conversion reads the share of the period paid falls with the salary for a joiner or leaver, and a
// month split across stints pays the agreed amount once between them. Malaysia's law pack is only the fixture.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import { run } from '../amendment_kit.ts';
import { ENTITY, lawAt, lawWith, pack, storedQuery, uuid, workspace } from '../kit.ts';

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
	[]
);
const dated = (from: Seed, range: { from: string; to: string | null }): Seed => ({
	...from,
	employment: (from.employment ?? []).map((row) => ({
		...row,
		effective_range: range
	})),
	contract_terms: (from.contract_terms ?? []).map((row) => ({
		...row,
		effective_from: range.from
	})),
	statutory_parameters: (from.statutory_parameters ?? []).map((row) => ({
		...row,
		effective_from: range.from
	}))
});
/** The stint ends on 15 June and a second of the same person starts the next day, on the same terms. */
const split = (stint: Seed[string][number] = {}, terms: Seed[string][number] = {}): Seed => {
	const held = dated(seed, { from: '2025-01-01', to: '2026-06-15' });
	const next = { from: '2026-06-16', to: null };
	return {
		...held,
		employment: [
			...(held.employment ?? []),
			...(held.employment ?? []).map((row) => ({
				...row,
				id: uuid(907),
				effective_range: next,
				...stint
			}))
		],
		contract_terms: [
			...(held.contract_terms ?? []),
			...(held.contract_terms ?? []).map((row) => ({
				...row,
				id: uuid(909),
				employment_id: uuid(907),
				effective_from: next.from,
				...terms
			}))
		],
		statutory_parameters: [
			...(held.statutory_parameters ?? []),
			...(held.statutory_parameters ?? []).map((row) => ({
				...row,
				id: uuid(910),
				employment_id: uuid(907),
				effective_from: next.from
			}))
		]
	};
};
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
		if (prorate) return held;
		const row = lawAt('MY', '2026-06-15').rows.allowance_catalog.find((one) => one.code === 'SUA');
		assert.ok(row !== undefined);
		return lawWith(held, {
			allowance_catalog: {
				SUA: { conversion: String(row.conversion).replace(' * ctx.paid_share', '') }
			}
		});
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

describe('an allowance across a month of stints', () => {
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

	it.live('a new stint in the same company pays the whole month once', () =>
		june(split()).pipe(Effect.map((paid) => assert.deepEqual(paid, [ALLOWANCE])))
	);

	it.live('a transfer to a sister company pays each its share, once between them', () => {
		const OTHER = idOf('entity', uuid(900));
		const [company = {}] = seed.entity ?? [];
		const [change = {}] = seed.entity_change ?? [];
		const moved: Seed = {
			...split({ entity_id: OTHER }, { pay_group_id: uuid(908) }),
			entity: [...(seed.entity ?? []), { ...company, id: OTHER, code: 'E2', name: 'Sister' }],
			entity_change: [
				...(seed.entity_change ?? []),
				{ ...change, id: uuid(902), entity_id: OTHER }
			],
			// the sister company's own payroll, on the same schedule
			pay_group: [
				...(seed.pay_group ?? []),
				...(seed.pay_group ?? []).map((row) => ({ ...row, id: uuid(908), entity_id: OTHER }))
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
