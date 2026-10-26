import { policy, type Flow } from '@norbital-ai/bolt';
import type { Decimal } from '@norbital-ai/std/decimal';
/** Their own assignments: the one model where the member appears as a column. */
const OWN = { assignee_user_id: { eq: { actor: 'id' } } } as const;
const OWN_JOB = { job_assignment_id: { is: OWN } } as const;
/** From this amount (SGD) a variation also needs commercial sign-off. */
const SIGN_OFF_FROM = 5000;
/** A variation's money is a commercial decision: controllers review it, and Commercial Managers sign off a large one. */
const review = (flow: Flow, amount: Decimal | null) =>
	flow
		.step('Controller review', { teams: ['field_ops_controllers'] })
		.if(amount !== null && amount.gte(SIGN_OFF_FROM), (f) =>
			f.step('Commercial sign-off', { teams: ['commercial_managers'] })
		)
		.supersededBy(['field_ops_controllers']);
/**
 * The contractor: the jobs they were assigned and nothing else. Everything is scoped through the assignment's
 * `assignee_user_id`; read masks are part of the boundary (processing and provenance fields stay private). Raising a
 * variation, or changing its amount, is held for that review; a wording fix is saved directly.
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
					'unit_number',
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
				where: OWN_JOB,
				fields: ['job_assignment_id', 'requested_at', 'title', 'description', 'amount'],
				approval: (write, flow) => review(flow, write.record.amount)
			},
			update: {
				where: OWN_JOB,
				fields: ['title', 'description', 'amount'],
				approval: (write, flow) =>
					write.changed.includes('amount') ? review(flow, write.record.amount) : flow.allow()
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
