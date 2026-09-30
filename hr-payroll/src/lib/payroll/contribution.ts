import type { StatutoryFact } from './run/statutory-facts.js';
import * as Predicate from 'effect/Predicate';
import type { WorkRules } from '../datatypes/work_rules.js';
import { describeVersion, governed } from '../jurisdiction_settings.js';
import { refuse } from '../refuse.js';
import {
	contribute,
	contributeCompany,
	schemeExpressions,
	type ContributionCharge
} from '../../lib/payroll/run/contribute.js';
import {
	sumAccumulations,
	type AccumulatedPayslip,
	type QuantityPayment
} from '../../lib/payroll/run/accumulate.js';
import type { EmploymentBundle, GatheredRun } from '../../lib/payroll/run/gather.js';
import { cents } from '../../lib/payroll/run/rounding.js';

/**
 * One registration as the conflict check reads it: absent is the registered default, and every
 * optional member is spelled so an explicit default and an absent row compare equal.
 */
type FactStanding = {
	readonly kind?: string | undefined;
	readonly reason?: string | undefined;
	readonly rate_override?: number | null | undefined;
	readonly since?: string | null | undefined;
	readonly first_contribution_due_on?: string | null | undefined;
	readonly instalments?: readonly unknown[] | null | undefined;
	readonly elections?: Readonly<Record<string, unknown>> | null | undefined;
	readonly opening?: readonly unknown[] | null | undefined;
	readonly child_claims?: readonly unknown[] | null | undefined;
	readonly deduction_claims?: readonly unknown[] | null | undefined;
};
const factStanding = (status: FactStanding | undefined): string =>
	status?.kind === 'NOT_REGISTERED'
		? JSON.stringify(status)
		: JSON.stringify({
				kind: 'REGISTERED',
				rate_override: status?.rate_override ?? null,
				since: status?.since ?? null,
				first_contribution_due_on: status?.first_contribution_due_on ?? null,
				instalments: status?.instalments ?? [],
				elections: status?.elections ?? {},
				opening: status?.opening ?? [],
				child_claims: status?.child_claims ?? [],
				deduction_claims: status?.deduction_claims ?? []
			});

type ContractAssessment = {
	readonly employment: Pick<
		EmploymentBundle['employment'],
		'id' | 'employee_id' | 'company_id' | 'employee_number'
	>;
	readonly window: Pick<EmploymentBundle['window'], 'salary' | 'payFrequency'>;
	readonly calculation: Parameters<typeof contribute>[0];
};

/**
 * Run one employment's step so a refusal names whose record to complete: a refused message that
 * does not already carry the employee number is prefixed with it; anything else is rethrown as is.
 */
export function naming<T>(employeeNumber: string, body: () => T): T {
	try {
		return body();
	} catch (error) {
		if (
			error instanceof Error &&
			Predicate.hasProperty(error, 'kind') &&
			error.kind === 'refused' &&
			!error.message.includes(employeeNumber)
		)
			refuse(`${employeeNumber}: ${error.message}`);
		throw error;
	}
}

/** Allocate a rounded charge proportionally; tied fractional cents follow contract-id order. */
function allocate(amount: number, weights: readonly number[]): number[] {
	const total = weights.reduce((sum, value) => sum + value, 0);
	const units = Math.round(Math.abs(cents(amount)) * 100);
	const shares = weights.map((weight, index) => {
		const exact = total === 0 ? (index === 0 ? units : 0) : (units * weight) / total;
		return { index, units: Math.floor(exact), fraction: exact - Math.floor(exact) };
	});
	const remainder = units - shares.reduce((sum, share) => sum + share.units, 0);
	for (const share of shares
		.toSorted((a, b) => b.fraction - a.fraction || a.index - b.index)
		.slice(0, remainder))
		share.units += 1;
	return shares.map((share) => (Math.sign(amount) * share.units) / 100);
}

/**
 * Contract payslips retain their own money and sources. Contribution assesses the person's
 * combined remuneration once within the entity and interval, then allocates each share by that
 * scheme's own assessed base. Existing frozen money, rule keys and sealed employment identities
 * reconstruct both the assessment and allocation without a separate ledger.
 */
/** The entity's `semi_monthly_statutory_cutoff`, as the stored text; the column's own default otherwise. */
const statutoryCutoff = (value: string): 'FIRST' | 'SPLIT' | 'LAST' =>
	value === 'LAST' || value === 'SPLIT' ? value : 'FIRST';

export function assessContributions(
	contracts: readonly ContractAssessment[]
): Map<string, ContributionCharge[]> {
	const groups = Map.groupBy(
		contracts,
		(contract) => `${contract.employment.company_id}:${contract.employment.employee_id}`
	);
	const result = new Map<string, ContributionCharge[]>();
	for (const group of groups.values()) {
		const ordered = group.toSorted((a, b) =>
			a.employment.id < b.employment.id ? -1 : a.employment.id > b.employment.id ? 1 : 0
		);
		const first = ordered[0]!;
		const input = first.calculation;
		for (const contract of ordered.slice(1)) {
			const other = contract.calculation;
			if (
				contract.window.salary.start !== first.window.salary.start ||
				contract.window.salary.end !== first.window.salary.end ||
				other.projection.payslipsRemaining !== input.projection.payslipsRemaining ||
				other.projection.futurePayslipEquivalents !== input.projection.futurePayslipEquivalents
			)
				refuse(
					`Contracts for ${first.employment.employee_number} have conflicting Contribution assessment intervals or cadences.`
				);
			for (const contribution of input.contributions) {
				const id = contribution.row.id;
				const status = input.facts.get(id);
				const otherStatus = other.facts.get(id);
				if (factStanding(status) !== factStanding(otherStatus))
					refuse(
						`Contracts for ${first.employment.employee_number} have conflicting ${contribution.row.code} registrations or rate overrides.`
					);
			}
		}
		if (ordered.length === 1) {
			result.set(
				first.employment.id,
				naming(first.employment.employee_number, () => contribute(input))
			);
			continue;
		}
		const accumulations = ordered.map((contract) => contract.calculation.accumulation);
		const charges = naming(first.employment.employee_number, () =>
			contribute({
				...input,
				accumulation: sumAccumulations(accumulations),
				parts: accumulations
			})
		);
		for (const contract of ordered) result.set(contract.employment.id, []);
		// By scheme, not by position: a scheme the person is outside produced no charge at all.
		for (const charge of charges) {
			const parts = charge.parts ?? [{ base: charge.base, inputs: charge.inputs }];
			const weights = parts.map((part) => Math.max(0, part.base));
			const bases = allocate(charge.base, weights);
			const ordinaryBases =
				charge.ordinary == null
					? undefined
					: allocate(
							charge.ordinary,
							parts.map((part) => Math.max(0, part.ordinary ?? part.base))
						);
			const employee = allocate(charge.employee, weights);
			const employer = allocate(charge.employer, weights);
			const directed = allocate(charge.directed, weights);
			const rebate = allocate(charge.rebate ?? 0, weights);
			const { parts: _parts, ...rest } = charge;
			for (const [position, contract] of ordered.entries()) {
				const part = parts[position]!;
				result.get(contract.employment.id)!.push({
					...rest,
					base: bases[position]!,
					...(ordinaryBases == null ? {} : { ordinary: ordinaryBases[position]! }),
					inputs: part.inputs,
					employee: employee[position]!,
					employer: employer[position]!,
					directed: directed[position]!,
					rebate: rebate[position]!
				});
			}
		}
	}
	return result;
}

import { decodeNumber } from '../wire.js';
import type { PayrollWorld } from './world.js';
import type { PersonInput } from '../../lib/payroll/run/eligibility.js';
import { factStatusesOn, personFacts } from './facts.js';
import { settingsInForce } from '../jurisdiction_settings.js';
import { realignStatutoryFacts } from '../../lib/payroll/run/statutory-facts.js';
import { monthlyFactor, ordinaryDivisorDays } from '../../lib/payroll/run/ordinary-rate.js';
import { live, coversDate, effectiveWithin, readRange } from '../../lib/payroll/run/effective.js';
import type { Configuration } from '../../lib/payroll/run/configuration.js';
import type { WorkspaceRow } from '../rows.js';
import {
	accumulatePayslip,
	type MonthPrior,
	type ReservedLine
} from '../../lib/payroll/run/accumulate.js';
import { orderSchemes } from '../../lib/payroll/run/mentions.js';
import { employmentDates, type EmploymentDates } from '../../lib/payroll/run/settlement.js';
import type { StatutoryFactStatus } from '../../lib/payroll/run/contribute.js';
import {
	addDays,
	daysBetween,
	inclusiveDays,
	monthDays,
	monthBounds,
	monthKey,
	periodHalf,
	shiftPeriod,
	type IsoDate
} from '../../lib/payroll/run/dates.js';
import {
	cadenceWindow,
	closesTaxYear,
	defaultPayPeriod,
	employmentPayFrequency,
	taxYearBounds,
	taxYearOf,
	weeklyInstalments,
	type PayrollWindow
} from '../../lib/payroll/run/period.js';
import {
	evaluatePersonNumber,
	isEligible,
	personContext,
	type PersonContext
} from '../../lib/payroll/run/eligibility.js';
import type { RunIssue } from '../../lib/payroll/run/validate.js';
import { stint } from '../employment-contract.js';
import {
	patternAnchor,
	patternDaysPerWeek,
	patternWorkload,
	termPattern,
	termPatternRow
} from '../scheduling/work-pattern.js';
import { resolveSchedule } from '../../lib/payroll/run/schedule.js';
import { contractAllowancesOn } from './contract-allowances.js';
import { dateKey } from '../iso-day.js';
import { canonicalPlace, placeWage } from '../datatypes/wages.js';
import { recordedFact, resolveCompanyFacts } from '../declared-facts.js';
import type { MeasuredEmployment } from './family.js';
import {
	cumulativeHistory as summarizeHistory,
	type AssessmentFrequency,
	type StatutoryHistorySummary,
	type StatutoryPeriodHistory
} from './statutory-history.js';

const electionOf = (status: StatutoryFactStatus | undefined, key: string): unknown =>
	status?.kind === 'REGISTERED' ? (status.elections?.[key] ?? null) : null;

/** One registered declaration's share of a period's coverage. */
type CoverageStanding = {
	readonly status: StatutoryFactStatus;
	readonly intervals: readonly { readonly start: string; readonly end: string | null }[];
};

/**
 * Coverage-based schemes retain every registered interval, including one ending before payday.
 * Where the registered declaration changes inside the period — an election dated mid-month, a
 * re-enrolment on another grade after a gap — each declaration keeps its own intervals
 * (`standingsByScheme`) and the scheme is priced on each for its days. An election whose change
 * takes effect only from the first of a month (`change_effect: MONTH_START`) cannot change inside
 * continuous cover.
 */
function coverageFacts(bundle: EmploymentBundle, configuration: Configuration, asOf: string) {
	const currentFacts = factStatusesOn(
		bundle.statutoryFacts,
		asOf,
		bundle.employment.id,
		configuration.contributions
	);
	const facts = new Map(currentFacts);
	const coverageByScheme = new Map<string, { start: string; end: string | null }[]>();
	const standingsByScheme = new Map<string, CoverageStanding[]>();
	const dates = employmentDates(bundle.employment);
	for (const scheme of configuration.contributions) {
		const monthStartFields = scheme.row.elections.filter(
			(field) => field.change_effect === 'MONTH_START'
		);
		if (scheme.row.assessment_period !== 'PAY_PERIOD' && monthStartFields.length > 0) {
			const month = monthBounds(bundle.window.period.slice(0, 7));
			const changes = new Set(
				bundle.statutoryFacts
					.filter((fact) => fact.statutory_contribution_id === scheme.row.id)
					.map((fact) => dateKey(readRange(fact.effective_range)?.start))
					.filter((date) => date > month.start && date <= month.end && date <= asOf)
			);
			for (const date of changes) {
				const previous = factStatusesOn(
					bundle.statutoryFacts,
					addDays(date, -1),
					bundle.employment.id,
					configuration.contributions
				).get(scheme.row.id);
				const current = factStatusesOn(
					bundle.statutoryFacts,
					date,
					bundle.employment.id,
					configuration.contributions
				).get(scheme.row.id);
				if (previous?.kind !== 'REGISTERED' || current?.kind !== 'REGISTERED') continue;
				const changed = monthStartFields.find(
					(field) => electionOf(previous, field.key) !== electionOf(current, field.key)
				);
				if (changed != null)
					refuse(
						`${scheme.row.code}: ${changed.label?.trim() || changed.key} changes on ${date}, inside a calendar month; date the monthly declaration from its first day.`
					);
			}
		}
		if (!schemeExpressions(scheme).some((expression) => expression.includes('coverage_days(')))
			continue;
		const window =
			scheme.row.assessment_period !== 'PAY_PERIOD'
				? monthBounds(bundle.window.period.slice(0, 7))
				: bundle.window.salary;
		const start = dates.hire > window.start ? dates.hire : window.start;
		const end = dates.exit != null && dates.exit < window.end ? dates.exit : window.end;
		const intervals: { start: string; end: string | null }[] = [];
		const standings: { status: StatutoryFactStatus; intervals: typeof intervals }[] = [];
		let standing: (typeof standings)[number] | undefined;
		let open: { start: string; end: string | null } | undefined;
		for (let date = start; date <= end; date = addDays(date, 1)) {
			const status = factStatusesOn(
				bundle.statutoryFacts,
				date,
				bundle.employment.id,
				configuration.contributions
			).get(scheme.row.id);
			if (status == null)
				refuse(
					`${scheme.row.code}: record the insurance registration status on ${date} before calculating payroll.`
				);
			if (status.kind !== 'REGISTERED' || (status.since != null && status.since > date)) {
				open = undefined;
				continue;
			}
			const key = factStanding({ ...status, since: null });
			if (standing == null || factStanding({ ...standing.status, since: null }) !== key) {
				const monthly = scheme.row.elections.find(
					(field) =>
						field.change_effect === 'MONTH_START' &&
						JSON.stringify(electionOf(standing?.status, field.key)) !==
							JSON.stringify(electionOf(status, field.key))
				);
				if (standing != null && open != null && monthly != null)
					refuse(
						`${scheme.row.code}: ${monthly.label?.trim() || monthly.key} changes on ${date}, inside continuous cover; ` +
							'a change of it takes effect only from the first of a month. Date the declaration from the month it takes effect.'
					);
				standing =
					standings.find((row) => factStanding({ ...row.status, since: null }) === key) ??
					standings[standings.push({ status, intervals: [] }) - 1]!;
				open = undefined;
			}
			if (open == null) {
				open = { start: date, end: date };
				intervals.push(open);
				standing.intervals.push(open);
			} else open.end = date;
		}
		if (open != null) {
			const next = factStatusesOn(
				bundle.statutoryFacts,
				addDays(end, 1),
				bundle.employment.id,
				configuration.contributions
			).get(scheme.row.id);
			if (next?.kind === 'REGISTERED') open.end = null;
		}
		if (standings.length > 0) facts.set(scheme.row.id, standings[0]!.status);
		if (standings.length > 1) standingsByScheme.set(scheme.row.id, standings);
		coverageByScheme.set(scheme.row.id, intervals);
	}
	return { facts, currentFacts, coverageByScheme, standingsByScheme };
}

