import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'The roster of record for one employment over one calendar month. While it exists, the work days of that month are the schedule and outrank the shift pattern, and a payroll run refuses a cycle until every employed day inside it names a shift. Without one, the pattern projects every day.',
	icon: 'lucide:calendar-days',
	label: 'period',
	fields: {
		period: {
			kind: 'text'
		}
	}
});
