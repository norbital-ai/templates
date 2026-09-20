/**
 * Step 6 — CONTRIBUTE.
 *
 * A scheme is one CEL formula, `assessed_on`, and an ordered ladder of `when → employee, employer`
 * rules. The engine accumulates the payslip's reserved magnitudes and code map once
 * (ACCUMULATE), evaluates the formula for each scheme in dependency order, applies the `MONTH`
 * scaling and the `NOT_REGISTERED` standing as they were applied to a hand-assembled base, and
 * hands `base` to the ladder unchanged. Base transform, relief, household share, rounding,
 * withholding threshold and annualisation are expressions inside the rules; the engine has no mode
 * of its own.
 *
 * A read of `produced.<code>.employee` is a relief read: the engine supplies the producer's
 * relievable amount for this consumer — year to date plus this period, capped by the producer's
 * annual cap within its shared pool, projected over the payslips still to run when the producer
 * declares `project_relief_annually`, and floored at zero so a consumer never reads a negative
 * relief in the producer's refund month. `produced.<code>.employee_this_period` is this period's
 * employee share alone, for a withholding table applied period by period.
 * `produced.<code>.employer` is the plain employer share.
 * The mention is also the dependency; `orderSchemes` has already computed the producers.
 *
 * A scheme whose employment is NOT_REGISTERED charges zero and feeds nothing. A scheme no rule
 * matches charges zero too — a ladder that covers nobody pays nobody, and the golden suites are
 * the guard against a mis-transcribed table.
 *
 * A directed instalment is the one thing added **after** the ladder: a Form CP38 direction names
 * one employee, an amount and a run of months, and the employer withholds it beside the scheme's
 * own charge. It is a fact of the employment under its scheme, never a formula's business, and
 * `directed` carries it apart from the ladder's share.
 */

import { refuse } from '@norbital-ai/bolt/authoring';
import { assessedOnMentions } from '../../../lib/expressions/compile.js';
import { requireFactValues, resolveFactValues } from '../../../lib/declared-facts.js';
import { deductionTotals } from '../../../lib/statutory-deductions.js';
import {
	CATALOGUE_WORDS,
	openKeyMentions,
	type CatalogueWord
} from '../../../lib/expressions/contexts.js';
import {
	evaluateBoolean,
	evaluateNumber,
	runtimeExpressionEngine,
	type ExpressionEngine
} from '../../../lib/expressions/evaluate.js';
import {
	catalogueWords,
	countsToward,
	sumAccumulations,
	WORD_FAMILY,
	type AccumulatedPayslip,
	type QuantityPayment,
	type AccumulationLine,
	type ContributionLine,
	type MonthPrior,
	type CompanyMonthPrior
} from './accumulate.js';
import type { ContributionConfig, ContributionRule } from './configuration.js';
import { addDays, completedMonths, inclusiveDays, monthBounds, monthDay } from './dates.js';
import { producedMentions, producedMentionsOf } from './mentions.js';
import type { PersonContext } from './eligibility.js';
import type { PayProjection } from './period.js';
import { cents } from './rounding.js';
import type { StatutoryFactStatus } from '../../../datatypes/statutory_fact_status/+definition.js';
import type {
	AssessmentFrequency,
	StatutoryHistorySummary
} from '../../../lib/payroll/statutory-history.js';

/**
 * The one rule of a scheme that governs, or null when none does: rules are read in declaration
 * order, the first whose `when` holds — exactly how a statute writes its table ("wages exceeding
 * X but not exceeding Y"), so the seeded order is the published order. A ladder no member of which
 * holds charges nothing.
 */
export function selectRule(
	rules: readonly ContributionRule[],
	context: Record<string, unknown>,
	engine: ExpressionEngine
): ContributionRule | null {
	for (const rule of rules) if (evaluateBoolean(engine, rule.when, context)) return rule;
	return null;
}

export type { StatutoryFactStatus } from '../../../datatypes/statutory_fact_status/+definition.js';

/** One `produced.<code>` read a charge made, as the calculation trace records it. */
type ContributionRead = {
	readonly code: string;
	readonly employee_amount: number;
	readonly ordinary_employee_amount?: number;
	readonly employer_amount: number;
};

export type ContributionCharge = {
	readonly contribution: ContributionConfig;
	readonly base: number;
	/** The ordinary part of the base, where the scheme states `ordinary_on`. */
	readonly ordinary?: number;
	readonly employee: number;
	readonly employer: number;
	readonly assessmentFrequency: AssessmentFrequency;
	/** The directed instalments added after the ladder; already inside `employee`. */
	readonly directed: number;
	readonly rebate?: number;
	/** The `when` expression of the rule that governed, or null where none held. */
	readonly ruleReference: string | null;
	readonly firstContributionDueOn?: string;
	/** The priced lines the `assessed_on` formula selected, for the run's calculation trace. */
	readonly inputs: readonly ContributionLine[];
	/** The producer reads this charge made, in first-mention order. */
	readonly reads: readonly ContributionRead[];
	/**
	 * Per-contract assessment where one person's contracts are charged together: each contract's
	 * own formula result and the lines it selected, in contract order. Absent for one contract.
	 */
	readonly parts?: readonly {
		readonly base: number;
		readonly ordinary?: number;
		readonly inputs: readonly ContributionLine[];
	}[];
};

