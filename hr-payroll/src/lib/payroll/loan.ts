import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { decodeNumber } from '@norbital-ai/std/json';
import type {
	CatalogueComponent,
	Configuration
} from '../../collections/payroll_runs/lib/configuration.js';
import type { RunIssue } from '../../collections/payroll_runs/lib/validate.js';
import { treatmentsInForce } from '../jurisdiction_settings.js';
import type { EmploymentBundle } from '../../collections/payroll_runs/lib/gather.js';
import type { WorkspaceRow } from '../../collections/payroll_runs/$types.js';
export type Loan = WorkspaceRow<'loans'>;
/**
 * The loan catalogue row as a pay line, keeping the two columns only a loan has: what kind of debt
 * it recovers and the least a month may take. `CatalogueComponent` is the shape every family's pay
 * line shares, and neither column belongs on it.
 */
type LoanComponent = CatalogueComponent &
	Pick<WorkspaceRow<'loan_catalogue'>, 'loan_type' | 'minimum_repayment'>;
/** A loan with the catalogue row it was agreed against — the revision it pins, read at GATHER. */
export type PreparedLoan = Loan & { readonly catalogueComponent: LoanComponent };
export type LoanRepayment = WorkspaceRow<'loan_repayments'>;
/** A loan recovery is always a payroll deduction; the catalogue row does not get to say otherwise. */
const LOAN_NATURE = 'DEDUCTION' as const;
const LOAN_SETTLEMENT = 'PAYROLL' as const;
import { defaultPayPeriod, type PayCadence } from '../../collections/payroll_runs/lib/period.js';
import { dateKey } from '../../collections/payroll_runs/lib/dates.js';
import { cents } from '../../collections/payroll_runs/lib/rounding.js';
import { isEligible, type PersonContext } from '../../collections/payroll_runs/lib/eligibility.js';
import { overRecoversRepayment, repaymentOverRecoveredMessage } from '../settlement_refusals.js';
import { employmentDates } from '../../collections/payroll_runs/lib/settlement.js';
import type { Settlement } from '../../collections/payroll_runs/lib/settle.js';
import {
	PAGE_LIMIT,
	type PayrollReadApi,
	type ReadLog
} from '../../collections/payroll_runs/lib/api.js';
import { live } from '../../collections/payroll_runs/lib/effective.js';
import type { MeasuredAdjustment } from './family.js';

type MeasureRecoveryOptions = {
	readonly bundle: EmploymentBundle;
	readonly configuration: Configuration;
	readonly period: string;
	readonly cutoffDay: number;
	readonly cadence: PayCadence;
	readonly subject: PersonContext;
	readonly consumedRepayments: ReadonlyMap<string, number>;
};

/**
 * The pay line a loan is recovered under: its own row, filled from the run's row of the same code.
 *
 * A loan pins the `loan_catalogue` row of the version in force the day it was agreed, and sealing
 * the next version rewrites every catalogue row under a new id (`lib/settings_clone.ts`). So from
 * that version onward the pinned id is in no run's catalogue and resolving the line by id found
 * nothing — every remaining instalment was skipped, the balance stayed outstanding forever, and no
 * payslip line said so. The code is what survives a revision (`settings_id, code` is the
 * catalogue's unique key), so the code resolves the line.
 *
 * The agreed row's own treatment decisions stand — an approved agreement's treatment is history —
 * and the run's row of the same code fills only the cells a scheme sealed later left it silent
 * about. That is the same rule money requests and leave charges are charged under; see
 * `treatmentsInForce`. A code the run's version does not carry at all resolves to nothing, and
 * `validateLoanRecoveries` refuses the run by name rather than recovering nothing quietly.
 */
function loanRecoveryComponent(
	loan: PreparedLoan,
	currentByCode: ReadonlyMap<string, CatalogueComponent>
): LoanComponent | null {
	const source = loan.catalogueComponent;
	const current = currentByCode.get(source.code);
	if (current == null) return null;
	return {
		...source,
		contribution_treatments: treatmentsInForce(
			source.contribution_treatments,
			current.contribution_treatments
		)
	};
}

/** The run's own loan catalogue, by the key that survives a revision. */
function loanComponentsByCode(
	configuration: Configuration
): ReadonlyMap<string, CatalogueComponent> {
	return new Map(
		configuration.catalogueComponents
			.filter((component) => component.family === 'LOAN')
			.map((component) => [component.code, component])
	);
}

/** The refusal raised when a loan's pay line does not exist in the version the run prices under. */
const LOAN_COMPONENT_MISSING = 'LOAN_COMPONENT_MISSING' as const;

