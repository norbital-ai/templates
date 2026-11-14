import { tap } from '../../../../lib/payroll_engine/taps.js';
import { model } from '@norbital-ai/bolt';
import { amendmentsOf } from '../../../../lib/amendments.js';

/** The day a published holiday prices, for everyone the company paid or the one person it names. */
const spans = (
	rows: readonly {
		readonly entity_id: string;
		readonly date: string;
		readonly published_at?: unknown;
		readonly employee_id?: string | null | undefined;
	}[]
) =>
	rows.flatMap((row) =>
		row.published_at == null
			? []
			: [
					{
						entity: String(row.entity_id),
						from: String(row.date),
						to: String(row.date),
						...(row.employee_id == null ? {} : { employee: String(row.employee_id) })
					}
				]
	);

/** A holiday's fields a writer sets. */
const columns = [
	'date',
	'name',
	'kind',
	'published_at',
	'replaces',
	'given_to',
	'entity_id',
	'employee_id'
] as const;

export default model('holiday', {
	description:
		'One observed public holiday of one legal entity on one day. Published individually. A published day corrected in paid time amends everyone the company paid for it. Imported from a spreadsheet or entered by hand.',
	icon: 'lucide:calendar-x',
	record_label: "record.name + ' · ' + string(record.date)",
	fields: {
		date: {
			kind: 'date'
		},
		name: {
			kind: 'text'
		},
		kind: {
			kind: 'enum',
			values: [
				'PUBLIC_HOLIDAY',
				'SPECIAL_HOLIDAY',
				'SUBSTITUTE',
				'DOUBLE_HOLIDAY',
				'DOUBLE_SPECIAL',
				'MAKEUP_WORKDAY'
			],
			default: 'PUBLIC_HOLIDAY'
		},
		// set by the calendar's Publish action, shown in its table, never typed
		published_at: {
			kind: 'instant',
			optional: true,
			hidden: true
		},
		replaces: {
			kind: 'date',
			optional: true
		},
		given_to: {
			kind: 'enum',
			values: ['EVERYONE', 'ONLY_IF_OFF_ON_REPLACED_DATE'],
			default: 'EVERYONE'
		},
		entity_id: { kind: 'ref', to: 'entity', inverse: 'holiday' },
		// a holiday is the company's day; with a person named it is that person's alone: the day they keep the holiday
		// when their shift put it on another date (a night guard whose holiday shift starts as the holiday ends)
		employee_id: { kind: 'ref', to: 'employee_profile', inverse: 'holiday', optional: true }
	},
	outputs: {
		default: {
			fields: 'all',
			// the person a holiday is for alone shows by name
			employee_id: { fields: ['name'] }
		}
	},
	create: {
		fields: columns,
		transform: function* (changes, ctx) {
			const rows = changes.map(({ set }) => set);
			return {
				sets: rows,
				on_approved: yield* amendmentsOf(ctx.query, spans(rows))
			};
		},
		effect: function* (changes, ctx) {
			yield* tap(
				ctx,
				'create',
				'holiday',
				changes.map(({ after }) => ({ after }))
			);
		}
	},
	update: {
		fields: columns,
		transform: function* (changes, ctx) {
			// a holiday's name moves nobody's pay: only what says which day, of what kind, for whom
			const moved = changes.filter((change) =>
				(
					[
						'date',
						'kind',
						'published_at',
						'replaces',
						'given_to',
						'entity_id',
						'employee_id'
					] as const
				).some((field) => change.changed(field))
			);
			return {
				sets: changes.map((change) => change.set),
				// the day as it was and the day as it is now: published, moved or taken back
				on_approved: yield* amendmentsOf(ctx.query, [
					...spans(moved.map((change) => change.before)),
					...spans(moved.map((change) => change.after))
				])
			};
		},
		effect: function* (changes, ctx) {
			yield* tap(ctx, 'update', 'holiday', changes);
		}
	},
	delete: {
		transform: function* (changes, ctx) {
			const rows = changes.map(({ before }) => before);
			return {
				on_approved: yield* amendmentsOf(ctx.query, spans(rows))
			};
		},
		effect: function* (changes, ctx) {
			yield* tap(
				ctx,
				'delete',
				'holiday',
				changes.map(({ before }) => ({ before }))
			);
		}
	}
});
