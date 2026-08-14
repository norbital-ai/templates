import { z } from 'zod';
import type { Integrations } from './$types.js';

/**
 * Inbound job updates from the dispatch system. The host verifies the HMAC before the
 * delivery crosses in; this workspace only names the secret.
 */
export default {
	dispatch: {
		receive: {
			job_updated: {
				webhook: {
					authentication: {
						type: 'hmac-sha256',
						secret: { env: 'DISPATCH_WEBHOOK_SECRET' },
						signatureHeader: 'x-dispatch-signature'
					},
					eventIdHeader: 'x-dispatch-event-id'
				},
				input: z.object({
					job: z.object({
						title: z.string().trim().min(1),
						scheduled_for: z.string().trim().min(1)
					})
				})
			}
		}
	}
} satisfies Integrations;
