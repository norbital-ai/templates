import { policy } from '@norbital-ai/bolt';

/** Every job field but the review's stamp; the identity keys are create-only by the collection. */
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
	'summary',
	'photo_evidence',
	'communication_logs'
] as const;

/**
 * Dispatch: full command of sites, jobs, variations and evidence, and the review ledgers. Audit ledgers are
 * append-only: controllers read and append received messages and AI decisions and never rewrite them; a finding is
 * closed only by resolving it.
 */
export default policy({
	description:
		'Controller access to dispatch records, private review records, and immutable communication or AI audit ledgers.',
	capabilities: { apps: ['field_ops_controller', 'field_ops_contractor'] },
	automations: ['review_job_assignment_suspicion', 'site_handover'],
	grants: {
		sites: { read: true, create: true, update: true, delete: true },
		job_assignments: {
			read: true,
			create: true,
			update: { fields: JOB_FIELDS },
			delete: true,
			actions: ['import_work_orders']
		},
		suspicious_activity_logs: {
			read: true,
			create: true,
			update: true,
			actions: ['resolve']
		},
		variation_requests: { read: true, create: true, update: true, delete: true },
		photo_evidence: { read: true, create: true, update: true, delete: true },
		communication_logs: { read: true, create: true },
		suspicion_reviews: { read: true, create: true },
		sys_user: { read: true }
	},
	limits: { act: '600/min', read: '600/min', agent: '100/h' }
});
