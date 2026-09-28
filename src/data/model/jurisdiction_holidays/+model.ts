import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One observed public holiday of one legal entity on one day. Published individually; a row a payroll run captured or a work day pins is frozen. Imported from a spreadsheet or a Google holiday calendar, or entered by hand.',
	icon: 'lucide:calendar-x',
	label: ['date', 'name'],
	fields: {
		/** The day observed. One row per entity, day and worksite. */
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
		/**
		 * A local day's worksite, as `employment_terms.worksite` records it (PH RA 12271: Navotas);
		 * only staff whose terms place them there observe it. Empty is the whole company. Part of the
		 * key: two cities keep their own day on one date (RA 7669 San Juan and Proclamation 1186 Las
		 * Piñas, both 27 March 2026), and a local day may share a date with a company-wide row.
		 */
		worksite: { kind: 'text', optional: true },
		/**
		 * The religions whose own religious holiday this day is, comma-separated as `employees.religion`
		 * records them (ID Permenaker 6/2016 art.1(2): Idul Fitri for ISLAM, Natal for CHRISTIAN and
		 * CATHOLIC). Empty for any other day. The entry root `entry.religious_holidays` counts these in
		 * the entry's calendar year (art.5(2): a holiday that falls twice in a year carries two THRs).
		 */
		religion: { kind: 'text', optional: true },
		/** A Google event id, a spreadsheet, or nothing for a hand entry. */
		source: { kind: 'text', optional: true },
		/** Payroll, leave and rosters read published rows only. */
		published_at: { kind: 'instant', optional: true }
	},
	unique: [{ fields: ['company_id', 'date', 'worksite'] }],
	index: ['published_at'],
	search: { text: ['name'] }
});
