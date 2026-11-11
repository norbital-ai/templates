import { tap } from '../../../../lib/payroll_engine/taps.js';
import { model } from '@norbital-ai/bolt';

export default model('holiday', {
	description:
		'One observed public holiday of one legal entity on one day. Published individually; a row a payroll run captured or a work day pins is frozen. Imported from a spreadsheet or entered by hand.',
	icon: 'lucide:calendar-x',
	label: 'date',
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
	read: {
		holiday: { fields: 'all' },
		// the person a holiday is for alone shows by name
		'holiday.employee_id': { fields: ['name'] }
	},
	create: {
		columns: {
			holiday: [
				'date',
				'name',
				'kind',
				'published_at',
				'replaces',
				'given_to',
				'entity_id',
				'employee_id'
			]
		}
	},
	update: {
		columns: {
			holiday: [
				'date',
				'name',
				'kind',
				'published_at',
				'replaces',
				'given_to',
				'entity_id',
				'employee_id'
			]
		}
	},
	effect: {
		created: function* (rows, ctx) {
			yield* tap(
				ctx,
				'create',
				'holiday',
				rows.map((after) => ({ after }))
			);
		},
		updated: function* (changes, ctx) {
			yield* tap(ctx, 'update', 'holiday', changes);
		},
		deleted: function* (rows, ctx) {
			yield* tap(
				ctx,
				'delete',
				'holiday',
				rows.map((before) => ({ before }))
			);
		}
	},
	delete: {}
});
