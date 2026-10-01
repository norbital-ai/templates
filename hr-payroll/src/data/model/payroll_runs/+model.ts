import { model } from '@norbital-ai/bolt';

/** A frozen calculation: written once by its transform with its payslips, never updated (no `update` exposure). */
export default model({
	description:
		'A frozen payroll calculation for a company and period: a month (YYYY-MM) at a monthly company, a half (YYYY-MM-1 for the 1st to the 15th, YYYY-MM-2 for the 16th to the month end) at a semi-monthly one. A period holds one REGULAR run and any number of FINAL (leavers exiting in the period), EARLY (salary an off-cycle run settled ahead of the REGULAR one, created with it), OFF_CYCLE (selected one-off requests) and CORRECTION (selected manual ad hoc lines) runs, numbered by sequence. No run rewrites a committed payslip: a correction is a new line in a later run. Payment lives on the payslips; the run carries no state of its own and only an unpaid run can be deleted. The run names the jurisdiction settings version that governed it and the calculation version that produced its outputs.',
	icon: 'lucide:play-circle',
	label: 'period',
	fields: {
		period: { kind: 'text' },
		/**
		 * REGULAR pays everyone; FINAL settles the period's leavers early; EARLY settles the salary of the people an
		 * OFF_CYCLE run pays ahead of the REGULAR run; OFF_CYCLE and CORRECTION pay only `sources`.
		 */
		kind: {
			kind: 'enum',
			values: ['REGULAR', 'OFF_CYCLE', 'EARLY', 'FINAL', 'CORRECTION'],
			default: 'REGULAR'
		},
		/** The run's position among the company's runs of this period, from 1; derived, never input. */
		sequence: { kind: 'int', min: 1 },
		/** OFF_CYCLE and CORRECTION: the claim and ad hoc request ids the run pays, and nothing else. */
		sources: { kind: 'json', shape: { kind: 'list', of: { kind: 'text' } }, optional: true },
		/** Hash of the selected configuration. */
		configuration_hash: { kind: 'text' },
		/** The published holidays the run read, captured whole. */
		holidays: { kind: 'custom', of: 'holiday_snapshots' },
		/** The engine build that interpreted the captured configuration. */
		calculation_version: { kind: 'text' },
		pay_date: { kind: 'date' },
		/** Contractual wage due date, separate from the run's settlement date. */
		pay_due_date: { kind: 'date', optional: true },
		attendance_from: { kind: 'date' },
		attendance_to: { kind: 'date' },
		/** How each charge was derived; later runs' overtime ceilings read its settled counts. */
		calculation_trace: { kind: 'custom', of: 'payroll_trace' },
		/** The COMPANY-assessed schemes' charges for the whole run. */
		company_charges: { kind: 'custom', of: 'payslip_statutory' },
		/** Employer-month amounts to remit, kept apart from accrued employer cost. */
		company_remittances: { kind: 'custom', of: 'company_remittances' },
		/** What the engine noticed but did not refuse, one sentence per line. */
		warnings: { kind: 'text', default: '' }
	},
	unique: [{ fields: ['company_id', 'period', 'sequence'] }],
	search: { text: ['period'] }
});
