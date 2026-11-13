import { model } from '../../../../../.norbital/models/entity_change.ts';
import { Schema } from 'effect';
import { Instant } from '@norbital-ai/std/date';
import { entityChangeable } from '../../../../lib/payroll_engine/entity_change.js';
import { jsonObject, type Json } from '../../../../lib/payroll_engine/foundation.js';
import { objectValue } from '../../../../lib/payroll_engine/reads.js';

const scheduled = (on: string, today: string) => on > today && on.endsWith('-01');

/** The value at a dotted path, or null where the version does not name it. */
const at = (row: unknown, path: string): Json | null => {
	let held = row;
	for (const part of path.split('.')) {
		if (held === null || typeof held !== 'object' || Array.isArray(held)) return null;
		held = (held as Record<string, unknown>)[part];
	}
	return Schema.decodeUnknownSync(Schema.Json)(held ?? null);
};

export default model({
	description:
		'One dated change to one employer version field, filed ahead of its day. Knowledge only; the seal materializes it into a sealed employer version.',
	record_label: 'record.field_path',
	fields: {
		entity_id: {
			kind: 'ref',
			to: 'entity',
			inverse: 'entity_changes',
			on_delete: 'cascade'
		},
		field_path: { kind: 'text' },
		old_value: { kind: 'json', optional: true, hidden: true },
		new_value: { kind: 'json', optional: true },
		effective_from: { kind: 'date' },
		applied_version_id: {
			kind: 'ref',
			to: 'entity_profile_version',
			optional: true,
			on_delete: 'restrict'
		},
		notes: { kind: 'text', optional: true }
	},
	constraints: {
		one_change: { unique: ['entity_id', 'field_path', 'effective_from'] },
		applied_change: { locked: { applied_version_id: { is_null: false } } }
	},
	outputs: { default: { fields: 'all' } },
	create: {
		columns: {
			fields: ['entity_id', 'field_path', 'old_value', 'new_value', 'effective_from', 'notes']
		},
		transform: function* (changes, ctx) {
			const rows = changes.map(({ set }) => set);
			const unknown = rows.findIndex((row) => !entityChangeable(row.field_path));
			if (unknown >= 0)
				return yield* ctx.refuse('errors.entity_change_field_path', {
					row: unknown,
					field: 'field_path'
				});
			const due = rows.findIndex((row) => !scheduled(row.effective_from, ctx.today));
			if (due >= 0)
				return yield* ctx.refuse('errors.entity_change_effective_from', {
					row: due,
					field: 'effective_from'
				});
			const answer = yield* ctx.query({
				entity_profile_version: {
					where: {
						entity_id: { in: [...new Set(rows.map((row) => row.entity_id))] },
						status: { eq: 'SEALED' }
					},
					fields: [
						'entity_id',
						'effective_range',
						'name',
						'representative_name',
						'registered_address',
						'time_zone',
						'final_pay_loan_floor_percent',
						'overtime_full_award_percent',
						'pay_methods',
						'bank',
						'entity_extension_data'
					] as const,
					limit: 1000
				}
			});
			const versions = answer.entity_profile_version.rows;
			const openOf = (entity: unknown) =>
				versions.find(
					(row) =>
						String(row.entity_id) === String(entity) && objectValue(row.effective_range).to == null
				);
			const closed = rows.findIndex((row) => openOf(row.entity_id) === undefined);
			if (closed >= 0)
				return yield* ctx.refuse('errors.entity_change_no_open_version', { row: closed });
			return rows.map((row) => ({
				...row,
				old_value: at(openOf(row.entity_id), row.field_path)
			}));
		},
		effect: function* (changes, ctx) {
			for (const on of new Set(changes.map(({ after }) => after.effective_from)))
				yield* ctx.schedule(
					'entity_materialize',
					{},
					{ at: Instant(`${on}T00:00:00Z`), key: `entity_materialize:${on}` }
				);
		}
	},
	update: {
		columns: {
			fields: [
				'field_path',
				'old_value',
				'new_value',
				'effective_from',
				'notes',
				'applied_version_id'
			]
		},
		transform: function* (changes, ctx) {
			const materializing = ctx.policies.includes('payroll_execution');
			const applied = changes.findIndex(({ set }) => set.applied_version_id !== undefined);
			if (applied >= 0 && !materializing)
				return yield* ctx.refuse('errors.entity_change_seal_applies', { row: applied });
			const unknown = changes.findIndex(
				({ set }) => set.field_path != null && !entityChangeable(set.field_path)
			);
			if (unknown >= 0)
				return yield* ctx.refuse('errors.entity_change_field_path', {
					row: unknown,
					field: 'field_path'
				});
			const due = changes.findIndex(
				({ set }) => set.effective_from != null && !scheduled(set.effective_from, ctx.today)
			);
			if (due >= 0)
				return yield* ctx.refuse('errors.entity_change_effective_from', {
					row: due,
					field: 'effective_from'
				});
			return changes.map(({ set }) => set);
		},
		effect: function* (changes, ctx) {
			const moved = changes.filter((change) => change.changed('effective_from'));
			for (const on of new Set(moved.map(({ after }) => after.effective_from)))
				yield* ctx.schedule(
					'entity_materialize',
					{},
					{ at: Instant(`${on}T00:00:00Z`), key: `entity_materialize:${on}` }
				);
		}
	},
	delete: {}
});
