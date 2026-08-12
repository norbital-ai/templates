import { date, defineModel, text, uuid } from '@norbital-ai/pod/authoring';

/**
 * One explicit person-day assignment or override.
 *
 * Every row points to a roster code. That code is the polymorphic entity: WORK owns its clock
 * window and break, while REST and OFF carry no meaningless time fields. The row therefore cannot
 * drift into contradictory shapes such as designation=REST plus a working shift.
 *
 * There is no `PUBLIC_HOLIDAY` arm. A holiday is a property of the calendar, not of one person's
 * roster: `company_holidays` is overlaid at calculation time, so a newly gazetted day reaches
 * payroll without rewriting a single roster row, and the scheduling board draws it from the same
 * calendar rather than from a stored per-person mark. The import pipeline refuses a `PUBLIC_HOLIDAY`
 * row whose date the calendar does not know, so the two can never disagree.
 *
 * `+hooks.ts` enforces the arms on every write. Rows written before this shape existed may still
 * carry a shift on a non-working day; the engine tolerates them unchanged, and the first edit to
 * such a row has to correct it.
 */
export default defineModel(
	{
		employment_id: uuid().notNull(),
		work_date: date().notNull(),
		/** The assigned roster code (WORK, REST or OFF). */
		shift_definition_id: uuid().notNull(),
		/**
		 * The month this entry was drafted in. Entries belonging to a published roster are frozen,
		 * which is what makes publication mean anything. Optional: entries imported or seeded
		 * directly, without going through a drafted month, carry none.
		 */
		roster_id: uuid(),
		/**
		 * The roster token shown to the operator in the source schedule, for example `AMRES` or
		 * `OFF/S`. Provenance only; schedule meaning always comes from the referenced roster code.
		 */
		assignment_code: text()
	},
	{
		description:
			'One explicit person-day assignment or pattern override. Its roster code decides whether it is work, protected rest or another off day; public holidays remain calendar overlays.',
		recordLabel: 'work_date',
		icon: 'lucide:calendar-days',
		indexes: [{ columns: ['employment_id', 'work_date'], unique: true }]
	}
);