/** Everything a scheme's expressions read about the person, the period and the year. */
type SchemeAssessment = {
	/** `contribution_id` → the employment's registration, or `null` where no row exists. */
	readonly facts: ReadonlyMap<string, StatutoryFactStatus>;
	/** Dated registration intervals for schemes measuring insurance coverage independently of pay. */
	readonly coverageByScheme?: ReadonlyMap<
		string,
		readonly { readonly start: string; readonly end: string | null }[]
	>;
	/** `contribution_code` → what has already been charged this tax year. */
	readonly yearToDate: (code: string) => {
		employee: number;
		employer: number;
		base: number;
		ordinary: number;
		rebate?: number;
	};
	/** component code → what earlier PAID payslips earned this tax year (BASIC always present). */
	readonly yearEarned: ReadonlyMap<string, number>;
	/** Scheme code → earlier paid assessments plus the selected prior-employer opening. */
	readonly history: (code: string) => StatutoryHistorySummary;
	readonly yearQuantityPayments?: ReadonlyMap<string, readonly QuantityPayment[]>;
	/** component code → its catalogue family and memberships, for `year.<WORD>` over the year's codes. */
	readonly componentsByCode?: ReadonlyMap<
		string,
		{ readonly family: string; readonly counts_toward?: readonly string[] }
	>;
	/** calendar month → component code → what earlier payslips earned; `earned_average` reads it. */
	readonly earnedByMonth?: ReadonlyMap<string, ReadonlyMap<string, number>>;
	/** The month's earlier instalments (semi-monthly, weekly): a MONTH scheme prices the month on their sum. */
	readonly monthPrior?: MonthPrior;
	readonly monthlyContributionDays?: {
		readonly employed: number;
		readonly unpaid: number;
		readonly fullyUnpaid: number;
		readonly leaveDays: Readonly<Record<string, number>>;
		readonly fullLeaveDays: Readonly<Record<string, number>>;
		readonly working: number;
	};
	/** The period being settled: the shared six-member root. */
	readonly period: {
		readonly key: string;
		readonly start: string;
		readonly end: string;
		readonly index: number;
		readonly instalments: number;
		readonly lastOfYear: boolean;
		/**
		 * Which instalment of a month carries a MONTH-assessed scheme's whole premium: the first, the
		 * last, or each its own share (`SPLIT`). The entity's `semi_monthly_statutory_cutoff`.
		 */
		readonly monthlyOn: 'FIRST' | 'SPLIT' | 'LAST';
		/** What this instalment's base is multiplied by to state the month's: 2 for a half, 52/12 for a week. */
		readonly monthFactor?: number;
		/**
		 * The days of the pay month the employment covered, in the proration basis's own units — the
		 * sum of the payslip's proration segments. Statutory coverage calendars are separate:
		 * `coverage_days_30` measures a thirty-day insurance month independently of wage proration.
		 */
		readonly daysEmployed: number;
		readonly daysInMonth: number;
	};
	/** The payroll currency every charge is rounded to the minor unit of. */
	readonly currency: string;
	/** The tax year the period sits in, for this employee. */
	readonly year: {
		readonly start: string;
		readonly end: string;
		readonly months_employed: number;
	};
	/** How far this payslip projects: the payslips left in the year, and the size of the year after it. */
	readonly projection: PayProjection;
	/** The person, as a scheme's or rule's expression sees them. */
	readonly person: PersonContext;
	/** The contract's standing allowances counting toward one scheme; absent, the person's figure stands. */
	readonly fixedAllowancesFor?: (scheme: string) => number;
	/** The company region's minimum wage, or null where the version states none for it. */
	readonly minimumWage: number | null;
	/** Whether the version's wages order covers this person; `wage_floor` is 0 when it does not. */
	readonly minimumWageApplies?: boolean;
};

type ContributeInput = SchemeAssessment & {
	readonly accumulation: AccumulatedPayslip;
	readonly contributions: readonly ContributionConfig[];
	/** Each contract's own accumulation, where several are charged together. */
	readonly parts?: readonly AccumulatedPayslip[];
};

/** Everything one scheme produced, so the schemes that read it can find it. */
type Produced = {
	/** The base the charge was assessed on, 0 where no rule held. */
	readonly base: number;
	readonly employee: number;
	/** The contribution on ordinary remuneration, before any additional payment. */
	readonly ordinaryEmployee?: number;
	readonly employer: number;
};

/** Whether any expression reads the regional minimum wage or its floor, so a version without one stops the run. */
function mentionsMinimumWage(expressions: readonly string[]) {
	return expressions.some(
		(expression) => expression.includes('minimum_wage(') || expression.includes('wage_floor')
	);
}

/**
 * The relievable amount of every producer this scheme names.
 *
 * The pools are deliberately **asymmetric**, and that asymmetry is the law rather than an
 * oversight: a retirement-fund relief is projected across the months still to run, because the
 * employee will certainly keep contributing, while a social-security relief counts only what has
 * actually been paid. Projecting both would overstate relief by up to eleven months' worth early in
 * the year and change the tax of every mid-band employee.
 *
 * A shared cap applies to the pool's total; the total is then distributed across the producers in
 * proportion to their relievable shares, so the consumer's sum of the reads is exactly the capped
 * pool. A producer in its refund month reads floor at zero.
 */
function reliefReads(options: {
	readonly input: SchemeAssessment;
	readonly contribution: ContributionConfig;
	readonly produced: ReadonlyMap<string, Produced>;
	readonly byCode: ReadonlyMap<string, ContributionConfig>;
	readonly normalOnly?: boolean;
}): ReadonlyMap<string, number> {
	const { input, contribution, produced, byCode } = options;
	type Pool = { codes: string[]; weights: number[]; total: number; cap: number | null };
	const pools = new Map<string, Pool>();
	for (const code of producedMentions(contribution.row.rules, contribution.row.assessed_on ?? '')) {
		const other = byCode.get(code);
		const result = produced.get(code);
		if (other == null || result == null) continue;
		const row = other.row;
		const priorEmployee = input.yearToDate(code).employee;
		const ordinaryEmployee = result.ordinaryEmployee ?? result.employee;
		const current =
			options.normalOnly && row.project_relief_annually ? ordinaryEmployee : result.employee;
		let relievable = Math.max(0, priorEmployee + current);
		if (row.project_relief_annually && row.employee_share_annual_cap != null) {
			const future = Math.max(0, input.projection.futurePayslipEquivalents);
			const remainingCap = Math.max(
				0,
				Math.min(row.employee_share_annual_cap, row.employee_share_annual_cap - relievable)
			);
			if (future > 0)
				relievable += Math.min(Math.max(0, ordinaryEmployee), remainingCap / future) * future;
		}
		const poolKey = row.shared_cap_group ?? code;
		const pool = pools.get(poolKey) ?? {
			codes: [],
			weights: [],
			total: 0,
			cap: row.employee_share_annual_cap
		};
		pool.codes.push(code);
		pool.weights.push(relievable);
		pool.total += relievable;
		pool.cap =
			pool.cap == null
				? row.employee_share_annual_cap
				: row.employee_share_annual_cap == null
					? pool.cap
					: Math.min(pool.cap, row.employee_share_annual_cap);
		pools.set(poolKey, pool);
	}
	const reads = new Map<string, number>();
	for (const pool of pools.values()) {
		const capped = pool.cap == null ? pool.total : Math.min(pool.total, pool.cap);
		const totalWeight = pool.weights.reduce((sum, weight) => sum + weight, 0);
		pool.codes.forEach((code, index) => {
			const weight = pool.weights[index]!;
			reads.set(code, totalWeight === 0 ? 0 : (capped * weight) / totalWeight);
		});
	}
	return reads;
}

