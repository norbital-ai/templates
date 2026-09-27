import { customField } from '@norbital-ai/bolt';
import { statutoryFactStatusFault } from '../../../lib/datatypes/statutory_fact_status.js';

const FREQUENCIES = ['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY'] as const;
const f = customField({
	description:
		'A person’s statutory registration, current-employer registration date, first contribution liability date, declared elections, imported annual balances with employer origin and directed instalments, or the reason for exclusion.',
	shape: {
		kind: 'union',
		by: 'kind',
		arms: {
			REGISTERED: {
				reference_number: { kind: 'text' },
				rate_override: { kind: 'number', min: 0, optional: true },
				since: { kind: 'text', optional: true },
				first_contribution_due_on: { kind: 'text', optional: true },
				instalments: {
					kind: 'list',
					optional: true,
					of: {
						kind: 'object',
						fields: {
							amount: { kind: 'number' },
							from: { kind: 'text' },
							to: { kind: 'text' },
							reference: { kind: 'text' }
						}
					}
				},
				elections: {
					kind: 'record',
					of: { kind: 'union', of: [{ kind: 'bool' }, { kind: 'number' }, { kind: 'text' }] },
					optional: true
				},
				opening: {
					kind: 'list',
					optional: true,
					of: {
						kind: 'object',
						fields: {
							year: { kind: 'text' },
							base: { kind: 'number' },
							employee: { kind: 'number' },
							employer: { kind: 'number' },
							rebate: { kind: 'number', min: 0, optional: true },
							ordinary: { kind: 'number', optional: true },
							origin: {
								kind: 'enum',
								values: ['CURRENT_EMPLOYER', 'OTHER_EMPLOYER', 'APPROVED_RELATED_EMPLOYER'],
								optional: true
							},
							board_approval_reference: { kind: 'text', optional: true },
							employers_related: { kind: 'bool', optional: true },
							employee_informed: { kind: 'bool', optional: true },
							terms_unchanged: { kind: 'bool', optional: true },
							transferred_employee: { kind: 'bool', optional: true },
							months: { kind: 'int', min: 0, optional: true },
							payroll_periods: { kind: 'int', min: 0, optional: true },
							payroll_frequency: { kind: 'enum', values: FREQUENCIES, optional: true },
							reference: { kind: 'text' }
						}
					}
				},
				child_claims: {
					kind: 'list',
					optional: true,
					of: {
						kind: 'object',
						fields: {
							year: { kind: 'text' },
							relief_class: { kind: 'text' },
							full_count: { kind: 'int', min: 0 },
							half_count: { kind: 'int', min: 0 },
							reference: { kind: 'text' }
						}
					}
				},
				deduction_claims: {
					kind: 'list',
					optional: true,
					of: {
						kind: 'object',
						fields: {
							period: { kind: 'text' },
							category: { kind: 'text' },
							amount: { kind: 'number' },
							source: { kind: 'enum', values: ['EMPLOYEE', 'PRIOR_EMPLOYER'] },
							reference: { kind: 'text' },
							event_reference: { kind: 'text', optional: true }
						}
					}
				},
				unit_assessments: {
					kind: 'list',
					optional: true,
					of: {
						kind: 'object',
						fields: {
							period: { kind: 'text' },
							gross: { kind: 'number', min: 0 },
							units: { kind: 'int', min: 1 },
							reference: { kind: 'text' }
						}
					}
				}
			},
			NOT_REGISTERED: { reason: { kind: 'text' } }
		}
	}
});
export default f;
f.validate(statutoryFactStatusFault);
