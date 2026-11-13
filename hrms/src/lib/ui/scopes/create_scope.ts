import type { Row } from '@norbital-ai/bolt';

/**
 * How a person reads everywhere on these pages: "JANE TAN (EMP0001)". A list that
 * printed the employee number alone made HR look the person up by hand. The name rides the
 * employment's `employee_id` layer (`'employment.employee_id': { fields: ['name'] }`).
 */
export const employmentLabel = (
	employment:
		| (Pick<Row<'employment'>, 'employee_number'> & {
				readonly employee_id: Pick<Row<'employee_profile'>, 'name'> | null;
		  })
		| null
		| undefined
): string => {
	if (employment == null) return '—';
	const name = employment.employee_id?.name ?? '';
	const number = employment.employee_number;
	if (name !== '' && number !== '') return `${name} (${number})`;
	return name !== '' ? name : number !== '' ? number : '—';
};
