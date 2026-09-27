import * as Predicate from './guards.js';
import { numOrNull as n } from './pricing.js';

/**
 * The confirmed-document exports a downstream system receives: each confirmed document and its lines exactly as
 * confirmed, one versioned JSON document per record (`norbital.crm.confirmed_quote.v1`,
 * `norbital.crm.confirmed_purchase_order.v1`), field-enumerated so nothing internal can serialize. The collections'
 * `export_confirmed` queries return them (agent, API, and the record's Export button, which saves each as a file).
 */
export const EXPORT_OUTPUT = {
	kind: 'object',
	fields: {
		documents: {
			kind: 'list',
			of: { kind: 'object', fields: { name: { kind: 'text' }, content: { kind: 'json' } } }
		}
	}
} as const;

type Row = { readonly id: string; readonly [field: string]: unknown };
type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };
export type ExportDocument = { name: string; content: Json };

/** A document's file name part: its number (or id) with anything outside `[a-z0-9_-]` replaced. */
const fileCode = (docNo: unknown, id: string) => String(docNo ?? id).replace(/[^a-z0-9_-]/gi, '_');
/** A date or an instant as its ISO text (the wire's `{ $d }`/`{ $t }`, or the value's own text). */
export const iso = (value: unknown) => {
	if (value == null) return null;
	const v = value as { $t?: string; $d?: string };
	return Predicate.isObjectOrArray(value) ? String(v.$t ?? v.$d ?? value) : String(value);
};
const text = (value: unknown) => (value == null ? null : String(value));

export const quoteDocument = (q: Row, lines: readonly Row[]): ExportDocument => ({
	name: `quote_${fileCode(q.doc_no, q.id)}.json`,
	content: {
		schema: 'norbital.crm.confirmed_quote.v1',
		quote: {
			doc_no: text(q.doc_no),
			title: text(q.title),
			status: text(q.status),
			currency: text(q.currency),
			net: n(q.net),
			tax: n(q.tax),
			gross: n(q.gross),
			confirmed_at: iso(q.confirmed_at)
		},
		lines: lines.map((l) => ({
			product_code: text(l.product_code),
			product_name: text(l.product_name),
			quantity: n(l.quantity),
			unit_price: n(l.unit_price),
			discount_pct: n(l.discount_pct),
			tax_rate: n(l.tax_rate),
			line_total: n(l.line_total)
		}))
	}
});

export const orderDocument = (o: Row, lines: readonly Row[]): ExportDocument => ({
	name: `purchase_order_${fileCode(o.doc_no, o.id)}.json`,
	content: {
		schema: 'norbital.crm.confirmed_purchase_order.v1',
		purchase_order: {
			doc_no: text(o.doc_no),
			supplier_code: text(o.supplier_code),
			supplier_name: text(o.supplier_name),
			status: text(o.status),
			currency: text(o.currency),
			net: n(o.net),
			tax: n(o.tax),
			gross: n(o.gross),
			confirmed_at: iso(o.confirmed_at)
		},
		lines: lines.map((l) => ({
			product_code: text(l.product_code),
			product_name: text(l.product_name),
			quantity: n(l.quantity),
			unit_cost: n(l.unit_cost),
			tax_rate: n(l.tax_rate),
			line_total: n(l.line_total)
		}))
	}
});
