import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One person-day: the planned shift and the actual attendance side by side. Either may be absent. Holidays are overlaid from the entity’s published calendar by date, breaks are the gaps between the day’s intervals, premium work is derived from plan, attendance, calendar and the statutory rules in force, and overtime is planned on the day: the hours within the limits and the incentive hours beyond them.',
	icon: 'lucide:calendar-clock',
	label: 'work_date',
	fields: {
		work_date: {
			kind: 'date'
		},
		worked_intervals: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'period',
					of: 'instant'
				}
			},
			optional: true
		},
		approved_overtime_hours: {
			kind: 'decimal',
			scale: 12,
			min: 0,
			optional: true
		},
		banked_overtime_hours: {
			kind: 'decimal',
			scale: 2,
			min: 0,
			optional: true,
			help: 'Of the approved overtime, the hours the employee elected to bank as time off instead of pay.'
		},
		banked_overtime_band: {
			kind: 'text',
			optional: true,
			help: 'The overtime band (rate code) the banked hours were earned in.'
		},
		overtime_consented_at: {
			kind: 'instant',
			optional: true
		},
		incentive_hours: {
			kind: 'decimal',
			scale: 2,
			min: 0,
			optional: true
		},
		worksite: {
			kind: 'text',
			optional: true
		},
		facts: {
			kind: 'json',
			shape: {
				kind: 'record',
				of: { kind: 'json' }
			},
			default: {}
		}
	},
	// one person-day per employment: the work-day sheet matches and sets rows by it
	key: ['employment_id', 'work_date']
});
