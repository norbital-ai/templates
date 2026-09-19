import { refuse } from '@norbital-ai/bolt/authoring';
import {
	contribute,
	contributeCompany,
	type ContributionCharge
} from '../../collections/payroll_runs/lib/contribute.js';
import {
	sumAccumulations,
	type AccumulatedPayslip
} from '../../collections/payroll_runs/lib/accumulate.js';
import type { EmploymentBundle, GatheredRun } from '../../collections/payroll_runs/lib/gather.js';
import { cents } from '../../collections/payroll_runs/lib/rounding.js';

/**
 * One registration as the conflict check reads it: absent is the registered default, and every
 * optional member is spelled so an explicit default and an absent row compare equal.
 */
function factStanding(status: StatutoryFactStatus | undefined): string {
	if (status == null)
		return JSON.stringify({
			kind: 'REGISTERED',
			rate_override: null,
			since: null,
			instalments: [],
			elections: {}
		});
	if (status.kind === 'NOT_REGISTERED') return JSON.stringify(status);
	return JSON.stringify({
		kind: 'REGISTERED',
		rate_override: status.rate_override ?? null,
		since: status.since ?? null,
		instalments: status.instalments ?? [],
		elections: status.elections ?? {}
	});
}

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
			const employee = allocate(charge.employee, weights);
			const employer = allocate(charge.employer, weights);
			const directed = allocate(charge.directed, weights);
			const { parts: _parts, ...rest } = charge;
			for (const [position, contract] of ordered.entries()) {
				const part = parts[position]!;
				result.get(contract.employment.id)!.push({
					...rest,
					base: part.base,
					inputs: part.inputs,
					employee: employee[position]!,
					employer: employer[position]!,
					directed: directed[position]!
				});
			}
		}
	}
	return result;
}

