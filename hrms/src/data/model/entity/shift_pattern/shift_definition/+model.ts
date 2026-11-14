import { model } from '@norbital-ai/bolt';
import { tap } from '../../../../../lib/payroll_engine/taps.js';
import { stableJson } from '../../../../../lib/payroll_engine/foundation.js';

const columns = ['entity_id', 'code', 'name', 'effective_range', 'variant'] as const;
export default model('shift_definition', {
	description:
		'Employer-scoped source data, validated before acceptance. A shift paid roster days used keeps its hours: a change is a new shift.',
	record_label: 'record.code',
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
					kind: 'object',
					many: true,
					fields: {
						start_time: { kind: 'time' },
						end_time: { kind: 'time' },
						paid: { kind: 'bool' }
					}
				},
				untimed_hours: { kind: 'number', min: 0, optional: true }
			}
		}
	},
	constraints: { entity_code: { unique: ['entity_id', 'code'] } },
	outputs: { default: { fields: 'all' } },
	create: {
		fields: columns,
		effect: function* (changes, ctx) {
			yield* tap(
				ctx,
				'create',
				'shift_definition',
				changes.map(({ after }) => ({ after }))
			);
		}
	},
	update: {
		fields: columns,
		transform: function* (changes, ctx) {
			// its name may change; the hours paid days were worked out on may not
			const moved = changes.filter(
				({ before, after }) => stableJson(after.variant) !== stableJson(before.variant)
			);
			if (moved.length > 0) {
				const used = yield* ctx.query({
					roster_entry: {
						where: {
							shift_definition_id: { in: moved.map(({ before }) => before.id) },
							payroll_run_id: { is_null: false }
						},
						fields: ['id'],
						limit: 1
					}
				});
				if (used.roster_entry.rows.length > 0)
					return yield* ctx.refuse('errors.shift_definition_paid');
			}
			return changes.map(({ set }) => set);
		},
		effect: function* (changes, ctx) {
			yield* tap(ctx, 'update', 'shift_definition', changes);
		}
	},
	delete: {
		// a shift paid roster days used is not deleted
		transform: function* (changes, ctx) {
			const used = yield* ctx.query({
				roster_entry: {
					where: {
						shift_definition_id: { in: changes.map(({ before }) => before.id) },
						payroll_run_id: { is_null: false }
					},
					fields: ['id'],
					limit: 1
				}
			});
			if (used.roster_entry.rows.length > 0)
				return yield* ctx.refuse('errors.shift_definition_paid');
		},
		effect: function* (changes, ctx) {
			yield* tap(
				ctx,
				'delete',
				'shift_definition',
				changes.map(({ before }) => ({ before }))
			);
		}
	}
});
