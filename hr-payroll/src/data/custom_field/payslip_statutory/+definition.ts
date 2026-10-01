import { customField } from '@norbital-ai/bolt';

const f = customField({
	description:
		'The statutory schemes charged on a payslip (or a run): each the code and authority of the scheme, the wage it was charged on, what it took from the employee (negative where a year-end rung refunds), what it cost the employer, and the rule condition it was read from.',
	shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				scheme_code: { kind: 'text' },
				authority: { kind: 'text', optional: true },
				label: { kind: 'text', optional: true },
				listing_order: { kind: 'int', optional: true },
				listing_group: { kind: 'text', optional: true },
				base_amount: { kind: 'number' },
				ordinary_amount: { kind: 'number', optional: true },
				assessment_frequency: {
					kind: 'enum',
					values: ['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY'],
					optional: true
				},
				employee_amount: { kind: 'number' },
				employer_amount: { kind: 'number' },
				rebate_amount: { kind: 'number', optional: true },
				rule_when: { kind: 'text', optional: true },
				/** The amount was assessed from dated, single-payment facts. */
				payment_occasion: { kind: 'bool', optional: true },
				/** How this charge's employer amount is remitted, on a scheme with remittance rounding. */
				remittance_rounding: { kind: 'enum', values: ['NONE', 'FLOOR_MAJOR_UNIT'], optional: true },
				/**
				 * The part of this charge that tops up an earlier period's bill for this slip's late lines
				 * (`late_line_month: 'EARNED'`): that period, and the base and amounts it holds. Included in the totals above.
				 */
				earned_period: { kind: 'text', optional: true },
				earned_base_amount: { kind: 'number', optional: true },
				earned_ordinary_amount: { kind: 'number', optional: true },
				earned_employee_amount: { kind: 'number', optional: true },
				earned_employer_amount: { kind: 'number', optional: true },
				earned_rebate_amount: { kind: 'number', optional: true }
			}
		}
	}
});
export default f;
f.validate((rows) =>
	rows.some((row) => row.scheme_code === '') ? 'scheme_code: is required' : undefined
);
