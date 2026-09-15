import { refuse } from '@norbital-ai/bolt/authoring';
import {
	contribute,
	type ContributionCharge
} from '../../collections/payroll_runs/lib/contribute.js';
import type { EmploymentBundle } from '../../collections/payroll_runs/lib/gather.js';
import { cents } from '../../collections/payroll_runs/lib/rounding.js';

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
 * Contract payslips retain their own bases and sources. Contribution assesses the person's combined
 * remuneration once within the entity and interval, then allocates each share by that scheme's own
 * assessed base. Existing frozen bases, rule keys and sealed employment identities reconstruct both
 * the assessment and allocation without a separate ledger.
 */
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
			for (const base of input.bases) {
				const id = base.contribution.row.id;
				const status = input.facts.get(id);
				const otherStatus = other.facts.get(id);
				if (
					(status?.kind ?? 'REGISTERED') !== (otherStatus?.kind ?? 'REGISTERED') ||
					(status?.rate_override ?? null) !== (otherStatus?.rate_override ?? null)
				)
					refuse(
						`Contracts for ${first.employment.employee_number} have conflicting ${base.contribution.row.code} registrations or rate overrides.`
					);
			}
		}
		if (ordered.length === 1) {
			result.set(first.employment.id, contribute(input));
			continue;
		}
		const bases = input.bases.map((base, index) => {
			const parts = ordered.map((contract) => contract.calculation.bases[index]!);
			return {
				contribution: base.contribution,
				base: cents(parts.reduce((sum, part) => sum + part.base, 0)),
				lines: parts.flatMap((part) => part.lines)
			};
		});
		const charges = contribute({ ...input, bases });
		for (const contract of ordered) result.set(contract.employment.id, []);
		// By scheme, not by position: a scheme the person is outside produced no charge at all.
		for (const charge of charges) {
			const index = input.bases.findIndex(
				(base) => base.contribution.row.id === charge.contribution.row.id
			);
			const parts = ordered.map((contract) => contract.calculation.bases[index]!);
			const weights = parts.map((part) => Math.max(0, part.base));
			const employee = allocate(charge.employee, weights);
			const employer = allocate(charge.employer, weights);
			for (const [position, contract] of ordered.entries()) {
				const part = parts[position]!;
				result.get(contract.employment.id)!.push({
					...charge,
					base: part.base,
					inputs: part.lines,
					employee: employee[position]!,
					employer: employer[position]!
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
import { realignStatutoryFacts } from '../../collections/payroll_runs/lib/statutory-facts.js';
import { live, coversDate } from '../../collections/payroll_runs/lib/effective.js';
import type { Configuration } from '../../collections/payroll_runs/lib/configuration.js';
import type { WorkspaceRow } from '../../collections/payroll_runs/$types.js';
import { accumulateBases } from '../../collections/payroll_runs/lib/accumulate.js';
import { orderSchemes } from '../../collections/payroll_runs/lib/mentions.js';
import { employmentDates } from '../../collections/payroll_runs/lib/settlement.js';
import type { StatutoryFactStatus } from '../../collections/payroll_runs/lib/contribute.js';
import { personContext } from '../../collections/payroll_runs/lib/eligibility.js';
import { serviceStart } from '../employment-contract.js';
import type { StatutoryOptIn } from '../../datatypes/work_rules/+definition.js';
import type { MeasuredEmployment } from './family.js';
export function prepareContributionCatalogue(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly settingsId: string;
}) {
	return Effect.gen(function* () {
		const approved = { approval_id: { isNull: true } } as const;
		const readStarted = Date.now();
		const rows = yield* options.api.db.statutory_contributions.findMany({
			where: { settings_id: { eq: options.settingsId }, ...approved },
			limit: PAGE_LIMIT
		});
		const readDone = Date.now();
		options.api.reads.assertComplete(rows, 'statutory contributions');
		const ordered = orderSchemes(live(rows).map((row) => ({ row, rules: row.rules })));
		yield* Effect.log(
			`[payroll-timing] statutory read=${readDone - readStarted}ms order=${Date.now() - readDone}ms rows=${rows.length} bands=${ordered.reduce((n, e) => n + e.rules.length, 0)}`
		);
		return ordered;
	});
}

/**
 * Opt-ins name scheme rows within one settings version, and a request, loan or leave entry may pin
 * a catalogue revision sealed under an earlier version. The run levies the version in force, so
 * each foreign id is resolved through its scheme's code to that version's row (RFC 0002 §6): a
 * charge the pinned revision declared still lands on the scheme the run actually levies, rather
 * than silently feeding nothing. An id whose code the version does not carry is left alone, and
 * the run's `OPT_IN_UNKNOWN` guard names it.
 */
export type OptInAliases = ReadonlyMap<string, string>;

export function loadOptInAliases(options: {
	readonly api: {
		readonly db: {
			readonly statutory_contributions: {
				readonly findMany: PayrollReadApi['db']['statutory_contributions']['findMany'];
			};
		};
		readonly reads?: ReadLog;
	};
	readonly configuration: Pick<Configuration, 'jurisdiction' | 'contributions'>;
	readonly ids: readonly string[];
}): Effect.Effect<OptInAliases> {
	const currentIdByCode = new Map(
		options.configuration.contributions.map((entry) => [entry.row.code, entry.row.id])
	);
	const currentIds = new Set(currentIdByCode.values());
	const foreign = [...new Set(options.ids)].filter((id) => !currentIds.has(id));
	if (foreign.length === 0) return Effect.succeed(new Map());
	return Effect.map(
		options.api.db.statutory_contributions.findMany({
			where: { id: { in: foreign }, approval_id: { isNull: true } },
			columns: { id: true, code: true },
			limit: PAGE_LIMIT
		}),
		(rows) => {
			options.api.reads?.assertComplete(rows, 'pinned scheme revisions');
			const aliases = new Map<string, string>();
			for (const row of rows) {
				const current = currentIdByCode.get(row.code);
				if (current != null && current !== row.id) aliases.set(row.id, current);
			}
			return aliases;
		}
	);
}

/** The same opt-ins with every pinned-revision id replaced by the run's own scheme row. */
export function aliasedOptIns(
	optIns: readonly StatutoryOptIn[],
	aliases: OptInAliases
): readonly StatutoryOptIn[] {
	if (aliases.size === 0) return optIns;
	return optIns.map((optIn) => {
		const current = aliases.get(optIn.contribution_id);
		return current == null ? optIn : { ...optIn, contribution_id: current };
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
	const totals = new Map<string, { employee: number; employer: number; base: number }>();
	for (const payslip of priorPayslips) {
		if (!inTaxYear.has(payslip.payroll_run_id)) continue;
		const employeeId = employmentToEmployee.get(payslip.employment_id);
		if (employeeId == null) continue;
		for (const charge of payslip.statutory) {
			const key = `${employeeId}:${charge.scheme_code}`;
			const running = totals.get(key) ?? { employee: 0, employer: 0, base: 0 };
			totals.set(key, {
				employee: running.employee + decodeNumber(charge.employee_amount),
				employer: running.employer + decodeNumber(charge.employer_amount),
				base: running.base + decodeNumber(charge.base_amount)
			});
		}
	}

	return totals;
}

/** The company region's minimum wage under the version in force, or null where none is stated. */
function regionalMinimumWage(
	configuration: Pick<Configuration, 'company' | 'jurisdiction'>
): number | null {
	const region = configuration.company.region;
	if (region == null || region === '') return null;
	const wage = configuration.jurisdiction.wages?.by_region?.[region];
	return wage == null ? null : decodeNumber(wage);
}

export function prepareContributionAssessment(options: {
	readonly measured: MeasuredEmployment;
	readonly configuration: Configuration;
	readonly projection: ContractAssessment['calculation']['projection'];
	readonly yearToDate: ReadonlyMap<string, { employee: number; employer: number; base: number }>;
	readonly headcount: number;
}): ContractAssessment {
	const { measured, configuration, projection, headcount } = options;
	const { bundle } = measured;
	const facts = new Map<string, StatutoryFactStatus>();
	const asOf =
		bundle.employedDays?.end ?? employmentDates(bundle.employment).exit ?? bundle.window.salary.end;
	for (const fact of bundle.statutoryFacts) {
		if (!coversDate(fact.effective_range, asOf) || fact.status == null) continue;
		facts.set(fact.statutory_contribution_id, {
			kind: fact.status.kind,
			rate_override: fact.status.kind === 'REGISTERED' ? fact.status.rate_override : null
		});
	}
	return {
		employment: bundle.employment,
		window: bundle.window,
		calculation: {
			bases: accumulateBases({
				configuration,
				items: [...measured.base, ...measured.adjustments],
				employeeNumber: bundle.employment.employee_number
			}),
			facts,
			yearToDate: (code) =>
				options.yearToDate.get(`${bundle.employment.employee_id}:${code}`) ?? {
					employee: 0,
					employer: 0,
					base: 0
				},
			age: bundle.age,
			headcount,
			riskClass: configuration.company.risk_class,
			projection,
			person: personContext({
				employee: bundle.employee,
				employment: { service_start: serviceStart(bundle.employment) },
				terms:
					bundle.termsHistory.find((row) => coversDate(row.effective_range, asOf)) ??
					bundle.terms.at(-1) ??
					null,
				children: bundle.children,
				company: configuration.company,
				asOf
			}),
			minimumWage: regionalMinimumWage(configuration),
			// How this period sits in the month: a scheme assessed over the MONTH is charged once,
			// in the period that owns the month's start, on the month's wage.
			assessment: {
				periodsPerMonth: configuration.company.pay_frequency === 'SEMI_MONTHLY' ? 2 : 1,
				periodIndex: bundle.window.period.endsWith('-2') ? 2 : 1
			}
		}
	};
}
