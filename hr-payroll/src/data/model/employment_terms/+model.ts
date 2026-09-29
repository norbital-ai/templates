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
		/** The worksite a daily wage table names: a province or `province/district` (TH Notice 14). */
		worksite: { kind: 'text', optional: true },
		/** PH wage-order municipality evidence for this dated terms revision. */
		ph_worksite_source_reference: { kind: 'text', optional: true },
		ph_worksite_source_file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true },
		/** Dated Malaysian state or federal territory; required by the MY payroll profiles. */
		worksite_state: {
			kind: 'enum',
			values: [
				'JOHOR',
				'KEDAH',
				'KELANTAN',
				'MELAKA',
				'NEGERI_SEMBILAN',
				'PAHANG',
				'PERAK',
				'PERLIS',
				'PULAU_PINANG',
				'SELANGOR',
				'TERENGGANU',
				'KUALA_LUMPUR',
				'PUTRAJAYA',
				'LABUAN',
				'SABAH',
				'SARAWAK'
			],
			optional: true
		},
		/** The worksite's sector a daily wage table names, e.g. HOTEL_TYPE_2 (TH Notice 14 cl.2). */
		worksite_sector: { kind: 'text', optional: true },
		/** PH wage-order industry evidence for this dated terms revision. */
		ph_sector_source_reference: { kind: 'text', optional: true },
		ph_sector_source_file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true },
		/** The KBLI edition of an ID worksite sector; dated with this terms revision. */
		worksite_sector_edition: { kind: 'enum', values: ['2020', '2025'], optional: true },
		/** The allowances the contract carries; `[]` when none. */
		allowances: { kind: 'custom', of: 'contract_allowances', default: [] },
		pay_frequency: {
			kind: 'enum',
			values: ['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY']
		},
		work_classification: { kind: 'enum', values: ['EA_COVERED', 'NON_EA', 'MANAGERIAL'] },
		/**
		 * First Schedule work category (MY RM4,000 exclusion); PH art.82 field personnel and workers
		 * paid by results, split as PD 851 splits them (DOLE Handbook 2024 ch.13 §B.4, §F.1):
		 * PIECE_RATE (a standard amount per piece) keeps the 13th month and SIL; TASK_BASIS (task,
		 * contract, pakyaw, boundary, purely commission or a fixed amount for specific work) has neither.
		 */
		statutory_work_category: {
			kind: 'enum',
			values: [
				'NON_MANUAL',
				'MANUAL_LABOUR',
				'MANUAL_LABOUR_SUPERVISOR',
				'COMMERCIAL_VEHICLE_OPERATOR',
				'VESSEL_WORK',
				'FIELD_PERSONNEL',
				/** TH: guarding premises or property as the employee's ordinary duty. */
				'GUARD_DUTY',
				'PIECE_RATE',
				'TASK_BASIS'
			],
			default: 'NON_MANUAL'
		},
		/** Ministerial Regulation hazardous work: LPA s.23 limits normal work to 7 hours a day and 42 a week. */
		hazardous_work: { kind: 'bool', default: false },
		/** TH LPA s.39/1: dated status used before night, overtime or holiday work is allowed. */
		th_pregnancy_status: { kind: 'enum', values: ['PREGNANT', 'NOT_PREGNANT'], optional: true },
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
		/** Last day of the probation the contract agrees, where one is; `terms.probation_months` (CN LCL arts.19, 83). */
		probation_end: { kind: 'date', optional: true },
		/** The wage the contract agrees for after the probation; `terms.post_probation_wage` (CN LCL arts.20, 83). */
		post_probation_wage: { kind: 'money', currency: 'currency', optional: true },
		/** The day an open-ended contract should have been concluded; `terms.open_ended_overdue_months` (CN LCL arts.14, 82 para.2). */
		open_ended_due_on: { kind: 'date', optional: true },
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
		/** ID PP 36/2021 arts.20, 24 and PP 49/2025 art.21: this worker's company wage-scale grade. */
		id_wage_scale_grade: { kind: 'text', optional: true },
		/** The basic-wage minimum for that grade, not the government UMP/UMK. */
		id_wage_scale_basic_minimum: { kind: 'money', currency: 'currency', optional: true },
		id_wage_scale_effective_on: { kind: 'date', optional: true },
		id_wage_scale_notice_on: { kind: 'date', optional: true },
		id_wage_scale_reference: { kind: 'text', optional: true },
		/** The company's scale and this worker's individual grade notice. */
		id_wage_scale_evidence_file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true },
		/** ID: a short-contract foreigner's prior work in Indonesia, checked for BPJS participation. */
		id_foreign_prior_indonesia_work: {
			kind: 'enum',
			values: ['NONE', 'ANY'],
			optional: true
		},
		id_foreign_prior_work_reviewed_on: { kind: 'date', optional: true },
		id_foreign_prior_work_reference: { kind: 'text', optional: true },
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
		effective_range: { kind: 'period', of: 'date' },
		/** `<job title> · <employment type>`, derived by the transform. */
		summary: { kind: 'text' }
	},
	// one set of terms per employment on any date
	noOverlap: [
		{ key: ['employment_id'], period: 'effective_range', name: 'employment_terms_no_overlap' }
	]
});
