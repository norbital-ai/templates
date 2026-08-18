import {
	custom,
	dateRange,
	defineModel,
	enums,
	sql,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		employment_id: uuid().notNull(),
		base_salary: custom('money').notNull(),
		pay_frequency: enums(['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY']).notNull(),
		work_classification: enums(['EA_COVERED', 'NON_EA', 'MANAGERIAL']).notNull(),
		/**
		 * First Schedule work category used to decide whether the RM4,000 exclusion from statutory
		 * OT/rest-day/public-holiday pay applies. Seeded values are inferred and remain editable.
		 */
		statutory_work_category: enums([
			'NON_MANUAL',
			'MANUAL_LABOUR',
			'MANUAL_LABOUR_SUPERVISOR',
			'COMMERCIAL_VEHICLE_OPERATOR',
			'VESSEL_WORK'
		])
			.notNull()
			.default('NON_MANUAL'),
		employment_type: enums([
			'PERMANENT',
			'CONTRACT',
			'PROBATION',
			'INTERN',
			'CONSULTANT'
		]).notNull(),
		department: text(),
		job_title: text(),
		payroll_group: text(),
		/** The employment's only schedule term. Workdays, hours, rest and off days derive from it. */
		work_pattern: custom('work_pattern').notNull(),
		effective_range: dateRange().notNull(),
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
			'The effective-dated pay, classification and canonical work pattern of one employment. Schedule hours, workdays, rest days and off days are derived from the embedded pattern rather than duplicated.',
		recordLabel: 'summary',
		icon: 'lucide:file-signature',
		// Plan 02 §7: employment =, effective range &&. One employment has exactly one set of terms
		// on any date, so the engine's terms lookup returns at most one row structurally.
		exclusions: [
			{
				name: 'employment_terms_no_overlap',
				elements: [
					{ expr: 'employment_id', with: '=' },
					{ expr: 'norbital_daterange(effective_range)', with: '&&' }
				]
			}
		]
	}
);
