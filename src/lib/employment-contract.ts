import { refuse, type CollectionTransformDatabase } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import {
	coversDate,
	readRange,
	type StoredRange
} from '../collections/payroll_runs/lib/effective.js';
import { dateKey } from './iso-day.js';
import type { WorkspaceRow } from '$bolt/types.js';
import type { LeaveCharge } from '../datatypes/leave_charges/+definition.js';
import {
	leaveActivityOf,
	normaliseLeaveDays,
	type LeaveEntryActivity
} from './leave/activity-fields.js';

const CONTRACT_INPUT_SOURCES = [
	'employment_terms',
	'claim_requests',
	'adhoc_requests',
	'loans',
	'loan_repayments',
	'leave_entries',
	'work_days',
	'payslips'
] as const;

type ContractScoped = { readonly employment_id?: string | null };
type ContractReader = {
	readonly findMany: (query: {
		readonly where: { readonly employment_id: { readonly in: ReadonlyArray<string> } };
		readonly columns: { readonly employment_id: true; readonly approval_id: true };
		readonly limit: number;
	}) => Effect.Effect<ReadonlyArray<{ employment_id: string; approval_id: string | null }>>;
};

const LABEL: Readonly<Record<(typeof CONTRACT_INPUT_SOURCES)[number], string>> = {
	employment_terms: 'employment terms',
	claim_requests: 'a claim',
	adhoc_requests: 'an ad hoc payment',
	loans: 'a loan',
	loan_repayments: 'a loan repayment',
	leave_entries: 'a leave entry',
	work_days: 'a work day',
	payslips: 'a payslip'
};

const LIMIT = 20_000;

type ContractReadDb = Pick<CollectionTransformDatabase, (typeof CONTRACT_INPUT_SOURCES)[number]>;

/** What references each contract: the first sealing consumer, and whether one awaits approval. */
type ContractReferences = ReadonlyMap<
	string,
	{ readonly sealedBy: string | null; readonly pending: boolean }
>;

/**
 * A contract is sealed by the rows that reference it. There is no separate seal log any more: a
 * contract whose every consumer has been removed is editable again (2026-09-09 inlining). One
 * wave: the eight source reads, together, for every contract the batch names.
 */
export function contractReferences(
	db: ContractReadDb,
	employmentIds: ReadonlyArray<string>
): Effect.Effect<ContractReferences> {
	const ids = [...new Set(employmentIds)];
	if (ids.length === 0) return Effect.succeed(new Map());
	return Effect.map(
		Effect.all(
			CONTRACT_INPUT_SOURCES.map((source) =>
				// Eight collections, one shape: the union of their clients is not callable, the reader is.
				(db[source] as unknown as ContractReader).findMany({
					where: { employment_id: { in: ids } },
					columns: { employment_id: true, approval_id: true },
					limit: LIMIT
				})
			),
			{ concurrency: 'unbounded' }
		),
		(results) => {
			const references = new Map<string, { sealedBy: string | null; pending: boolean }>();
			for (const [index, rows] of results.entries()) {
				const source = CONTRACT_INPUT_SOURCES[index]!;
				for (const row of rows) {
					const entry = references.get(row.employment_id) ?? { sealedBy: null, pending: false };
					entry.sealedBy ??= LABEL[source];
					if (row.approval_id != null) entry.pending = true;
					references.set(row.employment_id, entry);
				}
			}
			return references;
		}
	);
}

