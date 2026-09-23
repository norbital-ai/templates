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
		/**
		 * The dispatch system's reference for this work, when an imported sheet carries one.
		 *
		 * Nullable for the same reason `sites.site_code` is: a job somebody files here was never
		 * dispatched elsewhere and has no reference to carry. The unique index is what keeps a sheet
		 * imported twice from filing the same job twice.
		 */
		external_ref: text(),
		/**
		 * The work order and the dispatch of it, in one row.
		 *
		 * These used to be two collections: `jobs` was the work order a controller filed, and
		 * `job_assignments` was the labour record hung off it. But a job had exactly one assignment
		 * (`job_id` was unique), every assignment field was written by the dispatch gesture, and the
		 * job's own `status` was derived from the assignment's — so the pairing was one entity split
		 * across two rows, with the split maintained by two automations. The work order is now this
		 * row: a controller files or imports it unassigned, and the dispatch is the act of naming
		 * who holds it.
		 */
		site_id: uuid().notNull(),
		title: text({ search: true }).notNull(),
		nature: text(),
		scheduled_for: instant({ precision: 'day' }).notNull(),
		description: text().notNull(),
		/**
		 * The person this work was dispatched to — `user.id`, directly, and null while nobody holds it.
		 *
		 * There is no contractor record between the dispatch and the person, and there is nothing for
		 * one to hold: a contractor is a user whose team confers `field_ops_contractor`. Holding the
		 * user id here is what lets the contractor policy scope by column comparison instead of a
		 * subquery, and what removes a profile row a contractor could fail to have.
		 */
		assignee_user_id: uuid(),
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
		 * so neither can overwrite this. `dispatched` and `in_progress` collapse into `assigned`: both
		 * mean somebody holds the work, and nothing in this workspace ever distinguished them.
		 */
		status: enums(['unassigned', 'assigned', 'completed']),
		completed_at: instant(),
		amount_charged: custom('money'),
		location: geolocation(),
		summary: text({ search: true }),
		/**
		 * Search-only copy of the work's title, site name and site code.
		 *
		 * Collection search is deliberately compiled from searchable columns on the collection being
		 * queried; it does not smuggle relationship labels into a root predicate. The transform owns
		 * this value and overwrites caller input from its own title and the site it names, so a board
		 * card titled “PINE GROVE” can be found by the same words — and by the site's code — without
		 * changing what `summary` means to the contractor.
		 */
		search_text: text({ search: true }),
		source_message_id: text(),
		/** Written only by the suspicion-review automation after a successful review. */
		suspicion_checked_at: instant()
	},
	{
		description:
			'One dispatched day job: the work order, who holds it and where it got to. Evidence facts and suspicion judgements live in their own collections.',
		/**
		 * The work order’s own title is the label.
		 *
		 * A label has to be a column on this collection, and the title is the only column that says
		 * which job this is — “Installation — 112, Hillview Crescent, S669505”. The derived
		 * `search_text` beside it carries the same words plus the site's, so search finds an
		 * assignment by either.
		 */
		recordLabel: 'title',
		icon: 'lucide:clipboard-check',
		indexes: [
			{ columns: ['external_ref'], unique: true },
			{ columns: ['source_message_id'], unique: true },
			{ columns: ['site_id'] },
			{ columns: ['scheduled_for'] },
			{ columns: ['assignee_user_id'] }
		]
	}
);
