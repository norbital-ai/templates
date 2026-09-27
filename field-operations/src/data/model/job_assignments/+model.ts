import { model } from '@norbital-ai/bolt';

/**
 * The work order and its dispatch in one row: filed unassigned, dispatched by naming who holds it. `status` is where
 * the work got to; findings about it live in `suspicious_activity_logs`, so a suspicion never erases progress.
 */
export default model({
	description:
		'One dispatched day job: the work order, who holds it and where it got to. Evidence facts and suspicion judgements live in their own collections.',
	icon: 'lucide:clipboard-check',
	label: 'title',
	fields: {
		/** The dispatch system's reference, when an imported sheet carries one; a sheet imported twice files once. */
		external_ref: { kind: 'text', optional: true, unique: true },
		title: { kind: 'text' },
		nature: { kind: 'text', optional: true },
		scheduled_for: { kind: 'date' },
		description: { kind: 'text' },
		dispatched_at: { kind: 'instant', optional: true },
		status: {
			kind: 'enum',
			values: ['unassigned', 'assigned', 'completed'],
			default: 'unassigned'
		},
		completed_at: { kind: 'instant', optional: true },
		amount_charged: { kind: 'money', optional: true },
		/** Where the contractor reported the work from. */
		location: { kind: 'point', optional: true },
		location_address: { kind: 'text', optional: true },
		summary: { kind: 'text', optional: true },
		/** Search copy of the title and the site's name and code; the transform owns it. */
		search_text: { kind: 'text', optional: true, hidden: true },
		/** The channel message a job came from; retries of one delivery file it once. */
		source_message_id: { kind: 'text', optional: true, unique: true },
		/** Written by the suspicion review only; any other change clears it. */
		suspicion_checked_at: { kind: 'instant', optional: true, hidden: true }
	},
	index: ['scheduled_for', 'suspicion_checked_at'],
	search: {
		text: ['title', 'summary', 'search_text'],
		// `/semantic` in the jobs search box: the work described, on the host's default embedding model
		semantic: { fields: ['title', 'description', 'summary'], model: 'default' }
	}
});
