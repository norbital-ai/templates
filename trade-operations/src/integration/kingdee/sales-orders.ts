import { BigDecimal, Effect } from 'effect';
import type { Id, InstanceId, Row } from '@norbital-ai/bolt';
import type { Json } from '@norbital-ai/bolt/engine';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import { hash } from '../../lib/commercial.js';
import type { SourceRowInvalid } from './polling.js';
import {
	checked,
	kingdeeOrder,
	observation,
	ownedSalesOrders,
	ownershipSource,
	pairLines,
	readSourceOrderFamilies,
	snapshotPage,
	type KingdeeOrder,
	type OrderSourceContext
} from './order-source.js';
import { sourceOrderUuid, submitOrder, type OrderPayload } from './submission.js';

type KingdeeLine = KingdeeOrder['lines'][number];
type Terms = Pick<
	Row<'order_lines'>,
	| 'product_code'
	| 'unit'
	| 'quantity'
	| 'unit_price'
	| 'discount_pct'
	| 'tax_rate'
	| 'net'
	| 'tax'
	| 'total'
>;
/** The id map's identity for an owned SO: `sales:<branch>:<FInterID>:<source_order_key>`. */
const binding = (branch: string, fid: string, key: string) => `sales:${branch}:${fid}:${key}`;
/** The SO header the order mirrors; its hash is the order row's `$version`. */
const headerVersion = ({ lines: _, uuid: __, ...header }: KingdeeOrder) => hash(header);
const lineVersion = ({ detail: _, ...line }: KingdeeLine) => hash(line);
const effective = (line: Pick<Terms, 'unit_price' | 'discount_pct'>) =>
	BigDecimal.round(
		BigDecimal.divideUnsafe(
			BigDecimal.multiply(
				BigDecimal.fromStringUnsafe(line.unit_price),
				BigDecimal.subtract(
					BigDecimal.fromBigInt(100n),
					BigDecimal.fromStringUnsafe(line.discount_pct)
				)
			),
			BigDecimal.fromBigInt(100n)
		),
		{ scale: 12 }
	);
const kingdeePrice = (line: KingdeeLine, inclusive: boolean) =>
	BigDecimal.fromStringUnsafe(inclusive ? line.inclusive : line.exclusive);
const sameLine = (line: Terms, entry: KingdeeLine, inclusive: boolean) =>
	entry.item === line.product_code &&
	entry.unit === line.unit &&
	BigDecimal.equals(
		BigDecimal.fromStringUnsafe(entry.quantity),
		BigDecimal.fromStringUnsafe(line.quantity)
	) &&
	BigDecimal.equals(kingdeePrice(entry, inclusive), effective(line)) &&
	(['tax_rate', 'net', 'tax', 'total'] as const).every((field) =>
		BigDecimal.equals(
			BigDecimal.fromStringUnsafe(entry[field]),
			BigDecimal.fromStringUnsafe(line[field])
		)
	);
const attention = <P extends object>(page: P, issues: readonly string[]) =>
	issues.length
		? {
				...page,
				health: { state: 'attention' as const, code: 'orderSource', message: issues.join(' ') }
			}
		: page;

/** The SO headers of the confirmed sales orders this ledger receives: a Kingdee change updates the order. */
export const readKingdeeOrders = Effect.fnUntraced(function* (
	instance: InstanceId<'kingdee'>,
	cursor: Json | null,
	ctx: OrderSourceContext
) {
	const observed = yield* observation(ctx, cursor);
	const { owned, anchors } = yield* ownedSalesOrders(instance, ctx);
	const families = yield* readSourceOrderFamilies(anchors, ctx);
	const issues: string[] = [];
	const rows = [];
	for (const family of families) {
		const order = owned.find((row) => row.id === family.order);
		if (!order) continue;
		const source = yield* checked(() => kingdeeOrder(family));
		if (source.customer !== order.party?.external_code) {
			issues.push(`${family.reference}: the Kingdee SO names another customer.`);
			continue;
		}
		rows.push({
			$id: binding(ctx.configuration.branchNo, source.fid, order.source_order_key),
			$version: yield* headerVersion(source),
			kingdee: {
				fid: source.fid,
				reference: source.reference,
				version: source.version,
				status: source.status,
				closed: source.closed,
				exchange_rate: source.exchange_rate
			},
			currency: source.currency,
			payment_terms: source.payment_terms,
			ordered_on: source.ordered_on
		});
	}
	return attention(
		yield* snapshotPage(
			rows,
			cursor,
			yield* ownershipSource(
				observed.scope,
				anchors.map((anchor) => anchor.uuid)
			)
		),
		issues
	);
});

