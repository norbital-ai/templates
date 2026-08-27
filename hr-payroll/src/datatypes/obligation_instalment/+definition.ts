import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { calendarDay } from '../../lib/iso-day.js';

/**
 * One dated instalment of a SCHEDULED obligation.
 *
 * Inlined on `obligations.instalments`, for the same reason `base`, `proration` and `statutory` are
 * inlined on `payslips`: a schedule is a list of amounts and dates that belongs to exactly one
 * obligation, is only ever read and written whole, and points at nothing. There is no reference
 * hidden in here for a foreign key to enforce, no file, and nothing a policy or a field grant needs
 * to read — which is the test every inline shape in this workspace has to pass.
 *
 * **`sequence` is not stored.** An instalment's number is its position in the array, which is the
 * one place the order is written down; a stored ordinal is a second copy of the index and the two
 * can disagree. This is the decision that let `agreement_instalments` and the `LOAN_INSTALMENT`
 * rows it pointed at be deleted outright.
 *
 * The bounds that are *not* here — at least one instalment, at most 600, and only on the SCHEDULED
 * arm — are arm/payload rules rather than value rules, so they live with every other arm/payload
 * rule in `src/lib/obligation_refusals.ts` under one named refusal.
 */
export const obligationInstalmentValueSchema = Schema.Struct({
	due_date: calendarDay,
	amount: Schema.Finite.check(Schema.isGreaterThan(0))
});

export type ObligationInstalment = Schema.Schema.Type<typeof obligationInstalmentValueSchema>;

/** Strict standard view: a key the struct does not declare is refused rather than stripped. */
export const obligationInstalmentSchema = Schema.toStandardSchemaV1(
	obligationInstalmentValueSchema,
	{ parseOptions: { onExcessProperty: 'error' } }
);

export default defineCustomType({
	name: 'obligation_instalment',
	description:
		'One dated instalment of a scheduled obligation: the day it falls due and the amount payroll recovers, in the order payroll deducts them.',
	schema: obligationInstalmentSchema
});
