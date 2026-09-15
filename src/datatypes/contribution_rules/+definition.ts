import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { compileExpression } from '../../lib/expressions/compile.js';

/**
 * The rules of one statutory scheme (RFC 0002): an ordered ladder of expressions.
 *
 * Each rule states the condition it governs under (`when`, CEL over the scheme context), and the
 * employee and employer money it charges there. The engine walks the rules in declaration order and
 * the first whose `when` holds governs; a rule no wage matches charges nothing (RFC 0002 §6), so a
 * ladder that covers nobody stops the golden suites rather than quietly reusing the last rung.
 *
 * A percentage award is `base * 11.0 / 100.0`; a fixed award is the published figure; a progressive
 * step is `constant + (base - from) * rate / 100.0` under its own range. Every rule is compiled
 * against the `scheme` context at write time, so a misspelt member or a string where money belongs
 * is refused before any payroll reads it.
 */

const cel = Schema.String.check(Schema.isMinLength(1));

export const contributionRuleSchema = Schema.Struct({
	/** CEL over the scheme context: the range and any person condition this rule governs. */
	when: cel,
	/** CEL returning the employee share for a matching rule. */
	employee: cel,
	/** CEL returning the employer share for a matching rule. */
	employer: cel
});
export type ContributionRule = Schema.Schema.Type<typeof contributionRuleSchema>;

export const contributionRulesValueSchema = Schema.Array(contributionRuleSchema).check(
	Schema.makeFilter((rules) => {
		for (const rule of rules) {
			const when = compileExpression({ expression: rule.when, site: 'scheme', type: 'boolean' });
			if (when != null) return when;
			const employee = compileExpression({
				expression: rule.employee,
				site: 'scheme',
				type: 'money'
			});
			if (employee != null) return employee;
			const employer = compileExpression({
				expression: rule.employer,
				site: 'scheme',
				type: 'money'
			});
			if (employer != null) return employer;
		}
		return true;
	})
);

export default defineCustomType({
	name: 'contribution_rules',
	description:
		'The rules of one statutory contribution as expressions: each the condition it governs under and the employee and employer money it charges. Rules are read in order; the first condition that holds governs. A floor is the first rule, the terminal rule an open-ended condition; no expression may quietly reuse another rule.',
	schema: Schema.toStandardSchemaV1(contributionRulesValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
