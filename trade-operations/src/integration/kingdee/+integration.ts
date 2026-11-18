import { integration } from '@norbital-ai/bolt';
import { sourceState, SourceUnavailable } from './polling.js';
import {
	kingdeeConfiguration,
	kingdeeDeliveryCostAccount,
	kingdeeInvoiceAnalysisAccount,
	kingdeePurchaseAccount,
	kingdeeReceivablesAccount,
	kingdeeStockAvailabilityAccount,
	kingdeeStockLotCostAccount,
	kingdeeWriteAccount
} from './configuration.js';
import { kingdeeCreditAccount, kingdeeCreditPolicy } from './configuration.js';
import { testCreditSource } from './credit-source.js';
import { invoiceAnalysisProjection } from './invoice-analysis.js';
import { testPurchases } from './purchases.js';
import { testReceivables } from './receivables.js';
import { bindings } from './source-bindings.js';
import { testStockCommitments } from './stock-commitments.js';
import { testStockLotCosts } from './stock-lot-costs.js';
import { testDeliveryCosts } from './order-source.js';
import { sourcePage } from './sql.js';

export default integration('kingdee', {
	description:
		'Kingdee SQL Server: direct SQL sync with the on-premises account set over the Alibaba link.',
	driver: 'sqlserver',
	credential: {
		connectionString: { kind: 'text' }
	},
	configuration: kingdeeConfiguration,
	test: function* (ctx) {
		if (ctx.configuration.creditPolicy || ctx.configuration.creditAccount?.trim()) {
			const account = kingdeeCreditAccount(ctx.configuration);
			if (
				ctx.configuration.creditPolicy !== kingdeeCreditPolicy ||
				account === null ||
				ctx.configuration.baseCurrency !== 'CNY'
			)
				return yield* new SourceUnavailable({
					reason:
						'Credit requires the native KIS sales-out policy, CNY and a verified account identity'
				});
			yield* testCreditSource(ctx, account);
		}
		for (const source of Object.values(bindings)) {
			const state = yield* sourceState(ctx, source);
			if (
				ctx.configuration.writeAccount?.trim() &&
				kingdeeWriteAccount(ctx.configuration)?.toLowerCase() !== state.account
			)
				return yield* new SourceUnavailable({
					reason:
						'The configured order write account does not match this Kingdee database and recovery fork'
				});
			// SQL Server checks columns and SELECT permissions even when the projection returns no rows.
			yield* sourcePage(ctx, source, { limit: 0 });
		}
		if (ctx.configuration.invoiceAnalysisAccount?.trim()) {
			const account = kingdeeInvoiceAnalysisAccount(ctx.configuration);
			const state = yield* sourceState(ctx, invoiceAnalysisProjection);
			if (account === null || state.account !== account)
				return yield* new SourceUnavailable({
					reason:
						'The invoice analysis account does not match the Kingdee database and recovery fork'
				});
			yield* sourcePage(ctx, invoiceAnalysisProjection, { limit: 0, account });
		}
		if (ctx.configuration.purchaseAccount?.trim()) {
			const account = kingdeePurchaseAccount(ctx.configuration);
			if (account === null)
				return yield* new SourceUnavailable({
					reason: 'Purchase documents require a verified account identity'
				});
			yield* testPurchases(ctx, account);
		}
		if (ctx.configuration.receivablesAccount?.trim()) {
			const account = kingdeeReceivablesAccount(ctx.configuration);
			if (account === null)
				return yield* new SourceUnavailable({
					reason: 'Receivables aging requires a verified account identity'
				});
			yield* testReceivables(ctx, account);
		}
		if (ctx.configuration.stockAvailabilityAccount?.trim()) {
			const account = kingdeeStockAvailabilityAccount(ctx.configuration);
			if (account === null)
				return yield* new SourceUnavailable({
					reason: 'Stock availability requires a verified account identity'
				});
			yield* testStockCommitments(ctx, account);
		}
		if (ctx.configuration.stockLotCostAccount?.trim()) {
			const account = kingdeeStockLotCostAccount(ctx.configuration);
			if (account === null)
				return yield* new SourceUnavailable({
					reason: 'Purchase lot costs require a verified account identity'
				});
			yield* testStockLotCosts(ctx, account);
		}
		if (ctx.configuration.deliveryCostAccount?.trim()) {
			const account = kingdeeDeliveryCostAccount(ctx.configuration);
			if (account === null)
				return yield* new SourceUnavailable({
					reason: 'Booked delivery cost requires a verified account identity'
				});
			yield* testDeliveryCosts(ctx, account);
		}
	}
});
