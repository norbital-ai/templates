import { refuse, type Api } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { coversDate, readRange } from '../collections/payroll_runs/lib/effective.js';
import { dateKey } from './iso-day.js';
import type { WorkspaceRow } from '$bolt/types.js';
import type { WorkspaceSchema } from '$bolt/types.js';
import type { LeaveCharge } from '../datatypes/leave_charges/+definition.js';
import type { LeaveEvent } from '../datatypes/leave_event/+definition.js';

const CONTRACT_INPUT_SOURCES = [
	'employment_terms',
	'employment_statutory_facts',
	'claim_requests',
	'allowance_requests',
	'payment_requests',
	'loans',
	'loan_repayments',
	'leave_entries',
	'work_days',
	'payslips'
] as const;

type ContractScoped = { readonly employment_id?: string | null };
type ContractReader = {
	readonly findFirst: (query: {
		readonly where: { readonly employment_id: { readonly eq: string } };
		readonly columns: { readonly id: true };
	}) => Effect.Effect<unknown>;
	readonly findPending: (query: {
		readonly where: { readonly employment_id: { readonly eq: string } };
		readonly limit: number;
	}) => Effect.Effect<readonly unknown[]>;
};

const LABEL: Readonly<Record<(typeof CONTRACT_INPUT_SOURCES)[number], string>> = {
	employment_terms: 'employment terms',
	employment_statutory_facts: 'a statutory fact',
	claim_requests: 'a claim',
	allowance_requests: 'an allowance',
	payment_requests: 'a payment',
	loans: 'a loan',
	loan_repayments: 'a loan repayment',
	leave_entries: 'a leave entry',
	work_days: 'a work day',
	payslips: 'a payslip'
};

/**
 * A contract is sealed by the rows that reference it. There is no separate seal log any more: a
 * contract whose every consumer has been removed is editable again (2026-09-09 inlining).
 */
export function assertContractUnreferenced(api: Api<WorkspaceSchema>, employmentId: string) {
	return Effect.gen(function* () {
		for (const source of CONTRACT_INPUT_SOURCES) {
			// Ten collections, one shape: the union of their clients is not callable, the reader is.
			const reader = api.db[source] as unknown as ContractReader;
			const stored = yield* reader.findFirst({
				where: { employment_id: { eq: employmentId } },
				columns: { id: true }
			});
			if (stored)
				refuse(
					`This employment contract is sealed by ${LABEL[source]}. Record its departure; create a new contract for a rehire.`
				);
			const pending = yield* reader.findPending({
				where: { employment_id: { eq: employmentId } },
				limit: 1
			});
			if (pending.length)
				refuse(
					'An event awaiting approval references this employment contract. Resolve it before changing the contract.'
				);
		}
	});
}

/** The two rules every employee event obeys: it names a contract, and it never changes contract. */
export function boundToContract<T extends ContractScoped>(input: T, existing?: ContractScoped): T {
	const employmentId = input.employment_id ?? existing?.employment_id;
	if (!employmentId) refuse('An employee event must reference an employment contract.');
	if (existing != null && employmentId !== existing.employment_id)
		refuse(
			'An existing event cannot move to another employment contract. Reverse it and create a new event.'
		);
	return input;
}

/** The date through which one Leave activity consumed employment terms; null when it did not. */
export function leaveTermsThrough(
	event: LeaveEvent,
	charges: readonly LeaveCharge[],
	exit: string | null
) {
	if (event.kind === 'TIME_OFF')
		return (
			charges
				.map((charge) => charge.date)
				.toSorted()
				.at(-1) ?? null
		);
	const date =
		event.kind === 'ENCASHMENT'
			? [event.effective_on, event.source_window.end].toSorted()[0]!
			: event.kind === 'CARRY_FORWARD'
				? event.source_window.end
				: event.kind === 'ADJUSTMENT' && event.days < 0
					? event.effective_on
					: null;
	return date == null ? null : [date, ...(exit == null ? [] : [exit])].toSorted()[0]!;
}

const LIMIT = 20_000;

/**
 * The latest date on which this contract's terms were consumed, read off the consumers themselves:
 * Work consumes its work date, approved Leave its charge or debit valuation date, a committed
 * payslip its `terms_through`. Held proposals protect the same dates until resolved.
 */
