import type { CurrencyCode } from '@norbital-ai/bolt';
import type { Id, ReadAnswer } from '@norbital-ai/bolt';
import { BigDecimal, DateTime } from 'effect';

/** Month and scope selectors need bucket counts, not the individual price records. */
export const priceBookCatalogRead = {
	pricing_floors: { aggregate: { by: ['group_code', 'currency', { month: 'effective_on' }] } },
	warehouses: { fields: ['name', 'group_code', 'active'] }
} as const;

/** One month's dated book in one currency, with the product identity each cell prices. */
export const priceBookRead = (group: string, currency: CurrencyCode, month: string) =>
	({
		pricing_floors: {
			where: {
				group_code: { eq: group },
				currency: { eq: currency },
				effective_on: {
					gte: `${month}-01`,
					lt: DateTime.formatIsoDateUtc(
						DateTime.add(DateTime.makeUnsafe(`${month}-01`), { months: 1 })
					)
				}
			},
			fields: [
				'product',
				'group_code',
				'currency',
				'effective_on',
				'unit',
				'floor_price',
				'tax_inclusive',
				'tax_rate',
				'minimum_quantity',
				'revision'
			],
			order_by: { effective_on: 'asc' },
			limit: 10000,
			product: {
				fields: ['name', 'external_code', 'source_number']
			}
		}
	}) as const;

type Answer = ReadAnswer<ReturnType<typeof priceBookRead>>;

/** A blank day's cell inherits the latest band's units and tax terms, even in a historical month. */
export const priceBookDefaultsRead = (
	group: string,
	currency: CurrencyCode,
	product: Id<'products'>,
	minimum_quantity: string
) =>
	({
		pricing_floors: {
			where: {
				group_code: { eq: group },
				currency: { eq: currency },
				product: { eq: product },
				minimum_quantity: { eq: minimum_quantity }
			},
			fields: ['unit', 'tax_inclusive', 'tax_rate'],
			order_by: { effective_on: 'desc' },
			limit: 1
		}
	}) as const;

export type PriceCell = {
	readonly id: Id<'pricing_floors'>;
	readonly revision: number;
	readonly effective_on: string;
	readonly floor_price: string;
	readonly unit: string;
	readonly tax_inclusive: boolean;
	readonly tax_rate: string;
	readonly minimum_quantity: string;
};

export type PriceRow = {
	key: string;
	product: Id<'products'>;
	code: string;
	name: string;
	unit: string;
	minimum_quantity: string;
	/** The band's lower bound, empty for the base row. */
	band: string;
	cells: Record<string, PriceCell>;
	/** The newest cell in the displayed month, the metadata a new cell in this row inherits. */
	latest: PriceCell;
};

const cellOf = (row: Answer['pricing_floors']['rows'][number]): PriceCell => ({
	id: row.id,
	revision: row.revision,
	effective_on: row.effective_on,
	floor_price: row.floor_price,
	unit: row.unit,
	tax_inclusive: row.tax_inclusive,
	tax_rate: row.tax_rate,
	minimum_quantity: row.minimum_quantity
});

/** Every month in the book, newest first. */
export const priceBookMonths = (
	answer: ReadAnswer<typeof priceBookCatalogRead>,
	group: string | null,
	currency: CurrencyCode | null
): readonly string[] =>
	answer.pricing_floors.rows
		.filter((row) => row.key.group_code === group && row.key.currency === currency)
		.map((row) => row.key.effective_on.slice(0, 7))
		.sort((a, b) => b.localeCompare(a));

/** The chosen month's rows, one per product and quantity band, with the cells stored on their exact days. */
export function priceBookRows(answer: Answer, month: string): readonly PriceRow[] {
	const rows = new Map<string, PriceRow & { inMonth: boolean }>();
	for (const row of answer.pricing_floors.rows) {
		const product = row.product;
		if (product === null) continue;
		const cell = cellOf(row);
		const key = `${product.id}|${cell.minimum_quantity}`;
		const found = rows.get(key);
		const target = found ?? {
			key,
			product: product.id,
			code: product.source_number || product.external_code,
			name: product.name,
			unit: cell.unit,
			minimum_quantity: cell.minimum_quantity,
			band: BigDecimal.isPositive(BigDecimal.fromStringUnsafe(cell.minimum_quantity))
				? `≥ ${cell.minimum_quantity}`
				: '',
			cells: {},
			latest: cell,
			inMonth: false
		};
		if (row.effective_on.startsWith(month)) {
			target.cells[row.effective_on] = cell;
			target.inMonth = true;
		}
		if (row.effective_on > target.latest.effective_on) target.latest = cell;
		rows.set(key, target);
	}
	return [...rows.values()]
		.filter((row) => row.inMonth)
		.sort(
			(a, b) =>
				a.code.localeCompare(b.code) ||
				BigDecimal.Order(
					BigDecimal.fromStringUnsafe(a.minimum_quantity),
					BigDecimal.fromStringUnsafe(b.minimum_quantity)
				)
		);
}

/** The day keys of one `YYYY-MM` month, in order. */
export function monthDays(month: string): readonly string[] {
	const first = DateTime.makeUnsafe(`${month}-01`);
	return Array.from(
		{ length: DateTime.getPart(DateTime.endOf(first, 'month'), 'day') },
		(_, days) => DateTime.formatIsoDateUtc(DateTime.add(first, { days }))
	);
}
