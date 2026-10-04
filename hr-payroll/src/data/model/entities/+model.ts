import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'An employing entity bound to one jurisdiction settings lineage: its attendance cutoff, pay frequency and risk class. Headcount is derived from active employee_profiles, never stored.',
	icon: 'lucide:building-2',
	label: 'name',
	fields: {
    input_column_history: { kind: 'json', optional: true, hidden: true },
		input_census: { kind: 'json', optional: true, hidden: true },
		source_basis: { kind: 'json', optional: true, hidden: true },
		/** Original proof records retain their IDs and exact accepted schema/value bindings. */
		input_originals: { kind: 'json', optional: true, hidden: true },
		input_proofs: { kind: 'json', optional: true, hidden: true },
		input_files: { kind: 'file', accept: ['*/*'], max: '20MiB', multiple: true, optional: true, hidden: true },
		input_schema_snapshot: { kind: 'json', optional: true, hidden: true },
		input_history: { kind: 'json', optional: true, hidden: true },
		/** The settings lineage (`MY`, `SG`, `SG-norbital`); the version in force on a date is picked from it. */
		settings_code: { kind: 'text' },
		name: { kind: 'text' },
		/** Null where the source never supplied a number (the bank's `SOURCE_NOT_PROVIDED`). */
		registration_number: { kind: 'text', optional: true },
		/** The day a run's attendance window opens; the window closes the day before it next month. */
		pay_cutoff_day: { kind: 'int', min: 1, max: 31 },
		/** Company policy, not law: minutes after a rostered shift's start before a missing clock-in is a late arrival. */
		late_arrival_grace_minutes: { kind: 'int', min: 0, default: 15 },
		pay_frequency: {
			kind: 'enum',
			values: ['MONTHLY', 'SEMI_MONTHLY', 'TEN_DAY', 'INTEGER_MONTHS', 'WEEKLY'],
			default: 'MONTHLY'
		},
		/** Actual complete-month contractual cycle length; no inferred quarterly default. */
		pay_cycle_months: { kind: 'int', min: 2, max: 12, optional: true },
		/** First actual contractual cycle start month, written YYYY-MM. */
		pay_cycle_anchor: { kind: 'text', optional: true },
		/** Explicit collection policy for any contracted intra-month instalment calendar. */
		instalment_statutory_cutoff: { kind: 'enum', values: ['FIRST', 'SPLIT', 'LAST'], optional: true },
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
		facts: { kind: 'json', shape: { kind: 'record', of: { kind: 'json' } } },
		/** The Google holiday calendar this entity's annual drafts are read from. */
		holiday_source: { kind: 'json', shape: {
		kind: 'object',
		fields: {
			calendar_id: { kind: 'text' },
			time_zone: { kind: 'text' },
			enabled: { kind: 'bool' }
		}
	}, optional: true },
		/** Which payroll workbook this entity hands out. */
		workbook_layout: { kind: 'enum', values: ['MATRIX', 'VENDOR'], default: 'MATRIX' },
		/** The originator account a bank file's header names. */
		disbursement_account: { kind: 'json', shape: { kind: 'object', fields: { bank_name: { kind: 'text' }, bank_code: { kind: 'text' }, bank_account_number: { kind: 'text' }, bank_account_name: { kind: 'text' } } }, optional: true },
		effective_range: { kind: 'period', of: 'date' }
	},
	index: ['settings_code'],
	search: { text: ['name'] }
});
