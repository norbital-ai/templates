import { customField } from '@norbital-ai/bolt';
import { isCalendarDate } from '../../../lib/iso-day.js';

const f = customField({
	description:
		'The segments of a prorated period on a payslip: the base line each prices (the wage, or an allowance on the contract), the terms label it came from, the days it covered, the divisor they were taken over, and both the contract amount and the prorated result.',
	shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				component_code: { kind: 'text' },
				term_key: { kind: 'text' },
				from: { kind: 'text' },
				to: { kind: 'text' },
				basis: { kind: 'custom', of: 'proration_basis' },
				days: { kind: 'number', min: 0 },
				denominator: { kind: 'number' },
				unpaid_days: { kind: 'number', min: 0 },
				contract_amount: { kind: 'number' },
				prorated_amount: { kind: 'number' }
			}
		}
	}
});
export default f;
f.validate((rows) =>
	rows.some(
		(row) =>
			row.component_code === '' ||
			row.term_key === '' ||
			!isCalendarDate(row.from) ||
			!isCalendarDate(row.to) ||
			row.days < 0 ||
			row.unpaid_days < 0 ||
			row.denominator <= 0
	)
		? 'A proration segment names its line and terms, real days and a positive denominator.'
		: undefined
);
