import {
	custom,
	defineModel,
	enums,
	file,
	instant,
	numeric,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

/**
 * The only door money enters payroll through.
 *
 * One stream, not two. `component_entries` and `repayment_agreements` were the same row with two
 * spellings - an employment, a pay component, a magnitude, and a statement of when it comes due -
 * and keeping them apart cost a whole extra collection: a loan's instalments were *copied* into
 * `component_entries` as `LOAN_INSTALMENT` rows so payroll could find them, which meant two
 * generated projections of the origin union, a global unique index over them, and a relation whose
 * only job was to keep the copy pointing at the original.
 *
 * **Loan instalment rows no longer exist.** The schedule already holds its instalments; payroll
 * measures `instalments` directly. A shortfall stays outstanding on the obligation and the next run
 * recovers the remainder against the same instalment.
 *
 * ## Why the terms are columns and not a union in jsonb
 *
 * `terms` and `occasion` are two orthogonal questions - HOW an obligation comes due, and WHY it
 * exists - and the first draft of this collection expressed them as a discriminated union nested
 * inside another one, held in a single `custom()` column. That was wrong, and it was wrong in
 * exactly the way `payslip_lines` was wrong: it hand-rolled resolution the platform already owns.
 * Two facts inside that blob were live references -
 *
 *     reverses_obligation_id   an obligation pointing at another obligation, with no foreign key
 *     evidence_file            a file, spelled as a uuid string
 *
 * - and inside jsonb the database cannot enforce either, `bolt migrate` cannot see either, and the
 * replica cannot reason about either. A third consequence decided it: the row predicate that hides
 * HR's corrections had to read `terms->'occasion'->>'of'`, and **a field grant cannot mask a jsonb
 * sub-path**. This same change introduces field grants on `work_days`; declaring a shape that
 * cannot accept one is declaring the next defect.
 *
 * So every arm's payload is a real column, nullable where the arm does not apply:
 *
 *     ONE_OFF    occasion + that occasion's own payload      due once, on event_date
 *     RECURRING  effective_range                             due every period the range covers
 *     SCHEDULED  effective_range + instalments               due by a dated plan; this arm is the
 *                                                            whole of what repayment_agreements was
 *     REVERSAL   reverses_obligation_id + reason             undoes an earlier obligation
 *
 * The honest cost is nullable columns that only some arms use. That is the trade, and it is the same
 * trade the lost `SINGLE_USE` invariant already made: a rule the database cannot state becomes a
 * NAMED REFUSAL rather than a comment. `OBLIGATION_TERMS_MISMATCH` in
 * `src/lib/obligation_refusals.ts` is the complete arm/payload rule, and it is tested. What is
 * bought for it is that every one of these facts is now enforceable by a constraint, readable by a
 * row predicate, and maskable by a field grant.
 *
 * `amount` is always a magnitude. Direction comes from the pay component policy, and a reversal is
 * `terms = REVERSAL`, never a negative number. For a SCHEDULED obligation `amount` is the principal
 * - stated once here rather than a second time inside the schedule.
 */
export default defineModel(
	{
		employment_id: uuid().notNull(),
		pay_component_id: uuid().notNull(),
		/**
		 * The customer's own name for this obligation - a loan reference, a batch number. Searchable,
		 * and the first term of the record label. Only some obligations have one.
		 */
		reference: text({ search: true }),
		amount: numeric().notNull(),
		quantity: numeric(),
		event_date: instant({ precision: 'day' }).notNull(),
		pay_period: text(),
		/**
		 * Human-readable provenance - where this amount came from in the source the customer
		 * recognises ("Source MLCLM row 30"), free text, never parsed. Distinct from `terms`, which
		 * is the machine-readable statement of how it comes due.
		 */
		description: text(),

		// ── how it comes due ─────────────────────────────────────────────────────────────────────
		/** The four ways money comes due. Every other column below belongs to one of them. */
		terms: enums(['ONE_OFF', 'RECURRING', 'SCHEDULED', 'REVERSAL']).notNull(),
		/**
		 * Why a ONE_OFF obligation exists. NULL on every other arm, and **NULL is exactly "not an
		 * adjustment"** - which is why the policy predicate that hides HR's corrections is now a
		 * plain column comparison rather than a JSON path, and why a field grant could mask it.
		 */
		occasion: enums(['ENTERED', 'CLAIM', 'ARREARS', 'ADJUSTMENT']),
		/**
		 * The window a RECURRING or SCHEDULED obligation is live across. NULL on ONE_OFF and
		 * REVERSAL, which are due on `event_date` and nowhere else.
		 *
		 * There is no `cadence` column beside it. The union it replaced carried
		 * `cadence: 'PAY_PERIOD'` - a literal with exactly one value, which is not a fact, it is a
		 * constant written into every row.
		 */
		effective_range: custom('instant_range', { precision: 'day' }),
		/**
		 * The instalments a SCHEDULED obligation is recovered by, in the order payroll deducts them.
		 * NULL on every other arm. Inlined: the sequence is the array index, and there is nothing in
		 * an instalment for a foreign key to hold.
		 */
		instalments: custom('obligation_instalment', { multiple: true }),

		// ── the payload each arm carries ─────────────────────────────────────────────────────────
		/** Free text for ENTERED and ADJUSTMENT occasions. */
		note: text(),
		/** Why a REVERSAL or an ARREARS occasion exists. Required on both; NULL elsewhere. */
		reason: text(),
		/** The day a CLAIM was incurred, which is not the day it was entered. CLAIM only. */
		incurred_on: instant({ precision: 'day' }),
		/**
		 * The receipt behind a CLAIM.
		 *
		 * A real `file()` column, not a uuid in a blob: the platform owns upload, storage key and
		 * mime type, and a workspace that spells a file as an id is a workspace where nothing can
		 * fetch it, nothing can validate it and nothing can clean it up.
		 */
		evidence_file: file(),
		/**
		 * The past pay periods an ARREARS occasion settles, as `YYYY-MM`. ARREARS only.
		 *
		 * A real text array, the same way `statutory_contributions.relief_for` and `special_rules`
		 * are. The grammar is checked by `OBLIGATION_TERMS_MISMATCH`, because it is one clause of the
		 * arm rule rather than a rule of its own.
		 */
		covers_periods: text().array(),
		/**
		 * The obligation this one reverses. REVERSAL only.
		 *
		 * A real self-referencing foreign key, declared in `+relationship.ts` and NOT a cascade: a
		 * reversal is the evidence that an earlier obligation was undone, so the earlier row cannot
		 * be deleted while the reversal names it, and deleting the reversal must never take the
		 * original with it.
		 */
		reverses_obligation_id: uuid()
	},
	{
		description:
			'The only door money enters payroll through: a claim, a bonus, an HR adjustment, an arrears correction, a standing allowance, or a staff loan and its instalment schedule. amount is always a magnitude; direction comes from the pay component policy and a reversal is terms = REVERSAL, never a negative number.',
		recordLabel: ['reference', 'event_date', 'amount'],
		icon: 'lucide:banknote',
		indexes: [
			{ columns: ['employment_id', 'pay_period'] },
			{ columns: ['pay_component_id'] },
			{ columns: ['employment_id', 'event_date'] },
			{ columns: ['terms'] },
			{
				columns: ['reverses_obligation_id'],
				where: '"reverses_obligation_id" IS NOT NULL'
			}
		]
	}
);
