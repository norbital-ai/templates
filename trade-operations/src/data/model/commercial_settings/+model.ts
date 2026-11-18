import { model } from '@norbital-ai/bolt';
export default model('commercial_settings', {
	description: 'commercial settings',
	record_label: "'Commercial settings'",
	fields: {
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
	outputs: { default: { fields: 'all' }, logistics: { fields: ['code', 'stock_fresh_minutes'] } },
	constraints: { natural_key: { unique: ['code'], import_key: true } },
	update: {
		fields: ['freight_treatment', 'require_floor', 'credit_fresh_minutes', 'stock_fresh_minutes']
	}
});
