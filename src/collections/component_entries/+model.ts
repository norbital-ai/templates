import {
	custom,
	defineModel,
	file,
	instant,
	numeric,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

/**
 * One employee-specific monetary fact: Alice's $48 taxi claim, Bob's $100 August allowance,
 * Carol's $2,000 bonus, Dan's $75 correction.
 *
 * This is one of the four input families payroll consumes, and it replaces the non-scheduled arms
 * of the removed `obligations` collection. `pay_components` is the reusable catalogue and policy;
 * the entry owns the amount and carries a real `pay_component_id` foreign key, because the
 * component decides direction, eligibility, caps and statutory treatment. The payslip adjustment an
 * entry produces does not repeat that relationship — it freezes the settled label, bucket and
 * amount instead, so a later catalogue change cannot rewrite history.
 *
 * ## What the row states, and what the event states
 *
 * `amount` is always a positive magnitude. Direction comes from the referenced component's policy;
 * the one derived exception is a `MANUAL_ADJUSTMENT` whose operation is `REVERSAL`, which the
 * engine settles in the opposite bucket of the settled output it corrects — the sign is computed
 * there, never stored here.
 *
 * The `event` union owns only arm-specific scalar payload. Two facts are deliberately columns
 * beside it, because a blob cannot hold them honestly:
 *
 * - `corrects_adjustment_id` must be a real foreign key into `payslip_adjustments`, permitted only
 *   for `MANUAL_ADJUSTMENT` and only with a reason. A correction points at the settled output it
 *   fixes; it does not mutate or reverse an abstract entry.
 * - `evidence_file` is a platform `file()` column: the platform owns upload, storage key and mime
 *   type, and a file spelled as a string inside jsonb is a file nothing can fetch, validate or
 *   clean up.
 *
 * Every other arm's payload lives in `event`; the complete arm/payload rule is
 * `componentEntryEventIssues` in `src/lib/component_entry_refusals.ts`, and it is a named refusal
 * rather than a comment.
 */
export default defineModel(
	{
		employment_id: uuid().notNull(),
		pay_component_id: uuid().notNull(),
		/** A positive magnitude. Direction comes from the referenced component's policy. */
		amount: numeric().notNull(),
		quantity: numeric(),
		/** The day the entry is about — a claim's expense day, an HR entry's own date. */
		event_date: instant({ precision: 'day' }).notNull(),
		/**
		 * The period the entry settles in, overriding the cutoff's answer. Null is normal: the
		 * cutoff supplies the period from `event_date` (a claim from its incurred date).
		 */
		pay_period: text(),
		/** The window a standing allowance is live across. Refused on every other arm. */
		effective_range: custom('instant_range', { precision: 'day' }),
		event: custom('component_entry_event').notNull(),
		/** The settled output a `MANUAL_ADJUSTMENT` corrects. Refused on every other arm. */
		corrects_adjustment_id: uuid(),
		/** The receipt behind a claim. Required when the component demands evidence. */
		evidence_file: file()
	},
	{
		description:
			'One employee-specific monetary fact payroll consumes: a claim, a standing allowance, a bonus, an arrears settlement or a manual correction. amount is always a positive magnitude; direction comes from the referenced pay component policy, and a reversal is computed by the engine against the settled output the correction names.',
		recordLabel: ['event_date', 'amount'],
		icon: 'lucide:banknote',
		indexes: [
			{ columns: ['employment_id', 'pay_period'] },
			{ columns: ['pay_component_id'] },
			{ columns: ['employment_id', 'event_date'] },
			{ columns: ['corrects_adjustment_id'], where: '"corrects_adjustment_id" IS NOT NULL' }
		]
	}
);
