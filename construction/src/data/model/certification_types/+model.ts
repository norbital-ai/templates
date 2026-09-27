import { model } from '@norbital-ai/bolt';

export default model({
	description: 'Certification library used to define workforce requirements.',
	icon: 'lucide:badge-check',
	label: 'certification_name',
	fields: {
		certification_name: { kind: 'text' },
		certification_code: { kind: 'text', optional: true, unique: true },
		category: { kind: 'text', optional: true },
		issuing_body: { kind: 'text', optional: true },
		validity_period_months: { kind: 'decimal', scale: 2, optional: true },
		requires_refresher: { kind: 'bool', optional: true },
		description: { kind: 'text', optional: true },
		requirements: { kind: 'text', many: true, optional: true }
	},
	search: { text: ['certification_name'] }
});
