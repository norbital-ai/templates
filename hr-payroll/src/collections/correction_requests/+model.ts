import { defineModel, enums, instant, numeric, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * A fix to a payslip line that has already settled: Dan's $75 correction.
 *
 * `corrects_adjustment_id` is `notNull` and a real foreign key into `payslip_adjustments`. That is
 * the single sharpest thing the split buys. It was a nullable column beside a union, permitted only
 * on the `MANUAL_ADJUSTMENT` arm and required there by a hook — and **every** seeded correction was
 * missing it. Those five invalid rows loaded because `seed-from-bank` writes without crossing the
 * authorization boundary, so the only enforcement was a rule on a path the data did not take. A
 * `notNull` column is enforced on every path, by Postgres, including that one.
 *
 * A correction names a settled *output*, never another request. Outputs are immutable, so there is
 * no chain to walk and no sign to flip transitively — the removed `obligations` model carried a
 * `reverses` walk whose single flip silently doubled a negative on a reversal of a reversal. That
 * cannot be written here.
 *
 * `CORRECTION` settles under the referenced component's own policy and supersedes the line it
 * names; `REVERSAL` settles in the opposite bucket of it. The sign is derived by the engine from
 * the settled output, never stored.
 */
export default defineModel(
	{
		employment_id: uuid().notNull(),
		/** The pay component the correction settles under. */
		component_catalogue_id: uuid().notNull(),
		/** A positive magnitude. A reversal's direction is the opposite of the line it corrects. */
		amount: numeric().notNull(),
		/** The day the correction is dated to, which is what the cutoff settles it by. */
		corrected_on: instant({ precision: 'day' }).notNull(),
		/** The settled payslip line this fixes. A real foreign key, and never optional. */
		corrects_adjustment_id: uuid().notNull(),
		/** Supersede the line under this component's policy, or settle it in the opposite bucket. */
		operation: enums(['CORRECTION', 'REVERSAL']).notNull(),
		/** Why the correction was made. Stated, not optional. */
		reason: text().notNull(),
		/** The period this settles in, overriding the cutoff's answer from `corrected_on`. */
		pay_period: text()
	},
	{
		description:
			'A fix to a payslip line that has already settled, naming that line and why. A CORRECTION supersedes it under the component policy; a REVERSAL settles in the opposite bucket.',
		recordLabel: ['corrected_on', 'amount'],
		icon: 'lucide:undo-2',
		indexes: [
			{ columns: ['employment_id', 'pay_period'] },
			{ columns: ['component_catalogue_id'] },
			{ columns: ['corrects_adjustment_id'] },
			{ columns: ['employment_id', 'corrected_on'] }
		]
	}
);
