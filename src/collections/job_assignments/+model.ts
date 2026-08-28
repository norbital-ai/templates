import {
	custom,
	defineModel,
	enums,
	geolocation,
	instant,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		job_id: uuid().notNull(),
		/**
		 * The person this job was dispatched to — `user.id`, directly.
		 *
		 * There is no contractor record between the assignment and the person, and there is nothing
		 * for one to hold: a contractor is a user whose team confers `field_ops_contractor`. Holding
		 * the user id here is what lets the contractor policy scope by column comparison instead of a
		 * subquery, and what removes a profile row a contractor could fail to have.
		 */
		assignee_user_id: uuid().notNull(),
		dispatched_at: instant(),
		/**
		 * Where the work has got to, and nothing else.
		 *
		 * Three states, because there are three: nobody is on it, somebody is, or it is done. It used
		 * to be `dispatched | in_progress | completed | suspect`, which mixed two different questions
		 * into one column — `suspect` is a *finding* about the work, not a stage of it, so a mismatched
		 * photograph erased whether the job was assigned or finished and dispatch could no longer see a
		 * suspicious job that had nonetheless been completed. Findings live in
		 * `suspicious_activity_logs`, and lateness is derived from `scheduled_for` rather than stored,
		 * so neither can overwrite this.
		 *
		 * `dispatched` and `in_progress` collapse into `assigned`: both mean somebody holds the work,
		 * and nothing in this workspace ever distinguished them — no surface filtered on the
		 * difference and no rule turned on it.
		 */
		status: enums(['unassigned', 'assigned', 'completed']),
		completed_at: instant(),
		amount_charged: custom('money'),
		location: geolocation(),
		summary: text({ search: true }),
		/**
		 * Search-only copy of the related job title.
		 *
		 * Collection search is deliberately compiled from searchable columns on the collection being
		 * queried; it does not smuggle relationship labels into a root predicate. The create hook owns
		 * this value and overwrites caller input from `jobs.title`, so a board card titled “PINE GROVE”
		 * can be found by the same words without changing what `summary` means to the contractor.
		 */
		search_text: text({ search: true }),
		source_message_id: text(),
		/** Written only by the suspicion-review automation after a successful review. */
		suspicion_checked_at: instant()
	},
	{
		description:
			'A job dispatched to one person. Tracks dispatch and on-site progression; evidence facts and suspicion judgements live in their own collections.',
		recordLabel: 'summary',
		icon: 'lucide:clipboard-check',
		indexes: [
			{ columns: ['source_message_id'], unique: true },
			{ columns: ['job_id'], unique: true },
			{ columns: ['assignee_user_id'] }
		]
	}
);
