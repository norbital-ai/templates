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
		// a sales line below its floor, or with none: a hint, a commercial manager's approval, or refused
		floor_rule: { kind: 'enum', values: ['warn', 'approve', 'refuse'], default: 'warn' },
		stock_fresh_minutes: {
			kind: 'int',
			min: 1,
			default: 30
		}
	},
	outputs: { default: { fields: 'all' }, logistics: { fields: ['code', 'stock_fresh_minutes'] } },
	constraints: { natural_key: { unique: ['code'], import_key: true } },
	update: {
		fields: ['freight_treatment', 'floor_rule', 'stock_fresh_minutes']
	}
});
