import {
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
		pass_type: enums(['EMPLOYMENT_PASS', 'S_PASS', 'WORK_PERMIT', 'OTHER']),
		/**
		 * Tax residency declared for this contract, where it is not what citizenship implies (TW
		 * 所得稅法 §7(3): domicile and days present decide it); null reads as the citizenship
		 * default. `terms.tax_residency`.
		 */
		tax_residency: enums(['RESIDENT', 'NON_RESIDENT']),
		base_salary: custom('money').notNull(),
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
		/** The entity's own benefit tier; catalogue predicates read it as terms.grade. */
		grade: text(),
		/**
		 * The shift assignment's first half: how many days a week this contract agrees to work,
		 * 1–7. Always set. Proration divides by it (`work.ts` / `proration.ts` read this column),
		 * whether or not a pattern is named: a rostered person is not ad hoc, their days move
		 * inside a five- or six-day week.
		 */
		agreed_days_per_week: integer().notNull(),
		/**
		 * The contracted ordinary hours a week, where the contract states them: the week an
		 * HOURLY rate is annualised over and the day length a person with no roster is measured on.
		 * Null where the roster measures it — the shift's paid hours over the agreed days.
		 */
		ordinary_hours_per_week: integer(),
		/**
		 * The shift assignment's second half, optional: the named `shift_patterns` row its days are
		 * projected from. Workdays, hours, rest and off days derive from the pattern; a `work_days`
		 * row overrides one day of it. A named cycle must work `agreed_days_per_week` days in each
		 * of its weeks (refused otherwise). NULL means rostered: nothing is projected, and the
		 * person must hold a roster with a shift for every day payroll prices, or the run refuses
		 * them by name.
		 */
		shift_pattern_id: uuid(),
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
			'The effective-dated pay, jurisdiction residency, classification and shift assignment (agreed days per week, optional pattern) of one employment contract, owned by that contract. Schedule hours, workdays, rest days and off days derive from the named pattern; without one the roster is the schedule.',
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
