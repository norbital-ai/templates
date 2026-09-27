import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'Goods received against a confirmed purchase order. A receipt is an event, not a lifecycle document: it is written once, carries only what arrived, and the remaining-to-receive on the order is derived by subtracting received quantities from the ordered ones. Receiving never edits the order itself.',
	icon: 'lucide:package-check',
	label: 'doc_no',
	fields: {
		doc_no: { kind: 'seq', pattern: 'GRN-{yyyy}-{0000}' },
		received_date: { kind: 'date', default: { today: '' } },
		note: { kind: 'text', optional: true },
		received_at: { kind: 'instant', default: { now: '' } }
	},
	search: { text: ['doc_no'] }
});
