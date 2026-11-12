import { Effect } from 'effect';
import type {
	Clock,
	Id,
	PolicyCtx,
	Row,
	StoredRow,
	StoredTree,
	UpdateInput,
	WorkspaceQuery
} from '@norbital-ai/bolt';
import { Refusal } from '@norbital-ai/bolt/errors';
import { agreement } from './agreements.js';
import { draftLineTarget } from './contract-draft.js';
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
	readonly set: UpdateInput<'orders'>;
};
const METADATA = ['title', 'notes', 'archived'];
/** The root columns an update changes (its line changes are the lines' own). */
const changed = (set: UpdateInput<'orders'>) => Object.keys(set).filter((key) => key !== 'lines');
/**
 * Each change stays in `scope` before and after it; then a draft edit or a confirmed order's metadata executes, a
 * confirmation needs a commercial manager, and any other edit of a confirmed order is refused.
 */
export const reviewOrders = Effect.fnUntraced(function* (
	changes: readonly OrderChange[],
	ctx: PolicyCtx<'orders', 'update'>,
	scope: (order: Scope) => boolean,
	outside: string,
	managerApproval = true
) {
	const away = changes.findIndex(
		({ before, set }) =>
			!scope(before) ||
			!scope({
				direction: set.direction ?? before.direction,
				owner: set.owner ?? before.owner
			})
	);
	if (away >= 0) return yield* ctx.refuse(outside, { row: away });
	const sealed = changes.map(
		({ before, set }) =>
			(set.status ?? before.status) === 'confirmed' &&
			!changed(set).every((field) => METADATA.includes(field))
	);
	const refused = changes.findIndex(({ set }, i) => sealed[i] && !changed(set).includes('status'));
	if (refused >= 0) return yield* ctx.refuse('errors.order_sealed', { row: refused });
	return managerApproval && sealed.some(Boolean)
		? ctx.approve({ steps: [{ name: 'Commercial review', teams: ['commercial_managers'] }] })
		: ctx.allow();
});
/**
 * Lines leave only a draft order that no confirmation or ledger order has fixed; while a replacement contract is set
 * up, only a line its current agreement does not carry. Every policy granting a line delete runs it (one batch read).
 */
export const lineDeletes = Effect.fnUntraced(function* (
	lines: readonly Pick<
		StoredRow<'order_lines'>,
		'id' | 'order' | 'product' | 'unit' | 'source_entry_id'
	>[],
	ctx: { readonly query: WorkspaceQuery['query'] }
) {
	const ids = [...new Set(lines.map((line) => line.order))];
	const {
		orders: parents,
		ext_sales_orders: salesOrders,
		ext_purchase_orders: purchaseOrders
	} = yield* ctx.query({
		orders: { where: { id: { in: ids } } },
		ext_sales_orders: { where: { order: { in: ids } }, fields: ['order'], limit: 1 },
		ext_purchase_orders: { where: { order: { in: ids } }, fields: ['order'], limit: 1 }
	});
	for (const line of lines) {
		const parent = parents.rows.find((order) => order.id === line.order);
		if (!parent?.draft_setup) continue;
		const current = agreement(parent, parent.draft_setup);
		const target = current ? draftLineTarget(current, line) : undefined;
		if (
			!current ||
			current.seal_hash !== parent.draft_setup ||
			(target && target.product === line.product && target.unit === line.unit)
		)
			return yield* new Refusal({ message: 'errors.contract_setup' });
	}
	if (
		parents.rows.some((order) => order.archived || order.status !== 'draft') ||
		parents.rows.some(
			(order) =>
				!order.contract_versions?.length &&
				[...salesOrders.rows, ...purchaseOrders.rows].some((source) => source.order === order.id)
		)
	)
		return yield* new Refusal({ message: 'errors.order_sealed' });
});
