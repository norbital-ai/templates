import { model } from '@norbital-ai/bolt';

export default model({
	description: 'One leave_catalog record.',
	icon: 'lucide:file-text',
	label: 'entry_schema',
	fields: {
		entry_schema: { kind: 'text', optional: true },
		pricing: { kind: 'text', optional: true },
		code: { kind: 'text', optional: true },
		name: { kind: 'text', optional: true },
		description: { kind: 'text', optional: true },
		authority: { kind: 'text', optional: true },
		eligibility: { kind: 'text', optional: true },
		evidence: { kind: 'text', optional: true },
		unit: { kind: 'text', optional: true },
		can_encash: { kind: 'text', optional: true },
		encash_on_exit: { kind: 'text', optional: true },
		entitlement: { kind: 'text', optional: true },
		schedule: { kind: 'text', optional: true }
	}
});
