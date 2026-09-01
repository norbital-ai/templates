/**
 * Statutory overtime coverage — who the overtime ladder applies to.
 *
 * This is the *entitlement* test, not the *pricing* test: the regime's pricing members say what an overtime
 * hour is worth, and this says whether the person earning it is inside the statute at all. It is
 * kept apart from pricing because it turns on the person (their wage, their work category), not on
 * the day or the hour.
 *
 * Everything here is pure and reads the picked regime's coverage member, or classifies a pay
 * component against the statute's own definition of wages for the ceiling's comparand. Nothing is
 * hard-coded to a jurisdiction. The literals this replaced were a Malaysian First Schedule test
 * written into the engine, which meant an amendment silently repriced history, no run recorded
 * which threshold priced it, and every non-Malaysian jurisdiction got a confidently wrong "not
 * covered" instead of an absent answer.
 */

import { MoneyValueSchema, type MoneyValue } from '@norbital-ai/std/finance';
import { Schema } from 'effect';

const WageBasisSchema = Schema.Literals(['STATUTORY_WAGES', 'BASE_SALARY']);
export type WageBasis = Schema.Schema.Type<typeof WageBasisSchema>;

const CategoryBasisSchema = Schema.Literals(['STATUTORY_WORK_CATEGORY', 'WORK_CLASSIFICATION']);
type CategoryBasis = Schema.Schema.Type<typeof CategoryBasisSchema>;

/**
 * One pay component classified against the statutory definition of "wages".
 *
 * This is the classification the coverage ceiling's comparand is built from. Employment Act 1955
 * s.2 defines wages as basic wages **and all other cash payments for work done**, and First
 * Schedule para 3 then reads "wages" for the Schedule as that figure less commissions, subsistence
 * allowance and overtime payment. The categories below are that definition, expressed over what a
 * pay component row can say:
 *
 * - `BASIC_WAGES`   — the contracted wage from `employment_terms` (source `SCHEDULE`).
 * - `CASH_FOR_WORK` — an `EARNING` component: any other cash payment for work done.
 * - `NOT_WAGES`     — everything else: information, deductions, absences, employer costs, and
 *                     `NON_WAGE_PAYMENT` reimbursements, none of which is a cash payment for work.
 *
 * Para 3's third exclusion, overtime payment, needs no category. Overtime is not a pay component at
 * all — it is derived from `work_days` against the jurisdiction's overtime rules — so it is
 * never in the set being classified, and the comparand excludes it structurally rather than by
 * filtering it back out.
 *
 * Two para 3 exclusions the component model cannot express: **commissions and subsistence
 * allowance have no category of their own.** Nothing on `pay_components.policy` or
 * `pay_components.definition` distinguishes a commission from any other earning, so a commission
 * paid through an `EARNING` component is counted in the comparand even though the statute takes it
 * out. The seeded catalogues contain no commission or subsistence component, so no shipped
 * population is affected by the gap — but a company that adds one must know the comparand will
 * overstate until the model carries the distinction.
 */
const WageComparandCategorySchema = Schema.Literals(['BASIC_WAGES', 'CASH_FOR_WORK', 'NOT_WAGES']);
type WageComparandCategory = Schema.Schema.Type<typeof WageComparandCategorySchema>;

const WageComparandComponentSchema = Schema.Struct({
	policy: Schema.NullOr(Schema.Struct({ kind: Schema.String })),
	definition: Schema.NullOr(Schema.Struct({ source: Schema.String }))
});
type WageComparandComponent = Schema.Schema.Type<typeof WageComparandComponentSchema>;

/** Classify one pay component for the wage comparand. See `WageComparandCategory`. */
export function classifyWageComparand(component: WageComparandComponent): WageComparandCategory {
	const source = component.definition?.source;
	if (source === 'SCHEDULE') return 'BASIC_WAGES';
	if (component.policy?.kind === 'EARNING') return 'CASH_FOR_WORK';
	return 'NOT_WAGES';
}

