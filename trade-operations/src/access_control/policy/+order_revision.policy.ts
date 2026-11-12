import { policy } from '@norbital-ai/bolt';
import { lineDeletes } from '../../lib/order-review.js';
export default policy({
	description:
		'Reopens a confirmed order as a replacement draft; a start names only an order its starter reads.',
	grants: {
		orders: {
			outputs: { default: true },
			update: { moves: { status: ['confirmed->draft'] } }
		},
		order_lines: {
			outputs: { default: true },
			create: true,
			update: true,
			delete: {
				verdict: function* (changes, ctx) {
					yield* lineDeletes(
						changes.map(({ before }) => before),
						ctx
					);
					return ctx.allow();
				}
			}
		},
		document_templates: {
			outputs: { default: { where: { status: { eq: 'published' } } } }
		},
		products: {
			outputs: { default: true }
		},
		warehouses: {
			outputs: { default: true }
		}
	}
});