/** Allocate an annual unit exemption at each payment's own rate, in payment order. */
function quantityExemption(payments: readonly QuantityPayment[], limit: number) {
	let quantity = 0;
	let amount = 0;
	for (const payment of payments) {
		if (
			payment.quantity == null ||
			!Number.isFinite(payment.quantity) ||
			!(payment.quantity > 0) ||
			!Number.isFinite(payment.amount) ||
			payment.amount < 0 ||
			(payment.rate != null && (!Number.isFinite(payment.rate) || payment.rate < 0))
		)
			throw new Error(
				'Leave tax exemption requires positive paid day quantities and nonnegative valuations; reconcile reversals before payroll.'
			);
		const days = Math.min(payment.quantity, Math.max(0, limit - quantity));
		amount += Math.min(payment.amount, days * (payment.rate ?? payment.amount / payment.quantity));
		quantity += payment.quantity;
	}
	return { quantity, amount };
}

/** The engine one assessment evaluates with: the region's wage and the payslip's own money. */
function engineFor(
	input: Pick<SchemeAssessment, 'minimumWage' | 'earnedByMonth' | 'period' | 'person'> &
		Partial<
			Pick<
				SchemeAssessment,
				'yearEarned' | 'componentsByCode' | 'yearQuantityPayments' | 'year' | 'coverageByScheme'
			>
		>,
	accumulation: AccumulatedPayslip,
	schemeId?: string
): ExpressionEngine {
	return runtimeExpressionEngine({
		minimumWage: () => input.minimumWage ?? 0,
		coverageDays30: (since, age) => {
			const born = input.person.employee.birth_date;
			const ends = [input.person.employment.exit_date].filter((date) => date !== '');
			if (born !== '' && age > 0)
				ends.push(
					addDays(
						monthDay(
							Number(born.slice(0, 4)) + age,
							Number(born.slice(5, 7)) - 1,
							Number(born.slice(8, 10))
						),
						-1
					)
				);
			const periods = input.coverageByScheme?.get(schemeId ?? '') ?? [{ start: since, end: null }];
			const days = new Set<number>();
			for (const covered of periods) {
				const start = [
					input.period.start,
					input.person.employment.service_start,
					since,
					covered.start
				]
					.sort()
					.at(-1)!;
				const termination = [...ends, ...(covered.end == null ? [] : [covered.end])].sort()[0];
				const end =
					termination != null && termination <= input.period.end ? termination : input.period.end;
				if (start > end) continue;
				// Continuing cover runs to day 30, including February. A termination uses its
				// actual day, capped at 30; joining on the 31st counts as joining on day 30.
				const last =
					termination != null && termination <= input.period.end
						? Math.min(30, Number(end.slice(8, 10)))
						: 30;
				for (let day = Math.min(30, Number(start.slice(8, 10))); day <= last; day += 1)
					days.add(day);
			}
			return days.size;
		},
		// The pay window's days before the person's birthday of that age: the whole window with no
		// birth date on record, none once the birthday is past.
		daysUnder: (age) => {
			const born = input.person.employee.birth_date;
			const hired = input.person.employment.service_start;
			const exited = input.person.employment.exit_date;
			const start = hired > input.period.start ? hired : input.period.start;
			const end = exited !== '' && exited < input.period.end ? exited : input.period.end;
			if (start > end) return 0;
			if (born === '' || !(age > 0)) return inclusiveDays(start, end);
			const birthday = addDays(
				monthDay(
					Number(born.slice(0, 4)) + age,
					Number(born.slice(5, 7)) - 1,
					Number(born.slice(8, 10))
				),
				-1
			);
			return birthday < start ? 0 : inclusiveDays(start, birthday < end ? birthday : end);
		},
		code: (code) => accumulation.codes.get(code) ?? 0,
		annualQuantityExempt: (code, limit) => {
			const prior = quantityExemption(input.yearQuantityPayments?.get(code) ?? [], limit);
			const payments = accumulation.lines
				.filter((line) => line.reserved === 'ENCASHMENT' && `${line.code}_ENCASHMENT` === code)
				.map((line) => ({
					quantity: line.quantity ?? null,
					rate: line.rate ?? null,
					amount: line.amount
				}));
			return quantityExemption(payments, Math.max(0, limit - prior.quantity)).amount;
		},
		earnedQuantityExempt: (code, limit) =>
			quantityExemption(input.yearQuantityPayments?.get(code) ?? [], limit).amount,
		earnedMonthlyExcess: (code, limit) => {
			let excess = 0;
			for (const [month, codes] of input.earnedByMonth ?? []) {
				if (
					input.year == null ||
					month < input.year.start.slice(0, 7) ||
					month > input.year.end.slice(0, 7)
				)
					continue;
				excess += Math.max(0, (codes.get(code) ?? 0) - limit);
			}
			return excess;
		},
		earnedAverage: (code, monthsBack, months) =>
			earnedAverage(input.earnedByMonth ?? new Map(), input.period.key, code, monthsBack, months)
	});
}

/**
 * The catalogue words over the tax year's earlier PAID payslips: `year.ALLOWANCES`,
 * `year.<PART>.ALLOWANCES`, the same memberships read off the year's codes.
 */
function yearCatalogueWords(
	input: Pick<SchemeAssessment, 'yearEarned' | 'componentsByCode'>,
	scheme: string,
	parts: readonly string[]
): Record<string, number | Record<CatalogueWord, number>> {
	const sum = (word: CatalogueWord, part: string | null): number => {
		let total = 0;
		for (const [code, amount] of input.yearEarned ?? []) {
			const component = input.componentsByCode?.get(code);
			if (component == null || component.family !== WORD_FAMILY[word]) continue;
			if (!countsToward(component.counts_toward, scheme, part)) continue;
			total += amount;
		}
		return total;
	};
	const words: Record<string, number | Record<CatalogueWord, number>> = {};
	for (const word of CATALOGUE_WORDS) words[word] = sum(word, null);
	for (const part of parts)
		words[part] = Object.fromEntries(
			CATALOGUE_WORDS.map((word) => [word, sum(word, part)])
		) as Record<CatalogueWord, number>;
	return words;
}

/**
 * The average of one component's earnings over `months` calendar months, the window ending
 * `monthsBack` months before the period's month; 0 where no earlier payslip falls in the window
 * (a formula falls back to the contract). Months inside the window with no payslip count as 0.
 */
