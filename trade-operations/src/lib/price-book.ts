import type { CurrencyCode } from '@norbital-ai/bolt';
import type { Id, ReadAnswer } from '@norbital-ai/bolt';
import { Decimal } from '@norbital-ai/std/decimal';

/** A group's dated book in one currency, with the product identity each cell prices. */
export const priceBookRead = (group: string, currency: CurrencyCode) =>
	({
		pricing_floors: {
			where: { group_code: { eq: group }, currency: { eq: currency } },
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
			orderBy: { effective_on: 'asc' },
			// shortcut: one group's whole book is read at once; page by date once a real ledger outgrows 10k rows
			limit: 10000
		},
		'pricing_floors.product': {
			fields: ['name', 'external_code', 'source_number']
		}
	}) as const;

type Answer = ReadAnswer<ReturnType<typeof priceBookRead>>;

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
	cells: Map<string, PriceCell>;
	/** The newest cell across the whole book, the metadata a new cell in this row inherits. */
	latest: PriceCell;
};

const cellOf = (row: Answer['pricing_floors']['rows'][number]): PriceCell => ({
	id: row.id,
	revision: row.revision,
	effective_on: row.effective_on,
	floor_price: Decimal.of(row.floor_price).toString(),
	unit: row.unit,
	tax_inclusive: row.tax_inclusive,
	tax_rate: Decimal.of(row.tax_rate).toString(),
	minimum_quantity: Decimal.of(row.minimum_quantity).toString()
});

/** Every month in the book, newest first. */
export const priceBookMonths = (answer: Answer): readonly string[] =>
	[...new Set(answer.pricing_floors.rows.map((row) => row.effective_on.slice(0, 7)))].sort((a, b) =>
		b.localeCompare(a)
	);

/** The chosen month's rows, one per product and quantity band, with the cells stored on their exact days. */
export function priceBookRows(answer: Answer, month: string, search = ''): readonly PriceRow[] {
	const term = search.trim().toLowerCase();
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
			band: Decimal.of(cell.minimum_quantity).gt(0) ? `≥ ${cell.minimum_quantity}` : '',
			cells: new Map<string, PriceCell>(),
			latest: cell,
			inMonth: false
		};
		if (row.effective_on.startsWith(month)) {
			target.cells.set(row.effective_on, cell);
			target.inMonth = true;
		}
		if (row.effective_on > target.latest.effective_on) target.latest = cell;
		rows.set(key, target);
	}
	return [...rows.values()]
		.filter(
			(row) =>
				row.inMonth &&
				(term === '' ||
					row.code.toLowerCase().includes(term) ||
					row.name.toLowerCase().includes(term))
		)
		.sort(
			(a, b) =>
				a.code.localeCompare(b.code) ||
				Decimal.of(a.minimum_quantity).cmp(Decimal.of(b.minimum_quantity))
		);
}

/** The exact stored digits, trailing zeros dropped: 8450.1235 stays, 8450.0000 reads 8450. */
export const priceText = (value: string): string => {
	const exact = Decimal.of(value).toString();
	return exact.includes('.') ? exact.replace(/0+$/, '').replace(/\.$/, '') : exact;
};

/** The day keys of one `YYYY-MM` month, in order. */
export function monthDays(month: string): readonly string[] {
	const [year = 0, number = 1] = month.split('-').map(Number);
	const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
	return Array.from(
		{ length: count },
		(_, index) => `${month}-${String(index + 1).padStart(2, '0')}`
	);
}
