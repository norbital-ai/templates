import { customField } from '@norbital-ai/bolt';
import { fault } from '../../../lib/datatypes/fault.js';
import { standard } from '../../../lib/datatypes/proration_basis.js';

const f = customField({
	description:
		'The divisor a jurisdiction prorates a monthly wage by across a partial period: calendar days (over the month, or over a fixed month such as 30), working days, or a fixed number of days such as 26.',
	shape: {
		kind: 'union',
		by: 'by',
		arms: {
			CALENDAR_DAYS: { days: { kind: 'number', optional: true } },
			WORKING_DAYS: {},
			FIXED_DAYS: { days: { kind: 'number' } }
		}
	}
});
export default f;
f.validate((value) => fault(standard, value));
