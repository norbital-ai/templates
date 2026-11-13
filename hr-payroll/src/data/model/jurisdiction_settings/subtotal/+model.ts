import { Effect } from 'effect';
import type { Id, WriteCtx } from '@norbital-ai/bolt';
import { model } from '../../../../../.norbital/models/subtotal.ts';
import {
	guardConfigurationRows,
	requireDraftSettings
} from '../../../../lib/payroll_engine/configuration.js';

/** previous_id must form one linear chain per settings version: no branch, no cycle, no cross-version link. */
const requireLinearChain = Effect.fnUntraced(function* (
	ctx: WriteCtx<'subtotal'>,
	settingsIds: readonly Id<'jurisdiction_settings'>[],
	proposed: readonly {
		readonly id?: string;
		readonly settings_id?: string;
		readonly previous_id?: string | null;
	}[]
) {
	const got = yield* ctx.query({
		subtotal: {
			where: { settings_id: { in: [...new Set(settingsIds)] } },
			fields: ['id', 'settings_id', 'previous_id'],
			limit: 10000
		}
	});
	const rows = got.subtotal.rows;
	for (const settings of new Set(settingsIds)) {
		const siblings = rows.filter((row) => row.settings_id === settings);
		const previous = new Map<string, string | null>();
		for (const row of siblings) previous.set(row.id, row.previous_id ?? null);
		for (const row of proposed) {
			if (row.settings_id !== undefined && row.settings_id !== settings) continue;
			if (row.id !== undefined) previous.set(row.id, row.previous_id ?? null);
		}
		const used = new Map<string, string>();
		for (const [id, before] of previous) {
			if (before == null) continue;
			if (!previous.has(before)) return yield* ctx.refuse('errors.subtotal_previous_other_version');
			const existing = used.get(before);
			if (existing !== undefined && existing !== id)
				return yield* ctx.refuse('errors.subtotal_chain_branch');
			used.set(before, id);
		}
		for (const start of previous.keys()) {
			const seen = new Set<string>();
			let current: string | null | undefined = start;
			while (current != null) {
				if (seen.has(current)) return yield* ctx.refuse('errors.subtotal_chain_cycle');
				seen.add(current);
				current = previous.get(current);
			}
		}
	}
});

export default model({
	description:
		'A jurisdiction-owned calculation step. Producers hold their own subtotal foreign keys.',
	record_label: 'record.name',
	fields: {
		settings_id: { kind: 'ref', to: 'jurisdiction_settings', inverse: 'subtotals', owned: true },
		code: { kind: 'text' },
		name: { kind: 'text' },
		previous_id: { kind: 'ref', to: 'subtotal', optional: true, on_delete: 'restrict' },
		/** The posting window this checkpoint holds in the ledger. */
		balance_window: { kind: 'enum', values: ['MONTH', 'YEAR'], default: 'YEAR' },
		calculation: { kind: 'text', max: 65536, optional: true }
	},
	constraints: { code_per_settings: { unique: ['settings_id', 'code'] } },
	outputs: { default: { fields: 'all' } },
	create: {
		columns: {
			fields: ['settings_id', 'code', 'name', 'previous_id', 'balance_window', 'calculation']
		},
		transform: function* (changes, ctx) {
			const rows = changes.map((c) => c.after);
			yield* guardConfigurationRows(
				ctx.query,
				'subtotal',
				rows,
				rows.map((row) => row.settings_id)
			);
			yield* requireLinearChain(
				ctx,
				rows.map((row) => row.settings_id),
				rows
			);
			return changes.map((c) => c.set);
		}
	},
	update: {
		columns: { fields: ['code', 'name', 'previous_id', 'balance_window', 'calculation'] },
		transform: function* (changes, ctx) {
			yield* guardConfigurationRows(
				ctx.query,
				'subtotal',
				changes.map((c) => c.after),
				changes.map((c) => c.before.settings_id)
			);
			yield* requireLinearChain(
				ctx,
				changes.map((c) => c.before.settings_id),
				changes.map((c) => ({
					id: c.before.id,
					settings_id: c.before.settings_id,
					previous_id: c.after.previous_id
				}))
			);
			return changes.map((c) => c.set);
		}
	},
	delete: {
		transform: function* (changes, ctx) {
			yield* requireDraftSettings(
				ctx.query,
				changes.map((c) => c.before.settings_id)
			).pipe(
				Effect.catchTag('Refusal', (error) =>
					ctx.refuse('errors.payroll_refused', { values: { message: error.message } })
				)
			);
		}
	}
});
