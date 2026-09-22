import { boolean, custom, defineModel, enums, sql, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		/** The jurisdiction settings version this row belongs to, sealed with it. */
		settings_id: uuid().notNull(),
		/** The catalogue's stable code, and the display name beside it. */
		code: text({ search: true }).notNull(),
		name: text({ search: true }),
		/** The section of law the row transcribes; a row that cites one is statutory. */
		authority: text(),
		/**
		 * Where the line settles: `PAY` earns or reduces gross, `NET` pays or deducts outside it,
		 * `EMPLOYER` costs the employer alone, `DISPLAY` is printed without money.
		 */
		destination: enums(['PAY', 'NET', 'EMPLOYER', 'DISPLAY']).notNull(),
		/** `ADD` adds, `SUBTRACT` takes; null where destination is `EMPLOYER` or `DISPLAY`. */
		direction: enums(['ADD', 'SUBTRACT']),
		/** The ordered bands that price this catalogue's entries; see `datatypes/catalogue_band`. */
		bands: custom('catalogue_band')
			.notNull()
			.default(sql`'[]'::jsonb`),
		/** One CEL expression over the person context (`payroll_runs/lib/eligibility.ts`); '' is everyone. */
		eligibility: text().notNull().default(''),
		/**
		 * The statutory schemes whose base every line of this class enters — `EPF`, `SOCSO`; a scheme
		 * that splits its base names the part, `CPF.ADDITIONAL`. Listed, the class is summed into the
		 * scheme's `ALLOWANCES`; not listed, it is outside that base. Empty is a decision: the class
		 * enters no base at all.
		 */
		counts_toward: custom('code_list')
			.notNull()
			.default(sql`'[]'::jsonb`),
		/**
		 * Whether an unpaid day comes off this class. Null follows the version
		 * (`payroll.allowance_npl_prorates`); the classes a statute excludes from the deduction's
		 * wage — SG's travel, food and housing allowances (EA s.2), MY's travelling allowance —
		 * state false, and every other class prorates like basic salary.
		 */
		npl_prorates: boolean()
	},
	{
		description:
			'The allowance catalogue of one jurisdiction settings version: the static classes a contract may carry — code, destination and direction, the bands that price them, the schemes each counts toward. An allowance is assigned on the employment terms with its monthly figure and prorated like basic salary; one-off pay belongs to the ad hoc catalogue. Sealed with its version; the run cites the version it priced against.',
		recordLabel: ['code', 'name'],
		icon: 'lucide:calendar-clock',
		indexes: [{ columns: ['settings_id', 'code'], unique: true }]
	}
);
