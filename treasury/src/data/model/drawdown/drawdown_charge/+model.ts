import { model } from '@norbital-ai/bolt';
/**
 * A charge on a line: commission, cable, SWIFT and the rest, at drawdown or at settlement,
 * estimated from the fee rules until the bank's advice replaces it.
 */
export default model('drawdown_charge', {
	description: 'One charge on a financing line.',
	icon: 'lucide:receipt',
	record_label: 'record.charge_type',
	fields: {
		drawdown: { kind: 'ref', to: 'drawdown', inverse: 'charges', on_delete: 'cascade' },
		charge_type: {
			kind: 'enum',
			values: [
				'commission',
				'cable',
				'swift',
				'cost_of_funds_transfer',
				'processing',
				'tr_extension',
				'penalty',
				'other'
			],
			default: 'commission'
		},
		stage: { kind: 'enum', values: ['drawdown', 'settlement'], default: 'drawdown' },
		description: { kind: 'text', optional: true },
		currency: { kind: 'currency', default: 'USD' },
		amount: { kind: 'decimal', scale: 2 },
		is_estimate: { kind: 'bool', default: true }
	},
	outputs: {
		default: { fields: 'all', drawdown: { fields: ['bank_reference'] } }
	}
});
