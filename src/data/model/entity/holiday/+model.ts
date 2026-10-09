import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One observed public holiday of one legal entity on one day. Published individually; a row a payroll run captured or a work day pins is frozen. Imported from a spreadsheet or entered by hand.',
	icon: 'lucide:calendar-x',
	label: 'date',
	fields: {
		date: {
			kind: 'date'
		},
		name: {
			kind: 'text'
		},
		kind: {
			kind: 'text',
			help: 'A kind the version governing the day lists (`rule_set` PAYROLL `holiday_kinds`): what the work and leave records price it as.'
		},
		published_at: {
			kind: 'instant',
			optional: true
		},
		replaces: {
			kind: 'date',
			optional: true
		},
		given_to: {
			kind: 'enum',
			values: ['EVERYONE', 'ONLY_IF_OFF_ON_REPLACED_DATE'],
			default: 'EVERYONE'
		}
	}
});