export function consumedTermsThrough(api: Api<WorkspaceSchema>, employmentId: string) {
	return Effect.gen(function* () {
		const where = { employment_id: { eq: employmentId } };
		const employment = yield* api.db.employments.findFirst({
			where: { id: { eq: employmentId } },
			columns: { exit_date: true }
		});
		const exit = employment?.exit_date == null ? null : dateKey(employment.exit_date);
		const dates: string[] = [];
		const work = yield* api.db.work_days.findFirst({
			where,
			columns: { work_date: true },
			orderBy: { work_date: 'desc' }
		});
		if (work) dates.push(dateKey(work.work_date));
		const pendingWork = yield* api.db.work_days.findPending({ where, limit: LIMIT });
		const leave = yield* api.db.leave_entries.findMany({
			where,
			columns: { event: true, charges: true },
			limit: LIMIT
		});
		const pendingLeave = yield* api.db.leave_entries.findPending({ where, limit: LIMIT });
		if (pendingWork.length >= LIMIT || leave.length >= LIMIT || pendingLeave.length >= LIMIT)
			refuse('Too many inputs to verify employment term history.');
		for (const row of pendingWork) if (row.work_date != null) dates.push(dateKey(row.work_date));
		for (const row of [...leave, ...pendingLeave]) {
			if (row.event == null || row.charges == null) continue;
			const through = leaveTermsThrough(row.event, row.charges, exit);
			if (through != null) dates.push(through);
		}
		const payslip = yield* api.db.payslips.findFirst({
			where,
			columns: { terms_through: true },
			orderBy: { terms_through: 'desc' }
		});
		if (payslip) dates.push(dateKey(payslip.terms_through));
		return dates.toSorted().at(-1) ?? null;
	});
}

/** The child facts whose legal span holds on `date`; a null span is born → ongoing. */
export function childrenOn<T extends { readonly effective_range: unknown }>(
	children: readonly T[],
	date: string
) {
	return children.filter(
		(row) => row.effective_range == null || coversDate(row.effective_range, date)
	);
}

/** Service dates are a projection of the signed contract and its recorded departure. */
export function resolveEmployment<
	T extends {
		readonly effective_range: unknown;
		readonly exit_date?: string | null;
		readonly exit_reason?: string | null;
	}
>(contract: T) {
	const range = readRange(contract.effective_range);
	const ends = [range?.end, contract.exit_date].filter((value): value is string => value != null);
	const end = ends.toSorted((a, b) => dateKey(a).localeCompare(dateKey(b)))[0] ?? null;
	return {
		...contract,
		exit_date: end,
		exit_reason: contract.exit_reason ?? null,
		effective_range: range == null ? null : { ...range, end }
	};
}

export type ResolvedEmployment = ReturnType<typeof resolveEmployment<WorkspaceRow<'employments'>>>;

export type ContractCandidate = Partial<
	Pick<
		WorkspaceRow<'employments'>,
		| 'id'
		| 'employee_id'
		| 'company_id'
		| 'hire_date'
		| 'effective_range'
		| 'exit_date'
		| 'exit_reason'
		| 'exit_note'
	>
>;

/** Inclusive service windows are exclusive only within the same person/entity pair. */
export function assertContractDoesNotOverlap(
	candidate: ContractCandidate,
	others: readonly ContractCandidate[]
) {
	const serviceWindow = (row: ContractCandidate) => {
		const range = readRange(row.effective_range);
		const hire = row.hire_date == null ? null : dateKey(row.hire_date);
		if (!row.employee_id || !row.company_id || !range || !hire)
			refuse('A contract needs an employee profile, legal entity, hire date and service period.');
		const start = [hire, dateKey(range.start)].toSorted().at(-1)!;
		const end = resolveEmployment({ ...row, effective_range: row.effective_range }).exit_date;
		if (end != null && dateKey(end) < start)
			refuse('A contract cannot end before its service starts.');
		return { start, end: end == null ? '9999-12-31' : dateKey(end) };
	};
	const window = serviceWindow(candidate);
	for (const other of others) {
		if (other.employee_id !== candidate.employee_id || other.company_id !== candidate.company_id)
			continue;
		const otherWindow = serviceWindow(other);
		if (window.start <= otherWindow.end && otherWindow.start <= window.end)
			refuse(
				'This employee already has an active employment contract in this legal entity during those dates. End that contract before the next one starts.'
			);
	}
}
