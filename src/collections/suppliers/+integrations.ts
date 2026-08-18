import { defineConnection, definePull } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import type { Integrations } from './$types.js';

const erp = defineConnection({
	baseUrl: 'https://erp.internal.example/api/v1',
	authentication: { type: 'bearer', token: { env: 'EXTERNAL_SYSTEM_TOKEN' } }
});

const Currency = Schema.Literals(['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'SGD', 'HKD']);

/**
 * Inbound: the ERP syncs vendors into our table.
 *
 * The shape mirrors `accounts`: `input` is one vendor, `records` names the array it arrives in,
 * `identity` pins the ERP's vendor code to the column that carries the unique index, and `cursor`
 * makes each run read only what changed since the last one. `suppliers` *is* the mirror.
 */
export default {
	erp: {
		connection: erp,
		receive: {
			vendors_changed: definePull({
				pull: {
					schedule: '15 * * * *',
					method: 'GET',
					path: '/masters/vendors/changed',
					cursor: { send: { query: 'since' }, next: { header: 'x-next-cursor' } },
					retry: { attempts: 3 }
				},
				records: { field: 'vendors' },
				input: Schema.Struct({
					external_code: Schema.Trimmed.check(Schema.isMinLength(1)),
					code: Schema.Trimmed.check(Schema.isMinLength(1)),
					name: Schema.Trimmed.check(Schema.isMinLength(1)),
					currency: Schema.optionalKey(Currency),
					payment_terms_days: Schema.optionalKey(
						Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(365))
					),
					active: Schema.optionalKey(Schema.Boolean)
				}),
				identity: { column: 'external_code', value: (vendor) => vendor.external_code },
				map: (vendor) => ({
					external_code: vendor.external_code,
					code: vendor.code,
					name: vendor.name,
					currency: vendor.currency ?? null,
					payment_terms_days: vendor.payment_terms_days ?? null,
					active: vendor.active ?? true
				})
			})
		}
	}
} satisfies Integrations;
