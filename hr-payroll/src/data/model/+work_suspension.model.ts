import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'Blocked-out days of one legal entity: a date range of one cause (an employer-caused shutdown, a natural disaster, a strike — a kind the governing version lists), for one worksite or named employments, or everyone. The days show in the payslip’s work days and the leave attendance root; whether they count as attended, are excluded or are paid is the jurisdiction’s configuration.',
	icon: 'lucide:calendar-off',
	label: 'kind',
	fields: {
		kind: {
			kind: 'text',
			help: 'A code of the governing version’s suspension_kinds rule.'
		},
		starts_on: {
			kind: 'date'
		},
		ends_on: {
			kind: 'date'
		},
		worksite: {
			kind: 'text',
			optional: true,
			help: 'Only this worksite (the roster day’s, else the terms’ worksite fact); blank for the whole entity.'
		},
		employment_ids: {
			kind: 'json',
			shape: { kind: 'list', of: { kind: 'text' } },
			default: [],
			help: 'Only these employments; empty for everyone at the entity or worksite.'
		},
		facts: {
			kind: 'json',
			shape: {
				kind: 'record',
				of: { kind: 'json' }
			},
			default: {}
		}
	}
});
