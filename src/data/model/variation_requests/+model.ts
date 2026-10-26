import { model } from '@norbital-ai/bolt';
/**
 * On-site variation order: a request to change the approved scope, raised against one job assignment; the message it came
 * from is create-only. A contractor raising one, or changing its amount, is held for approval (the contractor policy's
 * flow: Field Operations Controllers review, Commercial Managers sign off a large one).
 */
export default model('variation_requests', {
	description:
		'On-site variation order: a request to change the approved scope. A contractor raises it through an approval that Field Operations Controllers decide.',
	icon: 'lucide:git-pull-request-arrow',
	label: 'title',
	fields: {
		job_assignment_id: { kind: 'ref', to: 'job_assignments', inverse: 'variation_requests' },
		requested_at: { kind: 'instant' },
		title: { kind: 'text' },
		description: { kind: 'text' },
		amount: { kind: 'money', optional: true },
		source_message_id: { kind: 'text', optional: true, unique: true }
	},
	search: { text: ['title'] },
	read: 'all',
	create: {
		columns: [
			'job_assignment_id',
			'requested_at',
			'title',
			'description',
			'amount',
			'source_message_id'
		]
	},
	update: { columns: ['job_assignment_id', 'requested_at', 'title', 'description', 'amount'] },
	delete: {}
});
