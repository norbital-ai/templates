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
		fields: [
			'source',
			'product',
			'warehouse',
			'lot_number',
			'unit',
			'on_hand',
			'currency',
			'unit_cost',
			'as_of'
		],
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
	// logistics sees quantities, never cost
	stock_snapshots: {
		output: 'logistics',
		fields: ['source', 'product', 'warehouse', 'lot_number', 'unit', 'on_hand', 'as_of'],
		limit: 10000
	}
} as const;

type Answer = ReadAnswer<typeof logisticsStockAvailabilityRead>;
type Product = Omit<Answer['products']['rows'][number], 'source'> & { readonly source: string };
type Lot = Answer['stock_snapshots']['rows'][number];
type Snapshot = Answer['source_stock_commitments']['rows'][number];
type Commitment = Snapshot['entries'][number];
type Group = { product: Product; lots: Lot[]; commitments: Commitment[] };
const normalizeUnit = (unit: string | null) => unit?.normalize('NFKC').trim().toLowerCase() || null;

export function stockAvailability(answer: Answer, now: number, byWarehouse: boolean) {
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
		const stockUnits = new Set(
			lots.length
				? lots.map((row) => normalizeUnit(row.unit ?? null))
				: [normalizeUnit(product.unit ?? null)]
		);
		const orderUnits = new Set(commitments.map((row) => normalizeUnit(row.unit ?? null)));
		const stockKnown = stockUnits.size === 1 && !stockUnits.has(null);
		const orderKnown = orderUnits.size <= 1 && !orderUnits.has(null);
		const compatible =
			stockKnown && orderKnown && new Set([...stockUnits, ...orderUnits]).size === 1;
		const stockUnit = stockKnown ? (lots[0]?.unit ?? null) : null;
		const orderUnit = orderKnown ? (commitments[0]?.unit ?? null) : null;
		const unit =
			stockUnit && orderUnit && !compatible
				? `${stockUnit} / ${orderUnit}`
				: (stockUnit ?? orderUnit ?? product.unit);
		const unattributed = commitments.some(
			(row) => !row.warehouse || !warehouses.has(row.warehouse)
		);
		const locations = new Set<string | null>([
			...lots.map((lot) => lot.warehouse),
			...commitments.map((row) =>
				row.warehouse && warehouses.has(row.warehouse) ? row.warehouse : null
			)
		]);
		return (byWarehouse ? [...locations] : [null]).map((warehouse) => {
			const selectedLots = byWarehouse ? lots.filter((lot) => lot.warehouse === warehouse) : lots;
			const selectedOrders = byWarehouse
				? commitments.filter(
						(row) =>
							(row.warehouse && warehouses.has(row.warehouse) ? row.warehouse : null) === warehouse
					)
				: commitments;
			const stockTime =
				selectedLots.length > 0 || listed.has(source) ? confirmed(source, feeds.stock) : null;
			const onHand = !stockKnown
				? null
				: selectedLots.length
					? BigDecimal.sumAll(selectedLots.map((lot) => BigDecimal.fromStringUnsafe(lot.on_hand)))
					: listed.has(source)
						? BigDecimal.fromBigInt(0n)
						: null;
			const awaiting =
				snapshot && orderKnown
					? BigDecimal.sumAll(
							selectedOrders.map((row) => BigDecimal.fromStringUnsafe(row.quantity))
						)
					: null;
			const available =
				compatible &&
				onHand !== null &&
				awaiting !== null &&
				fresh(stockTime) &&
				fresh(orderTime) &&
				(!byWarehouse || !unattributed)
					? BigDecimal.format(BigDecimal.subtract(onHand, awaiting))
					: null;
			const location = warehouse ? warehouses.get(warehouse) : null;
			return {
				$id: JSON.stringify([product.id, warehouse]),
				product: product.name,
				code: product.source_number ?? product.external_code,
				unit,
				warehouse: location?.name ?? null,
				warehouse_group: location?.group_code ?? null,
				on_hand: onHand && BigDecimal.format(onHand),
				awaiting: awaiting && BigDecimal.format(awaiting),
				available,
				ledger: snapshot?.source?.name ?? source,
				stock_as_of: stockTime,
				orders_as_of: orderTime
			};
		});
	});
}
