import { averageLotCost } from '../../../lib/lot-cost.js';
import { d } from '../../../lib/commercial.js';
import { collection, type QueryCtx } from '@norbital-ai/bolt';
const c = collection('pricing_floors', {
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
			}
		}
	},
	read: {
		fields: 'all'
	},
	create: {
		input: {
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
		}
	},
	update: {
		input: {
			columns: ['floor_price', 'tax_inclusive', 'tax_rate']
		}
	}
});
export default c;
c.query('inventory_cost', function* (input, ctx: QueryCtx) {
	const stock = yield* ctx.read('stock_snapshots', {
		where: { product: { eq: input.product } },
		all: true,
		select: { product: true, unit: true, currency: true, on_hand: true, unit_cost: true }
	});
	const average = averageLotCost(stock.rows, input.product, input.unit, input.currency);
	const net = d(input.price).div(
		input.tax_inclusive ? d(1).plus(d(input.tax_rate).div(100, 8)) : d(1),
		8
	);
	return { below: average !== null && net.lt(average), average };
});
