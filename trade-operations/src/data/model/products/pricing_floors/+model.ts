import { model, type Finding } from '@norbital-ai/bolt';
import { Decimal } from '@norbital-ai/std/decimal';

const staleBook =
	'This floor changed after the workbook was exported. Export the latest price book and reapply your changes.';

const priceBook = {
	ledger: { kind: 'text', label: 'Ledger ID' },
	product_code: { kind: 'text', label: 'Product code' },
	item_id: { kind: 'text', label: 'Kingdee item ID', optional: true },
	import_revision: { kind: 'int', label: 'Book revision', min: 0, optional: true },
	group_code: { kind: 'text', label: 'Warehouse group' },
	effective_on: { kind: 'date', label: 'Effective date' },
	currency: { kind: 'currency', label: 'Currency' },
	unit: { kind: 'text', label: 'Unit' },
	minimum_quantity: { kind: 'decimal', scale: 3, min: 0, label: 'Minimum quantity' },
	floor_price: { kind: 'decimal', scale: 4, min: 0, label: 'Floor price' },
	tax_inclusive: { kind: 'bool', label: 'Tax inclusive' },
	tax_rate: { kind: 'decimal', scale: 2, min: 0, max: 100, label: 'Tax rate (%)' }
} as const;
export default model('pricing_floors', {
	description: 'pricing floors',
	label: ['effective_on', 'group_code'],
	fields: {
		product: { kind: 'ref', to: 'products' },
		// The native file import passes this through its write transform. It is never stored.
		import_revision: { kind: 'int', min: 0, optional: true, hidden: true },
		currency: {
			kind: 'currency'
		},
		group_code: {
			kind: 'text'
		},
		effective_on: {
			kind: 'date'
		},
		unit: {
			kind: 'text'
		},
		floor_price: {
			kind: 'money',
			currency: 'currency',
			scale: 4
		},
		tax_inclusive: {
			kind: 'bool'
		},
		tax_rate: {
			kind: 'decimal',
			scale: 2,
			default: 0,
			min: 0,
			max: 100
		},
		minimum_quantity: {
			kind: 'decimal',
			scale: 3,
			default: 0,
			min: 0
		}
	},
	key: ['product', 'group_code', 'currency', 'effective_on', 'minimum_quantity'],
	check: {
		import_revision_ephemeral: { import_revision: { isNull: true } },
		floor_price_nonnegative: {
			floor_price: {
				gte: '0'
			}
		}
	},
	search: { text: ['product', 'group_code', 'unit'] },
	read: {
		pricing_floors: { fields: 'all' },
		'pricing_floors.product': { fields: ['name', 'external_code', 'source_number', 'source'] }
	},
	syncs: {
		price_book: {
			with: 'file',
			parser: ['xlsx', 'csv'],
			schema: priceBook,
			read: function* ({ records }, ctx) {
				const codes = [...new Set(records.map((r) => r.product_code))];
				const ids = [
					...new Set([...codes, ...records.flatMap((r) => (r.item_id ? [r.item_id] : []))])
				];
				const { products } = yield* ctx.db.query({
					products: {
						where: {
							active: { eq: true },
							or: [{ source_number: { in: codes } }, { external_code: { in: ids } }]
						},
						fields: ['source', 'external_code', 'source_number', 'unit']
					}
				});
				const key = (ledger: string, code: string) => JSON.stringify([ledger, code]);
				const byId = new Map(products.rows.map((p) => [key(p.source, p.external_code), p]));
				const byNumber = new Map<string, (typeof products.rows)[number] | null>();
				for (const product of products.rows) {
					if (!product.source_number) continue;
					const numberKey = key(product.source, product.source_number);
					byNumber.set(numberKey, byNumber.has(numberKey) ? null : product);
				}
				const findings: Finding[] = [];
				const rows = records.flatMap(({ ledger, product_code, item_id, $at, ...floor }) => {
					const lookup = key(ledger, product_code);
					const numberMatch = byNumber.get(lookup);
					const idMatch = byId.get(key(ledger, item_id || product_code));
					const ambiguous =
						!item_id &&
						(numberMatch === null || (numberMatch && idMatch && numberMatch.id !== idMatch.id));
					const product = item_id ? idMatch : (numberMatch ?? idMatch);
					const codeMatches =
						product &&
						(product.source_number === product_code || product.external_code === product_code);
					const message = ambiguous
						? 'More than one product matches this code in this ledger. Add its Kingdee item ID.'
						: !codeMatches
							? 'No active product matches this code and item ID in this ledger.'
							: product.unit !== floor.unit
								? 'Use the product’s base unit.'
								: null;
					if (!message && product)
						return [
							{ ...floor, import_revision: floor.import_revision ?? 0, product: product.id, $at }
						];
					findings.push({
						at: $at,
						field: codeMatches && !ambiguous ? 'Unit' : 'Product code',
						severity: 'refuse',
						message: message ?? 'No active product matches this code in this ledger.'
					});
					return [];
				});
				return { rows, findings };
			},
			write: function* (_input, ctx) {
				const { pricing_floors } = yield* ctx.db.query({
					pricing_floors: {},
					'pricing_floors.product': { fields: ['source', 'external_code', 'source_number'] }
				});
				return pricing_floors.rows.flatMap(
					({
						product,
						revision,
						group_code,
						effective_on,
						currency,
						unit,
						minimum_quantity,
						floor_price,
						tax_inclusive,
						tax_rate
					}) =>
						product
							? [
									{
										ledger: product.source,
										product_code: product.source_number || product.external_code,
										item_id: product.external_code,
										import_revision: revision,
										group_code,
										effective_on,
										currency,
										unit,
										minimum_quantity,
										floor_price,
										tax_inclusive,
										tax_rate
									}
								]
							: []
				);
			}
		}
	},
	create: {
		columns: {
			pricing_floors: [
				'product',
				'currency',
				'group_code',
				'effective_on',
				'unit',
				'floor_price',
				'tax_inclusive',
				'tax_rate',
				'minimum_quantity',
				'import_revision'
			]
		},
		transform: function* (rows, ctx) {
			for (const [row, value] of rows.entries()) {
				if (value.import_revision != null && value.import_revision !== 0)
					yield* ctx.refuse(staleBook, { row });
			}
			return rows.map(({ import_revision: _, ...row }) => row);
		}
	},
	update: {
		columns: { pricing_floors: ['floor_price', 'tax_inclusive', 'tax_rate', 'import_revision'] },
		transform: function* (changes, ctx) {
			const rows = [];
			for (const [
				row,
				{
					before,
					set: { import_revision, unit, ...set }
				}
			] of changes.entries()) {
				const same =
					(set.floor_price == null || Decimal.of(set.floor_price).eq(before.floor_price)) &&
					(set.tax_rate == null || Decimal.of(set.tax_rate).eq(before.tax_rate)) &&
					(set.tax_inclusive === undefined || set.tax_inclusive === before.tax_inclusive);
				if (
					import_revision != null &&
					(unit !== before.unit || (!same && import_revision !== before.revision))
				)
					yield* ctx.refuse(staleBook, { row });
				rows.push(set);
			}
			return rows;
		}
	}
});
