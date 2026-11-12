import type { InputFields } from '@norbital-ai/bolt';

/**
 * Workbook schemas: one column set per table, shared by Import, Download template and Export.
 * Reference values are the source code (not the row id), so a sheet survives a re-import.
 */
export const orderWorkbook = {
	number: { kind: 'text', optional: true },
	direction: { kind: 'enum', values: ['sales', 'purchasing'] },
	party_code: { kind: 'text' },
	title: { kind: 'text' },
	owner: { kind: 'text', optional: true },
	warehouse_code: { kind: 'text', optional: true },
	ordered_on: { kind: 'date', optional: true },
	currency: { kind: 'currency', optional: true },
	tax_inclusive: { kind: 'bool', optional: true },
	valid_from: { kind: 'date', optional: true },
	valid_until: { kind: 'date', optional: true },
	payment_terms: { kind: 'text' },
	delivery_terms: { kind: 'text', optional: true },
	shipping_terms: { kind: 'text', optional: true },
	place_of_loading: { kind: 'text', optional: true },
	place_of_delivery: { kind: 'text', optional: true },
	packaging: { kind: 'text', optional: true },
	shipping_mark: { kind: 'text', optional: true },
	time_of_shipment: { kind: 'text', optional: true },
	other_terms: { kind: 'text', optional: true },
	payment_method: { kind: 'text', optional: true },
	buyer_contact: { kind: 'text', optional: true },
	buyer_mobile: { kind: 'text', optional: true },
	delivery_address: { kind: 'text', optional: true },
	delivery_date: { kind: 'date', optional: true },
	logistics_handler: { kind: 'text', optional: true },
	notes: { kind: 'text', optional: true }
} as const satisfies InputFields;

export const orderLineWorkbook = {
	order_number: { kind: 'text' },
	line_key: { kind: 'text', optional: true },
	product_code: { kind: 'text' },
	quantity: { kind: 'number' },
	unit_price: { kind: 'number', optional: true },
	discount_pct: { kind: 'number', optional: true },
	tax_rate: { kind: 'number', optional: true }
} as const satisfies InputFields;

export const partyWorkbook = {
	ledger: { kind: 'text' },
	external_code: { kind: 'text' },
	source_number: { kind: 'text', optional: true },
	name: { kind: 'text' },
	kind: { kind: 'enum', values: ['customer', 'supplier', 'both'] },
	currency: { kind: 'currency' },
	active: { kind: 'bool' },
	address: { kind: 'text', optional: true },
	phone: { kind: 'text', optional: true }
} as const satisfies InputFields;

export const warehouseWorkbook = {
	ledger: { kind: 'text' },
	external_code: { kind: 'text' },
	source_number: { kind: 'text', optional: true },
	name: { kind: 'text' },
	group_code: { kind: 'text', optional: true },
	active: { kind: 'bool' }
} as const satisfies InputFields;

export const commissionRuleWorkbook = {
	code: { kind: 'text', default: 'default' },
	currency: { kind: 'currency' },
	effective_on: { kind: 'date' },
	basis_unit: { kind: 'text', optional: true },
	fixed_rate: { kind: 'number' },
	spread_pct: { kind: 'number' },
	eligibility_expression: { kind: 'text' },
	amount_expression: { kind: 'text' },
	parameters: { kind: 'text', optional: true },
	active: { kind: 'bool', optional: true }
} as const satisfies InputFields;
