import { model } from '@norbital-ai/bolt';
import { tap } from '../../../../lib/payroll_engine/taps.js';

const columns = ['entity_id', 'code', 'name', 'effective_range', 'pattern'] as const;

export default model('shift_pattern', {
	description:
		'Employer-scoped source data, validated before acceptance and protected when captured by payroll.',
	label: 'code',
	fields: {
		entity_id: { kind: 'ref', to: 'entity', inverse: 'shift_pattern' },
		code: { kind: 'text' },
		name: { kind: 'text', optional: true },
		effective_range: { kind: 'period', of: 'date', optional: true },
		pattern: {
			kind: 'object',
			fields: {
				anchor_date: { kind: 'date' },
				days: {
					kind: 'list',
					min: 1,
					of: {
						kind: 'object',
						fields: { shift_definition_id: { kind: 'id', of: 'shift_definition' } }
					}
				}
			}
		}
	},
	unique: [{ fields: ['entity_id', 'code'] }],
	read: 'all',
	create: {
		columns: { shift_pattern: columns }
	},
	update: {
		columns: { shift_pattern: columns }
	},
	effect: {
		created: function* (rows, ctx) {
			yield* tap(
				ctx,
				'create',
				{ collection: 'shift_pattern', ids: rows.map((r) => r.id) },
				rows.map((after) => ({ after }))
			);
		},
		updated: function* (changes, ctx) {
			yield* tap(
				ctx,
				'update',
				{ collection: 'shift_pattern', ids: changes.map((c) => c.after.id) },
				changes
			);
		},
		deleted: function* (rows, ctx) {
			yield* tap(
				ctx,
				'delete',
				{ collection: 'shift_pattern', ids: rows.map((r) => r.id) },
				rows.map((before) => ({ before }))
			);
		}
	},
	delete: {}
});
