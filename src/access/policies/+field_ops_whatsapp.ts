import type { Policy } from './$types.js';

/**
 * The WhatsApp envoy's complete authority: mutate an existing assignment owned by the linked user.
 *
 * It cannot read or discover assignments, jobs, sites, evidence, communications, reviews, or
 * suspicion logs. It cannot mutate a new record or delete anything. The host may present an exact
 * existing assignment reference in trusted conversation context; without one, the envoy has no
 * authority to search for a target and must direct the contractor to the app or a controller.
 *
 * The linked account supplies only `subject.id`. Runtime drops its team policies and
 * administrator status, so this existing-record mutation remains the ceiling even when the linked
 * person has broader authority in the web app.
 */
export default {
	description:
		'The WhatsApp envoy may mutate approved progress fields on an existing assignment owned by the linked contractor, and nothing else.',
	capabilities: { apps: [], envoyHistory: 'this_envoy' },
	grants: {
		job_assignments: {
			mutate: {
				existing: {
					authorize: ({ record }, api) => record.assignee_user_id === api.requestor.id,
					fields: ['status', 'completed_at', 'location', 'summary', 'amount_charged']
				}
			}
		}
	},
	limits: {
		'collections.*': { window: '1 min', limit: 60, key: 'subject' },
		'envoys.receive': [
			{ window: '1 min', limit: 30, key: 'sender' },
			{ window: '1 min', limit: 300, key: 'subject' }
		],
		'envoys.registration': { window: '15 minutes', limit: 1, key: 'sender' }
	}
} satisfies Policy;
