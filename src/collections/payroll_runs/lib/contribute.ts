/**
 * Step 6 — CONTRIBUTE.
 *
 * A contribution turns a base into an employee amount and an employer amount. It never knows what
 * produced the base.
 *
 * ```
 * 0  COVER         statutory_contributions.eligibility: a scheme the person is outside is skipped
 * 1  SELECT BAND   by statutory_contributions.bands[].selector and eligibility — bands.ts
 * 2  APPLY AWARD   PERCENT · FIXED · PROGRESSIVE, or an employment's explicit flat override
 * 3  ROUND         contribution.rounding, or a ROUND: chain, never a formula
 * 4  GATE          employment_statutory_facts: NOT_REGISTERED pays nothing
 * ```
 *
 * A skipped scheme produces no charge at all — not a zero one — so it neither appears on the
 * payslip nor feeds a relief pool.
 *
 * Schemes run in `sequence` order, so a scheme that is a relief inside another has already produced
 * its number when that other one reads it. `relief_for` says *this scheme's employee share is a
 * relief inside that scheme's computation* — it never reduces a base.
 *
 * ## PROGRESSIVE is cumulative, and this is the single most expensive detail in the engine
 *
 * A progressive band's `constant` is the **accumulated tax on every preceding band**, less whatever
 * rebate the jurisdiction folds in — not a flat addend:
 *
 * ```
 * tax = constant + (chargeable − band_from) × rate / 100
 * ```
 *
 * Read as a flat addend (`rate × chargeable + constant`) a chargeable income of 44,111.40 yields
 * 3,246.68 where the correct answer is 600 + 9,111.40 × 0.06 = **1,146.68** — a 175.00 monthly
 * error on one mid-band employee, and the error grows with income without bound. The seeded
 * Malaysian scale reconciles exactly, band by band, as cumulative tax (decision E1 / risk register
 * #2).
 */

import { refuse } from '@norbital-ai/bolt/authoring';
import { Number as EffectNumber, Option, Schema } from 'effect';
import { bandFloor, bandReference, selectBand, type BandContext } from './bands.js';
import type { ContributionConfig } from './configuration.js';
import type { ContributionBase } from './accumulate.js';
import { isEligible, type PersonContext } from './eligibility.js';
import type { PayProjection } from './period.js';
import { roundMoney, RoundingMethodSchema, type RoundingMethod } from './rounding.js';
import {
	ADDITIONAL_REMUNERATION,
	SpecialRulesSchema,
	bracketBase,
	parseSpecialRules,
	type SpecialRules
} from './special-rules.js';

const StatutoryFactStatusSchema = Schema.Struct({
	kind: Schema.Literals(['REGISTERED', 'NOT_REGISTERED']),
	/** Percentage award; on a progressive scheme this is a flat current-remuneration rate. */
	rate_override: Schema.NullOr(Schema.Number)
});
export type StatutoryFactStatus = Schema.Schema.Type<typeof StatutoryFactStatusSchema>;

export type ContributionCharge = {
	readonly contribution: ContributionConfig;
	readonly base: number;
	readonly employee: number;
	readonly employer: number;
	readonly bandReference: string | null;
	readonly special: Readonly<Record<string, number>>;
};

type ContributeInput = {
	readonly bases: readonly ContributionBase[];
	/** `contribution_id` → the employment's registration, or `null` where no row exists. */
	readonly facts: ReadonlyMap<string, StatutoryFactStatus>;
	/** `contribution_code` → what has already been charged this tax year. */
	readonly yearToDate: (code: string) => { employee: number; employer: number; base: number };
	readonly age: number | null;
	readonly headcount: number;
	readonly riskClass: string | null;
	/** How far this payslip projects: the payslips left in the year, and the size of the year after it. */
	readonly projection: PayProjection;
	/**
	 * Whether the employee's spouse is a dependant — a spouse who exists and has no total income
	 * of their own. That, not the fact of a marriage, is what a spouse relief and a married
	 * withholding scale both turn on (ITA 1967 s.47; MTD Category 2).
	 */
	readonly spouseIsDependent: boolean;
	readonly dependents: number;
	/** The person, as a scheme's or band's eligibility predicate sees them. */
	readonly person: PersonContext;
	/** The company region's minimum wage, or null where the version states none for it. */
	readonly minimumWage: number | null;
};

