import { model } from '../../../../../.norbital/models/order_files.ts';
import { agreement } from '../../../../lib/agreements.js';

export default model({
	description: 'Documents received after recording an agreement version',
	record_label: 'record.title',
	fields: {
		order: { kind: 'ref', to: 'orders', inverse: 'filed_documents' },
		seal_hash: { kind: 'text', hidden: true },
		title: { kind: 'text' },
		file: {
			kind: 'file',
			accept: ['application/pdf', 'image/jpeg', 'image/png'],
			max: '20MiB'
		}
	},
	outputs: { default: { fields: 'all' } },
	create: {
		columns: { fields: ['order', 'seal_hash', 'title', 'file'] },
		transform: function* (changes, ctx) {
			const orders = yield* ctx.query.after('orders', {
				id: { in: changes.map(({ after }) => after.order) }
			});
			for (const [index, { after: row }] of changes.entries()) {
				const order = orders.find((candidate) => candidate.id === row.order);
				const version = order && agreement(order, row.seal_hash);
				if (!order || order.archived || !version || version.lifecycle === 'pending')
					return yield* ctx.refuse('errors.file_recorded_version', { row: index });
				if (!row.title.trim())
					return yield* ctx.refuse('errors.file_title_required', { row: index, field: 'title' });
			}
			return changes.map(({ set }) => ({ ...set, title: set.title.trim() }));
		}
	}
});
