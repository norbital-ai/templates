import { model } from '@norbital-ai/bolt';
/**
 * A bank's letter of offer for a facility: the dates that matter and the PDF itself.
 */
export default model('letter_of_offer', {
	description: 'A letter of offer from a bank, with its review date.',
	icon: 'lucide:file-signature',
	record_label: 'record.title',
	fields: {
		bank: { kind: 'ref', to: 'bank', inverse: 'letters_of_offer' },
		facility: {
			kind: 'ref',
			to: 'facility',
			inverse: 'letters_of_offer',
			optional: true,
			on_delete: 'set_null'
		},
		title: { kind: 'text' },
		offer_date: { kind: 'date', optional: true },
		next_review_date: { kind: 'date', optional: true },
		document: {
			kind: 'file',
			accept: ['application/pdf'],
			max: '10MiB',
			optional: true
		},
		notes: { kind: 'text', optional: true }
	},
	outputs: {
		default: { fields: 'all', bank: { fields: ['code'] } }
	},
	create: {
		fields: ['bank', 'facility', 'title', 'offer_date', 'next_review_date', 'document', 'notes']
	},
	update: {
		fields: ['bank', 'facility', 'title', 'offer_date', 'next_review_date', 'document', 'notes']
	}
});
