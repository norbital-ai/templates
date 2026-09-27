import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'An employing entity bound to one jurisdiction settings lineage: its attendance cutoff, pay frequency and risk class. Headcount is derived from active employments, never stored.',
	icon: 'lucide:building-2',
	label: 'name',
	fields: {
		/** The settings lineage (`MY`, `SG`, `SG-norbital`); the version in force on a date is picked from it. */
		settings_code: { kind: 'text' },
		name: { kind: 'text' },
		/** Null where the source never supplied a number (the bank's `SOURCE_NOT_PROVIDED`). */
		registration_number: { kind: 'text', optional: true },
		/** The day a run's attendance window opens; the window closes the day before it next month. */
		pay_cutoff_day: { kind: 'int', min: 1, max: 31 },
		pay_frequency: {
			kind: 'enum',
			values: ['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY'],
			default: 'MONTHLY'
		},
		/** Where a SEMI_MONTHLY entity deducts the MONTH-assessed schemes (SSS, PhilHealth, Pag-IBIG). */
		semi_monthly_statutory_cutoff: {
			kind: 'enum',
			values: ['FIRST', 'SPLIT', 'LAST'],
			default: 'FIRST'
		},
		/** The occupational risk group a risk-priced scheme (ID JKK) reads. */
		risk_class: { kind: 'text', optional: true },
		/** The region `work_rules.wages.by_region` names; predicates read `company.region`. */
		region: { kind: 'text', optional: true },
		/** Facts keyed by the settings version's declarations; `{}` when none (set by the transform). */
		facts: { kind: 'custom', of: 'entity_facts' },
		/** The Google holiday calendar this entity's annual drafts are read from. */
		holiday_source: { kind: 'custom', of: 'holiday_source', optional: true },
		/** Which payroll workbook this entity hands out. */
		workbook_layout: { kind: 'enum', values: ['MATRIX', 'VENDOR'], default: 'MATRIX' },
		/** The originator account a bank file's header names. */
		disbursement_account: { kind: 'custom', of: 'bank_account', optional: true },
		effective_range: { kind: 'period', of: 'date' }
	},
	index: ['settings_code'],
	search: { text: ['name'] }
});
