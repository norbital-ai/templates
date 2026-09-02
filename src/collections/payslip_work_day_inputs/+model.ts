import { defineModel, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * ENGINE-OWNED junction — one work day a payslip read, captured as an input.
 *
 * This is the storage for `payslip.inputs.work_days`. Bolt cannot make the members of a repeated
 * value into foreign keys, so the logical input attribute is a junction collection whose members
 * are real rows: `payslip_id` is a real FK into the payslip that consumed the day (cascade — the
 * input link has no meaning after its payslip is gone), and `work_day_id` is a real FK into the
 * source (restrict — a captured day cannot be deleted out from under the run that read it). No
 * UUID array or JSON blob can say either of those things.
 *
 * There are no calculated values here and there never may be: overtime, rates and bands are
 * outputs, and an input that prices to nothing is still a row — "consumed nothing" and "was never
 * read" are different claims, and the settlement lock is the row, not the amount.
 *
 * `period` is denormalized deliberately, for an access reason rather than a convenience one: the
 * refusal that stops somebody editing a captured record has to name the period that holds it, and
 * it is composed inside a `before` hook under the editing person's own subject — a supervisor has
 * no `payroll_runs` read grant, so joining through the payslip to the run would turn an
 * explanation into an access denial. The engine writes it and refuses hand edits to it.
 */
export default defineModel(
	{
		payslip_id: uuid().notNull(),
		work_day_id: uuid().notNull(),
		period: text().notNull()
	},
	{
		description:
			'Engine-owned capture of one work day a payslip read. No user policy grants writes on this collection; the payroll engine writes it as part of the run that consumed the day.',
		icon: 'lucide:link',
		indexes: [
			{ columns: ['payslip_id', 'work_day_id'], unique: true },
			// A source is consumed by at most one payslip, ever. The composite above only stops the
			// same source appearing twice on the SAME payslip; nothing stopped a second payslip
			// claiming it, so "paid once" rested on engine behaviour rather than on the database.
			{ columns: ['work_day_id'], unique: true }
		]
	}
);
