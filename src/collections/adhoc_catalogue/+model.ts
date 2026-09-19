import { custom, defineModel, enums, sql, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * A class of one-off pay: a bonus, back pay, an ex-gratia sum, a festival payment, a separation
 * payment, a claw-back. Its instances are `adhoc_requests`, each due whole in one pay period —
 * no statute prorates a lump sum (SG: the AW "payable in the month"; MY s.18A prorates monthly
 * wages only). A standing monthly amount is not ad hoc: it is an allowance on the contract.
 */
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
		/** The ordered bands that price this class's requests; see `datatypes/catalogue_band`. */
		bands: custom('catalogue_band')
			.notNull()
			.default(sql`'[]'::jsonb`),
		/** One CEL expression over the person context (`payroll_runs/lib/eligibility.ts`); '' is everyone. */
		eligibility: text().notNull().default(''),
		/** Whether a request against this line must, may or need not attach proof. */
		evidence: enums(['NONE', 'OPTIONAL', 'REQUIRED']).notNull().default('NONE'),
		/**
		 * The statutory schemes whose base every line of this class enters — `EPF`, `SOCSO`; a scheme
		 * that splits its base names the part, `PCB.ADDITIONAL`. Listed, the class is summed into the
		 * scheme's `ADHOC`; not listed, it is outside that base. Empty is a decision: the class
		 * enters no base at all.
		 */
		counts_toward: custom('code_list')
			.notNull()
			.default(sql`'[]'::jsonb`),
		/**
		 * Who raises a request of this class. `MANUAL` is HR, from the Events page. `SEPARATION` is
		 * off-boarding: a payment the law owes on separation (termination benefits, separation or
		 * retirement pay, severance, notice in lieu) is raised for the leaver in the final period,
		 * where the class's eligibility holds over them then — held for HR like the encashment.
		 */
		raised_by: enums(['MANUAL', 'SEPARATION']).notNull().default('MANUAL')
	},
	{
		description:
			'The ad hoc catalogue of one jurisdiction settings version: the classes of one-off pay — bonus, back pay, ex-gratia, festival and separation payments, claw-backs — with the bands that price and cap them, the schemes each counts toward, the evidence a request demands and who raises one. Sealed with its version; the run cites the version it priced against.',
		recordLabel: ['code', 'name'],
		icon: 'lucide:hand-coins',
		indexes: [{ columns: ['settings_id', 'code'], unique: true }]
	}
);
