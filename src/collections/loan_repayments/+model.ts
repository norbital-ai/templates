import { defineModel, instant, integer, numeric, uuid } from '@norbital-ai/bolt/authoring';

/**
 * One amount due under a loan agreement.
 *
 * This is the row payroll consumes — never the loan master. One repayment can appear on several
 * payslips when net-pay protection prevents full recovery, and the input junction's
 * `unique(payslip_id, loan_repayment_id)` plus the engine's ceiling over what paid runs actually
 * took are what keep that multi-payslip consumption honest.
 *
 * `sequence` orders the plan and makes the schedule's shape queryable. Two properties are *intended*
 * of it — the repayment dates strictly increase along it, and the amounts sum to the loan's
 * principal to the cent — and it matters exactly where each is enforced, because this comment used
 * to claim both were checked here and neither was:
 *
 * - **Date order is guaranteed by construction, on the UI path only.** `lib/loan-schedule.ts` sorts
 *   by `due_date` and renumbers `sequence` from that order on every exit — read, write and
 *   generate — so a schedule built or edited on the loans screen cannot disagree with itself.
 * - **The sum to principal is checked on the UI path only**, by `loanScheduleImbalanced`, which
 *   blocks submit.
 *
 * Neither is enforced by a write hook. `loans/+hooks.ts` checks that the principal is positive and
 * that the named component is a payroll-settled DEDUCTION, and nothing else; `loans/+model.ts`
 * separately claims the last repayment falls inside `effective_range`, which is also unenforced. So
 * an import, an agent or any caller that is not the form can still store a schedule that does not
 * add up. That is a real gap, deliberately named rather than papered over — and whoever closes it
 * must not rewrite a repayment a payslip has already captured, because net-pay protection lets one
 * repayment legitimately span several payslips.
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