/**
 * A rate is a PERCENTAGE NUMBER, never a fraction: `{kind:'PERCENT', employee: 11}` is 11%, and
 * `{kind:'PROGRESSIVE', rate: 3}` is a 3% marginal rate. That is how every statute states a rate,
 * how the `rate_award` editor labels the field ("Employee (%)"), and what the seeded law declares
 * (source-system convention C4). The division by 100 happens here
 * and NOWHERE else, so a rate can be read off a gazette and typed straight into a row.
 */
function asFraction(rate: number): number {
	return rate / 100;
}

function roundingFor(contribution: ContributionConfig, rules: SpecialRules): RoundingMethod[] {
	if (rules.roundingChain.length > 0) return [...rules.roundingChain];
	const declared = Option.getOrUndefined(
		Schema.decodeUnknownOption(RoundingMethodSchema)(contribution.row.rounding)
	);
	if (declared == null)
		refuse(
			`Statutory contribution ${contribution.row.code} states a rounding of ` +
				`${JSON.stringify(contribution.row.rounding)}, which is not a rounding method the engine ` +
				'can apply. Fix the seeding rather than guessing.'
		);
	return [declared];
}

function applyRounding(value: number, chain: readonly RoundingMethod[]): number {
	return chain.reduce((running, method) => roundMoney(running, method), value);
}

function roundContributionShares(
	employee: number,
	employer: number,
	chain: readonly RoundingMethod[],
	rules: SpecialRules
): { employee: number; employer: number } {
	if (rules.totalRoundedEmployeeFloored) {
		const roundedEmployee = roundMoney(employee, 'FLOOR_UNIT');
		const roundedTotal = roundMoney(employee + employer, 'NEAREST_UNIT');
		return { employee: roundedEmployee, employer: roundedTotal - roundedEmployee };
	}
	return {
		employee: applyRounding(employee, chain),
		employer: applyRounding(employer, chain)
	};
}

/**
 * `FLOOR:MINIMUM_WAGE` and `CAP:MINIMUM_WAGE_X:<n>`: the chargeable base bounded by the company
 * region's minimum wage. A rule that names a wage the version does not state for the region stops
 * the run rather than charging on an unbounded base.
 */
function minimumWageBounds(
	base: number,
	rules: SpecialRules,
	minimumWage: number | null,
	code: string
): number {
	const stated = rules.baseCap == null ? base : Math.min(base, rules.baseCap);
	if (!rules.minimumWageFloor && rules.minimumWageCapMultiple == null) return stated;
	if (minimumWage == null)
		refuse(
			`${code} bounds its base by the regional minimum wage, but the company's region has none in ` +
				'this settings version. Set companies.region and jurisdiction_settings.minimum_wages.'
		);
	let bounded = stated;
	if (rules.minimumWageFloor) bounded = Math.max(bounded, minimumWage);
	if (rules.minimumWageCapMultiple != null)
		bounded = Math.min(bounded, rules.minimumWageCapMultiple * minimumWage);
	return bounded;
}

/** Everything one scheme produced, so the schemes that read it can find it. */
const ProducedSchema = Schema.Struct({
	employee: Schema.Number,
	employer: Schema.Number,
	rules: SpecialRulesSchema
});
type Produced = Schema.Schema.Type<typeof ProducedSchema>;

