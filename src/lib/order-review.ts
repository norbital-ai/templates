import { Effect } from 'effect';
import type {
	Clock,
	Id,
	PolicyCtx,
	PolicyReads,
	Row,
	StoredTree,
	UpdateTree
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
/** Whether every order the batch names is in `scope` (one read for the whole batch). */
export const ordersIn = Effect.fnUntraced(function* (
	ctx: { readonly db: PolicyReads },
	ids: readonly Id<'orders'>[],
	scope: (order: Scope) => boolean
) {
	const unique = [...new Set(ids)];
	const { orders } = yield* ctx.db.query({
		orders: { where: { id: { in: unique } }, fields: ['direction', 'owner'] }
	});
	return orders.rows.length === unique.length && orders.rows.every(scope);
});
type OrderChange = {
	readonly before: StoredTree<'orders', 'update'>;
	readonly set: UpdateTree<'orders'>;
};
const METADATA = ['title', 'notes', 'archived'];
/** The root columns an update changes (its line changes are the lines' own). */
const changed = (set: UpdateTree<'orders'>) => Object.keys(set).filter((key) => key !== 'lines');
/**
 * Each change stays in `scope` before and after it; then a draft edit or a confirmed order's metadata executes, a
 * confirmation needs a commercial manager, and any other edit of a confirmed order is refused.
 */
export function reviewOrders(
	changes: readonly OrderChange[],
	ctx: PolicyCtx<'orders', 'update'>,
	scope: (order: Scope) => boolean,
	outside: string
) {
	const away = changes.findIndex(
		({ before, set }) =>
			!scope(before) ||
			!scope({
				direction: set.direction ?? before.direction,
				owner: set.owner ?? before.owner
			})
	);
	if (away >= 0) return ctx.deny(outside, { row: away });
	const sealed = changes.map(
		({ before, set }) =>
			(set.status ?? before.status) === 'confirmed' &&
			!changed(set).every((field) => METADATA.includes(field))
	);
	const refused = changes.findIndex(({ set }, i) => sealed[i] && !changed(set).includes('status'));
	if (refused >= 0) return ctx.deny('errors.order_sealed', { row: refused });
	return sealed.some(Boolean)
		? ctx.approve((flow) => flow.step('Commercial review', { teams: ['commercial_managers'] }))
		: ctx.allow();
}
