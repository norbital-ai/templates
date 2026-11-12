import { model } from '../../../../../.norbital/models/credit_snapshots.ts';
import { readCreditSource } from '../../../../integration/kingdee/financial-source.js';
export default model({
	description: 'credit snapshots',
	record_label: 'record.external_code',
	fields: {
		external_code: {
			kind: 'text'
		},
		currency: {
			kind: 'currency'
		},
		credit_limit: {
			kind: 'money',
			currency: 'currency',
			optional: true
		},
		credit_used: {
			kind: 'money',
			currency: 'currency',
			optional: true
		},
		credit_hold: {
			kind: 'bool',
			default: false
		},
		as_of: {
			kind: 'instant'
		},
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
		party: { kind: 'ref', to: 'parties' }
	},
	outputs: {
		default: {
			fields: 'all',
			party: { fields: ['name', 'external_code'], orders: { fields: ['id'] } }
		}
	},
	constraints: { natural_key: { unique: ['source', 'external_code'], import_key: true } },
	indexes: { search: { text: ['party', 'external_code'] } },
	syncs: {
		kingdee: {
			with: 'kingdee',
			read: function* () {
				return yield* readCreditSource();
			}
		}
	}
});