export function contribute(input: ContributeInput): ContributionCharge[] {
	const charges: ContributionCharge[] = [];
	const produced = new Map<string, Produced>();

	for (const entry of input.bases) {
		const contribution = entry.contribution;
		const code = contribution.row.code;
		const rules = parseSpecialRules(contribution.row.special_rules, code);
		if (!isEligible(contribution.row.eligibility, input.person)) continue;
		const status = input.facts.get(contribution.row.id);

		// Whether a scheme charges at all: an unregistered employment contributes nothing, and
		// therefore also nothing to any relief pool it feeds — the pool is fed by the *output*,
		// never by a rate.
		const open = status == null || status.kind === 'REGISTERED' || entry.base <= 0;
		if (!open) {
			produced.set(code, { employee: 0, employer: 0, rules });
			charges.push({
				contribution,
				base: entry.base,
				employee: 0,
				employer: 0,
				bandReference: null,
				special: entry.special
			});
			continue;
		}

		// The band is chosen on the base as accumulated; the *award* is applied to the bracketed
		// base. EPF's employer rate switches at RM5,000 of actual wage, and a wage of 4,995 brackets
		// up to 5,000 while still earning the higher rate — keying the switch on the bracketed figure
		// flips roughly one employee in 250 to the wrong rate.
		const context: BandContext = {
			base: entry.base,
			age: input.age,
			headcount: input.headcount,
			riskClass: input.riskClass,
			person: input.person
		};
		const band = selectBand(contribution.rates, context, code);
		const awardBase = minimumWageBounds(
			bracketBase(entry.base, rules.bracketSteps),
			rules,
			input.minimumWage,
			code
		);
		const chain = roundingFor(contribution, rules);
		const hasFlatOverride = status?.kind === 'REGISTERED' && status.rate_override != null;
		/**
		 * How many people this employee's own share covers: themselves, and each dependant a scheme
		 * charges them for, up to the ceiling it names.
		 *
		 * Taiwan's National Health Insurance is the one scheme in the bank that does this — 健保法
		 * §18(2) charges the insured person for their dependants as well, capped at three. It never
		 * touches the employer leg, which is already an average over the whole insured population
		 * (眷口數) and is carried in the seeded rate. Every other scheme names no ceiling and covers
		 * one head, so the factor is 1 and nothing moves.
		 */
		const heads =
			rules.employeePerDependant == null
				? 1
				: 1 + Math.min(Math.max(0, input.dependents), rules.employeePerDependant);
		/**
		 * The premium is stated and billed per insured head, so the rounded per-head amount is what
		 * is multiplied — not the raw share, which would round the total once and land a cent away
		 * from what the Bureau's own table bills for the same household. Summing heads is
		 * arithmetic rather than a table lookup, so the product lands on a cent whatever the
		 * scheme's own rounding is; Taiwan's is `TABLE`, which is the identity.
		 */
		const perHead = (employee: number): number =>
			heads === 1 ? employee : roundMoney(employee * heads, 'NEAREST_CENT');

		let employee = 0;
		let employer = 0;
		switch (band.award.kind) {
			case 'PERCENT': {
				const employeeRate = hasFlatOverride ? status.rate_override : band.award.employee;
				({ employee, employer } = roundContributionShares(
					awardBase * asFraction(employeeRate),
					awardBase * asFraction(band.award.employer),
					chain,
					rules
				));
				// `MIN_WITHHOLD` is a threshold on the **tax**, not on the wage, and it suppresses the
				// employee leg alone — the same rule the progressive paths apply to their regular
				// part, on the same rounded figure. Taiwan's resident 5% election is a `PERCENT`
				// award carrying 各類所得扣繳率標準 §13's NT$2,000 exemption; ignoring the rule here
				// withheld on every wage. Every other scheme states no threshold and is unmoved.
				if (employee < rules.minWithhold) employee = 0;
				employee = perHead(employee);
				break;
			}
			case 'FIXED': {
				// A tabled amount is the published figure. Rounding it would move every SOCSO and EIS
				// employer share by a cent or two, so `TABLE` rounding is the identity.
				({ employee, employer } = roundContributionShares(
					band.award.employee,
					band.award.employer,
					chain,
					rules
				));
				employee = perHead(employee);
				break;
			}
			case 'PROGRESSIVE': {
				// A progressive-scheme override is a flat statutory award on current remuneration,
				// not a replacement marginal band inside the resident scale. Malaysia uses this for
				// a proven non-resident employee: 30% of remuneration, without resident reliefs.
				const scaled = hasFlatOverride
					? applyRounding(entry.base * asFraction(status.rate_override), chain)
					: progressiveWithholding({ entry, contribution, rules, input, produced, chain });
				// The employer leg of a graduated scheme is a percentage of the whole chargeable wage,
				// read off the band the wage itself selected — never a slice of the ladder.
				const employerShare =
					band.award.employer == null ? 0 : awardBase * asFraction(band.award.employer);
				// A graduated CONTRIBUTION band is a paired award like every other band of its ladder,
				// so it rounds like one: CPF's $500–$750 rung rounds the TOTAL to the dollar and
				// floors the employee's share (CPF rates from 1 Jan 2026, Table 1 — $750 at 55 and
				// below is $150 employee of a $278 total, so $128 employer, not an independently
				// rounded $127.50). A withholding scale states no employer leg and is untouched.
				if (rules.totalRoundedEmployeeFloored)
					({ employee, employer } = roundContributionShares(scaled, employerShare, chain, rules));
				else {
					employee = scaled;
					employer = band.award.employer == null ? 0 : applyRounding(employerShare, chain);
				}
				break;
			}
		}

		produced.set(code, { employee, employer, rules });
		charges.push({
			contribution,
			base: entry.base,
			employee,
			employer,
			bandReference:
				band.award.kind === 'PROGRESSIVE' && hasFlatOverride ? null : bandReference(band.selector),
			special: entry.special
		});
	}
	return charges;
}