const loanComponentMissingIssue = (employeeNumber: string, loan: PreparedLoan): RunIssue => ({
	code: LOAN_COMPONENT_MISSING,
	message:
		`${employeeNumber} owes a loan recovered through ${loan.catalogueComponent.code}, which the ` +
		'settings version this payroll prices under does not carry. Recovering nothing would leave ' +
		`the balance outstanding with nothing on the payslip saying why. Add ${loan.catalogueComponent.code} ` +
		'to the version in force, or void the agreement.',
	collection: 'loan_catalogue',
	recordId: loan.catalogueComponent.id
});

/**
 * Every loan still owed resolves a pay line in the version the run prices under.
 *
 * Raised here, ahead of MEASURE, so one run names every person it concerns rather than throwing on
 * the first. A loan whose instalments are all settled is not judged: there is nothing left to
 * recover, so nothing the missing line could have under-paid.
 */
export function validateLoanRecoveries(options: {
	readonly configuration: Configuration;
	readonly bundles: readonly EmploymentBundle[];
	readonly consumedRepayments: ReadonlyMap<string, number>;
}): RunIssue[] {
	const currentByCode = loanComponentsByCode(options.configuration);
	const issues: RunIssue[] = [];
	for (const bundle of options.bundles) {
		// A deferred joining period produces no payslip, so it recovers nothing and blocks nothing.
		if (bundle.deferral != null) continue;
		const owed = new Set(
			bundle.loanRepayments
				.filter(
					(repayment) =>
						repaymentOutstanding(repayment, options.consumedRepayments.get(repayment.id) ?? 0) > 0
				)
				.map((repayment) => repayment.loan_id)
		);
		for (const loan of bundle.loans)
			if (owed.has(loan.id) && loanRecoveryComponent(loan, currentByCode) == null)
				issues.push(loanComponentMissingIssue(bundle.employment.employee_number, loan));
	}
	return issues;
}

export function measureLoanRecoveries(options: MeasureRecoveryOptions): MeasuredAdjustment[] {
	const recoveries: MeasuredAdjustment[] = [];
	const currentByCode = loanComponentsByCode(options.configuration);
	const loanById = new Map(options.bundle.loans.map((loan) => [loan.id, loan]));
	// In `(due_date, sequence)` order, which is the plan's order and stable for the same rows;
	// nothing about the money depends on it, but a payslip whose row order moved between two
	// identical builds would look like a change.
	const dueRepayments = [...options.bundle.loanRepayments].toSorted(
		(left, right) =>
			String(left.due_date).localeCompare(String(right.due_date)) || left.sequence - right.sequence
	);
	for (const repayment of dueRepayments) {
		// Present by construction: the bundle's repayments are gathered from these very loans.
		const loan = loanById.get(repayment.loan_id)!;
		const component = loanRecoveryComponent(loan, currentByCode);
		// Unreachable: `validateLoanRecoveries` refuses the run before it is measured. Stated as a
		// throw rather than a skip because skipping is the defect — a recovery that silently pays
		// nothing leaves the employee owing money no payslip ever mentions.
		if (component == null)
			throw new Error(
				loanComponentMissingIssue(options.bundle.employment.employee_number, loan).message
			);
		if (!isEligible(component.eligibility, options.subject)) continue;
		/**
		 * A government loan is not settled out of a final salary.
		 *
		 * The borrower owes the authority, not the employer: the scheme collects the balance after
		 * the contract ends, and sweeping it into the last payslip both over-recovers a month and
		 * takes money the employer has no claim on. An employer loan is the opposite — the
		 * agreement ends with the employment — so only `GOVERNMENT` is exempt, and it stays owed.
		 */
		if (component.loan_type === 'GOVERNMENT' && isFinalPayslip(options.bundle)) continue;
		const due = dateKey(repayment.due_date) || String(repayment.due_date).slice(0, 10);
		/**
		 * Due by now, not due exactly now.
		 *
		 * A repayment an earlier run could not take in full is still owed, and this is where it is
		 * recovered — by re-deriving what is outstanding against what was actually recovered, rather
		 * than by a copy of it written into next month's schedule. A repayment already settled in
		 * full nets to zero here and produces nothing.
		 */
		if (defaultPayPeriod(due, options.cutoffDay, options.cadence) > options.period) continue;
		const consumed = options.consumedRepayments.get(repayment.id) ?? 0;
		const outstanding = repaymentOutstanding(repayment, consumed);
		if (outstanding <= 0) continue;
		const amount = cents(outstanding);
		assertWithinRepayment({
			repayment,
			dueDate: due,
			consumed,
			proposed: amount,
			period: options.period
		});
		recoveries.push({
			input: { family: 'LOAN_REPAYMENT', id: repayment.id },
			catalogueComponent: component,
			nature: component.nature,
			label: component.code,
			amount,
			quantity: null,
			rate: null,
			statutoryRuleKey: null
		});
	}
	return recoveries;
}

