import { model } from '@norbital-ai/bolt';

/** A frozen calculation: written once by its transform with its payslips, never updated (no `update` exposure). */
export default model({
	description:
		'A frozen payroll calculation for a company and period: a month (YYYY-MM) at a monthly company, a half (YYYY-MM-1 for the 1st to the 15th, YYYY-MM-2 for the 16th to the month end) at a semi-monthly one. Exactly one payroll is permitted per company and period. Later approved adjustments settle in a subsequent period. Payment lives on the payslips; the run carries no state of its own and only an unpaid run can be deleted. The run names the jurisdiction settings version that governed it and the calculation version that produced its outputs.',
	icon: 'lucide:play-circle',
	label: 'period',
	fields: {
		period: { kind: 'text' },
		/** Hash of the selected configuration. */
		configuration_hash: { kind: 'text' },
		/** The published holidays the run read, captured whole. */
		holidays: { kind: 'custom', of: 'holiday_snapshots' },
		/** The engine build that interpreted the captured configuration. */
		calculation_version: { kind: 'text' },
		pay_date: { kind: 'date' },
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
	unique: [{ fields: ['company_id', 'period'] }],
	search: { text: ['period'] }
});
