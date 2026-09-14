import type { Policy } from './$types.js';

/**
 * The WhatsApp envoy's authority: read every assignment, mutate an existing one.
 *
 * It cannot create or delete records, reassign work, attach evidence, write communication logs,
 * or reach the private review collections. Reading assignments is what lets it answer a
 * contractor who names a job in their own words instead of requiring an exact reference up front;
 * mutation is still limited to the approved progress fields on a record that already exists.
 *
 * The linked account supplies only `subject.id`. Runtime drops its team policies and
 * administrator status, so this existing-record mutation remains the ceiling even when the linked
 * person has broader authority in the web app.
 */
export default {
	description:
		'The WhatsApp envoy may read every job assignment and mutate approved progress fields on an existing one, and nothing else.',
	capabilities: { apps: [] },
	grants: {
		job_assignments: {
			read: {},
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