/**
 * The COMPANY-assessed schemes' charges: one row for the whole run, over the sum of every
 * payslip's reserved magnitudes and code map, evaluated once after the employment schemes. The
 * entity's own levy answers to no employment and no registration, so its context carries the
 * company's region and headcount and no person.
 */
export function assessCompanyContributions(options: {
	readonly configuration: Configuration;
	readonly gathered: GatheredRun;
	readonly window: PayrollWindow;
	readonly period: string;
	readonly accumulations: readonly AccumulatedPayslip[];
	/** Every employment charge of the run: a company levy reads their sums as `produced.<code>`. */
	readonly charges: readonly ContributionCharge[];
}): ContributionCharge[] {
	const { configuration, gathered, window, period } = options;
	const companySchemes = configuration.contributions.filter(
		(entry) => entry.row.assessment_scope === 'COMPANY'
	);
	if (companySchemes.length === 0) return [];
	const startMonth = configuration.jurisdiction.payroll.tax_year_start_month;
	const segments = versionSegments(configuration, window.salary);
	const minimumWage = windowFloor(segments, (version) => regionalMinimumWage(version));
	const entity = personContext({
		employee: null,
		employment: { service_start: '' },
		terms: null,
		company: {
			...configuration.company,
			headcount: gathered.headcount,
			headcount_citizens: gathered.headcountCitizens
		},
		asOf: window.salary.end
	});
	const floor = windowFloor(segments, (version) =>
		minimumWageCovers(version, entity) ? regionalMinimumWage(version) : 0
	);
	const bounds = taxYearBounds(period, startMonth);
	// The year-to-date and earned facts a company formula reads are the entity's: the sum over
	// every employee the run gathered.
	const yearToDate = (code: string) => {
		const total = { employee: 0, employer: 0, base: 0, ordinary: 0, rebate: 0 };
		for (const [key, value] of gathered.yearToDate)
			if (key.endsWith(`:${code}`)) {
				total.employee += value.employee;
				total.employer += value.employer;
				total.base += value.base;
				total.ordinary += value.ordinary;
				total.rebate += value.rebate ?? 0;
			}
		return total;
	};
	const yearEarned = new Map<string, number>();
	for (const byCode of gathered.yearEarned.values())
		for (const [code, amount] of byCode) yearEarned.set(code, (yearEarned.get(code) ?? 0) + amount);
	return contributeCompany({
		accumulation: sumAccumulations(options.accumulations),
		contributions: companySchemes,
		period: {
			key: period,
			start: window.salary.start,
			end: window.salary.end,
			index: periodHalf(period) ?? 1,
			instalments:
				window.payFrequency === 'SEMI_MONTHLY'
					? 2
					: window.payFrequency === 'WEEKLY'
						? weeklyInstalments(period).length
						: 1,
			monthlyOn: 'LAST',
			lastOfYear: closesTaxYear(period, startMonth, window.payFrequency),
			daysEmployed: 0,
			daysInMonth: monthDays(window.salary.start)
		},
		currency: configuration.jurisdiction.payroll.currency,
		year: { start: bounds.start, end: bounds.end, months_employed: 0, payments: 0 },
		person: { ...entity, wage_floor: floor ?? 0 },
		minimumWage,
		projection: { payslipsRemaining: 1, futurePayslipEquivalents: 0 },
		yearToDate,
		yearEarned,
		produced: producedSums(options.charges),
		monthPrior: gathered.companyMonthPrior
	});
}

/** The run's employment charges summed by scheme — the entity's base, employee and employer. */
function producedSums(charges: readonly ContributionCharge[]) {
	const sums = new Map<string, { base: number; employee: number; employer: number }>();
	for (const charge of charges) {
		const code = charge.contribution.row.code;
		const sum = sums.get(code) ?? { base: 0, employee: 0, employer: 0 };
		sum.base += charge.base;
		sum.employee += charge.employee;
		sum.employer += charge.employer;
		sums.set(code, sum);
	}
	return sums;
}
export const prepareContributionCatalogue = (world: PayrollWorld, settingsId: string) =>
	orderSchemes(
		live(world.statutory_contributions)
			.filter((row) => row.settings_id === settingsId)
			.map((row) => ({ row, rules: row.rules }))
	);

export function prepareContributionInputs(options: {
	readonly world: PayrollWorld;
	readonly employeeIds: readonly string[];
	readonly configuration: Configuration;
}) {
	const employeeIds = new Set(options.employeeIds);
	return Map.groupBy(
		realignStatutoryFacts(
			options.world,
			live(options.world.employment_statutory_facts).filter((row) =>
				employeeIds.has(row.employee_id)
			),
			options.configuration
		),
		(row) => row.employee_id
	);
}
export function contributionYearToDate(options: {
	readonly payslips: readonly WorkspaceRow<'payslips'>[];
	readonly inTaxYear: ReadonlySet<string>;
	readonly employmentToEmployee: ReadonlyMap<string, string>;
}) {
	const { inTaxYear, employmentToEmployee } = options;
	const priorPayslips = options.payslips;
	const totals = new Map<
		string,
		{ employee: number; employer: number; base: number; ordinary: number; rebate?: number }
	>();
	for (const payslip of priorPayslips) {
		if (!inTaxYear.has(payslip.payroll_run_id)) continue;
		const employeeId = employmentToEmployee.get(payslip.employment_id);
		if (employeeId == null) continue;
		for (const charge of payslip.statutory) {
			const key = `${employeeId}:${charge.scheme_code}`;
			const running = totals.get(key) ?? { employee: 0, employer: 0, base: 0, ordinary: 0 };
			totals.set(key, {
				// Directed tax instalments settle a separate liability; they are not the
				// current year's statutory withholding or a contribution eligible for relief.
				employee: running.employee + charge.employee_amount - (charge.directed_amount ?? 0),
				employer: running.employer + charge.employer_amount,
				base: running.base + charge.base_amount,
				ordinary: running.ordinary + (charge.ordinary_amount ?? 0),
				rebate: (running.rebate ?? 0) + (charge.rebate_amount ?? 0)
			});
		}
	}

	return totals;
}

/**
 * The version's ordinary-rate divisor over a person whose basic is not stated monthly — what turns
 * a daily, hourly or weekly rate into `terms.monthly_basic`. A monthly rate needs none, and a
 * divisor that cannot be read yet (the week not measured) leaves the basic as stated.
 */
function divisorFor(
	configuration: Pick<Configuration, 'work'>,
	input: PersonInput,
	employeeNumber: string
): number | null {
	// Every cadence reads the divisor: a daily, hourly or weekly rate becomes a month through it,
	// and a monthly one becomes the ordinary day (`terms.ordinary_day`) over it.
	try {
		return ordinaryDivisorDays({
			expression: configuration.work.ordinary_divisor_days,
			person: personContext(input),
			employeeNumber
		});
	} catch {
		return null;
	}
}

/** Whether the version's wages order covers this person (`wages.applies_when`; empty is everyone). */
export function minimumWageCovers(
	configuration: Pick<Configuration, 'jurisdiction'>,
	person: PersonContext
): boolean {
	return isEligible(configuration.jurisdiction.work_rules.wages?.applies_when ?? '', person);
}

/** The person's monthly floor under one version: 0 without a monthly order or for an excluded worker. */
export function personWageFloor(
	configuration: Pick<Configuration, 'company' | 'jurisdiction'>,
	person: PersonContext
): number {
	const wages = configuration.jurisdiction.work_rules.wages;
	if (
		Object.keys(wages?.by_region ?? {}).length === 0 &&
		Object.keys(wages?.by_employment_type ?? {}).length === 0
	)
		return 0;
	return minimumWageCovers(configuration, person)
		? personMinimumWage(configuration, person) * minimumWageScale(configuration, person)
		: 0;
}

/** The share of the region's wage this person's floor is (`wages.scale`; absent is the whole). */
function minimumWageScale(
	configuration: Pick<Configuration, 'jurisdiction'>,
	person: PersonContext
): number {
	const scale = (configuration.jurisdiction.work_rules.wages?.scale ?? '').trim();
	return scale === '' ? 1 : evaluatePersonNumber(scale, person);
}

/**
 * A leaver whose final pay falls due before this run's pay date (`payroll.final_pay_due_days`).
 * A warning: the run still pays on its date, and the operator reads who is owed sooner.
 */
export function finalPayIssues(options: {
	readonly configuration: Configuration;
	readonly bundles: readonly EmploymentBundle[];
	readonly payDate: string;
}): RunIssue[] {
	const fallback = options.configuration.jurisdiction.payroll.final_pay_due_days;
	const rules = options.configuration.jurisdiction.payroll.final_pay_deadlines ?? [];
	if (fallback == null && rules.length === 0) return [];
	const issues: RunIssue[] = [];
	for (const bundle of options.bundles) {
		const exit = employmentDates(bundle.employment).exit;
		if (exit == null) continue;
		// The person on the final service day, so a deadline predicate can read the departure
		// reason, the recorded departure facts and the contract.
		const person = personContext({
			employee: bundle.employee,
			employment: stint(bundle.employment, options.configuration.jurisdiction.exit_facts ?? []),
			terms: bundle.termsHistory.find((row) => coversDate(row.effective_range, exit)) ?? null,
			fixedAllowances: 0,
			children: bundle.children,
			company: options.configuration.company,
			week: { ordinary_hours_per_week: 0, working_days_per_week: 0 },
			asOf: exit
		});
		const rule = rules.find(
			(candidate) => candidate.when.trim() === '' || isEligible(candidate.when, person)
		);
		const due = rule?.days ?? fallback;
		if (due == null) continue;
		const deadline =
			rule?.basis === 'WORKING_DAYS' || rule?.basis === 'NON_REST_HOLIDAY_DAYS'
				? workingDayDeadline(
						options.configuration,
						bundle,
						exit,
						due,
						options.payDate,
						rule.basis === 'NON_REST_HOLIDAY_DAYS'
					)
				: addDays(
						rule?.basis === 'MONTH_END'
							? monthBounds(monthKey(exit)).end
							: rule?.basis === 'NEXT_PAYDAY'
								? exitPayday(options.configuration, bundle, exit)
								: exit,
						due
					);
		if (deadline == null || options.payDate <= deadline) continue;
		const authority = rule?.authority == null ? '' : ` (${rule.authority})`;
		issues.push({
			code: 'FINAL_PAY_LATE',
			severity: 'WARNING',
			message:
				`${bundle.employment.employee_number} left on ${exit}; the final pay is due within ${due} ` +
				`${rule?.basis === 'WORKING_DAYS' ? 'working ' : rule?.basis === 'NON_REST_HOLIDAY_DAYS' ? 'non-rest/holiday ' : ''}days of ` +
				`${rule?.basis === 'MONTH_END' ? 'the end of that month' : rule?.basis === 'NEXT_PAYDAY' ? 'the agreed payday' : 'the last day'}, by ${deadline}, ` +
				`and this run pays on ${options.payDate}${authority}.`,
			collection: 'employments',
			recordId: bundle.employment.id
		});
	}
	return issues;
}

/**
 * The agreed payday of the pay period the exit falls in, on the leaver's cadence and the company's
 * calendar (ID PP 36/2021 art.55(1): wages are paid at the agreed time).
 */
function exitPayday(
	configuration: Configuration,
	bundle: EmploymentBundle,
	exit: IsoDate
): IsoDate {
	const company = configuration.company;
	const payFrequency = employmentPayFrequency(bundle.termsHistory, exit);
	const period = defaultPayPeriod(exit, 1, { company, payFrequency });
	return cadenceWindow(period, company, payFrequency)?.payDate ?? monthBounds(monthKey(exit)).end;
}

/**
 * The `days`-th eligible day after exit, if the run pays later. Ordinary working-day rules count
 * the leaver's scheduled days; SG EA s.22 also counts off days but excludes rest days and holidays.
 * The run's calendar reaches its pay date, so every day read here is loaded.
 */
