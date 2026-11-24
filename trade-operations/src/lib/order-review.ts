import { Effect } from 'effect';
import type {
	AutomationCtx,
	Clock,
	Id,
	PolicyCtx,
	Row,
	StoredRow,
	StoredTree,
	UpdateInput,
	WorkspaceQuery
} from '@norbital-ai/bolt';
import { floorFor, floorNetInUnit, quoteBelowFloor } from './commercial.js';
type Scope = Pick<Row<'orders'>, 'direction' | 'owner'>;
/** The writer's member id; a system or visitor writer owns no order. */
export const memberOf = (ctx: Pick<Clock, 'actor'>) =>
	ctx.actor.kind === 'member' ? ctx.actor.id : null;
/** A sales order the writer owns. */
export const ownSales = (ctx: Pick<Clock, 'actor'>) => (order: Scope) =>
	order.direction === 'sales' && order.owner === memberOf(ctx);
/** A purchasing order. */
export const purchasing = (order: Scope) => order.direction === 'purchasing';
/** Whether every order the batch names is in `scope` (one read for the whole batch). */
export const ordersIn = Effect.fnUntraced(function* (
	ctx: { readonly query: WorkspaceQuery['query'] },
	ids: readonly Id<'orders'>[],
	scope: (order: Scope) => boolean
) {
	const unique = [...new Set(ids)];
	const { orders } = yield* ctx.query({
		orders: { where: { id: { in: unique } }, fields: ['direction', 'owner'] }
	});
	return orders.rows.length === unique.length && orders.rows.every(scope);
});
type OrderChange = {
	readonly before: StoredTree<'orders', 'update'>;
	readonly after: Scope;
};
/** Each change stays in `scope` before and after it. */
export const scopedOrders = Effect.fnUntraced(function* (
	changes: readonly OrderChange[],
	ctx: PolicyCtx<'orders', 'update'>,
	scope: (order: Scope) => boolean,
	outside: 'errors.purchasing_scope' | 'errors.sales_scope'
) {
	const away = changes.findIndex(({ before, after }) => !scope(before) || !scope(after));
	return away >= 0 ? yield* ctx.refuse(outside, { row: away }) : ctx.allow();
});
type Basis = Pick<
	Row<'orders'>,
	'direction' | 'currency' | 'ordered_on' | 'tax_inclusive' | 'warehouse'
>;
/** A sales line as a write leaves it: blank price cells take the product's, as the line's own transform fills them. */
export type FloorLine = {
	readonly order: Basis;
	readonly product: Id<'products'>;
	readonly quantity?: string | null | undefined;
	readonly unit_price?: string | null | undefined;
	readonly discount_pct?: string | number | null | undefined;
	readonly tax_rate?: string | null | undefined;
};
/**
 * Whether the commercial settings send a write to a commercial manager because a sales line in it is below its floor,
 * or has none (`floor_rule: 'approve'`). One read for the whole batch.
 */
