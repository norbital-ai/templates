import { d, sum } from './commercial.js';
import { isMasked } from './access.js';
import type { Row } from '@norbital-ai/bolt';
type Source = Pick<
	Row<'stock_snapshots'>,
	'product' | 'warehouse' | 'unit' | 'on_hand' | 'erp_committed' | 'as_of' | 'orders_as_of'
>;
type Commitment = Pick<
	Row<'orders'>,
	'id' | 'warehouse' | 'direction' | 'status' | 'sealed_at' | 'seal_hash'
> &
	Partial<Pick<Row<'orders'>, 'operational_contracts'>>;
type Line = {
	id: string;
	order: string;
	product: string | null | undefined;
	unit: string;
	quantity: string | ReturnType<typeof d>;
};
type Receipt = Pick<
	Row<'ext_sales_orders'>,
	'order' | 'status' | 'agreement_hash' | 'source_updated_at'
>;
export function availability(
	source: Source,
	now: string,
	freshMinutes: number,
	commitments?: {
		orders: readonly Commitment[];
		lines: readonly Line[];
		receipts: readonly Receipt[];
		delivered: readonly {
			order_line: string;
			quantity: string | ReturnType<typeof d>;
		}[];
	}
) {
	const fresh = (instant: string | null) =>
		instant !== null &&
		Date.parse(instant) <= Date.parse(now) &&
		Date.parse(now) - Date.parse(instant) <= freshMinutes * 60000;
	const sourceFresh = fresh(source.as_of) && fresh(source.orders_as_of);
	const sellable =
		sourceFresh && source.erp_committed !== null
			? d(source.on_hand).minus(source.erp_committed).toString()
			: null;
	if (!commitments)
		return {
			sellable,
			local_committed: null,
			projected: null,
			reason: sourceFresh
				? source.erp_committed === null
					? 'missing_commitments'
					: 'erp_only'
				: 'stale_source'
		} as const;
	if (sellable === null)
		return {
			sellable,
			local_committed: null,
			projected: null,
			reason: sourceFresh ? 'missing_commitments' : 'stale_source'
		} as const;
	const orders = commitments.orders.filter(
		(o) =>
			o.direction === 'sales' &&
			(o.status === 'confirmed' || o.status === 'draft') &&
			o.warehouse === source.warehouse
	);
	const approved = orders
		.map((order) => {
			const versions =
				order.operational_contracts && !isMasked(order.operational_contracts)
					? order.operational_contracts
					: [];
			const version = versions.at(-1);
			return { order, version, seal: version?.seal_hash ?? order.seal_hash };
		})
		.filter(({ order, version }) => version || order.status === 'confirmed');
	if (approved.some(({ version }) => version?.lines.some((line) => !line.product)))
		return {
			sellable,
			local_committed: null,
			projected: null,
			reason: 'contract_unreconciled'
		} as const;
	const included = (receipt: Receipt) =>
		receipt.status === 'issued' &&
		receipt.source_updated_at !== null &&
		Date.parse(receipt.source_updated_at) <= Date.parse(source.orders_as_of!);
	// An older source commitment is not proof that the amended quota has replaced it.
	if (
		approved.some(
			({ order, seal }) =>
				commitments.receipts.some(
					(receipt) =>
						receipt.order === order.id && receipt.agreement_hash !== seal && included(receipt)
				) &&
				!commitments.receipts.some(
					(receipt) =>
						receipt.order === order.id && receipt.agreement_hash === seal && included(receipt)
				)
		)
	)
		return {
			sellable,
			local_committed: null,
			projected: null,
			reason: 'contract_unreconciled'
		} as const;
	const pending = approved.filter(
		({ order, seal }) =>
			!commitments.receipts.some(
				(receipt) =>
					receipt.order === order.id && receipt.agreement_hash === seal && included(receipt)
			)
	);
	const lines = pending
		.flatMap<Line>(({ order, version }) =>
			version
				? version.lines.map((line) => ({ ...line, product: line.product ?? null, order: order.id }))
				: commitments.lines.filter((line) => line.order === order.id)
		)
		.filter((line) => line.product === source.product);
	if (lines.some((l) => l.unit !== source.unit))
		return { sellable, local_committed: null, projected: null, reason: 'unit_mismatch' } as const;
	// A delivery is not proof that the stock snapshot already includes its inventory movement.
	if (
		commitments.delivered.some(
			(f) => lines.some((l) => l.id === f.order_line) && d(f.quantity).gt(0)
		)
	)
		return {
			sellable,
			local_committed: null,
			projected: null,
			reason: 'delivery_unreconciled'
		} as const;
	const local = sum(lines.map((l) => l.quantity));
	return {
		sellable,
		local_committed: local.toString(),
		projected: d(sellable).minus(local).toString(),
		reason: 'available'
	} as const;
}
