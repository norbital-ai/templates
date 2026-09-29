import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'A stay in a jurisdiction: the entry and exit days a person was physically present there. A day of arrival or departure is a whole day (MY ITA 1967 s.7(1A)). The residence and short-stay tests count these days.',
	icon: 'lucide:plane-landing',
	label: 'reference',
	fields: {
		/** The jurisdiction stayed in, as `jurisdiction_settings.jurisdiction_code` (`MY`). */
		jurisdiction_code: { kind: 'text' },
		/** Entry day to exit day inclusive; an open end is a stay still running. */
		period: { kind: 'period', of: 'date' },
		/** Passport stamps, travel record or other evidence of the days. */
		reference: { kind: 'text' }
	},
	index: [['employee_id', 'jurisdiction_code']],
	noOverlap: [
		{
			key: ['employee_id', 'jurisdiction_code'],
			period: 'period',
			name: 'presence_periods_no_overlap'
		}
	],
	search: { text: ['reference'] }
});