/** The last payslip of a contract: the exit date falls on or before this period's wage window. */
function isFinalPayslip(bundle: EmploymentBundle): boolean {
	const exit = employmentDates(bundle.employment).exit;
	return exit != null && exit <= bundle.window.salary.end;
}

/**
 * A month that recovered less than the agreement's floor is the operator's decision, not a rounding.
 *
 * `settle` already trims a recovery the net-pay guard cannot take and records what it could not
 * take in `shortfalls`; nothing read them, so a person under-recovered for six months in a row and
 * every payslip looked ordinary. A catalogue row that states `minimum_repayment` blocks the run
 * when a month falls under it — the operator either resolves the deduction or withholds the person
 * — and one that states no floor warns, because a trimmed recovery is still a fact worth reading.
 */
export function loanShortfallIssues(options: {
	readonly employeeNumber: string;
	readonly employmentId: string;
	readonly loans: readonly PreparedLoan[];
	readonly settlement: Settlement;
}): RunIssue[] {
	if (options.settlement.shortfalls.length === 0) return [];
	const agreedById = new Map(
		options.loans.map((loan) => [loan.catalogueComponent.id, loan.catalogueComponent])
	);
	const takenByComponent = new Map<string, number>();
	for (const row of options.settlement.adjustments)
		if (row.input.family === 'LOAN_REPAYMENT')
			takenByComponent.set(
				row.catalogueComponent.id,
				(takenByComponent.get(row.catalogueComponent.id) ?? 0) + row.amount
			);
	const issues: RunIssue[] = [];
	for (const shortfall of options.settlement.shortfalls) {
		const component = agreedById.get(shortfall.componentCatalogueId);
		if (component == null) continue;
		const floor =
			component.minimum_repayment == null ? null : decodeNumber(component.minimum_repayment);
		const taken = takenByComponent.get(shortfall.componentCatalogueId) ?? 0;
		const short = cents(shortfall.amount);
		issues.push(
			floor != null && taken < floor
				? {
						code: 'LOAN_REPAYMENT_BELOW_MINIMUM',
						message:
							`${options.employeeNumber} recovered ${taken} under ${component.code}, below the ` +
							`agreed minimum of ${floor}: net pay could not carry ${short} of this period's ` +
							'instalment. Resolve the deduction or withhold this person from the run.',
						collection: 'employments',
						recordId: options.employmentId
					}
				: {
						code: 'LOAN_REPAYMENT_SHORT',
						severity: 'WARNING',
						message:
							`${options.employeeNumber} could not repay ${short} under ${component.code} this ` +
							'period; net pay would have gone negative. It stays outstanding.',
						collection: 'employments',
						recordId: options.employmentId
					}
		);
	}
	return issues;
}

/**
 * The cross-run ceilings, raised where the amount is derived.
 *
 * A repayment may legitimately be touched by several payslips — net-pay protection can part-recover
 * it — so the junction carries no global unique index, and the ceiling that keeps the sum of what
 * every paid run recovered inside the amount due is arithmetic. This is that arithmetic, and
 * `REPAYMENT_OVER_RECOVERED` is its name. The entry ceiling beside it is the defence-in-depth
 * statement of single use: a one-off entry belongs to at most one standing/paid payslip, which the
 * gather step refuses outright, so this check guards the shape rather than the practice.
 */
type RepaymentCeiling = Readonly<{
	readonly repayment: LoanRepayment;
	/** The due date as a calendar day, for the refusal's sentence. */
	readonly dueDate: string;
	readonly consumed: number;
	readonly proposed: number;
	readonly period: string;
}>;

function assertWithinRepayment(options: RepaymentCeiling): void {
	const consumption = {
		loan_repayment_id: options.repayment.id,
		due_date: options.dueDate,
		amount_due: decodeNumber(options.repayment.amount_due),
		consumed: options.consumed,
		proposed: options.proposed,
		period: options.period
	};
	if (overRecoversRepayment(consumption))
		throw new Error(repaymentOverRecoveredMessage(consumption));
}

/**
 * Loan owns its agreements and recovery schedule; no obligation rows are copied into payroll.
 *
 * The agreed catalogue row is read here, beside the loans that pin it, rather than by widening the
 * run's `prepareLoanCatalogue`: that step resolves the version's own catalogue — one read for every
 * employment in the company, hashed into the configuration and walked by `validateConfiguration`,
 * which demands a decided cell for every scheme the run levies. A row sealed under an earlier
 * version cannot have one for a scheme sealed after it, so pulling pinned rows into the run's
 * catalogue would refuse exactly the payroll this fixes. A pin is an input fact, and inputs are
 * gathered here — the same place, and for the same reason, `prepareRequestCatalogues` reads the
 * revision a money request was raised against.
 */
