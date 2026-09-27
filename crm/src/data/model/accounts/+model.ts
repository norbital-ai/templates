import { model } from '@norbital-ai/bolt';
import { CURRENCIES } from '../../../lib/currency.js';

export default model({
	description:
		'Customer companies. The table is the mirror of the external system of record: `external_code` is the system’s customer code, and the import pipeline keeps the table in step with it.',
	icon: 'lucide:building-2',
	label: 'name',
	fields: {
		external_code: { kind: 'text' },
		name: { kind: 'text' },
		industry: { kind: 'text', optional: true },
		website: { kind: 'text', optional: true },
		phone: { kind: 'text', optional: true },
		currency: { kind: 'enum', values: CURRENCIES, optional: true },
		address: { kind: 'text', optional: true },
		credit_limit: { kind: 'decimal', scale: 2, optional: true },
		credit_used: { kind: 'decimal', scale: 2, optional: true },
		credit_hold: { kind: 'bool', optional: true },
		active: { kind: 'bool' }
	},
	key: ['external_code'],
	search: { text: ['name'] }
});
