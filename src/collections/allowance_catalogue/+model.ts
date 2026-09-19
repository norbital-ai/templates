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
		/** Whether a request against this line must, may or need not attach proof. */
		evidence: enums(['NONE', 'OPTIONAL', 'REQUIRED']).notNull().default('NONE'),
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
		 * A payment the law owes on separation (termination benefits, separation or retirement pay,
		 * severance, notice in lieu): off-boarding raises one standing row of it for the leaver on
		 * the last day, where the row's eligibility holds over them then — held for HR like the
		 * encashment. The band prices it from the person (service years, monthly wage, notice days).
		 */
		on_separation: boolean().notNull().default(false),
		/**
		 * A fixed allowance — paid every period regardless of attendance or output (ID tunjangan
		 * tetap, VN phụ cấp lương, TW 經常性給與) — counts in `terms.fixed_allowances` and so in the
		 * wage a statute defines as basic plus fixed allowances (ID THR and the BPJS bases, VN
		 * insurance salary, MY overtime wages). A reimbursement, a per-day allowance or a bonus is
		 * not fixed, whatever its window.
		 */
		fixed: boolean().notNull().default(true),
		/**
		 * A one-off amount — a bonus, back pay, an ex-gratia sum, a festival or separation payment —
		 * is due whole in the period its window falls in, whatever the window's length or the days
		 * the person was employed: no statute prorates a lump sum (SG: the AW "payable in the
		 * month"; MY s.18A prorates monthly wages only). A standing row is a monthly magnitude and
		 * prorates like basic salary.
		 */
		one_off: boolean().notNull().default(false)
	},
	{
		description:
			'The allowance catalogue of one jurisdiction settings version: code, destination and direction, the bands that price, cap and opt the allowance into statutory schemes, and the evidence it demands. A standing allowance is a monthly amount over an effective window, prorated like basic salary; a one-off amount is due whole in the period it lands in. Sealed with its version; the run cites the version it priced against.',
		recordLabel: ['code', 'name'],
		icon: 'lucide:calendar-clock',
		indexes: [{ columns: ['settings_id', 'code'], unique: true }]
	}
);
