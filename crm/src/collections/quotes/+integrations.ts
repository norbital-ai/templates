import { defineConnection } from '@norbital-ai/bolt/authoring';
import type { Integrations } from './$types.js';

const erp = defineConnection({
	baseUrl: 'https://erp.internal.example/api/v1',
	authentication: { type: 'bearer', token: { env: 'EXTERNAL_SYSTEM_TOKEN' } }
});

/**
 * Outbound: the confirmed quote is handed to the system of record.
 *
 * A mutation matching `on` writes the record to the platform's transactional outbox in the same
 * transaction as the confirm — a delivery is never queued for a write that rolled back. The host
 * drains the outbox on its own schedule, so the confirm never waits on the partner: `body` shapes
 * the request from the row as it was committed, and delivery retries with capped backoff before
 * dead-lettering, where a failed delivery stays findable rather than vanishing.
 *
 * `body` is pure and synchronous, so it shapes what the row already carries and cannot look
 * anything else up. That is the same limit `map` has inbound, and it is deliberate: a lookup here
 * would be a query per delivery.
 */
export default {
	erp: {
		policies: [],
		connection: erp,
		send: {
			confirm: {
				on: {
					update: ({ previous, record }) =>
						previous.status !== 'confirmed' && record.status === 'confirmed'
				},
				send: { method: 'POST', path: '/docs/confirmed' },
				body: ({ record }) => ({
					reference: record.doc_no,
					status: record.status,
					currency: record.currency
				})
			}
		}
	}
} satisfies Integrations;
