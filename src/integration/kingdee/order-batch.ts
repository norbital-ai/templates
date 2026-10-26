import { Decimal, currency } from '@norbital-ai/std/decimal';
import { PlainDate } from '@norbital-ai/std/date';
import { price } from '../../lib/commercial.js';
import { SourceRowInvalid } from './polling.js';

export type OrderLine = {
	readonly id: string;
	readonly source_entry_id?: string;
	readonly product_code: string;
	readonly unit: string;
	readonly quantity: string;
	readonly unit_price: string;
	readonly discount_pct: string;
	readonly tax_rate: string;
	readonly net: string;
	readonly tax: string;
	readonly total: string;
};
export type OrderPayload = {
	readonly order_id: string;
	readonly reference: string;
	readonly direction: 'sales' | 'purchasing';
	readonly agreement_hash: string;
	readonly version: number;
	readonly owner_id: string;
	readonly ordered_on: string;
	readonly currency: string;
	readonly tax_inclusive: boolean;
	readonly party_code: string;
	readonly payment_terms: string;
	readonly lines: readonly OrderLine[];
	readonly previous?: {
		readonly binding_id: string;
		readonly source_id: string;
		readonly source_uuid: string;
		readonly source_version: string;
		readonly source_exchange_rate: string;
		readonly agreement_hash: string;
		readonly tax_inclusive: boolean;
		readonly lines: readonly (OrderLine & { readonly source_entry_id: string })[];
	};
};
export type SourceOrderBindings = {
	readonly branchNo: string;
	readonly billerId: string;
	readonly employeeId: string;
	readonly departmentId: string;
	readonly customerId: string;
	readonly settlementId: string;
	readonly currencyId: string;
	readonly baseCurrency: string;
	readonly rate: string;
	readonly packagingId: string;
	readonly creditDays: number;
	readonly fromMonthEnd: boolean;
	readonly items: readonly { readonly itemId: string; readonly unitId: string }[];
};
export type SourceOrderBatch = {
	readonly header: Readonly<Record<string, string>>;
	readonly items: readonly Readonly<Record<string, string>>[];
};
/** These source identifiers and SQL types are authored constants, never connection configuration. */
export const headerTypes = {
	FBrNo: 'nvarchar(20)',
	FBillNo: 'nvarchar(200)',
	FTranType: 'int',
	FCurrencyID: 'int',
	FCustID: 'int',
	FDate: 'datetime',
	FExchangeRate: 'decimal(28,10)',
	FDeptID: 'int',
	FEmpID: 'int',
	FBillerID: 'int',
	FSettleID: 'int',
	FSysStatus: 'int',
	FAreaPS: 'int',
	FSaleStyle: 'int',
	FSendWay: 'nvarchar(100)',
	FWXCardCouponsMoney: 'nvarchar(100)',
	FDeliveryProvince: 'nvarchar(100)',
	FDeliveryCity: 'nvarchar(100)',
	FDeliveryDistrict: 'nvarchar(100)',
	FDeliveryTownship: 'nvarchar(100)',
	FMangerID: 'int',
	FTransitAheadTime: 'int',
	FManageType: 'int',
	FValidaterName: 'nvarchar(100)',
	FFetchStyle: 'nvarchar(100)',
	FFetchAdd: 'nvarchar(100)',
	FOutStoreDate: 'datetime',
	FOutStoreTime: 'nvarchar(100)',
	FTplOrderID: 'nvarchar(100)',
	FHeadSelfS0191: 'nvarchar(100)',
	FHeadSelfS0192: 'nvarchar(100)',
	FSettleDate: 'datetime'
} as const;
export const itemTypes = {
	FEntryID: 'int',
	FItemID: 'int',
	FUnitID: 'int',
	FQty: 'decimal(28,10)',
	Fauxqty: 'decimal(28,10)',
	FAuxStockAwaitQty: 'decimal(28,10)',
	FComplexQty: 'decimal(28,10)',
	Fauxprice: 'decimal(28,10)',
	FPrice: 'decimal(28,10)',
	FAuxTaxPrice: 'decimal(28,10)',
	FTaxPrice: 'decimal(28,10)',
	FPriceDiscount: 'decimal(28,10)',
	FAuxPriceDiscount: 'decimal(28,10)',
	FCESS: 'decimal(28,10)',
	FAmount: 'decimal(28,10)',
	FAllAmount: 'decimal(28,10)',
	FAllStdAmount: 'decimal(28,10)',
	FTaxAmt: 'decimal(28,10)',
	FDate: 'datetime',
	FAdviceConsignDate: 'datetime',
	FNote: 'nvarchar(100)',
	FICPrcPly_FName: 'nvarchar(100)',
	FTplExtendKey1: 'nvarchar(100)',
	FMapModel: 'nvarchar(100)',
	FInForeCast: 'int',
	FEntrySelfS0172: 'nvarchar(100)',
	FEntrySelfS0173: 'nvarchar(100)'
} as const;
const invalid = (column: string, reason: string): never => {
	throw new SourceRowInvalid({ column, reason });
};
export function sourceInteger(value: string, column: string): string {
	if (
		!/^\d+$/.test(value) ||
		!Number.isSafeInteger(Number(value)) ||
		Number(value) <= 0 ||
		Number(value) > 2147483647
	)
		return invalid(column, 'A positive SQL Server internal ID is required');
	return String(Number(value));
}
/** An amendment keeps existing entry identities and appends new ones; positions are never renumbered. */
export function sourceEntryIds(payload: OrderPayload) {
	if (
		!Number.isInteger(payload.version) || payload.version < 1 ||
		payload.lines.length === 0 || payload.lines.length > 200 ||
		payload.lines.some((line) => line.id.trim() === '') ||
		new Set(payload.lines.map((line) => line.id)).size !== payload.lines.length
	)
		return invalid('lines', 'A contract requires a bounded set of unique line identities');
	if (payload.version === 1 && payload.previous === undefined) {
		if (payload.lines.some((line) => line.source_entry_id !== undefined))
			return invalid('FEntryID', 'Existing source entries require the previous source basis');
		return payload.lines.map((line, index) => ({
			local_line_id: line.id,
			entry_id: String(index + 1)
		}));
	}
	const previous = payload.previous;
	if (
		previous === undefined ||
		previous.binding_id.trim() === '' || previous.binding_id.length > 512 ||
		!/^\d{3}$/.test(previous.source_version) ||
		previous.source_version === '999' ||
		!previous.agreement_hash ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			previous.source_uuid
		) ||
		previous.lines.length === 0 ||
		previous.lines.length > 200 ||
		new Set(previous.lines.map((line) => line.id)).size !== previous.lines.length
	)
		return invalid('version', 'An amendment requires the complete previously observed source version');
	sourceInteger(previous.source_id, 'FInterID');
	if (Decimal.of(previous.source_exchange_rate).lte(0))
		return invalid('currency', 'A positive previously observed exchange rate is required');
	const existing = new Map(
		previous.lines.map((line) => [line.id, sourceInteger(line.source_entry_id, 'FEntryID')])
	);
	if (new Set(existing.values()).size !== existing.size)
		return invalid('FEntryID', 'The previous source entry identities are ambiguous');
	const sourceLines = new Map(
		previous.lines.map((line) => [sourceInteger(line.source_entry_id, 'FEntryID'), line])
	);
	const used = new Set<string>();
	let next = Math.max(...[...existing.values()].map(Number));
	return payload.lines.map((line) => {
		const known = existing.get(line.id);
		const explicit = line.source_entry_id === undefined
			? undefined
			: sourceInteger(line.source_entry_id, 'FEntryID');
		if (explicit !== undefined && !sourceLines.has(explicit))
			return invalid('FEntryID', 'The claimed source entry is absent from the previous source basis');
		if (explicit !== undefined && known !== undefined && explicit !== known)
			return invalid('FEntryID', 'An existing local line cannot change its source entry identity');
		const entry = explicit ?? known ?? sourceInteger(String(++next), 'FEntryID');
		const basis = sourceLines.get(entry);
		if (basis && (sourceInteger(basis.product_code, 'FItemID') !== sourceInteger(line.product_code, 'FItemID') || basis.unit !== line.unit))
			return invalid('FEntryID', 'A source entry cannot be reassigned to another product or unit');
		if (used.has(entry))
			return invalid('FEntryID', 'More than one target line claims the same source entry');
		used.add(entry);
		return { local_line_id: line.id, entry_id: entry };
	});
}
/** The installed ledger has no source credit-day column; the explicit term binding supplies this rule. */
export function settlementDate(orderedOn: string, days: number, fromMonthEnd: boolean): string {
	PlainDate(orderedOn);
	if (!Number.isInteger(days) || days < 0 || days > 3660)
		return invalid('payment_terms', 'Settlement credit days must be an integer between 0 and 3660');
	const [year = 0, month = 0, day = 0] = orderedOn.split('-').map(Number);
	// Reference-ledger rule: positive month-end terms use next month-end; the day count is not added.
	const date = fromMonthEnd
		? new Date(Date.UTC(year, days === 0 ? month : month + 1, 0))
		: new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
	return date.toISOString().slice(0, 10);
}
const escape = (value: string) =>
	value.replace(/[&<>"']/g, (character) => {
		switch (character) {
			case '&':
				return '&amp;';
			case '<':
				return '&lt;';
			case '>':
				return '&gt;';
			case '"':
				return '&quot;';
			default:
				return '&apos;';
		}
	});
