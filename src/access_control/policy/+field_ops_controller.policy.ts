import { policy } from '@norbital-ai/bolt';
/** Every job field but the review's stamp; the identity keys are create-only by the model. */
const JOB_FIELDS = [
	'site_id',
	'title',
	'nature',
	'scheduled_for',
	'description',
	'assignee_user_id',
	'dispatched_at',
	'status',
	'completed_at',
	'amount_charged',
	'location',
	'location_address',
	'summary'
] as const;
/**
 * Dispatch: full command of sites, jobs and evidence, and the review ledgers. Audit ledgers are
 * append-only: controllers read and append received messages and AI decisions and never rewrite them; a finding is
 * closed only by resolving it.
 */
export default policy({
	description:
		'Controller access to dispatch records, private review records, and immutable communication or AI audit ledgers.',
	capabilities: { apps: ['field_ops_controller', 'field_ops_contractor'] },
	automations: [
		'review_job_assignment_suspicion',
		'site_handover',
		'job_assignments_import_work_orders',
		'suspicious_activity_logs_resolve'
	],
	grants: {
		sites: { read: true, create: true, update: true, delete: true },
		job_assignments: {
			read: true,
			create: true,
			update: {
				columns: {
					job_assignments: JOB_FIELDS,
					'job_assignments.photo_evidence': ['photo', 'source'],
					'job_assignments.communication_logs': [
						'message',
						'sent_at',
						'sender',
						'source_message_id'
					]
				}
			},
			delete: true
		},
		suspicious_activity_logs: {
			read: true,
			create: true,
			update: true
		},
		photo_evidence: { read: true, create: true, update: true, delete: true },
		communication_logs: { read: true, create: true },
		suspicion_reviews: { read: true, create: true },
		sys_user: { read: true }
	},
	limits: { act: '600/min', read: '600/min', agent: '100/h' }
});
