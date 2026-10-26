import { Effect, Encoding, Schema } from 'effect';
import { Decimal, minorDigits, sum, type DecimalLike } from '@norbital-ai/std/decimal';
import type { Row } from '@norbital-ai/bolt';

export function price(
	document: Pick<Row<'orders'>, 'currency' | 'tax_inclusive'>,
	line: {
		quantity: DecimalLike;
		unit_price: DecimalLike;
		discount_pct: DecimalLike;
		tax_rate: DecimalLike;
	}
) {
	const digits = minorDigits(document.currency);
	const base = Decimal.of(line.quantity)
		.times(line.unit_price)
		.times(Decimal.of(100).minus(line.discount_pct))
		.div(100, 12);
	const factor = Decimal.of(1).plus(Decimal.of(line.tax_rate).div(100, 6));
	const net = document.tax_inclusive ? base.round(digits).div(factor, digits) : base.round(digits);
	const tax = document.tax_inclusive
		? base.round(digits).minus(net)
		: net.times(line.tax_rate).div(100, digits);
	return { currency: document.currency, net, tax, total: net.plus(tax) };
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
	}).pipe(Effect.map((bytes) => Encoding.encodeHex(new Uint8Array(bytes))));
export const hash = (value: unknown) => sha256Hex(canonical(value));
type Header = Pick<
	Row<'orders'>,
	| 'id'
	| 'direction'
	| 'currency'
	| 'tax_inclusive'
	| 'payment_terms'
	| 'delivery_terms'
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
		delivery_terms: order.delivery_terms ?? '',
		contract_version: contractVersion,
		lines: [...lines]
			.sort((a, b) => a.id.localeCompare(b.id))
			.map((l) => ({
				id: l.id,
				...(l.source_entry_id ? { source_entry_id: l.source_entry_id } : {}),
				product: l.product,
				product_code: l.product_code,
				product_name: l.product_name,
				unit: l.unit,
				quantity: Decimal.of(l.quantity).toString(),
				unit_price: Decimal.of(l.unit_price).toString(),
				discount_pct: Decimal.of(l.discount_pct).toString(),
				tax_rate: Decimal.of(l.tax_rate).toString(),
				net: Decimal.of(l.net).toString(),
				tax: Decimal.of(l.tax).toString(),
				total: Decimal.of(l.total).toString(),
				floor_net: l.floor_net === null ? '' : Decimal.of(l.floor_net).toString(),
				commission_basis_unit: l.commission_basis_unit ?? '',
				commission_factor:
					l.commission_factor === null ? '' : Decimal.of(l.commission_factor).toString()
			})),
		net: sum(lines.map((l) => l.net)).toString(),
		tax: sum(lines.map((l) => l.tax)).toString(),
		total: sum(lines.map((l) => l.total)).toString()
	};
}
export function contract(template: string, seal: ReturnType<typeof snapshot>, reference: string) {
	const values = {
		number: reference,
		reference,
		party: seal.party_name,
		currency: seal.currency,
		valid_from: seal.valid_from,
		valid_until: seal.valid_until,
		payment_terms: seal.payment_terms,
		delivery_terms: seal.delivery_terms,
		total: seal.total,
		lines: seal.lines
			.map(
				(l) =>
					`${l.product_code} · ${l.product_name} · ${l.quantity} ${l.unit} × ${l.unit_price} · ${l.total} ${seal.currency}`
			)
			.join('\n')
	};
	return template.replace(
		/\{(number|party|currency|payment_terms|delivery_terms|total|lines|reference|valid_from|valid_until)\}/g,
		(_, key: keyof typeof values) => values[key]
	);
}
export function creditWarning(
	order: Pick<Row<'orders'>, 'currency' | 'direction'>,
	gross: Decimal,
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
		Date.parse(now) - Date.parse(credit.as_of) > freshMinutes * 60000;
	const adverse =
		credit !== undefined &&
		(credit.credit_hold ||
			(!unavailable && Decimal.of(credit.credit_used!).plus(gross).gt(credit.credit_limit!)));
	return { warning: unavailable || adverse, unavailable };
}
/** Internal approval basis is refreshed until confirmation, then retained in the SO seal. */
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
					Decimal.of(f.minimum_quantity).lte(line.quantity)
			)
			.sort(
				(a, b) =>
					b.effective_on.localeCompare(a.effective_on) ||
					Decimal.of(b.minimum_quantity).cmp(a.minimum_quantity)
			)[0];
		return {
			...line,
			floor_net:
				floor && floor.unit === line.unit
					? floor.tax_inclusive
						? Decimal.of(floor.floor_price).div(
								Decimal.of(1).plus(Decimal.of(floor.tax_rate).div(100, 6)),
								8
							)
						: floor.floor_price
					: null,
			floor_on: floor?.effective_on ?? null
		};
	});
}
