import { refuse } from '../refuse.js';
import { decodeNumber } from '../wire.js';
import type { CatalogueComponent, Configuration } from '../../lib/payroll/run/configuration.js';
import type { RunIssue } from '../../lib/payroll/run/validate.js';
import type { EmploymentBundle } from '../../lib/payroll/run/gather.js';
import type { WorkspaceRow } from '../rows.js';
type Loan = WorkspaceRow<'loans'>;
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
import type { PayCadence } from '../../lib/payroll/run/period.js';
import { dateKey } from '../iso-day.js';
import { monthBounds, shiftPeriod } from '../../lib/payroll/run/dates.js';
import { cents, currencyFractionDigits, roundMoney } from '../../lib/payroll/run/rounding.js';
import { isEligible, type PersonContext } from '../../lib/payroll/run/eligibility.js';
import { employmentDates } from '../../lib/payroll/run/settlement.js';
import { settle, type Settlement } from '../../lib/payroll/run/settle.js';
import type { PayrollWorld } from './world.js';
import { live, readRange } from '../../lib/payroll/run/effective.js';
import { evaluateNumber, expressionEngine } from '../expressions/evaluate.js';
import { windowMinimumWage } from './contribution.js';
import {
	settlementBucket,
	type MeasuredAdjustment,
	type SettlementDestination,
	type SettlementDirection
} from './family.js';

type MeasureRecoveryOptions = {
	readonly bundle: EmploymentBundle;
	readonly configuration: Configuration;
	readonly period: string;
	readonly cutoffDay: number;
	readonly cadence: PayCadence;
	readonly subject: PersonContext;
};

/**
 * The pay line a loan is recovered under: its own row, filled with nothing from the run's row.
 *
 * A loan pins the `loan_catalogue` row of the version in force the day it was agreed, and sealing
 * the next version rewrites every catalogue row under a new id (`lib/settings_clone.ts`). So from
 * that version onward the pinned id is in no run's catalogue and resolving the line by id found
 * nothing — every remaining instalment was skipped, the balance stayed outstanding forever, and no
 * payslip line said so. The code is what survives a revision (`settings_id, code` is the
 * catalogue's unique key), so the code is what the run's version is asked for.
 *
 * The agreed row's own bands stand: they are the opt-ins it agreed to, and a scheme sealed into a
 * later version — which the agreed row could not have named — is silence, and silence is no effect.
 * Only the run's version must still carry the code, and `validateLoanRecoveries` refuses the run by
 * name rather than recovering nothing quietly.
 */