/**
 * The SO lines of the confirmed sales orders this ledger receives: a changed entry updates its line, a new entry adds
 * one, and a line whose entry left the SO is deleted. A line not yet sent keeps its local terms.
 */
export const readKingdeeOrderLines = Effect.fnUntraced(function* (
	instance: InstanceId<'kingdee'>,
	cursor: Json | null,
	ctx: OrderSourceContext
) {
	const observed = yield* observation(ctx, cursor);
	const { owned, anchors } = yield* ownedSalesOrders(instance, ctx);
	const families = yield* readSourceOrderFamilies(anchors, ctx);
	const { products, order_lines } = yield* ctx.query({
		// a line whose own write to the SO is still pending or failed keeps its local terms until it lands
		order_lines: {
			where: { order: { in: owned.map((order) => order.id) } },
			fields: ['source_entry_id']
		},
		products: {
			where: { source: { eq: instance } },
			fields: [
				'external_code',
				'name',
				'spec',
				'unit',
				'commission_basis_unit',
				'commission_factor'
			]
		}
	});
	const issues: string[] = [];
	const rows = [];
	for (const family of families) {
		const order = owned.find((row) => row.id === family.order);
		if (!order) continue;
		const source = yield* checked(() => kingdeeOrder(family));
		const id = binding(ctx.configuration.branchNo, source.fid, order.source_order_key);
		const unsent = order.lines.filter((line) => {
			const state = order_lines.rows.find((row) => row.id === line.id)?.$sync?.kingdee?.status;
			return state === 'pending' || state === 'failed';
		});
		const held = new Set(unsent.flatMap((line) => line.source_entry_id ?? []));
		const pairs = pairLines(
			order.lines.filter((line) => !unsent.includes(line)),
			source.lines
		);
		for (const entry of source.lines) {
			if (held.has(entry.entry)) continue;
			const line = pairs.get(entry.entry);
			const product = products.rows.find((row) => row.external_code === entry.item);
			const productId = line?.product ?? product?.id;
			if (!productId) {
				issues.push(`${family.reference}: Kingdee item ${entry.item} is not synchronized.`);
				continue;
			}
			const price = kingdeePrice(entry, order.tax_inclusive);
			// the local price and discount stand while they give the SO's price
			const kept = line && BigDecimal.equals(price, effective(line));
			// the line's own transform prices it; a sync page names every field it writes
			rows.push({
				$id: `${id}:${entry.entry}`,
				$version: yield* lineVersion(entry),
				order: order.id,
				line_key: line?.line_key ?? `kingdee:${entry.entry}`,
				product: productId,
				source_entry_id: entry.entry,
				quantity: entry.quantity,
				unit_price: kept
					? line.unit_price
					: new Intl.NumberFormat('en', {
							useGrouping: false,
							minimumFractionDigits: price.scale,
							maximumFractionDigits: price.scale
						}).format(BigDecimal.format(price) as Intl.StringNumericLiteral),
				discount_pct: kept ? line.discount_pct : '0',
				tax_rate: entry.tax_rate,
				product_code: entry.item,
				product_name: line?.product_name ?? product?.name ?? entry.item,
				product_spec: line ? line.product_spec : (product?.spec ?? null),
				unit: entry.unit,
				currency: order.currency,
				net: entry.net,
				tax: entry.tax,
				total: entry.total,
				floor_net: line?.floor_net ?? null,
				floor_on: line?.floor_on ?? null,
				commission_basis_unit: line
					? line.commission_basis_unit
					: (product?.commission_basis_unit ?? null),
				commission_factor: line ? line.commission_factor : (product?.commission_factor ?? null)
			});
		}
		for (const line of order.lines)
			if (
				line.source_entry_id &&
				!unsent.includes(line) &&
				!source.lines.some((entry) => entry.entry === line.source_entry_id)
			)
				rows.push({
					$id: `${id}:${line.source_entry_id}`,
					$deleted: true as const,
					order: order.id,
					line_key: line.line_key
				});
	}
	return attention(
		yield* snapshotPage(
			rows,
			cursor,
			yield* ownershipSource(
				observed.scope,
				anchors.map((anchor) => anchor.uuid)
			)
		),
		issues
	);
});