/** Refuses changing a contract that any consumer names. */
export function assertContractUnreferenced(
	references: ContractReferences,
	employmentId: string
): void {
	const entry = references.get(employmentId);
	if (entry?.sealedBy != null)
		refuse(
			`This employment contract is sealed by ${entry.sealedBy}. Record its departure; create a new contract for a rehire.`
		);
	if (entry?.pending)
		refuse(
			'An event awaiting approval references this employment contract. Resolve it before changing the contract.'
		);
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
	fields: LeaveEntryActivity,
	charges: readonly LeaveCharge[],
	exit: string | null
) {
	const entry = normaliseLeaveDays({ ...fields, charges });
	const activity = leaveActivityOf(entry);
	if (activity === 'TIME_OFF')
		return (
			charges
				.map((charge) => charge.date)
				.toSorted()
				.at(-1) ?? null
		);
	const candidates = [entry.effective_on, entry.to_date].filter(
		(value): value is string => value != null
	);
	const date =
		activity === 'ENCASHMENT'
			? (candidates.toSorted()[0] ?? null)
			: activity === 'CARRY_FORWARD'
				? (entry.to_date ?? null)
				: activity === 'ADJUSTMENT' && (entry.days ?? 0) < 0
					? (entry.effective_on ?? null)
					: null;
	return date == null ? null : [date, ...(exit == null ? [] : [exit])].toSorted()[0]!;
}

/**
 * The latest date on which each contract's terms were consumed, read off the consumers themselves:
 * Work consumes its work date, approved Leave its charge or debit valuation date, a committed
 * payslip its `terms_through`. Held proposals protect the same dates until resolved. One wave for
 * every contract the batch names.
 */
export function consumedTermsThrough(
	db: Pick<CollectionTransformDatabase, 'employments' | 'work_days' | 'leave_entries' | 'payslips'>,
	employmentIds: ReadonlyArray<string>
): Effect.Effect<ReadonlyMap<string, string>> {
	const ids = [...new Set(employmentIds)];
	if (ids.length === 0) return Effect.succeed(new Map());
	const where = { employment_id: { in: ids } };
	return Effect.map(
		Effect.all(
			[
				db.employments.findMany({
					where: { id: { in: ids } },
					columns: { id: true, effective_range: true },
					limit: ids.length
				}),
				db.work_days.findMany({
					where,
					columns: { employment_id: true, work_date: true },
					limit: LIMIT
				}),
				db.leave_entries.findMany({
					where,
					columns: {
						employment_id: true,
						from_date: true,
						to_date: true,
						days: true,
						encash_days: true,
						as_adjustment_entry: true,
						effective_on: true,
						destination_from: true,
						charges: true
					},
					limit: LIMIT
				}),
				db.payslips.findMany({
					where,
					columns: { employment_id: true, terms_through: true },
					limit: LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		),
		([employments, work, leave, payslips]) => {
			if (work.length >= LIMIT || leave.length >= LIMIT || payslips.length >= LIMIT)
				refuse('Too many inputs to verify employment term history.');
			const exitOf = new Map(
				employments.map((row) => {
					const exit = readRange(row.effective_range)?.end;
					return [row.id, exit == null ? null : dateKey(exit)] as const;
				})
			);
			const through = new Map<string, string>();
			const note = (employmentId: string, date: string | null) => {
				if (date == null || date === '') return;
				const known = through.get(employmentId);
				if (known == null || date > known) through.set(employmentId, date);
			};
			for (const row of work) note(row.employment_id, dateKey(row.work_date));
			for (const row of leave) {
				if (row.charges == null) continue;
				note(
					row.employment_id,
					leaveTermsThrough(row, row.charges, exitOf.get(row.employment_id) ?? null)
				);
			}
			for (const row of payslips) note(row.employment_id, dateKey(row.terms_through));
			return through;
		}
	);
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

/** The stint as the person contexts read it: first day, last day of work and why it ended. */
export function stint(employment: {
	readonly effective_range: StoredRange | null;
	readonly exit_reason?: string | null;
	readonly exit_facts?: Readonly<Record<string, string | number | boolean>> | null;
}): {
	service_start: string;
	exit_date: string | null;
	exit_reason: string | null;
	exit_facts: Readonly<Record<string, string | number | boolean>>;
} {
	const end = employment.effective_range?.end;
	return {
		service_start: serviceStart(employment),
		exit_date: end == null ? null : dateKey(end),
		exit_reason: employment.exit_reason ?? null,
		exit_facts: employment.exit_facts ?? {}
	};
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
