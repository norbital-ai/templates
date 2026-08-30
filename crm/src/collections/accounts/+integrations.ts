import { defineConnection, definePull } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import type { Integrations } from './$types.js';

/**
 * The external system of record this workspace mirrors from.
 *
 * `baseUrl` is a deployment fact, so a template can only ship a placeholder — repoint it before
 * enabling the integration. The credential is a *reference*: the name is declared in `src/+env.ts`
 * and resolved by the host at call time, so no secret value ever lives in the workspace.
 */
const erp = defineConnection({
	baseUrl: 'https://erp.internal.example/api/v1',
	authentication: { type: 'bearer', token: { env: 'EXTERNAL_SYSTEM_TOKEN' } }
});

/** The seven currencies `accounts.currency` admits, so the feed is gated on them rather than on `string`. */
const Currency = Schema.Literals(['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'SGD', 'HKD']);

/**
 * Inbound: the ERP syncs customers into our table.
 *
 * `input` describes **one customer**, not the whole page. That is what lets a single malformed
 * customer cost one customer: the platform selects the array named by `records`, decodes each entry
 * on its own, and reports the ones it refused rather than discarding the page they arrived in.
 *
 * `identity` is what makes the job safe to run twice. `external_code` is the ERP's customer code and
 * carries a unique index on the model, so the second run matches and updates the rows the first run
 * wrote instead of inserting a second copy of each.
 *
 * `cursor` is the incremental mode: the platform sends the cursor it kept as `?since=` and reads the
 * next one off `x-next-cursor`, so a missed window resumes where it stopped rather than re-reading
 * the whole customer master.
 */
export default {
	erp: {
		// Read is owned once by `accounts_read`; this binding-specific policy adds only import writes.
		policies: ['accounts_read', 'erp_accounts_integration'],
		connection: erp,
		receive: {
			customers_changed: definePull({
				pull: {
					schedule: '15 * * * *',
					method: 'GET',
					path: '/masters/customers/changed',
					cursor: { send: { query: 'since' }, next: { header: 'x-next-cursor' } },
					retry: { attempts: 3 }
				},
				records: { field: 'customers' },
				input: Schema.Struct({
					external_code: Schema.Trimmed.check(Schema.isMinLength(1)),
					name: Schema.Trimmed.check(Schema.isMinLength(1)),
					currency: Schema.optionalKey(Currency),
					active: Schema.optionalKey(Schema.Boolean)
				}),
				identity: { column: 'external_code', value: (customer) => customer.external_code },
				// Declared here rather than left to the collection's `import` pipeline: that pipeline is fed
				// by the spreadsheet upload path and is typed for a whole delivered page, where a pull hands
				// it one record at a time. The nearer declaration wins, and this is the nearer declaration.
				map: (customer) => ({
					external_code: customer.external_code,
					name: customer.name,
					currency: customer.currency ?? null,
					active: customer.active ?? true
				})
			})
		}
	}
} satisfies Integrations;