function workingDayDeadline(
	configuration: Configuration,
	bundle: EmploymentBundle,
	exit: IsoDate,
	days: number,
	payDate: IsoDate,
	includeOffDays = false
): IsoDate | null {
	if (payDate <= addDays(exit, 1)) return null;
	const terms = bundle.termsHistory.find((row) => coversDate(row.effective_range, exit));
	const pattern = terms == null ? null : termPatternRow(terms, configuration.patternById);
	const schedule = resolveSchedule({
		window: { start: addDays(exit, 1), end: addDays(payDate, -1) },
		dates: daysBetween(addDays(exit, 1), addDays(payDate, -1)),
		terms: () => ({
			work_pattern: pattern?.pattern ?? null,
			pattern_anchor: patternAnchor(pattern),
			normal_daily_hours: 0
		}),
		workDays: [],
		configuration
	});
	let counted = 0;
	for (const day of schedule.values()) {
		const working = includeOffDays
			? day.dayType !== 'REST_DAY' &&
				!day.statutoryRest &&
				day.observedHoliday == null &&
				day.dayType !== 'SPECIAL_HOLIDAY'
			: pattern == null
				? day.dayType === 'OFF_DAY'
				: day.dayType === 'ORDINARY' && day.shift != null;
		if (working && ++counted === days) return day.date;
	}
	return null;
}

/**
 * A covered person contracted below the region's minimum wage. Each version segment is held to its own
 * version's floor: a wage order binds from its effective date (PH NCR-28 from 26 September 2026),
 * so the days before it are owed the old floor and only the days after it the new one.
 */
export function minimumWageIssues(options: Parameters<typeof floorIssues>[0]): RunIssue[] {
	return options.bundles.flatMap((bundle) =>
		naming(bundle.employment.employee_number, () => floorIssues({ ...options, bundles: [bundle] }))
	);
}

function floorIssues(options: {
	readonly configuration: Configuration;
	readonly bundles: readonly EmploymentBundle[];
	readonly measured?: readonly MeasuredEmployment[];
	/** The run's charges by employment, for a floor stated net of the employee's shares. */
	readonly charges?: ReadonlyMap<string, readonly ContributionCharge[]>;
	readonly headcountCitizens?: number;
	readonly asOf: string;
}): RunIssue[] {
	const issues: RunIssue[] = [];
	const measuredByEmployment = new Map(
		(options.measured ?? []).map((row) => [row.bundle.employment.id, row])
	);
	for (const bundle of options.bundles) {
		if (bundle.employedDays == null || bundle.deferral != null) continue;
		const measured = measuredByEmployment.get(bundle.employment.id);
		const segments = versionSegments(options.configuration, bundle.employedDays);
		for (const segment of segments)
			issues.push(...dailyFloorIssues(segment.configuration, bundle, segment, measured));
		for (const { segment, term, against, during, start } of floorTerms(
			bundle,
			segments,
			measured
		)) {
			const { configuration } = segment;
			const { person } = against;
			// The version's named contract rules, judged from the segment's first day.
			const judged = { ...person, employment: { ...person.employment, rule_date: start } };
			for (const rule of configuration.jurisdiction.work_rules.wages?.contract_rules ?? [])
				if (isEligible(rule.when, judged) && !isEligible(rule.holds, judged))
					issues.push({
						code: 'WAGE_CONTRACT_RULE',
						severity: rule.severity,
						message: `${bundle.employment.employee_number}: ${rule.message}${during === '' ? '' : ` (${during.trim()})`}`,
						collection: 'employment_terms',
						recordId: term.id
					});
			if (
				configuration.jurisdiction.work_rules.wages?.block_unmeasured_results_pay === true &&
				person.terms.monthly_basic <= 0 &&
				isEligible(configuration.jurisdiction.work_rules.wages?.results_pay?.applies_when, {
					...person,
					company: { ...person.company, headcount_citizens: options.headcountCitizens ?? 0 }
				}) &&
				options.charges
					?.get(bundle.employment.id)
					?.some(
						(charge) =>
							charge.contribution.row.code ===
								configuration.jurisdiction.work_rules.wages?.results_pay?.levy_scheme &&
							charge.ruleReference != null
					) &&
				(person.terms.statutory_work_category === 'PIECE_RATE' ||
					(person.terms.statutory_work_category === 'TASK_BASIS' &&
						(measured?.adjustments.some(
							(line) =>
								line.input.family === 'ADHOC' &&
								(
									configuration.jurisdiction.work_rules.wages?.results_pay
										?.levy_unclassified_codes ?? []
								).includes(line.catalogueComponent.code)
						) ||
							measured?.base.some(
								(line) => line.catalogueComponent.output === 'salary_top_up' && line.amount > 0
							))))
			)
				refuse(
					`${bundle.employment.employee_number}: zero-basic piece or task/trip wages, or a commission minimum-wage top-up, need an HRD Corp levy classification before this employer's levy can be calculated from them.`
				);
			// The wages order's rule on the contract's composition (ID: basic at least 75% of the wage).
			const termsWhen = (configuration.jurisdiction.work_rules.wages?.terms_when ?? '').trim();
			if (termsWhen !== '' && !isEligible(termsWhen, person))
				issues.push({
					code: 'WAGE_TERMS_RULE',
					severity:
						configuration.jurisdiction.work_rules.wages?.block_terms_when === true
							? 'BLOCKER'
							: 'WARNING',
					message:
						`${bundle.employment.employee_number}'s contract does not satisfy the version's wage rule ` +
						`\`${termsWhen}\` (basic ${person.terms.basic_salary}, fixed allowances ${person.terms.fixed_allowances})${during}. ` +
						(configuration.jurisdiction.work_rules.wages?.block_terms_when === true
							? 'Correct the terms before running payroll.'
							: 'The run pays the contract; restate the terms or record why they stand.'),
					collection: 'employment_terms',
					recordId: term.id
				});
			const { floor, unit, stated } = against;
			// A monthly floor stated net of the employee's own shares (CN-SH 沪人社规〔2025〕10号 item 4)
			// is met by the contract less the month's employee charges of the named schemes.
			// ponytail: the month's charges net every term segment of the month; split per segment if a
			// mid-month rise lands on the floor.
			const netOf = configuration.jurisdiction.work_rules.wages?.net_of_employee_schemes ?? [];
			const withheld =
				unit === 'a month' && netOf.length > 0
					? (options.charges?.get(bundle.employment.id) ?? [])
							.filter((charge) => netOf.includes(charge.contribution.row.code))
							.reduce((sum, charge) => sum + charge.employee, 0)
					: 0;
			const paid = against.paid - withheld;
			// The table states a month to the cent (₱695 × 313 ÷ 12 = 18,127.92); rescaled to 261 days it
			// is 15,116.2528, which a ₱695 daily rate (15,116.25) meets — the floor is money, in cents.
			const payable = cents(paid);
			if (payable >= cents(floor)) continue;
			const blockWhen = configuration.jurisdiction.work_rules.wages?.block_below_when?.trim();
			const blocking = blockWhen != null && blockWhen !== '' && isEligible(blockWhen, person);
			const resultsOnly =
				configuration.jurisdiction.work_rules.wages?.block_unmeasured_results_pay === true &&
				['PIECE_RATE', 'TASK_BASIS'].includes(person.terms.statutory_work_category) &&
				person.terms.monthly_basic <= 0;
			issues.push({
				code: 'MINIMUM_WAGE_BELOW',
				severity: blocking ? 'BLOCKER' : 'WARNING',
				message:
					`${bundle.employment.employee_number} ${resultsOnly ? 'has payable' : 'is contracted at'} ${payable} ${unit}` +
					(withheld > 0 ? ` net of ${cents(withheld)} employee ${netOf.join('/')} shares` : '') +
					', below the ' +
					`${workplace(configuration, person)} minimum wage of ${stated} the version states${during}. ` +
					(resultsOnly
						? 'Record and pay enough results wages for the full calendar month before running payroll.'
						: blocking
							? 'Raise the contract terms before running payroll.'
							: 'The run pays the contract; raise the terms or record why the wage stands.'),
				collection: 'employment_terms',
				recordId: term.id
			});
		}
	}
	return issues;
}

/**
 * Each terms row in force in each version segment, judged against that version's floor: the days
 * it covers there and, where the version states a floor that covers the person, the pay against it.
 */
function* floorTerms(
	bundle: EmploymentBundle,
	segments: ReturnType<typeof versionSegments>,
	measured: MeasuredEmployment | undefined
) {
	for (const segment of segments) {
		const datedTerms = effectiveWithin(bundle.termsHistory, segment.start, segment.end);
		for (const term of datedTerms.length > 0 ? datedTerms : bundle.terms.slice(-1)) {
			const range = readRange(term.effective_range);
			const from = range == null ? segment.start : dateKey(range.start);
			const through = range?.end == null ? segment.end : dateKey(range.end);
			const start = from > segment.start ? from : segment.start;
			const asOf = through < segment.end ? through : segment.end;
			if (start > asOf) continue;
			const wages = segment.configuration.jurisdiction.work_rules.wages;
			const site = wages?.workplace_keyed
				? term.worksite?.trim() || segment.configuration.company.region || ''
				: (segment.configuration.company.region ?? '');
			const place = canonicalPlace(wages?.by_region ?? {}, site);
			const sector =
				wages?.sector_edition != null
					? sectorCode(wages, term, from)
					: (term.worksite_sector?.trim() ?? '');
			const sectorKeys = new Set(
				(wages?.monthly_by_sector ?? [])
					.filter(
						(row) =>
							(place === row.place || place.startsWith(`${row.place}/`)) &&
							row.sector_codes.includes(sector)
					)
					.flatMap((row) =>
						[...(row.when?.matchAll(/company\.facts\.([A-Za-z_][A-Za-z0-9_]*)/g) ?? [])].map(
							(match) => match[1]!
						)
					)
			);
			if (
				sectorKeys.size > 0 &&
				segment.configuration.companyFactRevisions.some((revision) => {
					const boundary = readRange(revision.effective_range);
					return (
						boundary != null &&
						[dateKey(boundary.start), dateKey(boundary.end)].some(
							(day) => day > start && day <= asOf
						) &&
						Object.keys(revision.facts).some((key) => sectorKeys.has(key))
					);
				})
			)
				refuse(
					`Sector classification changes inside ${start}–${asOf}; this wage-floor segment needs dated assessment.`
				);
			const against = wageAgainstFloor(segment.configuration, bundle, term, asOf, measured);
			if (wages?.monthly_by_sector?.length && start < asOf) {
				const atStart = wageAgainstFloor(segment.configuration, bundle, term, start, measured);
				if (atStart?.floor !== against?.floor)
					refuse(
						`A sector minimum wage changes inside ${start}–${asOf}; this wage-floor segment needs dated assessment.`
					);
			}
			if (against == null) continue;
			const during =
				segments.length > 1 || datedTerms.length > 1 ? ` from ${start} to ${asOf}` : '';
			yield { segment, term, against, during, start };
		}
	}
}

/**
 * 最低工資法 §5 (`wages.substitutes_below`): a covered contract agreed below the floor has the floor
 * as its wage, so every bundle's terms row below the floor of a version in force during the
 * employed days is re-rated to it in the contract's own unit (the rate × floor ÷ pay, each in the
 * floor's unit) before anything is measured, and the run warns. The highest floor the row meets in
 * the period is the one it is raised to.
 * ponytail: judged without the measured month, so a version combining this with
 * `weekly_daily_hourly_alternative` refuses a daily contract; measure first if one ever does.
 */
export function raiseToMinimumWage(
	configuration: Configuration,
	bundles: readonly EmploymentBundle[]
): { bundles: EmploymentBundle[]; issues: RunIssue[] } {
	const raised = bundles.map((bundle) =>
		naming(bundle.employment.employee_number, () => raiseFloors(configuration, [bundle]))
	);
	return {
		bundles: raised.flatMap((row) => row.bundles),
		issues: raised.flatMap((row) => row.issues)
	};
}

function raiseFloors(
	configuration: Configuration,
	bundles: readonly EmploymentBundle[]
): { bundles: EmploymentBundle[]; issues: RunIssue[] } {
	const issues: RunIssue[] = [];
	const raised = bundles.map((bundle) => {
		if (bundle.employedDays == null) return bundle;
		const rates = new Map<string, number>();
		// Only a version whose floor substitutes itself is judged here; the rest are judged measured.
		const segments = versionSegments(configuration, bundle.employedDays).filter(
			(segment) => segment.configuration.jurisdiction.work_rules.wages?.substitutes_below === true
		);
		for (const { segment, term, against, during } of floorTerms(bundle, segments, undefined)) {
			if (against.paid <= 0) continue;
			if (cents(against.paid) >= cents(against.floor)) continue;
			const base = term.base_salary ?? 0;
			// The floor restated in the contract's unit, up to the cent so it meets the floor.
			const rate =
				Math.ceil(Math.round((base * against.floor * 10_000) / against.paid) / 100) / 100;
			if (rate <= (rates.get(term.id) ?? base)) continue;
			rates.set(term.id, rate);
			issues.push({
				code: 'MINIMUM_WAGE_BELOW',
				severity: 'WARNING',
				message:
					`${bundle.employment.employee_number} is contracted at ${cents(against.paid)} ${against.unit}, below the ` +
					`${workplace(segment.configuration, against.person)} minimum wage of ${against.stated} the version states${during}. ` +
					`The law makes the minimum the wage, so the run pays ${rate} in place of the agreed ${base}.`,
				collection: 'employment_terms',
				recordId: term.id
			});
		}
		if (rates.size === 0) return bundle;
		const lift = (term: EmploymentBundle['terms'][number]) =>
			rates.has(term.id) ? { ...term, base_salary: rates.get(term.id)! } : term;
		return {
			...bundle,
			terms: bundle.terms.map(lift),
			termsHistory: bundle.termsHistory.map(lift)
		};
	});
	return { bundles: raised, issues };
}

