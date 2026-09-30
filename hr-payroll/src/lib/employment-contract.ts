import type { Id, Row, TransformCtx } from '@norbital-ai/bolt';
import { refuse } from './refuse.js';
import type { WorkspaceRow } from './rows.js';
import { scalarFacts } from './payroll/run/eligibility.js';
import { resolveFactValues } from './declared-facts.js';
import type { FactKey } from './datatypes/fact_keys.js';
import { coversDate, readRange, type StoredRange } from '../lib/payroll/run/effective.js';
import { dateKey } from './iso-day.js';
import { decodeNumber } from './wire.js';
import type { LeaveCharge } from './datatypes/leave_charges.js';
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

/** The transform's reads as the workspace (`ctx.db`). */
type Db = Pick<TransformCtx<'employments'>, 'db'>['db'];

/** What references each contract: the first sealing consumer, and whether one awaits approval. */
type ContractReferences = ReadonlyMap<
	string,
	{ readonly sealedBy: string | null; readonly pending: boolean }
>;

/**
 * A contract is sealed by the rows that reference it: a contract whose every consumer has been removed is editable
 * again. One wave: the eight source reads, together, for every contract the batch names.
 */
export async function contractReferences(
	db: Db,
	employmentIds: ReadonlyArray<string>
): Promise<ContractReferences> {
	const ids = [...new Set(employmentIds)] as Id<'employments'>[];
	if (ids.length === 0) return new Map();
	const results = await Promise.all(
		CONTRACT_INPUT_SOURCES.map((source) =>
			db.read(source, { where: { employment_id: { in: ids } }, all: true })
		)
	);
	const references = new Map<string, { sealedBy: string | null; pending: boolean }>();
	for (const [index, page] of results.entries()) {
		const source = CONTRACT_INPUT_SOURCES[index]!;
		for (const row of page.rows as readonly {
			employment_id: string;
			approval_id: string | null;
		}[]) {
			const entry = references.get(row.employment_id) ?? { sealedBy: null, pending: false };
			entry.sealedBy ??= LABEL[source];
			if (row.approval_id != null) entry.pending = true;
			references.set(row.employment_id, entry);
		}
	}
	return references;
}

/** Why a contract that a consumer names cannot change, or null. */
export function contractReferenceFault(
	references: ContractReferences,
	employmentId: string
): string | null {
	const entry = references.get(employmentId);
	if (entry?.sealedBy != null)
		return `This employment contract is sealed by ${entry.sealedBy}. Record its departure; create a new contract for a rehire.`;
	if (entry?.pending)
		return 'An event awaiting approval references this employment contract. Resolve it before changing the contract.';
	return null;
}

/** The two rules every employee event obeys: it names a contract, and it never changes contract. The refusal, or null. */
export function contractBindingFault(
	input: ContractScoped,
	existing?: ContractScoped
): string | null {
	const employmentId = input.employment_id ?? existing?.employment_id;
	if (!employmentId) return 'An employee event must reference an employment contract.';
	if (existing != null && employmentId !== existing.employment_id)
		return 'An existing event cannot move to another employment contract. Reverse it and create a new event.';
	return null;
}

/** `contractBindingFault` as a refusal, for a family's transform. */
export function boundToContract<T extends ContractScoped>(input: T, existing?: ContractScoped): T {
	const fault = contractBindingFault(input, existing);
	if (fault != null) refuse(fault);
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
				: activity === 'ADJUSTMENT' && decodeNumber(entry.hours ?? entry.days ?? 0) < 0
					? (entry.effective_on ?? null)
					: null;
	return date == null ? null : [date, ...(exit == null ? [] : [exit])].toSorted()[0]!;
}

/**
 * The latest date on which each contract's terms were consumed, read off the consumers themselves: Work consumes its
 * work date, approved Leave its charge or debit valuation date, a committed payslip its `terms_through`. Held
 * proposals protect the same dates until resolved. One wave for every contract the batch names.
 */
