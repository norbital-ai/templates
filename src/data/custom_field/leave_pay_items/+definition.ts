import { customField } from '@norbital-ai/bolt';
import { isCalendarDate, isSettledId } from '../../../lib/iso-day.js';

const f = customField({
	description: 'Frozen Leave payment amounts. Reversals negate these outputs without repricing.',
	shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				reserved_line: { kind: 'enum', values: ['BASE'], optional: true },
				catalogue_id: { kind: 'text' },
				settings_id: { kind: 'text' },
				code: { kind: 'text' },
				bucket: { kind: 'enum', values: ['EARNING', 'ABSENCE'] },
				date: { kind: 'text', optional: true },
				amount: { kind: 'number' },
				quantity: { kind: 'number', optional: true },
				rate: { kind: 'number', optional: true }
			}
		}
	}
});
export default f;
f.validate((rows) =>
	rows.some(
		(row) =>
			row.code === '' ||
			!isSettledId(row.catalogue_id) ||
			!isSettledId(row.settings_id) ||
			(row.date != null && !isCalendarDate(row.date))
	)
		? 'A leave pay item names its catalogue, settings and code, on a real calendar day.'
		: undefined
);
