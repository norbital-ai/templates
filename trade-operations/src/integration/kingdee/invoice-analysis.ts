import { BigDecimal, Effect } from 'effect';
import type { InstanceId, SyncCtx, Json } from '@norbital-ai/bolt';
import { kingdeeInvoiceAnalysisAccount } from './configuration.js';
import { exactId, flag, isoCurrency, nullableText, sourceDate, text } from './order-source.js';
import {
	columns,
	Instant,
	readSource,
	sourceState,
	SourceRowInvalid,
	SourceUnavailable,
	type SqlRow
} from './polling.js';
import { preserveSource } from './reconciliation.js';
import type { SourceProjection } from './sql.js';

const ref = (tableAlias: string, name: string) => ({ tableAlias, name });
const field = (tableAlias: string, name: string) => ({ column: ref(tableAlias, name) });
const join = (
	kind: 'left' | 'inner',
	name: string,
	alias: string,
	left: ReturnType<typeof ref>,
	key: string
) => ({ kind, table: { schema: 'dbo', name }, alias, on: [{ left, right: ref(alias, key) }] });
const fields = {
	detail_id: field('line', 'FDetailID'),
	entry_id: field('line', 'FEntryID'),
	reference: field('invoice', 'FBillNo'),
	invoiced_on: field('invoice', 'FDate'),
	checked_on: field('invoice', 'FCheckDate'),
	cancelled: field('invoice', 'FCancellation'),
	invoice_type: field('invoice', 'FTranType'),
	sign: field('invoice', 'FROB'),
	currency: field('denomination', 'FNumber'),
	customer: field('customer', 'FName'),
	product: field('product', 'FName'),
	employee: field('employee', 'FName'),
	employee_id: field('invoice', 'FEmpID'),
	unit: field('unit', 'FName'),
	quantity: field('line', 'FQty'),
	net: field('line', 'FAmount'),
	gross: field('line', 'FAllAmount'),
	tax: field('line', 'FTaxAmount')
};

/** ICSale has no branch column. Only verified non-delivery line types feed the account-set report. */
const legacyInvoiceAnalysisProjection: SourceProjection = {
	table: { schema: 'dbo', name: 'ICSale' },
	alias: 'invoice',
	key: 'detail_id',
	columns: Object.keys(fields),
	fields,
	rowversion: 'FOperDate',
	joins: [
		join('inner', 'ICSaleEntry', 'line', ref('invoice', 'FInterID'), 'FInterID'),
		join('left', 't_Currency', 'denomination', ref('invoice', 'FCurrencyID'), 'FCurrencyID'),
		join('left', 't_Organization', 'customer', ref('invoice', 'FCustID'), 'FItemID'),
		join('left', 't_Item', 'product', ref('line', 'FItemID'), 'FItemID'),
		join('left', 't_Item', 'unit', ref('line', 'FUnitID'), 'FItemID'),
		join('left', 't_Emp', 'employee', ref('invoice', 'FEmpID'), 'FItemID')
	],
	filters: [
		{ field: ref('invoice', 'FTranType'), op: 'in', value: [80, 86] },
		{ field: ref('invoice', 'FDate'), op: 'gte', value: '20250101' },
		{ field: ref('line', 'FSourceTranType'), op: 'in', value: [0, 80, null] }
	],
	dates: ['invoiced_on', 'checked_on'],
	decimals: ['quantity', 'net', 'gross', 'tax'],
	texts: ['detail_id', 'entry_id', 'employee_id', 'sign']
};

export const invoiceAnalysisProjection: SourceProjection = {
	...legacyInvoiceAnalysisProjection,
	joins: [
		...(legacyInvoiceAnalysisProjection.joins ?? []),
		{
			...join('left', 'ICSaleEntry', 'delivery_line', ref('invoice', 'FInterID'), 'FInterID'),
			where: { FSourceTranType: 21 }
		}
	],
	filters: [
		...(legacyInvoiceAnalysisProjection.filters ?? []),
		{ field: ref('delivery_line', 'FInterID'), op: 'eq', value: null }
	]
};

