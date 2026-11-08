import { model, type Id } from '@norbital-ai/bolt';
export default model('commercial_settings', {
	description: 'commercial settings',
	label: 'code',
	fields: {
		default_document_layout: {
			kind: 'ref',
			to: 'document_templates',
			where: { status: { eq: 'published' } },
			optional: true
		},
		default_purchase_document_layout: {
			kind: 'ref',
			to: 'document_templates',
			where: { status: { eq: 'published' } },
			optional: true
		},
		freight_treatment: { kind: 'enum', values: ['deduct', 'include'], default: 'deduct' },
		code: {
			kind: 'enum',
			values: ['default'],
			default: 'default',
			hidden: true
		},
		require_floor: {
			kind: 'bool',
			default: false
		},
		credit_fresh_minutes: {
			kind: 'int',
			min: 1,
			default: 60
		},
		stock_fresh_minutes: {
			kind: 'int',
			min: 1,
			default: 30
		}
	},
	key: ['code'],
	read: 'all',
	outputs: {
		logistics: { commercial_settings: { fields: ['code', 'stock_fresh_minutes'] } }
	},
	update: {
		columns: {
			commercial_settings: [
				'default_document_layout',
				'default_purchase_document_layout',
				'freight_treatment',
				'require_floor',
				'credit_fresh_minutes',
				'stock_fresh_minutes'
			]
		},
		transform: function* (changes, ctx) {
			const ids: Id<'document_templates'>[] = changes.flatMap(({ set }) => [
				...(set.default_document_layout ? [set.default_document_layout] : []),
				...(set.default_purchase_document_layout ? [set.default_purchase_document_layout] : [])
			]);
			if (ids.length) {
				const { document_templates } = yield* ctx.db.query({
					document_templates: {
						where: { id: { in: ids }, status: { eq: 'published' } },
						fields: ['id']
					}
				});
				const allowed = new Set(document_templates.rows.map((row) => row.id));
				const invalid = changes.findIndex(
					({ set }) =>
						(set.default_document_layout != null && !allowed.has(set.default_document_layout)) ||
						(set.default_purchase_document_layout != null &&
							!allowed.has(set.default_purchase_document_layout))
				);
				if (invalid >= 0)
					return yield* ctx.refuse('errors.document_layout_unpublished', {
						row: invalid,
						field: 'default_document_layout'
					});
			}
			return changes.map(({ set }) => set);
		}
	}
});
