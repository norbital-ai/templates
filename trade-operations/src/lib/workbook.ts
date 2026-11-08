import type { InputFields } from '@norbital-ai/bolt';

/**
 * Workbook schemas: one column set per table, shared by Import, Download template and Export.
 * Reference values are the source code (not the row id), so a sheet survives a re-import.
 */
export const orderWorkbook = {
	number: { kind: 'text', label: 'Order number', optional: true },
	direction: { kind: 'enum', values: ['sales', 'purchasing'], label: 'Direction' },
	party_code: { kind: 'text', label: 'Party code' },
	title: { kind: 'text', label: 'Title' },
	owner: { kind: 'text', label: 'Salesperson id', optional: true },
	warehouse_code: { kind: 'text', label: 'Warehouse code', optional: true },
	ordered_on: { kind: 'date', label: 'Order date', optional: true },
	currency: { kind: 'currency', label: 'Currency', optional: true },
	tax_inclusive: { kind: 'bool', label: 'Tax inclusive', optional: true },
	valid_from: { kind: 'date', label: 'Valid from', optional: true },
	valid_until: { kind: 'date', label: 'Valid until', optional: true },
	payment_terms: { kind: 'text', label: 'Payment terms' },
	delivery_terms: { kind: 'text', label: 'Delivery terms', optional: true },
	shipping_terms: { kind: 'text', label: 'Shipping terms', optional: true },
	place_of_loading: { kind: 'text', label: 'Place of loading', optional: true },
	place_of_delivery: { kind: 'text', label: 'Place of delivery', optional: true },
	packaging: { kind: 'text', label: 'Packaging', optional: true },
	shipping_mark: { kind: 'text', label: 'Shipping mark', optional: true },
	time_of_shipment: { kind: 'text', label: 'Time of shipment', optional: true },
	other_terms: { kind: 'text', label: 'Other terms', optional: true },
	payment_method: { kind: 'text', label: 'Payment method', optional: true },
	buyer_contact: { kind: 'text', label: 'Buyer contact', optional: true },
	buyer_mobile: { kind: 'text', label: 'Buyer mobile', optional: true },
	delivery_address: { kind: 'text', label: 'Delivery address', optional: true },
	delivery_date: { kind: 'date', label: 'Delivery date', optional: true },
	logistics_handler: { kind: 'text', label: 'Logistics handler id', optional: true },
	notes: { kind: 'text', label: 'Remarks', optional: true }
} as const satisfies InputFields;

export const orderLineWorkbook = {
	order_number: { kind: 'text', label: 'Order number' },
	line_key: { kind: 'text', label: 'Line key', optional: true },
	product_code: { kind: 'text', label: 'Product code' },
	quantity: { kind: 'number', label: 'Quantity' },
	unit_price: { kind: 'number', label: 'Unit price', optional: true },
	discount_pct: { kind: 'number', label: 'Discount (%)', optional: true },
	tax_rate: { kind: 'number', label: 'Tax rate (%)', optional: true }
} as const satisfies InputFields;

export const partyWorkbook = {
	ledger: { kind: 'text', label: 'Ledger' },
	external_code: { kind: 'text', label: 'External code' },
	source_number: { kind: 'text', label: 'Source number', optional: true },
	name: { kind: 'text', label: 'Name' },
	kind: { kind: 'enum', values: ['customer', 'supplier', 'both'], label: 'Kind' },
	currency: { kind: 'currency', label: 'Currency' },
	active: { kind: 'bool', label: 'Active' },
	address: { kind: 'text', label: 'Address', optional: true },
	phone: { kind: 'text', label: 'Phone', optional: true }
} as const satisfies InputFields;

export const warehouseWorkbook = {
	ledger: { kind: 'text', label: 'Ledger' },
	external_code: { kind: 'text', label: 'External code' },
	source_number: { kind: 'text', label: 'Source number', optional: true },
	name: { kind: 'text', label: 'Name' },
	group_code: { kind: 'text', label: 'Warehouse group', optional: true },
	active: { kind: 'bool', label: 'Active' }
} as const satisfies InputFields;

export const commissionRuleWorkbook = {
	code: { kind: 'text', label: 'Code', default: 'default' },
	currency: { kind: 'currency', label: 'Currency' },
	effective_on: { kind: 'date', label: 'Effective date' },
	basis_unit: { kind: 'text', label: 'Basis unit', optional: true },
	fixed_rate: { kind: 'number', label: 'Fixed rate' },
	spread_pct: { kind: 'number', label: 'Spread (%)' },
	eligibility_expression: { kind: 'text', label: 'Eligibility expression' },
	amount_expression: { kind: 'text', label: 'Amount expression' },
	parameters: { kind: 'text', label: 'Parameters (JSON)', optional: true },
	active: { kind: 'bool', label: 'Active', optional: true }
} as const satisfies InputFields;
