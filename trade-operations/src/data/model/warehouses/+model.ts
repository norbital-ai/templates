import { model } from '@norbital-ai/bolt';
import { columns, readSource } from '../../../integration/kingdee/polling.js';
import { projections } from '../../../integration/kingdee/projections.js';
import { preserveSource } from '../../../integration/kingdee/reconciliation.js';
import { warehouseWorkbook } from '../../../lib/workbook.js';
export default model('warehouses', {
	description: 'warehouses',
	label: 'name',
	fields: {
		external_code: {
			kind: 'text'
		},
		source_number: { kind: 'text', optional: true },
		name: {
			kind: 'text'
		},
		group_code: {
			kind: 'text',
			optional: true
		},
		active: {
			kind: 'bool',
			default: true
		},
		source_updated_at: {
			kind: 'instant'
		},
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } }
	},
	key: ['source', 'external_code'],
	search: { text: ['name', 'external_code', 'group_code'] },
	read: 'all',
	syncs: {
		kingdee: {
			with: 'kingdee',
			every: '1min',
			read: function* ({ cursor, instance }, ctx) {
				return yield* readSource(
					projections.warehouses,
					cursor,
					ctx,
					(row) => {
						const r = columns(row);
						return {
							external_code: r.text('external_code'),
							source_number: r.text('source_number', null),
							name: r.text('name'),
							group_code: r.text('group_code', null),
							active: r.bool('active', true),
							source_updated_at: r.instant('source_updated_at')
						};
					},
					preserveSource({ model: 'warehouses', instance, projection: projections.warehouses, ctx })
				);
			}
		},
		sheet: {
			with: 'file',
			parser: ['xlsx', 'csv'],
			schema: warehouseWorkbook,
			write: function* (_input, ctx) {
				const { warehouses } = yield* ctx.db.query({
					warehouses: {
						fields: ['source', 'external_code', 'source_number', 'name', 'group_code', 'active'],
						orderBy: { external_code: 'asc' },
						limit: 10000
					}
				});
				return warehouses.rows.map((warehouse) => ({
					ledger: warehouse.source,
					external_code: warehouse.external_code,
					source_number: warehouse.source_number ?? '',
					name: warehouse.name,
					group_code: warehouse.group_code ?? '',
					active: warehouse.active
				}));
			}
		}
	}
});