/** `constant + (value − band_from) × rate%`, over the scheme's own bands. */
export function scaleProgressive(
	contribution: ContributionConfig,
	value: number,
	context: BandContext
): number {
	if (value <= 0) return 0;
	const band = selectBand(contribution.rates, { ...context, base: value }, contribution.row.code);
	if (band.award.kind !== 'PROGRESSIVE')
		throw new Error(
			`${contribution.row.code} band ${bandReference(band.selector)} is not a progressive award, ` +
				'so a chargeable income cannot be scaled through it.'
		);
	return band.award.constant + (value - bandFloor(band.selector)) * asFraction(band.award.rate);
}

/**
 * Whether a scheme's ladder is a chargeable-income **scale** rather than a **wage ladder**.
 *
 * Annualising means re-selecting a band on a year's chargeable income, and that only means anything
 * where every rung is progressive: Malaysia's PCB and Vietnam's PIT ladders are nothing but
 * progressive rungs, which is how they declare themselves annual scales. A progressive rung sitting
 * inside a wage ladder whose other rungs are `FIXED` or `PERCENT` — Singapore's graduated CPF
 * $500–$750 band, between a `PERCENT` rung below and a `PERCENT` rung above — is an award on this
 * period's wage; annualising it lands on a rung of the wrong kind and `scaleProgressive` refuses.
 */
function isProgressiveScale(contribution: ContributionConfig): boolean {
	return contribution.rates.every((rate) => rate.award?.kind === 'PROGRESSIVE');
}

/**
 * The five steps of a withholding tax.
 *
 * ```
 * 1  PROJECT     annual = year-to-date base + this period's base × periods remaining
 * 2  RELIEVE     personal, spouse, dependants, and the pooled statutory reliefs
 * 3  SCALE       the progressive band ladder, cumulative
 * 4  SPREAD      (annual tax − already withheld) / periods remaining
 * 5  ADDITIONAL  scale(chargeable + A) − scale(chargeable), for payment-shaped pay
 * ```
 *
 * The relief pools are deliberately **asymmetric**, and that asymmetry is the law rather than an
 * oversight: a retirement-fund relief is projected across the months still to run, because the
 * employee will certainly keep contributing, while a social-security relief counts only what has
 * actually been paid. Projecting both would overstate relief by up to eleven months' worth early in
 * the year and change the tax of every mid-band employee (decision E9).
 */
type ProgressiveWithholdingOptions = {
	readonly entry: ContributionBase;
	readonly contribution: ContributionConfig;
	readonly rules: SpecialRules;
	readonly input: ContributeInput;
	readonly produced: ReadonlyMap<string, Produced>;
	readonly chain: readonly RoundingMethod[];
};

