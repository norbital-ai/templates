import { customField } from '@norbital-ai/bolt';
import { isCalendarDate, isSettledId } from '../../../lib/iso-day.js';

const f = customField({
	description:
		'Approved time-off charges by date, with the exact catalogue, schedule and holiday inputs. Payroll charges only dates in its own window.',
	shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				date: { kind: 'text' },
				days: { kind: 'number' },
				unpaid_days: { kind: 'number', optional: true },
				hours: { kind: 'number', optional: true },
				catalogue_id: { kind: 'text' },
				employment_term_id: { kind: 'text' },
				holiday_id: { kind: 'text', optional: true },
				shift_definition_id: { kind: 'text', optional: true },
				work_day_id: { kind: 'text', optional: true }
			}
		}
	}
});
export default f;
f.validate((rows) => {
	for (const row of rows) {
		if (
			!(row.days > 0 && row.days <= 1) ||
			(row.hours == null ? !Number.isInteger(row.days * 8) : !(row.hours > 0))
		)
			return 'A charge is a whole or half day, or an eighth of one for a row taken by the hour.';
		if (row.unpaid_days != null && !(row.unpaid_days >= 0 && row.unpaid_days <= row.days))
			return 'Unpaid time must fit within its approved leave charge.';
		const ids = [row.catalogue_id, row.employment_term_id];
		if (row.shift_definition_id != null) ids.push(row.shift_definition_id);
		if (row.holiday_id != null) ids.push(row.holiday_id);
		if (row.work_day_id != null) ids.push(row.work_day_id);
		if (!isCalendarDate(row.date) || !ids.every(isSettledId))
			return 'A charge names a real calendar day and its inputs by id.';
	}
	return undefined;
});
