import { model } from '@norbital-ai/bolt';

export default model('order_files', {
	description: 'Documents received after confirming an order',
	record_label: 'record.title',
	fields: {
		order: { kind: 'ref', to: 'orders', inverse: 'filed_documents' },
		title: { kind: 'text' },
		file: {
			kind: 'file',
			accept: ['application/pdf', 'image/jpeg', 'image/png'],
			max: '20MiB'
		}
	},
	outputs: { default: { fields: 'all' } },
	create: {
		fields: ['order', 'title', 'file'],
		transform: function* (changes, ctx) {
			const { orders } = yield* ctx.query({
				orders: { where: { id: { in: changes.map(({ after }) => after.order) } }, as_of: 'act' }
			});
			for (const [index, { after: row }] of changes.entries()) {
				const order = orders.rows.find((candidate) => candidate.id === row.order);
				if (!order || order.archived || order.status !== 'confirmed')
					return yield* ctx.refuse('errors.file_recorded_version', { row: index });
				if (!row.title.trim())
					return yield* ctx.refuse('errors.file_title_required', { row: index, field: 'title' });
			}
			return changes.map(({ set }) => ({ ...set, title: set.title.trim() }));
		}
	}
});