/**
 * A daily floor by worksite and sector (TH Minimum Wage Notice 14): each normal working day, at
 * the worksite its work day records (else its terms') and the sector its terms record, is held to the higher of the place's rate (a
 * district key overriding its province) and the sector's. The day is the normal day however short
 * the employer makes it (cl.19), so a daily rate meets the whole floor and an hourly rate meets it
 * over the day's scheduled hours. A monthly or semi-monthly wage (`base_salary` is the month for
 * both) is the month over the version's `ordinary_divisor_days`, a weekly one its month (the
 * version's `rate_conversions.weekly_to_monthly`) over it (owner rule 2026-09-28, register
 * TH-WAGE-01: daily × 30, LPA s.68's monthly ÷ 30).
 * One issue per terms row.
 */
function dailyFloorIssues(
	configuration: Configuration,
	bundle: EmploymentBundle,
	segment: { readonly start: IsoDate; readonly end: IsoDate },
	measured: MeasuredEmployment | undefined
): RunIssue[] {
	const wages = configuration.jurisdiction.work_rules.wages;
	const places = wages?.daily_by_worksite ?? {};
	if (Object.keys(places).length === 0 || measured == null) return [];
	const number = bundle.employment.employee_number;
	const below = new Map<
		string,
		{
			term: EmploymentBundle['terms'][number];
			first: IsoDate;
			days: number;
			paid: number;
			floor: number;
			at: string;
		}
	>();
	// Per terms row: whether the order covers the person (null where it does not) and blocks, and
	// the version's divisor over them.
	const judged = new Map<string, { blocking: boolean; divisor: number; weekly: number } | null>();
	// A work day's recorded site overrides the terms' worksite for that day (cl.20: the day's workplace).
	const siteOn = new Map(
		bundle.workDays
			.filter((row) => (row.worksite?.trim() ?? '') !== '')
			.map((row) => [dateKey(row.work_date), row.worksite!.trim()])
	);
	for (const day of measured.schedule.values()) {
		if (day.date < segment.start || day.date > segment.end) continue;
		if (day.dayType !== 'ORDINARY' || day.shift == null) continue;
		const term = bundle.termsHistory.find((row) => coversDate(row.effective_range, day.date));
		if (term == null) continue;
		if (!judged.has(term.id)) {
			const person = personContext({
				employee: bundle.employee,
				employment: stint(bundle.employment, configuration.jurisdiction.exit_facts ?? []),
				terms: term,
				fixedAllowances: 0,
				children: bundle.children,
				company: configuration.company,
				week: { ordinary_hours_per_week: 0, working_days_per_week: 0 },
				asOf: day.date
			});
			const blockWhen = wages?.block_below_when?.trim() ?? '';
			judged.set(
				term.id,
				minimumWageCovers(configuration, person)
					? {
							blocking: blockWhen !== '' && isEligible(blockWhen, person),
							divisor: ordinaryDivisorDays({
								expression: configuration.work.ordinary_divisor_days,
								person,
								employeeNumber: number
							}),
							weekly:
								term.pay_frequency === 'WEEKLY'
									? monthlyFactor('WEEKLY', person.terms, { work: configuration.work, person })
									: 1
						}
					: null
			);
		}
		const judgement = judged.get(term.id);
		if (judgement == null) continue;
		const site = siteOn.get(day.date) ?? term.worksite?.trim() ?? '';
		const province = site.split('/')[0]!.trim();
		// A bare province whose districts carry their own rates does not say which rate the day is owed.
		const districted =
			site === province && Object.keys(places).some((key) => key.startsWith(`${province}/`));
		const place = districted ? undefined : (places[site] ?? places[province]);
		if (place == null)
			refuse(
				`${number}: record the worksite on ${day.date} as a province or province/district the ` +
					`version's daily minimum-wage table names` +
					(site === '' ? '.' : ` ("${site}" names none, or its province has district rates).`)
			);
		const sectorKey = term.worksite_sector?.trim() ?? '';
		const sector = sectorKey === '' ? 0 : wages?.daily_by_sector?.[sectorKey];
		if (sector == null)
			refuse(
				`${number}: the worksite sector "${sectorKey}" is not in the version's daily minimum-wage table.`
			);
		const floor = Math.max(place, sector);
		const rate = decodeNumber(term.base_salary);
		// The day's pay is rate × scale ÷ per; compare rate × scale with floor × per in satang so the
		// unrounded day is judged (10,109.99 ÷ 30 = 336.9997 is below 337, not rounded up to it).
		const [scale, per] =
			term.pay_frequency === 'DAILY'
				? [1, 1]
				: term.pay_frequency === 'HOURLY'
					? [day.shift.paid_minutes, 60]
					: term.pay_frequency === 'WEEKLY'
						? [judgement.weekly, judgement.divisor]
						: [1, judgement.divisor];
		if (cents(rate * scale) >= cents(floor * per)) continue;
		const paid = Math.round((rate * scale * 10_000) / per) / 10_000;
		const at = sectorKey === '' ? site : `${site} ${sectorKey}`;
		const key = `${term.id}:${at}:${floor}:${paid}`;
		const seen = below.get(key);
		if (seen == null) below.set(key, { term, first: day.date, days: 1, paid, floor, at });
		else seen.days += 1;
	}
	return [...below.values()].map((row): RunIssue => {
		const blocking = judged.get(row.term.id)?.blocking === true;
		return {
			code: 'MINIMUM_WAGE_BELOW',
			severity: blocking ? 'BLOCKER' : 'WARNING',
			message:
				`${number} is paid ${row.paid} a day on ${row.days} normal working day(s) from ${row.first}, ` +
				`below the ${row.at} daily minimum wage of ${row.floor} the version states. ` +
				(blocking
					? 'Raise the contract terms before running payroll.'
					: 'The run pays the contract; raise the terms or record why the wage stands.'),
			collection: 'employment_terms',
			recordId: row.term.id
		};
	});
}

/**
 * A contract's pay against the floor one version states on `asOf`, both in the unit the order is
 * stated in; null where the version states no floor for the person or its order does not cover them.
 */