export function prepareLoanPayroll(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly employmentIds: readonly string[];
}) {
	return Effect.gen(function* () {
		const rows = yield* options.api.db.loans.findMany({
			where: { employment_id: { in: [...options.employmentIds] }, approval_id: { isNull: true } },
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(rows, 'loans');
		const rawLoans = live(rows);
		const [catalogueRows, repayments] = yield* Effect.all(
			[
				rawLoans.length === 0
					? Effect.succeed([])
					: options.api.db.loan_catalogue.findMany({
							where: {
								id: { in: [...new Set(rawLoans.map((row) => row.loan_catalogue_id))] },
								approval_id: { isNull: true }
							},
							limit: PAGE_LIMIT
						}),
				rawLoans.length === 0
					? Effect.succeed([])
					: options.api.db.loan_repayments.findMany({
							where: { loan_id: { in: rawLoans.map((row) => row.id) } },
							limit: PAGE_LIMIT
						})
			],
			{ concurrency: 'unbounded' }
		);
		options.api.reads.assertComplete(catalogueRows, 'agreed loan catalogue');
		options.api.reads.assertComplete(repayments, 'loan repayments');
		const agreedById = new Map(live(catalogueRows).map((row) => [row.id, loanComponent(row)]));
		const loans = rawLoans.map((loan): PreparedLoan => {
			const catalogueComponent = agreedById.get(loan.loan_catalogue_id);
			if (catalogueComponent == null)
				refuse('A loan must reference an approved row of the loan catalogue it was agreed under.');
			return { ...loan, catalogueComponent };
		});
		return {
			loansByEmployment: Map.groupBy(loans, (row) => row.employment_id),
			repaymentsByLoan: Map.groupBy(live(repayments), (row) => row.loan_id)
		};
	});
}

/**
 * What is still owed on a repayment, after what earlier PAID runs actually took.
 *
 * There is no carried-forward shortfall anywhere in this engine: a deduction the negative-net guard
 * could not take stays outstanding on the repayment, and the next run re-derives the remainder from
 * this same subtraction.
 */
export function repaymentOutstanding(repayment: LoanRepayment, consumed: number): number {
	const due = decodeNumber(repayment.amount_due);
	const taken = Math.min(Math.max(consumed, 0), due);
	return Math.max(0, due - taken);
}

export function prepareLoanCatalogue(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly settingsId: string;
}) {
	return Effect.gen(function* () {
		const rows = yield* options.api.db.loan_catalogue.findMany({
			where: { settings_id: { eq: options.settingsId }, approval_id: { isNull: true } },
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(rows, 'loan catalogue');
		return live(rows).map(loanComponent);
	});
}

/** One stored catalogue row as the engine's pay line; a loan recovery is never anything else. */
const loanComponent = (row: WorkspaceRow<'loan_catalogue'>) => ({
	...row,
	family: 'LOAN' as const,
	nature: LOAN_NATURE,
	settlement: LOAN_SETTLEMENT,
	definition: { source: 'ENTRY' as const, cap: null }
});
export function prepareLoanConsumption(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly payslipIds: readonly string[];
}) {
	return Effect.gen(function* () {
		const db = options.api.db;
		const priorPayslipIds = [...options.payslipIds];
		const consumedRepayments = new Map<string, number>();
		const [links, payslips] = yield* Effect.all(
			[
				db.payslip_loan_repayment_inputs.findMany({
					where: { payslip_id: { in: priorPayslipIds } },
					columns: { loan_repayment_id: true },
					limit: PAGE_LIMIT
				}),
				db.payslips.findMany({
					where: { id: { in: priorPayslipIds } },
					columns: { id: true, adjustments: true },
					limit: PAGE_LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		options.api.reads.assertComplete(links, 'prior loan-repayment captures');
		options.api.reads.assertComplete(payslips, 'prior loan-recovery adjustments');
		// A paid capture with no output consumed zero, rather than leaving historical usage unknown.
		for (const row of links) consumedRepayments.set(row.loan_repayment_id, 0);
		for (const payslip of payslips)
			for (const row of payslip.adjustments) {
				if (row.family !== 'LOAN_REPAYMENT') continue;
				consumedRepayments.set(
					row.source_id,
					(consumedRepayments.get(row.source_id) ?? 0) + decodeNumber(row.amount ?? 0)
				);
			}
		return consumedRepayments;
	});
}