function progressiveWithholding(options: ProgressiveWithholdingOptions): number {
	const { entry, contribution, rules, input } = options;
	const code = contribution.row.code;
	const remaining = Math.max(1, input.projection.payslipsRemaining);
	// How many payslips of this size the rest of the year holds after this one: eleven for a
	// January monthly payslip, and more than twenty-three for the first half of January, because a
	// half-month payslip is smaller than a month. `payProjection` states the arithmetic.
	const future = Math.max(0, input.projection.futurePayslipEquivalents);
	const priorBase = input.yearToDate(code).base;

	// A jurisdiction may publish a table for the payroll period itself. In that case annualising a
	// monthly threshold and then spreading the result applies the table twelve times over. Current
	// mandatory employee contributions are still deducted because their rows explicitly name this
	// scheme in `relief_for`; no year-to-date or future projection belongs in a period table.
	//
	// The period figure is the DEFAULT and annualising is what has to be earned, by a wholly
	// progressive scale (`isProgressiveScale`) that has not declared `PERIODIC_PROGRESSIVE`. A
	// graduated contribution rung inside a wage ladder is a monthly levy, not a withholding tax:
	// CPF's $500–$750 band annualised $750 to $9,000, selected the $8,000.01+ `FIXED` ceiling and
	// threw, so the whole band priced nobody.
	if (rules.periodicProgressive || !isProgressiveScale(contribution)) {
		const statutoryRelief = input.bases.reduce((total, other) => {
			if (!other.contribution.row.relief_for.includes(contribution.row.id)) return total;
			return total + (options.produced.get(other.contribution.row.code)?.employee ?? 0);
		}, 0);
		const chargeable = Math.max(0, entry.base - statutoryRelief);
		const context: BandContext = {
			base: chargeable,
			age: input.age,
			headcount: input.headcount,
			riskClass: input.riskClass,
			person: input.person
		};
		const regular = applyRounding(
			scaleProgressive(contribution, chargeable, context),
			options.chain
		);
		return regular < rules.minWithhold ? 0 : regular;
	}

	// 1 — PROJECT
	const annualGross = priorBase + entry.base * (1 + future);

	// 2 — RELIEVE
	const pools = new Map<string, { total: number; cap: number | null }>();
	for (const other of input.bases) {
		const otherCode = other.contribution.row.code;
		if (!other.contribution.row.relief_for.includes(contribution.row.id)) continue;
		const result = options.produced.get(otherCode);
		if (result == null) continue;
		const priorEmployee = input.yearToDate(otherCode).employee;
		let relievable = priorEmployee + result.employee;
		if (result.rules.reliefProjected && result.rules.reliefCap != null) {
			const remainingCap = EffectNumber.clamp({ minimum: 0, maximum: result.rules.reliefCap })(
				result.rules.reliefCap - relievable
			);
			if (future > 0) relievable += Math.min(result.employee, remainingCap / future) * future;
		}
		const poolKey = result.rules.reliefPool ?? otherCode;
		const pool = pools.get(poolKey) ?? { total: 0, cap: result.rules.reliefCap };
		pools.set(poolKey, {
			total: pool.total + relievable,
			cap:
				pool.cap == null
					? result.rules.reliefCap
					: result.rules.reliefCap == null
						? pool.cap
						: Math.min(pool.cap, result.rules.reliefCap)
		});
	}
	const statutoryRelief = [...pools.values()].reduce(
		(total, pool) => total + (pool.cap == null ? pool.total : Math.min(pool.total, pool.cap)),
		0
	);
	const personalRelief =
		rules.personalRelief +
		(input.spouseIsDependent ? rules.spouseRelief : 0) +
		rules.childRelief * Math.max(0, input.dependents);
	const chargeable = Math.max(0, annualGross - statutoryRelief - personalRelief);

	// 3 & 4 — SCALE, then SPREAD what has not already been withheld
	const bandContext: BandContext = {
		base: chargeable,
		age: input.age,
		headcount: input.headcount,
		riskClass: input.riskClass,
		person: input.person
	};
	const annualTax = scaleProgressive(contribution, chargeable, bandContext);
	const alreadyWithheld = input.yearToDate(code).employee;
	const regular = applyRounding(
		Math.max(0, annualTax - alreadyWithheld) / remaining,
		options.chain
	);

	// 5 — ADDITIONAL. The extra is the difference two scalings make, and it is charged on top of the
	// regular part whatever the minimum-withholding threshold did to that part.
	const additional = rules.additionalRemuneration
		? (entry.special[ADDITIONAL_REMUNERATION] ?? 0)
		: 0;
	const extra =
		additional > 0
			? applyRounding(
					Math.max(
						0,
						scaleProgressive(contribution, chargeable + additional, bandContext) - annualTax
					),
					options.chain
				)
			: 0;

	const suppressed = regular < rules.minWithhold ? 0 : regular;
	return suppressed + extra;
}
