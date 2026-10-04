import { model } from '@norbital-ai/bolt';

export default model({
	description: 'One roster_entry record.',
	icon: 'lucide:file-text',
	label: 'shift_definition_id',
	fields: {
		shift_definition_id: { kind: 'text', optional: true },
		work_date: { kind: 'text', optional: true },
		worked_intervals: { kind: 'text', optional: true },
		approved_overtime_hours: { kind: 'text', optional: true },
		overtime_consented_at: { kind: 'instant', optional: true },
		incentive_hours: { kind: 'text', optional: true },
		worksite: { kind: 'text', optional: true },
		facts: { kind: 'text', optional: true }
	}
});