export function earnedAverage(
	earnedByMonth: ReadonlyMap<string, ReadonlyMap<string, number>>,
	periodKey: string,
	code: string,
	monthsBack: number,
	months: number
): number {
	if (!(months > 0)) return 0;
	const year = Number(periodKey.slice(0, 4));
	const month = Number(periodKey.slice(5, 7));
	let total = 0;
	let present = 0;
	for (let offset = 0; offset < months; offset += 1) {
		const index = year * 12 + (month - 1) - monthsBack - offset;
		const key = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
		const byCode = earnedByMonth.get(key);
		if (byCode == null) continue;
		present += 1;
		total += byCode.get(code) ?? 0;
	}
	return present === 0 ? 0 : total / months;
}

/** Every expression of one scheme, for the context keys it names. */
export const schemeExpressions = (contribution: ContributionConfig): string[] => [
	contribution.row.assessed_on ?? '',
	contribution.row.ordinary_on ?? '',
	...contribution.row.elections.flatMap((field) => [
		field.valid_when ?? '',
		field.required_when ?? ''
	]),
	...contribution.row.rules.flatMap((rule) => [
		rule.when,
		rule.employee,
		rule.employer,
		rule.rebate ?? '0.0',
		rule.deduction ?? '0.0'
	])
];

function requireSchemeFacts(
	contribution: ContributionConfig,
	status: StatutoryFactStatus | undefined,
	context: Record<string, unknown>,
	engine: ExpressionEngine
): void {
	if (status?.kind === 'NOT_REGISTERED') return;
	requireFactValues(
		contribution.row.elections,
		status?.elections ?? {},
		contribution.row.code,
		(expression) => evaluateBoolean(engine, expression, context)
	);
}

/** The scheme root of one scheme's context. */
function schemeObject(options: {
	readonly input: SchemeAssessment;
	readonly contribution: ContributionConfig;
	readonly status: StatutoryFactStatus | undefined;
}): Record<string, unknown> {
	const { input, contribution, status } = options;
	const registered = status?.kind === 'REGISTERED' ? status : null;
	const elections = resolveFactValues(
		contribution.row.elections,
		registered?.elections ?? {},
		contribution.row.code,
		status?.kind !== 'NOT_REGISTERED'
	);
	const childClaims: Record<string, number> = Object.fromEntries(
		schemeExpressions(contribution).flatMap((expression) =>
			openKeyMentions(expression, 'scheme.child_claims').map((key) => [key, 0])
		)
	);
	for (const claim of registered?.child_claims ?? []) {
		if (claim.year !== input.year.start.slice(0, 4)) continue;
		childClaims[claim.relief_class] = claim.full_count + claim.half_count / 2;
	}
	const deductions = deductionTotals(
		registered?.deduction_claims ?? [],
		input.year.start,
		input.period.key
	);
	for (const [prefix, amounts] of Object.entries(deductions))
		for (const expression of schemeExpressions(contribution))
			for (const key of openKeyMentions(expression, `scheme.${prefix}`)) amounts[key] ??= 0;
	const since = registered?.since ?? '';
	return {
		code: contribution.row.code,
		assessment_period: contribution.row.assessment_period,
		year_to_date: { rebate: 0, ...input.yearToDate(contribution.row.code) },
		projection: {
			payslips_remaining: input.projection.payslipsRemaining,
			future_equivalents: input.projection.futurePayslipEquivalents
		},
		rate_override: registered?.rate_override ?? 0,
		since,
		first_contribution_due_on: registered?.first_contribution_due_on ?? '',
		since_months:
			since === '' || since > input.period.end ? 0 : completedMonths(since, input.period.end),
		election_keys: Object.keys(registered?.elections ?? {}),
		elections,
		child_claims: childClaims,
		...deductions
	};
}

/**
 * The `produced` object one scheme's expressions read, seeded from the producers already charged.
 *
 * An uncapped producer's `employee` read is its year to date plus this period, which is what the
 * year-end rungs annualise; a capped one is the relievable share the pool rules compute.
 */
function producedObject(
	produced: ReadonlyMap<string, Produced>,
	reads: ReadonlyMap<string, number>,
	codes: readonly string[],
	ordinaryReads: ReadonlyMap<string, number>
): Record<string, Record<string, unknown>> {
	const object: Record<string, Record<string, unknown>> = {};
	for (const code of codes) {
		const result = produced.get(code) ?? { base: 0, employee: 0, employer: 0 };
		object[code] = {
			// The assessed base before instalment allocation, so a threshold reads the full
			// insured grade even where the current deduction is a half or a reconciliation.
			base: result.base,
			employee: reads.get(code) ?? Math.max(0, result.employee),
			employee_normal: ordinaryReads.get(code) ?? reads.get(code) ?? Math.max(0, result.employee),
			// This period's own share, never the year's: a per-period withholding table (PH Annex E,
			// VN art.7) relieves the contribution deducted from this pay, and the annual read above
			// would relieve January's SSS again in February and every month after.
			employee_this_period: Math.max(0, result.employee),
			employer: result.employer
		};
	}
	return object;
}

/**
 * The context one scheme's expressions evaluate against. Built from the expressions themselves:
 * a `produced.<code>` or `year.earned.<code>` mention the version does not otherwise supply is
 * seeded at zero, so a legal read of a scheme or code answers rather than throwing.
 */
