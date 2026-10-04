import { model } from '@norbital-ai/bolt';

export default model({
	description: 'One entity record.',
	icon: 'lucide:file-text',
	label: 'settings_code',
	fields: {
		settings_code: { kind: 'text', optional: true },
		name: { kind: 'text', optional: true },
		registration_number: { kind: 'text', optional: true },
		pay_cutoff_day: { kind: 'text', optional: true },
		late_arrival_grace_minutes: { kind: 'text', optional: true },
		pay_frequency: { kind: 'text', optional: true },
		pay_cycle_months: { kind: 'text', optional: true },
		pay_cycle_anchor: { kind: 'text', optional: true },
		instalment_statutory_cutoff: { kind: 'text', optional: true },
		semi_monthly_statutory_cutoff: { kind: 'text', optional: true },
		risk_class: { kind: 'text', optional: true },
		region: { kind: 'text', optional: true },
		facts: { kind: 'text', optional: true },
		holiday_source: { kind: 'text', optional: true },
		workbook_layout: { kind: 'text', optional: true },
		disbursement_account: { kind: 'text', optional: true },
		effective_range: { kind: 'json', optional: true }
	}
});
