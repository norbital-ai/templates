import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * One obligation a jurisdiction places on the employer outside the payroll calculation: a filing, a
 * notice, a record. The register states what must happen, when it is triggered, who owns it and
 * the authority; completing it is an HR or Finance procedure with its own evidence.
 *
 * These are review requirements, not claims that a workflow is implemented. The engine never prices
 * them; they exist so an operator can see the duties a version carries beside its calculations.
 */
const obligationSchema = Schema.Struct({
	code: Schema.NonEmptyString,
	description: Schema.String.check(Schema.isMinLength(1)),
	/** What starts the duty: a termination, a payment, a hire. */
	trigger: Schema.String.check(Schema.isMinLength(1)),
	/** When it is due, in the authority's own terms. */
	timing: Schema.String.check(Schema.isMinLength(1)),
	/** The responsible role, not an assigned person. */
	owner: Schema.String.check(Schema.isMinLength(1)),
	/** The instrument that imposes it. */
	authority: Schema.String.check(Schema.isMinLength(1)),
	status: Schema.Literals(['EXTERNAL', 'PARTIAL', 'UNVERIFIED'])
});

const obligationsValueSchema = Schema.Array(obligationSchema);

export default defineCustomType({
	name: 'obligations',
	description:
		'Employer duties outside the payroll calculation: what is due, when, who owns it and the authority that imposes it.',
	schema: Schema.toStandardSchemaV1(obligationsValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
