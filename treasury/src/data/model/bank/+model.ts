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
		contacts: {
			kind: 'json',
			optional: true,
			shape: {
				kind: 'object',
				many: true,
				fields: {
					role: {
						kind: 'enum',
						values: ['relationship_manager', 'client_service', 'trade_operations', 'other']
					},
					name: { kind: 'text' },
					email: { kind: 'text', format: 'email', optional: true },
					phone: { kind: 'text', optional: true },
					notes: { kind: 'text', optional: true }
				}
			}
		},
		cut_off_time: { kind: 'text', optional: true },
		/** What the bank does; a line on another product is flagged. */
		offered_products: { kind: 'enum', values: PRODUCT_CODES, many: true, optional: true }
	},
	constraints: {
		bank_code: { unique: ['code'], import_key: true }
	},
	outputs: {
		default: {
			fields: 'all',
			facilities: { fields: ['name', 'currency', 'limit', 'status', 'max_tenor_days'] },
			watch_points: { fields: ['facility', 'category', 'text', 'is_active'] },
			letters_of_offer: {
				fields: ['facility', 'title', 'offer_date', 'next_review_date', 'document', 'notes']
			},
			documents: { fields: ['doc_type', 'advice_reference', 'advice_date', 'read_status'] }
		}
	},
	create: {
		fields: ['code', 'name', 'contacts', 'cut_off_time', 'offered_products'],
		watch_points: { fields: ['facility', 'category', 'text', 'is_active'] },
		letters_of_offer: {
			fields: ['facility', 'title', 'offer_date', 'next_review_date', 'document', 'notes']
		}
	},
	update: {
		fields: ['code', 'name', 'contacts', 'cut_off_time', 'offered_products'],
		watch_points: { fields: ['facility', 'category', 'text', 'is_active'] },
		letters_of_offer: {
			fields: ['facility', 'title', 'offer_date', 'next_review_date', 'document', 'notes']
		}
	}
});