function invoiceFact(row: SqlRow, observedAt: string) {
	const business_on = sourceDate(row, 'invoiced_on');
	const sign = text(row, 'sign');
	if (!business_on || (sign !== '1' && sign !== '-1'))
		throw new SourceRowInvalid({
			column: 'ICSale',
			reason: 'Expected a dated invoice with a verified red or blue sign'
		});
	const r = columns(row);
	const quantity = r.decimal('quantity');
	const net = r.decimal('net', null);
	const gross = r.decimal('gross', null);
	// The measured type-86 entries carry money in FAmount while FAllAmount is zero.
	const tax =
		exactId(row, 'invoice_type') === '86' || net === null || gross === null
			? r.decimal('tax', null)
			: BigDecimal.subtract(gross, net);
	return {
		external_code: `invoice-only:${exactId(row, 'detail_id')}`,
		kind: 'invoice_only' as const,
		reference: `${text(row, 'reference')}/${exactId(row, 'entry_id')}`,
		business_on,
		source_updated_at: Instant(observedAt),
		unit: nullableText(row, 'unit') ?? '',
		quantity: new Intl.NumberFormat('en', {
			useGrouping: false,
			minimumFractionDigits: quantity.scale,
			maximumFractionDigits: quantity.scale
		}).format(BigDecimal.format(quantity) as Intl.StringNumericLiteral),
		currency: isoCurrency(row),
		net_amount:
			net === null
				? null
				: new Intl.NumberFormat('en', {
						useGrouping: false,
						minimumFractionDigits: net.scale,
						maximumFractionDigits: net.scale
					}).format(BigDecimal.format(net) as Intl.StringNumericLiteral),
		tax_amount:
			tax === null
				? null
				: new Intl.NumberFormat('en', {
						useGrouping: false,
						minimumFractionDigits: tax.scale,
						maximumFractionDigits: tax.scale
					}).format(BigDecimal.format(tax) as Intl.StringNumericLiteral),
		source_dimensions: {
			customer: nullableText(row, 'customer'),
			product: nullableText(row, 'product'),
			employee: nullableText(row, 'employee'),
			employee_id: nullableText(row, 'employee_id')
		},
		active: sourceDate(row, 'checked_on') !== null && !flag(row, 'cancelled')
	};
}

export const readInvoiceAnalysis = Effect.fnUntraced(function* (
	instance: InstanceId<'kingdee'>,
	cursor: Json | null,
	ctx: SyncCtx<'kingdee'>
) {
	if (!ctx.configuration.invoiceAnalysisAccount?.trim()) return { rows: [], cursor, more: false };
	const account = kingdeeInvoiceAnalysisAccount(ctx.configuration);
	if (account === null)
		return yield* new SourceUnavailable({
			reason: 'Invoice-only analysis requires a verified database and recovery fork identity'
		});
	const { sys_integration: ledgers } = yield* ctx.query({
		sys_integration: { where: { integration: { eq: 'kingdee' } }, fields: ['configuration'] }
	});
	if (
		ledgers.rows.some(
			(ledger) =>
				ledger.id !== instance && kingdeeInvoiceAnalysisAccount(ledger.configuration) === account
		)
	)
		return yield* new SourceUnavailable({
			reason: 'Enable account-wide invoice-only analysis on just one Kingdee ledger per account set'
		});
	const read = (position: Json | null) =>
		readSource(
			invoiceAnalysisProjection,
			position,
			ctx,
			invoiceFact,
			preserveSource({
				model: 'source_sales_lines',
				instance,
				projection: invoiceAnalysisProjection,
				ctx,
				account
			}),
			account
		);
	return yield* read(cursor).pipe(
		Effect.catchTag('CheckpointInvalid', (failure) =>
			Effect.gen(function* () {
				if (cursor === null || typeof cursor !== 'object' || !('source' in cursor))
					return yield* failure;
				const legacy = yield* sourceState(ctx, legacyInvoiceAnalysisProjection);
				if (legacy.account !== account || cursor.source !== legacy.source) return yield* failure;
				return yield* read(null);
			})
		)
	);
});
