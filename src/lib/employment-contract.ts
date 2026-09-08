import { refuse, type Api } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { coversDate, readRange } from '../collections/payroll_runs/lib/effective.js';
import { dateKey } from './iso-day.js';
import type { WorkspaceRow } from '$bolt/types.js';
import type { WorkspaceSchema } from '$bolt/types.js';

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

export function assertContractUnreferenced(api: Api<WorkspaceSchema>, employmentId: string) {
	return Effect.gen(function* () {
		const seal = yield* api.db.employment_contract_inputs.findFirst({
			where: { employment_id: { eq: employmentId } },
			columns: { id: true }
		});
		if (seal)
			refuse(
				'This employment contract is sealed by a linked input. Record its departure; create a new contract for a rehire.'
			);
		for (const source of CONTRACT_INPUT_SOURCES) {
			const pending = yield* api.db[source].findPending({
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

/** A new reference and its permanent contract seal commit as one graph. */
export function withContractInput<T extends ContractScoped>(
	input: T,
	existing?: ContractScoped,
	termsThrough?: string | null
) {
	const employmentId = input.employment_id ?? existing?.employment_id;
	if (!employmentId) refuse('An employee event must reference an employment contract.');
	if (existing != null && employmentId !== existing.employment_id)
		refuse(
			'An existing event cannot move to another employment contract. Reverse it and create a new event.'
		);
	return {
		...input,
		...(existing == null
			? {
					employment_contract_input: [
						{
							employment_id: employmentId,
							...(termsThrough == null ? {} : { terms_through: dateKey(termsThrough) })
						}
					]
				}
			: {})
	};
}

/** Permanent history and held consumer proposals protect the same contract-date boundary. */
export function consumedTermsThrough(api: Api<WorkspaceSchema>, employmentId: string) {
	return Effect.gen(function* () {
		const where = { employment_id: { eq: employmentId }, terms_through: { isNull: false } };
		const stored = yield* api.db.employment_contract_inputs.findFirst({
			where,
			columns: { terms_through: true },
			orderBy: { terms_through: 'desc' }
		});
		const pending = yield* api.db.employment_contract_inputs.findPending({ where, limit: 20_000 });
		if (pending.length >= 20_000)
			refuse('Too many pending inputs to verify employment term history.');
		return (
			[stored, ...pending]
				.flatMap((row) => (row?.terms_through == null ? [] : [dateKey(row.terms_through)]))
				.toSorted()
				.at(-1) ?? null
		);
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
