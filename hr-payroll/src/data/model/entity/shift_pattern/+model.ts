import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One named roster cycle of an entity: its days name shift definitions in order, and every employment of the entity projects its days from the pattern in force. The cycle is any length — a 4-day two-on-two-off, a 7-day week, a 14-day day/night rotation — and day 1 is the day its effective range opens. A rotation between shifts or batches is the other pattern taking effect, not a longer cycle. A roster of record overrides it for its month.',
	icon: 'lucide:repeat',
	label: 'code',
	fields: {
		code: {
			kind: 'text'
		},
		name: {
			kind: 'text',
			optional: true
		},
		pattern: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					days: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: {
								roster_code_id: {
									kind: 'text',
									optional: true
								}
							}
						}
					}
				}
			}
		},
		effective_range: {
			kind: 'period',
			of: 'date',
			optional: true
		}
	}
});