function wageAgainstFloor(
	configuration: Configuration,
	bundle: EmploymentBundle,
	term: EmploymentBundle['terms'][number],
	asOf: IsoDate,
	measured?: MeasuredEmployment
): {
	person: PersonContext;
	paid: number;
	floor: number;
	unit: string;
	stated: number | string;
} | null {
	const monthWindow = monthBounds(monthKey(asOf));
	const monthWorkingDays = measured?.normalWorkingDaysIn?.(monthWindow) ?? null;
	const input = {
		employee: bundle.employee,
		employment: stint(bundle.employment, configuration.jurisdiction.exit_facts ?? []),
		fixedAllowances: contractAllowancesOn(bundle, configuration, asOf),
		terms: term,
		week: {
			ordinary_hours_per_week: term.ordinary_hours_per_week ?? 0,
			working_days_per_week: (() => {
				const pattern = termPattern(term, configuration.patternById);
				return pattern == null ? 0 : patternDaysPerWeek(pattern, configuration.shiftById);
			})()
		},
		children: bundle.children,
		company: configuration.company,
		...(monthWorkingDays == null ? {} : { period: { working_days: monthWorkingDays } }),
		asOf
	};
	// The version's divisor turns a daily or hourly rate into the month the floor is stated in.
	const dailyDivisors =
		configuration.jurisdiction.work_rules.wages?.daily_monthly_divisor_by_workweek;
	const dailyDivisor =
		term.pay_frequency === 'DAILY' && dailyDivisors != null
			? dailyDivisors[String(input.week.working_days_per_week)]
			: null;
	if (term.pay_frequency === 'DAILY' && dailyDivisors != null && dailyDivisor == null)
		refuse(
			`${bundle.employment.employee_number}: the daily minimum-wage divisor is missing for ${input.week.working_days_per_week} workdays a week.`
		);
	const person = personContext({
		...input,
		divisorDays: dailyDivisor ?? divisorFor(configuration, input, bundle.employment.employee_number)
	});
	if (!minimumWageCovers(configuration, person)) return null;
	if (
		configuration.jurisdiction.work_rules.wages?.block_unmeasured_results_pay === true &&
		['PIECE_RATE', 'TASK_BASIS'].includes(person.terms.statutory_work_category) &&
		person.terms.monthly_basic <= 0
	) {
		const fullMonth =
			bundle.window?.salary.start === monthWindow.start &&
			bundle.window.salary.end === monthWindow.end &&
			bundle.window.attendance.start === monthWindow.start &&
			bundle.window.attendance.end === monthWindow.end &&
			bundle.employedDays?.start === monthWindow.start &&
			bundle.employedDays.end === monthWindow.end;
		if (measured == null || !fullMonth || measured.arrears != null)
			refuse(
				`${bundle.employment.employee_number}: results pay cannot be verified against the monthly minimum wage of ${describeVersion(configuration.jurisdiction)} without measured wages for a full calendar month on the same attendance and salary window, with no earlier-month arrears.`
			);
		let paid: number;
		if (person.terms.statutory_work_category === 'TASK_BASIS') {
			if (person.terms.fixed_allowances !== 0)
				refuse(
					`${bundle.employment.employee_number}: fixed allowances on task, trip or commission terms need a sourced minimum-wage classification before the monthly comparator can run.`
				);
			const resultsPay = configuration.jurisdiction.work_rules.wages?.results_pay;
			const codes = resultsPay?.results_wage_codes ?? [];
			if (
				term.pay_frequency !== 'MONTHLY' ||
				bundle.workDays.some(
					(day) =>
						dateKey(day.work_date) >= monthWindow.start &&
						dateKey(day.work_date) <= monthWindow.end &&
						day.piece_units != null
				)
			)
				refuse(
					`${bundle.employment.employee_number}: task, trip and commission results need monthly terms and typed wage requests; piece-unit workday amounts do not identify their statutory earning class.`
				);
			const captured = new Set(measured.captured.payRequests.ADHOC);
			const requests = bundle.payRequests.filter(
				(request) =>
					request.family === 'ADHOC' &&
					captured.has(request.id) &&
					codes.includes(request.catalogueComponent.code)
			);
			const attestations = bundle.payRequests.filter(
				(request) =>
					request.family === 'ADHOC' &&
					request.catalogueComponent.code === resultsPay?.zero_results_code &&
					(request.pay_period === monthKey(asOf) ||
						(request.event_date >= monthWindow.start && request.event_date <= monthWindow.end))
			);
			if (attestations.length > 0) {
				const attestation = attestations[0]!;
				if (
					attestations.length !== 1 ||
					bundle.payRequests.some(
						(request) =>
							request.family === 'ADHOC' &&
							codes.includes(request.catalogueComponent.code) &&
							(request.pay_period === monthKey(asOf) ||
								(request.event_date >= monthWindow.start && request.event_date <= monthWindow.end))
					) ||
					!captured.has(attestation.id) ||
					attestation.event_date !== monthWindow.end ||
					attestation.pay_period !== monthKey(asOf) ||
					decodeNumber(attestation.amount) !== 0 ||
					attestation.sign !== 1 ||
					attestation.evidence_file == null ||
					measured.adjustments.some(
						(line) =>
							line.input.family === 'ADHOC' && line.input.id === attestation.id && line.amount !== 0
					)
				)
					refuse(
						`${bundle.employment.employee_number}: one evidenced zero-results attestation dated ${monthWindow.end}, paid in ${monthKey(asOf)}, must stand alone before the monthly minimum can be assessed.`
					);
				paid = 0;
			} else {
				if (requests.length === 0)
					refuse(
						`${bundle.employment.employee_number}: task, trip and commission wages cannot be verified against the monthly minimum wage of ${describeVersion(configuration.jurisdiction)} until their payable amounts and contribution treatment are recorded as distinct earnings.`
					);
				paid = 0;
				for (const request of requests) {
					if (
						request.event_date < monthWindow.start ||
						request.event_date > monthWindow.end ||
						request.pay_period !== monthKey(asOf) ||
						request.sign !== 1 ||
						request.evidence_file == null
					)
						refuse(
							`${bundle.employment.employee_number}: ${request.catalogueComponent.code} needs positive evidenced wages earned and paid in ${monthKey(asOf)} before the monthly minimum can be assessed.`
						);
					const lines = measured.adjustments.filter(
						(line) =>
							line.input.family === 'ADHOC' &&
							line.input.id === request.id &&
							line.catalogueComponent.code === request.catalogueComponent.code
					);
					if (lines.length !== 1 || lines[0]!.amount <= 0 || lines[0]!.bucket !== 'EARNING')
						refuse(
							`${bundle.employment.employee_number}: ${request.catalogueComponent.code} did not settle as one positive result-wage line.`
						);
					paid += lines[0]!.amount;
				}
			}
		} else
			paid = measured.base
				.filter(
					(line) =>
						line.catalogueComponent.output === 'salary' ||
						line.catalogueComponent.output === 'salary_top_up'
				)
				.reduce((sum, line) => sum + line.amount, 0);
		const floor = bindingMinimumWage(configuration, person, asOf);
		return {
			person,
			paid:
				paid +
				(person.terms.statutory_work_category === 'TASK_BASIS'
					? measured.base
							.filter((line) => line.catalogueComponent.output === 'salary_top_up')
							.reduce((sum, line) => sum + line.amount, 0)
					: 0),
			floor,
			unit: `in ${monthKey(asOf)} results wages`,
			stated: floor
		};
	}
	// A daily-only order is checked on each normal workday; no order means no monthly floor.
	if (Object.keys(configuration.jurisdiction.work_rules.wages?.by_region ?? {}).length === 0)
		return null;
	let wage = bindingMinimumWage(configuration, person, asOf);
	// An hourly wage the version derives from the monthly floor, for whom it permits one.
	const hourlyFloor = configuration.jurisdiction.work_rules.wages?.hourly_floor;
	if (hourlyFloor != null && person.terms.pay_frequency === 'HOURLY') {
		if (!isEligible(hourlyFloor.allowed_when, person))
			refuse(`${bundle.employment.employee_number}: ${hourlyFloor.refusal}`);
		const divisor = hourlyFloor.from_monthly_divisor;
		return {
			person,
			paid: person.terms.basic_salary,
			floor: wage / divisor,
			unit: 'an hour',
			stated: `${wage} a month / ${divisor}${hourlyFloor.authority ? ` (${hourlyFloor.authority})` : ''}`
		};
	}
	// An hourly rate meets the hourly table. A monthly-paid part-timer uses the version's
	// monthly proportion where stated; otherwise the hourly table is annualised by contract hours.
	const scale = minimumWageScale(configuration, person);
	let hourly = placeWage(
		configuration.jurisdiction.work_rules.wages?.hourly_by_region ?? {},
		configuration.company.region ?? ''
	);
	let statedMonthly: number | string = wage;
	let statedHourly: number | string = hourly ?? 0;
	const priorFloor = configuration.jurisdiction.work_rules.wages?.protected_prior_floor;
	if (
		priorFloor != null &&
		asOf > priorFloor.on &&
		employmentDates(bundle.employment).hire <= priorFloor.on
	) {
		const priorFloorOn = priorFloor.on;
		const prior = settingsInForce(
			configuration.lineageVersions,
			configuration.jurisdiction.code,
			priorFloorOn
		);
		if (prior == null)
			refuse(`${bundle.employment.employee_number}: the prior minimum-wage version is missing.`);
		const earlier = prior.work_rules.wages;
		const priorRegion = String(recordedFact(term, priorFloor.region_fact) ?? '').trim();
		const reclassified = recordedFact(term, priorFloor.reclassified_fact);
		const higherMonthly = Math.max(0, ...Object.values(earlier?.by_region ?? {})) > wage;
		const higherHourly =
			Math.max(0, ...Object.values(earlier?.hourly_by_region ?? {})) > (hourly ?? 0);
		const couldRetain = higherMonthly || (hourly != null && higherHourly);
		if (reclassified == null && couldRetain)
			refuse(
				`${bundle.employment.employee_number}: declare whether this worksite's minimum-wage area was reclassified after ${priorFloorOn}.`
			);
		if (reclassified === true) {
			if (!priorRegion)
				refuse(
					`${bundle.employment.employee_number}: declare the worksite's minimum-wage region on ${priorFloorOn} before pricing this incumbent.`
				);
			const oldMonthly = earlier?.by_region?.[priorRegion!];
			if (oldMonthly == null)
				refuse(
					`${bundle.employment.employee_number}: the minimum-wage region on ${priorFloorOn} is unknown.`
				);
			if (oldMonthly > wage) {
				wage = oldMonthly;
				statedMonthly = `${oldMonthly} (protected Region ${priorRegion} of ${priorFloorOn})`;
			}
			const oldHourly = earlier?.hourly_by_region?.[priorRegion!];
			if (hourly != null && oldHourly != null && oldHourly > hourly) {
				hourly = oldHourly;
				statedHourly = `${oldHourly} (protected Region ${priorRegion} of ${priorFloorOn})`;
			}
		}
	}
	const partTimeFullTimeWeek =
		configuration.jurisdiction.work_rules.wages?.part_time_monthly_full_time_week_hours;
	const weeklyMonthlyFactor = configuration.jurisdiction.work_rules.wages?.weekly_monthly_factor;
	const dailyPartTime =
		person.employment.type === 'PART_TIME' &&
		person.terms.pay_frequency === 'DAILY' &&
		configuration.jurisdiction.work_rules.wages?.part_time_daily_hourly_floor === true;
	const monthlyPartTime =
		person.employment.type === 'PART_TIME' &&
		(person.terms.pay_frequency === 'MONTHLY' || person.terms.pay_frequency === 'SEMI_MONTHLY');
	const partTimeMonthlyHourly =
		monthlyPartTime &&
		configuration.jurisdiction.work_rules.wages?.part_time_monthly_hourly_floor === true;
	const contractedWeek =
		term.ordinary_hours_per_week ??
		(patternWorkload(termPattern(term, configuration.patternById), configuration.shiftById)
			?.average_weekly_paid_minutes ?? 0) / 60;
	if (
		monthlyPartTime &&
		(partTimeFullTimeWeek != null || partTimeMonthlyHourly) &&
		!(contractedWeek > 0)
	)
		refuse(
			`${bundle.employment.employee_number}: contracted weekly hours are required for the part-time monthly minimum wage.`
		);
	if (partTimeMonthlyHourly && hourly == null)
		refuse(
			`${bundle.employment.employee_number}: the part-time monthly minimum wage needs an hourly wage table for this region.`
		);
	if (dailyPartTime && !(contractedWeek > 0 && person.terms.working_days_per_week > 0))
		refuse(
			`${bundle.employment.employee_number}: contracted weekly hours and working days are required for the part-time daily minimum wage.`
		);
	if (dailyPartTime && hourly == null)
		refuse(
			`${bundle.employment.employee_number}: the part-time daily minimum wage needs an hourly wage table for this region.`
		);
	const alternateHourly =
		configuration.jurisdiction.work_rules.wages?.weekly_daily_hourly_alternative === true &&
		(person.terms.pay_frequency === 'DAILY' || person.terms.pay_frequency === 'WEEKLY');
	if (alternateHourly) {
		if (hourly == null)
			refuse(`${bundle.employment.employee_number}: the hourly minimum-wage table is missing.`);
		if (
			person.terms.pay_frequency === 'DAILY' &&
			!(monthWorkingDays != null && monthWorkingDays > 0)
		)
			refuse(
				`${bundle.employment.employee_number}: the calendar month's normal working days for daily minimum-wage conversion are missing.`
			);
		if (person.terms.pay_frequency === 'WEEKLY' && weeklyMonthlyFactor == null)
			refuse(
				`${bundle.employment.employee_number}: the weekly minimum-wage monthly factor is missing.`
			);
		const monthlyPaid =
			person.terms.basic_salary *
			(person.terms.pay_frequency === 'DAILY' ? monthWorkingDays! : weeklyMonthlyFactor!);
		if (cents(monthlyPaid) >= cents(wage * scale))
			return {
				person,
				paid: monthlyPaid,
				floor: wage * scale,
				unit: `a month (converted from ${person.terms.pay_frequency.toLowerCase()} pay)`,
				stated: statedMonthly
			};
		if (person.terms.pay_frequency === 'DAILY') {
			const shiftMinutes = new Set(
				[...(measured?.schedule.values() ?? [])]
					.filter(
						(day) =>
							day.date >= monthWindow.start &&
							day.date <= monthWindow.end &&
							coversDate(term.effective_range, day.date) &&
							day.shift != null
					)
					.map((day) => day.shift!.paid_minutes)
			);
			if (shiftMinutes.size > 1)
				refuse(
					`${bundle.employment.employee_number}: daily normal hours vary within the month; record each day's normal hours before using the hourly minimum-wage alternative.`
				);
		}
		const days = person.terms.working_days_per_week;
		const workload = patternWorkload(
			termPattern(term, configuration.patternById),
			configuration.shiftById
		);
		const weekHours =
			term.ordinary_hours_per_week != null && term.ordinary_hours_per_week > 0
				? term.ordinary_hours_per_week
				: (workload?.average_weekly_paid_minutes ?? 0) / 60;
		const normalHours = person.terms.pay_frequency === 'DAILY' ? weekHours / days : weekHours;
		if (!(normalHours > 0))
			refuse(
				`${bundle.employment.employee_number}: the normal working hours for the ${person.terms.pay_frequency.toLowerCase()} wage are missing.`
			);
		return {
			person,
			paid: person.terms.basic_salary / normalHours,
			floor: hourly * scale,
			unit: `an hour (converted from ${person.terms.pay_frequency.toLowerCase()} pay)`,
			stated: statedHourly
		};
	}
	const [paid, floor, unit, stated]: [number, number, string, number | string] =
		hourly != null && person.terms.pay_frequency === 'HOURLY'
			? [person.terms.basic_salary, hourly * scale, 'an hour', statedHourly]
			: person.terms.pay_frequency === 'WEEKLY' && weeklyMonthlyFactor != null
				? [
						person.terms.basic_salary * weeklyMonthlyFactor,
						wage * scale,
						'a month (converted from weekly pay)',
						statedMonthly
					]
				: partTimeMonthlyHourly && hourly != null
					? [
							person.terms.monthly_basic /
								monthlyFactor(
									'HOURLY',
									{
										ordinary_hours_per_week: contractedWeek,
										working_days_per_week: person.terms.working_days_per_week
									},
									{ work: configuration.work, person }
								),
							hourly * scale,
							'an hour (converted from monthly part-time pay)',
							statedHourly
						]
					: dailyPartTime && hourly != null
						? [
								person.terms.basic_salary,
								(hourly * contractedWeek) / person.terms.working_days_per_week,
								'a day',
								`${statedHourly} an hour × ${contractedWeek / person.terms.working_days_per_week} hours a day`
							]
						: monthlyPartTime && partTimeFullTimeWeek != null
							? [
									person.terms.monthly_basic,
									(wage * scale * contractedWeek) / partTimeFullTimeWeek,
									'a month',
									`${statedMonthly} a month × ${contractedWeek} / ${partTimeFullTimeWeek} weekly hours`
								]
							: hourly != null && person.employment.type === 'PART_TIME'
								? [
										person.terms.monthly_basic,
										hourly *
											scale *
											monthlyFactor(
												'HOURLY',
												{
													ordinary_hours_per_week: term.ordinary_hours_per_week ?? 0,
													working_days_per_week: person.terms.working_days_per_week
												},
												{ work: configuration.work, person }
											),
										'a month',
										`${statedHourly} an hour over ${term.ordinary_hours_per_week ?? 0} hours a week`
									]
								: [
										configuration.jurisdiction.work_rules.wages?.floor_includes_fixed_allowances ===
										true
											? person.terms.monthly_basic + person.terms.fixed_allowances
											: person.terms.monthly_basic,
										wage * scale,
										'a month',
										// Quote the floor this person is held to (PH: ₱755 × 261 ÷ 12 on a five-day week),
										// not the version's basis it is restated from.
										scale === 1
											? statedMonthly
											: `${cents(wage * scale)} (${statedMonthly} restated on this person's factor)`
									];
	return { person, paid, floor, unit, stated };
}

/**
 * Each reserved line's part paid for the days on which the person is a minimum-wage earner: the
 * contract in force that day paid at or below the floor of the version in force that day (RR
 * 11-2018 s.2.78.1(B)(13): the SMW is "the rate fixed by the RTWPB", which a wage order fixes from
 * its effective date). A line priced from a work day falls wholly on its date; every other line —
 * the salary, leave, an absence — is spread over the window's paid days (the scheduled working
 * days, every calendar day on a contract that pays rest days), the same share `period.leave_pay`
 * attributes the salary by. Zero on every line where no day of the window is such a day; the
 * whole of each line where every day is.
 */
function wageFloorPay(
	measured: MeasuredEmployment,
	configuration: Configuration,
	window: { readonly start: IsoDate; readonly end: IsoDate }
): Record<ReservedLine, number> {
	const { bundle } = measured;
	const earner = new Set<IsoDate>();
	let paidDays = 0;
	let earnerPaidDays = 0;
	for (const segment of versionSegments(configuration, window)) {
		const atFloor = new Map<string, boolean>();
		for (const day of daysBetween(segment.start, segment.end)) {
			const term =
				bundle.termsHistory.find((row) => coversDate(row.effective_range, day)) ??
				bundle.terms.at(-1);
			if (term == null) continue;
			let held = atFloor.get(term.id);
			if (held == null) {
				const against = wageAgainstFloor(
					segment.configuration,
					bundle,
					term,
					segment.end,
					measured
				);
				held = against != null && against.floor > 0 && against.paid <= cents(against.floor);
				atFloor.set(term.id, held);
			}
			const paid = term.paid_rest_days || measured.schedule.get(day)?.shift != null ? 1 : 0;
			paidDays += paid;
			if (!held) continue;
			earner.add(day);
			earnerPaidDays += paid;
		}
	}
	const share =
		paidDays > 0
			? earnerPaidDays / paidDays
			: earner.size / inclusiveDays(window.start, window.end);
	const dateOf = new Map<string, string>(
		bundle.workDays.map((row) => [row.id, dateKey(row.work_date)])
	);
	const weigh =
		(weight: number) =>
		<T extends { readonly amount: number }>(item: T): T => ({
			...item,
			amount: item.amount * weight
		});
	return {
		...accumulatePayslip({
			items:
				earner.size === 0
					? []
					: [
							...measured.base.map(weigh(share)),
							...measured.adjustments.map((item) => {
								const date = dateOf.get(item.input.id);
								return weigh(date == null ? share : earner.has(date) ? 1 : 0)(item);
							})
						],
			ordinaryHour: measured.ordinaryHourlyRate
		}).reserved
	};
}

