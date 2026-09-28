import { customField } from '@norbital-ai/bolt';
import { isCalendarDate } from '../../../lib/iso-day.js';

const f = customField({
	description:
		'A wage paid after its agreed date (VN Labour Code 45/2019 art.97(4)): the day it was due, the day it was paid, and the 1-month term-deposit rate (% a year) the payroll bank published on the payment day, with the notice it came from. The request amount is the sum paid late.',
	shape: {
		kind: 'object',
		fields: {
			due_on: { kind: 'text' },
			paid_on: { kind: 'text' },
			deposit_rate: { kind: 'number' },
			rate_reference: { kind: 'text' },
			force_majeure: { kind: 'bool' }
		}
	}
});
export default f;

f.validate((details) => {
	if (!isCalendarDate(details.due_on) || !isCalendarDate(details.paid_on))
		return 'Enter valid due and paid dates.';
	if (details.paid_on <= details.due_on) return 'A late wage is paid after the day it was due.';
	if (!Number.isFinite(details.deposit_rate) || details.deposit_rate < 0)
		return 'Enter the bank’s published 1-month deposit rate.';
	if (details.rate_reference.trim() === '') return 'Identify the bank’s rate notice.';
});
