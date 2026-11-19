import { bills, directionsOf, type Direction } from './bills.js';
import { importedOrderIdentity, importedOrderKey } from './order-identity.js';
import { BigDecimal, Effect, Result, Schema } from 'effect';
import type { Id, InstanceId, Row, Json } from '@norbital-ai/bolt';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import { hash, numeric } from '../../lib/commercial.js';
import { sealedCommission } from '../../lib/commission-expressions.js';
import { kingdeeWriteTarget } from './configuration.js';
import type { SourceRowInvalid, SqlRow } from './polling.js';
import {
	checked,
	familyProjection,
	flag,
	headerWindow,
	kingdeeOrder,
	nullableText,
	orderWindow,
	ownedOrders,
	pairLines,
	readSourceOrderFamilies,
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
/** The id map's identity for an owned order: `<direction>:<branch>:<FInterID>:<source_order_key>`. */
const binding = (direction: Direction, branch: string, fid: string, key: string) =>
	`${direction}:${branch}:${fid}:${key}`;
/** The order header the order mirrors; its hash is the order row's `$version`. */
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
		backlog ? [...issues, 'More Kingdee orders are waiting than this ledger retries.'] : issues
	);
/** A header row with no lines read: what the SO's header alone says. */
const headerOnly = (live: SqlRow) =>
	checked(() =>
		kingdeeOrder({ live, headers: [live], reference: text(live, 'reference'), lines: [] })
	);
// a header with no FUUID (KIS leaves it unset outside the integration) is neither ours nor importable
const uuidOf = (header: SqlRow) =>
	checked(() =>
		flag(header, 'archive') ? null : (nullableText(header, 'uuid')?.toLowerCase() ?? null)
	);

/**
 * The SO and PO headers this ledger's orders mirror, read by one rowversion window: a header that moved updates its
 * confirmed order; a live one no order holds yet arrives as a draft and is confirmed by the next read, so a
 * Kingdee-created order needs no listing of the branch. Kingdee keeps the header: its party and employee move the order.
 */
