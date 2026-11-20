import type { Row } from '@norbital-ai/bolt';

/** Incoterms 2020. Documents print the code in capitals. */
export const incoterms = [
	'exw',
	'fca',
	'fas',
	'fob',
	'cfr',
	'cif',
	'cpt',
	'cip',
	'dap',
	'dpu',
	'ddp'
] as const;

const text = { kind: 'text', optional: true } as const;
export const orderTrade = {
	kind: 'union',
	by: 'kind',
	arms: {
		domestic: {
			delivery_place: text,
			delivery_date: { kind: 'date', optional: true }
		},
		foreign: {
			shipping_terms: { kind: 'enum', values: incoterms, optional: true },
			place_of_loading: text,
			place_of_delivery: text,
			shipping_mark: text,
			shipment: { kind: 'period', of: 'date', optional: true },
			other_terms: text
		}
	}
} as const;

export type OrderTrade = Row<'orders'>['trade'];

export function deliveryOn(trade: OrderTrade) {
	return trade.kind === 'domestic'
		? trade.delivery_date
		: (trade.shipment?.to ?? trade.shipment?.from);
}
