import { readCreditSource } from '../../../integration/kingdee/financial-source.js';
import { model } from '@norbital-ai/bolt';
export default model('credit_snapshots', {
	description: 'credit snapshots',
	label: 'external_code',
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
	key: ['source', 'external_code'],
	read: 'all',
	syncs: {
		kingdee: {
			with: 'kingdee',
			read: function* () {
				return yield* readCreditSource();
			}
		}
	}
});
