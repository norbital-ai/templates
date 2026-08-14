import { z } from 'zod';
import type { Integrations } from './$types.js';

/**
 * Inbound RFIs from the external reports system. The host verifies the HMAC before the
 * delivery crosses in; this workspace only names the secret.
 */
export default {
	reports: {
		receive: {
			rfi: {
				webhook: {
					authentication: {
						type: 'hmac-sha256',
						secret: { env: 'REPORTS_WEBHOOK_SECRET' },
						signatureHeader: 'x-reports-signature'
					},
					eventIdHeader: 'x-reports-event-id'
				},
				input: z.object({
					rfi: z.object({
						number: z.string().trim().min(1),
						title: z.string().trim().min(1)
					})
				})
			}
		}
	}
} satisfies Integrations;
