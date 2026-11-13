import { BigDecimal, DateTime } from 'effect';
import { price } from '../../lib/commercial.js';
import { currency, PlainDate, SourceRowInvalid } from './polling.js';

type OrderLine = {
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
	/** The order's `source_order_key`: with its id, the SO's FUUID. */
	readonly key: string;
	readonly reference: string;
	readonly direction: 'sales' | 'purchasing';
	readonly owner_id: string;
	readonly ordered_on: string;
	readonly currency: string;
	readonly tax_inclusive: boolean;
	readonly party_code: string;
	readonly payment_terms: string;
	readonly write_target?: { readonly account: string; readonly branch: string };
	readonly lines: readonly OrderLine[];
	/** The SO as Kingdee holds it, when this write amends its lines. */
	readonly previous?: {
		readonly source_id: string;
		readonly source_uuid: string;
		readonly source_version: string;
		readonly source_exchange_rate: string;
		readonly lines: readonly {
			readonly entry: string;
			readonly item: string;
			readonly unit: string;
			readonly quantity: string;
			readonly exclusive: string;
			readonly inclusive: string;
			readonly tax_rate: string;
			readonly net: string;
			readonly tax: string;
			readonly total: string;
		}[];
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
		payload.lines.length === 0 ||
		payload.lines.length > 200 ||
		payload.lines.some((line) => line.id.trim() === '') ||
		new Set(payload.lines.map((line) => line.id)).size !== payload.lines.length
	)
		return invalid('lines', 'An order requires a bounded set of unique line identities');
	const previous = payload.previous;
	if (previous === undefined) {
		if (payload.lines.some((line) => line.source_entry_id !== undefined))
			return invalid('FEntryID', 'Existing source entries require the previous source basis');
		return payload.lines.map((line, index) => ({
			local_line_id: line.id,
			entry_id: String(index + 1)
		}));
	}
	if (
		!/^\d{3}$/.test(previous.source_version) ||
		previous.source_version === '999' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(previous.source_uuid) ||
		previous.lines.length === 0 ||
		previous.lines.length > 200
	)
		return invalid('version', 'An amendment requires the complete current source version');
	sourceInteger(previous.source_id, 'FInterID');
	if (!BigDecimal.isPositive(BigDecimal.fromStringUnsafe(previous.source_exchange_rate)))
		return invalid('currency', 'A positive previously observed exchange rate is required');
	const sourceLines = new Map(
		previous.lines.map((line) => [sourceInteger(line.entry, 'FEntryID'), line])
	);
	if (sourceLines.size !== previous.lines.length)
		return invalid('FEntryID', 'The previous source entry identities are ambiguous');
	const used = new Set<string>();
	let next = Math.max(...[...sourceLines.keys()].map(Number));
	return payload.lines.map((line) => {
		const explicit =
			line.source_entry_id === undefined
				? undefined
				: sourceInteger(line.source_entry_id, 'FEntryID');
		if (explicit !== undefined && !sourceLines.has(explicit))
			return invalid(
				'FEntryID',
				'The claimed source entry is absent from the previous source basis'
			);
		const entry = explicit ?? sourceInteger(String(++next), 'FEntryID');
		const basis = sourceLines.get(entry);
		if (
			basis &&
			(sourceInteger(basis.item, 'FItemID') !== sourceInteger(line.product_code, 'FItemID') ||
				basis.unit !== line.unit)
		)
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
	const ordered = DateTime.makeUnsafe(orderedOn);
	// Reference-ledger rule: positive month-end terms use next month-end; the day count is not added.
	return DateTime.formatIsoDateUtc(
		fromMonthEnd
			? DateTime.endOf(DateTime.add(ordered, { months: days === 0 ? 0 : 1 }), 'month')
			: DateTime.add(ordered, { days })
	);
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
	if (
		payload.lines.length === 0 ||
		payload.lines.length > 200 ||
		payload.lines.length !== bindings.items.length
	)
		return invalid('lines', 'A complete sales order requires between 1 and 200 mapped items');
	PlainDate(payload.ordered_on);
	if (bindings.packagingId !== '') sourceInteger(bindings.packagingId, 'packagingId');
	const rate = BigDecimal.fromStringUnsafe(bindings.rate);
	if (!BigDecimal.isPositive(rate))
		return invalid('currency', 'A positive source exchange rate is required');
	const date = `${payload.ordered_on}T00:00:00`;
	const values = {
		FBrNo: bindings.branchNo,
		FBillNo: payload.reference,
		FTranType: '81',
		FCurrencyID: sourceInteger(bindings.currencyId, 'FCurrencyID'),
		FCustID: sourceInteger(bindings.customerId, 'FCustID'),
		FDate: date,
		FExchangeRate: new Intl.NumberFormat('en', {
			useGrouping: false,
			minimumFractionDigits: Math.max(0, rate.scale),
			maximumFractionDigits: Math.max(0, rate.scale)
		}).format(BigDecimal.format(rate) as Intl.StringNumericLiteral),
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
		const quantity = BigDecimal.fromStringUnsafe(line.quantity);
		const discount = BigDecimal.fromStringUnsafe(line.discount_pct);
		const taxRate = BigDecimal.fromStringUnsafe(line.tax_rate);
		const hundred = BigDecimal.fromBigInt(100n);
		if (
			!BigDecimal.isPositive(quantity) ||
			BigDecimal.isNegative(BigDecimal.fromStringUnsafe(line.unit_price)) ||
			BigDecimal.isNegative(discount) ||
			BigDecimal.isGreaterThan(discount, hundred) ||
			BigDecimal.isNegative(taxRate) ||
			BigDecimal.isGreaterThan(taxRate, hundred)
		)
			return invalid('lines', 'Invalid source quantity, discount or tax rate');
		const actual = price(
			{ currency: currency(payload.currency), tax_inclusive: payload.tax_inclusive },
			line
		);
		if (
			!BigDecimal.equals(actual.net, BigDecimal.fromStringUnsafe(line.net)) ||
			!BigDecimal.equals(actual.tax, BigDecimal.fromStringUnsafe(line.tax)) ||
			!BigDecimal.equals(actual.total, BigDecimal.fromStringUnsafe(line.total))
		)
			return invalid('lines', 'The line amounts do not match its quantity, price and tax');
		const discounted = BigDecimal.round(
			BigDecimal.divideUnsafe(
				BigDecimal.multiply(
					BigDecimal.fromStringUnsafe(line.unit_price),
					BigDecimal.subtract(hundred, discount)
				),
				hundred
			),
			{ scale: 12 }
		);
		const factor = BigDecimal.sum(
			BigDecimal.fromBigInt(1n),
			BigDecimal.round(BigDecimal.divideUnsafe(taxRate, hundred), { scale: 6 })
		);
		const exclusive = payload.tax_inclusive
			? BigDecimal.round(BigDecimal.divideUnsafe(discounted, factor), { scale: 8 })
			: discounted;
		const inclusive = payload.tax_inclusive
			? discounted
			: BigDecimal.round(BigDecimal.multiply(discounted, factor), { scale: 8 });
		const standard = BigDecimal.round(BigDecimal.multiply(actual.total, rate), {
			scale:
				new Intl.NumberFormat('en', {
					style: 'currency',
					currency: bindings.baseCurrency
				}).resolvedOptions().maximumFractionDigits ?? 2
		});
		return {
			FEntryID: entries[index]?.entry_id ?? invalid('FEntryID', 'Source entry mapping is missing'),
			FItemID: sourceInteger(item.itemId, 'FItemID'),
			FUnitID: sourceInteger(item.unitId, 'FUnitID'),
			FQty: new Intl.NumberFormat('en', {
				useGrouping: false,
				minimumFractionDigits: Math.max(0, quantity.scale),
				maximumFractionDigits: Math.max(0, quantity.scale)
			}).format(BigDecimal.format(quantity) as Intl.StringNumericLiteral),
			Fauxqty: new Intl.NumberFormat('en', {
				useGrouping: false,
				minimumFractionDigits: Math.max(0, quantity.scale),
				maximumFractionDigits: Math.max(0, quantity.scale)
			}).format(BigDecimal.format(quantity) as Intl.StringNumericLiteral),
			FAuxStockAwaitQty: new Intl.NumberFormat('en', {
				useGrouping: false,
				minimumFractionDigits: Math.max(0, quantity.scale),
				maximumFractionDigits: Math.max(0, quantity.scale)
			}).format(BigDecimal.format(quantity) as Intl.StringNumericLiteral),
			FComplexQty: new Intl.NumberFormat('en', {
				useGrouping: false,
				minimumFractionDigits: Math.max(0, quantity.scale),
				maximumFractionDigits: Math.max(0, quantity.scale)
			}).format(BigDecimal.format(quantity) as Intl.StringNumericLiteral),
			Fauxprice: new Intl.NumberFormat('en', {
				useGrouping: false,
				minimumFractionDigits: exclusive.scale,
				maximumFractionDigits: exclusive.scale
			}).format(BigDecimal.format(exclusive) as Intl.StringNumericLiteral),
			FPrice: new Intl.NumberFormat('en', {
				useGrouping: false,
				minimumFractionDigits: exclusive.scale,
				maximumFractionDigits: exclusive.scale
			}).format(BigDecimal.format(exclusive) as Intl.StringNumericLiteral),
			FAuxTaxPrice: new Intl.NumberFormat('en', {
				useGrouping: false,
				minimumFractionDigits: inclusive.scale,
				maximumFractionDigits: inclusive.scale
			}).format(BigDecimal.format(inclusive) as Intl.StringNumericLiteral),
			FTaxPrice: new Intl.NumberFormat('en', {
				useGrouping: false,
				minimumFractionDigits: inclusive.scale,
				maximumFractionDigits: inclusive.scale
			}).format(BigDecimal.format(inclusive) as Intl.StringNumericLiteral),
			FPriceDiscount: new Intl.NumberFormat('en', {
				useGrouping: false,
				minimumFractionDigits: inclusive.scale,
				maximumFractionDigits: inclusive.scale
			}).format(BigDecimal.format(inclusive) as Intl.StringNumericLiteral),
			FAuxPriceDiscount: new Intl.NumberFormat('en', {
				useGrouping: false,
				minimumFractionDigits: inclusive.scale,
				maximumFractionDigits: inclusive.scale
			}).format(BigDecimal.format(inclusive) as Intl.StringNumericLiteral),
			FCESS: new Intl.NumberFormat('en', {
				useGrouping: false,
				minimumFractionDigits: Math.max(0, taxRate.scale),
				maximumFractionDigits: Math.max(0, taxRate.scale)
			}).format(BigDecimal.format(taxRate) as Intl.StringNumericLiteral),
			FAmount: new Intl.NumberFormat('en', {
				useGrouping: false,
				minimumFractionDigits: actual.net.scale,
				maximumFractionDigits: actual.net.scale
			}).format(BigDecimal.format(actual.net) as Intl.StringNumericLiteral),
			FAllAmount: new Intl.NumberFormat('en', {
				useGrouping: false,
				minimumFractionDigits: actual.total.scale,
				maximumFractionDigits: actual.total.scale
			}).format(BigDecimal.format(actual.total) as Intl.StringNumericLiteral),
			FAllStdAmount: new Intl.NumberFormat('en', {
				useGrouping: false,
				minimumFractionDigits: standard.scale,
				maximumFractionDigits: standard.scale
			}).format(BigDecimal.format(standard) as Intl.StringNumericLiteral),
			FTaxAmt: new Intl.NumberFormat('en', {
				useGrouping: false,
				minimumFractionDigits: actual.tax.scale,
				maximumFractionDigits: actual.tax.scale
			}).format(BigDecimal.format(actual.tax) as Intl.StringNumericLiteral),
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
