import { customField } from '@norbital-ai/bolt';
import { isCalendarDate, isSettledId } from '../../../lib/iso-day.js';

const f = customField({
	description: 'The published holidays a payroll calculation read, captured on the run.',
	shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				id: { kind: 'text' },
				company_id: { kind: 'text' },
				date: { kind: 'text' },
				name: { kind: 'text' },
				kind: {
					kind: 'enum',
					values: ['PUBLIC_HOLIDAY', 'SPECIAL_HOLIDAY', 'SUBSTITUTE', 'DOUBLE_HOLIDAY']
				},
				replaces: { kind: 'text', optional: true },
				given_to: { kind: 'enum', values: ['EVERYONE', 'ONLY_IF_OFF_ON_REPLACED_DATE'] },
				published_at: { kind: 'text' }
			}
		}
	}
});
export default f;
f.validate((rows) =>
	rows.some(
		(row) =>
			!isSettledId(row.id) ||
			!isSettledId(row.company_id) ||
			!isCalendarDate(row.date) ||
			(row.replaces != null && !isCalendarDate(row.replaces))
	)
		? 'A holiday snapshot names its ids and real calendar days.'
		: undefined
);
