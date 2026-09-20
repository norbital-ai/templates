import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { compileExpression } from '../../lib/expressions/compile.js';
import { openKeyMentions } from '../../lib/expressions/contexts.js';

/**
 * The rules of one statutory scheme: an ordered ladder of expressions.
 *
 * Each rule states the condition it governs under (`when`, CEL over the scheme context), and the
 * employee and employer money it charges there. The engine walks the rules in declaration order and
 * the first whose `when` holds governs; a rule no wage matches charges nothing, so a
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
	employer: cel,
	/** Rebatable payments made this period, retained separately for subsequent assessments. */
	rebate: Schema.optionalKey(cel),
	/** Allowable deduction evaluated once after selection, readable as scheme.deduction. */
	deduction: Schema.optionalKey(cel),
	/** A matching rule refuses calculation with this explanation. */
	refusal: Schema.optionalKey(cel)
});
export type ContributionRule = Schema.Schema.Type<typeof contributionRuleSchema>;

export const contributionRulesValueSchema = Schema.Array(contributionRuleSchema).check(
	Schema.makeFilter((rules) => {
		for (const rule of rules) {
			for (const expression of [rule.when, rule.deduction ?? '0.0'])
				if (openKeyMentions(expression, 'scheme').includes('deduction'))
					return 'The deduction is evaluated after rule selection and cannot select or depend on itself.';
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
			if (rule.rebate != null) {
				const rebate = compileExpression({
					expression: rule.rebate,
					site: 'scheme',
					type: 'money'
				});
				if (rebate != null) return rebate;
			}
			if (rule.deduction != null) {
				const deduction = compileExpression({
					expression: rule.deduction,
					site: 'scheme',
					type: 'money'
				});
				if (deduction != null) return deduction;
			}
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
