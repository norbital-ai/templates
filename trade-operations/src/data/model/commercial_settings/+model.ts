import { model } from '@norbital-ai/bolt';
export default model('commercial_settings', {
	description: 'commercial settings',
	label: 'code',
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
	key: ['code'],
	read: 'all',
	outputs: {
		logistics: { commercial_settings: { fields: ['code', 'stock_fresh_minutes'] } }
	},
	update: {
		columns: {
			commercial_settings: [
				'freight_treatment',
				'require_floor',
				'credit_fresh_minutes',
				'stock_fresh_minutes'
			]
		}
	}
});
