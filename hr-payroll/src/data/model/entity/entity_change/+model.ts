import { model } from '@norbital-ai/bolt';
import { Schema } from 'effect';
import { Instant } from '@norbital-ai/std/date';
import { entityChangeable } from '../../../../lib/payroll_engine/entity_change.js';
import { jsonObject, type Json } from '../../../../lib/payroll_engine/foundation.js';
import { objectValue } from '../../../../lib/payroll_engine/reads.js';

const REFUSED = {
	field_path:
		'Only an employer fact can be scheduled: name, representative, address, time zone, loan floor, overtime award, pay methods, bank or extension data.',
	effective_from:
		'A scheduled change takes effect on the first of a month to come. One due now is a new employer version.'
};
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

export default model('entity_change', {
	description:
		'One dated change to one employer version field, filed ahead of its day. Knowledge only; the seal materializes it into a sealed employer version.',
	label: 'field_path',
	fields: {
		entity_id: {
			kind: 'ref',
			to: 'entity',
			inverse: 'entity_changes',
			onDelete: 'cascade'
		},
		field_path: {
			kind: 'text',
			help: 'One of name, representative_name, registered_address, time_zone, final_pay_loan_floor_percent, overtime_full_award_percent, pay_methods, bank or entity_extension_data. A dotted path changes one nested value.'
		},
		old_value: { kind: 'json', optional: true, hidden: true },
		new_value: {
			kind: 'json',
			optional: true,
			help: 'The value that stands from the effective date, as JSON: a quoted string, a number, true/false, or an object.'
		},
		effective_from: {
			kind: 'date',
			help: 'The first day of a future month. The open employer version ends the day before it.'
		},
		applied_version_id: {
			kind: 'ref',
			to: 'entity_profile_version',
			optional: true,
			onDelete: 'restrict'
		},
		notes: { kind: 'text', optional: true }
	},
	unique: [{ fields: ['entity_id', 'field_path', 'effective_from'] }],
	locked: { applied_version_id: { isNull: false } },
	read: { entity_change: { fields: 'all' } },
	create: {
		columns: {
			entity_change: [
				'entity_id',
				'field_path',
				'old_value',
				'new_value',
				'effective_from',
				'notes'
			]
		},
		transform: function* (rows, ctx) {
			if (rows.some((row) => !entityChangeable(row.field_path)))
				return yield* ctx.refuse(REFUSED.field_path, { field: 'field_path' });
			if (rows.some((row) => !scheduled(row.effective_from, ctx.today)))
				return yield* ctx.refuse(REFUSED.effective_from, { field: 'effective_from' });
			const answer = yield* ctx.db.query({
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
			if (rows.some((row) => openOf(row.entity_id) === undefined))
				return yield* ctx.refuse('No open employer version to change.');
			return rows.map((row) => ({
				...row,
				old_value: at(openOf(row.entity_id), row.field_path)
			}));
		}
	},
	update: {
		columns: {
			entity_change: [
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
			if (changes.some(({ set }) => set.applied_version_id !== undefined) && !materializing)
				return yield* ctx.refuse('Only the seal applies a change.');
			if (changes.some(({ set }) => set.field_path != null && !entityChangeable(set.field_path)))
				return yield* ctx.refuse(REFUSED.field_path, { field: 'field_path' });
			if (
				changes.some(
					({ set }) => set.effective_from != null && !scheduled(set.effective_from, ctx.today)
				)
			)
				return yield* ctx.refuse(REFUSED.effective_from, { field: 'effective_from' });
			return changes.map(({ set }) => set);
		}
	},
	delete: {},
	effect: {
		created: function* (rows, ctx) {
			for (const on of new Set(rows.map((row) => row.effective_from)))
				yield* ctx.schedule(
					'entity_materialize',
					{},
					{ at: Instant(`${on}T00:00:00Z`), key: `entity_materialize:${on}` }
				);
		},
		updated: function* (changes, ctx) {
			const moved = changes.filter(
				({ before, after }) => before.effective_from !== after.effective_from
			);
			for (const on of new Set(moved.map(({ after }) => after.effective_from)))
				yield* ctx.schedule(
					'entity_materialize',
					{},
					{ at: Instant(`${on}T00:00:00Z`), key: `entity_materialize:${on}` }
				);
		}
	}
});
