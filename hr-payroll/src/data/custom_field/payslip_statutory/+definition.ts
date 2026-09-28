import { customField } from '@norbital-ai/bolt';

const f = customField({
	description:
		'The statutory schemes charged on a payslip (or a run): each the code and authority of the scheme, the wage it was charged on, what it took from the employee (negative where a year-end rung refunds), what it cost the employer, the directed instalments inside the employee share, and the rule condition it was read from.',
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
				directed_amount: { kind: 'number', optional: true },
				rebate_amount: { kind: 'number', optional: true },
				rule_when: { kind: 'text', optional: true },
				/** How this charge's employer amount is remitted, on a scheme with remittance rounding. */
				remittance_rounding: { kind: 'enum', values: ['NONE', 'FLOOR_MAJOR_UNIT'], optional: true }
			}
		}
	}
});
export default f;
f.validate((rows) =>
	rows.some((row) => row.scheme_code === '') ? 'scheme_code: is required' : undefined
);
