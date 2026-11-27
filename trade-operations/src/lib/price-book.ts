import type { CurrencyCode, Id, ReadAnswer } from '@norbital-ai/bolt';
import { BigDecimal, DateTime } from 'effect';
import { unitRatio } from './commercial.js';
import { floorDefaultUnit } from './unit-display.js';
import type { FloorMatrixExportRow, ParsedFloorMatrix } from './floor-matrix-xlsx.js';

/** Month and scope selectors need bucket counts, not the individual price records. */
export const priceBookCatalogRead = {
	pricing_floors: { aggregate: { by: ['group_code', 'currency', { month: 'effective_on' }] } },
	warehouses: { fields: ['name', 'group_code', 'group_name', 'active'] }
} as const;

const nextMonthOf = (month: string) =>
	DateTime.formatIsoDateUtc(DateTime.add(DateTime.makeUnsafe(`${month}-01`), { months: 1 }));

/** One month's dated book in one currency, and each product it prices once (not once per price). */
export const priceBookRead = (group: string, currency: CurrencyCode, month: string) => {
	const book = {
		group_code: { eq: group },
		currency: { eq: currency },
		effective_on: {
			gte: `${month}-01`,
			lt: nextMonthOf(month)
		}
	};
	return {
		pricing_floors: {
			where: book,
			fields: [
				'product',
				'effective_on',
				'unit',
				'floor_price',
				'tax_inclusive',
				'tax_rate',
				'revision'
			],
			order_by: { effective_on: 'asc' },
			limit: 10000
		},
		products: {
			where: { pricing_floors: { some: book } },
			fields: ['name', 'external_code', 'source_number', 'spec', 'brand', 'category'],
			limit: 10000
		}
	} as const;
};

/** One month's price book across all warehouse regions in one currency, for SalesBridge `.xlsx` export. */
export const priceBookExportMonthRead = (currency: CurrencyCode, month: string) =>
	({
		pricing_floors: {
			where: {
				currency: { eq: currency },
				effective_on: { gte: `${month}-01`, lt: nextMonthOf(month) }
			},
			fields: ['product', 'group_code', 'effective_on', 'floor_price', 'updated_at'],
			order_by: { effective_on: 'asc' },
			limit: 10000
		},
		products: {
			where: { active: { eq: true } },
			fields: ['name', 'external_code', 'source_number', 'spec', 'brand', 'category'],
			limit: 10000
		}
	}) as const;

/** Latest floors before `month` in one currency, supplying `最近报价` and seeding empty-month exports. */
export const priceBookExportPriorRead = (currency: CurrencyCode, month: string) =>
	({
		pricing_floors: {
			where: {
				currency: { eq: currency },
				effective_on: { lt: `${month}-01` }
			},
			fields: ['product', 'group_code', 'effective_on', 'floor_price', 'updated_at'],
			order_by: { effective_on: 'desc' },
			limit: 5000
		}
	}) as const;

/** Products and existing floors needed to validate and plan a SalesBridge `.xlsx` matrix upload. */
export const priceBookImportProductsRead = (codes: readonly string[]) =>
	({
		products: {
			where: {
				active: { eq: true },
				or: [{ source_number: { in: codes } }, { external_code: { in: codes } }]
			},
			fields: ['external_code', 'source_number', 'unit', 'tax_rate', 'active'],
			limit: 10000
		}
	}) as const;

export const priceBookImportFloorsRead = (
	currency: CurrencyCode,
	productIds: readonly Id<'products'>[]
) =>
	({
		pricing_floors: {
			where: {
				currency: { eq: currency },
				product: { in: productIds }
			},
			fields: [
				'product',
				'group_code',
				'effective_on',
				'unit',
				'floor_price',
				'tax_inclusive',
				'tax_rate',
				'updated_at'
			],
			order_by: { effective_on: 'desc' },
			limit: 10000
		}
	}) as const;

type Answer = ReadAnswer<ReturnType<typeof priceBookRead>>;