/**
 * The window split where the company's lineage changes version: each run of days with the
 * configuration of the version in force on them. The run's own version (chosen at the period end)
 * governs only its own days; with a loaded lineage, an uncovered day refuses.
 */
function versionSegments(
	configuration: Configuration,
	window: { readonly start: IsoDate; readonly end: IsoDate }
): { start: IsoDate; end: IsoDate; days: number; configuration: Configuration }[] {
	const segments: { start: IsoDate; end: IsoDate; days: number; configuration: Configuration }[] =
		[];
	for (const day of daysBetween(window.start, window.end)) {
		const selected = settingsInForce(
			configuration.lineageVersions,
			configuration.jurisdiction.code,
			day
		);
		if (selected == null && configuration.lineageVersions.length > 0)
			refuse(`No sealed ${configuration.jurisdiction.code} settings version governs ${day}.`);
		const version = selected ?? configuration.jurisdiction;
		const last = segments.at(-1);
		if (last != null && last.configuration.jurisdiction.id === version.id) {
			last.end = day;
			last.days += 1;
			continue;
		}
		segments.push({
			start: day,
			end: day,
			days: 1,
			configuration:
				version.id === configuration.jurisdiction.id
					? configuration
					: {
							...configuration,
							jurisdiction: version,
							work: {
								// the custom field's check admits only `WorkRules`
								...(version.work_rules as WorkRules),
								settings_id: version.id,
								jurisdiction_code: version.jurisdiction_code
							}
						}
		});
	}
	return segments;
}

/**
 * A floor over a window that a wage order splits: each version's floor weighted by the calendar
 * days it governs, so `minimum_wage(...)` and `wage_floor` read the minimum wage the window as a
 * whole owes. RR 11-2018 s.2.78.1(B)(13) defines the SMW as "the rate fixed by the RTWPB", and a
 * wage order fixes it from its effective date, so the month's statutory minimum is the sum of each
 * day's rate in force; a monthly scheme test (RA 9504's `monthly_basic <= wage_floor`) compares
 * the month's wage with that month's minimum. A window one version governs reads that version's
 * floor unchanged. Null where no segment states one; a partially covered window is refused.
 */
function windowFloor(
	segments: ReturnType<typeof versionSegments>,
	floorOf: (configuration: Configuration) => number | null
): number | null {
	let days = 0;
	let total = 0;
	for (const segment of segments) {
		const floor = floorOf(segment.configuration);
		if (floor == null) continue;
		days += segment.days;
		total += floor * segment.days;
	}
	if (days > 0 && days !== segments.reduce((sum, segment) => sum + segment.days, 0))
		refuse('A minimum-wage order is missing for part of this pay window.');
	// ponytail: calendar-day weights; a roster-weighted floor if a daily order ever needs it.
	return days === 0 ? null : total / days;
}

/**
 * The monthly minimum wage that holds this person: their employment type's own order where the
 * version states one (`wages.by_employment_type`; PH RA 10361 s.24, domestic workers), else their
 * place's (`regionalMinimumWage`). A covered person without a sealed rate is refused.
 */
type WageConfiguration = Pick<Configuration, 'company' | 'jurisdiction'> &
	Partial<Pick<Configuration, 'recordedCompanyFacts' | 'companyFactRevisions'>>;

function classifiedWageKey(configuration: WageConfiguration, person: PersonContext): string | null {
	const classification = configuration.jurisdiction.work_rules.wages?.classified_by_worksite;
	if (classification == null) return null;
	const worksite = person.terms.worksite.trim();
	const domestic = person.employment.type === 'DOMESTIC';
	const sector = person.terms.worksite_sector.trim();
	if (worksite === '' || (!domestic && sector === ''))
		refuse(
			'Record the exact worksite (employment_terms.worksite) and wage-order sector (employment_terms.worksite_sector) before pricing this minimum wage.'
		);
	const rows = classification.rows.filter(
		(row) =>
			row.worksite === worksite &&
			(row.employment_type ?? '') === (domestic ? 'DOMESTIC' : '') &&
			(domestic || row.sector === sector)
	);
	if (rows.length === 0)
		refuse(`No sealed wage-order class covers ${worksite} (${domestic ? 'DOMESTIC' : sector}).`);
	const asOf = person.employment.history.as_of;
	const revision = configuration.companyFactRevisions?.find((row) =>
		coversDate(row.effective_range, asOf)
	);
	const facts =
		revision?.facts ?? configuration.recordedCompanyFacts ?? configuration.company.facts ?? {};
	const sized = rows.some((row) => row.min_workers != null || row.max_workers != null);
	let headcount = 0;
	if (sized) {
		// A size fact the version demands evidence for counts only from a dated, evidenced revision.
		if (
			[classification.single_establishment_fact, classification.headcount_fact].some(
				(key) =>
					configuration.jurisdiction.facts?.find((fact) => fact.key === key)?.evidence != null &&
					!(revision?.evidence_keys ?? []).includes(key)
			)
		)
			refuse(
				'A size-based wage class needs a dated establishment and worker-count source document.'
			);
		if (
			!Object.hasOwn(facts, classification.single_establishment_fact) ||
			facts[classification.single_establishment_fact] !== true
		)
			refuse('Record a verified single-establishment wage-order classification before payroll.');
		const declared = facts[classification.headcount_fact];
		if (!Predicate.isNumber(declared) || !Number.isInteger(declared) || declared < 0)
			refuse('Record the dated establishment worker count before pricing this wage order.');
		headcount = declared;
	}
	const matching = rows.filter(
		(row) =>
			(row.min_workers == null || headcount >= row.min_workers) &&
			(row.max_workers == null || headcount <= row.max_workers)
	);
	if (matching.length !== 1)
		refuse(`Exactly one sealed wage-order class must cover ${worksite} on ${asOf}.`);
	// Each required source is a declared terms input whose reference and file are its evidence.
	const missing = (matching[0]!.requires_evidence ?? []).filter(
		(key) => String(recordedFact(person.terms, key) ?? '').trim() === ''
	);
	if (missing.length > 0)
		refuse(
			`The ${matching[0]!.rate_key} wage-order class needs its dated source documents: ${missing.join(', ')}.`
		);
	return matching[0]!.rate_key;
}

function personMinimumWage(configuration: WageConfiguration, person: PersonContext): number {
	const byType =
		configuration.jurisdiction.work_rules.wages?.by_employment_type?.[person.employment.type];
	const classifiedKey = classifiedWageKey(configuration, person);
	const region = configuration.company.region ?? '';
	const typeRegion =
		byType == null || classifiedKey != null
			? ''
			: Object.keys(byType)
					.toSorted((a, b) => b.length - a.length)
					.find((key) => region === key || region.startsWith(`${key}-`));
	const wage =
		byType == null
			? classifiedKey == null
				? regionalMinimumWage(configuration, person)
				: configuration.jurisdiction.work_rules.wages?.by_region[classifiedKey]
			: byType[classifiedKey ?? typeRegion ?? ''];
	if (wage == null)
		refuse(
			`No sealed minimum-wage rate covers ${person.employment.type} at "${workplace(configuration, person)}" in ${configuration.jurisdiction.code}. Record a supported worksite and employment class before running payroll.`
		);
	return wage;
}

/**
 * The worksite sector code in the wage order's edition (`wages.sector_edition`): the code must match
 * `sector_code_pattern`, its attested edition (`terms.facts.worksite_sector_edition`) must be one of
 * `sector_editions`, the last of them only from `sector_edition_from`, and a code in that last
 * edition converts only through `sector_edition_map`.
 */
function sectorCode(
	wages: NonNullable<Configuration['jurisdiction']['work_rules']['wages']>,
	terms: NonNullable<Parameters<typeof recordedFact>[0]> & {
		readonly worksite_sector?: string | null;
	},
	asOf: IsoDate
): string {
	const code = terms.worksite_sector?.trim() ?? '';
	const edition = String(recordedFact(terms, 'worksite_sector_edition') ?? '').trim();
	const editions = wages.sector_editions ?? [];
	const latest = editions.at(-1);
	if (!new RegExp(wages.sector_code_pattern ?? '\\S').test(code))
		refuse(
			'Record the worksite sector code (employment_terms.worksite_sector) before pricing a sector wage.'
		);
	if (!editions.includes(edition) || wages.sector_edition == null)
		refuse(
			`Record a supported worksite sector edition (${editions.join(', ')}) in employment_terms.facts.worksite_sector_edition and a sealed wage-order edition before payroll.`
		);
	if (
		editions.length > 1 &&
		edition === latest &&
		(wages.sector_edition_from == null || asOf < wages.sector_edition_from)
	)
		refuse(`Sector edition ${edition} cannot classify this worksite on ${asOf}.`);
	if (edition === wages.sector_edition) return code;
	const converted = edition === latest ? wages.sector_edition_map?.[code] : null;
	if (converted == null)
		refuse(
			`No verified sector edition ${edition} ${code} conversion covers the wage order's ${wages.sector_edition} edition.`
		);
	return converted;
}

/**
 * The monthly floor a covered person's contract is held to: the place's, raised to every sector
 * row that binds them (`wages.monthly_by_sector`; ID PP 36/2021 as amended by PP 49/2025 art.35D).
 * A row binds at its place or inside it, for a worksite sector it lists, where its `when` holds.
 */
export function bindingMinimumWage(
	configuration: Configuration,
	person: PersonContext,
	asOf: IsoDate
): number {
	const wage = personMinimumWage(configuration, person);
	const wages = configuration.jurisdiction.work_rules.wages;
	if (wages?.monthly_by_sector == null) return wage;
	const sector =
		wages.sector_edition != null
			? sectorCode(wages, person.terms, asOf)
			: person.terms.worksite_sector;
	const place = canonicalPlace(wages.by_region, workplace(configuration, person));
	const localRows = wages.monthly_by_sector.filter(
		(row) => place === row.place || place.startsWith(`${row.place}/`)
	);
	const strictSector = (wages.strict_sector_places ?? []).some(
		(row) => place === row || place.startsWith(`${row}/`)
	);
	if (
		(localRows.length > 0 || strictSector) &&
		!new RegExp(wages.sector_code_pattern ?? '\\S').test(sector)
	)
		refuse(
			`Record the worksite sector code (employment_terms.worksite_sector) before pricing the sector minimum wage at "${place}".`
		);
	const sectorRows = localRows.filter((row) => row.sector_codes.includes(sector));
	if (sectorRows.length === 0) {
		if (
			strictSector &&
			!(wages.verified_ordinary_sectors ?? []).some(
				(row) => row.place === place && row.sector_code === sector
			)
		)
			refuse(
				`The sector wage order for ${place} sector ${person.terms.worksite_sector} is not verified; no ordinary-floor fallback is allowed.`
			);
		return wage;
	}
	const revision = configuration.companyFactRevisions.find((row) =>
		coversDate(row.effective_range, asOf)
	);
	const rawFacts = revision?.facts ?? configuration.recordedCompanyFacts ?? {};
	for (const row of sectorRows)
		for (const key of row.when?.matchAll(/company\.facts\.([A-Za-z_][A-Za-z0-9_]*)/g) ?? [])
			if (!Object.hasOwn(rawFacts, key[1]!))
				refuse(
					`Record ${key[1]} for ${place} sector ${person.terms.worksite_sector} before pricing its sector minimum wage.`
				);
	const datedFacts = resolveCompanyFacts(
		configuration.jurisdiction.facts ?? [],
		{ ...configuration.company, facts: configuration.recordedCompanyFacts },
		{ asOf, revisions: configuration.companyFactRevisions }
	);
	const datedPerson = { ...person, company: { ...person.company, facts: datedFacts } };
	const invalid = sectorRows.find(
		(row) => row.valid_when != null && !isEligible(row.valid_when, datedPerson)
	);
	if (invalid != null) refuse(invalid.validation_message!);
	return Math.max(
		wage,
		...sectorRows.filter((row) => isEligible(row.when, datedPerson)).map((row) => row.amount)
	);
}

/** Where a person's monthly floor is read: their recorded worksite on a workplace-keyed table, else the company's region. */
function workplace(
	configuration: Pick<Configuration, 'company' | 'jurisdiction'>,
	person?: PersonContext
): string {
	const keyed =
		configuration.jurisdiction.work_rules.wages?.workplace_keyed === true ||
		configuration.jurisdiction.work_rules.wages?.classified_by_worksite != null;
	return (
		(keyed && person?.terms.worksite ? person.terms.worksite : configuration.company.region) ?? ''
	);
}

/** The person's monthly rate for this window; an unresolved mid-month worksite change refuses. */
export function windowMinimumWage(
	configuration: Configuration,
	window: { readonly start: IsoDate; readonly end: IsoDate },
	termsHistory: EmploymentBundle['termsHistory'],
	employeeNumber?: string
): number {
	return naming(employeeNumber ?? '', () =>
		windowWage(configuration, window, termsHistory, employeeNumber)
	);
}