function schemeContext(options: {
	readonly input: SchemeAssessment;
	readonly contribution: ContributionConfig;
	readonly status?: StatutoryFactStatus | undefined;
	readonly expressions: readonly string[];
	readonly produced?: ReadonlyMap<string, Produced>;
	readonly reads?: ReadonlyMap<string, number>;
	readonly ordinaryReads?: ReadonlyMap<string, number>;
}): Record<string, unknown> {
	const { input, contribution } = options;
	const expressions = options.expressions;
	const producedCodes = [
		...new Set(expressions.flatMap((expression) => producedMentionsOf(expression)))
	];
	const yearEarned: Record<string, number> = { BASIC: 0 };
	for (const [code, amount] of input.yearEarned) yearEarned[code] = amount;
	const history = Object.fromEntries(
		[...new Set(expressions.flatMap((expression) => openKeyMentions(expression, 'history')))].map(
			(code) => [
				code,
				(() => {
					const value = input.history(code);
					return {
						...value,
						has_opening: value.hasOpening,
						periods_recorded: value.periodsRecorded
					};
				})()
			]
		)
	);
	const person = structuredClone(input.person) as PersonContext & {
		company: { facts: Record<string, unknown> };
		terms: { basic_salary: number; fixed_allowances: number; monthly_wage: number };
	};
	if (input.fixedAllowancesFor != null) {
		const fixed = input.fixedAllowancesFor(contribution.row.code);
		person.terms.fixed_allowances = fixed;
		person.terms.monthly_wage = person.terms.basic_salary + fixed;
	}
	for (const expression of expressions) {
		for (const code of assessedOnMentions(expression).yearEarned)
			if (!(code in yearEarned)) yearEarned[code] = 0;
		// Resolved facts contain every declared key. A missing key is a catalogue defect.
		for (const key of openKeyMentions(expression, 'person.company.facts'))
			if (!Object.hasOwn(person.company.facts, key))
				refuse(
					`${contribution.row.code}: entity input ${key} is not declared in this settings version.`
				);
		for (const key of openKeyMentions(expression, 'company.facts'))
			if (!Object.hasOwn(person.company.facts, key))
				refuse(
					`${contribution.row.code}: entity input ${key} is not declared in this settings version.`
				);
	}
	return {
		person,
		period: {
			key: input.period.key,
			start: input.period.start,
			end: input.period.end,
			month: Number(input.period.key.slice(5, 7)),
			index: input.period.index,
			instalments: input.period.instalments,
			month_factor: input.period.monthFactor ?? input.period.instalments,
			last_of_year: input.period.lastOfYear,
			days_employed: input.period.daysEmployed,
			days_in_month: input.period.daysInMonth
		},
		year: {
			...input.year,
			earned: yearEarned,
			...yearCatalogueWords(input, contribution.row.code, contribution.row.parts ?? [])
		},
		scheme: schemeObject({ input, contribution, status: options.status }),
		produced: producedObject(
			options.produced ?? new Map(),
			options.reads ?? new Map(),
			producedCodes,
			options.ordinaryReads ?? new Map()
		),
		history
	};
}

/**
 * The value of one scheme's `assessed_on` over one accumulation, and the lines the formula
 * selected. Clamped at zero: a base is a quantity of chargeable wages, and there is no negative
 * wage. Evaluated inside the ordered loop, so a formula may read `produced.<code>` of the schemes
 * already charged — an employer premium taxed as the employee's income.
 */
function assessedBase(options: {
	readonly input: SchemeAssessment;
	readonly contribution: ContributionConfig;
	readonly accumulation: AccumulatedPayslip;
	readonly produced: ReadonlyMap<string, Produced>;
	readonly reads: ReadonlyMap<string, number>;
	readonly ordinaryReads?: ReadonlyMap<string, number>;
}): { readonly base: number; readonly selected: readonly AccumulationLine[] } {
	const expression = (options.contribution.row.assessed_on ?? '').trim();
	if (expression === '') return { base: 0, selected: [] };
	const status = options.input.facts.get(options.contribution.row.id);
	const context = {
		...schemeContext({
			input: options.input,
			contribution: options.contribution,
			status,
			expressions: [expression],
			produced: options.produced,
			reads: options.reads,
			ordinaryReads: options.ordinaryReads
		}),
		// The six reserved lines are magnitudes; the formula writes their sign.
		BASE: options.accumulation.reserved.BASE,
		OVERTIME: options.accumulation.reserved.OVERTIME,
		NIGHT_PREMIUM: options.accumulation.reserved.NIGHT_PREMIUM,
		OVERTIME_PREMIUM: options.accumulation.reserved.OVERTIME_PREMIUM,
		ABSENCE: options.accumulation.reserved.ABSENCE,
		NO_PAY_LEAVE: options.accumulation.reserved.NO_PAY_LEAVE,
		ENCASHMENT: options.accumulation.reserved.ENCASHMENT,
		INCENTIVE: options.accumulation.reserved.INCENTIVE,
		// The catalogue words, pre-aggregated for this scheme: what its classes count toward.
		...catalogueWords(
			options.accumulation,
			options.contribution.row.code,
			options.contribution.row.parts ?? []
		)
	};
	const value = evaluateNumber(
		engineFor(options.input, options.accumulation, options.contribution.row.id),
		expression,
		context
	);
	return {
		base: cents(Math.max(0, value), options.input.currency),
		selected: selectedLines(expression, options.accumulation, options.contribution.row.code)
	};
}

/** The lines one formula selected, for the calculation trace. */
function selectedLines(
	expression: string,
	accumulation: AccumulatedPayslip,
	scheme: string
): readonly AccumulationLine[] {
	const mentions = assessedOnMentions(expression);
	const reserved = new Set(mentions.reserved);
	// A word names a catalogue and, through a part, which of its members: `ORDINARY.ALLOWANCES`
	// selects the allowance lines counting toward this scheme as ORDINARY. The year's forms name
	// earlier payslips, not this one's lines.
	const words = mentions.words
		.filter((word) => !word.startsWith('year.'))
		.map((word) => {
			const [head, tail] = word.split('.');
			return tail == null
				? { word: head as CatalogueWord, part: null }
				: { word: tail as CatalogueWord, part: head! };
		});
	return accumulation.lines.filter((line) => {
		if (line.reserved != null) return reserved.has(line.reserved);
		if (mentions.codes.includes(line.code)) return true;
		return words.some(
			({ word, part }) =>
				WORD_FAMILY[word] === line.family &&
				countsToward(accumulation.countsTowardOf.get(line.code), scheme, part)
		);
	});
}

/** The directed instalments covering this period, as the authority's direction names them. */
function directedFor(
	status: StatutoryFactStatus | undefined,
	periodKey: string,
	currency: string,
	collected: number
): number {
	if (status?.kind !== 'REGISTERED' || status.instalments == null) return 0;
	const month = periodKey.slice(0, 7);
	return cents(
		Math.max(
			0,
			status.instalments
				.filter((row) => row.from <= month && month <= row.to)
				.reduce((sum, row) => sum + row.amount, 0) - collected
		),
		currency
	);
}

/** A selected rule may require missing facts; its deduction is computed before its charge. */
function selectedRuleContext(
	rule: ContributionConfig['rules'][number],
	context: Record<string, unknown>,
	engine: ExpressionEngine,
	code: string
): Record<string, unknown> {
	if (rule.refusal != null) refuse(`${code}: ${rule.refusal}`);
	const deduction = rule.deduction == null ? 0 : evaluateNumber(engine, rule.deduction, context);
	if (!Number.isFinite(deduction) || deduction < 0)
		refuse(`${code} deduction must be finite and nonnegative.`);
	return { ...context, scheme: { ...(context.scheme as Record<string, unknown>), deduction } };
}

