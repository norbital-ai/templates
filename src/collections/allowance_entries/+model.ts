import { custom, defineModel, instant, numeric, uuid } from '@norbital-ai/bolt/authoring';

/**
 * What a payslip priced of one standing allowance in one period.
 *
 * Created by the payroll run under the payslip, one per period per allowance in force, and deleted
 * with the draft that holds it; a paid slip's entry is frozen with the slip. Every fact behind the
 * money is stored beside it: the days of the period the allowance covered, the divisor they were
 * taken over, the basis that counted them and the unpaid-leave days the jurisdiction took off, so
 * the payslip line explains itself years after the law moved.
 */
export default defineModel(
	{
		/** The standing allowance this entry repeats. */
		derived_from_id: uuid().notNull(),
		/** The payslip that priced it; the entry is born pinned and dies with a draft slip. */
		payslip_id: uuid().notNull(),
		employment_id: uuid().notNull(),
		catalogue_id: uuid().notNull(),
		/** The days of the period the allowance was in force and the person employed. */
		from: instant({ precision: 'day' }).notNull(),
		to: instant({ precision: 'day' }).notNull(),
		/** The jurisdiction's divisor rule, copied at settlement so a later change cannot rewrite it. */
		basis: custom('proration_basis').notNull(),
		/** Days covered, counted the way `basis` counts them, after any unpaid-leave days came off. */
		days: numeric().notNull(),
		/** The divisor those days were taken over. */
		denominator: numeric().notNull(),
		/** Unpaid-leave days taken off `days`; zero where the jurisdiction does not prorate on them. */
		unpaid_days: numeric().notNull(),
		/** The standing monthly amount the entry started from. */
		contract_amount: numeric().notNull(),
		/** What the payslip paid: the band's amount × days / denominator, signed and rounded. */
		amount: numeric().notNull()
	},
	{
		description:
			'One period of one standing allowance as a payslip priced it: the days covered, the divisor and basis, the unpaid-leave days deducted, the standing amount and the amount paid. Created and deleted with the payslip.',
		recordLabel: ['amount'],
		icon: 'lucide:receipt-text',
		indexes: [
			{ columns: ['derived_from_id'] },
			{ columns: ['payslip_id'] },
			{ columns: ['employment_id'] },
			{ columns: ['from'] }
		]
	}
);
