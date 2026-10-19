import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'A frozen payroll calculation for an entity and period: a month (YYYY-MM), or a half (YYYY-MM-1/YYYY-MM-2). The run names the jurisdiction settings version that governed it; payment lives on its payslips and the run carries no state of its own.',
	icon: 'lucide:play-circle',
	label: 'period',
	fields: {
		period: {
			kind: 'text'
		},
		kind: {
			kind: 'enum',
			values: ['REGULAR', 'OFF_CYCLE'],
			default: 'REGULAR'
		},
		sequence: {
			kind: 'int',
			min: 1,
			default: 1
		},
		sources: {
			kind: 'json',
			optional: true
		},
		configuration_hash: {
			kind: 'text',
			optional: true
		},
		pay_date: {
			kind: 'date',
			optional: true
		},
		pay_due_date: {
			kind: 'date',
			optional: true
		},
		salary_from: {
			kind: 'date',
			optional: true
		},
		salary_to: {
			kind: 'date',
			optional: true
		},
		attendance_from: {
			kind: 'date',
			optional: true
		},
		attendance_to: {
			kind: 'date',
			optional: true
		},
		warnings: {
			kind: 'text',
			default: ''
		},
		/** The settlement ledger the build produced: every consumed entry and roster day with the payslip that pinned it. */
		pins: {
			kind: 'json',
			optional: true
		},
		/** The slips a `hold` validation stopped: `{ employment_id, message }`; the run's behaviour puts each ON_HOLD. */
		holds: {
			kind: 'json',
			optional: true
		}
	}
});
