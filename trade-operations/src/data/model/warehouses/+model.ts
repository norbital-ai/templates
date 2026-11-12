import { model } from '../../../../.norbital/models/warehouses.ts';
import { columns, readSource, fromSource } from '../../../integration/kingdee/polling.js';
import { projections } from '../../../integration/kingdee/projections.js';
import { preserveSource } from '../../../integration/kingdee/reconciliation.js';
import { warehouseWorkbook } from '../../../lib/workbook.js';
export default model({
	description: 'warehouses',
	record_label: 'record.name',
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
	outputs: { default: { fields: 'all' } },
	constraints: { source_code: { unique: ['source', 'external_code'], import_key: true } },
	indexes: { search: { text: ['name', 'external_code', 'group_code'] } },
	syncs: {
		kingdee: {
			with: 'kingdee',
			every: '1min',
			read: function* ({ cursor, instance }, ctx) {
				return fromSource(
					yield* readSource(
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
						preserveSource({
							model: 'warehouses',
							instance,
							projection: projections.warehouses,
							ctx
						})
					),
					instance
				);
			}
		},
		sheet: {
			with: 'file',
			parser: ['xlsx', 'csv'],
			schema: warehouseWorkbook,
			write: function* (_input, ctx) {
				const { warehouses } = yield* ctx.query({
					warehouses: {
						fields: ['source', 'external_code', 'source_number', 'name', 'group_code', 'active'],
						order_by: { external_code: 'asc' },
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
