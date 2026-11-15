import { model } from '@norbital-ai/bolt';
import { tap } from '../../../../../lib/payroll_engine/taps.js';
import { amendmentsFor, followers, refusing } from '../../../../../lib/amendments.js';
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
			// its name prices nothing; its hours are what the paid days that used it were worked out on, and those are worked out again
			const moved = changes.filter(
				({ before, after }) => stableJson(after.variant) !== stableJson(before.variant)
			);
			if (moved.length === 0) return changes.map(({ set }) => set);
			const ids = moved.map(({ before }) => before.id);
			// who it touches: the paid roster days that used it, and everyone on a pattern that holds it
			const used = yield* ctx.query({
				roster_entry: {
					where: { shift_definition_id: { in: ids }, payroll_run_id: { is_null: false } },
					fields: ['employment_id', 'work_date', 'payroll_run_id'],
					limit: 10000
				},
				shift_pattern: {
					where: { entity_id: { in: moved.map(({ before }) => before.entity_id) } },
					fields: ['pattern'],
					limit: 1000
				}
			});
			const holding = used.shift_pattern.rows
				.filter((row) => ids.some((id) => stableJson(row.pattern).includes(id)))
				.map((row) => row.id);
			return {
				sets: changes.map(({ set }) => set),
				on_approved: yield* amendmentsFor(ctx.query, [
					...used.roster_entry.rows.map((row) => ({
						employment: String(row.employment_id),
						from: String(row.work_date),
						run: row.payroll_run_id
					})),
					...(yield* followers(ctx.query, holding))
				]).pipe(refusing(ctx))
			};
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