/** A blank day's cell inherits the latest row's unit and tax terms, even in a historical month. */
export const priceBookDefaultsRead = (
	group: string,
	currency: CurrencyCode,
	product: Id<'products'>
) =>
	({
		pricing_floors: {
			where: {
				group_code: { eq: group },
				currency: { eq: currency },
				product: { eq: product }
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
};

export type PriceRow = {
	key: string;
	product: Id<'products'>;
	code: string;
	name: string;
	spec: string | null;
	brand: string | null;
	category: string | null;
	unit: string;
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
	tax_rate: row.tax_rate
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

/** The chosen month's rows, one per product, with the cells stored on their exact days. */
export function priceBookRows(answer: Answer, month: string): readonly PriceRow[] {
	const rows = new Map<string, PriceRow & { inMonth: boolean }>();
	const products = new Map(answer.products.rows.map((product) => [product.id, product]));
	for (const row of answer.pricing_floors.rows) {
		const product = products.get(row.product);
		if (product === undefined) continue;
		const cell = cellOf(row);
		const key = product.id;
		const found = rows.get(key);
		const target = found ?? {
			key,
			product: product.id,
			code: product.source_number || product.external_code,
			name: product.name,
			spec: product.spec,
			brand: product.brand,
			category: product.category,
			unit: cell.unit,
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
		.sort((a, b) => a.code.localeCompare(b.code));
}

/** The day keys of one `YYYY-MM` month, in order. */
export function monthDays(month: string): readonly string[] {
	const first = DateTime.makeUnsafe(`${month}-01`);
	return Array.from(
		{ length: DateTime.getPart(DateTime.endOf(first, 'month'), 'day') },
		(_, days) => DateTime.formatIsoDateUtc(DateTime.add(first, { days }))
	);
}

type WarehouseRegion = {
	readonly name: string;
	readonly group_code: string | null;
	readonly group_name: string | null;
};

/** Maps each warehouse `group_code` to an unambiguous `库位` display label (`group_name` when unique, else `group_code`). */
export function warehouseRegionLabels(warehouses: readonly WarehouseRegion[]): Map<string, string> {
	const nameByCode = new Map<string, string>();
	const codeCountsByName = new Map<string, Set<string>>();
	for (const warehouse of warehouses) {
		const code = warehouse.group_code?.trim();
		const name = warehouse.group_name?.trim();
		if (!code || !name) continue;
		if (!nameByCode.has(code)) nameByCode.set(code, name);
		const set = codeCountsByName.get(name) ?? new Set<string>();
		set.add(code);
		codeCountsByName.set(name, set);
	}
	const out = new Map<string, string>();
	for (const [code, name] of nameByCode) {
		out.set(code, (codeCountsByName.get(name)?.size ?? 0) === 1 ? name : code);
	}
	return out;
}

type ExportProduct = {
	readonly id: Id<'products'>;
	readonly external_code: string;
	readonly source_number: string | null;
	readonly spec: string | null;
	readonly brand: string | null;
	readonly category: string | null;
};

type ExportFloor = {
	readonly product: Id<'products'>;
	readonly group_code: string;
	readonly effective_on: string;
	readonly floor_price: string;
};

/**
 * Builds SalesBridge `每日基准价格汇总` export rows for one `(currency, month)`.
 * Exports every `(product, group_code)` present in `monthFloors` (or in `priorFloors` when the month is still empty),
 * keeping `最近报价` populated from the newest price on or before the end of the month.
 */
export function buildFloorMatrixExportRows(input: {
	readonly month: string;
	readonly warehouses: readonly WarehouseRegion[];
	readonly products: readonly ExportProduct[];
	readonly monthFloors: readonly ExportFloor[];
	readonly priorFloors?: readonly ExportFloor[];
}): readonly FloorMatrixExportRow[] {
	const products = new Map(input.products.map((product) => [product.id, product]));
	const labels = warehouseRegionLabels(input.warehouses);
	const pairs = new Map<
		string,
		{
			readonly product: ExportProduct;
			readonly groupCode: string;
			readonly cells: Record<string, string>;
			latestDate: string;
			latestPrice: string | null;
		}
	>();
	const ensure = (productId: Id<'products'>, groupCode: string) => {
		const product = products.get(productId);
		if (!product) return null;
		const key = `${product.id}\0${groupCode}`;
		const found = pairs.get(key);
		if (found) return found;
		const created: {
			readonly product: ExportProduct;
			readonly groupCode: string;
			readonly cells: Record<string, string>;
			latestDate: string;
			latestPrice: string | null;
		} = { product, groupCode, cells: {}, latestDate: '', latestPrice: null };
		pairs.set(key, created);
		return created;
	};
	for (const floor of input.monthFloors) {
		const target = ensure(floor.product, floor.group_code);
		if (!target) continue;
		const formatted = BigDecimal.format(BigDecimal.fromStringUnsafe(floor.floor_price));
		if (floor.effective_on.startsWith(input.month)) target.cells[floor.effective_on] = formatted;
		if (floor.effective_on >= target.latestDate) {
			target.latestDate = floor.effective_on;
			target.latestPrice = formatted;
		}
	}
	const seedFromPrior = pairs.size === 0;
	for (const floor of input.priorFloors ?? []) {
		const key = `${floor.product}\0${floor.group_code}`;
		const target = seedFromPrior ? ensure(floor.product, floor.group_code) : pairs.get(key);
		if (!target) continue;
		if (floor.effective_on > target.latestDate) {
			target.latestDate = floor.effective_on;
			target.latestPrice = BigDecimal.format(BigDecimal.fromStringUnsafe(floor.floor_price));
		}
	}
	return [...pairs.values()]
		.map((entry): FloorMatrixExportRow => ({
			code: entry.product.source_number || entry.product.external_code,
			spec: entry.product.spec,
			brand: entry.product.brand,
			category: entry.product.category,
			groupLabel: labels.get(entry.groupCode) ?? entry.groupCode,
			latestPrice: entry.latestPrice,
			cells: entry.cells
		}))
		.sort((a, b) => a.code.localeCompare(b.code) || a.groupLabel.localeCompare(b.groupLabel));
}

export type FloorMatrixImportReason =
	| 'invalid_price'
	| 'missing_code'
	| 'unknown_product'
	| 'ambiguous_product'
	| 'missing_group'
	| 'unknown_group'
	| 'duplicate_cell'
	| 'stale'
	| 'unit_mismatch';

export type FloorMatrixImportIssue = {
	readonly rowNo: number;
	readonly column: string;
	readonly reason: FloorMatrixImportReason;
	readonly raw?: string;
};

export type FloorMatrixImportRow = {
	readonly product: Id<'products'>;
	readonly group_code: string;
	readonly currency: CurrencyCode;
	readonly effective_on: string;
	readonly unit: string;
	readonly floor_price: string;
	readonly tax_inclusive: boolean;
	readonly tax_rate: string;
};

export type FloorMatrixImportPlan = {
	readonly rows: readonly FloorMatrixImportRow[];
	readonly unchanged: number;
	readonly issues: readonly FloorMatrixImportIssue[];
};

type ImportProduct = {
	readonly id: Id<'products'>;
	readonly external_code: string;
	readonly source_number: string | null;
	readonly unit: string | null;
	readonly tax_rate: string | null;
	readonly active: boolean;
};

type ExistingImportFloor = {
	readonly product: Id<'products'>;
	readonly group_code: string;
	readonly effective_on: string;
	readonly unit: string;
	readonly floor_price: string;
	readonly tax_inclusive: boolean;
	readonly tax_rate: string;
	readonly updated_at: string;
};

/**
 * Validates and plans a SalesBridge `.xlsx` matrix upload into keyed `pricing_floors.import` rows.
 * Checks product codes, warehouse regions (`group_code`, `group_name`, or warehouse name), unit compatibility,
 * duplicate conflicting cells, and `模板信息` export-timestamp staleness.
 */
export function planFloorMatrixImport(input: {
	readonly parsed: ParsedFloorMatrix;
	readonly currency: CurrencyCode;
	readonly warehouses: readonly WarehouseRegion[];
	readonly knownGroups: readonly string[];
	readonly products: readonly ImportProduct[];
	readonly existing: readonly ExistingImportFloor[];
}): FloorMatrixImportPlan {
	const issues: FloorMatrixImportIssue[] = input.parsed.invalid.map((bad) => ({
		rowNo: bad.rowNo,
		column: bad.column,
		reason: 'invalid_price',
		raw: bad.raw
	}));
	const groupCodes = new Set<string>();
	const byGroupName = new Map<string, string | null>();
	const byWarehouseName = new Map<string, string | null>();
	const register = (map: Map<string, string | null>, label: string, code: string) => {
		const prev = map.get(label);
		if (prev === undefined) map.set(label, code);
		else if (prev !== code) map.set(label, null);
	};
	for (const code of input.knownGroups) {
		const trimmed = code.trim();
		if (trimmed) groupCodes.add(trimmed);
	}
	for (const warehouse of input.warehouses) {
		const code = warehouse.group_code?.trim();
		if (!code) continue;
		groupCodes.add(code);
		const groupName = warehouse.group_name?.trim();
		if (groupName) register(byGroupName, groupName, code);
		const whName = warehouse.name.trim();
		if (whName) register(byWarehouseName, whName, code);
	}
	const resolveGroup = (raw: string): string | null => {
		const trimmed = raw.trim();
		if (!trimmed) return null;
		if (groupCodes.has(trimmed)) return trimmed;
		const fromGroup = byGroupName.get(trimmed);
		if (fromGroup) return fromGroup;
		const fromWarehouse = byWarehouseName.get(trimmed);
		if (fromWarehouse) return fromWarehouse;
		if (groupCodes.size === 0) return trimmed;
		return null;
	};

	const activeProducts = input.products.filter((product) => product.active);
	const byId = new Map<string, ImportProduct | null>();
	const byNumber = new Map<string, ImportProduct | null>();
	for (const product of activeProducts) {
		const prevId = byId.get(product.external_code);
		byId.set(product.external_code, prevId === undefined ? product : null);
		if (product.source_number) {
			const prevNum = byNumber.get(product.source_number);
			byNumber.set(product.source_number, prevNum === undefined ? product : null);
		}
	}
	const resolveProduct = (
		code: string
	):
		| { readonly kind: 'ok'; readonly product: ImportProduct }
		| { readonly kind: 'missing' | 'ambiguous' } => {
		const numberMatch = byNumber.get(code);
		const idMatch = byId.get(code);
		if (
			numberMatch === null ||
			idMatch === null ||
			(numberMatch !== undefined && idMatch !== undefined && numberMatch.id !== idMatch.id)
		)
			return { kind: 'ambiguous' };
		const found = numberMatch ?? idMatch;
		return found ? { kind: 'ok', product: found } : { kind: 'missing' };
	};

	const existingByKey = new Map<string, ExistingImportFloor>();
	const latestByProductGroup = new Map<string, ExistingImportFloor>();
	const latestByProduct = new Map<string, ExistingImportFloor>();
	for (const floor of input.existing) {
		const exactKey = `${floor.product}\0${floor.group_code}\0${floor.effective_on}`;
		if (!existingByKey.has(exactKey)) existingByKey.set(exactKey, floor);
		const pgKey = `${floor.product}\0${floor.group_code}`;
		const prevPg = latestByProductGroup.get(pgKey);
		if (!prevPg || floor.effective_on > prevPg.effective_on) latestByProductGroup.set(pgKey, floor);
		const prevP = latestByProduct.get(floor.product);
		if (!prevP || floor.effective_on > prevP.effective_on)
			latestByProduct.set(floor.product, floor);
	}

	const planned = new Map<string, FloorMatrixImportRow>();
	let unchanged = 0;
	for (const cell of input.parsed.cells) {
		if (!cell.code) {
			issues.push({ rowNo: cell.rowNo, column: '商品编码', reason: 'missing_code' });
			continue;
		}
		const productMatch = resolveProduct(cell.code);
		if (productMatch.kind !== 'ok') {
			issues.push({
				rowNo: cell.rowNo,
				column: '商品编码',
				reason: productMatch.kind === 'ambiguous' ? 'ambiguous_product' : 'unknown_product',
				raw: cell.code
			});
			continue;
		}
		if (!cell.group) {
			issues.push({ rowNo: cell.rowNo, column: '库位', reason: 'missing_group' });
			continue;
		}
		const groupCode = resolveGroup(cell.group);
		if (groupCode === null) {
			issues.push({ rowNo: cell.rowNo, column: '库位', reason: 'unknown_group', raw: cell.group });
			continue;
		}
		const product = productMatch.product;
		const key = `${product.id}\0${groupCode}\0${cell.date}`;
		const seen = planned.get(key);
		if (seen) {
			if (
				!BigDecimal.equals(
					BigDecimal.fromStringUnsafe(seen.floor_price),
					BigDecimal.fromStringUnsafe(cell.price)
				)
			) {
				issues.push({
					rowNo: cell.rowNo,
					column: cell.date,
					reason: 'duplicate_cell',
					raw: cell.price
				});
			}
			continue;
		}
		const current = existingByKey.get(key);
		if (current) {
			if (
				BigDecimal.equals(
					BigDecimal.fromStringUnsafe(current.floor_price),
					BigDecimal.fromStringUnsafe(cell.price)
				)
			) {
				unchanged++;
				continue;
			}
			if (input.parsed.stamp !== null && current.updated_at > input.parsed.stamp) {
				issues.push({ rowNo: cell.rowNo, column: cell.date, reason: 'stale' });
				continue;
			}
			planned.set(key, {
				product: product.id,
				group_code: groupCode,
				currency: input.currency,
				effective_on: cell.date,
				unit: current.unit,
				floor_price: cell.price,
				tax_inclusive: current.tax_inclusive,
				tax_rate: current.tax_rate
			});
			continue;
		}
		const inherited =
			latestByProductGroup.get(`${product.id}\0${groupCode}`) ?? latestByProduct.get(product.id);
		const unit = inherited?.unit ?? floorDefaultUnit(product.unit);
		const tax_inclusive = inherited?.tax_inclusive ?? true;
		const tax_rate = inherited?.tax_rate ?? product.tax_rate ?? '13';
		if (product.unit && unitRatio(unit, product.unit) === null) {
			issues.push({ rowNo: cell.rowNo, column: cell.date, reason: 'unit_mismatch', raw: unit });
			continue;
		}
		planned.set(key, {
			product: product.id,
			group_code: groupCode,
			currency: input.currency,
			effective_on: cell.date,
			unit,
			floor_price: cell.price,
			tax_inclusive,
			tax_rate
		});
	}
	return { rows: [...planned.values()], unchanged, issues };
}
