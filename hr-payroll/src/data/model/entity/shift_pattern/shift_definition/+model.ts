import { model } from '@norbital-ai/bolt';
import { tap } from '../../../../../lib/payroll_engine/taps.js';
const columns = ['entity_id', 'code', 'name', 'effective_range', 'variant'] as const;
export default model('shift_definition', {
	description:
		'Employer-scoped source data, validated before acceptance and protected when captured by payroll.',
	label: 'code',
	fields: {
		entity_id: { kind: 'ref', to: 'entity', inverse: 'shift_definition' },
		code: { kind: 'text' },
		name: { kind: 'text', optional: true },
		effective_range: { kind: 'period', of: 'date', optional: true },
		variant: {
			kind: 'object',
			fields: {
				day_type: { kind: 'enum', values: ['WORK', 'REST', 'OFF', 'ABS'] },
				start_time: { kind: 'time', optional: true },
				end_time: { kind: 'time', optional: true },
				ends_next_day: { kind: 'bool' },
				breaks: {
					kind: 'list',
					of: {
						kind: 'object',
						fields: {
							start_time: { kind: 'time' },
							end_time: { kind: 'time' },
							paid: { kind: 'bool' }
						}
					}
				},
				untimed_hours: { kind: 'number', min: 0, optional: true }
			}
		}
	},
	unique: [{ fields: ['entity_id', 'code'] }],
	read: 'all',
	create: {
		columns: { shift_definition: columns }
	},
	update: {
		columns: { shift_definition: columns }
	},
	effect: {
		created: function* (rows, ctx) {
			yield* tap(
				ctx,
				'create',
				{ collection: 'shift_definition', ids: rows.map((r) => r.id) },
				rows.map((after) => ({ after }))
			);
		},
		updated: function* (changes, ctx) {
			yield* tap(
				ctx,
				'update',
				{ collection: 'shift_definition', ids: changes.map((c) => c.after.id) },
				changes
			);
		},
		deleted: function* (rows, ctx) {
			yield* tap(
				ctx,
				'delete',
				{ collection: 'shift_definition', ids: rows.map((r) => r.id) },
				rows.map((before) => ({ before }))
			);
		}
	},
	delete: {}
});
