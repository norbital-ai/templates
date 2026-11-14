import { model } from '@norbital-ai/bolt';
/**
 * A bank rule or condition the team must keep in mind, usually from the letter of offer: approved
 * suppliers and caps, restrictions, documents, settlement, pricing.
 */
export default model('watch_point', {
	description: 'A bank rule or condition to keep in mind.',
	icon: 'lucide:triangle-alert',
	record_label: 'record.text',
	fields: {
		bank: { kind: 'ref', to: 'bank', inverse: 'watch_points', on_delete: 'cascade' },
		facility: {
			kind: 'ref',
			to: 'facility',
			inverse: 'watch_points',
			optional: true,
			on_delete: 'set_null'
		},
		category: {
			kind: 'enum',
			values: ['suppliers', 'restriction', 'documents', 'settlement', 'pricing', 'other'],
			default: 'other'
		},
		text: { kind: 'text' },
		is_active: { kind: 'bool', default: true }
	},
	outputs: {
		default: { fields: 'all', bank: { fields: ['code'] } }
	},
	create: { fields: ['bank', 'facility', 'category', 'text', 'is_active'] },
	update: { fields: ['bank', 'facility', 'category', 'text', 'is_active'] }
});
