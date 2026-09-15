/**
 * Step 6 — CONTRIBUTE (RFC 0002).
 *
 * A scheme's rules are its whole arithmetic. The engine assembles the base from the lines that
 * opted into the scheme, picks the first rule whose `when` holds, evaluates that rule's `employee`
 * and `employer` against the same context, and writes the charge. Base transform, relief,
 * household share, rounding, withholding threshold and annualisation are expressions inside the
 * rules; the engine has no mode of its own.
 *
 * A read of `produced.<code>.employee` is a relief read: the engine supplies the producer's
 * relievable amount for this consumer — year to date plus this period, capped by the producer's
 * annual cap within its shared pool, projected over the payslips still to run when the producer
 * declares `project_relief_annually`. `produced.<code>.employer` is the plain employer share.
 * The mention is also the dependency; `orderSchemes` has already computed the producers.
 *
 * A scheme whose employment is NOT_REGISTERED charges zero and feeds nothing. A scheme no rule
 * matches charges zero too — a ladder that covers nobody pays nobody, and the golden suites are
 * the guard against a mis-transcribed table.
 */

import { refuse } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { selectRule, type RuleContext } from './rules.js';
import type { ContributionConfig } from './configuration.js';
import type { ContributionBase, ContributionLine } from './accumulate.js';
import { producedMentions } from './mentions.js';
import type { PersonContext } from './eligibility.js';
import type { PayProjection } from './period.js';
import { cents } from './rounding.js';
import { runtimeExpressionEngine, evaluateNumber } from '../../../lib/expressions/evaluate.js';

const StatutoryFactStatusSchema = Schema.Struct({
	kind: Schema.Literals(['REGISTERED', 'NOT_REGISTERED']),
	/** Percentage award; the expressions decide what to do with it. */
	rate_override: Schema.NullOr(Schema.Number)
});
export type StatutoryFactStatus = Schema.Schema.Type<typeof StatutoryFactStatusSchema>;

/** One `produced.<code>` read a charge made, as the calculation trace records it. */
type ContributionRead = {
	readonly code: string;
	readonly employee_amount: number;
	readonly employer_amount: number;
};

export type ContributionCharge = {
	readonly contribution: ContributionConfig;
	readonly base: number;
	readonly employee: number;
	readonly employer: number;
	/** The `when` expression of the rule that governed, or null where none held. */
	readonly ruleReference: string | null;
	/** The priced lines whose signed sum is the base, for the run's calculation trace. */
	readonly inputs: readonly ContributionLine[];
	/** The producer reads this charge made, in first-mention order. */
	readonly reads: readonly ContributionRead[];
};

type ContributeInput = {
	readonly bases: readonly ContributionBase[];
	/**
	 * How this run's period sits in the calendar month. A scheme assessed over the MONTH needs the
	 * month's wage, not the period's: at a semi-monthly company the first half carries the month's
	 * contribution (on the month's wage) and the second half carries none.
	 */
	readonly assessment?: { readonly periodsPerMonth: number; readonly periodIndex: number };
	/** `contribution_id` → the employment's registration, or `null` where no row exists. */
	readonly facts: ReadonlyMap<string, StatutoryFactStatus>;
	/** `contribution_code` → what has already been charged this tax year. */
	readonly yearToDate: (code: string) => { employee: number; employer: number; base: number };
	readonly age: number | null;
	readonly headcount: number;
	readonly riskClass: string | null;
	/** How far this payslip projects: the payslips left in the year, and the size of the year after it. */
	readonly projection: PayProjection;
	/** The person, as a scheme's or rule's expression sees them (dependants included). */
	readonly person: PersonContext;
	/** The company region's minimum wage, or null where the version states none for it. */
	readonly minimumWage: number | null;
	/** Whether the version's wages order covers this person; `wage_floor` is 0 when it does not. */
	readonly minimumWageApplies?: boolean;
};

/** Everything one scheme produced, so the schemes that read it can find it. */
type Produced = {
	readonly employee: number;
	readonly employer: number;
};

