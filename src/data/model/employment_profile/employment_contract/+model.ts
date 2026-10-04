import { model } from '@norbital-ai/bolt';

export default model({
	description: 'One employment_contract record.',
	icon: 'lucide:file-text',
	label: 'employee_number',
	fields: {
		employee_number: { kind: 'text', optional: true },
		contract_number: { kind: 'text', optional: true },
		bank: { kind: 'text', optional: true },
		effective_range: { kind: 'json', optional: true },
		signed_contract_end: { kind: 'text', optional: true },
		prior_service_months: { kind: 'text', optional: true },
		exit_ground: { kind: 'text', optional: true },
		exit_facts: { kind: 'text', optional: true },
		comments: { kind: 'text', optional: true },
		facts: { kind: 'text', optional: true }
	}
});