/** Actual KIS sales-order projection; source approval remains a separate Kingdee operation. */
export function sourceOrderBatch(
	payload: OrderPayload,
	bindings: SourceOrderBindings
): SourceOrderBatch {
	if (payload.direction !== 'sales')
		return invalid('direction', 'The purchase-order write mapping has not been verified');
	if (!Number.isInteger(payload.version) || payload.version < 1)
		return invalid('version', 'A positive contract version is required');
	if (
		payload.lines.length === 0 ||
		payload.lines.length > 200 ||
		payload.lines.length !== bindings.items.length
	)
		return invalid('lines', 'A complete sales order requires between 1 and 200 mapped items');
	PlainDate(payload.ordered_on);
	if (bindings.packagingId !== '') sourceInteger(bindings.packagingId, 'packagingId');
	const rate = Decimal.of(bindings.rate);
	if (rate.lte(0)) return invalid('currency', 'A positive source exchange rate is required');
	const date = `${payload.ordered_on}T00:00:00`;
	const values = {
		FBrNo: bindings.branchNo,
		FBillNo: payload.reference,
		FTranType: '81',
		FCurrencyID: sourceInteger(bindings.currencyId, 'FCurrencyID'),
		FCustID: sourceInteger(bindings.customerId, 'FCustID'),
		FDate: date,
		FExchangeRate: rate.toString(),
		FDeptID: sourceInteger(bindings.departmentId, 'FDeptID'),
		FEmpID: sourceInteger(bindings.employeeId, 'FEmpID'),
		FBillerID: sourceInteger(bindings.billerId, 'FBillerID'),
		FSettleID: sourceInteger(bindings.settlementId, 'FSettleID'),
		FSysStatus: '2',
		FAreaPS: '20302',
		FSaleStyle: '102',
		FSendWay: 'N',
		FWXCardCouponsMoney: '',
		FDeliveryProvince: '0',
		FDeliveryCity: '0',
		FDeliveryDistrict: '0',
		FDeliveryTownship: '0',
		FMangerID: '0',
		FTransitAheadTime: '0',
		FManageType: '0',
		FValidaterName: '',
		FFetchStyle: '',
		FFetchAdd: '',
		FOutStoreDate: '1900-01-01T00:00:00',
		FOutStoreTime: '',
		FTplOrderID: '',
		FHeadSelfS0191: '',
		FHeadSelfS0192: '-',
		FSettleDate: `${settlementDate(payload.ordered_on, bindings.creditDays, bindings.fromMonthEnd)}T00:00:00`
	};
	const entries = sourceEntryIds(payload);
	const rows = payload.lines.map((line, index) => {
		const item = bindings.items[index];
		if (item === undefined) return invalid('lines', 'Source item mapping is missing');
		const quantity = Decimal.of(line.quantity);
		const discount = Decimal.of(line.discount_pct);
		const taxRate = Decimal.of(line.tax_rate);
		if (
			quantity.lte(0) ||
			Decimal.of(line.unit_price).lt(0) ||
			discount.lt(0) ||
			discount.gt(100) ||
			taxRate.lt(0) ||
			taxRate.gt(100)
		)
			return invalid('lines', 'Invalid source quantity, discount or tax rate');
		const actual = price(
			{ currency: currency(payload.currency), tax_inclusive: payload.tax_inclusive },
			line
		);
		if (!actual.net.eq(line.net) || !actual.tax.eq(line.tax) || !actual.total.eq(line.total))
			return invalid('lines', 'The sealed line amounts do not match its quantity, price and tax');
		const discounted = Decimal.of(line.unit_price)
			.times(Decimal.of(100).minus(discount))
			.div(100, 12);
		const factor = Decimal.of(1).plus(taxRate.div(100, 6));
		const exclusive = payload.tax_inclusive ? discounted.div(factor, 8) : discounted;
		const inclusive = payload.tax_inclusive ? discounted : discounted.times(factor).round(8);
		return {
			FEntryID: entries[index]?.entry_id ?? invalid('FEntryID', 'Source entry mapping is missing'),
			FItemID: sourceInteger(item.itemId, 'FItemID'),
			FUnitID: sourceInteger(item.unitId, 'FUnitID'),
			FQty: quantity.toString(),
			Fauxqty: quantity.toString(),
			FAuxStockAwaitQty: quantity.toString(),
			FComplexQty: quantity.toString(),
			Fauxprice: exclusive.toString(),
			FPrice: exclusive.toString(),
			FAuxTaxPrice: inclusive.toString(),
			FTaxPrice: inclusive.toString(),
			FPriceDiscount: inclusive.toString(),
			FAuxPriceDiscount: inclusive.toString(),
			FCESS: taxRate.toString(),
			FAmount: actual.net.toString(),
			FAllAmount: actual.total.toString(),
			FAllStdAmount: actual.total.times(rate).roundTo(bindings.baseCurrency).toString(),
			FTaxAmt: actual.tax.toString(),
			FDate: date,
			FAdviceConsignDate: date,
			FNote: '',
			FICPrcPly_FName: '',
			FTplExtendKey1: '',
			FMapModel: '',
			FInForeCast: '0',
			FEntrySelfS0172: bindings.packagingId,
			FEntrySelfS0173: ''
		};
	});
	return { header: values, items: rows };
}
export function sourceOrderDocument(batch: SourceOrderBatch): string {
	const attributes = (row: Readonly<Record<string, string>>) =>
		Object.entries(row)
			.map(([name, value]) => `${name}="${escape(value)}"`)
			.join(' ');
	return `<order><header ${attributes(batch.header)}/><items>${batch.items.map((row) => `<item ${attributes(row)}/>`).join('')}</items></order>`;
}