/** Whether any rule reads the regional minimum wage or its floor, so a version without one stops the run. */
function mentionsMinimumWage(
	rules: readonly { when: string; employee: string; employer: string }[]
) {
	return rules.some((rule) =>
		[rule.when, rule.employee, rule.employer].some(
			(expression) => expression.includes('minimum_wage(') || expression.includes('wage_floor')
		)
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
 * pool.
 */
function reliefReads(options: {
	readonly input: ContributeInput;
	readonly contribution: ContributionConfig;
	readonly produced: ReadonlyMap<string, Produced>;
	readonly byCode: ReadonlyMap<string, ContributionConfig>;
}): ReadonlyMap<string, number> {
	const { input, contribution, produced, byCode } = options;
	type Pool = { codes: string[]; weights: number[]; total: number; cap: number | null };
	const pools = new Map<string, Pool>();
	for (const code of producedMentions(contribution.row.rules)) {
		const other = byCode.get(code);
		const result = produced.get(code);
		if (other == null || result == null) continue;
		const row = other.row;
		const priorEmployee = input.yearToDate(code).employee;
		let relievable = priorEmployee + result.employee;
		if (row.project_relief_annually && row.employee_share_annual_cap != null) {
			const future = Math.max(0, input.projection.futurePayslipEquivalents);
			const remainingCap = Math.max(
				0,
				Math.min(row.employee_share_annual_cap, row.employee_share_annual_cap - relievable)
			);
			if (future > 0) relievable += Math.min(result.employee, remainingCap / future) * future;
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

/** The scheme context (RFC 0002 §0) one scheme's expressions are evaluated against. */
function schemeContext(options: {
	readonly input: ContributeInput;
	readonly entry: ContributionBase;
	readonly base: number;
	readonly produced: ReadonlyMap<string, Produced>;
	readonly reads: ReadonlyMap<string, number>;
	readonly status: StatutoryFactStatus | undefined;
}): RuleContext {
	const { input, entry } = options;
	const assessment = input.assessment ?? { periodsPerMonth: 1, periodIndex: 1 };
	return {
		person: input.person,
		base: options.base,
		code: entry.contribution.row.code,
		assessment_period: entry.contribution.row.assessment_period,
		period: {
			key: '',
			index: assessment.periodIndex,
			instalments: assessment.periodsPerMonth
		},
		year_to_date: input.yearToDate(entry.contribution.row.code),
		projection: {
			payslips_remaining: input.projection.payslipsRemaining,
			future_equivalents: input.projection.futurePayslipEquivalents
		},
		region: input.person.company.region,
		wage_floor: input.minimumWageApplies === false ? 0 : (input.minimumWage ?? 0),
		headcount: input.headcount,
		age: input.age ?? 0,
		risk_class: input.riskClass ?? '',
		rate_override: options.status?.kind === 'REGISTERED' ? (options.status.rate_override ?? 0) : 0,
		produced: Object.fromEntries(
			[...options.produced].map(([code, result]) => [
				code,
				{
					employee: options.reads.get(code) ?? result.employee,
					employer: result.employer
				}
			])
		)
	};
}

export function contribute(input: ContributeInput): ContributionCharge[] {
	const charges: ContributionCharge[] = [];
	const produced = new Map<string, Produced>();
	// Default: one period per month, so a scheme is assessed on the period as accumulated.
	const assessment = input.assessment ?? { periodsPerMonth: 1, periodIndex: 1 };
	const engine = runtimeExpressionEngine({ minimumWage: () => input.minimumWage ?? 0 });
	const byCode = new Map(
		input.bases.map((entry) => [entry.contribution.row.code, entry.contribution])
	);

	for (const entry of input.bases) {
		const contribution = entry.contribution;
		const code = contribution.row.code;
		// A MONTH-assessed scheme is charged once, on the month's wage: the run that owns the month's
		// first period carries the whole month's contribution, and the later period carries none.
		// The SAME rule serves any jurisdiction that states a monthly schedule at a finer cadence.
		const monthlyAssessed =
			contribution.row.assessment_period === 'MONTH' && assessment.periodsPerMonth > 1;
		const base = monthlyAssessed ? cents(entry.base * assessment.periodsPerMonth) : entry.base;
		const status = input.facts.get(contribution.row.id);
		const charge = (
			employee: number,
			employer: number,
			ruleReference: string | null,
			chargeBase: number = base,
			reads: readonly ContributionRead[] = []
		) => {
			produced.set(code, { employee, employer });
			charges.push({
				contribution,
				base: chargeBase,
				employee,
				employer,
				ruleReference,
				inputs: entry.lines,
				reads
			});
		};

		if (monthlyAssessed && assessment.periodIndex > 1) {
			charge(0, 0, null, 0);
			continue;
		}
		// An unregistered employment contributes nothing, and therefore also nothing to any relief
		// pool it feeds — the pool is fed by the *output*, never by a rate.
		if (status != null && status.kind === 'NOT_REGISTERED' && base > 0) {
			charge(0, 0, null);
			continue;
		}
		// A rule that names the regional minimum wage the version does not state stops the run
		// rather than charging on an unbounded base.
		if (input.minimumWage == null && mentionsMinimumWage(contribution.row.rules))
			refuse(
				`${code} bounds its base by the regional minimum wage, but the company's region has ` +
					'none in this settings version. Set companies.region and jurisdiction_settings.wages.by_region.'
			);

		const reads = reliefReads({ input, contribution, produced, byCode });
		const context = schemeContext({ input, entry, base, produced, reads, status });
		const rule = selectRule(contribution.row.rules, context, engine);
		if (rule == null) {
			// No rule matches: the scheme charges nothing and appears on no payslip, but a consumer
			// that names it reads zero rather than a missing row.
			produced.set(code, { employee: 0, employer: 0 });
			continue;
		}
		const employee = evaluateNumber(engine, rule.employee, context);
		const employer = evaluateNumber(engine, rule.employer, context);
		charge(
			employee,
			employer,
			rule.when,
			base,
			[...reads].map(([readCode, employeeAmount]) => ({
				code: readCode,
				employee_amount: employeeAmount,
				employer_amount: produced.get(readCode)?.employer ?? 0
			}))
		);
	}
	return charges;
}
