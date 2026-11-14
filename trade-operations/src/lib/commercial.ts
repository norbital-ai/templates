import { BigDecimal, Duration, Effect, Schema } from 'effect';
import * as Hex from 'effect/encoding/Hex';
import type { Row } from '@norbital-ai/bolt';

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
	| 'payment_terms'
	| 'delivery_terms'
	| 'shipping_terms'
	| 'place_of_loading'
	| 'place_of_delivery'
	| 'packaging'
	| 'shipping_mark'
	| 'time_of_shipment'
	| 'other_terms'
	| 'payment_method'
	| 'buyer_contact'
	| 'buyer_mobile'
	| 'delivery_address'
	| 'delivery_date'
	| 'valid_from'
	| 'valid_until'
	| 'title'
	| 'warehouse'
>;
export function snapshot(
	order: Header,
	party: Pick<Row<'parties'>, 'name' | 'external_code'>,
	lines: readonly Row<'order_lines'>[],
	contractVersion: string
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
		payment_terms: order.payment_terms,
		...(order.print_values?.length ? { print_values: order.print_values } : {}),
		delivery_terms: order.delivery_terms ?? '',
		shipping_terms: order.shipping_terms ?? '',
		place_of_loading: order.place_of_loading ?? '',
		place_of_delivery: order.place_of_delivery ?? '',
		packaging: order.packaging ?? '',
		shipping_mark: order.shipping_mark ?? '',
		time_of_shipment: order.time_of_shipment ?? '',
		other_terms: order.other_terms ?? '',
		payment_method: order.payment_method ?? '',
		buyer_contact: order.buyer_contact ?? '',
		buyer_mobile: order.buyer_mobile ?? '',
		delivery_address: order.delivery_address ?? '',
		delivery_date: order.delivery_date ?? '',
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
		}).format(BigDecimal.format(net) as Intl.StringNumericLiteral),
		tax: new Intl.NumberFormat('en', {
			useGrouping: false,
			minimumFractionDigits: tax.scale,
			maximumFractionDigits: tax.scale
		}).format(BigDecimal.format(tax) as Intl.StringNumericLiteral),
		total: new Intl.NumberFormat('en', {
			useGrouping: false,
			minimumFractionDigits: total.scale,
			maximumFractionDigits: total.scale
		}).format(BigDecimal.format(total) as Intl.StringNumericLiteral)
	};
}
/** An order's commercial terms as its documents render them. */
export type Terms = ReturnType<typeof snapshot>;
export function contract(template: string, seal: Terms, reference: string) {
	const values = {
		number: reference,
		reference,
		party: seal.party_name,
		currency: seal.currency,
		valid_from: seal.valid_from ?? '',
		valid_until: seal.valid_until ?? '',
		payment_terms: seal.payment_terms,
		delivery_terms: seal.delivery_terms,
		shipping_terms: seal.shipping_terms ?? '',
		place_of_loading: seal.place_of_loading ?? '',
		place_of_delivery: seal.place_of_delivery ?? '',
		packaging: seal.packaging ?? '',
		shipping_mark: seal.shipping_mark ?? '',
		time_of_shipment: seal.time_of_shipment ?? '',
		other_terms: seal.other_terms ?? '',
		payment_method: seal.payment_method ?? '',
		buyer_contact: seal.buyer_contact ?? '',
		buyer_mobile: seal.buyer_mobile ?? '',
		delivery_address: seal.delivery_address ?? '',
		delivery_date: seal.delivery_date ?? '',
		total: seal.total,
		lines: seal.lines
			.map(
				(l) =>
					`${l.product_code} · ${l.product_name} · ${l.quantity} ${l.unit} × ${l.unit_price} · ${l.total} ${seal.currency}`
			)
			.join('\n')
	};
	return template.replace(
		/\{(number|party|currency|payment_terms|delivery_terms|shipping_terms|place_of_loading|place_of_delivery|packaging|shipping_mark|time_of_shipment|other_terms|payment_method|buyer_contact|buyer_mobile|delivery_address|delivery_date|total|lines|reference|valid_from|valid_until)\}/g,
		(_, key: keyof typeof values) => values[key]
	);
}
export function creditWarning(
	order: Pick<Row<'orders'>, 'currency' | 'direction'>,
	gross: BigDecimal.BigDecimal,
	credit:
		| Pick<
				Row<'credit_snapshots'>,
				'currency' | 'credit_hold' | 'credit_limit' | 'credit_used' | 'as_of'
		  >
		| undefined,
	now: string,
	freshMinutes: number
) {
	if (order.direction === 'purchasing') return { warning: false, unavailable: false };
	const unavailable =
		!credit ||
		credit.currency !== order.currency ||
		credit.credit_limit === null ||
		credit.credit_used === null ||
		Date.parse(credit.as_of) > Date.parse(now) ||
		Date.parse(now) - Date.parse(credit.as_of) > Duration.toMillis(Duration.minutes(freshMinutes));
	const adverse =
		credit !== undefined &&
		(credit.credit_hold ||
			(!unavailable &&
				BigDecimal.isGreaterThan(
					BigDecimal.sum(BigDecimal.fromStringUnsafe(credit.credit_used!), gross),
					BigDecimal.fromStringUnsafe(credit.credit_limit!)
				)));
	return { warning: unavailable || adverse, unavailable };
}
/** The floors the order's lines meet at confirmation. */
export function currentFloors(
	order: Pick<Row<'orders'>, 'currency' | 'ordered_on'>,
	lines: readonly Row<'order_lines'>[],
	floors: readonly Row<'pricing_floors'>[],
	group: string | null | undefined
) {
	return lines.map((line) => {
		const floor = floors
			.filter(
				(f) =>
					group != null &&
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
		return {
			...line,
			floor_net: floor && floor.unit === line.unit ? floor.floor_net : null,
			floor_on: floor?.effective_on ?? null
		};
	});
}

export const quoteBelowFloor = (line: Pick<Row<'order_lines'>, 'net' | 'quantity' | 'floor_net'>) =>
	line.floor_net !== null &&
	BigDecimal.isPositive(BigDecimal.fromStringUnsafe(line.quantity)) &&
	BigDecimal.isLessThan(
		BigDecimal.round(
			BigDecimal.divideUnsafe(
				BigDecimal.fromStringUnsafe(line.net),
				BigDecimal.fromStringUnsafe(line.quantity)
			),
			{ scale: 8 }
		),
		BigDecimal.fromStringUnsafe(line.floor_net)
	);
