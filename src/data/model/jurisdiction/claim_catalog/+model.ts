import { model } from '@norbital-ai/bolt';

export default model({
	description: 'One claim_catalog record.',
	icon: 'lucide:file-text',
	label: 'entry_schema',
	fields: {
		entry_schema: { kind: 'text', optional: true },
		pricing: { kind: 'text', optional: true },
		code: { kind: 'text', optional: true },
		name: { kind: 'text', optional: true },
		authority: { kind: 'text', optional: true },
		destination: { kind: 'text', optional: true },
		direction: { kind: 'text', optional: true },
		bands: { kind: 'text', optional: true },
		eligibility: { kind: 'text', optional: true },
		qualifies_when: { kind: 'text', optional: true },
		evidence: { kind: 'text', optional: true },
		request_requirements: { kind: 'text', optional: true },
		request_facts: { kind: 'text', optional: true },
		assessed_for: { kind: 'text', optional: true },
		counts_toward: { kind: 'text', optional: true }
	}
});
