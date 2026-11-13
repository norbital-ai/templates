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
type Scope = Pick<Row<'orders'>, 'direction' | 'owner'>;
/** The writer's member id; a system or visitor writer owns no order. */
export const memberOf = (ctx: Pick<Clock, 'actor'>) =>
	ctx.actor.kind === 'member' ? ctx.actor.id : null;
/** A sales order the writer owns. */
export const ownSales = (ctx: Pick<Clock, 'actor'>) => (order: Scope) =>
	order.direction === 'sales' && order.owner === memberOf(ctx);
/** A purchasing order. */
export const purchasing = (order: Scope) => order.direction === 'purchasing';
/**
 * Whether every order the batch names is in `scope` (one read for the whole batch), and whether any of them is
 * confirmed; `null` when one is outside it.
 */
export const ordersIn = Effect.fnUntraced(function* (
	ctx: { readonly query: WorkspaceQuery['query'] },
	ids: readonly Id<'orders'>[],
	scope: (order: Scope) => boolean
) {
	const unique = [...new Set(ids)];
	const { orders } = yield* ctx.query({
		orders: { where: { id: { in: unique } }, fields: ['direction', 'owner', 'status'] }
	});
	return orders.rows.length === unique.length && orders.rows.every(scope)
		? { confirmed: orders.rows.some((order) => order.status === 'confirmed') }
		: null;
});
type OrderChange = {
	readonly before: StoredTree<'orders', 'update'>;
	readonly set: UpdateInput<'orders'>;
	readonly after: Scope & Pick<Row<'orders'>, 'status'>;
};
const METADATA = ['title', 'notes', 'archived'];
/**
 * Each change stays in `scope` before and after it; a confirmation, or any change to a confirmed order beyond its
 * metadata, needs a commercial manager (unless `managerApproval` is off).
 */
export const reviewOrders = Effect.fnUntraced(function* (
	changes: readonly OrderChange[],
	ctx: PolicyCtx<'orders', 'update'>,
	scope: (order: Scope) => boolean,
	outside: 'errors.purchasing_scope' | 'errors.sales_scope',
	managerApproval = true
) {
	const away = changes.findIndex(({ before, after }) => !scope(before) || !scope(after));
	if (away >= 0) return yield* ctx.refuse(outside, { row: away });
	const reviewed = changes.some(
		({ after, set }) =>
			after.status === 'confirmed' && !Object.keys(set).every((field) => METADATA.includes(field))
	);
	return managerApproval && reviewed ? ctx.approve(commercialReview) : ctx.allow();
});
/** The commercial manager's review of a sales rep's write. */
export const commercialReview = {
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
