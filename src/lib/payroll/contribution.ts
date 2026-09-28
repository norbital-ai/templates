import type { StatutoryFact } from './run/statutory-facts.js';
import type { WorkRules } from '../datatypes/work_rules.js';
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
			result.set(first.employment.id, contribute(input));
			continue;
		}
		const accumulations = ordered.map((contract) => contract.calculation.accumulation);
		const charges = contribute({
			...input,
			accumulation: sumAccumulations(accumulations),
			parts: accumulations
		});
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
import { ordinaryDivisorDays } from '../../lib/payroll/run/ordinary-rate.js';
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
import type { MeasuredEmployment } from './family.js';
import {
	philippinesCumulativeHistory,
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
		if (!schemeExpressions(scheme).some((expression) => expression.includes('coverage_days_30(')))
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
		year: { start: bounds.start, end: bounds.end, months_employed: 0 },
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

/** The person's floor under one version: their order's wage at its `scale`, 0 where it excludes them. */
export function personWageFloor(
	configuration: Pick<Configuration, 'company' | 'jurisdiction'>,
	person: PersonContext
): number {
	return minimumWageCovers(configuration, person)
		? (personMinimumWage(configuration, person) ?? 0) * minimumWageScale(configuration, person)
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
export function minimumWageIssues(options: {
	readonly configuration: Configuration;
	readonly bundles: readonly EmploymentBundle[];
	readonly measured?: readonly MeasuredEmployment[];
	/** The run's charges by employment, for a floor stated net of the employee's shares. */
	readonly charges?: ReadonlyMap<string, readonly ContributionCharge[]>;
	readonly asOf: string;
}): RunIssue[] {
	const issues: RunIssue[] = [];
	const measuredByEmployment = new Map(
		(options.measured ?? []).map((row) => [row.bundle.employment.id, row])
	);
	for (const bundle of options.bundles) {
		if (bundle.employedDays == null || bundle.deferral != null) continue;
		const segments = versionSegments(options.configuration, bundle.employedDays);
		for (const segment of segments) {
			const { configuration } = segment;
			issues.push(
				...dailyFloorIssues(
					configuration,
					bundle,
					segment,
					measuredByEmployment.get(bundle.employment.id)
				)
			);
			const datedTerms = effectiveWithin(bundle.termsHistory, segment.start, segment.end);
			for (const term of datedTerms.length > 0 ? datedTerms : bundle.terms.slice(-1)) {
				const range = readRange(term.effective_range);
				const from = range == null ? segment.start : dateKey(range.start);
				const through = range?.end == null ? segment.end : dateKey(range.end);
				const start = from > segment.start ? from : segment.start;
				const asOf = through < segment.end ? through : segment.end;
				if (start > asOf) continue;
				const against = wageAgainstFloor(
					configuration,
					bundle,
					term,
					asOf,
					measuredByEmployment.get(bundle.employment.id)
				);
				if (against == null) continue;
				const { person } = against;
				const during =
					segments.length > 1 || datedTerms.length > 1 ? ` from ${start} to ${asOf}` : '';
				// The wages order's rule on the contract's composition (ID: basic at least 75% of the wage).
				const termsWhen = (configuration.jurisdiction.work_rules.wages?.terms_when ?? '').trim();
				if (termsWhen !== '' && !isEligible(termsWhen, person))
					issues.push({
						code: 'WAGE_TERMS_RULE',
						severity: 'WARNING',
						message:
							`${bundle.employment.employee_number}'s contract does not satisfy the version's wage rule ` +
							`\`${termsWhen}\` (basic ${person.terms.basic_salary}, fixed allowances ${person.terms.fixed_allowances})${during}. ` +
							'The run pays the contract; restate the terms or record why they stand.',
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
				issues.push({
					code: 'MINIMUM_WAGE_BELOW',
					severity: blocking ? 'BLOCKER' : 'WARNING',
					message:
						`${bundle.employment.employee_number} is contracted at ${payable} ${unit}` +
						(withheld > 0 ? ` net of ${cents(withheld)} employee ${netOf.join('/')} shares` : '') +
						', below the ' +
						`${workplace(configuration, person)} minimum wage of ${stated} the version states${during}. ` +
						(blocking
							? 'Raise the contract terms before running payroll.'
							: 'The run pays the contract; raise the terms or record why the wage stands.'),
					collection: 'employment_terms',
					recordId: term.id
				});
			}
		}
	}
	return issues;
}

/**
 * A daily floor by worksite and sector (TH Minimum Wage Notice 14): each normal working day, at
 * the worksite and sector its terms record that day, is held to the higher of the place's rate (a
 * district key overriding its province) and the sector's. The day is the normal day however short
 * the employer makes it (cl.19), so a daily rate meets the whole floor and an hourly rate meets it
 * over the day's scheduled hours. A monthly or semi-monthly wage (`base_salary` is the month for
 * both) is the month over the version's `ordinary_divisor_days`, a weekly one its month (× 52 ÷ 12)
 * over it (owner rule 2026-09-28, register TH-WAGE-01: daily × 30, LPA s.68's monthly ÷ 30).
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
	const judged = new Map<string, { blocking: boolean; divisor: number } | null>();
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
							})
						}
					: null
			);
		}
		const judgement = judged.get(term.id);
		if (judgement == null) continue;
		const site = term.worksite?.trim() ?? '';
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
		const paid =
			term.pay_frequency === 'DAILY'
				? rate
				: term.pay_frequency === 'HOURLY'
					? (rate * day.shift.paid_minutes) / 60
					: term.pay_frequency === 'WEEKLY'
						? (rate * 52) / 12 / judgement.divisor
						: rate / judgement.divisor;
		if (cents(paid) >= cents(floor)) continue;
		const at = sectorKey === '' ? site : `${site} ${sectorKey}`;
		const key = `${term.id}:${at}:${floor}:${cents(paid)}`;
		const seen = below.get(key);
		if (seen == null)
			below.set(key, { term, first: day.date, days: 1, paid: cents(paid), floor, at });
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
	const person = personContext({
		...input,
		divisorDays: divisorFor(configuration, input, bundle.employment.employee_number)
	});
	let wage = bindingMinimumWage(configuration, person);
	if (wage == null || !minimumWageCovers(configuration, person)) return null;
	// An hourly rate meets the hourly table. A monthly-paid part-timer uses the version's
	// monthly proportion where stated; otherwise the hourly table is annualised by contract hours.
	const scale = minimumWageScale(configuration, person);
	let hourly =
		configuration.jurisdiction.work_rules.wages?.hourly_by_region?.[
			configuration.company.region ?? ''
		];
	let statedMonthly: number | string = wage;
	let statedHourly: number | string = hourly ?? 0;
	const priorFloorOn = configuration.jurisdiction.work_rules.wages?.protected_prior_floor_on;
	if (
		priorFloorOn != null &&
		asOf > priorFloorOn &&
		employmentDates(bundle.employment).hire <= priorFloorOn
	) {
		const prior = settingsInForce(
			configuration.lineageVersions,
			configuration.jurisdiction.code,
			priorFloorOn
		);
		if (prior == null)
			refuse(`${bundle.employment.employee_number}: the prior minimum-wage version is missing.`);
		const earlier = prior.work_rules.wages;
		const priorRegion = term.minimum_wage_2025_region?.trim();
		const higherMonthly = Math.max(0, ...Object.values(earlier?.by_region ?? {})) > wage;
		const higherHourly =
			Math.max(0, ...Object.values(earlier?.hourly_by_region ?? {})) > (hourly ?? 0);
		const couldRetain = higherMonthly || (hourly != null && higherHourly);
		if (term.minimum_wage_2026_area_reclassified == null && couldRetain)
			refuse(
				`${bundle.employment.employee_number}: declare whether this worksite's 2026 minimum-wage area was reclassified.`
			);
		if (term.minimum_wage_2026_area_reclassified === true) {
			if (!priorRegion)
				refuse(
					`${bundle.employment.employee_number}: declare the worksite's 2025 minimum-wage region before pricing this incumbent.`
				);
			const oldMonthly = earlier?.by_region?.[priorRegion!];
			if (oldMonthly == null)
				refuse(`${bundle.employment.employee_number}: the 2025 minimum-wage region is unknown.`);
			if (oldMonthly > wage) {
				wage = oldMonthly;
				statedMonthly = `${oldMonthly} (protected 2025 Region ${priorRegion})`;
			}
			const oldHourly = earlier?.hourly_by_region?.[priorRegion!];
			if (hourly != null && oldHourly != null && oldHourly > hourly) {
				hourly = oldHourly;
				statedHourly = `${oldHourly} (protected 2025 Region ${priorRegion})`;
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
	const contractedWeek = term.ordinary_hours_per_week ?? 0;
	if (monthlyPartTime && partTimeFullTimeWeek != null && !(contractedWeek > 0))
		refuse(
			`${bundle.employment.employee_number}: contracted weekly hours are required for the part-time monthly minimum wage.`
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
									(hourly * scale * (term.ordinary_hours_per_week ?? 0) * 52) / 12,
									'a month',
									`${statedHourly} an hour over ${term.ordinary_hours_per_week ?? 0} hours a week`
								]
							: [person.terms.monthly_basic, wage * scale, 'a month', statedMonthly];
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
 * governs only its own days; a day no sealed version covers keeps the run's.
 */
function versionSegments(
	configuration: Configuration,
	window: { readonly start: IsoDate; readonly end: IsoDate }
): { start: IsoDate; end: IsoDate; days: number; configuration: Configuration }[] {
	const segments: { start: IsoDate; end: IsoDate; days: number; configuration: Configuration }[] =
		[];
	for (const day of daysBetween(window.start, window.end)) {
		const version =
			settingsInForce(configuration.lineageVersions, configuration.jurisdiction.code, day) ??
			configuration.jurisdiction;
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
 * floor unchanged. Null where no segment states one.
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
	// ponytail: calendar-day weights; a roster-weighted floor if a daily order ever needs it.
	return days === 0 ? null : total / days;
}

/**
 * The monthly minimum wage that holds this person: their employment type's own order where the
 * version states one (`wages.by_employment_type`; PH RA 10361 s.24, domestic workers), else their
 * place's (`regionalMinimumWage`). Null where neither states a figure for them.
 */
function personMinimumWage(
	configuration: Pick<Configuration, 'company' | 'jurisdiction'>,
	person: PersonContext
): number | null {
	const byType =
		configuration.jurisdiction.work_rules.wages?.by_employment_type?.[person.employment.type];
	if (byType == null) return regionalMinimumWage(configuration, person);
	const wage = byType[configuration.company.region ?? ''];
	return wage == null ? null : wage;
}

/**
 * The monthly floor a covered person's contract is held to: the place's, raised to every sector
 * row that binds them (`wages.monthly_by_sector`; ID PP 36/2021 as amended by PP 49/2025 art.35D).
 * A row binds at its place or inside it, for a worksite sector it lists, where its `when` holds.
 */
function bindingMinimumWage(
	configuration: Pick<Configuration, 'company' | 'jurisdiction'>,
	person: PersonContext
): number | null {
	const wage = personMinimumWage(configuration, person);
	const wages = configuration.jurisdiction.work_rules.wages;
	if (wage == null || wages?.monthly_by_sector == null) return wage;
	const place = canonicalPlace(wages.by_region, workplace(configuration, person));
	return Math.max(
		wage,
		...wages.monthly_by_sector
			.filter(
				(row) =>
					(place === row.place || place.startsWith(`${row.place}/`)) &&
					row.kbli.includes(person.terms.worksite_sector) &&
					isEligible(row.when, person)
			)
			.map((row) => row.amount)
	);
}

/** Where a person's monthly floor is read: their recorded worksite on a workplace-keyed table, else the company's region. */
function workplace(
	configuration: Pick<Configuration, 'company' | 'jurisdiction'>,
	person?: PersonContext
): string {
	const keyed = configuration.jurisdiction.work_rules.wages?.workplace_keyed === true;
	return (
		(keyed && person?.terms.worksite ? person.terms.worksite : configuration.company.region) ?? ''
	);
}

/** The region's monthly floor over the employed window, day-weighted across the versions in force
 * — what `minimum_wage(region)` reads; each payslip's trace keeps it (`earned_daily_excess`). */
export function windowMinimumWage(
	configuration: Configuration,
	window: { readonly start: IsoDate; readonly end: IsoDate }
): number {
	return (
		windowFloor(versionSegments(configuration, window), (version) =>
			regionalMinimumWage(version)
		) ?? 0
	);
}

/** The monthly minimum wage at the person's workplace (the company's region without one) under the version in force, or null where none is stated. */
function regionalMinimumWage(
	configuration: Pick<Configuration, 'company' | 'jurisdiction'>,
	person?: PersonContext
): number | null {
	return placeWage(
		configuration.jurisdiction.work_rules.wages?.by_region ?? {},
		workplace(configuration, person)
	);
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

export function prepareContributionAssessment(options: {
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
		cumulativeHistory ??= philippinesCumulativeHistory({
			periods: options.statutoryHistory,
			openings: new Map(
				configuration.contributions.flatMap((scheme) => {
					const opening = openingFor(scheme.row.code);
					return opening == null ? [] : [[scheme.row.code, opening] as const];
				})
			),
			frequency: assessmentFrequency,
			requirePeriodsFor: historyPeriodCodes
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
			overtime_days: measured.periodOvertimeDays
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
	const segments = versionSegments(configuration, bundle.employedDays ?? bundle.window.salary);
	const minimumWage = windowFloor(segments, (version) => regionalMinimumWage(version, person));
	const floor = windowFloor(segments, (version) => personWageFloor(version, person)) ?? 0;
	const startMonth = configuration.jurisdiction.payroll.tax_year_start_month;
	const bounds = taxYearBounds(bundle.window.period, startMonth);
	const dates = employmentDates(bundle.employment);
	const from = dates.hire > bounds.start ? dates.hire : bounds.start;
	const through =
		dates.exit != null && dates.exit < bundle.window.salary.end
			? dates.exit
			: bundle.window.salary.end;
	const employed = through >= from;
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
				// a week is the year's 52 over 12 (SSS Circular 2014-002: weekly × 52 ÷ 12).
				monthFactor:
					bundle.window.payFrequency === 'SEMI_MONTHLY'
						? 2
						: bundle.window.payFrequency === 'WEEKLY'
							? 52 / 12
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
				// whole: a month with any income in it is a month of income (ID PMK 250/2008 art.1(1):
				// the biaya jabatan cap is Rp500,000 a month, and a joiner on the 15th earns in that month).
				months_employed: (employed ? calendarMonthsTouched(from, through) : 0) + openingMonths
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

/** The calendar months from the month of `from` to the month of `through`, both counted whole. */
function calendarMonthsTouched(from: IsoDate, through: IsoDate): number {
	const months = (date: IsoDate) =>
		Number.parseInt(date.slice(0, 4), 10) * 12 + Number.parseInt(date.slice(5, 7), 10);
	return months(through) - months(from) + 1;
}
