/**
 * Step 6 — CONTRIBUTE (RFC 0001 §8).
 *
 * A contribution turns a base into an employee amount and an employer amount. It never knows what
 * produced the base.
 *
 * ```
 * 0  COVER         statutory_contributions.eligibility: a scheme the person is outside is skipped
 * 1  TRANSFORM     rules.base_transform brackets, grades, floors or caps the chargeable base
 * 2  SELECT BAND   bands[].when, in order; the first condition that holds governs — bands.ts
 * 3  APPLY         the band's employee/employer expressions, rules.share_for_dependants, or an
 *                  employment's explicit flat override
 * 4  ROUND         rules.rounding, never a formula; a suppressed share is `no_withholding_below`
 * 5  GATE          employment_statutory_facts: NOT_REGISTERED pays nothing
 * ```
 *
 * A skipped scheme produces no charge at all — not a zero one — so it neither appears on the
 * payslip nor feeds a relief pool.
 *
 * Schemes run in `sequence` order, so a scheme that is a relief inside another has already produced
 * its number when that other one reads it. `scheme_reliefs` says *this scheme's employee share is a
 * relief inside that scheme's computation* — it never reduces a base.
 *
 * ## An annual scale is a decision, not a shape
 *
 * A progressive ladder is just bands whose money expressions are `constant + (base − from) × rate`;
 * there is no award kind to inspect. `rules.use_period_table` states whether the ladder is applied
 * to the period's chargeable figure directly or annualised, relieved, scaled and spread. The
 * single-progressive-rung-inside-a-wage-ladder case (Singapore's graduated CPF) is a period table;
 * Malaysia's PCB is an annual scale.
 */

import { refuse } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { selectBand, type BandContext } from './bands.js';
import type { ContributionConfig } from './configuration.js';
import type { ContributionBase } from './accumulate.js';
import { isEligible, type PersonContext } from './eligibility.js';
import type { PayProjection } from './period.js';
import { cents, roundMoney, type RoundingMethod } from './rounding.js';
import { runtimeExpressionEngine, evaluateNumber } from '../../../lib/expressions/evaluate.js';
import type { StatutoryRules } from '../../../datatypes/statutory_rules/+definition.js';

/** The channel an opted-in payment posts into (`rules.additional_remuneration_channel`). */
export const ADDITIONAL_REMUNERATION = 'ADDITIONAL_REMUNERATION';

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
	/** The `when` expression of the band that governed, or null under a flat override. */
	readonly bandReference: string | null;
	readonly special: Readonly<Record<string, number>>;
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
	/** The person, as a scheme's or band's expression sees them (dependants included). */
	readonly person: PersonContext;
	/** The company region's minimum wage, or null where the version states none for it. */
	readonly minimumWage: number | null;
};

function applyRounding(value: number, chain: readonly RoundingMethod[]): number {
	return chain.reduce((running, method) => roundMoney(running, method), value);
}

/**
 * A paired share: either both legs round independently, or the total is rounded, the employee
 * share floored, and the remainder given to the employer (Singapore CPF's dollar table).
 */