/**
 * The s.2 comparand: basic wages plus every other cash payment for work done, less overtime pay.
 *
 * The amounts passed in are the signed entry totals settling in this run for each component — the
 * contractual monthly figures, **not** prorated amounts. The ceiling asks what a person's wages
 * *are* a month, not what a partial month happened to pay: a joiner on RM5,000 earns RM5,000 a
 * month from the day they join, and prorating the comparand would cover them for one month and
 * uncover them the next.
 *
 * `FORMULA` earnings are not counted: their amounts exist only once the component walk has run,
 * which happens after this test has decided who the walk prices overtime for. The under-inclusion
 * keeps an employee inside the ladder rather than outside it, which is the direction the statute
 * reads when doubtful. No seeded company carries a formula earning that a coverage ceiling tests.
 */
type DeriveStatutoryWagesOptions = {
	readonly baseSalary: MoneyValue;
	readonly payments: readonly {
		readonly category: WageComparandCategory;
		readonly amount: number;
	}[];
};

export function deriveStatutoryWages(options: DeriveStatutoryWagesOptions): MoneyValue {
	const cashForWork = options.payments
		.filter((payment) => payment.category === 'CASH_FOR_WORK')
		.reduce((total, payment) => total + payment.amount, 0);
	return {
		value: options.baseSalary.value + cashForWork,
		currency: options.baseSalary.currency
	};
}

/**
 * The subset of the snapshot's overtime-coverage member the test actually reads.
 *
 * `wage_basis` and `category_basis` are `string`, not their enums, because that is how an enum
 * column arrives from the database — and a row written under an older definition can legitimately
 * carry a value this build has never heard of. Narrowing happens below, where an unrecognised value
 * is a named fault rather than a silent fallthrough to whichever arm the comparison happened to miss.
 */
const CoverageRuleSchema = Schema.Struct({
	wage_ceiling: Schema.NullOr(MoneyValueSchema),
	ceiling_is_inclusive: Schema.NullOr(Schema.Boolean),
	wage_basis: Schema.NullOr(Schema.String),
	category_basis: Schema.NullOr(Schema.String),
	exempt_categories: Schema.NullOr(Schema.Array(Schema.String)),
	excluded_categories: Schema.NullOr(Schema.Array(Schema.String)),
	authority: Schema.String
});
type CoverageRule = Schema.Schema.Type<typeof CoverageRuleSchema>;

const WAGE_BASES: readonly WageBasis[] = ['STATUTORY_WAGES', 'BASE_SALARY'];
const CATEGORY_BASES: readonly CategoryBasis[] = ['STATUTORY_WORK_CATEGORY', 'WORK_CLASSIFICATION'];

const CoverageSubjectSchema = Schema.Struct({
	statutoryWorkCategory: Schema.NullOr(Schema.String),
	workClassification: Schema.NullOr(Schema.String),
	/**
	 * The wage figures the caller was able to resolve, each filed under the basis it genuinely is.
	 *
	 * A caller must never file a base-salary number under `STATUTORY_WAGES` to make a rule evaluate.
	 * Statutory wages are normally wider than basic pay, so the substitution moves the boundary and
	 * changes who is covered — see `UNDETERMINED` below, which exists precisely so that this is
	 * reported rather than papered over.
	 */
	wages: Schema.Struct({
		STATUTORY_WAGES: Schema.optional(MoneyValueSchema),
		BASE_SALARY: Schema.optional(MoneyValueSchema)
	})
});
type CoverageSubject = Schema.Schema.Type<typeof CoverageSubjectSchema>;

const CoverageDecisionSchema = Schema.Union([
	Schema.Struct({
		outcome: Schema.Literal('COVERED'),
		reason: Schema.Literals(['NO_RULE', 'EXEMPT_CATEGORY', 'NO_WAGE_CEILING', 'WITHIN_CEILING'])
	}),
	Schema.Struct({
		outcome: Schema.Literal('NOT_COVERED'),
		reason: Schema.Literals(['EXCLUDED_CATEGORY', 'ABOVE_CEILING'])
	}),
	Schema.Struct({
		outcome: Schema.Literal('UNDETERMINED'),
		reason: Schema.Literals(['WAGE_BASIS_UNAVAILABLE', 'CEILING_CURRENCY_MISMATCH']),
		requiredBasis: WageBasisSchema
	})
]);
type CoverageDecision = Schema.Schema.Type<typeof CoverageDecisionSchema>;

