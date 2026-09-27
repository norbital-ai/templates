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
		pass_type: {
			kind: 'enum',
			values: ['EMPLOYMENT_PASS', 'S_PASS', 'WORK_PERMIT', 'INTRA_COMPANY_TRANSFER', 'OTHER'],
			optional: true
		},
		/** `terms.tax_residency`; NON_RESIDENT_NETB is PH NIRC s.25(B). */
		tax_residency: {
			kind: 'enum',
			values: ['RESIDENT', 'NON_RESIDENT', 'NON_RESIDENT_NETB'],
			optional: true
		},
		currency: { kind: 'currency' },
		base_salary: { kind: 'money', currency: 'currency' },
		/** VN Decree 293/2025 art. 5(5): this worksite's region on 31 December 2025. */
		minimum_wage_2025_region: { kind: 'text', optional: true },
		/** True only when the same worksite was assigned a lower 2026 region by the decree. */
		minimum_wage_2026_area_reclassified: { kind: 'bool', optional: true },
		/** The allowances the contract carries; `[]` when none. */
		allowances: { kind: 'custom', of: 'contract_allowances', default: [] },
		pay_frequency: {
			kind: 'enum',
			values: ['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY']
		},
		work_classification: { kind: 'enum', values: ['EA_COVERED', 'NON_EA', 'MANAGERIAL'] },
		/** First Schedule work category (MY RM4,000 exclusion); PH art.82 field personnel and paid-by-results. */
		statutory_work_category: {
			kind: 'enum',
			values: [
				'NON_MANUAL',
				'MANUAL_LABOUR',
				'MANUAL_LABOUR_SUPERVISOR',
				'COMMERCIAL_VEHICLE_OPERATOR',
				'VESSEL_WORK',
				'FIELD_PERSONNEL',
				'PAID_BY_RESULTS'
			],
			default: 'NON_MANUAL'
		},
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
		/** Whether a similar full-time employee exists; ABSENT invokes the statutory fallback. */
		comparable_full_time_presence: {
			kind: 'enum',
			values: ['PRESENT', 'ABSENT'],
			optional: true
		},
		effective_range: { kind: 'period', of: 'date' },
		/** `<job title> · <employment type>`, derived by the transform. */
		summary: { kind: 'text' }
	},
	// one set of terms per employment on any date
	noOverlap: [
		{ key: ['employment_id'], period: 'effective_range', name: 'employment_terms_no_overlap' }
	]
});
