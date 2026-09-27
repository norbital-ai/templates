import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One observed public holiday of one legal entity on one day. Published individually; a row a payroll run captured or a work day pins is frozen. Imported from a spreadsheet or a Google holiday calendar, or entered by hand.',
	icon: 'lucide:calendar-x',
	label: ['date', 'name'],
	fields: {
		/** The day observed. One row per entity and day. */
		date: { kind: 'date' },
		name: { kind: 'text' },
		/** PUBLIC and SUBSTITUTE price as PUBLIC_HOLIDAY, SPECIAL as SPECIAL_HOLIDAY; DOUBLE is two regular holidays. */
		kind: {
			kind: 'enum',
			values: ['PUBLIC_HOLIDAY', 'SPECIAL_HOLIDAY', 'SUBSTITUTE', 'DOUBLE_HOLIDAY'],
			default: 'PUBLIC_HOLIDAY'
		},
		/** The statutory date when the observance moved. */
		replaces: { kind: 'date', optional: true },
		/** Everyone, or only the staff whose roster had the replaced date off. */
		given_to: {
			kind: 'enum',
			values: ['EVERYONE', 'ONLY_IF_OFF_ON_REPLACED_DATE'],
			default: 'EVERYONE'
		},
		/** A Google event id, a spreadsheet, or nothing for a hand entry. */
		source: { kind: 'text', optional: true },
		/** Payroll, leave and rosters read published rows only. */
		published_at: { kind: 'instant', optional: true }
	},
	unique: [{ fields: ['company_id', 'date'] }],
	index: ['published_at'],
	search: { text: ['name'] }
});
