import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'Vendors the business buys from. The table is the mirror of the external system of record: `external_code` is the system’s vendor code, and the import pipeline keeps the table in step with it. A purchase order inherits its currency and payment terms from the supplier, and snapshots the code and name so a later supplier rename never rewrites history.',
	icon: 'lucide:truck',
	label: 'name',
	fields: {
		external_code: { kind: 'text' },
		code: { kind: 'text', unique: true },
		name: { kind: 'text' },
		contact: { kind: 'text', optional: true },
		category: { kind: 'text', optional: true },
		currency: { kind: 'currency', optional: true },
		payment_terms_days: { kind: 'int', min: 0, max: 365, optional: true },
		phone: { kind: 'text', format: 'phone', optional: true },
		email: { kind: 'text', optional: true },
		address: { kind: 'text', optional: true },
		active: { kind: 'bool', default: true }
	},
	key: ['external_code'],
	index: ['name', 'active'],
	search: { text: ['name'] }
});
