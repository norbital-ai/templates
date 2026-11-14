import { model } from '@norbital-ai/bolt';
import { tap } from '../../../../lib/payroll_engine/taps.js';
import { paidUnder } from '../../../../lib/amendments.js';
import { stableJson } from '../../../../lib/payroll_engine/foundation.js';

const onePatternShape = (pattern: unknown) => {
	if (typeof pattern !== 'object' || pattern === null) return false;
	const held = pattern as { readonly days?: unknown; readonly cycle?: unknown };
	return (held.days != null ? 1 : 0) + (Array.isArray(held.cycle) ? 1 : 0) === 1;
};

const columns = ['entity_id', 'code', 'name', 'effective_range', 'pattern'] as const;
const shift = { kind: 'ref', to: 'shift_definition' } as const;

export default model('shift_pattern', {
	description:
		'Employer-scoped source data, validated before acceptance. A pattern paid periods followed keeps its days: a change is a new pattern from a date.',
	record_label: 'record.code',
	fields: {
		entity_id: { kind: 'ref', to: 'entity', inverse: 'shift_pattern' },
		code: { kind: 'text' },
		name: { kind: 'text', optional: true },
		effective_range: { kind: 'period', of: 'date', optional: true },
		pattern: {
			kind: 'object',
			fields: {
				week_start: {
					kind: 'enum',
					values: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
					default: 'MONDAY'
				},
				days: {
					kind: 'object',
					optional: true,
					fields: {
						MONDAY: shift,
						TUESDAY: shift,
						WEDNESDAY: shift,
						THURSDAY: shift,
						FRIDAY: shift,
						SATURDAY: shift,
						SUNDAY: shift
					}
				},
				cycle: {
					kind: 'object',
					many: true,
					optional: true,
					fields: { shift_definition_id: shift }
				}
			}
		}
	},
	constraints: { entity_code: { unique: ['entity_id', 'code'] } },
	outputs: { default: { fields: 'all' } },
	create: {
		fields: columns,
		transform: function* (changes, ctx) {
			const row = changes.findIndex(({ after }) => !onePatternShape(after.pattern));
			if (row >= 0)
				return yield* ctx.refuse('errors.shift_pattern_one_shape', { row, field: 'pattern' });
			return changes.map(({ set }) => set);
		},
		effect: function* (changes, ctx) {
			yield* tap(
				ctx,
				'create',
				'shift_pattern',
				changes.map(({ after }) => ({ after }))
			);
		}
	},
	update: {
		fields: columns,
		transform: function* (changes, ctx) {
			const row = changes.findIndex(({ after }) => !onePatternShape(after.pattern));
			if (row >= 0)
				return yield* ctx.refuse('errors.shift_pattern_one_shape', { row, field: 'pattern' });
			// its name may change; the days paid periods were worked out on may not
			const moved = changes.filter(
				({ before, after }) =>
					stableJson(after.pattern) !== stableJson(before.pattern) ||
					stableJson(after.effective_range ?? null) !== stableJson(before.effective_range ?? null)
			);
			if (
				moved.length > 0 &&
				(yield* paidUnder(ctx.query, {
					entity_id: { in: moved.map(({ before }) => before.entity_id) }
				}))
			)
				return yield* ctx.refuse('errors.shift_pattern_paid');
			return changes.map(({ set }) => set);
		},
		effect: function* (changes, ctx) {
			yield* tap(ctx, 'update', 'shift_pattern', changes);
		}
	},
	delete: {
		// a pattern paid periods followed is not deleted
		transform: function* (changes, ctx) {
			if (
				yield* paidUnder(ctx.query, {
					entity_id: { in: changes.map(({ before }) => before.entity_id) }
				})
			)
				return yield* ctx.refuse('errors.shift_pattern_paid');
		},
		effect: function* (changes, ctx) {
			yield* tap(
				ctx,
				'delete',
				'shift_pattern',
				changes.map(({ before }) => ({ before }))
			);
		}
	}
});
