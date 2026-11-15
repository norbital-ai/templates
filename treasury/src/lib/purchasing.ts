/**
 * Purchase orders against the invoices recorded on them. An invoice is checked against its PO: the price per kg,
 * the total kg invoiced against the kg ordered, the currency, the invoice total against its lines, and the financing
 * that paid it (same supplier, not over-invoiced). Differences are for Accounts to raise with the purchaser.
 */
import type { MessageKey } from '@norbital-ai/bolt';
import { BigDecimal } from 'effect';
import { decimal, ratio, sum, text } from './calculations.js';

const PRICE_TOLERANCE = decimal('0.005');
const QTY_TOLERANCE = decimal('0.001');

export type PoLine = {
	readonly id: string;
	readonly item: string;
	readonly quantity: string;
	readonly amount: string;
	readonly invoiced_quantity: string;
};
export type InvoiceIn = {
	readonly invoice_number: string;
	readonly currency: string;
	readonly amount: string;
	readonly lines: readonly {
		readonly po_line: string;
		readonly quantity: string;
		readonly amount: string;
	}[];
};
export type Financing = {
	readonly supplier: string | null;
	readonly amount: string;
	readonly invoiced: string;
} | null;
export type Finding = {
	readonly key: MessageKey;
	readonly values: Readonly<Record<string, string>>;
};

const unitPrice = (amount: string, quantity: string) => ratio(decimal(amount), decimal(quantity));

/** Every difference between one invoice and its PO; empty when it matches. */
export function invoiceFindings(
	invoice: InvoiceIn,
	po: { readonly currency: string; readonly supplier: string; readonly lines: readonly PoLine[] },
	financing: Financing
): Finding[] {
	const out: Finding[] = [];
	const lineTotal = sum(invoice.lines.map((l) => decimal(l.amount)));
	if (!BigDecimal.equals(lineTotal, decimal(invoice.amount)))
		out.push({ key: 'finding.total', values: { total: invoice.amount, lines: text(lineTotal) } });
	if (invoice.currency !== po.currency)
		out.push({ key: 'finding.currency', values: { invoice: invoice.currency, po: po.currency } });
	for (const l of invoice.lines) {
		const ordered = po.lines.find((p) => p.id === l.po_line);
		if (ordered === undefined) continue;
		const poPrice = unitPrice(ordered.amount, ordered.quantity);
		const price = unitPrice(l.amount, l.quantity);
		if (
			poPrice !== null &&
			price !== null &&
			BigDecimal.isGreaterThan(
				BigDecimal.abs(BigDecimal.subtract(price, poPrice)),
				BigDecimal.multiply(poPrice, PRICE_TOLERANCE)
			)
		)
			out.push({
				key: 'finding.price',
				values: { item: ordered.item, invoiced: text(price, 4), ordered: text(poPrice, 4) }
			});
		if (
			BigDecimal.isGreaterThan(
				BigDecimal.subtract(decimal(ordered.invoiced_quantity), decimal(ordered.quantity)),
				QTY_TOLERANCE
			)
		)
			out.push({
				key: 'finding.quantity',
				values: {
					item: ordered.item,
					invoiced: ordered.invoiced_quantity,
					ordered: ordered.quantity
				}
			});
	}
	if (financing !== null) {
		if (financing.supplier !== null && financing.supplier !== po.supplier)
			out.push({ key: 'finding.financing_supplier', values: {} });
		if (BigDecimal.isGreaterThan(decimal(financing.invoiced), decimal(financing.amount)))
			out.push({
				key: 'finding.financing_over',
				values: { invoiced: financing.invoiced, amount: financing.amount }
			});
	}
	return out;
}

export type PoStatus = 'cancelled' | 'over_invoiced' | 'open' | 'partly_invoiced' | 'invoiced';
/** Where a PO stands against its invoices. */
export function poStatus(po: {
	readonly is_cancelled: boolean;
	readonly lines: readonly PoLine[];
}): PoStatus {
	if (po.is_cancelled) return 'cancelled';
	if (
		po.lines.some((l) =>
			BigDecimal.isGreaterThan(decimal(l.invoiced_quantity), decimal(l.quantity))
		)
	)
		return 'over_invoiced';
	const invoiced = sum(po.lines.map((l) => decimal(l.invoiced_quantity)));
	if (BigDecimal.isZero(invoiced)) return 'open';
	return BigDecimal.isLessThan(invoiced, sum(po.lines.map((l) => decimal(l.quantity))))
		? 'partly_invoiced'
		: 'invoiced';
}

/** LC or T/T, from the payment terms a PO prints. */
export const facilityFor = (payment_terms: string | null) =>
	/\bL\/?C\b|LETTER OF CREDIT/i.test(payment_terms ?? '') ? 'lc' : 'tt';
