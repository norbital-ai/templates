import { customField } from '@norbital-ai/bolt';

const f = customField({
	description:
		'Employer-month statutory payable calculated from accrued employee-level charges. This is an amount due, not evidence of payment.',
	shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				scheme_code: { kind: 'text' },
				month: { kind: 'text' },
				currency: { kind: 'text' },
				/** FLOOR_MAJOR_UNIT: the part rounded down; NONE: the part remitted at the actual amount. */
				remittance_rounding: { kind: 'enum', values: ['NONE', 'FLOOR_MAJOR_UNIT'] },
				accrued_amount: { kind: 'number' },
				payable_amount: { kind: 'number' }
			}
		}
	}
});
export default f;
f.validate((rows) =>
	rows.some((row) => row.scheme_code === '' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(row.month))
		? 'A remittance requires a scheme code and YYYY-MM month.'
		: undefined
);
