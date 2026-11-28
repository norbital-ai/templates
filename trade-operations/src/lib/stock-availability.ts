import type { ReadAnswer } from '@norbital-ai/bolt';
import { BigDecimal, Duration } from 'effect';
import { confirmedAt, feeds, type Ledger } from '../integration/kingdee/connection-status.js';

export const stockAvailabilityRead = {
	commercial_settings: {
		where: { code: { eq: 'default' } },
		fields: ['stock_fresh_minutes'],
		limit: 1
	},
	products: {
		fields: ['source', 'external_code', 'source_number', 'name', 'unit'],
		source: { fields: ['active', 'status'] },
		limit: 10000
	},
	warehouses: { fields: ['name', 'group_code'], limit: 10000 },
	stock_snapshots: {
		fields: ['source', 'product', 'warehouse', 'unit', 'on_hand', 'as_of'],
		limit: 10000
	},
	source_stock_commitments: {
		fields: ['source', 'observed_at', 'entries'],
		source: { fields: ['name'] }
	}
} as const;
export const logisticsStockAvailabilityRead = {
	...stockAvailabilityRead,
	commercial_settings: { ...stockAvailabilityRead.commercial_settings, output: 'logistics' },
	products: { ...stockAvailabilityRead.products, output: 'logistics' },
	stock_snapshots: { ...stockAvailabilityRead.stock_snapshots, output: 'logistics' }
} as const;

type Answer = ReadAnswer<typeof logisticsStockAvailabilityRead>;
type Product = Omit<Answer['products']['rows'][number], 'source'> & { readonly source: string };
type Lot = Answer['stock_snapshots']['rows'][number];
type Snapshot = Answer['source_stock_commitments']['rows'][number];
type Commitment = Snapshot['entries'][number];
type Group = { product: Product; lots: Lot[]; commitments: Commitment[] };
const normalizeUnit = (unit: string | null) => unit?.normalize('NFKC').trim().toLowerCase() || null;
const zero = BigDecimal.fromBigInt(0n);
const sum = (values: readonly string[]) =>
	BigDecimal.sumAll(values.map((value) => BigDecimal.fromStringUnsafe(value)));

/**
 * Each SKU per warehouse region: what is on hand across its lots and warehouses, what open sales orders have yet to ship
 * (promised out) and open purchase orders yet to receive (promised in), and the projected balance, short when promised
 * out exceeds on hand plus promised in. A warehouse without a region stands as its own; an open order whose warehouse
 * is unknown counts under no region. The projection needs fresh stock and orders in one unit.
 */