/** Estimate the month's wages before a scheme applies its monthly floor, ceiling or band. */
function scaleAccumulation(input: AccumulatedPayslip, factor: number): AccumulatedPayslip {
	return {
		...input,
		reserved: Object.fromEntries(
			Object.entries(input.reserved).map(([code, amount]) => [code, amount * factor])
		) as AccumulatedPayslip['reserved'],
		codes: new Map([...input.codes].map(([code, amount]) => [code, amount * factor])),
		lines: input.lines.map((line) => ({
			...line,
			amount: line.amount * factor,
			quantity: line.quantity == null ? line.quantity : line.quantity * factor
		}))
	};
}

/** A monthly assessment reads history through the preceding month and projects whole months. */
function monthlyAssessment(input: SchemeAssessment): SchemeAssessment {
	const month = input.period.key.slice(0, 7);
	const months = completedMonths(`${month}-01`, input.year.end) + 1;
	const monthEarned = input.earnedByMonth?.get(month);
	return {
		...input,
		period: {
			...input.period,
			...monthBounds(month),
			key: month,
			monthFactor: 1,
			daysEmployed: input.monthlyContributionDays?.employed ?? input.period.daysEmployed
		},
		person:
			input.monthlyContributionDays == null
				? input.person
				: {
						...input.person,
						period: {
							working_days: input.monthlyContributionDays.working,
							unpaid_days: input.monthlyContributionDays.unpaid,
							unpaid_full_days: input.monthlyContributionDays.fullyUnpaid,
							leave_days: input.monthlyContributionDays.leaveDays,
							leave_full_days: input.monthlyContributionDays.fullLeaveDays
						}
					},
		projection: { payslipsRemaining: months, futurePayslipEquivalents: months - 1 },
		yearToDate: (code) => {
			const year = input.yearToDate(code);
			const prior = input.monthPrior?.charged.get(code);
			return {
				employee: year.employee - (prior?.employee ?? 0),
				employer: year.employer - (prior?.employer ?? 0),
				base: year.base - (prior?.base ?? 0),
				ordinary: (year.ordinary ?? 0) - (prior?.ordinary ?? 0),
				rebate: (year.rebate ?? 0) - (prior?.rebate ?? 0)
			};
		},
		yearEarned: new Map(
			[...input.yearEarned].map(([code, amount]) => [code, amount - (monthEarned?.get(code) ?? 0)])
		),
		yearQuantityPayments: new Map(
			[...(input.yearQuantityPayments ?? [])].map(([code, payments]) => [
				code,
				payments.filter((payment) => payment.period?.slice(0, 7) !== month)
			])
		),
		earnedByMonth: new Map([...(input.earnedByMonth ?? [])].filter(([key]) => key !== month))
	};
}

