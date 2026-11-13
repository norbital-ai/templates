// The reads the pages make, as a test caller makes them: each former declared query is the page's read request
// (`src/lib`) answered under the caller's authority, then the same pure helper the page and the file sync call.
import { Effect, Result, Schema } from 'effect';
import type { Id, PlainDate } from '@norbital-ai/bolt';
import type { Typed } from './test-runtime.js';
import { previewRead, commissionPreview } from '../src/lib/commission-expressions.js';
import {
	confirmationCheck,
	confirmationHash,
	confirmationRead,
	quotationExport,
	quotationRead
} from '../src/lib/confirmation.js';
import { inventoryCost, inventoryCostRead } from '../src/lib/lot-cost.js';
import { boardRead, commissionBoard, monthOf } from '../src/lib/monthly-commission.js';
import { documentRead, orderDocument } from '../src/lib/order-document.js';
import {
	agingRead,
	arAging,
	commissionRead,
	commissionReport,
	commercialSalesRead,
	ledgerRead,
	paymentLedger,
	salesAnalysis,
	salesDetail
} from '../src/lib/reports.js';
type Reader = Pick<Typed, 'query'>;
/** The message key a page's helper refuses with. */
class Refusal extends Schema.TaggedError<Refusal>()('Refusal', { message: Schema.String }) {}
/** A helper's refusal surfaces as the message key the declared query refused with. */
const settled = <A>(result: Result.Result<A, string>) =>
	Result.isSuccess(result)
		? Effect.succeed(result.success)
		: Effect.fail(new Refusal({ message: result.failure }));
export const confirmationOf = Effect.fnUntraced(function* (
	as: Reader,
	input: { order: Id<'orders'>; revision?: number | null; as_of: string }
) {
	const check = yield* settled(
		confirmationCheck(yield* as.query(confirmationRead(input.order)), input)
	);
	return { ...check, check_hash: yield* confirmationHash(check) };
});
export const quotationOf = Effect.fnUntraced(function* (
	as: Reader,
	input: { order: Id<'orders'>; revision?: number | null }
) {
	return yield* settled(
		quotationExport(yield* as.query(quotationRead(input.order)), input.revision)
	);
});
export const documentOf = Effect.fnUntraced(function* (as: Reader, input: { order: Id<'orders'> }) {
	return yield* orderDocument(yield* as.query(documentRead(input.order)));
});
export const commissionOf = Effect.fnUntraced(function* (
	as: Reader,
	input: { order?: Id<'orders'> | null } = {}
) {
	return commissionReport(yield* as.query(commissionRead), input);
});
export const salesAnalysisOf = Effect.fnUntraced(function* (
	as: Reader,
	range: { from?: PlainDate | null; to?: PlainDate | null } = {}
) {
	if (range.from && range.to && range.from > range.to)
		return yield* new Refusal({ message: 'errors.report_range' });
	return salesAnalysis(yield* as.query(commercialSalesRead), range);
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
