import { model } from '@norbital-ai/bolt';
import { tap } from '../../../../lib/payroll_engine/taps.js';

const onePatternShape = (pattern: unknown) => {
	if (typeof pattern !== 'object' || pattern === null) return false;
	const held = pattern as { readonly days?: unknown; readonly cycle?: unknown };
	return (held.days != null ? 1 : 0) + (Array.isArray(held.cycle) ? 1 : 0) === 1;
};

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
				week_start: {
					kind: 'enum',
					values: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
					default: 'MONDAY',
					help: 'The weekday the statutory week opens on. The contract period owns the dates.'
				},
				days: {
					kind: 'object',
					optional: true,
					fields: {
						MONDAY: { kind: 'id', of: 'shift_definition' },
						TUESDAY: { kind: 'id', of: 'shift_definition' },
						WEDNESDAY: { kind: 'id', of: 'shift_definition' },
						THURSDAY: { kind: 'id', of: 'shift_definition' },
						FRIDAY: { kind: 'id', of: 'shift_definition' },
						SATURDAY: { kind: 'id', of: 'shift_definition' },
						SUNDAY: { kind: 'id', of: 'shift_definition' }
					}
				},
				cycle: {
					kind: 'list',
					optional: true,
					of: {
						kind: 'object',
						fields: { shift_definition_id: { kind: 'id', of: 'shift_definition' } }
					},
					help: 'A repeating rotation longer than a week. Its first day is the pattern effective start; use days for a weekly pattern.'
				}
			}
		}
	},
	unique: [{ fields: ['entity_id', 'code'] }],
	read: 'all',
	create: {
		columns: { shift_pattern: columns },
		transform: function* (rows, ctx) {
			if (rows.some((row) => !onePatternShape(row.pattern)))
				return yield* ctx.refuse('A shift pattern is either a weekday map or a cycle, not both.');
			return rows;
		}
	},
	update: {
		columns: { shift_pattern: columns },
		transform: function* (changes, ctx) {
			if (
				changes.some(
					(change) => !onePatternShape({ ...change.before.pattern, ...change.set.pattern })
				)
			)
				return yield* ctx.refuse('A shift pattern is either a weekday map or a cycle, not both.');
			return changes.map((change) => change.set);
		}
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