function loanRecoveryComponent(
	loan: PreparedLoan,
	currentByCode: ReadonlyMap<string, CatalogueComponent>
): LoanComponent | null {
	const source = loan.catalogueComponent;
	return currentByCode.has(source.code) ? source : null;
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
}): RunIssue[] {
	const currentByCode = loanComponentsByCode(options.configuration);
	const issues: RunIssue[] = [];
	for (const bundle of options.bundles) {
		// A deferred joining period produces no payslip, so it recovers nothing and blocks nothing.
		if (bundle.deferral != null) continue;
		const owed = new Set([
			...bundle.loanRepayments
				.filter((repayment) => repayment.payslip_id == null && !isOrder(loanOf(bundle, repayment)))
				.map((repayment) => repayment.loan_id),
			...bundle.loans
				.filter((loan) => isOrder(loan) && orderBalance(loan, bundle.loanRepayments) > 0)
				.map((loan) => loan.id)
		]);
		for (const loan of bundle.loans)
			if (owed.has(loan.id) && loanRecoveryComponent(loan, currentByCode) == null)
				issues.push(loanComponentMissingIssue(bundle.employment.employee_number, loan));
		// A final payslip recovers at most one instalment per agreement (whole, never a sweep), so
		// every other outstanding instalment leaves with the person. Said once per loan, as a
		// warning: what to do with the balance is the operator's call, not the run's.
		if (isFinalPayslip(bundle))
			for (const loan of bundle.loans) {
				// An order's final payslip is its `on_exit`; what it leaves owed is said at settlement.
				if (isOrder(loan)) continue;
				const remaining = bundle.loanRepayments.filter(
					(repayment) => repayment.loan_id === loan.id && repayment.payslip_id == null
				);
				if (remaining.length <= 1) continue;
				const balance = remaining.reduce((sum, repayment) => sum + cents(repayment.amount_due), 0);
				issues.push({
					code: 'LOAN_OUTSTANDING_AT_EXIT',
					severity: 'WARNING',
					message:
						`${bundle.employment.employee_number} leaves this period with ${remaining.length} ` +
						`instalment(s) totalling ${cents(balance)} still outstanding under ` +
						`${loan.reference ?? loan.id}; this final payslip recovers at most one. ` +
						'Settle the balance outside payroll or record it as written off.',
					collection: 'loans',
					recordId: loan.id
				});
			}
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
		(left, right) => left.due_date.localeCompare(right.due_date) || left.sequence - right.sequence
	);
	/** One repayment entry per agreement per payslip; the earliest outstanding is the one taken. */
	const takenLoanIds = new Set<string>();
	/** The pay line an agreement recovers under on this payslip, or null where this person is not offered it. */
	const recoveryLine = (loan: PreparedLoan): LoanComponent | null => {
		const component = loanRecoveryComponent(loan, currentByCode);
		// Unreachable: `validateLoanRecoveries` refuses the run before it is measured. Stated as a
		// throw rather than a skip because skipping is the defect — a recovery that silently pays
		// nothing leaves the employee owing money no payslip ever mentions.
		if (component == null)
			throw new Error(
				loanComponentMissingIssue(options.bundle.employment.employee_number, loan).message
			);
		if (!isEligible(component.eligibility, options.subject)) return null;
		/**
		 * A government loan is not settled out of a final salary.
		 *
		 * The borrower owes the authority, not the employer: the scheme collects the balance after
		 * the contract ends, and sweeping it into the last payslip both over-recovers a month and
		 * takes money the employer has no claim on. An employer loan is the opposite — the
		 * agreement ends with the employment — so only `GOVERNMENT` is exempt, and it stays owed.
		 */
		if (component.loan_type === 'GOVERNMENT' && isFinalPayslip(options.bundle)) return null;
		if (component.destination !== 'NET' || component.direction !== 'SUBTRACT')
			refuse(
				`${options.bundle.employment.employee_number}: ${component.code} must recover from net pay (NET / SUBTRACT), preserving gross wages and deduction limits.`
			);
		if (
			options.configuration.jurisdiction.payroll.deduction_ceiling?.approved_loan_extension?.codes.includes(
				component.code
			) &&
			!loan.approval_reference?.trim()
		)
			refuse(
				`${options.bundle.employment.employee_number}: ${component.code} requires the authority's written permission in the loan approval reference before payroll recovery.`
			);
		return component;
	};
	/**
	 * A rule-recovered order: one line per payslip while it is in force and owed, priced at nothing here.
	 * Its amount needs the net pay the rest of the payslip leaves, so `settleWithOrders` prices it.
	 */
	for (const loan of options.bundle.loans) {
		if (!isOrder(loan)) continue;
		const range = readRange(loan.effective_range);
		const window = options.bundle.window.salary;
		if (range == null || dateKey(range.start) > window.end) continue;
		if (dateKey(range.end) !== '' && dateKey(range.end) < window.start) continue;
		if (orderBalance(loan, options.bundle.loanRepayments) <= 0) continue;
		if (loan.on_exit === 'NONE' && isFinalPayslip(options.bundle)) continue;
		const component = recoveryLine(loan);
		if (component == null) continue;
		recoveries.push({
			input: { family: 'LOAN_REPAYMENT', id: loan.id },
			catalogueComponent: component,
			bucket: settlementBucket(component.destination, component.direction),
			label: component.code,
			amount: 0,
			quantity: null,
			rate: null,
			statutoryRuleKey: null
		});
	}
	for (const repayment of dueRepayments) {
		if (repayment.payslip_id != null) continue;
		// Present by construction: the bundle's repayments are gathered from these very loans.
		const loan = loanById.get(repayment.loan_id)!;
		if (isOrder(loan)) continue;
		const due = dateKey(repayment.due_date) || repayment.due_date.slice(0, 10);
		/**
		 * Due by now, not due exactly now — and one instalment to a payslip, whole.
		 *
		 * A repayment row is recovered in full by exactly one payslip (its `payslip_id`); one an
		 * earlier run could not take (net-pay guard) or that a deleted draft released is still
		 * unlinked and is recovered here. A person's arrears are not swept in one month: each
		 * payslip links at most one repayment per agreement, the earliest still unlinked, so a
		 * monthly plan stays monthly when runs resume after a gap.
		 *
		 * "By now" is the salary period this payslip pays, not the entry cutoff: an instalment is a
		 * date the agreement fixed, not a late-reported event, so it is taken on the payslip whose
		 * period contains its due date (a 25 January instalment at a 21st-cutoff company is
		 * January's, paid 31 January). Mapping it through `defaultPayPeriod` pushed every
		 * instalment after the cutoff a month late, past the final payslip of a leaver in that
		 * month and past the advance-recovery deadline below, which reads the due dates themselves.
		 */
		if (due > options.bundle.window.salary.end) continue;
		if (takenLoanIds.has(repayment.loan_id)) continue;
		const component = recoveryLine(loan);
		if (component == null) continue;
		const advance = options.configuration.jurisdiction.payroll.deduction_ceiling?.advance_recovery;
		if (advance?.codes.includes(component.code)) {
			if (advance.first_full_period) {
				const disbursed = dateKey(loan.disbursed_on);
				if (!disbursed)
					refuse(
						`${options.bundle.employment.employee_number}: ${component.code} requires its actual disbursement date before payroll recovery.`
					);
				const { hire } = employmentDates(options.bundle.employment);
				if (disbursed < hire) {
					if (advance.unrecoverable_before_employment_codes?.includes(component.code))
						refuse(
							`${options.bundle.employment.employee_number}: ${component.code} paid before employment cannot be recovered from salary.`
						);
					if (hire > options.bundle.window.salary.start)
						refuse(
							`${options.bundle.employment.employee_number}: ${component.code} paid before employment may begin recovery only with the first completed salary period. Move this instalment to that period.`
						);
				}
			}
			const schedule = dueRepayments.filter((row) => row.loan_id === loan.id);
			const first = dateKey(schedule[0]!.due_date);
			const anniversaryMonth = shiftPeriod(first.slice(0, 7), advance.months);
			const anniversary = `${anniversaryMonth}-${first.slice(8)}`;
			const monthEnd = monthBounds(anniversaryMonth).end;
			const deadline = anniversary < monthEnd ? anniversary : monthEnd;
			if (
				dateKey(schedule.at(-1)!.due_date) > deadline ||
				dateKey(options.bundle.window.payDate) > deadline
			)
				refuse(
					`${options.bundle.employment.employee_number}: ${component.code} advance recovery exceeds ${advance.months} months from its first instalment (${first}). Revise the recovery arrangement before payroll.`
				);
		}
		takenLoanIds.add(repayment.loan_id);
		const amount = cents(repayment.amount_due);
		recoveries.push({
			input: { family: 'LOAN_REPAYMENT', id: repayment.id },
			catalogueComponent: component,
			bucket: settlementBucket(component.destination, component.direction),
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
export function isFinalPayslip(bundle: Pick<EmploymentBundle, 'employment' | 'window'>): boolean {
	const exit = employmentDates(bundle.employment).exit;
	return exit != null && exit <= bundle.window.salary.end;
}

/**
 * A month that recovered less than the agreement's floor is the operator's decision, not a rounding.
 *
 * `settle` drops a whole recovery the net-pay guard cannot take and records it in `shortfalls`. A
 * catalogue row that states `minimum_repayment` blocks the run when a month falls under it — the
 * operator either resolves the deduction or withholds the person — and one that states no floor
 * warns, because a dropped recovery is still a fact worth reading.
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
		const floor = component.minimum_repayment == null ? null : component.minimum_repayment;
		const taken = takenByComponent.get(shortfall.componentCatalogueId) ?? 0;
		const short = cents(shortfall.amount);
		issues.push(
			floor != null && taken < floor
				? {
						code: 'LOAN_REPAYMENT_BELOW_MINIMUM',
						message:
							`${options.employeeNumber} recovered ${taken} under ${component.code}, below the ` +
							`agreed minimum of ${floor}: ${shortfall.cause === 'DEDUCTION_CEILING' ? 'the deduction ceiling' : 'net pay'} could not carry ${short} of this period's ` +
							'instalment. Resolve the deduction or withhold this person from the run.',
						collection: 'employments',
						recordId: options.employmentId
					}
				: {
						code: 'LOAN_REPAYMENT_SHORT',
						severity: 'WARNING',
						message:
							`${options.employeeNumber} could not repay ${short} under ${component.code} this ` +
							`period; ${shortfall.cause === 'DEDUCTION_CEILING' ? 'it would have taken deductions past the lawful ceiling' : 'net pay would have gone negative'}. It stays outstanding.`,
						collection: 'employments',
						recordId: options.employmentId
					}
		);
	}
	return issues;
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
	readonly world: PayrollWorld;
	readonly employmentIds: readonly string[];
}) {
	const employmentIds = new Set(options.employmentIds);
	const rawLoans = live(options.world.loans).filter((row) => employmentIds.has(row.employment_id));
	const catalogueIds = new Set(rawLoans.map((row) => row.loan_catalogue_id));
	const loanIds = new Set(rawLoans.map((row) => row.id));
	const agreedById = new Map(
		live(options.world.loan_catalogue)
			.filter((row) => catalogueIds.has(row.id))
			.map((row) => [row.id, loanComponent(row)])
	);
	const loans = rawLoans.map((loan): PreparedLoan => {
		const catalogueComponent = agreedById.get(loan.loan_catalogue_id);
		if (catalogueComponent == null)
			refuse('A loan must reference an approved row of the loan catalogue it was agreed under.');
		return { ...loan, catalogueComponent };
	});
	return {
		loansByEmployment: Map.groupBy(loans, (row) => row.employment_id),
		// Settled rows also establish the start of a statutory recovery time limit.
		repaymentsByLoan: Map.groupBy(
			live(options.world.loan_repayments).filter((row) => loanIds.has(row.loan_id)),
			(row) => row.loan_id
		)
	};
}

export const prepareLoanCatalogue = (world: PayrollWorld, settingsId: string) =>
	live(world.loan_catalogue)
		.filter((row) => row.settings_id === settingsId)
		.map((row) => loanComponent(row));

/** One stored catalogue row as the engine's pay line; a loan recovery is never anything else. */
const loanComponent = (row: WorkspaceRow<'loan_catalogue'>): LoanComponent => ({
	...row,
	family: 'LOAN' as const,
	// The enum columns arrive as text at the database boundary; the model constrains them to the
	// landing vocabulary, so the engine restates it once here.
	destination: row.destination,
	direction: row.direction,
	definition: { source: 'ENTRY' as const }
});

// ── deduction orders ────────────────────────────────────────────────────────────────────────

/** An agreement recovered by its stored `recovery_rule`, not by a schedule of repayments. */
export const isOrder = (loan: Pick<Loan, 'recovery_rule'> | undefined): boolean =>
	(loan?.recovery_rule ?? '').trim() !== '';

const loanOf = (bundle: Pick<EmploymentBundle, 'loans'>, repayment: LoanRepayment) =>
	bundle.loans.find((loan) => loan.id === repayment.loan_id);

/** What an order still owes: its principal less every repayment a payslip holds. An unlinked row is a released draft's. */
export function orderBalance(
	loan: Pick<Loan, 'id' | 'principal'>,
	repayments: readonly Pick<LoanRepayment, 'loan_id' | 'payslip_id' | 'amount_due'>[]
): number {
	const recovered = repayments.reduce(
		(total, row) =>
			total +
			(row.loan_id === loan.id && row.payslip_id != null ? decodeNumber(row.amount_due) : 0),
		0
	);
	return Math.max(0, cents(decodeNumber(loan.principal) - recovered));
}

type SettleOptions = Parameters<typeof settle>[0];

/**
 * SETTLE for a payslip that carries rule-recovered orders.
 *
 * An order's amount is a stored expression over the net pay the rest of the payslip leaves, so the
 * payslip is settled once without its orders; then, lowest `priority` first, each order withholds
 * `min(balance, rule, net left)` floored to the minor unit, and what it took is gone for the next.
 * `on_exit: BALANCE` replaces the rule on the final payslip with the whole balance. The payslip is then
 * settled again with the orders in, so the deduction ceiling judges them like any recovery. With no
 * order on the payslip this is `settle` itself.
 */
export function settleWithOrders(
	options: SettleOptions & {
		readonly bundle: EmploymentBundle;
		readonly configuration: Configuration;
	}
): { readonly settlement: Settlement; readonly issues: readonly RunIssue[] } {
	const { bundle, configuration, ...settleOptions } = options;
	const orders = new Map(bundle.loans.filter(isOrder).map((loan) => [loan.id, loan]));
	const isOrderLine = (item: MeasuredAdjustment) =>
		item.input.family === 'LOAN_REPAYMENT' && orders.has(item.input.id);
	const lines = settleOptions.adjustments.filter(isOrderLine);
	if (lines.length === 0) return { settlement: settle(settleOptions), issues: [] };

	const first = settle({
		...settleOptions,
		adjustments: settleOptions.adjustments.filter((item) => !isOrderLine(item))
	});
	const scale = 10 ** currencyFractionDigits(settleOptions.currency);
	const floorMinor = (value: number) => roundMoney(value * scale, 'FLOOR_UNIT') / scale;
	const statutory = settleOptions.charges.reduce((total, charge) => total + charge.employee, 0);
	const final = settleOptions.finalPay === true;
	let floor: number | undefined;
	const wageFloor = () =>
		(floor ??= windowMinimumWage(
			configuration,
			bundle.employedDays ?? bundle.window.salary,
			bundle.termsHistory,
			bundle.employment.employee_number
		));
	let left = first.net;
	const taken: MeasuredAdjustment[] = [];
	const issues: RunIssue[] = [];
	const ordered = lines.toSorted((a, b) => {
		const x = orders.get(a.input.id)!;
		const y = orders.get(b.input.id)!;
		return (
			(x.priority ?? 0) - (y.priority ?? 0) ||
			dateKey(x.effective_from).localeCompare(dateKey(y.effective_from)) ||
			x.id.localeCompare(y.id)
		);
	});
	for (const line of ordered) {
		const loan = orders.get(line.input.id)!;
		const principal = cents(decodeNumber(loan.principal));
		const balance = orderBalance(loan, bundle.loanRepayments);
		const rule = loan.recovery_rule!.trim();
		const wanted =
			final && loan.on_exit === 'BALANCE'
				? balance
				: evaluateNumber(expressionEngine, rule, {
						payment: {
							gross: first.gross,
							net: left,
							disposable: cents(first.gross - statutory),
							final
						},
						order: {
							principal,
							recovered: cents(principal - balance),
							balance,
							priority: loan.priority ?? 0,
							creditor: loan.creditor ?? 'EMPLOYER',
							authority: loan.authority ?? ''
						},
						wage_floor: rule.includes('wage_floor') ? wageFloor() : 0
					});
		const amount = floorMinor(Math.min(balance, Math.max(0, wanted), left));
		left = cents(left - amount, settleOptions.currency);
		if (amount > 0) taken.push({ ...line, amount });
		if (final && balance - amount > 0)
			issues.push({
				code: 'ORDER_OUTSTANDING_AT_EXIT',
				severity: 'WARNING',
				message:
					`${bundle.employment.employee_number} leaves this period owing ${cents(balance - amount)} ` +
					`under ${loan.reference ?? loan.id}${loan.authority ? ` (${loan.authority})` : ''}; ` +
					'this final payslip withheld what the order allows. Notify the creditor of the balance.',
				collection: 'loans',
				recordId: loan.id
			});
	}
	const second = settle({ ...settleOptions, adjustments: [...first.adjustments, ...taken] });
	return {
		settlement: {
			...second,
			shortfalls: [...first.shortfalls, ...second.shortfalls],
			ceilingExcess: Math.max(first.ceilingExcess, second.ceilingExcess)
		},
		issues
	};
}

/** A repayment the run writes under its payslip: what one order withheld. */
export type OrderRepaymentCreate = {
	readonly loan_id: string;
	readonly employment_id: string;
	readonly due_date: string;
	readonly amount_due: number;
	readonly sequence: number;
};

/**
 * The loan captures of one settled payslip.
 *
 * `link` is every repayment the payslip holds: the scheduled ones it recovered, and an order's unlinked
 * row that a deleted draft left with exactly this period's day and amount (a recompute of the same
 * inputs). `create` is the repayment each other order line records. `stale` is every other unlinked
 * row of an order: no payslip holds it and payroll never reads it, so the run removes it.
 */
export function loanCaptures(options: {
	readonly bundle: EmploymentBundle;
	readonly settlement: Pick<Settlement, 'adjustments'>;
	/** The repayment ids MEASURE read (`captured.loanRepayments`). */
	readonly captured: readonly string[];
}): {
	readonly link: readonly string[];
	readonly create: readonly OrderRepaymentCreate[];
	readonly stale: readonly string[];
} {
	const { bundle } = options;
	const orderIds = new Set(bundle.loans.filter(isOrder).map((loan) => loan.id));
	const recovered = new Map(
		options.settlement.adjustments
			.filter((row) => row.input.family === 'LOAN_REPAYMENT')
			.map((row) => [row.input.id, row.amount])
	);
	const link = options.captured.filter((id) => recovered.has(id) && !orderIds.has(id));
	const create: OrderRepaymentCreate[] = [];
	const due = bundle.window.salary.end;
	const reused = new Set<string>();
	for (const loanId of orderIds) {
		const amount = recovered.get(loanId);
		if (amount == null || amount <= 0) continue;
		const rows = bundle.loanRepayments.filter((row) => row.loan_id === loanId);
		const again = rows.find(
			(row) =>
				row.payslip_id == null &&
				dateKey(row.due_date) === due &&
				cents(decodeNumber(row.amount_due)) === amount
		);
		if (again != null) {
			reused.add(again.id);
			link.push(again.id);
			continue;
		}
		create.push({
			loan_id: loanId,
			employment_id: bundle.employment.id,
			due_date: due,
			amount_due: amount,
			sequence: Math.max(0, ...rows.map((row) => row.sequence)) + 1
		});
	}
	const stale = bundle.loanRepayments
		.filter((row) => orderIds.has(row.loan_id) && row.payslip_id == null && !reused.has(row.id))
		.map((row) => row.id);
	return { link, create, stale };
}

/**
 * What a run withheld for third parties, by the loan catalogue code it was withheld under: the amount a
 * remittance duty (`duty_types`, trigger RUN_FINALISED) owes each creditor, read as `run.withheld.<code>`.
 * ponytail: keyed by catalogue code, so two courts under one code share one duty; key by `authority` if a
 * lineage needs one instance per creditor.
 */
export function thirdPartyWithheld(
	loans: readonly Pick<Loan, 'id' | 'creditor'>[],
	repayments: readonly Pick<LoanRepayment, 'id' | 'loan_id'>[],
	adjustments: readonly Pick<MeasuredAdjustment, 'input' | 'amount' | 'catalogueComponent'>[]
): Readonly<Record<string, number>> {
	const owed = new Set(
		loans.filter((loan) => loan.creditor === 'THIRD_PARTY').map((loan) => loan.id)
	);
	// An order's line names its loan; a scheduled recovery's names its repayment.
	const thirdParty = new Set([
		...owed,
		...repayments.filter((row) => owed.has(row.loan_id)).map((row) => row.id)
	]);
	const withheld: Record<string, number> = {};
	for (const row of adjustments) {
		if (row.input.family !== 'LOAN_REPAYMENT' || !thirdParty.has(row.input.id)) continue;
		const code = row.catalogueComponent.code;
		withheld[code] = cents((withheld[code] ?? 0) + row.amount);
	}
	return withheld;
}
