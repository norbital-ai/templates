import { defineConnection, definePull } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import type { Integrations } from './$types.js';

/**
 * Inbound RFIs from the external reports system.
 *
 * This binding used to be declared as a webhook — an HMAC-signed delivery the host verified before
 * it crossed in, deduplicated on `x-reports-event-id`. **Bolt has no inbound binding.** A receive
 * binding is a scheduled pull and nothing else: there is no signature verification anywhere in the
 * runtime, and while `Integrations.receive` will write a delivery into `bolt_integration_inbox`,
 * nothing reads that table and no authored declaration can route to it.
 *
 * So this is the same integration expressed the only way the platform can currently run it, and the
 * differences are real rather than cosmetic: updates arrive on a fifteen-minute schedule instead of
 * on the event, the reports system has to offer a changed-since endpoint, and replay safety now
 * comes from `identity` matching `rfi_number` rather than from an event id. Restore the webhook when
 * there is an inbound binding to restore it to.
 */
const reports = defineConnection({
	baseUrl: 'https://reports.internal.example/api/v1',
	authentication: { type: 'bearer', token: { env: 'REPORTS_API_TOKEN' } }
});

export default {
	reports: {
		// Compose the sole shared read owner with this binding's write-only import authority.
		policies: ['construction_read', 'reports_integration'],
		connection: reports,
		receive: {
			rfi: definePull({
				pull: {
					schedule: '*/15 * * * *',
					method: 'GET',
					path: '/rfis/changed',
					cursor: { send: { query: 'since' }, next: { maxOf: 'updated_at' } },
					retry: { attempts: 3 }
				},
				records: { field: 'rfis' },
				input: Schema.Struct({
					number: Schema.Trimmed.check(Schema.isMinLength(1)),
					title: Schema.Trimmed.check(Schema.isMinLength(1)),
					subject: Schema.optionalKey(Schema.String),
					question: Schema.optionalKey(Schema.String),
					status: Schema.optionalKey(Schema.Literals(['open', 'answered', 'closed'])),
					priority: Schema.optionalKey(Schema.Literals(['low', 'medium', 'high', 'critical'])),
					updated_at: Schema.String
				}),
				identity: { column: 'rfi_number', value: (rfi) => rfi.number },
				map: (rfi) => ({
					rfi_number: rfi.number,
					title: rfi.title,
					subject: rfi.subject ?? null,
					question: rfi.question ?? null,
					status: rfi.status ?? 'open',
					priority: rfi.priority ?? null
				})
			})
		}
	}
} satisfies Integrations;
