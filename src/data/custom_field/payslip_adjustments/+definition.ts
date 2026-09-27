import { customField } from '@norbital-ai/bolt';
import { isSettledId } from '../../../lib/iso-day.js';

const f = customField({
	description:
		'The adjustments of one payslip in settlement order: each caused by exactly one captured input, named by family and source id, with its frozen label, bucket and amount.',
	shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				family: { kind: 'enum', values: ['WORK_DAY', 'CLAIM', 'ADHOC', 'LEAVE', 'LOAN_REPAYMENT'] },
				source_id: { kind: 'text' },
				component_code: { kind: 'text' },
				label: { kind: 'text' },
				bucket: {
					kind: 'enum',
					values: [
						'EARNING',
						'ABSENCE',
						'DEDUCTION',
						'NON_WAGE_PAYMENT',
						'EMPLOYER_COST',
						'INFORMATION'
					]
				},
				amount: { kind: 'number' },
				quantity: { kind: 'number', optional: true },
				rate: { kind: 'number', optional: true },
				statutory_rule_key: { kind: 'text', optional: true }
			}
		}
	}
});
export default f;
f.validate((rows) => {
	for (const row of rows) {
		if (row.component_code === '' || !isSettledId(row.source_id))
			return 'An adjustment names its component and its source input.';
		if (row.statutory_rule_key != null && row.family !== 'WORK_DAY')
			return 'A statutory rule key is provenance of a work-day adjustment only.';
	}
	return undefined;
});