function windowWage(
	configuration: Configuration,
	window: { readonly start: IsoDate; readonly end: IsoDate },
	termsHistory: EmploymentBundle['termsHistory'],
	employeeNumber?: string
): number {
	let total = 0;
	let days = 0;
	let missing = 0;
	const workplaces = new Set<string>();
	const classification = configuration.jurisdiction.work_rules.wages?.classified_by_worksite;
	if (
		classification != null &&
		configuration.companyFactRevisions.some((revision) => {
			const range = readRange(revision.effective_range);
			return (
				range != null &&
				[dateKey(range.start), dateKey(range.end)].some(
					(day) => day > window.start && day <= window.end
				) &&
				[classification.single_establishment_fact, classification.headcount_fact].some((key) =>
					Object.hasOwn(revision.facts, key)
				)
			);
		})
	)
		refuse('An establishment wage classification changes inside this pay window.');
	for (const segment of versionSegments(configuration, window))
		for (const day of daysBetween(segment.start, segment.end)) {
			const terms = termsHistory.find((row) => coversDate(row.effective_range, day));
			if (terms == null)
				refuse(`${employeeNumber ?? 'A minimum-wage trace'} needs employment terms on ${day}.`);
			const monthlyOrder = segment.configuration.jurisdiction.work_rules.wages;
			if (monthlyOrder?.workplace_keyed) {
				const site = terms.worksite?.trim() || configuration.company.region || '';
				const range = readRange(terms.effective_range);
				const sector =
					monthlyOrder.sector_edition == null
						? null
						: sectorCode(monthlyOrder, terms, range == null ? day : dateKey(range.start));
				workplaces.add(sector == null ? site : `${site}|${sector}`);
			}
			if (segment.configuration.jurisdiction.work_rules.wages?.classified_by_worksite)
				workplaces.add(`${terms.worksite?.trim() ?? ''}|${terms.worksite_sector?.trim() ?? ''}`);
			const wage =
				Object.keys(monthlyOrder?.by_region ?? {}).length === 0 &&
				Object.keys(monthlyOrder?.by_employment_type ?? {}).length === 0
					? null
					: personMinimumWage(
							segment.configuration,
							personContext({
								employee: null,
								employment: { service_start: '' },
								terms,
								company: segment.configuration.company,
								asOf: day
							})
						);
			if (wage == null) {
				missing += 1;
				continue;
			}
			total += wage;
			days += 1;
		}
	if (workplaces.size > 1)
		refuse(
			'A workplace or wage class change inside one pay window needs an approved monthly minimum-wage basis.'
		);
	if (days > 0 && missing > 0)
		refuse('A minimum-wage order is missing for part of this pay window.');
	return days === 0 ? 0 : total / days;
}

/** The monthly minimum wage at the person's workplace (the company's region without one) under the version in force, or null where none is stated. */
function regionalMinimumWage(
	configuration: WageConfiguration,
	person?: PersonContext,
	worksite?: string
): number | null {
	const wages = configuration.jurisdiction.work_rules.wages;
	const table = wages?.by_region ?? {};
	// A class with its own table (a domestic worker's order) is keyed by the same classification.
	if (wages?.classified_by_worksite != null)
		return person == null
			? null
			: ((wages.by_employment_type?.[person.employment.type] ?? table)[
					classifiedWageKey(configuration, person)!
				] ?? null);
	const place = wages?.workplace_keyed && worksite ? worksite : workplace(configuration, person);
	if (wages?.workplace_keyed) {
		const exact = canonicalPlace(table, place);
		return exact.includes('/') || wages.standalone_workplaces?.includes(exact)
			? (table[exact] ?? null)
			: null;
	}
	return placeWage(table, place);
}

/**
 * The contractual monthly wage — basic and the standing allowances — averaged over the last
 * `months` months of the employment ending on `asOf`: the terms in force on the first of each
 * month, from the employment's start at the earliest. What VN art.46 measures severance on.
 */
export function monthlyWageAverage(
	bundle: Pick<EmploymentBundle, 'termsHistory' | 'terms' | 'employment'>,
	configuration: Configuration,
	asOf: string,
	months: number
): number | null {
	const start = employmentDates(bundle.employment).hire;
	const year = Number.parseInt(asOf.slice(0, 4), 10);
	const month = Number.parseInt(asOf.slice(5, 7), 10);
	const wages: number[] = [];
	for (let offset = 0; offset < months; offset += 1) {
		const index = year * 12 + (month - 1) - offset;
		const first = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
		const date = first < start ? start : first;
		if (date > asOf || (start !== '' && date < start)) continue;
		const terms = bundle.termsHistory.find((row) => coversDate(row.effective_range, date));
		if (terms == null)
			throw new Error(`Separation wage average requires contractual wage terms on ${date}.`);
		const basic = terms.base_salary ?? 0;
		wages.push(basic + contractAllowancesOn(bundle as EmploymentBundle, configuration, date));
	}
	return wages.length === 0 ? null : wages.reduce((sum, wage) => sum + wage, 0) / wages.length;
}

export function configuredMonthlyWageAverage(
	bundle: Pick<EmploymentBundle, 'termsHistory' | 'terms' | 'employment'>,
	configuration: Configuration,
	asOf: string,
	version = configuration.jurisdiction
): number {
	const months = version.payroll.separation_wage_average_months;
	if (months == null)
		throw new Error('Separation wage average requires months in the sealed payroll rule.');
	if (!Number.isInteger(months) || months <= 0)
		throw new Error('Separation wage average months must be a positive integer.');
	const average = monthlyWageAverage(bundle, configuration, asOf, months);
	if (average == null) throw new Error('Separation wage average requires dated contractual wages.');
	return average;
}

export function prepareContributionAssessment(
	options: Parameters<typeof contributionAssessment>[0]
): ContractAssessment {
	return naming(options.measured.bundle.employment.employee_number, () =>
		contributionAssessment(options)
	);
}