export async function consumedTermsThrough(
	db: Db,
	employmentIds: ReadonlyArray<string>
): Promise<ReadonlyMap<string, string>> {
	const ids = [...new Set(employmentIds)] as Id<'employments'>[];
	if (ids.length === 0) return new Map();
	const where = { employment_id: { in: ids } };
	const [employments, work, leave, payslips] = await Promise.all([
		db.read('employments', { where: { id: { in: ids } }, all: true }),
		db.read('work_days', { where, all: true }),
		db.read('leave_entries', { where, all: true }),
		db.read('payslips', { where, all: true })
	]);
	const exitOf = new Map(
		employments.rows.map((row) => {
			const exit = readRange(row.effective_range)?.end;
			return [row.id as string, exit == null ? null : dateKey(exit)] as const;
		})
	);
	const through = new Map<string, string>();
	const note = (employmentId: string, date: string | null) => {
		if (date == null || date === '') return;
		const known = through.get(employmentId);
		if (known == null || date > known) through.set(employmentId, date);
	};
	for (const row of work.rows) note(row.employment_id, dateKey(String(row.work_date)));
	for (const row of leave.rows) {
		const fields = row as LeaveEntryActivity & {
			charges: readonly LeaveCharge[] | null;
		};
		if (fields.charges == null) continue;
		note(
			row.employment_id,
			leaveTermsThrough(fields, fields.charges, exitOf.get(row.employment_id) ?? null)
		);
	}
	for (const row of payslips.rows) note(row.employment_id, dateKey(String(row.terms_through)));
	return through;
}

/** The child facts whose legal span holds on `date`; a null span is born → ongoing. */
export function childrenOn<T extends { readonly effective_range?: unknown }>(
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

/**
 * The stint as the person contexts read it: first day, last day of work and why it ended. The
 * departure inputs the governing version declares resolve to their defaults on every site;
 * `exit_fact_keys` stays what was recorded, and requiredness is enforced where a final service
 * day is priced (money.ts).
 */
export function stint(
	employment: {
		readonly effective_range: StoredRange | null;
		readonly exit_reason?: string | null | undefined;
		readonly exit_facts?: Readonly<Record<string, unknown>> | null | undefined;
		readonly prior_service_months?: number | null | undefined;
	},
	declared: readonly FactKey[]
): {
	service_start: string;
	prior_service_months: number;
	exit_date: string | null;
	exit_reason: string | null;
	exit_facts: Readonly<Record<string, string | number | boolean>>;
	exit_fact_keys: readonly string[];
} {
	const end = employment.effective_range?.end;
	const recorded = scalarFacts(employment.exit_facts);
	return {
		service_start: serviceStart(employment),
		prior_service_months: employment.prior_service_months ?? 0,
		exit_date: end == null ? null : dateKey(end),
		exit_reason: employment.exit_reason ?? null,
		exit_facts: { ...recorded, ...resolveFactValues(declared, recorded, 'Departure', false) },
		exit_fact_keys: Object.keys(recorded)
	};
}

/** Service dates are the signed range itself: start is the first day of service, end the last day of work. */
export function resolveEmployment<T extends { readonly effective_range: unknown }>(contract: T) {
	const range = readRange(contract.effective_range);
	return { ...contract, effective_range: range };
}

export type ResolvedEmployment = ReturnType<typeof resolveEmployment<WorkspaceRow<'employments'>>>;

export type ContractCandidate = {
	readonly id?: string | undefined;
	readonly employee_id?: string | null | undefined;
	readonly company_id?: string | null | undefined;
	readonly effective_range?: unknown | undefined;
};

/**
 * Inclusive service windows are exclusive only within the same person/entity pair (the `noOverlap` holds it too; this
 * is the sentence). The refusal, or null.
 */
export function contractOverlapFault(
	candidate: ContractCandidate,
	others: readonly ContractCandidate[]
): string | null {
	const serviceWindow = (row: ContractCandidate) => {
		const range = readRange(row.effective_range);
		if (!row.employee_id || !row.company_id || !range) return null;
		return {
			start: dateKey(range.start),
			end: range.end == null ? '9999-12-31' : dateKey(range.end)
		};
	};
	const window = serviceWindow(candidate);
	if (window == null)
		return 'A contract needs an employee profile, legal entity and service period.';
	if (window.end < window.start) return 'A contract cannot end before its service starts.';
	for (const other of others) {
		if (other.employee_id !== candidate.employee_id || other.company_id !== candidate.company_id)
			continue;
		const otherWindow = serviceWindow(other);
		if (otherWindow != null && window.start <= otherWindow.end && otherWindow.start <= window.end)
			return 'This employee already has an active employment contract in this legal entity during those dates. End that contract before the next one starts.';
	}
	return null;
}
