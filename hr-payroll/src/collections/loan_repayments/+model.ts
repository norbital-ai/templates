import { defineModel, instant, integer, numeric, uuid } from '@norbital-ai/bolt/authoring';

/**
 * One amount due under a loan agreement.
 *
 * This is the row payroll consumes — never the loan master. One repayment can appear on several
 * payslips when net-pay protection prevents full recovery, and the input junction's
 * `unique(payslip_id, loan_repayment_id)` plus the engine's ceiling over what paid runs actually
 * took are what keep that multi-payslip consumption honest.
 *
 * `sequence` orders the plan and makes the schedule's shape queryable. Three properties hold of a
 * loan's schedule — the amounts sum to the loan's principal to the cent, the due dates strictly
 * increase along `sequence`, and the last repayment falls inside the loan's `effective_range` —
 * and all three are stated once, by `loanScheduleRefusals` in `lib/loan-schedule.ts`.
 *
 * Where that one statement is applied:
 *
 * - **The loans form** blocks submit with it, and marks every issue at once.
 * - **`+hooks.ts` `mutate.prepare`** refuses the date order on every write, and all three on any
 *   write that names the loan it is writing to — every create, and every update, import, agent or
 *   API call that states `loan_id`. The batch is merged over the loan's stored repayments first, so
 *   a patch is judged as the row it would produce and a partial write against the whole schedule it
 *   would leave.
 * - **`lib/loan-schedule.ts` sorts by `due_date` and renumbers `sequence`** on every exit — read,
 *   write and generate — so the UI path cannot construct a schedule that disagrees with itself.
 *
 * What that does not reach, named rather than papered over: the sum and the effective period on a
 * write nested under the loan, which is the loans form's own path and is guarded there (the hook's
 * `prepare` comment says why no hook can judge it, and what happens when one tries); the same two
 * on a patch that names neither its loan nor a parent; and the raw-SQL seed loader, which bypasses
 * hooks entirely.
 *
 * Whoever changes any of this must not rewrite a repayment a payslip has already captured, because
 * net-pay protection lets one repayment legitimately span several payslips.
 */
export default defineModel(
	{
		loan_id: uuid().notNull(),
		/** The day the amount comes due; the cutoff maps it to the run that recovers it. */
		due_date: instant({ precision: 'day' }).notNull(),
		/** A positive magnitude. Part-recovery is the engine's business, never a smaller row. */
		amount_due: numeric().notNull(),
		/** One-based position in the loan's plan. */
		sequence: integer().notNull()
	},
	{
		description:
			'One amount due under a loan agreement, in the order it is recovered. Payroll consumes repayments, never the loan master.',
		recordLabel: ['sequence', 'amount_due'],
		icon: 'lucide:calendar-clock',
		indexes: [{ columns: ['loan_id', 'sequence'], unique: true }]
	}
);
