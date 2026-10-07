import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One named shift of an entity: its day type, its clock times and its break. Roster codes on pattern days and roster entries name these.',
	icon: 'lucide:clock',
	label: 'code',
	fields: {
		code: {
			kind: 'text'
		},
		name: {
			kind: 'text',
			optional: true
		},
		variant: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					day_type: {
						kind: 'enum',
						values: ['WORK', 'REST', 'OFF'],
						optional: true,
						help: 'WORK: a working day; REST: the weekly rest day; OFF: a non-working day that is not the rest day.'
					},
					start_time: {
						kind: 'text',
						optional: true
					},
					end_time: {
						kind: 'text',
						optional: true
					},
					break_minutes: {
						kind: 'int',
						optional: true
					}
				}
			},
			optional: true
		},
		effective_range: {
			kind: 'period',
			of: 'date',
			optional: true
		}
	}
});
