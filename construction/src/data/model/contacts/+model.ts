import { model } from '@norbital-ai/bolt';
import { TRADE_SPECIALTIES } from '../../../lib/trades.js';
import { requeueMessages } from '../project_messages/intake.js';

const columns = [
	'full_name',
	'company_name',
	'role',
	'trade_specialty',
	'phone',
	'email',
	'payment_terms_days',
	'registration_no',
	'status',
	'notes'
] as const;

/**
 * Subcontractors (specialized by trade: roofing, flooring, MnE, structural, etc.), suppliers,
 * main contractors, consultants, and clients. Computed WhatsApp phone & email keys route incoming messages.
 */
export default model('contacts', {
	description:
		'Business partners — customers/clients, material vendors/suppliers, trade subcontractors, main contractors, and consultants for commercial orders, transactions, and WhatsApp/email routing.',
	icon: 'lucide:handshake',
	record_label:
		"record.company_name != null ? record.company_name + ' · ' + record.full_name : record.full_name",
	fields: {
		full_name: { kind: 'text' },
		company_name: { kind: 'text', optional: true },
		role: {
			kind: 'enum',
			values: [
				'subcontractor',
				'supplier',
				'main_contractor',
				'client',
				'consultant',
				'architect',
				'qs',
				'site_engineer',
				'project_manager'
			],
			default: 'subcontractor'
		},
		trade_specialty: {
			kind: 'enum',
			values: [...TRADE_SPECIALTIES],
			default: 'general'
		},
		phone: { kind: 'text', format: 'phone', optional: true },
		email: { kind: 'text', format: 'email', optional: true },
		/** The partner's standard payment terms, used for documents that no contract governs. */
		payment_terms_days: { kind: 'int', min: 0, max: 180, optional: true },
		registration_no: { kind: 'text', optional: true },
		status: {
			kind: 'enum',
			values: ['active', 'inactive'],
			default: 'active'
		},
		notes: { kind: 'text', optional: true },
		email_key: { kind: 'text', computed: 'lower(email)' },
		phone_key: { kind: 'text', computed: "regex_replace(phone, r'\\D', '')" }
	},
	indexes: {
		by_email_key: { on: ['email_key'] },
		by_phone_key: { on: ['phone_key'] },
		by_trade: { on: ['trade_specialty', 'role'] },
		find: { text: ['full_name', 'company_name', 'phone', 'email', 'registration_no'] }
	},
	outputs: { default: { fields: 'all' } },
	create: {
		fields: columns,
		effect: function* (_changes, ctx) {
			yield* requeueMessages({}, ctx);
		}
	},
	update: {
		fields: columns,
		effect: function* (changes, ctx) {
			if (changes.some((c) => c.changed('phone', 'email'))) {
				yield* requeueMessages({}, ctx);
			}
		}
	},
	delete: {}
});
