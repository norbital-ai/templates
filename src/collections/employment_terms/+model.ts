import {
	boolean,
	custom,
	defineModel,
	enums,
	instant,
	integer,
	sql,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		employment_id: uuid().notNull(),
		/** Standing in this contract's jurisdiction on the effective dates; null is unrecorded. */
		residency_status: enums(['CITIZEN', 'PERMANENT_RESIDENT', 'FOREIGNER']),
		/** When that standing began; predicates read whole calendar months as `employee.residency_months`. */
		residency_since: instant({ precision: 'day' }),
		/** The work pass a foreigner holds here, where a statute keys on it (SG's SINDA covers EP holders); `terms.pass_type`. */
		pass_type: enums([
			'EMPLOYMENT_PASS',
			'S_PASS',
			'WORK_PERMIT',
			'INTRA_COMPANY_TRANSFER',
			'OTHER'
		]),
		/**
		 * Tax residency declared for this contract as `terms.tax_residency`; null is unrecorded.
		 * The applicable jurisdiction's rules determine whether an unknown value stops calculation
		 * or selects a statutory withholding default. Citizenship does not establish tax residence.
		 */
		/**
		 * `NON_RESIDENT_NETB`: a non-resident alien not engaged in trade or business — in the
		 * country 180 days or fewer in the year (PH NIRC s.25(B): 25% of the gross); `NON_RESIDENT`
		 * is one engaged in it, on the graduated table like a resident.
		 */
		tax_residency: enums(['RESIDENT', 'NON_RESIDENT', 'NON_RESIDENT_NETB']),
		base_salary: custom('money').notNull(),
		/**
		 * The allowances the contract carries — one allowance class each with its monthly figure —
		 * priced every period beside the salary and prorated the same way. To change or stop one
		 * is a terms change from a date. See `datatypes/contract_allowances`.
		 */
		allowances: custom('contract_allowances')
			.notNull()
			.default(sql`'[]'::jsonb`),
		pay_frequency: enums(['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY']).notNull(),
		work_classification: enums(['EA_COVERED', 'NON_EA', 'MANAGERIAL']).notNull(),
		/**
		 * First Schedule work category used to decide whether the RM4,000 exclusion from statutory
		 * OT/rest-day/public-holiday pay applies. Inferred seed values are editable until these terms
		 * are consumed; later changes require a future effective amendment.
		 */
		statutory_work_category: enums([
			'NON_MANUAL',
			'MANUAL_LABOUR',
			'MANUAL_LABOUR_SUPERVISOR',
			'COMMERCIAL_VEHICLE_OPERATOR',
			'VESSEL_WORK',
			/** PH Labor Code art.82: field personnel and workers paid by results are outside hours-of-work rules. */
			'FIELD_PERSONNEL',
			'PAID_BY_RESULTS'
		])
			.notNull()
			.default('NON_MANUAL'),
		employment_type: enums([
			'PERMANENT',
			'CONTRACT',
			'PROBATION',
			'INTERN',
			'CONSULTANT',
			'PART_TIME',
			'APPRENTICE',
			'DOMESTIC'
		]).notNull(),
		/**
		 * The notice either side owes on termination, in days, where the contract or statute
		 * states one; a payment row for notice in lieu reads it as `terms.notice_days`.
		 */
		notice_days: integer(),
		department: text(),
		job_title: text(),
		payroll_group: text(),
		/**
		 * The contract pays every day of the month, unworked rest days, special days and regular
		 * holidays included — the DOLE Handbook's "monthly-paid employee" (ch.2 §D: "paid every day of
		 * the month, including unworked rest days, special days, and regular holidays. Factor 365");
		 * false pays worked days and unworked regular holidays only. A statutory day factor reads it
		 * as `terms.paid_rest_days`; `payroll_group` is the employer's own label and states no law.
		 */
		paid_rest_days: boolean().notNull().default(false),
		/** The entity's own benefit tier; catalogue predicates read it as terms.grade. */
		grade: text(),
		/**
		 * The contracted ordinary hours a week, where the contract states them: the week an
		 * HOURLY rate is annualised over and the day length a person with no roster is measured on.
		 * Null where the roster measures it — the shift's paid hours over the pattern's days.
		 */
		ordinary_hours_per_week: integer(),
		/**
		 * The shift assignment: the named `shift_patterns` row. The days a week the contract works
		 * are the pattern's — a cycle's WORK days, or a declared week's figure — and workdays,
		 * hours, rest and off days derive from it; a `work_days` row overrides one day. A declared
		 * week ("Rostered 6 days") projects nothing: the person holds a roster with a shift for
		 * every day payroll prices, and the run measures the month against the declaration.
		 */
		shift_pattern_id: uuid().notNull(),
		effective_range: custom('instant_range', { precision: 'day' }).notNull(),
		/**
		 * The terms' own title, composed in SQL.
		 *
		 * `recordLabel` compiles to a CEL concatenation and CEL has no `+` overload for anything but
		 * strings; a null term throws outright in a multi-field label, and `job_title` is nullable.
		 * The title keeps both halves of the old label — the role when there is one, the employment
		 * type always — and lets the database, not CEL, decide what an absent job title composes to.
		 */
		summary: text({ search: true }).generatedAlwaysAs(
			sql`COALESCE(job_title || ' · ', '') || employment_type`
		)
	},
	{
		description:
			'The effective-dated pay, jurisdiction residency, classification and shift assignment (the named pattern) of one employment contract, owned by that contract. The days a week, schedule hours, workdays, rest days and off days derive from the named pattern; a declared-week pattern leaves the roster as the schedule.',
		recordLabel: 'summary',
		icon: 'lucide:file-signature',
		// Exclusion: employment =, effective range &&. One employment has exactly one set of terms
		// on any date, so the engine's terms lookup returns at most one row structurally.
		exclusions: [
			{
				name: 'employment_terms_no_overlap',
				elements: [
					{ expr: 'employment_id', with: '=' },
					{
						expr: "daterange(lower(bolt_daterange(effective_range - 'end')), upper(bolt_daterange(effective_range - 'start')), '[]')",
						with: '&&'
					}
				]
			}
		]
	}
);
