import { integration } from '@norbital-ai/bolt';
import { sourceState } from './polling.js';
import { bindings } from './source-bindings.js';

export default integration('kingdee', {
	description:
		'Kingdee SQL Server: native rowversion polling and direct order submissions through the Alibaba relay.',
	driver: 'sqlserver',
	credential: {
		connectionString: { kind: 'text', label: 'SQL Server connection string (relay endpoint)' }
	},
	configuration: {
		baseCurrency: { kind: 'text', default: 'CNY', label: 'Verified account-set base currency' },
		branchNo: { kind: 'text', default: '0', label: 'Kingdee branch number' },
		billerId: { kind: 'text', optional: true, label: 'Kingdee biller ID' },
		packagingId: { kind: 'text', optional: true, label: 'Kingdee packaging ID' },
		salespersonBindings: {
			kind: 'text',
			optional: true,
			label: 'Owner to employee/department bindings (JSON)'
		},
		currencyBindings: {
			kind: 'text',
			optional: true,
			label: 'Currency to Kingdee ID bindings (JSON)'
		},
		settlementRules: {
			kind: 'text',
			optional: true,
			label: 'Settlement-number credit rules (JSON)'
		},
		fullSnapshotMinutes: {
			kind: 'int',
			min: 1,
			default: 1440,
			label: 'Full reconciliation interval (minutes)'
		},
		maxWindowMinutes: { kind: 'int', min: 1, default: 15, label: 'Sync window age alert (minutes)' }
	},
	test: function* (ctx) {
		for (const source of Object.values(bindings)) yield* sourceState(ctx, source);
	}
});
