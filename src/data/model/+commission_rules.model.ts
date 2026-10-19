import { DEFAULT_COMMISSION_EXPRESSION } from '../../lib/commission-expressions.js';
import { model } from '@norbital-ai/bolt';
export default model({
	description: 'commission rules',
	label: ['currency', 'effective_on'],
	fields: {
		eligibility_expression: { kind: 'text', format: 'cel', default: 'true' },
		amount_expression: { kind: 'text', format: 'cel', default: DEFAULT_COMMISSION_EXPRESSION },
		parameters: {
			kind: 'json',
			optional: true,
			shape: {
				kind: 'list',
				of: { kind: 'object', fields: { name: { kind: 'text' }, value: { kind: 'text' } } }
			}
		},
		code: {
			kind: 'enum',
			values: ['default'],
			default: 'default',
			hidden: true
		},
		currency: {
			kind: 'currency'
		},
		effective_on: {
			kind: 'date'
		},
		basis_unit: {
			optional: true,
			kind: 'text'
		},
		fixed_rate: {
			default: '0',
			kind: 'money',
			currency: 'currency',
			scale: 4
		},
		spread_pct: {
			default: '0',
			kind: 'decimal',
			scale: 2,
			min: 0,
			max: 100
		},
		active: {
			kind: 'bool',
			default: true
		}
	},
	key: ['code', 'currency', 'effective_on'],
	check: {
		fixed_rate_nonnegative: {
			fixed_rate: {
				gte: '0'
			}
		}
	}
});
