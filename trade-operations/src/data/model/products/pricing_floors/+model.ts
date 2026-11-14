import { model } from '@norbital-ai/bolt';
import { BigDecimal } from 'effect';
export default model('pricing_floors', {
	description: 'pricing floors',
	record_label:
		"record.product.name + ' · ' + record.group_code + ' · ' + string(record.effective_on)",
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
		},
		/** The floor before tax: what a sales line's net unit price is held to. */
		floor_net: {
			kind: 'decimal',
			scale: 8,
			computed: 'round(tax_inclusive ? floor_price / (1 + tax_rate / 100) : floor_price, 8)'
		}
	},
	outputs: {
		default: {
			fields: 'all',
			product: { fields: ['name', 'external_code', 'source_number', 'source'] }
		}
	},
	constraints: {
		natural_key: {
			unique: ['product', 'group_code', 'currency', 'effective_on', 'minimum_quantity'],
			import_key: true
		},
		import_revision_ephemeral: { check: { import_revision: { is_null: true } } },
		floor_price_nonnegative: {
			check: {
				floor_price: {
					gte: '0'
				}
			}
		}
	},
	indexes: { search: { text: ['product', 'group_code', 'unit'] } },
	create: {
		fields: [
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
		],
		transform: function* (changes, ctx) {
			for (const [row, { after }] of changes.entries()) {
				if (after.import_revision != null && after.import_revision !== 0)
					yield* ctx.refuse('errors.price_book_stale', { row });
			}
			return changes.map(({ set: { import_revision: _, ...set } }) => set);
		}
	},
	update: {
		fields: ['floor_price', 'tax_inclusive', 'tax_rate', 'import_revision'],
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
					(set.floor_price == null ||
						BigDecimal.equals(
							BigDecimal.fromStringUnsafe(set.floor_price),
							BigDecimal.fromStringUnsafe(before.floor_price)
						)) &&
					(set.tax_rate == null ||
						BigDecimal.equals(
							BigDecimal.fromStringUnsafe(set.tax_rate),
							BigDecimal.fromStringUnsafe(before.tax_rate)
						)) &&
					(set.tax_inclusive === undefined || set.tax_inclusive === before.tax_inclusive);
				if (
					import_revision != null &&
					(unit !== before.unit || (!same && import_revision !== before.revision))
				)
					yield* ctx.refuse('errors.price_book_stale', { row });
				rows.push(set);
			}
			return rows;
		}
	}
});
