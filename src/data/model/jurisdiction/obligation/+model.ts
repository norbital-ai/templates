import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One money liability of an entity to an authority: a remittance of the statutory contributions or taxes a payroll run charged, its amount (the named schemes’ employee and employer lines of the run’s payslips), its due day, and how it was closed — settled with its evidence, or waived with a reason. Non-money duties are regulatory tasks.',
	icon: 'lucide:landmark',
	label: 'duty_code',
	fields: {
		duty_code: {
			kind: 'text'
		},
		authority: {
			kind: 'text'
		},
		occurrence_key: {
			kind: 'text',
			optional: true,
			help: 'The duty and the run that raised it; one obligation per occurrence.'
		},
		trigger_ref: {
			kind: 'text',
			help: 'The payroll run that raised it.'
		},
		triggered_on: {
			kind: 'date'
		},
		due_on: {
			kind: 'date'
		},
		amount_due: {
			kind: 'decimal',
			scale: 2,
			optional: true
		},
		amount_settled: {
			kind: 'decimal',
			scale: 2,
			optional: true
		},
		state: {
			kind: 'enum',
			values: ['OPEN', 'FULFILLED', 'WAIVED'],
			default: 'OPEN'
		},
		fulfilled_on: {
			kind: 'date',
			optional: true
		},
		waive_reason: {
			kind: 'text',
			optional: true
		},
		reference: {
			kind: 'text',
			optional: true
		},
		evidence_file: {
			kind: 'file',
			accept: ['*/*'],
			max: '20MiB',
			optional: true
		},
		facts: {
			kind: 'json',
			shape: {
				kind: 'record',
				of: { kind: 'json' }
			},
			default: {}
		}
	}
});