export const readKingdeeOrders = Effect.fnUntraced(function* (
	instance: InstanceId<'kingdee'>,
	cursor: Json | null,
	ctx: OrderSourceContext,
	unchanged: boolean
) {
	const directions = directionsOf(ctx.configuration);
	// Kingdee first: a quiet window, with nothing changed here, asks the workspace nothing
	const window = yield* orderWindow(ctx, cursor, 500, headerWindow(directions));
	if (unchanged && window.quiet) return { rows: [], cursor, more: false };
	const sides = yield* Effect.forEach(directions, (direction) =>
		ownedOrders(direction, instance, ctx).pipe(
			Effect.map((side) => ({ bill: bills[direction], ...side }))
		)
	);
	const {
		orders: drafts,
		parties,
		sys_user
	} = yield* ctx.query({
		orders: {
			where: {
				ledger: { eq: instance },
				direction: { in: [...directions] },
				status: { eq: 'draft' }
			},
			fields: ['source_order_key']
		},
		parties: {
			where: { source: { eq: instance }, active: { eq: true } },
			fields: ['external_code', 'name', 'kind']
		},
		sys_user: { where: { active: { eq: true } }, fields: ['id'] }
	});
	// an order confirmed here keeps the commission rule and freight treatment in force, as a local confirmation does
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
	// what a waiting order waits on: an employee binding or a party arriving
	const { retry, close } = window.with(
		yield* hash([ctx.configuration.salespersonBindings ?? '', parties.rows.length])
	);
	const target = kingdeeWriteTarget(ctx.configuration);
	const moved = yield* Effect.forEach(window.headers, uuidOf);
	const forced = window.first ? [...staged.keys(), ...retry] : [];
	const wanted = [...new Set([...moved.flatMap((uuid) => uuid ?? []), ...forced])];
	const anchors = sides.flatMap((side) => side.anchors);
	// a waiting or staged order that did not move is read by its UUID; the rest are the window's own rows
	const absent = forced.filter(
		(uuid) => !anchors.some((anchor) => anchor.uuid === uuid) && !moved.includes(uuid)
	);
	const issues: string[] = [];
	const waiting: string[] = [];
	const rows = [];
	const owner = (employee: string | null) => {
		const people = bound.filter(([, person]) => person.employeeId === employee);
		return people.length === 1
			? sys_user.rows.find((row) => row.id === people[0]?.[0])?.id
			: undefined;
	};
	// a customer for an SO, a supplier for a PO
	const counterparty = (direction: Direction, code: string) =>
		parties.rows.find(
			(row) =>
				row.external_code === code && row.kind !== (direction === 'sales' ? 'supplier' : 'customer')
		);
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
	const lives: (readonly [Direction, SqlRow])[] = window.headers.map(
		(row) => [row['direction'] === 'purchasing' ? 'purchasing' : 'sales', row] as const
	);
	for (const { bill, owned, anchors: own } of sides) {
		const { direction } = bill;
		const families = yield* readSourceOrderFamilies(
			bill,
			own.filter((anchor) => wanted.includes(anchor.uuid)),
			ctx
		);
		for (const family of families) {
			const order = owned.find((row) => row.id === family.order);
			if (!order) continue;
			const source = yield* checked(() => kingdeeOrder(family));
			// Kingdee keeps the header: a party or employee changed there moves the order
			const party =
				source.party === order.party?.external_code ? null : counterparty(direction, source.party);
			if (party === undefined) {
				issues.push(`${source.reference}: Kingdee party ${source.party} is not synchronized.`);
				waiting.push(source.uuid);
				continue;
			}
			const person = owner(source.employee);
			rows.push({
				$id: binding(direction, ctx.configuration.branchNo, source.fid, order.source_order_key),
				source_order_key: order.source_order_key,
				// the employee binding is ours: one added later still moves the order
				$version: yield* hash([yield* headerVersion(source), person ?? null]),
				...(party ? { party: party.id, party_name: party.name } : {}),
				...(person && person !== order.owner ? { owner: person } : {}),
				...header(source)
			});
		}
		if (absent.length)
			for (const row of yield* selectByIds(
				ctx,
				familyProjection(bill),
				absent,
				ctx.configuration.branchNo
			))
				lives.push([direction, row]);
	}
	// a live order no order here holds: Kingdee created it. It arrives as a draft, and the read after confirms it.
	const known = new Set(anchors.map((anchor) => anchor.uuid));
	// a live row in the bill family of an order here (an amendment that archived the original) is that order's
	const families = new Set(
		sides.flatMap(({ bill, owned }) =>
			owned.flatMap((order) =>
				order.kingdee ? [`${bill.direction}:${order.kingdee.reference}`] : []
			)
		)
	);
	for (const [direction, live] of target && target.account === window.account ? lives : []) {
		const uuid = yield* uuidOf(live);
		if (
			!uuid ||
			known.has(uuid) ||
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid) ||
			// a void or completed order no order here holds (history, or the archived copy an amendment leaves) is
			// nothing to import: only open Kingdee orders arrive, so a first read does not import the account's history
			(!staged.has(uuid) &&
				((yield* checked(() => flag(live, 'cancelled') || flag(live, 'closed'))) ||
					families.has(`${direction}:${yield* checked(() => text(live, 'reference'))}`)))
		)
			continue;
		known.add(uuid);
		// a header Kingdee has not completed (no settlement, say) waits rather than failing the read
		const read = yield* Effect.result(headerOnly(live));
		if (Result.isFailure(read)) {
			issues.push(`${uuid}: Kingdee ${read.failure.column} is incomplete; import waits.`);
			waiting.push(uuid);
			continue;
		}
		const source = read.success;
		const party = counterparty(direction, source.party);
		const person = owner(source.employee);
		if (!party || !person || !target) {
			issues.push(
				`${source.reference}: import waits for an active party and one employee binding.`
			);
			waiting.push(uuid);
			continue;
		}
		const key = staged.get(uuid) ?? importedOrderKey(target.account, target.branch, uuid);
		rows.push({
			$id: binding(direction, ctx.configuration.branchNo, source.fid, key),
			source_order_key: key,
			$version: yield* hash([yield* headerVersion(source), person, staged.has(uuid)]),
			title: source.reference,
			direction,
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
	const closed = yield* close(waiting);
	return sourceHealth({ rows, cursor: closed.cursor, more: window.more }, issues, closed.backlog);
});

/**
 * The lines of the confirmed orders this ledger receives, read for the Kingdee orders whose header moved: a changed
 * entry updates its line, a new entry adds one, and a line whose entry left the order is deleted. A line not yet sent
 * keeps its local terms. An order with a line no entry is bound to yet, or one a write was refused on, is read without waiting
 * for Kingdee to move.
 */
export const readKingdeeOrderLines = Effect.fnUntraced(function* (
	instance: InstanceId<'kingdee'>,
	cursor: Json | null,
	ctx: OrderSourceContext,
	unchanged: boolean
) {
	const directions = directionsOf(ctx.configuration);
	// Kingdee first: a quiet window, with nothing changed here, asks the workspace nothing
	const window = yield* orderWindow(ctx, cursor, 100, headerWindow(directions));
	if (unchanged && window.quiet) return { rows: [], cursor, more: false };
	const sides = yield* Effect.forEach(directions, (direction) =>
		ownedOrders(direction, instance, ctx).pipe(
			Effect.map((side) => ({ bill: bills[direction], ...side }))
		)
	);
	const { products, order_lines } = yield* ctx.query({
		// a line whose own write to Kingdee is still pending keeps its local terms until it lands
		order_lines: {
			where: { order: { in: sides.flatMap((side) => side.owned.map((order) => order.id)) } },
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
	// a waiting order waits on an item arriving
	const { retry, close } = window.with(String(products.rows.length));
	const moved = yield* Effect.forEach(window.headers, uuidOf);
	const unsettled = window.first
		? sides.flatMap(({ owned, anchors }) =>
				owned
					.filter((order) =>
						order.lines.some((line) => !line.source_entry_id || state(line) === 'failed')
					)
					.flatMap((order) => anchors.find((anchor) => anchor.order === order.id)?.uuid ?? [])
			)
		: [];
	const wanted = new Set([
		...moved.flatMap((uuid) => uuid ?? []),
		...unsettled,
		...(window.first ? retry : [])
	]);
	const issues: string[] = [];
	const waiting: string[] = [];
	const rows = [];
	for (const { bill, owned, anchors } of sides) {
		const { direction } = bill;
		const families = yield* readSourceOrderFamilies(
			bill,
			anchors.filter((anchor) => wanted.has(anchor.uuid)),
			ctx
		);
		for (const family of families) {
			const order = owned.find((row) => row.id === family.order);
			if (!order) continue;
			const source = yield* checked(() => kingdeeOrder(family));
			const id = binding(direction, ctx.configuration.branchNo, source.fid, order.source_order_key);
			const unsent = order.lines.filter((line) => state(line) === 'pending');
			// a write Kingdee refused for good is over: its terms return, and a line it never took leaves
			const refused = order.lines.filter((line) => state(line) === 'failed');
			const orphans = refused.filter((line) => !line.source_entry_id);
			// paired as the writer pairs them: a pending line Kingdee took before its reply was lost holds its entry
			const pairs = pairLines(
				order.lines.filter((line) => !orphans.includes(line)),
				source.lines
			);
			const held = new Set(
				[...pairs].flatMap(([entry, line]) => (unsent.includes(line) ? [entry] : []))
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
							}).format(numeric(BigDecimal.format(price))),
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
	}
	const closed = yield* close(waiting);
	return sourceHealth({ rows, cursor: closed.cursor, more: window.more }, issues, closed.backlog);
});

const defer = (message: string) => new FacilityFailure({ kind: 'upstream', message });
const refuse = (message: string) => new FacilityFailure({ kind: 'invalid', message });
/**
 * Sends a confirmed order to its Kingdee SO or PO: creates it, or changes its lines where they differ (Kingdee keeps
 * the header). An audited SO is amended into a new version; a PO's lines change only while it is unaudited, as in
 * Kingdee. Answers the identity and its entries as written, or `null` for an order this sync does not send.
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
		// a PO is sent once the ledger's purchase documents are verified; until then it stays local
		!directionsOf(ctx.configuration).includes(order.direction) ||
		order.status !== 'confirmed' ||
		order.ledger !== instance ||
		!order.write_target ||
		!order.source_order_key ||
		!order.party
	)
		return null;
	const { direction } = order;
	const key = order.source_order_key;
	const identity = importedOrderIdentity(key);
	if (
		identity &&
		(identity.account !== order.write_target.account ||
			identity.branch !== encodeURIComponent(order.write_target.branch))
	)
		return yield* refuse(
			`The imported ${bills[direction].label} belongs to another account or branch.`
		);
	const uuid = yield* sourceOrderUuid(order.id, key);
	const observe = () =>
		readSourceOrderFamilies(bills[direction], [{ order: order.id, uuid }], ctx).pipe(
			Effect.flatMap(([family]) =>
				family ? checked(() => kingdeeOrder(family)) : Effect.succeed(null)
			)
		);
	const sourceRefused = (cause: SourceRowInvalid) =>
		Effect.fail(refuse(`Kingdee ${bills[direction].label} sync needs attention. ${cause.message}`));
	const before = yield* observe();
	const lines = [...order.lines].sort((a, b) => a.id.localeCompare(b.id));
	const pairs = before ? pairLines(lines, before.lines) : new Map<string, (typeof lines)[number]>();
	const entries = new Map([...pairs].map(([entry, line]) => [line.id, entry]));
	const payload: OrderPayload = {
		order_id: order.id,
		key,
		reference: before?.reference ?? order.number,
		direction,
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
		return yield* refuse(
			`The Kingdee ${bills[direction].label} is missing; it will not be recreated.`
		);
	const bound = (so: KingdeeOrder) => {
		const written = pairLines(lines, so.lines);
		return {
			$id: binding(direction, ctx.configuration.branchNo, so.fid, key),
			lines: so.lines.map((entry) => ({ line: written.get(entry.entry)?.id, entry: entry.entry }))
		};
	};
	if (!before)
		yield* submitOrder(payload, ctx).pipe(Effect.catchTag('SourceRowInvalid', sourceRefused));
	else {
		if (
			before.currency !== order.currency ||
			before.party !== order.party.external_code ||
			before.payment_terms !== order.payment_terms ||
			before.ordered_on !== order.ordered_on
		)
			// Kingdee owns the header and confirmed orders refuse local header edits: the next read brings it in
			return yield* defer(
				`Waiting for the next read of the Kingdee ${bills[direction].label} header.`
			);
		const same =
			before.lines.length === lines.length &&
			before.lines.every((entry) => {
				const line = pairs.get(entry.entry);
				return line !== undefined && sameLine(line, entry, order.tax_inclusive);
			});
		// nothing to send: what was just read is what Kingdee holds
		if (same) return bound(before);
		if (before.status === 'void' || before.closed)
			return yield* refuse(`The Kingdee ${bills[direction].label} is void or closed.`);
		// an unaudited order changes its lines in place, as Kingdee's own 修改 does; an audited SO takes a 订单变更
		if (direction === 'purchasing' && before.status !== 'draft')
			return yield* refuse(
				'Kingdee changes a PO’s lines only before it is audited; unaudit it there first.'
			);
		yield* submitOrder(
			{
				...payload,
				previous: {
					audited: before.status === 'issued',
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
	if (!after) return yield* defer(`Waiting for the Kingdee ${bills[direction].label} to appear.`);
	return bound(after);
});

/**
 * A line the import created with its Kingdee entry holds what Kingdee holds: its identity is the order's Kingdee order
 * and that entry, with no read of Kingdee. Any other line answers `null` and is sent.
 */
export const importedLineId = Effect.fnUntraced(function* (
	line: Pick<Row<'order_lines'>, 'order' | 'source_entry_id'>,
	ctx: OrderSourceContext
) {
	if (!line.source_entry_id) return null;
	const order = (yield* ctx.query({
		orders: {
			where: { id: { eq: line.order } },
			fields: ['direction', 'source_order_key', 'kingdee'],
			limit: 1
		}
	})).orders.rows[0];
	return order?.source_order_key && order.kingdee && importedOrderIdentity(order.source_order_key)
		? `${binding(order.direction, ctx.configuration.branchNo, order.kingdee.fid, order.source_order_key)}:${line.source_entry_id}`
		: null;
});
