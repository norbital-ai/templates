import { model } from '@norbital-ai/bolt';

export default model({
	description: 'One obligation record.',
	icon: 'lucide:file-text',
	label: 'recipient_id',
	fields: {
		recipient_id: { kind: 'text', optional: true },
		duty_code: { kind: 'text', optional: true },
		authority: { kind: 'text', optional: true },
		subject_kind: { kind: 'text', optional: true },
		subject_id: { kind: 'text', optional: true },
		original_occurrence_key: { kind: 'text', optional: true },
		trigger_ref: { kind: 'text', optional: true },
		triggered_on: { kind: 'date', optional: true },
		due_on: { kind: 'date', optional: true },
		amount_due: { kind: 'text', optional: true },
		amount_settled: { kind: 'text', optional: true },
		state: { kind: 'text', optional: true },
		fulfilled_on: { kind: 'text', optional: true },
		waive_reason: { kind: 'text', optional: true },
		reference: { kind: 'text', optional: true },
		evidence_file: { kind: 'text', optional: true },
		facts: { kind: 'text', optional: true },
		retain_until: { kind: 'text', optional: true }
	}
});
