// The reads the pages make, as a test caller makes them: each former declared query is the page's read request
// (`src/lib`) answered under the caller's authority, then the same pure helper the page and the file sync call.
import { BigDecimal, Effect, Schema } from 'effect';
import type { Id, PlainDate } from '@norbital-ai/bolt';
import type { Typed } from './test-runtime.js';
import { previewRead, commissionPreview } from '../src/lib/commission-expressions.js';
import { belowInventoryCost, quotationCostRead, quotationScopeRead } from '../src/lib/quotation.js';
import { inventoryCost, inventoryCostRead } from '../src/lib/lot-cost.js';
import { boardRead, commissionBoard, monthOf } from '../src/lib/monthly-commission.js';
import { documentRead, orderDocument } from '../src/lib/order-document.js';
import { numeric } from '../src/lib/commercial.js';
import {
	agingRead,
	arAging,
	commissionCalculation,
	commercialSalesRead,
	ledgerRead,
	paymentLedger,
	reportFields,
	reportLayers,
	salesDetail
} from '../src/lib/reports.js';
type Reader = Pick<Typed, 'query'>;
/** The message key a page's helper refuses with. */
class Refusal extends Schema.TaggedError<Refusal>()('Refusal', { message: Schema.String }) {}
/** A draft's quotation notices as its page reads them: the lines priced below remaining inventory cost. */
export const quotationOf = Effect.fnUntraced(function* (as: Reader, order: Id<'orders'>) {
	const scope = (yield* as.query(quotationScopeRead(order))).orders.rows[0];
	if (!scope) return yield* new Refusal({ message: 'errors.configuration_missing' });
	const answer = yield* as.query(quotationCostRead(scope));
	return { answer, below_inventory_cost: belowInventoryCost(answer) };
});
export const documentOf = Effect.fnUntraced(function* (as: Reader, input: { order: Id<'orders'> }) {
	return yield* orderDocument(yield* as.query(documentRead(input.order)));
});
/** Each synced sales order's commission on its agreed lines, under the rule it was synced with. */
export const commissionOf = Effect.fnUntraced(function* (
	as: Reader,
	input: { order?: Id<'orders'> | null } = {}
) {
	const { orders } = yield* as.query({
		orders: {
			where: {
				direction: { eq: 'sales' },
				status: { eq: 'confirmed' },
				...(input.order ? { id: { eq: input.order } } : {})
			},
			fields: reportFields,
			...reportLayers
		}
	});
	return yield* Effect.forEach(orders.rows, (order) =>
		commissionCalculation(order).pipe(
			Effect.map(({ amount }) => ({
				order: order.id,
				amount:
					amount &&
					new Intl.NumberFormat('en', {
						useGrouping: false,
						minimumFractionDigits: amount.scale,
						maximumFractionDigits: amount.scale
					}).format(numeric(BigDecimal.format(amount)))
			}))
		)
	);
});
export const salesDetailOf = Effect.fnUntraced(function* (
	as: Reader,
	range: { from?: PlainDate | null; to?: PlainDate | null } = {}
) {
	if (range.from && range.to && range.from > range.to)
		return yield* new Refusal({ message: 'errors.report_range' });
	return salesDetail(yield* as.query(commercialSalesRead), range);
});
export const agingOf = Effect.fnUntraced(function* (as: Reader, input: { as_of: PlainDate }) {
	return arAging(yield* as.query(agingRead(input.as_of)), input.as_of);
});
export const ledgerOf = Effect.fnUntraced(function* (
	as: Reader,
	input: {
		order?: Id<'orders'> | null;
		as_of?: PlainDate | null;
		unapplied?: boolean;
		include_withdrawn?: boolean;
	} = {}
) {
	return paymentLedger(yield* as.query(ledgerRead(input)), input);
});
export const boardOf = Effect.fnUntraced(function* (
	as: Reader,
	input: { period: string; commercial?: boolean }
) {
	const period = monthOf(input.period);
	return yield* commissionBoard(yield* as.query(boardRead(period, input.commercial)), period);
});
export const inventoryCostOf = Effect.fnUntraced(function* (
	as: Reader,
	input: Parameters<typeof inventoryCost>[1] & { product: Id<'products'> }
) {
	return inventoryCost(yield* as.query(inventoryCostRead(input.product)), input);
});
export const previewOf = Effect.fnUntraced(function* (
	as: Reader,
	input: Parameters<typeof commissionPreview>[1] & { rule: Id<'commission_rules'> }
) {
	const outcome = commissionPreview(yield* as.query(previewRead(input.rule)), input);
	return outcome ?? (yield* new Refusal({ message: 'errors.commission_expression_invalid' }));
});
