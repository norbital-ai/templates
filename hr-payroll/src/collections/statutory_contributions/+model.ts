import {
	boolean,
	custom,
	defineModel,
	enums,
	integer,
	sql,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		/** The jurisdiction settings version this scheme belongs to, sealed with it. */
		settings_id: uuid().notNull(),
		code: text({ search: true }).notNull(),
		name: text({ search: true }).notNull(),
		/**
		 * The section of law transcribed. A scheme that cites one is statutory and the drift automation
		 * watches it; a company-rule scheme is the entity's own levy and cites nothing.
		 */
		authority: text(),
		/**
		 * The span the scheme is assessed over. `MONTH` states that its rules are a monthly schedule —
		 * so a semi-monthly company charges the whole month's contribution once, on the month's wage,
		 * rather than half of it twice. At a monthly company the two are the same.
		 */
		assessment_period: enums(['PAY_PERIOD', 'MONTH']).notNull().default('PAY_PERIOD'),
		/**
		 * Who the scheme is assessed on. `EMPLOYMENT` is one charge per employment, the ordinary
		 * case. `COMPANY` is one charge on the whole run — the employer's own levy on the salary
		 * fund — evaluated once over the sum of every payslip's money after the employment schemes,
		 * with an employee expression of zero and no payslip carrying it.
		 */
		assessment_scope: enums(['EMPLOYMENT', 'COMPANY']).notNull().default('EMPLOYMENT'),
		/**
		 * The elections this scheme reads from its employments, each key and its type. The write
		 * refuses a `scheme.elections.<key>` the row does not declare; the fact editor offers the
		 * right control for the type.
		 */
		elections: custom('fact_keys')
			.notNull()
			.default(sql`'[]'::jsonb`),
		/**
		 * Annual ceiling on this scheme's employee share when another scheme reads it as a relief;
		 * null is no cap.
		 */
		employee_share_annual_cap: integer(),
		/** Schemes in one pool share the tightest cap they name. */
		shared_cap_group: text(),
		/** Whether a relief read of this scheme includes the months still to run. */
		project_relief_annually: boolean().notNull().default(false),
		/**
		 * The ladder: every rule states its condition and the money it charges there, in order. All
		 * arithmetic — transform, relief, household share, rounding, threshold, annualisation — is an
		 * expression inside these rules. A read of `produced.<code>.employee|employer` in any of them
		 * is the only dependency declaration.
		 */
		rules: custom('contribution_rules')
			.notNull()
			.default(sql`'[]'::jsonb`),
		/**
		 * What this scheme is assessed on: one CEL over the reserved lines and the version's
		 * catalogue rows, e.g. `BASE + catalog('ALLOWANCE', {'exclude': ['BACKPAY_ADD_WAGES']})`. A
		 * catalogue row returns its own landing, so the formula is a selection written with `+`.
		 */
		assessed_on: text().notNull().default('')
	},
	{
		description:
			'One statutory scheme of one jurisdiction settings version — EPF, SOCSO, EIS, PCB, HRDF and their equivalents — with the rules that select and price its charge. Sealed with its version. A rule that names `produced.<code>.employee|employer` depends on that scheme; there is no sequence and no relief junction. Each scheme states what it is assessed on as one expression over the reserved lines and its version’s catalogue rows.',
		recordLabel: ['code', 'name'],
		icon: 'lucide:landmark',
		indexes: [{ columns: ['settings_id', 'code'], unique: true }]
	}
);
