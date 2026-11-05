import { Effect } from 'effect';
import type { WriteCtx } from '@norbital-ai/bolt';
import { model } from '@norbital-ai/bolt';
import type { Id } from '@norbital-ai/bolt';
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
	const got = yield* ctx.db.query({
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
			if (!previous.has(before))
				return yield* ctx.refuse(
					'A subtotal can only follow another subtotal of the same version.'
				);
			const existing = used.get(before);
			if (existing !== undefined && existing !== id)
				return yield* ctx.refuse(
					'Subtotals must form one linear chain: two subtotals cannot follow the same one.'
				);
			used.set(before, id);
		}
		for (const start of previous.keys()) {
			const seen = new Set<string>();
			let current: string | null | undefined = start;
			while (current != null) {
				if (seen.has(current)) return yield* ctx.refuse('Subtotal order cannot contain a cycle.');
				seen.add(current);
				current = previous.get(current);
			}
		}
	}
});

export default model('subtotal', {
	description:
		'A jurisdiction-owned calculation step. Producers hold their own subtotal foreign keys.',
	label: 'name',
	fields: {
		settings_id: { kind: 'ref', to: 'jurisdiction_settings', inverse: 'subtotals', owned: true },
		code: { kind: 'text' },
		name: { kind: 'text' },
		previous_id: { kind: 'ref', to: 'subtotal', optional: true, onDelete: 'restrict' },
		calculation: { kind: 'text', format: 'cel', max: 65536, optional: true }
	},
	unique: [{ fields: ['settings_id', 'code'] }],
	read: { subtotal: { fields: 'all' } },
	create: {
		columns: {
			subtotal: ['settings_id', 'code', 'name', 'previous_id', 'calculation']
		},
		transform: function* (rows, ctx) {
			yield* guardConfigurationRows(
				ctx.db.query,
				'subtotal',
				rows,
				rows.map((row) => row.settings_id)
			);
			yield* requireLinearChain(
				ctx,
				rows.map((row) => row.settings_id),
				rows
			);
			return rows;
		}
	},
	update: {
		columns: { subtotal: ['code', 'name', 'previous_id', 'calculation'] },
		transform: function* (changes, ctx) {
			yield* guardConfigurationRows(
				ctx.db.query,
				'subtotal',
				changes.map(({ before, set }) => ({ ...before, ...set })),
				changes.map(({ before }) => before.settings_id)
			);
			yield* requireLinearChain(
				ctx,
				changes.map(({ before }) => before.settings_id),
				changes.map(({ before, set }) => ({
					id: before.id,
					settings_id: before.settings_id,
					previous_id: set.previous_id ?? before.previous_id
				}))
			);
			return changes.map(({ set }) => set);
		}
	},
	delete: {
		check: function* (rows, ctx) {
			yield* requireDraftSettings(
				ctx.db.query,
				rows.map((row) => row.settings_id)
			);
		}
	}
});
