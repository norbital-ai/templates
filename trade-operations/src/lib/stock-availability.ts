import type { ReadAnswer } from '@norbital-ai/bolt';
import { BigDecimal } from 'effect';
import { sum, text } from './values.js';

export const stockAvailabilityRead = {
	commercial_settings: {
		where: { code: { eq: 'default' } },
		fields: ['stock_fresh_minutes'],
		limit: 1
	},
	products: { fields: ['source', 'external_code', 'source_number', 'name', 'unit'], limit: 10000 },
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

type Answer = ReadAnswer<typeof stockAvailabilityRead>;
type Product = Answer['products']['rows'][number];
type Lot = Answer['stock_snapshots']['rows'][number];
type Snapshot = Answer['source_stock_commitments']['rows'][number];
type Commitment = Snapshot['entries'][number];
const normalizeUnit = (unit: string | null) => unit?.normalize('NFKC').trim().toLowerCase() || null;

export function stockAvailability(answer: Answer, now: number, byWarehouse: boolean) {
	const freshness = (answer.commercial_settings.rows[0]?.stock_fresh_minutes ?? 30) * 60_000;
	const warehouses = new Map<string, Answer['warehouses']['rows'][number]>(
		answer.warehouses.rows.map((row) => [row.id, row])
	);
	const snapshots = new Map(
		answer.source_stock_commitments.rows.flatMap((row) =>
			row.source ? [[row.source.id, row] as const] : []
		)
	);
	const key = (source: string, product: string) => JSON.stringify([source, product]);
	const groups = new Map<string, { product: Product; lots: Lot[]; commitments: Commitment[] }>();
	const products = new Map(answer.products.rows.map((row) => [row.id, row]));
	const codes = new Map(
		answer.products.rows.map((row) => [key(row.source, row.external_code), row])
	);
	const group = (product: Product) => {
		const id = key(product.source, product.external_code);
		const existing = groups.get(id);
		if (existing) return existing;
		const next = { product, lots: [] as Lot[], commitments: [] as Commitment[] };
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
	const fresh = (date: string | null) =>
		date !== null && Math.abs(now - Date.parse(date)) < freshness;
	return [...groups.values()].flatMap(({ product, lots, commitments }) => {
		const snapshot = snapshots.get(product.source);
		const orderTime = snapshot?.observed_at ?? null;
		const stockUnits = new Set(lots.map((row) => normalizeUnit(row.unit ?? null)));
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
		const locations = new Set([
			...lots.map((lot) => lot.warehouse as string),
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
			const stockTime = selectedLots.map((row) => row.as_of).sort()[0] ?? null;
			const onHand =
				selectedLots.length && stockKnown ? sum(selectedLots.map((lot) => lot.on_hand)) : null;
			const awaiting =
				snapshot && orderKnown ? sum(selectedOrders.map((row) => row.quantity)) : null;
			const available =
				compatible &&
				onHand !== null &&
				awaiting !== null &&
				fresh(stockTime) &&
				fresh(orderTime) &&
				(!byWarehouse || !unattributed)
					? text(BigDecimal.subtract(onHand, awaiting))
					: null;
			const location = warehouse ? warehouses.get(warehouse) : null;
			return {
				$id: JSON.stringify([product.id, warehouse]),
				product: product.name,
				code: product.source_number ?? product.external_code,
				unit,
				warehouse: location?.name ?? null,
				warehouse_group: location?.group_code ?? null,
				on_hand: onHand && text(onHand),
				awaiting: awaiting && text(awaiting),
				available,
				ledger: snapshot?.source?.name ?? product.source,
				stock_as_of: stockTime,
				orders_as_of: orderTime
			};
		});
	});
}
