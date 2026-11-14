import { policy } from '@norbital-ai/bolt';
/** Every job field but the review's stamp; the identity keys are create-only by the model. */
const JOB_FIELDS = [
	'site_id',
	'title',
	'nature',
	'scheduled_for',
	'description',
	'assignee_contact',
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
	capabilities: {
		apps: ['field_ops_controller', 'field_ops_contractor'],
		automations: [
			'review_job_assignment_suspicion',
			'site_handover',
			'job_assignments_import_work_orders',
			'suspicious_activity_logs_resolve'
		]
	},
	grants: {
		sites: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		job_assignments: {
			outputs: { default: {} },
			create: {},
			update: {
				fields: JOB_FIELDS,
				photo_evidence: { fields: ['photo', 'source'] },
				communication_logs: { fields: ['message', 'sent_at', 'sender', 'source_message_id'] }
			},
			delete: {}
		},
		suspicious_activity_logs: {
			outputs: { default: {} },
			create: {},
			update: {}
		},
		photo_evidence: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		communication_logs: { outputs: { default: {} }, create: {} },
		suspicion_reviews: { outputs: { default: {} }, create: {} },
		sys_user: { outputs: { default: {} } }
	}
});
