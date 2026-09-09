import { defineModel, instant, text } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		jurisdiction_code: text().notNull(),
		/** The day observed. One row per jurisdiction and day. */
		date: instant({ precision: 'day' }).notNull(),
		name: text({ search: true }).notNull(),
		/** The statutory date when the observance moved, e.g. a Sunday holiday taken on Monday. */
		original_date: instant({ precision: 'day' }),
		/** Where the row came from: a Google event id, a spreadsheet, or nothing for a hand entry. */
		source: text(),
		/**
		 * Publication is per holiday. Payroll, leave and rosters read published rows only; an
		 * unpublished row is a proposal that costs nobody a day.
		 */
		published_at: instant(),
		/**
		 * Set the first time a work day or a payroll run reads this holiday. A consumed holiday is
		 * history: its date, name and publication cannot change and it cannot be deleted.
		 */
		consumed_at: instant()
	},
	{
		description:
			'One observed public holiday of one jurisdiction on one day. Published individually; a row a work day or payroll run has consumed is frozen. Imported from a spreadsheet or a Google holiday calendar, or entered by hand.',
		recordLabel: ['date', 'name'],
		icon: 'lucide:calendar-x',
		indexes: [
			{ columns: ['jurisdiction_code', 'date'], unique: true },
			{ columns: ['published_at'] }
		]
	}
);
