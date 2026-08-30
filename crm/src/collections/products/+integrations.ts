import { defineConnection, definePull } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { erpMasterColumns } from '../../lib/erp-feed.js';
import type { Integrations } from './$types.js';

const erp = defineConnection({
	baseUrl: 'https://erp.internal.example/api/v1',
	authentication: { type: 'bearer', token: { env: 'EXTERNAL_SYSTEM_TOKEN' } }
});

/**
 * Inbound: the ERP syncs items into our table.
 *
 * `code` is required here and was not in the earlier draft of this file, because the model declares
 * `code` not-null with a unique index: a feed that omitted it produced rows the table would refuse,
 * and nothing typed the gap until `map` had to satisfy the collection's insert shape.
 */
export default {
	erp: {
		// Read is owned once by `products_read`; this binding-specific policy adds only import writes.
		policies: ['products_read', 'erp_products_integration'],
		connection: erp,
		receive: {
			items_changed: definePull({
				pull: {
					schedule: '15 * * * *',
					method: 'GET',
					path: '/masters/items/changed',
					cursor: { send: { query: 'since' }, next: { header: 'x-next-cursor' } },
					retry: { attempts: 3 }
				},
				records: { field: 'items' },
				input: Schema.Struct({
					external_code: Schema.Trimmed.check(Schema.isMinLength(1)),
					code: Schema.Trimmed.check(Schema.isMinLength(1)),
					name: Schema.Trimmed.check(Schema.isMinLength(1)),
					unit: Schema.optionalKey(Schema.String),
					unit_price: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
					active: Schema.optionalKey(Schema.Boolean)
				}),
				identity: { column: 'external_code', value: (item) => item.external_code },
				map: (item) => ({
					...erpMasterColumns(item),
					unit: item.unit ?? null,
					unit_price: item.unit_price ?? null
				})
			})
		}
	}
} satisfies Integrations;