const defer = (message: string) => new FacilityFailure({ kind: 'upstream', message });
const refuse = (message: string) => new FacilityFailure({ kind: 'invalid', message });
/**
 * Sends a confirmed sales order to its Kingdee SO: creates it, or amends its lines where they differ (Kingdee keeps
 * the header). Answers the SO identity and its entries as written, or `null` for an order this ledger does not receive.
 */
export const pushOrder = Effect.fnUntraced(function* (
	id: Id<'orders'>,
	instance: InstanceId<'kingdee'>,
	ctx: OrderSourceContext
) {
	const { orders } = yield* ctx.query({
		orders: {
			where: { id: { eq: id } },
			fields: [
				'number',
				'owner',
				'direction',
				'status',
				'ledger',
				'source_order_key',
				'write_target',
				'currency',
				'tax_inclusive',
				'payment_terms',
				'ordered_on'
			],
			limit: 1,
			party: { fields: ['external_code'] },
			lines: {}
		}
	});
	const order = orders.rows[0];
	if (
		!order ||
		order.direction !== 'sales' ||
		order.status !== 'confirmed' ||
		order.ledger !== instance ||
		!order.write_target ||
		!order.source_order_key ||
		!order.party
	)
		return null;
	const key = order.source_order_key;
	const uuid = yield* sourceOrderUuid(order.id, key);
	const observe = () =>
		readSourceOrderFamilies([{ order: order.id, uuid }], ctx).pipe(
			Effect.flatMap(([family]) =>
				family ? checked(() => kingdeeOrder(family)) : Effect.succeed(null)
			)
		);
	const sourceRefused = (cause: SourceRowInvalid) =>
		Effect.fail(refuse(`Kingdee SO sync needs attention. ${cause.message}`));
	const before = yield* observe();
	const lines = [...order.lines].sort((a, b) => a.id.localeCompare(b.id));
	const pairs = before ? pairLines(lines, before.lines) : new Map<string, (typeof lines)[number]>();
	const entries = new Map([...pairs].map(([entry, line]) => [line.id, entry]));
	const payload: OrderPayload = {
		order_id: order.id,
		key,
		reference: order.number,
		direction: 'sales',
		owner_id: order.owner,
		ordered_on: order.ordered_on,
		currency: order.currency,
		tax_inclusive: order.tax_inclusive,
		party_code: order.party.external_code,
		payment_terms: order.payment_terms,
		write_target: order.write_target,
		lines: lines.map((line) => {
			const entry = entries.get(line.id);
			return {
				id: line.id,
				...(entry ? { source_entry_id: entry } : {}),
				product_code: line.product_code,
				unit: line.unit,
				quantity: line.quantity,
				unit_price: line.unit_price,
				discount_pct: line.discount_pct,
				tax_rate: line.tax_rate,
				net: line.net,
				tax: line.tax,
				total: line.total
			};
		})
	};
	if (!before)
		yield* submitOrder(payload, ctx).pipe(Effect.catchTag('SourceRowInvalid', sourceRefused));
	else {
		if (
			before.currency !== order.currency ||
			before.customer !== order.party.external_code ||
			before.payment_terms !== order.payment_terms ||
			before.ordered_on !== order.ordered_on
		)
			// Kingdee owns the header and confirmed orders refuse local header edits: the next read brings it in
			return yield* defer('Waiting for the next read of the Kingdee SO header.');
		const same =
			before.lines.length === lines.length &&
			before.lines.every((entry) => {
				const line = pairs.get(entry.entry);
				return line !== undefined && sameLine(line, entry, order.tax_inclusive);
			});
		if (!same) {
			if (before.status === 'void' || before.closed)
				return yield* refuse('The Kingdee SO is void or closed.');
			if (before.status !== 'issued')
				return yield* defer('The Kingdee SO must be audited before its lines change.');
			yield* submitOrder(
				{
					...payload,
					previous: {
						source_id: before.fid,
						source_uuid: before.uuid,
						source_version: before.version,
						source_exchange_rate: before.exchange_rate,
						lines: before.lines.map(({ detail: _, ...entry }) => entry)
					}
				},
				ctx
			).pipe(Effect.catchTag('SourceRowInvalid', sourceRefused));
		}
	}
	const after = yield* observe();
	if (!after) return yield* defer('Waiting for the Kingdee SO to appear.');
	const written = pairLines(lines, after.lines);
	return {
		$id: binding(ctx.configuration.branchNo, after.fid, key),
		lines: after.lines.map((entry) => ({ line: written.get(entry.entry)?.id, entry: entry.entry }))
	};
});
