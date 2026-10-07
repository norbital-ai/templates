import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'Static allowance definitions governed by a jurisdiction snapshot. Qualified employee/entity inputs produce a payslip line directly; no allowance entry is created.',
	icon: 'lucide:calendar-clock',
	label: 'code',
	fields: {
		code: {
			kind: 'text'
		},
		name: {
			kind: 'text',
			optional: true
		},
		eligibility: {
			kind: 'text'
		},
		amount: {
			kind: 'text',
			optional: true,
			help: 'CEL amount over the payslip context; `allowance.amount` is the contract’s monthly figure.'
		},
		authority: {
			kind: 'text',
			optional: true
		},
		counts_toward: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'text'
				}
			},
			default: []
		},
		destination: {
			kind: 'enum',
			values: ['PAY', 'NET', 'EMPLOYER', 'DISPLAY']
		},
		direction: {
			kind: 'enum',
			values: ['ADD', 'SUBTRACT']
		}
	}
});
