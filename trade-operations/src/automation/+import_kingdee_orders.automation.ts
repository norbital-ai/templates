import { automation, instance_id, type DatabaseRequest } from '@norbital-ai/bolt';
import { BigDecimal, Schema } from 'effect';
import { hash } from '../lib/commercial.js';
const Configuration = Schema.Struct({
	branchNo: Schema.String,
	writeAccount: Schema.optionalKey(Schema.NullOr(Schema.String)),
	salespersonBindings: Schema.optionalKey(Schema.NullOr(Schema.String))
});
import { kingdeeWriteTarget } from '../integration/kingdee/configuration.js';
import { importedOrderKey } from '../integration/kingdee/order-identity.js';
import {
	checked,
	discoverSalesOrders,
	ownedSalesOrders
} from '../integration/kingdee/order-source.js';

/** New native families enter as one order plus its complete lines; existing families stay on their model syncs. */
export default automation({
	description: 'Imports Kingdee-created sales orders with their native UUID and complete lines.',
	on: [{ cron: '* * * * *' }],
	policies: ['kingdee_sync'],
	retry: { attempts: 3, backoff: '10s' },
	output: { kind: 'json' },
	run: function* (_input, ctx) {
		const { sys_integration, sys_user, parties, products } = yield* ctx.query({
			sys_integration: { where: { integration: { eq: 'kingdee' }, active: { eq: true } } },
			sys_user: { where: { active: { eq: true } }, fields: ['id'] },
			parties: { fields: ['source', 'external_code', 'active', 'kind', 'name'] },
			products: { fields: ['source', 'external_code', 'active', 'unit'] }
		});
		const issues: string[] = [];
		let imported = 0;
		for (const ledger of sys_integration.rows) {
			const configuration = yield* Schema.decodeUnknownEffect(Configuration)(ledger.configuration);
			const target = kingdeeWriteTarget(configuration);
			if (!target) continue;
			const instance = instance_id('kingdee', ledger);
			const { anchors } = yield* ownedSalesOrders(instance, ctx);
			const staged = (yield* ctx.query({
				orders: {
					where: { ledger: { eq: instance }, status: { eq: 'draft' } },
					fields: ['source_order_key']
				}
			})).orders.rows;
			const stagedKeys = new Set(staged.map((row) => row.source_order_key));
			const seen = new Set(anchors.map((anchor) => anchor.uuid));
			const candidates = yield* discoverSalesOrders(
				{ configuration, request: (op: DatabaseRequest) => ctx.request(instance, op) },
				target.account
			);
			const people = yield* checked(() =>
				Schema.decodeUnknownSync(
					Schema.Record(
						Schema.String,
						Schema.Struct({ employeeId: Schema.String, departmentId: Schema.String })
					)
				)(JSON.parse(configuration.salespersonBindings ?? '{}'))
			);
			const rows = [];
			for (const source of candidates) {
				if (seen.has(source.uuid)) continue;
				const party = parties.rows.find(
					(row) =>
						row.source === instance &&
						row.external_code === source.customer &&
						row.active &&
						row.kind !== 'supplier'
				);
				const owners = Object.entries(people)
					.filter(([, value]) => value.employeeId === source.employee)
					.map(([id]) => id);
				const owner = sys_user.rows.find((row) => row.id === owners[0]);
				const complete =
					source.lines.length > 0 &&
					source.lines.every((line) =>
						products.rows.some(
							(product) =>
								product.source === instance &&
								product.external_code === line.item &&
								product.active &&
								product.unit === line.unit
						)
					);
				if (!party || owners.length !== 1 || !owner || !complete) {
					issues.push(
						`${source.reference}: import waits for an active customer, every item/unit, and one salesperson binding.`
					);
					continue;
				}
				rows.push({
					source_order_key: importedOrderKey(target.account, target.branch, source.uuid),
					title: source.reference,
					direction: 'sales' as const,
					party: party.id,
					owner: owner.id,
					party_name: party.name,
					ledger: instance,
					status: 'draft' as const,
					write_target: target,
					tax_inclusive: false,
					currency: source.currency,
					payment_terms: source.payment_terms,
					ordered_on: source.ordered_on,
					kingdee: {
						fid: source.fid,
						reference: source.reference,
						version: source.version,
						status: source.status,
						closed: source.closed,
						exchange_rate: source.exchange_rate
					},
					lines: source.lines.flatMap((entry) => {
						const product = products.rows.find(
							(product) => product.source === instance && product.external_code === entry.item
						);
						return product
							? [
									{
										line_key: `kingdee:${entry.entry}`,
										source_entry_id: entry.entry,
										product: product.id,
										quantity: entry.quantity,
										unit_price: entry.exclusive,
										discount_pct: '0',
										tax_rate: entry.tax_rate
									}
								]
							: [];
					})
				});
			}
			const batch = [...rows];
			const fresh = batch.filter((row) => !stagedKeys.has(row.source_order_key));
			if (fresh.length)
				yield* ctx.act(
					{ 'orders.create': fresh },
					{ key: `create:${yield* hash(fresh.map((row) => row.source_order_key))}` }
				);
			if (batch.length) {
				const stored = (yield* ctx.query({
					orders: {
						where: {
							source_order_key: { in: batch.map((row) => row.source_order_key) },
							status: { eq: 'draft' }
						},
						lines: {}
					}
				})).orders.rows;
				const creates = [],
					updates = [],
					deletes = [];
				for (const order of stored) {
					const source = batch.find((row) => row.source_order_key === order.source_order_key);
					if (!source) continue;
					for (const entry of source.lines) {
						const product = products.rows.find(
							(product) => product.source === instance && product.id === entry.product
						);
						if (!product) continue;
						const line = order.lines.find((line) => line.source_entry_id === entry.source_entry_id);
						const values = {
							quantity: entry.quantity,
							unit_price: entry.unit_price,
							discount_pct: '0',
							tax_rate: entry.tax_rate
						};
						if (
							line &&
							!(['quantity', 'unit_price', 'discount_pct', 'tax_rate'] as const).every((field) =>
								BigDecimal.equals(
									BigDecimal.fromStringUnsafe(line[field]),
									BigDecimal.fromStringUnsafe(values[field])
								)
							)
						)
							updates.push({ target: { id: line.id, revision: line.revision }, set: values });
						else if (!line)
							creates.push({
								order: order.id,
								product: product.id,
								source_entry_id: entry.source_entry_id,
								line_key: `kingdee:${entry.source_entry_id}`,
								...values
							});
					}
					for (const line of order.lines)
						if (!source.lines.some((entry) => entry.source_entry_id === line.source_entry_id))
							deletes.push({ target: { id: line.id, revision: line.revision } });
				}
				// Native state rules require a draft insert before its confirmed transition. Resume any interrupted draft here.
				yield* ctx.act(
					{
						'orders.update': stored.map((order) => {
							const source = batch.find((row) => row.source_order_key === order.source_order_key);
							return {
								target: { id: order.id, revision: order.revision },
								set: {
									status: 'confirmed' as const,
									...(source
										? {
												party: source.party,
												owner: source.owner,
												currency: source.currency,
												payment_terms: source.payment_terms,
												ordered_on: source.ordered_on,
												kingdee: source.kingdee
											}
										: {})
								}
							};
						}),
						'order_lines.create': creates,
						'order_lines.update': updates,
						'order_lines.delete': deletes
					},
					{ key: `confirm:${yield* hash(batch.map((row) => row.source_order_key))}` }
				);
				imported += stored.length;
			}
		}
		return { imported, issues };
	}
});