/**
 * The one coverage rule effective for a jurisdiction, or null when none is.
 *
 * Null is a real answer and means universal coverage: a jurisdiction that imposes no coverage
 * restriction is not a jurisdiction where nobody is covered.
 */
export function coverageRuleFor<T extends CoverageRule>(rules: readonly T[]): T | null {
	if (rules.length > 1)
		throw new Error('More than one overtime coverage rule is effective for this jurisdiction.');
	return rules[0] ?? null;
}

function categoryOf(rule: CoverageRule, subject: CoverageSubject): string | null {
	const basis = CATEGORY_BASES.find((candidate) => candidate === rule.category_basis);
	if (basis == null)
		throw new Error(
			`Overtime coverage rule "${rule.authority}" names categories from ` +
				`"${rule.category_basis ?? 'nothing'}", which is not an employment column this engine reads.`
		);
	return basis === 'STATUTORY_WORK_CATEGORY'
		? subject.statutoryWorkCategory
		: subject.workClassification;
}

/**
 * Decide whether the statutory overtime ladder covers one person.
 *
 * Order matters and is not arbitrary. A statute that disapplies a whole Part to a class of worker
 * outranks any wage test, so exclusions are read first; category exemptions are read next because
 * they are written "irrespective of the amount of wages he earns"; only then does the ceiling apply.
 */
export function decideOvertimeCoverage(
	rule: CoverageRule | null,
	subject: CoverageSubject
): CoverageDecision {
	if (rule == null) return { outcome: 'COVERED', reason: 'NO_RULE' };

	const category = categoryOf(rule, subject);
	if (category != null && (rule.excluded_categories ?? []).includes(category))
		return { outcome: 'NOT_COVERED', reason: 'EXCLUDED_CATEGORY' };
	if (category != null && (rule.exempt_categories ?? []).includes(category))
		return { outcome: 'COVERED', reason: 'EXEMPT_CATEGORY' };

	const ceiling = rule.wage_ceiling;
	if (ceiling == null) return { outcome: 'COVERED', reason: 'NO_WAGE_CEILING' };

	// A ceiling with no basis or no inclusivity is unusable, not merely incomplete: there is no
	// defensible default for either, so guessing one would decide pay from a coin toss.
	const basis = WAGE_BASES.find((candidate) => candidate === rule.wage_basis);
	if (basis == null)
		throw new Error(
			`Overtime coverage rule "${rule.authority}" sets a wage ceiling but names no wage basis this ` +
				`engine reads (got "${rule.wage_basis ?? 'nothing'}"), so there is no figure to compare it against.`
		);
	if (rule.ceiling_is_inclusive == null)
		throw new Error(
			`Overtime coverage rule "${rule.authority}" sets a wage ceiling but does not say whether ` +
				'the ceiling amount itself is covered.'
		);

	const wages = subject.wages[basis];
	// The engine could not produce the figure the statute names. Reporting that is the whole point:
	// comparing the nearest available column instead would move the boundary silently.
	if (wages == null)
		return {
			outcome: 'UNDETERMINED',
			reason: 'WAGE_BASIS_UNAVAILABLE',
			requiredBasis: basis
		};
	if (wages.currency !== ceiling.currency)
		return {
			outcome: 'UNDETERMINED',
			reason: 'CEILING_CURRENCY_MISMATCH',
			requiredBasis: basis
		};

	const within = rule.ceiling_is_inclusive
		? wages.value <= ceiling.value
		: wages.value < ceiling.value;
	return within
		? { outcome: 'COVERED', reason: 'WITHIN_CEILING' }
		: { outcome: 'NOT_COVERED', reason: 'ABOVE_CEILING' };
}
