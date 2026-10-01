import { customField } from '@norbital-ai/bolt';
import { isSettledId } from '../../../lib/iso-day.js';
const f = customField({
	description:
		'Immutable dated Leave claims and cash outputs settled by this payslip, including zero amounts and continued entries.',
	shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				leave_entry_id: { kind: 'text' },
				charges: { kind: 'custom', of: 'leave_charges' },
				pay_items: { kind: 'custom', of: 'leave_pay_items' }
			}
		}
	}
});
export default f;
f.validate((rows) =>
	rows.some((row) => !isSettledId(row.leave_entry_id))
		? 'A settled Leave claim must name its source entry.'
		: undefined
);
