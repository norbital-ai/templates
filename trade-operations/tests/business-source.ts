import { Effect, Schema } from 'effect';
import type { Json } from '@norbital-ai/bolt/engine';
import { sync } from './synced-kit.js';
import type { T } from './kit.js';
import { fixtureId } from './test-runtime.js';
const instance = fixtureId('sys_integration', 'kingdee');

class BusinessFixtureInvalid extends Schema.TaggedError<BusinessFixtureInvalid>()(
	'BusinessFixtureInvalid',
	{
		reason: Schema.String
	}
) {}
const Record = Schema.Record(Schema.String, Schema.Json);
const fields = {
	parties: [
		'external_code',
		'source_number',
		'name',
		'kind',
		'currency',
		'active',
		'address',
		'phone',
		'source_updated_at'
	],
	products: [
		'external_code',
		'source_number',
		'name',
		'spec',
		'unit',
		'currency',
		'unit_price',
		'tax_rate',
		'active',
		'source_updated_at'
	],
	warehouses: [
		'external_code',
		'source_number',
		'name',
		'group_code',
		'active',
		'source_updated_at'
	],
	stock_snapshots: [
		'external_code',
		'lot_number',
		'unit_cost',
		'currency',
		'unit',
		'on_hand',
		'erp_committed',
		'as_of',
		'orders_as_of'
	],
	credit_snapshots: [
		'external_code',
		'currency',
		'credit_limit',
		'credit_used',
		'credit_hold',
		'as_of'
	],
	source_sales_lines: [
		'external_code',
		'lot_number',
		'unit_cost',
		'kind',
		'reference',
		'business_on',
		'source_updated_at',
		'seal_hash',
		'unit',
		'quantity',
		'currency',
		'net_amount',
		'tax_amount',
		'freight',
		'active'
	]
} as const;
type Collection = keyof typeof fields;

/** Internal model evidence for business-rule tests. This does not simulate the Kingdee SQL adapter. */
export const businessRows = Effect.fnUntraced(function* (
	t: T,
	collection: Collection,
	values: readonly Json[]
) {
	const rows = yield* Schema.decodeUnknownEffect(Schema.Array(Record))(values).pipe(
		Effect.mapError((cause) => new BusinessFixtureInvalid({ reason: String(cause) }))
	);
	const as = t.as(t.admin);
	const products =
		collection === 'stock_snapshots'
			? (yield* as.query('products', {
					where: { source: { eq: instance } },
					select: { external_code: true },
					all: true
				})).rows
			: [];
	const warehouses =
		collection === 'stock_snapshots'
			? (yield* as.query('warehouses', {
					where: { source: { eq: instance } },
					select: { external_code: true },
					all: true
				})).rows
			: [];
	const parties =
		collection === 'credit_snapshots'
			? (yield* as.query('parties', {
					where: { source: { eq: instance } },
					select: { external_code: true },
					all: true
				})).rows
			: [];
	const prepared = yield* Effect.try({
		try: () =>
			rows.map((row): Record<string, Json> => {
				const value: Record<string, Json> = {};
				for (const name of fields[collection]) if (row[name] !== undefined) value[name] = row[name];
				if (collection === 'stock_snapshots') {
					const product = products.find(
						(candidate) => candidate.external_code === row.product_code
					);
					const warehouse = warehouses.find(
						(candidate) => candidate.external_code === row.warehouse_code
					);
					if (!product || !warehouse)
						throw new BusinessFixtureInvalid({
							reason:
								'Business stock evidence requires existing source-scoped product and warehouse records'
						});
					value.product = product.id;
					value.warehouse = warehouse.id;
				}
				if (collection === 'credit_snapshots') {
					const party = parties.find((candidate) => candidate.external_code === row.party_code);
					if (!party)
						throw new BusinessFixtureInvalid({
							reason: 'Business credit evidence requires its existing source-scoped party'
						});
					value.party = party.id;
				}
				if (collection === 'source_sales_lines') {
					if (typeof row.order_id !== 'string' || typeof row.order_line_id !== 'string')
						throw new BusinessFixtureInvalid({
							reason: 'Sales evidence requires the existing order and sealed line identities'
						});
					value.order = row.order_id;
					value.order_line = row.order_line_id;
				}
				return value;
			}),
		catch: (cause) =>
			cause instanceof BusinessFixtureInvalid
				? cause
				: new BusinessFixtureInvalid({ reason: String(cause) })
	});
	if (!prepared.length) return;
	const outcome = yield* sync(t, collection, prepared, 'upsert');
	if (outcome.kind !== 'committed')
		return yield* new BusinessFixtureInvalid({ reason: JSON.stringify(outcome) });
});
