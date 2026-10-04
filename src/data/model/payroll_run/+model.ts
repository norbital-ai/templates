import { model } from '@norbital-ai/bolt';

export default model({
	description: 'One payroll_run record.',
	icon: 'lucide:file-text',
	label: 'period',
	fields: {
		period: { kind: 'text', optional: true },
		kind: { kind: 'text', optional: true },
		sequence: { kind: 'text', optional: true },
		sources: { kind: 'text', optional: true },
		configuration_hash: { kind: 'text', optional: true },
		pay_date: { kind: 'text', optional: true },
		pay_due_date: { kind: 'text', optional: true },
		salary_from: { kind: 'text', optional: true },
		attendance_from: { kind: 'text', optional: true },
		attendance_to: { kind: 'text', optional: true },
		company_charges: { kind: 'text', optional: true },
		company_remittances: { kind: 'text', optional: true },
		warnings: { kind: 'text', optional: true }
	}
});
