import { Decimal, sum } from '@norbital-ai/std/decimal';
import { Result } from 'effect';
import { isMasked, type ReadAnswer, type Row } from '@norbital-ai/bolt';
/** The stock read: every snapshot with its product and warehouse names, and the freshness setting. */
export const stockRead = {
	stock_snapshots: {},
	'stock_snapshots.product': { fields: ['name'] },
	'stock_snapshots.warehouse': { fields: ['name'] },
	commercial_settings: { where: { code: { eq: 'default' } }, limit: 1 }
} as const;
/** The stock read with the open-order commitments projected availability subtracts. */
export const projectedRead = {
	...stockRead,
	orders: {
		fields: ['warehouse', 'direction', 'status', 'sealed_at', 'operational_contracts', 'seal_hash']
	},
	'orders.lines': { fields: ['product', 'unit', 'quantity'] },
	'orders.ext_sales_orders': { fields: ['status', 'agreement_hash', 'source_updated_at'] },
	'orders.transactions': {
		where: { kind: { eq: 'delivery' }, status: { eq: 'issued' } },
		fields: ['items']
	}
} as const;
type StockAnswer = ReadAnswer<typeof stockRead>;
function quantities(result: ReturnType<typeof availability>) {
	return {
		...result,
		sellable: result.sellable === null ? null : Decimal.of(result.sellable),
		local_committed: result.local_committed === null ? null : Decimal.of(result.local_committed),
		projected: result.projected === null ? null : Decimal.of(result.projected)
	};
}
/** Each snapshot's availability at `now` (`commitments` subtracts open orders), or the missing configuration. */
function stockRows(
	answer: StockAnswer,
	now: string,
	commitments?: Parameters<typeof availability>[3]
) {
	const settings = answer.commercial_settings.rows[0];
	if (!settings) return Result.fail('errors.configuration_missing' as const);
	return Result.succeed(
		answer.stock_snapshots.rows.map(({ product, warehouse, ...s }) => {
			const source = {
				...s,
				// both refs are required: a snapshot always names its product and warehouse
				product: product?.id ?? '',
				product_name: product?.name ?? '',
				warehouse: warehouse?.id ?? '',
				warehouse_name: warehouse?.name ?? ''
			};
			return {
				...source,
				...quantities(availability(source, now, settings.stock_fresh_minutes, commitments))
			};
		})
	);
}
/** Stock availability at an instant, from the ERP's own commitments. */
export const erpAvailability = (answer: StockAnswer, now: string) => stockRows(answer, now);
/** Stock available at an instant after open-order commitments. */
export function projectedAvailability(answer: ReadAnswer<typeof projectedRead>, now: string) {
	const orders = answer.orders.rows;
	const lines = orders.flatMap((order) =>
		order.lines.map((line) => ({ ...line, order: order.id }))
	);
	return stockRows(answer, now, {
		orders,
		lines,
		receipts: orders.flatMap((order) =>
			order.ext_sales_orders.map((receipt) => ({ ...receipt, order: order.id }))
		),
		delivered: orders.flatMap((order) =>
			order.transactions.flatMap((row) =>
				(isMasked(row.items)
					? [
							...lines.filter((line) => line.order === order.id),
							...(order.operational_contracts && !isMasked(order.operational_contracts)
								? order.operational_contracts
								: []
							).flatMap((version) => version.lines)
						].map((line) => ({ order_line_id: line.id, quantity: '1' }))
					: (row.items ?? [])
				).map((item) => ({ order_line: item.order_line_id, quantity: item.quantity }))
			)
		)
	});
}
type Source = Pick<
	Row<'stock_snapshots'>,
	'unit' | 'on_hand' | 'erp_committed' | 'as_of' | 'orders_as_of'
> & { readonly product: string; readonly warehouse: string };
type Commitment = Pick<
	Row<'orders'>,
	'id' | 'warehouse' | 'direction' | 'status' | 'sealed_at' | 'seal_hash'
> &
	Partial<Pick<Row<'orders'>, 'operational_contracts' | 'archived'>>;
type Line = {
	id: string;
	order: string;
	product: string | null | undefined;
	unit: string;
	quantity: string | ReturnType<typeof Decimal.of>;
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
			quantity: string | ReturnType<typeof Decimal.of>;
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
			? Decimal.of(source.on_hand).minus(source.erp_committed).toString()
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
			const marked = versions.some((version) => version.current !== undefined);
			const version = marked ? versions.find((version) => version.current) : versions.at(-1);
			return { order, version, marked, seal: version?.seal_hash ?? order.seal_hash };
		})
		.filter(({ order, version, marked }) => version || (!marked && order.status === 'confirmed'));
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
			(f) => lines.some((l) => l.id === f.order_line) && Decimal.of(f.quantity).gt(0)
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
		projected: Decimal.of(sellable).minus(local).toString(),
		reason: 'available'
	} as const;
}
