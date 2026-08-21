import {
	boolean,
	defineModel,
	enums,
	geolocation,
	custom,
	text,
	timestamp,
	uuid
} from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		job_id: uuid().notNull(),
		/**
		 * The person this job was dispatched to — `bolt_auth_user.norbital_id`, directly.
		 *
		 * There is no contractor record between the assignment and the person, and there is nothing
		 * for one to hold: a contractor is a user whose team confers `field_ops_contractor`, and the
		 * only thing the deleted `contractor_profiles` row carried beyond this id was a company name
		 * that restated the person's own. Holding the user id here is what lets the contractor policy
		 * scope by column comparison instead of a subquery, and what removes the "profile" a
		 * contractor could fail to have.
		 */
		assignee_user_id: uuid().notNull(),
		dispatched_at: timestamp(),
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
		completed_at: timestamp(),
		amount_charged: custom('money'),
		location: geolocation(),
		summary: text({ search: true }),
		source_message_id: text(),
		/** Fail closed until a linked photo visibly establishes a site identifier. */
		site_identity_unverified: boolean().notNull().default(true),
		/** One-way integrity finding: a photographed identifier contradicts the assigned site. */
		site_identity_mismatch: boolean().notNull().default(false),
		site_identity_evidence_id: uuid(),
		extracted_site_name: text(),
		extracted_site_location: text(),
		extracted_unit_number: text(),
		site_identity_confidence: enums(['low', 'medium', 'high']),
		site_identity_checked_at: timestamp(),
		site_identity_rationale: text()
	},
	{
		description:
			'A job dispatched to one person. Tracks dispatch, on-site progression, and photo evidence.',
		recordLabel: 'summary',
		icon: 'lucide:clipboard-check',
		indexes: [
			{ columns: ['source_message_id'], unique: true },
			{ columns: ['job_id'], unique: true },
			{ columns: ['assignee_user_id'] }
		]
	}
);
