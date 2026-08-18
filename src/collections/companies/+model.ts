import {
	custom,
	dateRange,
	defineModel,
	enums,
	integer,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		jurisdiction_id: uuid().notNull(),
		name: text({ search: true }).notNull(),
		registration_number: text().notNull(),
		/** The monthly calendar: the day a run's attendance window opens, and the day it pays. */
		pay_cutoff_day: integer().notNull(),
		pay_day: integer().notNull(),
		/**
		 * The calendars of the cadences a monthly cutoff and pay day cannot describe.
		 *
		 * Two integers can only say "one window, one pay date, once a month". A company whose people
		 * are not all monthly — Philippine law requires payment at least twice a month, so half of
		 * one entity here is `SEMI_MONTHLY` — states the instalments of each such cadence with their
		 * own salary window and pay day. `null` means every employment is monthly and the two
		 * columns above are the whole calendar, which is what a company said before this existed.
		 *
		 * The monthly cadence is never restated here: one fact, one place.
		 */
		pay_calendar: custom('pay_calendar'),
		leave_year_start_month: integer().notNull(),
		overtime_calculation_method: enums(['STATUTORY_AGGREGATE', 'ANNUALISED_CONTRACT_RATE'])
			.notNull()
			.default('STATUTORY_AGGREGATE'),
		/**
		 * What the pay calendar cannot say: how the period someone joins in, the period they leave
		 * in, and a leave of absence longer than one window settle. Company policy, not law — so it
		 * is here and not on `jurisdictions`. `null` means the plain calendar governs everything.
		 */
		settlement_policy: custom('settlement_policy'),
		/**
		 * The occupational risk group the entity is rated in, where its regime prices a contribution
		 * by risk rather than by wage or age.
		 *
		 * It looks like ceremony because only one jurisdiction here uses it, and only one entity
		 * therefore carries a value. That is the point: Indonesia's JKK is published as a risk ladder
		 * (`RISK_CLASS` selector, class `IV` at 0.89% and class `I` at 0.24% employer), so
		 * `selectBand` filters the JKK bands on this column. A null risk class matches no band and
		 * the run stops naming JKK, which is the intended loud failure — a silent zero employer
		 * contribution is the alternative. Malaysian and Philippine entities have no risk-keyed
		 * contribution, so empty is the correct value for them, not a gap.
		 */
		risk_class: text(),
		effective_range: dateRange().notNull()
	},
	{
		description:
			'An employing entity inside one jurisdiction, with its pay calendar, overtime calculation, settlement policy, leave year and risk class. Headcount is derived from active employments, never stored.',
		recordLabel: 'name',
		icon: 'lucide:building-2'
	}
);
