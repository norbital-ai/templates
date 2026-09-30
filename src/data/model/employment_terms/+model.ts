import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'The effective-dated pay, jurisdiction residency, classification and shift assignment (the named pattern) of one employment contract, owned by that contract. The days a week, schedule hours, workdays, rest days and off days derive from the named pattern; a declared-week pattern leaves the roster as the schedule.',
	icon: 'lucide:file-signature',
	label: 'summary',
	fields: {
		residency_status: {
			kind: 'enum',
			values: ['CITIZEN', 'PERMANENT_RESIDENT', 'FOREIGNER'],
			optional: true
		},
		/** When that standing began; predicates read whole months as `employee.residency_months`. */
		residency_since: { kind: 'date', optional: true },
		/**
		 * The four classification codes below (`pass_type`, `tax_residency`, `work_classification`,
		 * `statutory_work_category`) are the governing settings version's `payroll.vocabularies`.
		 */
		pass_type: { kind: 'text', optional: true },
		tax_residency: { kind: 'text', optional: true },
		currency: { kind: 'currency' },
		base_salary: { kind: 'money', currency: 'currency' },
		/** The worksite a daily wage table names: a province or `province/district` (TH Notice 14). */
		worksite: { kind: 'text', optional: true },
		/** The worksite's sector a daily wage table names, e.g. HOTEL_TYPE_2 (TH Notice 14 cl.2). */
		worksite_sector: { kind: 'text', optional: true },
		/** The allowances the contract carries; `[]` when none. */
		allowances: { kind: 'custom', of: 'contract_allowances', default: [] },
		pay_frequency: {
			kind: 'enum',
			values: ['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY']
		},
		work_classification: { kind: 'text' },
		statutory_work_category: { kind: 'text', default: 'NON_MANUAL' },
		/** PP 44/2015 art.19(5): weather-dependent piece work uses twelve paid months, not three. */
		weather_dependent_piece: { kind: 'bool', default: false },
		employment_type: {
			kind: 'enum',
			values: [
				'PERMANENT',
				'CONTRACT',
				'PROBATION',
				'INTERN',
				'CONSULTANT',
				'PART_TIME',
				'APPRENTICE',
				'DOMESTIC'
			]
		},
		/** Notice either side owes on termination, in days; `terms.notice_days`. */
		notice_days: { kind: 'int', min: 0, optional: true },
		department: { kind: 'text', optional: true },
		job_title: { kind: 'text', optional: true },
		payroll_group: { kind: 'text', optional: true },
		/**
		 * The part-month divisor the contract states, where the law leaves it to the contract
		 * (`work_rules.proration_contractual`; VN Decree 145/2020 art.55(1)(a), Law 41/2024
		 * arts.33(5), 34(3)). Absent is the version's own basis; dated by `effective_range`.
		 */
		proration: { kind: 'custom', of: 'proration_basis', optional: true },
		/** Monthly-paid: every day of the month paid (DOLE Handbook ch.2 §D, factor 365). */
		paid_rest_days: { kind: 'bool', default: false },
		/** The entity's own benefit tier; `terms.grade`. */
		grade: { kind: 'text', optional: true },
		/** Contracted ordinary hours a week, where stated; null where the roster measures it. */
		ordinary_hours_per_week: { kind: 'int', min: 1, optional: true },
		/** Similar full-time employee's normal day for statutory part-time work premiums. */
		comparable_full_time_daily_hours: {
			kind: 'decimal',
			scale: 2,
			min: 0.01,
			max: 24,
			optional: true
		},
		/** Similar full-time employee's normal working hours each week for part-time leave. */
		comparable_full_time_weekly_hours: {
			kind: 'decimal',
			scale: 2,
			min: 0.01,
			max: 168,
			optional: true
		},
		/** Whether a similar full-time employee exists; ABSENT invokes the statutory fallback. */
		comparable_full_time_presence: {
			kind: 'enum',
			values: ['PRESENT', 'ABSENT'],
			optional: true
		},
		/** Jurisdiction inputs the lineage declares in `terms_facts`, dated with these terms; `terms.facts.<key>`. */
		facts: { kind: 'custom', of: 'entity_facts', default: {} },
		effective_range: { kind: 'period', of: 'date' },
		/** `<job title> · <employment type>`, derived by the transform. */
		summary: { kind: 'text' }
	},
	// one set of terms per employment on any date
	noOverlap: [
		{ key: ['employment_id'], period: 'effective_range', name: 'employment_terms_no_overlap' }
	]
});
