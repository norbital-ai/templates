import { policy } from '@norbital-ai/bolt';

/** Their own assignments: the one collection where the member appears as a column. */
const OWN = { assignee_user_id: { eq: { actor: 'id' } } } as const;
const OWN_JOB = { job_assignment_id: { is: OWN } } as const;

/**
 * The contractor: the jobs they were assigned and nothing else. Everything is scoped through the assignment's
 * `assignee_user_id`; read masks are part of the boundary (processing and provenance fields stay private). A
 * variation is a commercial decision, so raising or changing one is held for Field Operations Controllers.
 */
export default policy({
	description:
		'Self-scoped access to assigned work, with narrowly fielded mutations and linked evidence.',
	capabilities: { apps: ['field_ops_contractor'] },
	grants: {
		sites: {
			read: {
				where: { job_assignments: { some: OWN } },
				fields: [
					'id',
					'site_code',
					'name',
					'location',
					'address',
					'client_name',
					'house_type',
					'floor_area_sqm'
				]
			}
		},
		job_assignments: {
			read: {
				where: OWN,
				fields: [
					'id',
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
					'search_text'
				]
			},
			update: {
				where: OWN,
				fields: [
					'status',
					'completed_at',
					'amount_charged',
					'location',
					'location_address',
					'summary'
				]
			}
		},
		variation_requests: {
			read: {
				where: OWN_JOB,
				fields: ['id', 'job_assignment_id', 'requested_at', 'title', 'description', 'amount']
			},
			create: {
				fields: ['job_assignment_id', 'requested_at', 'title', 'description', 'amount'],
				approval: { steps: [['Field Operations Controllers']] }
			},
			update: {
				fields: ['title', 'description', 'amount'],
				approval: { steps: [['Field Operations Controllers']] }
			}
		},
		photo_evidence: {
			read: {
				where: {
					or: [OWN_JOB, { variation_request_id: { is: OWN_JOB } }]
				},
				fields: ['id', 'job_assignment_id', 'variation_request_id', 'photo', 'summary']
			},
			create: { fields: ['job_assignment_id', 'variation_request_id', 'photo'] }
		},
		communication_logs: {
			read: {
				where: OWN_JOB,
				fields: ['id', 'job_assignment_id', 'message', 'sent_at', 'sender']
			},
			create: {
				fields: ['job_assignment_id', 'message', 'sent_at', 'sender', 'source_message_id']
			}
		}
	},
	limits: { act: '600/min', read: '600/min', agent: '100/h' }
});
