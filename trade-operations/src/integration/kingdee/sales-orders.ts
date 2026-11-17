import { importedOrderIdentity, importedOrderKey } from './order-identity.js';
import { BigDecimal, Effect, Schema } from 'effect';
import type { Id, InstanceId, Row, Json } from '@norbital-ai/bolt';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import { hash } from '../../lib/commercial.js';
import { sealedCommission } from '../../lib/commission-expressions.js';
import { kingdeeWriteTarget } from './configuration.js';
import type { SourceRowInvalid, SqlRow } from './polling.js';
import {
	checked,
	flag,
	kingdeeOrder,
	orderWindow,
	ownedSalesOrders,
	pairLines,
	readSourceOrderFamilies,
	salesFamilyProjection,
	selectByIds,
	text,
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

const sourceHealth = <P extends object>(page: P, issues: readonly string[], backlog: boolean) =>
	attention(
		page,
		backlog ? [...issues, 'More Kingdee SOs are waiting than this ledger retries.'] : issues
	);
/** A header row with no lines read: what the SO's header alone says. */
const headerOnly = (live: SqlRow) =>
	checked(() =>
		kingdeeOrder({ live, headers: [live], reference: text(live, 'reference'), lines: [] })
	);
const uuidOf = (header: SqlRow) =>
	checked(() => (flag(header, 'archive') ? null : text(header, 'uuid').toLowerCase()));

/**
 * The SO headers this ledger's orders mirror, read by rowversion window: a header that moved updates its confirmed
 * order; a live SO no order holds yet arrives as a draft and is confirmed by the next read, so a Kingdee-created SO
 * needs no listing of the branch. Kingdee keeps the header: its customer and salesperson move the order.
 */
export const readKingdeeOrders = Effect.fnUntraced(function* (
	instance: InstanceId<'kingdee'>,
	cursor: Json | null,
	ctx: OrderSourceContext
) {
	const { owned, anchors } = yield* ownedSalesOrders(instance, ctx);
	const {
		orders: drafts,
		parties,
		sys_user
	} = yield* ctx.query({
		orders: {
			where: { ledger: { eq: instance }, direction: { eq: 'sales' }, status: { eq: 'draft' } },
			fields: ['source_order_key']
		},
		parties: {
			where: { source: { eq: instance }, active: { eq: true } },
			fields: ['external_code', 'name', 'kind']
		},
		sys_user: { where: { active: { eq: true } }, fields: ['id'] }
	});
	// an SO confirmed here keeps the commission rule and freight treatment in force, as a local confirmation does
	const { commission_rules, commercial_settings } = yield* ctx.query({
		commission_rules: { where: { active: { eq: true }, code: { eq: 'default' } } },
		commercial_settings: { where: { code: { eq: 'default' } }, limit: 1 }
	});
	const staged = new Map(
		drafts.rows.flatMap((row) => {
			const uuid = importedOrderIdentity(row.source_order_key ?? '')?.uuid;
			return uuid && row.source_order_key ? [[uuid, row.source_order_key] as const] : [];
		})
	);
	const bound = yield* checked(() =>
		Object.entries(
			Schema.decodeUnknownSync(
				Schema.Record(Schema.String, Schema.Struct({ employeeId: Schema.String }))
			)(JSON.parse(ctx.configuration.salespersonBindings ?? '{}'))
		)
	);
	// what a waiting SO waits on: a salesperson binding or a customer arriving
	const window = yield* orderWindow(
		ctx,
		cursor,
		500,
		yield* hash([ctx.configuration.salespersonBindings ?? '', parties.rows.length])
	);
	const target = kingdeeWriteTarget(ctx.configuration);
	const moved = yield* Effect.forEach(window.headers, uuidOf);
	const forced = window.first ? [...staged.keys(), ...window.retry] : [];
	const wanted = [...new Set([...moved.flatMap((uuid) => uuid ?? []), ...forced])];
	const mine = anchors.filter((anchor) => wanted.includes(anchor.uuid));
	const families = yield* readSourceOrderFamilies(mine, ctx);
	// a waiting or staged SO that did not move is read by its UUID; the rest are the window's own rows
	const absent = forced.filter(
		(uuid) => !mine.some((anchor) => anchor.uuid === uuid) && !moved.includes(uuid)
	);
	const fetched = absent.length
		? yield* selectByIds(ctx, salesFamilyProjection, absent, ctx.configuration.branchNo)
		: [];
	const issues: string[] = [];
	const waiting: string[] = [];
	const rows = [];
	const owner = (employee: string | null) => {
		const people = bound.filter(([, person]) => person.employeeId === employee);
		return people.length === 1
			? sys_user.rows.find((row) => row.id === people[0]?.[0])?.id
			: undefined;
	};
	const customer = (code: string) =>
		parties.rows.find((row) => row.external_code === code && row.kind !== 'supplier');
	const header = (source: KingdeeOrder) => ({
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
	for (const family of families) {
		const order = owned.find((row) => row.id === family.order);
		if (!order) continue;
		const source = yield* checked(() => kingdeeOrder(family));
		// Kingdee keeps the header: a customer or salesperson changed there moves the order
		const party = source.customer === order.party?.external_code ? null : customer(source.customer);
		if (party === undefined) {
			issues.push(`${source.reference}: Kingdee customer ${source.customer} is not synchronized.`);
			waiting.push(source.uuid);
			continue;
		}
		const person = owner(source.employee);
		rows.push({
			$id: binding(ctx.configuration.branchNo, source.fid, order.source_order_key),
			source_order_key: order.source_order_key,
			// the salesperson binding is ours: one added later still moves the order
			$version: yield* hash([yield* headerVersion(source), person ?? null]),
			...(party ? { party: party.id, party_name: party.name } : {}),
			...(person && person !== order.owner ? { owner: person } : {}),
			...header(source)
		});
	}
	// a live SO no order holds: Kingdee created it. It arrives as a draft, and the read after confirms it.
	const known = new Set(anchors.map((anchor) => anchor.uuid));
	for (const live of target && target.account === window.account
		? [...window.headers, ...fetched]
		: []) {
		const uuid = yield* uuidOf(live);
		if (
			!uuid ||
			known.has(uuid) ||
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)
		)
			continue;
		known.add(uuid);
		const source = yield* headerOnly(live);
		const party = customer(source.customer);
		const person = owner(source.employee);
		if (!party || !person || !target) {
			issues.push(
				`${source.reference}: import waits for an active customer and one salesperson binding.`
			);
			waiting.push(uuid);
			continue;
		}
		const key = staged.get(uuid) ?? importedOrderKey(target.account, target.branch, uuid);
		rows.push({
			$id: binding(ctx.configuration.branchNo, source.fid, key),
			source_order_key: key,
			$version: yield* hash([yield* headerVersion(source), person, staged.has(uuid)]),
			title: source.reference,
			direction: 'sales' as const,
			party: party.id,
			party_name: party.name,
			owner: person,
			ledger: instance,
			write_target: target,
			tax_inclusive: false,
			...header(source),
			...(staged.has(uuid)
				? {
						status: 'confirmed' as const,
						commission: sealedCommission(commission_rules.rows, source.currency, source.ordered_on),
						...(commercial_settings.rows[0]
							? { freight_treatment: commercial_settings.rows[0].freight_treatment }
							: {})
					}
				: { status: 'draft' as const })
		});
	}
	const closed = yield* window.close(waiting);
	return sourceHealth({ rows, cursor: closed.cursor, more: window.more }, issues, closed.backlog);
});

/**
 * The SO lines of the confirmed sales orders this ledger receives, read for the SOs whose header moved: a changed
 * entry updates its line, a new entry adds one, and a line whose entry left the SO is deleted. A line not yet sent
 * keeps its local terms. An order no entry is bound to yet, or one a write was refused on, is read without waiting
 * for Kingdee to move.
 */
export const readKingdeeOrderLines = Effect.fnUntraced(function* (
	instance: InstanceId<'kingdee'>,
	cursor: Json | null,
	ctx: OrderSourceContext
) {
	const { owned, anchors } = yield* ownedSalesOrders(instance, ctx);
	const { products, order_lines } = yield* ctx.query({
		// a line whose own write to the SO is still pending keeps its local terms until it lands
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
	const state = (line: { readonly id: string }) =>
		order_lines.rows.find((row) => row.id === line.id)?.$sync?.kingdee?.status;
	// a waiting SO waits on an item arriving
	const window = yield* orderWindow(ctx, cursor, 100, String(products.rows.length));
	const moved = yield* Effect.forEach(window.headers, uuidOf);
	const unsettled = window.first
		? owned
				.filter(
					(order) =>
						order.lines.every((line) => !line.source_entry_id) ||
						order.lines.some((line) => state(line) === 'failed')
				)
				.flatMap((order) => anchors.find((anchor) => anchor.order === order.id)?.uuid ?? [])
		: [];
	const wanted = new Set([
		...moved.flatMap((uuid) => uuid ?? []),
		...unsettled,
		...(window.first ? window.retry : [])
	]);
	const families = yield* readSourceOrderFamilies(
		anchors.filter((anchor) => wanted.has(anchor.uuid)),
		ctx
	);
	const issues: string[] = [];
	const waiting: string[] = [];
	const rows = [];
	for (const family of families) {
		const order = owned.find((row) => row.id === family.order);
		if (!order) continue;
		const source = yield* checked(() => kingdeeOrder(family));
		const id = binding(ctx.configuration.branchNo, source.fid, order.source_order_key);
		const unsent = order.lines.filter((line) => state(line) === 'pending');
		// a write Kingdee refused for good is over: the SO's terms return, and a line it never took leaves
		const refused = order.lines.filter((line) => state(line) === 'failed');
		const orphans = refused.filter((line) => !line.source_entry_id);
		const held = new Set(unsent.flatMap((line) => line.source_entry_id ?? []));
		const pairs = pairLines(
			order.lines.filter((line) => !unsent.includes(line) && !orphans.includes(line)),
			source.lines
		);
		for (const line of orphans)
			rows.push({
				$id: `${id}:refused:${line.id}`,
				$deleted: true as const,
				order: order.id,
				line_key: line.line_key
			});
		for (const entry of source.lines) {
			if (held.has(entry.entry)) continue;
			const line = pairs.get(entry.entry);
			const product = products.rows.find((row) => row.external_code === entry.item);
			const price = kingdeePrice(entry, order.tax_inclusive);
			const changedItem = line !== undefined && line.product_code !== entry.item;
			const productId = changedItem ? product?.id : (line?.product ?? product?.id);
			if (!productId) {
				issues.push(`${family.reference}: Kingdee item ${entry.item} is not synchronized.`);
				waiting.push(source.uuid);
				continue;
			}
			// the local price and discount stand while they give the SO's price
			const kept = line && BigDecimal.equals(price, effective(line));
			// the line's own transform prices it; a sync page names every field it writes
			rows.push({
				$id: `${id}:${entry.entry}`,
				// an unchanged entry has the version the id map holds: a refused line needs another to be written
				$version:
					line && refused.includes(line)
						? yield* hash({ ...entry, refused: line.revision })
						: yield* lineVersion(entry),
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
				product_name:
					(changedItem ? product?.name : line?.product_name) ?? product?.name ?? entry.item,
				product_spec: changedItem
					? (product?.spec ?? null)
					: line
						? line.product_spec
						: (product?.spec ?? null),
				unit: entry.unit,
				currency: order.currency,
				net: entry.net,
				tax: entry.tax,
				total: entry.total,
				floor_net: changedItem ? null : (line?.floor_net ?? null),
				floor_on: changedItem ? null : (line?.floor_on ?? null),
				commission_basis_unit: changedItem
					? (product?.commission_basis_unit ?? null)
					: line
						? line.commission_basis_unit
						: (product?.commission_basis_unit ?? null),
				commission_factor: changedItem
					? (product?.commission_factor ?? null)
					: line
						? line.commission_factor
						: (product?.commission_factor ?? null)
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
	const closed = yield* window.close(waiting);
	return sourceHealth({ rows, cursor: closed.cursor, more: window.more }, issues, closed.backlog);
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
				'kingdee',
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
	const identity = importedOrderIdentity(key);
	if (
		identity &&
		(identity.account !== order.write_target.account ||
			identity.branch !== encodeURIComponent(order.write_target.branch))
	)
		return yield* refuse('The imported SO belongs to another account or branch.');
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
		reference: before?.reference ?? order.number,
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
	if (!before && (identity || order.kingdee))
		return yield* refuse('The Kingdee SO is missing; it will not be recreated.');
	const bound = (so: KingdeeOrder) => {
		const written = pairLines(lines, so.lines);
		return {
			$id: binding(ctx.configuration.branchNo, so.fid, key),
			lines: so.lines.map((entry) => ({ line: written.get(entry.entry)?.id, entry: entry.entry }))
		};
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
		// nothing to send: what was just read is what Kingdee holds
		if (same) return bound(before);
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
	const after = yield* observe();
	if (!after) return yield* defer('Waiting for the Kingdee SO to appear.');
	return bound(after);
});

/**
 * A line the import created with its SO entry holds what Kingdee holds: its identity is the order's SO and that
 * entry, with no read of Kingdee. Any other line answers `null` and is sent.
 */
export const importedLineId = Effect.fnUntraced(function* (
	line: Pick<Row<'order_lines'>, 'order' | 'source_entry_id'>,
	ctx: OrderSourceContext
) {
	if (!line.source_entry_id) return null;
	const order = (yield* ctx.query({
		orders: { where: { id: { eq: line.order } }, fields: ['source_order_key', 'kingdee'], limit: 1 }
	})).orders.rows[0];
	return order?.source_order_key && order.kingdee && importedOrderIdentity(order.source_order_key)
		? `${binding(ctx.configuration.branchNo, order.kingdee.fid, order.source_order_key)}:${line.source_entry_id}`
		: null;
});