export const floorReview = Effect.fnUntraced(function* (
	ctx: { readonly query: WorkspaceQuery['query'] },
	lines: readonly FloorLine[]
) {
	const sales = lines.filter((line) => line.order.direction === 'sales');
	if (!sales.length) return false;
	const products = [...new Set(sales.map((line) => line.product))];
	const {
		commercial_settings: settings,
		products: catalog,
		pricing_floors: floors,
		warehouses
	} = yield* ctx.query({
		commercial_settings: { where: { code: { eq: 'default' } }, fields: ['floor_rule'], limit: 1 },
		products: { where: { id: { in: products } }, fields: ['unit', 'unit_price', 'tax_rate'] },
		pricing_floors: { where: { product: { in: products } } },
		warehouses: {
			where: { id: { in: sales.flatMap((line) => line.order.warehouse ?? []) } },
			fields: ['group_code']
		}
	});
	if (settings.rows[0]?.floor_rule !== 'approve') return false;
	return sales.some((line) => {
		const product = catalog.rows.find((p) => p.id === line.product);
		const unit_price = line.unit_price ?? product?.unit_price;
		const tax_rate = line.tax_rate ?? product?.tax_rate;
		const lineUnit = product?.unit;
		if (line.quantity == null || unit_price == null || tax_rate == null) return false;
		const floor = floorFor(
			line.order,
			warehouses.rows.find((w) => w.id === line.order.warehouse)?.group_code,
			{ product: line.product, quantity: line.quantity, ...(lineUnit ? { unit: lineUnit } : {}) },
			floors.rows
		);
		const floor_net =
			floor && lineUnit ? floorNetInUnit(floor, lineUnit) : (floor?.floor_net ?? null);
		return (
			!floor ||
			floor_net === null ||
			quoteBelowFloor(
				{
					unit_price,
					discount_pct: String(line.discount_pct ?? '0'),
					tax_rate,
					floor_net
				},
				line.order.tax_inclusive
			)
		);
	});
});
/** The orders a line batch names, with the basis its lines are priced on (one read). */
export const linesOrders = Effect.fnUntraced(function* (
	ctx: { readonly query: WorkspaceQuery['query'] },
	ids: readonly Id<'orders'>[]
) {
	const { orders } = yield* ctx.query({
		orders: {
			where: { id: { in: [...new Set(ids)] } },
			fields: ['direction', 'owner', 'currency', 'ordered_on', 'tax_inclusive', 'warehouse']
		}
	});
	return orders.rows;
});
/** The commercial manager's review of a sales rep's write. */
export const commercialReview = {
	steps: [{ name: 'Commercial review', teams: ['commercial_managers'] }]
} as const;
/** Two-step formal credit-release approval: Commercial Manager followed by Finance. */
export const creditReleaseReview = {
	steps: [
		{ name: 'Commercial review', teams: ['commercial_managers'] },
		{ name: 'Finance review', teams: ['finance'] }
	]
} as const;
/** Finance sign-off when a Commercial Manager initiates a credit-release request. */
export const creditReleaseFinanceReview = {
	steps: [{ name: 'Finance review', teams: ['finance'] }]
} as const;
/** Commercial Manager sign-off when Finance initiates a credit-release request. */
export const creditReleaseManagerReview = {
	steps: [{ name: 'Commercial review', teams: ['commercial_managers'] }]
} as const;
/** Only an unarchived draft order is deleted. */
export const draftOrders = (orders: readonly Pick<Row<'orders'>, 'status' | 'archived'>[]) =>
	orders.findIndex((order) => order.status !== 'draft' || order.archived);
/** Lines leave only an unarchived order. Every policy granting a line delete runs it (one batch read). */
export const lineDeletes = Effect.fnUntraced(function* (
	lines: readonly Pick<StoredRow<'order_lines'>, 'order'>[],
	ctx: {
		readonly query: WorkspaceQuery['query'];
	} & Pick<AutomationCtx, 'refuse'>
) {
	const { orders } = yield* ctx.query({
		orders: {
			where: { id: { in: [...new Set(lines.map((line) => line.order))] } },
			fields: ['archived']
		}
	});
	if (orders.rows.some((order) => order.archived))
		return yield* ctx.refuse('errors.order_archived');
});
const basis = ['warehouse', 'currency', 'tax_inclusive', 'ordered_on'] as const;
/**
 * The sales lines an order write leaves to price: lines it creates or changes through its own layer, and every stored
 * line when its pricing basis moves (one read).
 */
export const orderFloorLines = Effect.fnUntraced(function* (
	ctx: { readonly query: WorkspaceQuery['query'] },
	changes: readonly {
		readonly before: StoredTree<'orders', 'update'>;
		readonly set: UpdateInput<'orders'>;
		readonly after: Basis;
	}[]
) {
	const moved = changes
		.filter(({ before, after }) => basis.some((k) => after[k] !== before[k]))
		.map(({ before }) => before.id);
	const named = changes.flatMap(({ set }) => (set.lines?.update ?? []).map((u) => u.target.id));
	const stored =
		moved.length || named.length
			? (yield* ctx.query({
					order_lines: {
						where: { or: [{ order: { in: moved } }, { id: { in: named } }] },
						fields: ['order', 'product', 'quantity', 'unit_price', 'discount_pct', 'tax_rate']
					}
				})).order_lines.rows
			: [];
	return changes.flatMap(({ before, set, after }): FloorLine[] => {
		const updates = set.lines?.update ?? [];
		return [
			...(set.lines?.create ?? []).map((line) => ({ ...line, order: after })),
			...stored
				.filter((line) =>
					moved.includes(before.id)
						? line.order === before.id
						: updates.some((u) => u.target.id === line.id)
				)
				.map((line) => ({
					...line,
					...updates.find((u) => u.target.id === line.id)?.set,
					order: after
				}))
		];
	});
});
