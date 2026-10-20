import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One person-day: the planned shift and actual attendance side by side. Either may be absent. Hourly credit uses actual attendance inside the configured shift and its approved overtime windows; extra time cannot replace late arrival. Breaks follow the configured or documented duration and recorded interior gaps. Credited shortfalls and overtime round down to completed half-hours. The governing catalogue determines fixed salary and premium pay from plan, attendance, calendar and the statutory rules in force.',
	icon: 'lucide:calendar-clock',
	label: 'work_date',
	fields: {
		work_date: {
			kind: 'date'
		},
		planned_overtime_hours: {
			kind: 'decimal',
			scale: 2,
			min: 0,
			optional: true,
			help: 'The overtime duration approved alongside the shift code. Only this duration can be paid as overtime, limited by actual attendance and rounded down to completed half-hours. Blank means no approved overtime.'
		},
		approved_overtime_intervals: {
			kind: 'list',
			of: {
				kind: 'object',
				fields: {
					start: { kind: 'instant' },
					end: { kind: 'instant' },
					break_minutes: { kind: 'int', min: 0, optional: true }
				}
			},
			optional: true,
			help: 'The exact approved overtime windows and their documented unpaid break duration, when separately recorded. Attendance must fall inside these windows, net of their breaks, and remains limited by the approved overtime duration. Blank uses the extension after the configured shift.'
		},
		worked_intervals: {
			kind: 'list',
			of: { kind: 'period', of: 'instant' },
			optional: true
		},
		banked_overtime_hours: {
			kind: 'decimal',
			scale: 2,
			min: 0,
			optional: true,
			help: 'Of the day’s overtime, the hours the employee elected to bank as time off instead of pay.'
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
