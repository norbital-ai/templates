import { model } from '@norbital-ai/bolt';
import { agreement } from '../../../../lib/agreements.js';

export default model('order_files', {
	description: 'Documents received after recording an agreement version',
	label: 'title',
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
	read: 'all',
	create: {
		columns: { order_files: ['order', 'seal_hash', 'title', 'file'] },
		transform: function* (rows, ctx) {
			const orders = yield* ctx.db.after('orders', { id: { in: rows.map((row) => row.order) } });
			for (const [index, row] of rows.entries()) {
				const order = orders.find((candidate) => candidate.id === row.order);
				const version = order && agreement(order, row.seal_hash);
				if (!order || order.archived || !version || version.lifecycle === 'pending')
					return yield* ctx.refuse('errors.file_recorded_version', { row: index });
				if (!row.title.trim())
					return yield* ctx.refuse('errors.file_title_required', { row: index, field: 'title' });
			}
			return rows.map((row) => ({ ...row, title: row.title.trim() }));
		}
	}
});