function contributionAssessment(options: {
	readonly measured: MeasuredEmployment;
	readonly configuration: Configuration;
	readonly projection: ContractAssessment['calculation']['projection'];
	readonly yearToDate: ReadonlyMap<
		string,
		{ employee: number; employer: number; base: number; ordinary: number; rebate?: number }
	>;
	/** Like `yearToDate`, for the tax year before this one; no prior-employer opening. */
	readonly lastYear?:
		| ReadonlyMap<string, { employee: number; employer: number; base: number; ordinary: number }>
		| undefined;
	/** `${employee_id}:${code}` → the earliest tax year an earlier slip charged a base. */
	readonly firstYear?: ReadonlyMap<string, number> | undefined;
	readonly headcount: number;
	readonly headcountCitizens?: number | undefined;
	/** component code → what this employee's earlier payslips earned this tax year. */
	readonly yearEarned: ReadonlyMap<string, number>;
	readonly statutoryHistory: readonly StatutoryPeriodHistory[];
	readonly yearQuantityPayments?: ReadonlyMap<string, readonly QuantityPayment[]> | undefined;
	/** calendar month → component code → what this employee's earlier payslips earned. */
	readonly earnedByMonth?: ReadonlyMap<string, ReadonlyMap<string, number>> | undefined;
	readonly paidWagesByMonth?: ReadonlyMap<string, number> | undefined;
	/** What the month's earlier instalments settled and charged, at a semi-monthly or weekly cadence. */
	readonly monthPrior?: MonthPrior | undefined;
}): ContractAssessment {
	const { measured, configuration, projection, headcount } = options;
	const { bundle } = measured;
	const asOf =
		bundle.employedDays?.end ?? employmentDates(bundle.employment).exit ?? bundle.window.salary.end;
	const { facts, currentFacts, coverageByScheme, standingsByScheme } = coverageFacts(
		bundle,
		configuration,
		asOf
	);
	const payMonth = monthBounds(bundle.window.period.slice(0, 7));
	for (const scheme of configuration.contributions) {
		if (scheme.row.assessment_period === 'PAY_PERIOD') continue;
		const keys = new Set(
			schemeExpressions(scheme).flatMap((expression) =>
				[...expression.matchAll(/company\.facts\.([A-Za-z_][A-Za-z0-9_]*)/g)].map(
					(match) => match[1]!
				)
			)
		);
		for (const revision of configuration.companyFactRevisions) {
			const range = readRange(revision.effective_range);
			if (range == null) continue;
			const boundaries = [dateKey(range.start)];
			if (range.end != null) boundaries.push(addDays(dateKey(range.end), 1));
			const changed = [...keys].find(
				(key) =>
					Object.hasOwn(revision.facts, key) &&
					boundaries.some((date) => date > payMonth.start && date <= payMonth.end)
			);
			if (changed != null)
				refuse(
					`${changed} changes inside the pay month; ${scheme.row.code} needs a dated monthly assessment basis.`
				);
		}
	}
	const startMonth0 = configuration.jurisdiction.payroll.tax_year_start_month;
	const taxYear = taxYearOf(bundle.window.period, startMonth0);
	/** An opening belongs to the person or this employer as the dated scheme declares. */
	const openingFor = (code: string) => {
		const scheme = configuration.contributions.find((row) => row.row.code === code);
		const status = scheme == null ? undefined : facts.get(scheme.row.id);
		if (scheme == null || status?.kind !== 'REGISTERED') return null;
		const rows = (status.opening ?? []).filter((row) => row.year === taxYear);
		if (scheme.row.opening_scope !== 'EMPLOYER') return rows[0] ?? null;
		for (const row of rows) {
			if (row.origin == null)
				refuse(
					`${code}: classify each opening as current, other or Board-approved related employer.`
				);
			if (
				row.origin === 'APPROVED_RELATED_EMPLOYER' &&
				(!row.board_approval_reference?.trim() ||
					row.employers_related !== true ||
					row.employee_informed !== true ||
					row.terms_unchanged !== true ||
					row.transferred_employee !== true)
			)
				refuse(
					`${code}: related-employer opening requires Board approval and transfer conditions.`
				);
		}
		const included = rows.filter((row) => row.origin !== 'OTHER_EMPLOYER');
		for (const row of included)
			if (row.ordinary == null || row.ordinary < 0 || row.ordinary > row.base)
				refuse(
					`${code}: current-employer opening requires the ordinary wage subject to contributions.`
				);
		if (included.length === 0) return null;
		return included.reduce((sum, row) => ({
			...sum,
			base: sum.base + row.base,
			employee: sum.employee + row.employee,
			employer: sum.employer + row.employer,
			ordinary: (sum.ordinary ?? 0) + (row.ordinary ?? 0),
			rebate: (sum.rebate ?? 0) + (row.rebate ?? 0),
			months: (sum.months ?? 0) + (row.months ?? 0),
			payroll_periods: (sum.payroll_periods ?? 0) + (row.payroll_periods ?? 0)
		}));
	};
	const openingMonths = configuration.contributions.reduce(
		(most, scheme) => Math.max(most, openingFor(scheme.row.code)?.months ?? 0),
		0
	);
	const assessmentFrequency: AssessmentFrequency =
		bundle.payFrequency === 'SEMI_MONTHLY'
			? 'SEMI_MONTHLY'
			: bundle.payFrequency === 'WEEKLY'
				? 'WEEKLY'
				: 'MONTHLY';
	// Computed only when a scheme's own expressions mention `history`: the cumulative-average
	// summary is a seed-selectable method, never a jurisdiction branch in the engine.
	const historyPeriodCodes = new Set(
		configuration.contributions.flatMap((scheme) =>
			schemeExpressions(scheme).flatMap((expression) =>
				[...expression.matchAll(/history\.([A-Z0-9_]+)\.periods\b/g)].map((match) => match[1]!)
			)
		)
	);
	let cumulativeHistory: ReadonlyMap<string, StatutoryHistorySummary> | null = null;
	const historyFor = (code: string): StatutoryHistorySummary | undefined => {
		cumulativeHistory ??= summarizeHistory({
			periods: options.statutoryHistory,
			openings: new Map(
				configuration.contributions.flatMap((scheme) => {
					const opening = openingFor(scheme.row.code);
					return opening == null ? [] : [[scheme.row.code, opening] as const];
				})
			),
			frequency: assessmentFrequency,
			weeksPerMonth: () =>
				monthlyFactor('WEEKLY', person.terms, { work: configuration.work, person }),
			requirePeriodsFor: historyPeriodCodes,
			triggers: new Map(
				configuration.contributions.flatMap((scheme) =>
					scheme.row.history_trigger == null
						? []
						: [[scheme.row.code, scheme.row.history_trigger] as const]
				)
			)
		});
		return cumulativeHistory.get(code);
	};
	const personInput = {
		employee: bundle.employee,
		employment: {
			...stint(bundle.employment, configuration.jurisdiction.exit_facts ?? []),
			risk_class: configuration.company.risk_class
		},
		fixedAllowances: contractAllowancesOn(bundle, configuration, asOf),
		presence: bundle.presence,
		terms:
			bundle.termsHistory.find((row) => coversDate(row.effective_range, asOf)) ??
			bundle.terms.at(-1) ??
			null,
		children: bundle.children,
		week: measured.week,
		company: {
			...configuration.company,
			headcount,
			headcount_citizens: options.headcountCitizens ?? headcount
		},
		// The pay month's working days and the employed ones it did not pay, so a scheme can count
		// the days without wages (VN art.33(5): fourteen or more in the month contribute nothing).
		period: {
			working_days: measured.periodWorkingDays,
			unpaid_days: measured.periodUnpaidDays,
			unpaid_full_days: measured.periodFullyUnpaidDays,
			leave_days: measured.periodLeaveDays,
			leave_full_days: measured.periodFullLeaveDays,
			leave_pay: measured.periodLeavePay,
			overtime_days: measured.periodOvertimeDays,
			arrears: measured.arrears?.amount ?? 0
		},
		facts: personFacts(configuration.contributions, currentFacts),
		asOf
	};
	const person = personContext({
		...personInput,
		divisorDays: divisorFor(configuration, personInput, bundle.employment.employee_number)
	});
	const covered = minimumWageCovers(configuration, person);
	// The terms in force across the window, where the residency they record changes inside it
	// (a foreigner becomes a permanent resident, a permanent resident a citizen): each status's
	// person and its share of the wage, the payslip's own proration segments of it (CPF Board FAQs
	// on a mid-month SPR grant and citizenship: the OW is pro-rated at the status date).
	const span = bundle.employedDays ?? bundle.window.salary;
	const residencyKey = (row: EmploymentBundle['terms'][number]) =>
		`${row.residency_status ?? ''}|${dateKey(row.residency_since)}`;
	const residencyTerms = effectiveWithin(bundle.termsHistory, span.start, span.end).filter(
		(row, index, rows) => index === 0 || residencyKey(row) !== residencyKey(rows[index - 1]!)
	);
	const wageCode = measured.base.find(
		(line) => line.catalogueComponent.definition?.source === 'SCHEDULE'
	)?.catalogueComponent.code;
	const wageSegments = measured.proration.filter((segment) => segment.component_code === wageCode);
	const residencyWeights = residencyTerms.map((row, index) => {
		const from = dateKey(readRange(row.effective_range)?.start);
		const until = dateKey(readRange(residencyTerms[index + 1]?.effective_range)?.start);
		const inside = (date: string) => date >= from && (until === '' || date < until);
		// ponytail: an hourly or daily contract prorates nothing, so its share is calendar days;
		// date the work lines themselves if a statute ever needs the worked days.
		return wageSegments.length > 0
			? wageSegments
					.filter((segment) => inside(segment.from))
					.reduce((sum, segment) => sum + segment.prorated_amount, 0)
			: inclusiveDays(
					from > span.start ? from : span.start,
					until !== '' && addDays(until, -1) < span.end ? addDays(until, -1) : span.end
				);
	});
	const residencyTotal = residencyWeights.reduce((sum, weight) => sum + weight, 0);
	const residencySegments =
		residencyTerms.length < 2 || residencyTotal <= 0
			? undefined
			: residencyTerms.map((row, index) => {
					const own = personContext({
						...personInput,
						terms: row,
						divisorDays: divisorFor(
							configuration,
							{ ...personInput, terms: row },
							bundle.employment.employee_number
						)
					});
					return {
						employee: own.employee,
						terms: own.terms,
						share: residencyWeights[index]! / residencyTotal
					};
				});
	// The floor is the region's wage where the order covers this person — at the order's own share
	// of it for an apprentice — and 0 where it does not; the person root carries both, so a formula
	// may read either. A wage order commencing inside the employed window weights each version's
	// floor by the days it governs (`windowFloor`).
	const wageWindow = bundle.employedDays ?? bundle.arrearsFor?.days ?? bundle.deferral?.days;
	const segments = versionSegments(configuration, wageWindow ?? bundle.window.salary);
	const workplaceKeyed = segments.some(
		(segment) => segment.configuration.jurisdiction.work_rules.wages?.workplace_keyed === true
	);
	const classified = segments.some(
		(segment) => segment.configuration.jurisdiction.work_rules.wages?.classified_by_worksite != null
	);
	if (classified && wageWindow != null)
		windowMinimumWage(
			configuration,
			wageWindow,
			bundle.termsHistory,
			bundle.employment.employee_number
		);
	if (
		workplaceKeyed &&
		segments.some(
			(segment) =>
				(segment.configuration.jurisdiction.work_rules.wages?.scale ?? '').trim() !== '' ||
				(segment.configuration.jurisdiction.work_rules.wages?.applies_when ?? '').trim() !== ''
		)
	)
		refuse(
			'A workplace-keyed wage floor with variable coverage or scale needs dated person assessment.'
		);
	const minimumWage = workplaceKeyed
		? wageWindow == null
			? 0
			: windowMinimumWage(
					configuration,
					wageWindow,
					bundle.termsHistory,
					bundle.employment.employee_number
				)
		: windowFloor(segments, (version) => regionalMinimumWage(version, person));
	const floor = workplaceKeyed
		? (minimumWage ?? refuse('A workplace-keyed minimum wage is missing.'))
		: (windowFloor(segments, (version) => personWageFloor(version, person)) ?? 0);
	const startMonth = configuration.jurisdiction.payroll.tax_year_start_month;
	const bounds = taxYearBounds(bundle.window.period, startMonth);
	const dates = employmentDates(bundle.employment);
	const from = dates.hire > bounds.start ? dates.hire : bounds.start;
	const through =
		dates.exit != null && dates.exit < bundle.window.salary.end
			? dates.exit
			: bundle.window.salary.end;
	const employed = through >= from;
	const dependentReliefMonths = (code: string): number => {
		const scheme = configuration.contributions.find((entry) => entry.row.code === code);
		if (scheme == null) refuse(`${code}: no statutory scheme governs annual dependant relief.`);
		let months = 0;
		for (
			let date = bounds.start;
			date <= bounds.end;
			date = addDays(monthBounds(date.slice(0, 7)).end, 1)
		) {
			const status = factStatusesOn(
				bundle.statutoryFacts,
				date,
				bundle.employment.id,
				configuration.contributions
			).get(scheme.row.id);
			const registered = status?.kind === 'REGISTERED' ? status : null;
			const count = registered?.elections?.eligible_dependents;
			if (!Predicate.isNumber(count) || !Number.isInteger(count) || count < 0)
				refuse(
					`${code}: record a dated eligible dependant count for ${date.slice(0, 7)} before annual finalisation.`
				);
			const reference = registered?.elections?.dependents_registration_reference;
			if (count > 0 && (!Predicate.isString(reference) || reference.trim() === ''))
				refuse(
					`${code}: record dependant registration evidence for ${date.slice(0, 7)} before annual finalisation.`
				);
			months += count;
		}
		return months;
	};
	return {
		employment: bundle.employment,
		window: bundle.window,
		calculation: {
			accumulation: accumulatePayslip({
				items: [...measured.base, ...measured.adjustments],
				ordinaryHour: measured.ordinaryHourlyRate
			}),
			contributions: configuration.contributions,
			facts,
			currentFacts,
			coverageByScheme,
			standingsByScheme,
			residencySegments,
			// This tenant's earlier slips plus what an earlier employer declared for the year (the
			// fact's `opening`, MY TP3 / PH 2316): the person's year, not the contract's.
			yearToDate: (code) => {
				const own = options.yearToDate.get(`${bundle.employment.employee_id}:${code}`) ?? {
					employee: 0,
					employer: 0,
					base: 0,
					ordinary: 0
				};
				const opening = openingFor(code);
				return opening == null
					? own
					: {
							employee: own.employee + opening.employee,
							employer: own.employer + opening.employer,
							base: own.base + opening.base,
							ordinary: own.ordinary + (opening.ordinary ?? 0),
							rebate: (own.rebate ?? 0) + (opening.rebate ?? 0)
						};
			},
			lastYear: (code) =>
				options.lastYear?.get(`${bundle.employment.employee_id}:${code}`) ?? {
					employee: 0,
					employer: 0,
					base: 0,
					ordinary: 0
				},
			firstYear: (code) => options.firstYear?.get(`${bundle.employment.employee_id}:${code}`) ?? 0,
			dependentReliefMonths,
			yearEarned: options.yearEarned,
			history: (code) =>
				historyFor(code) ?? {
					periods: 0,
					base: 0,
					ordinary: 0,
					employee: 0,
					employer: 0,
					triggered: false,
					hasOpening: false,
					periodsRecorded: true
				},
			yearQuantityPayments: options.yearQuantityPayments,
			earnedByMonth: options.earnedByMonth,
			paidWagesByMonth: options.paidWagesByMonth,
			trailingWageMonths: {
				short: configuration.jurisdiction.payroll.trailing_wage_short_months,
				long: configuration.jurisdiction.payroll.trailing_wage_long_months
			},
			monthPrior: options.monthPrior,
			monthlyContributionDays: measured.monthlyContributionDays,
			componentsByCode: new Map(
				configuration.catalogueComponents.map((component) => [
					component.code,
					{ family: component.family, counts_toward: component.counts_toward }
				])
			),
			period: {
				key: bundle.window.period,
				start: bundle.window.salary.start,
				end: bundle.window.salary.end,
				payDate: bundle.window.payDate,
				settingsRange: governed(configuration.jurisdiction.effective_range),
				// How this period sits in the month: a scheme assessed over the MONTH is charged once,
				// in the period that owns the month's start, on the month's wage. The cadence is the
				// employment's own, not the company's: a MONTHLY employment inside a SEMI_MONTHLY company
				// is paid once, in the `-2` run, and that one instalment is its whole month.
				index:
					bundle.window.payFrequency === 'SEMI_MONTHLY' || bundle.window.payFrequency === 'WEEKLY'
						? (periodHalf(bundle.window.period) ?? 1)
						: 1,
				instalments:
					bundle.window.payFrequency === 'SEMI_MONTHLY'
						? 2
						: bundle.window.payFrequency === 'WEEKLY'
							? weeklyInstalments(bundle.window.period).length
							: 1,
				// A MONTH-assessed scheme reads the month's wage from one instalment: a half is doubled,
				// a week is the version's weeks a month (`rate_conversions.weekly_to_monthly`).
				monthFactor:
					bundle.window.payFrequency === 'SEMI_MONTHLY'
						? 2
						: bundle.window.payFrequency === 'WEEKLY'
							? monthlyFactor('WEEKLY', person.terms, { work: configuration.work, person })
							: 1,
				// A weekly company charges the month's schemes in the last week, when the month is known.
				monthlyOn:
					bundle.window.payFrequency === 'WEEKLY'
						? 'LAST'
						: statutoryCutoff(configuration.company.semi_monthly_statutory_cutoff),
				lastOfYear:
					closesTaxYear(bundle.window.period, startMonth, bundle.window.payFrequency) ||
					(dates.exit != null && dates.exit <= bundle.window.salary.end),
				// The days of the month the person was employed: the salary's prorated segments where
				// the wage is a month's, else — an hourly or daily contract prorates nothing — the
				// employment's own span inside the pay month (TW 勞保條例施行細則 §28-1: the premium is
				// for every enrolled day, whatever the hours worked).
				daysEmployed: (() => {
					// The wage's own segments: an allowance's are the same days over again.
					const wage = measured.base.find(
						(line) => line.catalogueComponent.definition?.source === 'SCHEDULE'
					)?.catalogueComponent.code;
					const segments = measured.proration.filter(
						(segment) => wage != null && segment.component_code === wage
					);
					return segments.length > 0
						? segments.reduce((total, segment) => total + segment.days, 0)
						: employedDaysIn(dates, bundle.window.salary);
				})(),
				daysInMonth: monthDays(bundle.window.salary.start)
			},
			currency: measured.currency,
			year: {
				start: bounds.start,
				end: bounds.end,
				// The calendar months of the year the employment touches, the join and exit months
				// whole: a month with any income in it is a month of income (ID PMK 168/2023 art.10(2):
				// the biaya jabatan cap is Rp500,000 a month, and a joiner on the 15th earns in that month).
				months_employed: (employed ? calendarMonthsTouched(from, through) : 0) + openingMonths,
				// A monthly count keeps the declared prior-employer months, as `months_employed` does.
				// ponytail: a weekly or semi-monthly opening is not converted into payments.
				payments:
					bundle.window.payFrequency === 'WEEKLY' || bundle.window.payFrequency === 'SEMI_MONTHLY'
						? paymentsDue(bundle.window.payFrequency, from, bounds.end)
						: calendarMonthsTouched(from, bounds.end) + openingMonths
			},
			projection,
			person: {
				...person,
				wage_floor: floor,
				wage_floor_pay: configuration.contributions.some((scheme) =>
					schemeExpressions(scheme).some((expression) => expression.includes('wage_floor_pay'))
				)
					? wageFloorPay(measured, configuration, bundle.employedDays ?? bundle.window.salary)
					: person.wage_floor_pay
			},
			// A scheme reads the contract's allowances that count toward it (RFC catalogue-classes
			// §3.4): VN's insurance-equivalent allowance is on the contract and outside every
			// insurance base, so SI's `terms.fixed_allowances` leaves it out where PIT's keeps it.
			fixedAllowancesFor: (scheme) => contractAllowancesOn(bundle, configuration, asOf, scheme),
			minimumWage,
			minimumWageApplies: covered
		}
	};
}

/** The calendar days of the pay window inside the employment, zero when it never touches it. */
function employedDaysIn(dates: EmploymentDates, window: PayrollWindow['salary']): number {
	const start = dates.hire > window.start ? dates.hire : window.start;
	const end = dates.exit != null && dates.exit < window.end ? dates.exit : window.end;
	return end >= start ? inclusiveDays(start, end) : 0;
}

/**
 * The weekly or semi-monthly paydays of the tax year from `from` (the join, or the year's start)
 * to `yearEnd`, each instalment counted whose period ends on or after `from` (TH P.96/2543 cl.1(1):
 * the payments due in the year, the remaining ones in the year of hire).
 */
function paymentsDue(
	frequency: 'WEEKLY' | 'SEMI_MONTHLY',
	from: IsoDate,
	yearEnd: IsoDate
): number {
	let count = 0;
	for (let month = from.slice(0, 7); month <= yearEnd.slice(0, 7); month = shiftPeriod(month, 1))
		count += (
			frequency === 'WEEKLY'
				? weeklyInstalments(month).map((week) => week.salary.end)
				: [`${month}-15`, monthBounds(month).end]
		).filter((end) => end >= from).length;
	return count;
}

/** The calendar months from the month of `from` to the month of `through`, both counted whole. */
function calendarMonthsTouched(from: IsoDate, through: IsoDate): number {
	const months = (date: IsoDate) =>
		Number.parseInt(date.slice(0, 4), 10) * 12 + Number.parseInt(date.slice(5, 7), 10);
	return months(through) - months(from) + 1;
}
