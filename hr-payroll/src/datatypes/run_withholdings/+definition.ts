import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * One person deliberately left out of a run, and why.
 *
 * A payroll run covers **everyone eligible in the period**. That is the default and it is not
 * configurable: an operator does not assemble a run out of a list of people, because a person left
 * off such a list is indistinguishable from a person nobody thought of. What an operator does have
 * is the exception — this employment, this month, for this stated reason — and the reason is
 * required, because "why was Aisyah not paid in January" is the only question anybody ever asks
 * about a run that is missing somebody.
 *
 * A withheld employment is out of the precheck as well as out of the payslips. That is the point:
 * before this existed, two employments whose January roster had never been written refused the
 * whole Nihon run and seventy-three colleagues could not be paid, with no way to route around it.
 *
 * Withholding does not forgive anything. The period's wages, attendance and entries stay
 * unconsumed and are settled by a later run from the employment's own contract, exactly as a
 * deferred joiner's are.
 */
export const runWithholdingValueSchema = Schema.Struct({
	employment_id: Schema.String.check(Schema.isUUID()),
	reason: Schema.NonEmptyString
});

export default defineCustomType({
	name: 'run_withholdings',
	description:
		'The employments deliberately withheld from a payroll run, each with the reason it was withheld. A run covers everyone eligible in the period; this is the stated exception.',
	schema: Schema.toStandardSchemaV1(Schema.Array(runWithholdingValueSchema), {
		parseOptions: { onExcessProperty: 'error' }
	})
});
