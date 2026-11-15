import { model } from '@norbital-ai/bolt';
import { PRODUCT_CODES } from '../../../lib/products.js';
/**
 * A bank the group holds trade and loan facilities with. How the team refers to it, its
 * cut-off time, and its facility terms word for word. Contacts and facilities hang off it.
 */
export default model('bank', {
	description: 'A bank the group holds facilities with.',
	icon: 'lucide:landmark',
	record_label: 'record.code',
	fields: {
		code: { kind: 'text', max: 20 },
		name: { kind: 'text' },
		cut_off_time: { kind: 'text', optional: true },
		settlement_instructions: { kind: 'text', optional: true },
		terms_notes: { kind: 'text', optional: true },
		/** What the bank does; a line on another product is flagged. */
		offered_products: { kind: 'enum', values: PRODUCT_CODES, many: true, optional: true },
		is_active: { kind: 'bool', default: true }
	},
	constraints: {
		bank_code: { unique: ['code'], import_key: true }
	},
	outputs: {
		default: {
			fields: 'all',
			contacts: { fields: ['role', 'name', 'email', 'phone', 'notes'] },
			facilities: { fields: ['name', 'currency', 'limit', 'status', 'max_tenor_days'] },
			watch_points: { fields: ['category', 'text', 'is_active'] },
			letters_of_offer: { fields: ['title', 'offer_date', 'next_review_date'] },
			documents: { fields: ['doc_type', 'advice_reference', 'advice_date', 'read_status'] }
		}
	},
	create: {
		fields: [
			'code',
			'name',
			'cut_off_time',
			'settlement_instructions',
			'terms_notes',
			'offered_products',
			'is_active'
		],
		contacts: { fields: ['role', 'name', 'email', 'phone', 'notes'] }
	},
	update: {
		fields: [
			'code',
			'name',
			'cut_off_time',
			'settlement_instructions',
			'terms_notes',
			'offered_products',
			'is_active'
		],
		contacts: { fields: ['role', 'name', 'email', 'phone', 'notes'] }
	}
});
