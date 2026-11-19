import { BigDecimal, Effect, Schema } from 'effect';
import * as Hex from 'effect/encoding/Hex';
import type { Row } from '@norbital-ai/bolt';

/** Decimal text as the numeric literal `Intl.NumberFormat` formats at full precision; anything else throws. */
export const numeric = Schema.decodeUnknownSync(Schema.TemplateLiteral([Schema.Number]));
export function price(
	document: Pick<Row<'orders'>, 'currency' | 'tax_inclusive'>,
	line: {
		quantity: string;
		unit_price: string;
		discount_pct: string;
		tax_rate: string;
	}
) {
	const digits =
		new Intl.NumberFormat('en', {
			style: 'currency',
			currency: document.currency
		}).resolvedOptions().maximumFractionDigits ?? 2;
	const hundred = BigDecimal.fromBigInt(100n);
	const base = BigDecimal.round(
		BigDecimal.divideUnsafe(
			BigDecimal.multiply(
				BigDecimal.multiply(
					BigDecimal.fromStringUnsafe(line.quantity),
					BigDecimal.fromStringUnsafe(line.unit_price)
				),
				BigDecimal.subtract(hundred, BigDecimal.fromStringUnsafe(line.discount_pct))
			),
			hundred
		),
		{ scale: 12 }
	);
	const factor = BigDecimal.sum(
		BigDecimal.fromBigInt(1n),
		BigDecimal.round(BigDecimal.divideUnsafe(BigDecimal.fromStringUnsafe(line.tax_rate), hundred), {
			scale: 6
		})
	);
	const gross = BigDecimal.round(base, { scale: digits });
	const net = document.tax_inclusive
		? BigDecimal.round(BigDecimal.divideUnsafe(gross, factor), { scale: digits })
		: gross;
	const tax = document.tax_inclusive
		? BigDecimal.subtract(gross, net)
		: BigDecimal.round(
				BigDecimal.divideUnsafe(
					BigDecimal.multiply(net, BigDecimal.fromStringUnsafe(line.tax_rate)),
					hundred
				),
				{ scale: digits }
			);
	return { currency: document.currency, net, tax, total: BigDecimal.sum(net, tax) };
}
function canonical(value: unknown): string {
	const keys = new Set<string>();
	JSON.stringify(value, (key, item: unknown) => {
		keys.add(key);
		return item;
	});
	return JSON.stringify(value, [...keys].sort());
}
export class DigestUnavailable extends Schema.TaggedError<DigestUnavailable>()(
	'DigestUnavailable',
	{
		message: Schema.String
	}
) {}
export const sha256Hex = (text: string) =>
	Effect.tryPromise({
		try: () => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
		catch: (cause) => new DigestUnavailable({ message: String(cause) })
	}).pipe(Effect.map((bytes) => Hex.encode(new Uint8Array(bytes))));
export const hash = (value: unknown) => sha256Hex(canonical(value));
type Header = Pick<
	Row<'orders'>,
	| 'id'
	| 'direction'
	| 'currency'
	| 'tax_inclusive'
	| 'print_values'
	| 'shipping_terms'
	| 'place_of_loading'
	| 'place_of_delivery'
	| 'packaging'
	| 'shipping_mark'
	| 'shipment'
	| 'other_terms'
	| 'payment_method'
	| 'delivery_address'
	| 'valid_from'
	| 'valid_until'
	| 'title'
	| 'warehouse'