import { Effect } from 'effect';
import { decodeNumber } from '@norbital-ai/std/json';
import {
	PAGE_LIMIT,
	type PayrollReadApi,
	type ReadLog
} from '../../collections/payroll_runs/lib/api.js';
import type { PersonInput } from '../../collections/payroll_runs/lib/eligibility.js';
import { realignStatutoryFacts } from '../../collections/payroll_runs/lib/statutory-facts.js';
import { ordinaryDivisorDays } from '../../collections/payroll_runs/lib/ordinary-rate.js';
import { live, coversDate } from '../../collections/payroll_runs/lib/effective.js';
import type { Configuration } from '../../collections/payroll_runs/lib/configuration.js';
import type { WorkspaceRow } from '../../collections/payroll_runs/$types.js';
import {
	accumulatePayslip,
	type MonthPrior
} from '../../collections/payroll_runs/lib/accumulate.js';
import { orderSchemes } from '../../collections/payroll_runs/lib/mentions.js';
import { employmentDates } from '../../collections/payroll_runs/lib/settlement.js';
import type { StatutoryFactStatus } from '../../collections/payroll_runs/lib/contribute.js';
import {
	addDays,
	completedMonths,
	inclusiveDays,
	monthDays,
	periodHalf
} from '../../collections/payroll_runs/lib/dates.js';
import {
	closesTaxYear,
	taxYearBounds,
	taxYearOf,
	weeklyInstalments,
	type PayrollWindow
} from '../../collections/payroll_runs/lib/period.js';
import {
	evaluatePersonNumber,
	isEligible,
	personContext,
	type PersonContext
} from '../../collections/payroll_runs/lib/eligibility.js';
import type { RunIssue } from '../../collections/payroll_runs/lib/validate.js';
import { stint } from '../employment-contract.js';
import { patternDaysPerWeek, termPattern } from '../scheduling/work-pattern.js';
import { fixedAllowancesOn } from './money.js';
import type { MeasuredEmployment } from './family.js';

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
	const startMonth = decodeNumber(configuration.jurisdiction.payroll.tax_year_start_month);
	const minimumWage = regionalMinimumWage(configuration);
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
	const covered = minimumWageCovers(configuration, entity);
	const bounds = taxYearBounds(period, startMonth);
	// The year-to-date and earned facts a company formula reads are the entity's: the sum over
	// every employee the run gathered.
	const yearToDate = (code: string) => {
		const total = { employee: 0, employer: 0, base: 0, ordinary: 0 };
		for (const [key, value] of gathered.yearToDate)
			if (key.endsWith(`:${code}`)) {
				total.employee += value.employee;
				total.employer += value.employer;
				total.base += value.base;
				total.ordinary += value.ordinary;
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
			index: 1,
			instalments: 1,
			monthlyOn: 'FIRST',
			lastOfYear: closesTaxYear(period, startMonth, window.payFrequency),
			daysEmployed: 0,
			daysInMonth: monthDays(window.salary.start)
		},
		currency: configuration.jurisdiction.payroll.currency,
		year: { start: bounds.start, end: bounds.end, months_employed: 0 },
		person: { ...entity, wage_floor: covered ? (minimumWage ?? 0) : 0 },
		minimumWage,
		projection: { payslipsRemaining: 1, futurePayslipEquivalents: 0 },
		yearToDate,
		yearEarned,
		produced: producedSums(options.charges)
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
export function prepareContributionCatalogue(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly settingsId: string;
}) {
	return Effect.gen(function* () {
		const approved = { approval_id: { isNull: true } } as const;
		const rows = yield* options.api.db.statutory_contributions.findMany({
			where: { settings_id: { eq: options.settingsId }, ...approved },
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(rows, 'statutory contributions');
		return orderSchemes(live(rows).map((row) => ({ row, rules: row.rules })));
	});
}

export function prepareContributionInputs(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly employeeIds: readonly string[];
	readonly configuration: Configuration;
}) {
	return Effect.gen(function* () {
		const rows = yield* options.api.db.employment_statutory_facts.findMany({
			where: { employee_id: { in: [...options.employeeIds] }, approval_id: { isNull: true } },
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(rows, 'statutory facts');
		return Map.groupBy(
			yield* realignStatutoryFacts(options.api.db, live(rows), options.configuration),
			(row) => row.employee_id
		);
	});
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
		{ employee: number; employer: number; base: number; ordinary: number }
	>();
	for (const payslip of priorPayslips) {
		if (!inTaxYear.has(payslip.payroll_run_id)) continue;
		const employeeId = employmentToEmployee.get(payslip.employment_id);
		if (employeeId == null) continue;
		for (const charge of payslip.statutory) {
			const key = `${employeeId}:${charge.scheme_code}`;
			const running = totals.get(key) ?? { employee: 0, employer: 0, base: 0, ordinary: 0 };
			totals.set(key, {
				employee: running.employee + decodeNumber(charge.employee_amount),
				employer: running.employer + decodeNumber(charge.employer_amount),
				base: running.base + decodeNumber(charge.base_amount),
				ordinary: running.ordinary + decodeNumber(charge.ordinary_amount ?? 0)
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
	const due = options.configuration.jurisdiction.payroll.final_pay_due_days;
	if (due == null) return [];
	const issues: RunIssue[] = [];
	for (const bundle of options.bundles) {
		const exit = employmentDates(bundle.employment).exit;
		if (exit == null) continue;
		const deadline = addDays(exit, due);
		if (options.payDate <= deadline) continue;
		issues.push({
			code: 'FINAL_PAY_LATE',
			severity: 'WARNING',
			message:
				`${bundle.employment.employee_number} left on ${exit}; the final pay is due within ${due} ` +
				`days, by ${deadline}, and this run pays on ${options.payDate}.`,
			collection: 'employments',
			recordId: bundle.employment.id
		});
	}
	return issues;
}

/**
 * A covered person contracted below the region's minimum wage. A warning, not a refusal: the
 * payroll still pays what the contract says, and the operator reads who is underpaid against
 * which order before paying.
 */
export function minimumWageIssues(options: {
	readonly configuration: Configuration;
	readonly bundles: readonly EmploymentBundle[];
	readonly asOf: string;
}): RunIssue[] {
	const { configuration, asOf } = options;
	const wage = regionalMinimumWage(configuration);
	if (wage == null) return [];
	const issues: RunIssue[] = [];
	for (const bundle of options.bundles) {
		if (bundle.employedDays == null || bundle.deferral != null) continue;
		const term =
			bundle.termsHistory.find((row) => coversDate(row.effective_range, asOf)) ??
			bundle.terms.at(-1);
		if (term == null) continue;
		const basic = decodeNumber((term.base_salary as { value?: unknown } | null)?.value ?? 0);
		const input = {
			employee: bundle.employee,
			employment: stint(bundle.employment),
			fixedAllowances: fixedAllowancesOn(bundle.payRequests, asOf),
			terms: term,
			week: {
				ordinary_hours_per_week: decodeNumber(term.ordinary_hours_per_week ?? 0),
				working_days_per_week: (() => {
					const pattern = termPattern(term, configuration.patternById);
					return pattern == null ? 0 : patternDaysPerWeek(pattern, configuration.shiftById);
				})()
			},
			children: bundle.children,
			company: configuration.company,
			asOf
		};
		// The version's divisor turns a daily or hourly rate into the month the floor is stated in.
		const person = personContext({
			...input,
			divisorDays: divisorFor(configuration, input, bundle.employment.employee_number)
		});
		if (!minimumWageCovers(configuration, person)) continue;
		// The wages order's rule on the contract's composition (ID: basic at least 75% of the wage).
		const termsWhen = (configuration.jurisdiction.work_rules.wages?.terms_when ?? '').trim();
		if (termsWhen !== '' && !isEligible(termsWhen, person))
			issues.push({
				code: 'WAGE_TERMS_RULE',
				severity: 'WARNING',
				message:
					`${bundle.employment.employee_number}'s contract does not satisfy the version's wage rule ` +
					`\`${termsWhen}\` (basic ${person.terms.basic_salary}, fixed allowances ${person.terms.fixed_allowances}). ` +
					'The run pays the contract; restate the terms or record why they stand.',
				collection: 'employment_terms',
				recordId: term.id
			});
		// A daily or hourly rate is compared as the month it makes (313 days ÷ 12).
		if (!(person.terms.monthly_basic < wage * minimumWageScale(configuration, person))) continue;
		issues.push({
			code: 'MINIMUM_WAGE_BELOW',
			severity: 'WARNING',
			message:
				`${bundle.employment.employee_number} is contracted at ${person.terms.monthly_basic} a month, below the ` +
				`${configuration.company.region ?? ''} minimum wage of ${wage} the version states. ` +
				'The run pays the contract; raise the terms or record why the wage stands.',
			collection: 'employment_terms',
			recordId: term.id
		});
	}
	return issues;
}

/** The company region's minimum wage under the version in force, or null where none is stated. */
function regionalMinimumWage(
	configuration: Pick<Configuration, 'company' | 'jurisdiction'>
): number | null {
	const region = configuration.company.region;
	if (region == null || region === '') return null;
	const wage = configuration.jurisdiction.work_rules.wages?.by_region?.[region];
	return wage == null ? null : decodeNumber(wage);
}

/**
 * The contractual monthly wage — basic and the standing allowances — averaged over the last
 * `months` months of the employment ending on `asOf`: the terms in force on the first of each
 * month, from the employment's start at the earliest. What VN art.46 measures severance on.
 */
export function monthlyWageAverage(
	bundle: Pick<EmploymentBundle, 'termsHistory' | 'terms' | 'payRequests' | 'employment'>,
	asOf: string,
	months: number
): number | null {
	const start = employmentDates(bundle.employment).hire;
	const year = Number(asOf.slice(0, 4));
	const month = Number(asOf.slice(5, 7));
	const wages: number[] = [];
	for (let offset = 0; offset < months; offset += 1) {
		const index = year * 12 + (month - 1) - offset;
		const first = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
		const date = first < start ? start : first;
		if (date > asOf || (start !== '' && date < start)) continue;
		const terms =
			bundle.termsHistory.find((row) => coversDate(row.effective_range, date)) ??
			bundle.terms.at(-1);
		if (terms == null) continue;
		const basic = decodeNumber((terms.base_salary as { value?: unknown } | null)?.value ?? 0);
		wages.push(basic + fixedAllowancesOn(bundle.payRequests, date));
	}
	return wages.length === 0 ? null : wages.reduce((sum, wage) => sum + wage, 0) / wages.length;
}

export function prepareContributionAssessment(options: {
	readonly measured: MeasuredEmployment;
	readonly configuration: Configuration;
	readonly projection: ContractAssessment['calculation']['projection'];
	readonly yearToDate: ReadonlyMap<
		string,
		{ employee: number; employer: number; base: number; ordinary: number }
	>;
	readonly headcount: number;
	readonly headcountCitizens?: number;
	/** component code → what this employee's earlier payslips earned this tax year. */
	readonly yearEarned: ReadonlyMap<string, number>;
	/** calendar month → component code → what this employee's earlier payslips earned. */
	readonly earnedByMonth?: ReadonlyMap<string, ReadonlyMap<string, number>>;
	/** What the month's earlier instalments settled and charged, at a semi-monthly or weekly cadence. */
	readonly monthPrior?: MonthPrior;
}): ContractAssessment {
	const { measured, configuration, projection, headcount } = options;
	const { bundle } = measured;
	const facts = new Map<string, StatutoryFactStatus>();
	const asOf =
		bundle.employedDays?.end ?? employmentDates(bundle.employment).exit ?? bundle.window.salary.end;
	for (const fact of bundle.statutoryFacts) {
		if (!coversDate(fact.effective_range, asOf) || fact.status == null) continue;
		facts.set(fact.statutory_contribution_id, fact.status);
	}
	const startMonth0 = decodeNumber(configuration.jurisdiction.payroll.tax_year_start_month);
	const taxYear = taxYearOf(bundle.window.period, startMonth0);
	/** An earlier employer's figures under a scheme for this tax year, where the fact declares them. */
	const openingFor = (code: string) => {
		const scheme = configuration.contributions.find((row) => row.row.code === code);
		const status = scheme == null ? undefined : facts.get(scheme.row.id);
		if (status?.kind !== 'REGISTERED') return null;
		return (status.opening ?? []).find((row) => row.year === taxYear) ?? null;
	};
	const openingMonths = configuration.contributions.reduce(
		(most, scheme) => Math.max(most, openingFor(scheme.row.code)?.months ?? 0),
		0
	);
	const minimumWage = regionalMinimumWage(configuration);
	const personInput = {
		employee: bundle.employee,
		employment: { ...stint(bundle.employment), risk_class: configuration.company.risk_class },
		fixedAllowances: fixedAllowancesOn(bundle.payRequests, asOf),
		monthlyWage6mAverage: monthlyWageAverage(bundle, asOf, 6),
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
		period: { working_days: measured.periodWorkingDays, unpaid_days: measured.periodUnpaidDays },
		facts: configuration.contributions.map((scheme) => {
			const status = facts.get(scheme.row.id);
			return {
				code: scheme.row.code,
				registered: status?.kind === 'REGISTERED',
				since: status?.kind === 'REGISTERED' ? (status.since ?? null) : null
			};
		}),
		asOf
	};
	const person = personContext({
		...personInput,
		divisorDays: divisorFor(configuration, personInput, bundle.employment.employee_number)
	});
	const covered = minimumWageCovers(configuration, person);
	// The floor is the region's wage where the order covers this person — at the order's own share
	// of it for an apprentice — and 0 where it does not; the person root carries both, so a formula
	// may read either.
	const floor = covered ? (minimumWage ?? 0) * minimumWageScale(configuration, person) : 0;
	const startMonth = decodeNumber(configuration.jurisdiction.payroll.tax_year_start_month);
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
							ordinary: own.ordinary + (opening.ordinary ?? 0)
						};
			},
			yearEarned: options.yearEarned,
			earnedByMonth: options.earnedByMonth,
			monthPrior: options.monthPrior,
			componentsByCode: new Map(
				configuration.catalogueComponents.map((component) => [
					component.code,
					{ family: component.family, fixed: component.fixed }
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
				daysEmployed: measured.proration.reduce((total, segment) => total + segment.days, 0),
				daysInMonth: monthDays(bundle.window.salary.start)
			},
			currency: measured.currency,
			year: {
				start: bounds.start,
				end: bounds.end,
				months_employed: (employed ? completedMonths(from, addDays(through, 1)) : 0) + openingMonths
			},
			projection,
			person: { ...person, wage_floor: floor },
			minimumWage,
			minimumWageApplies: covered
		}
	};
}
