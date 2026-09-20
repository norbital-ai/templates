import { defineCustomType, instantRangeValueSchema } from '@norbital-ai/bolt/authoring';
import { isCalendarDate } from '@norbital-ai/std/date';
import { Schema } from 'effect';

/**
 * One child fact: birth date, relationship and the legal span the relationship holds (null for a
 * birth-child, born → ongoing). The age cutoffs laws state (`under 7`, `under 18`) are computed
 * from the birth date, not stored. Deliberately distinct from `employees.dependents_count`, the
 * tax-relief scalar: different laws, different definitions.
 */
export const employeeChildSchema = Schema.Struct({
	child_birthdate: Schema.String,
	relationship: Schema.Literals(['CHILD', 'STEPCHILD', 'ADOPTED', 'LEGAL_WARD']),
	effective_range: Schema.NullOr(instantRangeValueSchema),
	/**
	 * The child's own citizenship where a statute turns on it (SG Government-Paid leave: the
	 * child is a Singapore citizen); absent is unrecorded. Read as `event.child_citizenship` on
	 * the per-event entry that names the child, and counted by `children.citizens`.
	 */
	citizenship: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/**
	 * The weeks of the couple's shared parental pool this parent takes for the child, as agreed
	 * with the other parent (SG GPSPL: ten weeks a couple from 1 April 2026, five each by
	 * default); absent is the default share. Read as `event.child_shared_weeks`.
	 */
	shared_parental_weeks: Schema.optionalKey(
		Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))
	),
	/**
	 * Days employed elsewhere in the months before the confinement, declared by the employee
	 * (MY EA s.37(2): ninety days in aggregate in the nine months before), where the aggregate
	 * counts service outside this employment. Absent is none. Read as
	 * `event.prior_employment_days`.
	 */
	prior_employment_days: Schema.optionalKey(
		Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))
	),
	/**
	 * A recorded family classification, available through `children.classed(x)`.
	 * It does not establish a tax claim. MY child relief uses the statutory registration's
	 * tax-year child_claims declaration and entitlement share.
	 */
	relief_class: Schema.optionalKey(Schema.NullOr(Schema.String))
}).check(
	Schema.makeFilter(
		(row) => isCalendarDate(row.child_birthdate) || 'Enter a valid child birth date.'
	)
);

export default defineCustomType({
	name: 'employee_children',
	description:
		'The child facts of one employment contract: birth date, relationship and legal span. Append-only — a wrong fact is closed by its effective range, never rewritten — so statutory leave that scales by children is reconstructable on any date.',
	schema: Schema.toStandardSchemaV1(Schema.Array(employeeChildSchema), {
		parseOptions: { onExcessProperty: 'error' }
	})
});
