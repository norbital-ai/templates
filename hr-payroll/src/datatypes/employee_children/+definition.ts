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
	effective_range: Schema.NullOr(instantRangeValueSchema)
}).check(
	Schema.makeFilter(
		(row) => isCalendarDate(row.child_birthdate) || 'Enter a valid child birth date.'
	)
);

export type EmployeeChild = Schema.Schema.Type<typeof employeeChildSchema>;

export default defineCustomType({
	name: 'employee_children',
	description:
		'The child facts of one employment contract: birth date, relationship and legal span. Append-only — a wrong fact is closed by its effective range, never rewritten — so statutory leave that scales by children is reconstructable on any date.',
	schema: Schema.toStandardSchemaV1(Schema.Array(employeeChildSchema), {
		parseOptions: { onExcessProperty: 'error' }
	})
});