function roundContributionShares(
	employee: number,
	employer: number,
	chain: readonly RoundingMethod[],
	totalRoundedEmployeeFloored: boolean
): { employee: number; employer: number } {
	if (totalRoundedEmployeeFloored) {
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
 * A scheme that bills per insured head: the household factor multiplies the share, and the product
 * is billed per head, so it rounds to the cent before any chain rounding (Taiwan NHI 健保法 §18(2)).
 */
function applyDependants(
	expression: string,
	share: number,
	context: BandContext,
	engine: ReturnType<typeof runtimeExpressionEngine>
): number {
	if (expression.trim() === '') return share;
	return roundMoney(evaluateNumber(engine, expression, { ...context, share }), 'NEAREST_CENT');
}

/** Everything one scheme produced, so the schemes that read it can find it. */
type Produced = {
	readonly employee: number;
	readonly employer: number;
	readonly rules: StatutoryRules;
};

/** The scheme context (RFC 0001 §7.4) one scheme's expressions are evaluated against. */
function schemeContext(options: {
	readonly input: ContributeInput;
	readonly entry: ContributionBase;
	readonly base: number;
	readonly produced: ReadonlyMap<string, Produced>;
}): BandContext {
	const { input, entry } = options;
	const assessment = input.assessment ?? { periodsPerMonth: 1, periodIndex: 1 };
	return {
		person: input.person,
		base: options.base,
		share: 0,
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
		headcount: input.headcount,
		age: input.age ?? 0,
		risk_class: input.riskClass ?? '',
		produced: Object.fromEntries(
			[...options.produced].map(([code, result]) => [code, { employee: result.employee }])
		)
	};
}

/**
 * The annual relief pools this scheme draws on.
 *
 * The pools are deliberately **asymmetric**, and that asymmetry is the law rather than an
 * oversight: a retirement-fund relief is projected across the months still to run, because the
 * employee will certainly keep contributing, while a social-security relief counts only what has
 * actually been paid. Projecting both would overstate relief by up to eleven months' worth early in
 * the year and change the tax of every mid-band employee (decision E9).
 */
function reliefPools(options: {
	readonly input: ContributeInput;
	readonly contribution: ContributionConfig;
	readonly produced: ReadonlyMap<string, Produced>;
}): number {
	const { input, contribution } = options;
	const pools = new Map<string, { total: number; cap: number | null }>();
	for (const other of input.bases) {
		const otherCode = other.contribution.row.code;
		if (!other.contribution.relievedIds.includes(contribution.row.id)) continue;
		const result = options.produced.get(otherCode);
		if (result == null) continue;
		const priorEmployee = input.yearToDate(otherCode).employee;
		let relievable = priorEmployee + result.employee;
		if (result.rules.project_relief_annually && result.rules.employee_share_annual_cap != null) {
			const future = Math.max(0, input.projection.futurePayslipEquivalents);
			const remainingCap = Math.max(
				0,
				Math.min(
					result.rules.employee_share_annual_cap,
					result.rules.employee_share_annual_cap - relievable
				)
			);
			if (future > 0) relievable += Math.min(result.employee, remainingCap / future) * future;
		}
		const poolKey = result.rules.shared_cap_group ?? otherCode;
		const pool = pools.get(poolKey) ?? { total: 0, cap: result.rules.employee_share_annual_cap };
		pools.set(poolKey, {
			total: pool.total + relievable,
			cap:
				pool.cap == null
					? result.rules.employee_share_annual_cap
					: result.rules.employee_share_annual_cap == null
						? pool.cap
						: Math.min(pool.cap, result.rules.employee_share_annual_cap)
		});
	}
	return [...pools.values()].reduce(
		(total, pool) => total + (pool.cap == null ? pool.total : Math.min(pool.total, pool.cap)),
		0
	);
}

/** `constant + (value − band_from) × rate%`, over the scheme's own bands. */
export function scaleProgressive(
	contribution: ContributionConfig,
	value: number,
	context: BandContext,
	engine: ReturnType<typeof runtimeExpressionEngine>
): number {
	if (value <= 0) return 0;
	const bandContext = { ...context, base: value };
	const band = selectBand(contribution.rates, bandContext, engine, contribution.row.code);
	return evaluateNumber(engine, band.employee, bandContext);
}

export function contribute(input: ContributeInput): ContributionCharge[] {
	const charges: ContributionCharge[] = [];
	const produced = new Map<string, Produced>();
	// Default: one period per month, so a scheme is assessed on the period as accumulated.
	const assessment = input.assessment ?? { periodsPerMonth: 1, periodIndex: 1 };
	const engine = runtimeExpressionEngine({ minimumWage: () => input.minimumWage ?? 0 });

	for (const entry of input.bases) {
		const contribution = entry.contribution;
		const code = contribution.row.code;
		const rules = contribution.row.rules;
		const chain = [...rules.rounding];
		// A MONTH-assessed scheme is charged once, on the month's wage: the run that owns the month's
		// first period carries the whole month's contribution, and the later period carries none.
		// The SAME rule serves any jurisdiction that states a monthly schedule at a finer cadence.
		const monthlyAssessed =
			contribution.row.assessment_period === 'MONTH' && assessment.periodsPerMonth > 1;
		const base = monthlyAssessed ? cents(entry.base * assessment.periodsPerMonth) : entry.base;
		if (monthlyAssessed && assessment.periodIndex > 1) {
			produced.set(code, { employee: 0, employer: 0, rules });
			charges.push({
				contribution,
				base: 0,
				employee: 0,
				employer: 0,
				bandReference: null,
				special: entry.special
			});
			continue;
		}
		if (!isEligible(contribution.row.eligibility, input.person)) continue;
		const status = input.facts.get(contribution.row.id);

		// Whether a scheme charges at all: an unregistered employment contributes nothing, and
		// therefore also nothing to any relief pool it feeds — the pool is fed by the *output*,
		// never by a rate.
		const open = status == null || status.kind === 'REGISTERED' || base <= 0;
		if (!open) {
			produced.set(code, { employee: 0, employer: 0, rules });
			charges.push({
				contribution,
				base,
				employee: 0,
				employer: 0,
				bandReference: null,
				special: entry.special
			});
			continue;
		}

		// A rule that names the regional minimum wage the version does not state stops the run
		// rather than charging on an unbounded base.
		if (
			input.minimumWage == null &&
			[rules.base_transform, rules.relief, rules.share_for_dependants].some((expression) =>
				expression.includes('minimum_wage(')
			)
		)
			refuse(
				`${code} bounds its base by the regional minimum wage, but the company's region has ` +
					'none in this settings version. Set companies.region and jurisdiction_settings.wages.by_region.'
			);
		const context = schemeContext({ input, entry, base, produced });
		// The base transform brackets, grades, floors or caps the chargeable figure before the
		// ladder reads it; an empty transform uses the assembled base exactly.
		const chargeableBase =
			rules.base_transform.trim() === ''
				? base
				: evaluateNumber(engine, rules.base_transform, context);
		const bandContext = { ...context, base: chargeableBase };
		const band = selectBand(contribution.rates, bandContext, engine, code);
		const hasFlatOverride = status?.kind === 'REGISTERED' && status.rate_override != null;

		let employee = 0;
		let employer = 0;
		let bandReference: string | null = null;

		if (hasFlatOverride) {
			// A flat statutory award on current remuneration, not a replacement rung inside the
			// scale: Malaysia uses this for a proven non-resident employee, 30% without reliefs.
			const flat = applyRounding(chargeableBase * ((status.rate_override ?? 0) / 100), chain);
			const employerShare = evaluateNumber(engine, band.employer, bandContext);
			if (rules.total_rounded_employee_floored) {
				({ employee, employer } = roundContributionShares(
					flat,
					employerShare,
					chain,
					rules.total_rounded_employee_floored
				));
			} else {
				employee = flat;
				employer = applyRounding(employerShare, chain);
			}
			if (employee < rules.no_withholding_below) employee = 0;
			employee = applyDependants(rules.share_for_dependants, employee, bandContext, engine);
		} else if (rules.use_period_table) {
			// A period table: current mandatory employee contributions may reduce the chargeable
			// figure, but no year-to-date or future projection belongs in it.
			const chargeable = Math.max(
				0,
				chargeableBase - reliefPools({ input, contribution, produced })
			);
			const periodContext = { ...context, base: chargeable };
			const periodBand = selectBand(contribution.rates, periodContext, engine, code);
			const employeeLeg = evaluateNumber(engine, periodBand.employee, periodContext);
			const employerLeg = evaluateNumber(engine, periodBand.employer, bandContext);
			if (rules.total_rounded_employee_floored)
				({ employee, employer } = roundContributionShares(
					employeeLeg,
					employerLeg,
					chain,
					rules.total_rounded_employee_floored
				));
			else {
				employee = applyRounding(employeeLeg, chain);
				employer = applyRounding(employerLeg, chain);
			}
			if (employee < rules.no_withholding_below) employee = 0;
			employee = applyDependants(rules.share_for_dependants, employee, bandContext, engine);
			bandReference = periodBand.when;
		} else {
			// An annual scale: project, relieve, scale, then spread what has not been withheld.
			const remaining = Math.max(1, input.projection.payslipsRemaining);
			const future = Math.max(0, input.projection.futurePayslipEquivalents);
			const priorBase = input.yearToDate(code).base;
			const personalRelief =
				rules.relief.trim() === '' ? 0 : evaluateNumber(engine, rules.relief, bandContext);
			const annualGross = priorBase + chargeableBase * (1 + future);
			const chargeable = Math.max(
				0,
				annualGross - reliefPools({ input, contribution, produced }) - personalRelief
			);
			const scaleContext = { ...context, base: chargeable };
			const annualTax = scaleProgressive(contribution, chargeable, scaleContext, engine);
			const alreadyWithheld = input.yearToDate(code).employee;
			const regular = applyRounding(Math.max(0, annualTax - alreadyWithheld) / remaining, chain);
			// The extra is the difference two scalings make, charged on top of the regular part
			// whatever the minimum-withholding threshold did to that part.
			const additional = rules.additional_remuneration_channel
				? (entry.special[ADDITIONAL_REMUNERATION] ?? 0)
				: 0;
			const extra =
				additional > 0
					? applyRounding(
							Math.max(
								0,
								scaleProgressive(contribution, chargeable + additional, scaleContext, engine) -
									annualTax
							),
							chain
						)
					: 0;
			employee = (regular < rules.no_withholding_below ? 0 : regular) + extra;
			employer = applyRounding(evaluateNumber(engine, band.employer, bandContext), chain);
			bandReference = band.when;
		}

		produced.set(code, { employee, employer, rules });
		charges.push({
			contribution,
			base,
			employee,
			employer,
			bandReference,
			special: entry.special
		});
	}
	return charges;
}
