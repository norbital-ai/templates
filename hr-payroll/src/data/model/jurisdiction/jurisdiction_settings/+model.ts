import { model } from '@norbital-ai/bolt';

export default model({
	description: 'One jurisdiction_settings record.',
	icon: 'lucide:file-text',
	label: 'code',
	fields: {
		code: { kind: 'text', optional: true },
		jurisdiction_code: { kind: 'text', optional: true },
		name: { kind: 'text', optional: true },
		employee_input_schema: { kind: 'text', optional: true },
		entity_input_schema: { kind: 'text', optional: true },
		behaviours: { kind: 'text', optional: true },
		sealed_at: { kind: 'instant', optional: true },
		voided_at: { kind: 'instant', optional: true },
		void_reason: { kind: 'text', optional: true },
		payroll: { kind: 'text', optional: true },
		change_summary: { kind: 'text', optional: true },
		effective_range: { kind: 'json', optional: true }
	}
});