export function contribute(input: ContributeInput): ContributionCharge[] {
	const charges: ContributionCharge[] = [];
	const assessmentFrequency: AssessmentFrequency =
		input.period.instalments >= 4
			? 'WEEKLY'
			: input.period.instalments === 2
				? 'SEMI_MONTHLY'
				: 'MONTHLY';
	const produced = new Map<string, Produced>();
	const monthlyProduced = new Map<string, Produced>();
	const byCode = new Map(
		input.contributions.map((contribution) => [contribution.row.code, contribution])
	);

	for (const contribution of input.contributions) {
		const code = contribution.row.code;
		// A COMPANY-scope scheme is charged once on the run, after every employment scheme; it is
		// nobody's payslip.
		if (contribution.row.assessment_scope === 'COMPANY') continue;
		const expressions = schemeExpressions(contribution);
		const status = input.facts.get(contribution.row.id);
		// A MONTH-assessed scheme is charged once, on the month's wage — the law prices SSS,
		// PhilHealth and Pag-IBIG monthly on monthly compensation and leaves the timing across
		// cut-offs to the employer. The entity says which instalment carries it (`FIRST` on the
		// mid-month cut-off, `LAST` on the end-month one); `SPLIT` divides the monthly charge.
		// The SAME rule serves any jurisdiction that states a monthly schedule at a finer cadence.
		const monthlyAssessed =
			contribution.row.assessment_period === 'MONTH' && input.period.instalments > 1;
		const finalEmploymentPeriod =
			input.person.employment.exit_date !== '' &&
			input.person.employment.exit_date <= input.period.end;
		// `FIRST`: the first instalment charges on an estimate of the month (its own wage scaled to
		// the month); every later one prices the month on what was actually paid — the earlier
		// instalments' settled lines plus its own — and charges the difference from what the earlier
		// ones took. `LAST`: nothing until the last instalment, which prices the month whole.
		const estimating =
			monthlyAssessed &&
			!finalEmploymentPeriod &&
			input.period.monthlyOn !== 'LAST' &&
			input.period.index === 1;
		const truingUp = monthlyAssessed && input.period.monthlyOn !== 'LAST' && input.period.index > 1;
		const pricingMonth =
			monthlyAssessed && (input.period.monthlyOn === 'LAST' || finalEmploymentPeriod);
		const deferred =
			pricingMonth && !finalEmploymentPeriod && input.period.index < input.period.instalments;
		const schemeInput =
			contribution.row.assessment_period === 'MONTH' ? monthlyAssessment(input) : input;
		const schemeProduced = monthlyAssessed ? monthlyProduced : produced;
		const reliefs = reliefReads({
			input: schemeInput,
			contribution,
			produced: schemeProduced,
			byCode
		});
		const ordinaryReliefs = reliefReads({
			input: schemeInput,
			contribution,
			produced: schemeProduced,
			byCode,
			normalOnly: true
		});
		// The wage a month scheme reads: the month's instalments summed where the month is priced
		// on what was paid, this instalment alone otherwise; and the month is then one period.
		const monthPrior = truingUp || pricingMonth ? input.monthPrior : undefined;
		const scale = estimating ? (input.period.monthFactor ?? input.period.instalments) : 1;
		const accumulation =
			monthPrior == null
				? scaleAccumulation(input.accumulation, scale)
				: sumAccumulations([monthPrior.accumulation, input.accumulation]);
		const schemeEngine = engineFor(
			schemeInput,
			contribution.row.assessment_period === 'MONTH' ? accumulation : input.accumulation,
			contribution.row.id
		);
		const share = deferred
			? 0
			: estimating && input.period.monthlyOn === 'SPLIT'
				? 1 / input.period.instalments
				: 1;
		const already = truingUp || pricingMonth ? monthPrior?.charged.get(code) : undefined;
		const evaluated = assessedBase({
			input: schemeInput,
			contribution,
			accumulation,
			produced: schemeProduced,
			reads: reliefs,
			ordinaryReads: ordinaryReliefs
		});
		const base = evaluated.base;
		// The ordinary part of the base, where the ceiling splits it (`ordinary_on`).
		const ordinaryOn = (contribution.row.ordinary_on ?? '').trim();
		let ordinary =
			ordinaryOn === ''
				? null
				: assessedBase({
						input: schemeInput,
						contribution: {
							...contribution,
							row: { ...contribution.row, assessed_on: ordinaryOn }
						},
						accumulation,
						produced: schemeProduced,
						reads: reliefs,
						ordinaryReads: ordinaryReliefs
					}).base;
		let ordinaryEmployee: number | undefined;
		const charge = (
			employee: number,
			employer: number,
			ruleReference: string | null,
			chargeBase: number = base,
			reads: readonly ContributionRead[] = [],
			directed = 0,
			lines: readonly ContributionLine[] = evaluated.selected,
			rebate = 0
		) => {
			produced.set(code, {
				base,
				employee: employee - directed,
				employer,
				ordinaryEmployee
			});
			if (!monthlyAssessed) {
				const prior = input.monthPrior?.charged.get(code);
				monthlyProduced.set(code, {
					base: chargeBase + (prior?.base ?? 0),
					employee: employee - directed + (prior?.employee ?? 0),
					employer: employer + (prior?.employer ?? 0),
					ordinaryEmployee
				});
			}
			charges.push({
				contribution,
				assessmentFrequency,
				base: chargeBase,
				...(ordinary == null
					? {}
					: { ordinary: cents(ordinary * share - (already?.ordinary ?? 0), input.currency) }),
				employee,
				employer,
				directed,
				rebate,
				ruleReference,
				...(status?.kind === 'REGISTERED' && status.first_contribution_due_on != null
					? { firstContributionDueOn: status.first_contribution_due_on }
					: {}),
				inputs: lines,
				reads,
				...(input.parts == null || input.parts.length < 2
					? {}
					: {
							parts: input.parts.map((part) => {
								const options = {
									input: schemeInput,
									contribution,
									accumulation: scaleAccumulation(part, scale),
									produced: schemeProduced,
									reads: reliefs,
									ordinaryReads: ordinaryReliefs
								};
								const own = assessedBase(options);
								return {
									base: own.base,
									...(ordinaryOn === ''
										? {}
										: {
												ordinary: assessedBase({
													...options,
													contribution: {
														...contribution,
														row: { ...contribution.row, assessed_on: ordinaryOn }
													}
												}).base
											}),
									inputs: own.selected
								};
							})
						})
			});
		};

		// An unregistered employment contributes nothing, and therefore also nothing to any relief
		// pool it feeds — the pool is fed by the *output*, never by a rate.
		if (status != null && status.kind === 'NOT_REGISTERED' && base > 0) {
			if (ordinary != null) ordinary = 0;
			charge(0, 0, null, 0);
			produced.set(code, { base: 0, employee: 0, employer: 0 });
			monthlyProduced.set(code, { base: 0, employee: 0, employer: 0 });
			continue;
		}
		if (
			contribution.row.project_relief_annually &&
			ordinary != null &&
			(contribution.row.parts?.length ?? 0) > 0
		) {
			for (const [component, amount] of accumulation.codes) {
				if (amount !== 0 && accumulation.countsTowardOf.get(component)?.includes(code))
					refuse(
						`${code}: classify ${component} as ordinary or additional remuneration before projecting contribution relief.`
					);
			}
		}
		// A rule or formula that names the regional minimum wage the version does not state stops the
		// run rather than charging on an unbounded base.
		if (input.minimumWage == null && mentionsMinimumWage(expressions))
			refuse(
				`${code} bounds its base by the regional minimum wage, but the company's region has ` +
					'none in this settings version. Set companies.region and jurisdiction_settings.work_rules.wages.by_region.'
			);

		let context: Record<string, unknown> = {
			...schemeContext({
				input: schemeInput,
				contribution,
				status,
				expressions,
				produced: schemeProduced,
				reads: reliefs,
				ordinaryReads: ordinaryReliefs
			}),
			base,
			// The `ordinary_on` part of this period's base, the base itself where the scheme states
			// none: a rule that prices the rest differently (MY MTD's additional remuneration) reads it.
			ordinary: ordinary ?? base
		};
		requireSchemeFacts(contribution, status, context, schemeEngine);
		const rule = selectRule(contribution.row.rules, context, schemeEngine);
		if (rule == null) {
			if (ordinary != null) ordinary = 0;
			if (already != null)
				charge(
					-already.employee,
					-already.employer,
					null,
					-already.base,
					[],
					0,
					evaluated.selected,
					-(already.rebate ?? 0)
				);
			// No rule matches: the scheme charges nothing and appears on no payslip, but a consumer
			// that names it reads zero rather than a missing row.
			produced.set(code, { base: 0, employee: 0, employer: 0 });
			continue;
		}
		context = selectedRuleContext(rule, context, schemeEngine, code);
		if (contribution.row.project_relief_annually && ordinary != null) {
			const normalContext = { ...context, base: context.ordinary };
			requireSchemeFacts(contribution, status, normalContext, schemeEngine);
			const normalRule = selectRule(contribution.row.rules, normalContext, schemeEngine);
			ordinaryEmployee =
				normalRule == null
					? 0
					: cents(
							evaluateNumber(
								schemeEngine,
								normalRule.employee,
								selectedRuleContext(normalRule, normalContext, schemeEngine, code)
							),
							input.currency
						);
		}
		const directed = deferred
			? 0
			: directedFor(
					status,
					input.period.key,
					input.currency,
					input.monthPrior?.charged.get(code)?.directed ?? 0
				);
		const assessedEmployee = evaluateNumber(schemeEngine, rule.employee, context);
		const assessedEmployer = evaluateNumber(schemeEngine, rule.employer, context);
		if (monthlyAssessed)
			monthlyProduced.set(code, {
				base,
				employee: assessedEmployee,
				employer: assessedEmployer,
				ordinaryEmployee
			});
		// Truing the month up: the month's charge less what the earlier instalments already took,
		// and the base stored is the month's less theirs, so the year's sum is the month once.
		const employee = cents(
			assessedEmployee * share - (already?.employee ?? 0) + directed,
			input.currency
		);
		const employer = cents(assessedEmployer * share - (already?.employer ?? 0), input.currency);
		const chargeBase = cents(base * share - (already?.base ?? 0), input.currency);
		const assessedRebate =
			rule.rebate == null
				? 0
				: cents(evaluateNumber(schemeEngine, rule.rebate, context), input.currency);
		if (!Number.isFinite(assessedRebate) || assessedRebate < 0)
			refuse(`${code} rebatable payments must be finite and nonnegative.`);
		const rebate = cents(assessedRebate * share - (already?.rebate ?? 0), input.currency);
		charge(
			employee,
			employer,
			rule.when,
			chargeBase,
			[...reliefs].map(([readCode, employeeAmount]) => ({
				code: readCode,
				employee_amount: employeeAmount,
				...(ordinaryReliefs.get(readCode) === employeeAmount
					? {}
					: {
							ordinary_employee_amount: ordinaryReliefs.get(readCode)
						}),
				employer_amount: schemeProduced.get(readCode)?.employer ?? 0
			})),
			directed,
			evaluated.selected,
			rebate
		);
	}
	return charges;
}