export function stockAvailability(answer: Answer, now: number) {
	const freshness = Duration.toMillis(
		Duration.minutes(answer.commercial_settings.rows[0]?.stock_fresh_minutes ?? 30)
	);
	// a quiet read writes nothing: a figure is as old as what its ledger last confirmed, not its row's time
	const at = new Date(now).toISOString();
	const productRows = answer.products.rows.flatMap((row) =>
		row.source ? [{ ...row, source: row.source.id, ledger: row.source }] : []
	);
	const ledgers = new Map<string, Ledger>(productRows.map((row) => [row.source, row.ledger]));
	const confirmed = (source: string, feed: (typeof feeds)[keyof typeof feeds]) => {
		const ledger = ledgers.get(source);
		return ledger ? confirmedAt(ledger, feed, at) : null;
	};
	const warehouses = new Map<string, Answer['warehouses']['rows'][number]>(
		answer.warehouses.rows.map((row) => [row.id, row])
	);
	const regionOf = (warehouse: string | null | undefined) => {
		const location = warehouse ? warehouses.get(warehouse) : undefined;
		return location ? location.group_code || location.name : null;
	};
	const snapshots = new Map<string, Snapshot>(
		answer.source_stock_commitments.rows.flatMap((row) =>
			row.source ? [[row.source.id, row] as const] : []
		)
	);
	const key = (source: string, product: string) => JSON.stringify([source, product]);
	const groups = new Map<string, Group>();
	const products = new Map(productRows.map((row) => [row.id, row]));
	const codes = new Map(productRows.map((row) => [key(row.source, row.external_code), row]));
	const group = (product: Product) => {
		const id = key(product.source, product.external_code);
		const existing = groups.get(id);
		if (existing) return existing;
		const next: Group = { product, lots: [], commitments: [] };
		groups.set(id, next);
		return next;
	};
	for (const lot of answer.stock_snapshots.rows) {
		const product = products.get(lot.product);
		if (product?.source === lot.source) group(product).lots.push(lot);
	}
	for (const [source, snapshot] of snapshots) {
		for (const commitment of snapshot.entries) {
			const product = codes.get(key(source, commitment.product_code));
			if (product) group(product).commitments.push(commitment);
		}
	}
	// a complete listing names every lot with stock: a product it leaves out has none, as of that listing
	const listed = new Set<string>(answer.stock_snapshots.rows.map((lot) => lot.source));
	const fresh = (date: string | null) =>
		date !== null && Math.abs(now - Date.parse(date)) < freshness;
	return [...groups.values()].flatMap(({ product, lots, commitments }) => {
		const source = product.source;
		const snapshot = snapshots.get(source);
		const orderTime = snapshot ? confirmed(source, feeds.commitments) : null;
		const regions = new Set<string | null>([
			...lots.map((lot) => regionOf(lot.warehouse)),
			...commitments.map((row) => regionOf(row.warehouse))
		]);
		return [...regions].map((region) => {
			const here = lots.filter((lot) => regionOf(lot.warehouse) === region);
			const orders = commitments.filter((row) => regionOf(row.warehouse) === region);
			const stockUnits = new Set(
				here.length
					? here.map((row) => normalizeUnit(row.unit ?? null))
					: [normalizeUnit(product.unit ?? null)]
			);
			const orderUnits = new Set(orders.map((row) => normalizeUnit(row.unit ?? null)));
			const stockKnown = stockUnits.size === 1 && !stockUnits.has(null);
			const orderKnown = orderUnits.size <= 1 && !orderUnits.has(null);
			const compatible =
				stockKnown && orderKnown && new Set([...stockUnits, ...orderUnits]).size === 1;
			const stockUnit = stockKnown ? (here[0]?.unit ?? product.unit ?? null) : null;
			const orderUnit = orderKnown ? (orders[0]?.unit ?? null) : null;
			const unit =
				stockUnit && orderUnit && !compatible
					? `${stockUnit} / ${orderUnit}`
					: (stockUnit ?? orderUnit ?? product.unit);
			const stockTime =
				here.length > 0 || listed.has(source) ? confirmed(source, feeds.stock) : null;
			const onHand = !stockKnown
				? null
				: here.length
					? sum(here.map((lot) => lot.on_hand))
					: listed.has(source)
						? zero
						: null;
			const promised = (direction: Commitment['direction']) =>
				snapshot && orderKnown
					? sum(orders.filter((row) => row.direction === direction).map((row) => row.quantity))
					: null;
			const out = promised('out');
			const incoming = promised('in');
			const projected =
				compatible &&
				onHand !== null &&
				out !== null &&
				incoming !== null &&
				fresh(stockTime) &&
				fresh(orderTime)
					? BigDecimal.subtract(BigDecimal.sum(onHand, incoming), out)
					: null;
			return {
				$id: JSON.stringify([product.id, region]),
				region,
				product: product.name,
				code: product.source_number ?? product.external_code,
				unit,
				on_hand: onHand && BigDecimal.format(onHand),
				promised_out: out && BigDecimal.format(out),
				promised_in: incoming && BigDecimal.format(incoming),
				projected: projected && BigDecimal.format(projected),
				short: projected !== null && BigDecimal.isNegative(projected),
				ledger: snapshot?.source?.name ?? source,
				stock_as_of: stockTime,
				orders_as_of: orderTime
			};
		});
	});
}
