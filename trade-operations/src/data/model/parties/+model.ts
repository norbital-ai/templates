import { model } from '../../../../.norbital/models/parties.ts';
import { columns, readSource, fromSource } from '../../../integration/kingdee/polling.js';
import { projections } from '../../../integration/kingdee/projections.js';
import { preserveSource } from '../../../integration/kingdee/reconciliation.js';
import { partyWorkbook } from '../../../lib/workbook.js';
export default model({
	description: 'parties',
	record_label: 'record.name',
	fields: {
		external_code: {
			kind: 'text'
		},
		source_number: { kind: 'text', optional: true },
		name: {
			kind: 'text'
		},
		kind: {
			kind: 'enum',
			values: ['customer', 'supplier', 'both']
		},
		currency: {
			kind: 'currency'
		},
		active: {
			kind: 'bool',
			default: true
		},
		address: {
			kind: 'text',
			optional: true
		},
		phone: {
			kind: 'text',
			format: 'phone',
			optional: true
		},
		source_updated_at: {
			kind: 'instant'
		},
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } }
	},
	outputs: { default: { fields: 'all' } },
	constraints: { natural_key: { unique: ['source', 'external_code'], import_key: true } },
	indexes: { search: { text: ['name', 'external_code'] } },
	syncs: {
		kingdee: {
			with: 'kingdee',
			every: '1min',
			read: function* ({ cursor, instance }, ctx) {
				return fromSource(
					yield* readSource(
						projections.parties,
						cursor,
						ctx,
						(row) => {
							const r = columns(row);
							return {
								external_code: r.text('external_code'),
								source_number: r.text('source_number', null),
								name: r.text('name'),
								kind: r.one('kind', ['customer', 'supplier', 'both']),
								currency: r.currency('currency'),
								active: r.bool('active', true),
								address: r.text('address', null),
								phone: r.text('phone', null),
								source_updated_at: r.instant('source_updated_at')
							};
						},
						preserveSource({ model: 'parties', instance, projection: projections.parties, ctx })
					),
					instance
				);
			}
		},
		sheet: {
			with: 'file',
			parser: ['xlsx', 'csv'],
			schema: partyWorkbook,
			write: function* (_input, ctx) {
				const { parties } = yield* ctx.query({
					parties: {
						fields: [
							'source',
							'external_code',
							'source_number',
							'name',
							'kind',
							'currency',
							'active',
							'address',
							'phone'
						],
						order_by: { external_code: 'asc' },
						limit: 10000
					}
				});
				return parties.rows.map((party) => ({
					ledger: party.source,
					external_code: party.external_code,
					source_number: party.source_number ?? '',
					name: party.name,
					kind: party.kind,
					currency: party.currency,
					active: party.active,
					address: party.address ?? '',
					phone: party.phone ?? ''
				}));
			}
		}
	}
});
