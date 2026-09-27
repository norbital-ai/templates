import { customField } from '@norbital-ai/bolt';
import { isCalendarDate, isSettledId } from '../../../lib/iso-day.js';

const f = customField({
	description:
		'Approved leave quantities assigned to annual windows and their original credits. Expiry and reversals preserve these allocations.',
	shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				window: { kind: 'object', fields: { start: { kind: 'text' }, end: { kind: 'text' } } },
				date: { kind: 'text' },
				days: { kind: 'number' },
				credit_entry_id: { kind: 'text', optional: true },
				original_date: { kind: 'text', optional: true },
				pool: { kind: 'text', optional: true }
			}
		}
	}
});
export default f;
f.validate((rows) =>
	rows.some(
		(row) =>
			row.days === 0 ||
			![row.window.start, row.window.end, row.date].every(isCalendarDate) ||
			(row.original_date != null && !isCalendarDate(row.original_date)) ||
			(row.credit_entry_id != null && !isSettledId(row.credit_entry_id))
	)
		? 'An allocation is a non-zero quantity on real calendar days.'
		: undefined
);