>;
/** The names an order's references print as: its settlement method and its buyer contact. */
export type Named = {
	readonly payment_terms: string;
	readonly buyer: { readonly name: string; readonly phone: string; readonly email: string };
};
export function snapshot(
	order: Header,
	party: Pick<Row<'parties'>, 'name' | 'external_code'>,
	lines: readonly Row<'order_lines'>[],
	contractVersion: string,
	named: Named
) {
	const net = BigDecimal.sumAll(lines.map((l) => BigDecimal.fromStringUnsafe(l.net)));
	const tax = BigDecimal.sumAll(lines.map((l) => BigDecimal.fromStringUnsafe(l.tax)));
	const total = BigDecimal.sumAll(lines.map((l) => BigDecimal.fromStringUnsafe(l.total)));
	return {
		order_id: order.id,
		title: order.title,
		warehouse: order.warehouse ?? '',
		party_code: party.external_code,
		party_name: party.name,
		direction: order.direction,
		currency: order.currency,
		tax_inclusive: order.tax_inclusive,
		valid_from: order.valid_from ?? '',
		valid_until: order.valid_until ?? '',
		payment_terms: named.payment_terms,
		...(order.print_values?.length ? { print_values: order.print_values } : {}),
		shipping_terms: order.shipping_terms ?? '',
		place_of_loading: order.place_of_loading ?? '',
		place_of_delivery: order.place_of_delivery ?? '',
		packaging: order.packaging ?? '',
		shipping_mark: order.shipping_mark ?? '',
		shipment_from: order.shipment?.from ?? '',
		shipment_to: order.shipment?.to ?? order.shipment?.from ?? '',
		other_terms: order.other_terms ?? '',
		payment_method: order.payment_method ?? '',
		buyer_contact: named.buyer.name,
		buyer_mobile: named.buyer.phone,
		buyer_email: named.buyer.email,
		delivery_address: order.delivery_address ?? '',
		contract_version: contractVersion,
		lines: [...lines]
			.sort((a, b) => a.id.localeCompare(b.id))
			.map((l) => ({
				id: l.id,
				...(l.source_entry_id ? { source_entry_id: l.source_entry_id } : {}),
				product: l.product,
				product_code: l.product_code,
				product_name: l.product_name,
				...(l.print_values?.length ? { print_values: l.print_values } : {}),
				...(l.product_spec ? { product_spec: l.product_spec } : {}),
				unit: l.unit,
				quantity: l.quantity,
				unit_price: l.unit_price,
				discount_pct: l.discount_pct,
				tax_rate: l.tax_rate,
				net: l.net,
				tax: l.tax,
				total: l.total,
				floor_net: l.floor_net ?? '',
				commission_basis_unit: l.commission_basis_unit ?? '',
				commission_factor: l.commission_factor ?? ''
			})),
		net: new Intl.NumberFormat('en', {
			useGrouping: false,
			minimumFractionDigits: net.scale,
			maximumFractionDigits: net.scale
		}).format(numeric(BigDecimal.format(net))),
		tax: new Intl.NumberFormat('en', {
			useGrouping: false,
			minimumFractionDigits: tax.scale,
			maximumFractionDigits: tax.scale
		}).format(numeric(BigDecimal.format(tax))),
		total: new Intl.NumberFormat('en', {
			useGrouping: false,
			minimumFractionDigits: total.scale,
			maximumFractionDigits: total.scale
		}).format(numeric(BigDecimal.format(total)))
	};
}
/** An order's commercial terms as its documents render them. */
export type Terms = ReturnType<typeof snapshot>;
/** The shipment window as a document prints it: one day, or its first and last. */
export const shipmentText = (seal: Pick<Terms, 'shipment_from' | 'shipment_to'>, to = ' – ') =>
	!seal.shipment_from || seal.shipment_from === seal.shipment_to
		? seal.shipment_from
		: `${seal.shipment_from}${to}${seal.shipment_to}`;
export function contract(template: string, seal: Terms, reference: string) {
	const values = {
		number: reference,
		reference,
		party: seal.party_name,
		currency: seal.currency,
		valid_from: seal.valid_from ?? '',
		valid_until: seal.valid_until ?? '',
		payment_terms: seal.payment_terms,
		shipping_terms: seal.shipping_terms,
		time_of_shipment: shipmentText(seal),
		total: seal.total,
		lines: seal.lines
			.map(
				(l) =>
					`${l.product_code} · ${l.product_name} · ${l.quantity} ${l.unit} × ${l.unit_price} · ${l.total} ${seal.currency}`
			)
			.join('\n')
	};
	return template.replace(
		/\{(number|party|currency|payment_terms|shipping_terms|time_of_shipment|total|lines|reference|valid_from|valid_until)\}/g,
		(_, key: keyof typeof values) => values[key]
	);
}
type Floor = Pick<
	Row<'pricing_floors'>,
	'product' | 'currency' | 'group_code' | 'effective_on' | 'minimum_quantity' | 'unit' | 'floor_net'
>;
/**
 * The floor a sales line is priced against: the newest row on or before the order date, in the order's currency and
 * warehouse group, whose quantity band the line meets. Its unit must be the line's; a purchase has none.
 */
export function floorFor<F extends Floor>(
	order: Pick<Row<'orders'>, 'direction' | 'currency' | 'ordered_on'>,
	group: string | null | undefined,
	line: { readonly product: string; readonly quantity: string },
	floors: readonly F[]
): F | undefined {
	if (order.direction !== 'sales' || group == null) return undefined;
	return floors
		.filter(
			(f) =>
				f.product === line.product &&
				f.currency === order.currency &&
				f.group_code === group &&
				f.effective_on <= order.ordered_on &&
				BigDecimal.isLessThanOrEqualTo(
					BigDecimal.fromStringUnsafe(f.minimum_quantity),
					BigDecimal.fromStringUnsafe(line.quantity)
				)
		)
		.sort(
			(a, b) =>
				b.effective_on.localeCompare(a.effective_on) ||
				BigDecimal.Order(
					BigDecimal.fromStringUnsafe(b.minimum_quantity),
					BigDecimal.fromStringUnsafe(a.minimum_quantity)
				)
		)[0];
}

/**
 * A line is below its floor when its own net unit price is: the price after discount, before tax, at the floor's
 * precision. The rounded line net over its quantity is not that price.
 */
export function quoteBelowFloor(
	line: Pick<Row<'order_lines'>, 'unit_price' | 'discount_pct' | 'tax_rate' | 'floor_net'>,
	inclusive: boolean
) {
	if (line.floor_net === null) return false;
	const hundred = BigDecimal.fromBigInt(100n);
	const charged = BigDecimal.multiply(
		BigDecimal.fromStringUnsafe(line.unit_price),
		BigDecimal.subtract(hundred, BigDecimal.fromStringUnsafe(line.discount_pct))
	);
	const net = BigDecimal.divideUnsafe(
		charged,
		inclusive ? BigDecimal.sum(hundred, BigDecimal.fromStringUnsafe(line.tax_rate)) : hundred
	);
	const floor = BigDecimal.fromStringUnsafe(line.floor_net);
	return BigDecimal.isLessThan(BigDecimal.round(net, { scale: floor.scale }), floor);
}
