import { Decimal } from '@norbital-ai/std/decimal';
import { model } from '@norbital-ai/bolt';
import { averageLotCost } from '../../../lib/lot-cost.js';

export default model('pricing_floors', {
	description: 'pricing floors',
	label: ['effective_on', 'group_code'],
	fields: {
		product: { kind: 'ref', to: 'products' },
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
		floor_price_nonnegative: {
			floor_price: {
				gte: '0'
			}
		}
	},
	read: 'all',
	create: {
		columns: [
			'product',
			'currency',
			'group_code',
			'effective_on',
			'unit',
			'floor_price',
			'tax_inclusive',
			'tax_rate',
			'minimum_quantity'
		]
	},
	update: {
		columns: ['floor_price', 'tax_inclusive', 'tax_rate']
	},
	queries: {
		inventory_cost: {
			description:
				'Compare a proposed floor with remaining inventory cost in matching units and currency.',
			input: {
				product: { kind: 'id', of: 'products' },
				unit: { kind: 'text' },
				currency: { kind: 'currency' },
				price: { kind: 'decimal', scale: 4 },
				tax_inclusive: { kind: 'bool' },
				tax_rate: { kind: 'decimal', scale: 2 }
			},
			output: {
				kind: 'object',
				fields: { below: { kind: 'bool' }, average: { kind: 'decimal', scale: 8, optional: true } }
			},
			run: function* (input, ctx) {
				const stock = yield* ctx.query('stock_snapshots', {
					where: { product: { eq: input.product } },
					all: true,
					select: { product: true, unit: true, currency: true, on_hand: true, unit_cost: true }
				});
				const average = averageLotCost(stock.rows, input.product, input.unit, input.currency);
				const net = Decimal.of(input.price).div(
					input.tax_inclusive
						? Decimal.of(1).plus(Decimal.of(input.tax_rate).div(100, 8))
						: Decimal.of(1),
					8
				);
				return { below: average !== null && net.lt(average), average };
			}
		}
	}
});
