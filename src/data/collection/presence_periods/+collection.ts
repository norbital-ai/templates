import { collection } from '@norbital-ai/bolt';
import { readRange } from '../../../lib/payroll/run/effective.js';
import { dateKey } from '../../../lib/iso-day.js';

const presencePeriods = collection('presence_periods', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: ['employee_id', 'jurisdiction_code', 'period', 'employment_exercised', 'reference']
		}
	},
	update: {
		input: { columns: ['jurisdiction_code', 'period', 'employment_exercised', 'reference'] }
	},
	delete: {}
});
export default presencePeriods;

/** A stay names its jurisdiction, an entry day, an exit day not before it (or none while it runs) and evidence. */
presencePeriods.transform(async (inputs, { existing, refuse }) => {
	for (const [index, input] of inputs.entries()) {
		const row = { ...existing[index], ...input };
		if (!(row.jurisdiction_code ?? '').trim())
			refuse('A stay names its jurisdiction.', { field: 'jurisdiction_code' });
		const period = readRange(row.period);
		const start = dateKey(period?.start);
		if (start === '' || (period?.end != null && dateKey(period.end) < start))
			refuse('A stay needs an entry day and an exit day on or after it.', { field: 'period' });
		if (!(row.reference ?? '').trim())
			refuse('A stay requires a source reference.', { field: 'reference' });
	}
	return inputs;
});
