import { refuse, type Api } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import {
	coversDate,
	readRange,
	type StoredRange
} from '../collections/payroll_runs/lib/effective.js';
import { dateKey } from './iso-day.js';
import type { WorkspaceRow } from '$bolt/types.js';
import type { WorkspaceSchema } from '$bolt/types.js';
import type { LeaveCharge } from '../datatypes/leave_charges/+definition.js';
import type { LeaveEvent } from '../datatypes/leave_event/+definition.js';

const CONTRACT_INPUT_SOURCES = [
	'employment_terms',
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
			columns: { effective_range: true }
		});
		const exit = readRange(employment?.effective_range)?.end;
		const exitKey = exit == null ? null : dateKey(exit);
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
			const through = leaveTermsThrough(row.event, row.charges, exitKey);
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

/** The stint's first day as a `YYYY-MM-DD` key, for the person contexts payroll evaluates. */
export function serviceStart(employment: { readonly effective_range: StoredRange | null }): string {
	return employment.effective_range == null ? '' : dateKey(employment.effective_range.start);
}

/** Service dates are the signed range itself: start is the first day of service, end the last day of work. */
export function resolveEmployment<T extends { readonly effective_range: unknown }>(contract: T) {
	const range = readRange(contract.effective_range);
	return { ...contract, effective_range: range };
}

export type ResolvedEmployment = ReturnType<typeof resolveEmployment<WorkspaceRow<'employments'>>>;

export type ContractCandidate = Partial<
	Pick<
		WorkspaceRow<'employments'>,
		'id' | 'employee_id' | 'company_id' | 'effective_range' | 'contract_number'
	>
>;

/** The next rolling contract number for a person at an entity: one past the highest on record. */
export function nextContractNumber(
	candidate: Pick<ContractCandidate, 'employee_id' | 'company_id'>,
	others: readonly ContractCandidate[]
): number {
	let highest = 0;
	for (const other of others)
		if (
			other.employee_id === candidate.employee_id &&
			other.company_id === candidate.company_id &&
			typeof other.contract_number === 'number' &&
			other.contract_number > highest
		)
			highest = other.contract_number;
	return highest + 1;
}

/** Inclusive service windows are exclusive only within the same person/entity pair. */
export function assertContractDoesNotOverlap(
	candidate: ContractCandidate,
	others: readonly ContractCandidate[]
) {
	const serviceWindow = (row: ContractCandidate) => {
		const range = readRange(row.effective_range);
		if (!row.employee_id || !row.company_id || !range)
			refuse('A contract needs an employee profile, legal entity and service period.');
		const start = dateKey(range.start);
		const end = range.end == null ? '9999-12-31' : dateKey(range.end);
		if (end < start) refuse('A contract cannot end before its service starts.');
		return { start, end };
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