/**
 * The charge of every COMPANY-assessed scheme: one row on the run, over the sum of every payslip's
 * reserved magnitudes and code map, evaluated once after the employment schemes. The employee
 * expression must be `0.0` — the levy is the employer's own.
 */
export function contributeCompany(input: {
	readonly accumulation: AccumulatedPayslip;
	readonly contributions: readonly ContributionConfig[];
	readonly period: SchemeAssessment['period'];
	readonly currency: string;
	readonly year: SchemeAssessment['year'];
	readonly person: PersonContext;
	readonly minimumWage: number | null;
	readonly projection: PayProjection;
	readonly yearToDate?: SchemeAssessment['yearToDate'];
	readonly facts?: SchemeAssessment['facts'];
	readonly yearEarned?: SchemeAssessment['yearEarned'];
	/** The employment schemes' sums over the run, readable as `produced.<code>.base|employee|employer`. */
	readonly produced?: ReadonlyMap<string, Produced>;
	readonly monthPrior?: CompanyMonthPrior;
}): ContributionCharge[] {
	const charges: ContributionCharge[] = [];
	const produced = new Map<string, Produced>(input.produced ?? []);
	const monthlyProduced = new Map<string, Produced>(input.monthPrior?.produced ?? []);
	for (const [code, row] of produced) {
		const prior = monthlyProduced.get(code);
		monthlyProduced.set(code, {
			base: row.base + (prior?.base ?? 0),
			employee: row.employee + (prior?.employee ?? 0),
			employer: row.employer + (prior?.employer ?? 0)
		});
	}
	const assessment: SchemeAssessment = {
		facts: input.facts ?? new Map(),
		yearToDate: input.yearToDate ?? (() => ({ employee: 0, employer: 0, base: 0, ordinary: 0 })),
		yearEarned: input.yearEarned ?? new Map(),
		history: () => ({
			periods: 0,
			base: 0,
			ordinary: 0,
			employee: 0,
			employer: 0,
			triggered: false,
			hasOpening: false,
			periodsRecorded: true
		}),
		period: input.period,
		currency: input.currency,
		year: input.year,
		projection: input.projection,
		person: input.person,
		minimumWage: input.minimumWage
	};
	for (const contribution of input.contributions) {
		if (contribution.row.assessment_scope !== 'COMPANY') continue;
		const monthly = contribution.row.assessment_period === 'MONTH';
		// Company levies settle at the closing cut-off, after the whole salary fund is available.
		if (monthly && input.period.index < input.period.instalments) continue;
		const schemeInput = monthly ? monthlyAssessment(assessment) : assessment;
		const accumulation =
			monthly && input.monthPrior != null
				? sumAccumulations([input.monthPrior.accumulation, input.accumulation])
				: input.accumulation;
		const schemeProduced = monthly ? monthlyProduced : produced;
		const already = monthly ? input.monthPrior?.charged.get(contribution.row.code) : undefined;
		const engine = engineFor(schemeInput, accumulation);
		const expressions = schemeExpressions(contribution);
		const assessmentOptions = {
			input: schemeInput,
			contribution,
			accumulation,
			produced: schemeProduced,
			reads: new Map<string, number>()
		};
		const evaluated = assessedBase(assessmentOptions);
		const ordinaryOn = contribution.row.ordinary_on?.trim() ?? '';
		const ordinary =
			ordinaryOn === ''
				? evaluated.base
				: assessedBase({
						...assessmentOptions,
						contribution: { ...contribution, row: { ...contribution.row, assessed_on: ordinaryOn } }
					}).base;
		let context: Record<string, unknown> = {
			...schemeContext({
				input: schemeInput,
				contribution,
				expressions,
				produced: schemeProduced,
				reads: new Map()
			}),
			base: evaluated.base,
			ordinary
		};
		requireSchemeFacts(contribution, undefined, context, engine);
		const rule = selectRule(contribution.row.rules, context, engine);
		if (rule == null && already == null) {
			schemeProduced.set(contribution.row.code, { base: 0, employee: 0, employer: 0 });
			continue;
		}
		if (rule != null) context = selectedRuleContext(rule, context, engine, contribution.row.code);
		const employee = rule == null ? 0 : evaluateNumber(engine, rule.employee, context);
		if (employee !== 0)
			refuse(
				`${contribution.row.code} is assessed on the company, so its employee expression must be 0.0; ` +
					`this one charges ${employee}.`
			);
		const assessedEmployer =
			rule == null ? 0 : cents(evaluateNumber(engine, rule.employer, context), input.currency);
		const assessed = rule == null ? 0 : evaluated.base;
		schemeProduced.set(contribution.row.code, {
			base: assessed,
			employee: 0,
			employer: assessedEmployer
		});
		charges.push({
			contribution,
			assessmentFrequency:
				input.period.instalments >= 4
					? 'WEEKLY'
					: input.period.instalments === 2
						? 'SEMI_MONTHLY'
						: 'MONTHLY',
			base: cents(assessed - (already?.base ?? 0), input.currency),
			employee: 0,
			employer: cents(assessedEmployer - (already?.employer ?? 0), input.currency),
			directed: 0,
			ruleReference: rule?.when ?? null,
			inputs: evaluated.selected,
			reads: []
		});
	}
	return charges;
}
