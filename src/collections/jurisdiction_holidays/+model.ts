import { defineModel, enums, instant, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		/**
		 * The entity that observes this day.
		 *
		 * Holidays are the employer's, not the country's. Two entities in one jurisdiction keep
		 * different calendars — a factory takes its state's gazetted days, the office beside it takes
		 * the federal ones — and there is no per-jurisdiction holiday concept to reconcile them
		 * against. The FK is declared in `+relationship.ts`, as every FK here is.
		 */
		company_id: uuid().notNull(),
		/** The day observed. One row per entity and day. */
		date: instant({ precision: 'day' }).notNull(),
		name: text({ search: true }).notNull(),
		/**
		 * PUBLIC and SUBSTITUTE days price as the regime's PUBLIC_HOLIDAY; SPECIAL (a Philippine
		 * special non-working day) as SPECIAL_HOLIDAY. A substitute is the observed day of a holiday
		 * that fell on a rest day. DOUBLE is two regular holidays on one day (PH Handbook ch.2:
		 * Araw ng Kagitingan on Maundy Thursday or Good Friday, 200% unworked and 300% worked); it
		 * prices as PUBLIC_HOLIDAY and bands read `holiday.kind` to tell it apart.
		 */
		kind: enums(['PUBLIC_HOLIDAY', 'SPECIAL_HOLIDAY', 'SUBSTITUTE', 'DOUBLE_HOLIDAY'])
			.notNull()
			.default('PUBLIC_HOLIDAY'),
		/** The statutory date when the observance moved, e.g. a Sunday holiday taken on Monday. */
		replaces: instant({ precision: 'day' }),
		/**
		 * Who the day is for: everyone, or only the staff whose roster had the
		 * replaced date off — the rest already took the holiday itself and work this day.
		 */
		given_to: enums(['EVERYONE', 'ONLY_IF_OFF_ON_REPLACED_DATE']).notNull().default('EVERYONE'),
		/** Where the row came from: a Google event id, a spreadsheet, or nothing for a hand entry. */
		source: text(),
		/**
		 * Publication is per holiday. Payroll, leave and rosters read published rows only; an
		 * unpublished row is a proposal that costs nobody a day.
		 *
		 * There is no consumed stamp: a holiday is frozen while a payroll run captured it
		 * (`payroll_runs.holidays`) and free again once none does. Work days never link a
		 * holiday; the calendar is overlaid on the date when a day is read.
		 */
		published_at: instant()
	},
	{
		description:
			'One observed public holiday of one legal entity on one day. Published individually; a row a payroll run captured or a work day pins is frozen. Imported from a spreadsheet or a Google holiday calendar, or entered by hand.',
		recordLabel: ['date', 'name'],
		icon: 'lucide:calendar-x',
		indexes: [{ columns: ['company_id', 'date'], unique: true }, { columns: ['published_at'] }]
	}
);
