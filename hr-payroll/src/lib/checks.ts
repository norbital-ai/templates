/**
 * Stored checks (E9): the one gate every lifecycle stage calls. A version's `checks` (`datatypes/checks.ts`) are
 * evaluated over the person on the stage's rule date plus the stage's own roots; a duty type's `blocks`
 * (`jurisdiction_settings.duty_types`) refuses the stage while an instance of it is OPEN on the subject. No rule,
 * figure or sentence lives here: each is the version's.
 *
 * `checkIssues` is pure (the run's callers hold the person). `employmentCheckIssues` reads what a collection
 * transform does not hold — the person, the version in force, the subject's open duties — and is the one-line
 * call of the employments, terms, leave and loan transforms. `refuseChecks` turns the result into the
 * transform's refusal.
 */

import { checksOf, type Check, type CheckStage } from './datatypes/checks.js';
import {
	evaluateExpression,
	expressionEngine,
	type ExpressionEngine
} from './expressions/evaluate.js';
import { dutyTypesOf, type DutyType } from './obligations/materialise.js';
import { personAt, readLeaveContext, type LeaveContext } from './leave/context.js';
import { readAll, type Reads } from './reads.js';
import { settingsInForce } from './jurisdiction_settings.js';
import { sealedLineages } from './entity-facts.js';
import { readRange } from './payroll/run/effective.js';
import { addDays } from './payroll/run/dates.js';
import { getErrorMessage } from './refuse.js';
import type { PersonContext } from './payroll/run/eligibility.js';
import type { RunIssue } from './payroll/run/validate.js';

/** The stage's own roots, beside the person. Absent roots read blank, never fail. */
export type CheckRoots = {
	readonly before?: PersonContext['terms'] | undefined;
	readonly deduction?:
		| {
				readonly code: string;
				readonly amount: number;
				readonly gross: number;
				readonly net: number;
				readonly total: number;
		  }
		| undefined;
	readonly leave?:
		| {
				readonly code: string;
				readonly from: string;
				readonly to: string;
				readonly days: number;
				readonly facts: Readonly<Record<string, unknown>>;
		  }
		| undefined;
	readonly payslip?:
		| {
				readonly gross: number;
				readonly net: number;
				readonly deductions: number;
				readonly lines: Readonly<Record<string, number>>;
				/** The run's pay date: a final-pay deadline compares it with `add_days(employment.exit_date, n)`. */
				readonly pay_date: string;
		  }
		| undefined;
};

const BLANK_ROOTS = {
	deduction: { code: '', amount: 0, gross: 0, net: 0, total: 0 },
	leave: { code: '', from: '', to: '', days: 0, facts: {} },
	payslip: { gross: 0, net: 0, deductions: 0, lines: {}, pay_date: '' }
} as const;

/** The object a check's `when` evaluates over. */
export function checkContext(options: {
	readonly at: CheckStage;
	readonly date: string;
	readonly person: PersonContext;
	/** The duty codes still OPEN on the subject. */
	readonly open?: readonly string[] | undefined;
	readonly roots?: CheckRoots | undefined;
}): Record<string, unknown> {
	const roots = options.roots ?? {};
	return {
		...options.person,
		...BLANK_ROOTS,
		...roots,
		before: roots.before ?? options.person.terms,
		after: options.person.terms,
		check: { at: options.at, date: options.date },
		obligations: { open: [...new Set(options.open ?? [])] }
	};
}

/**
 * The issues the version's checks at one stage raise over one subject. A check that cannot be evaluated is a
 * blocker naming it: a rule the version states but the engine cannot read must not pass in silence.
 */
export function checkIssues(options: {
	readonly checks: readonly Check[];
	readonly at: CheckStage;
	readonly context: object;
	/** Who the sentence is about (an employee number); prefixed to every message. */
	readonly subject: string;
	readonly collection?: string | undefined;
	readonly recordId?: string | undefined;
	readonly engine?: ExpressionEngine | undefined;
}): RunIssue[] {
	const issues: RunIssue[] = [];
	const prefix = options.subject === '' ? '' : `${options.subject}: `;
	for (const check of options.checks) {
		if (check.at !== options.at) continue;
		let fired: unknown;
		try {
			fired = evaluateExpression(options.engine ?? expressionEngine, check.when, options.context);
		} catch (error) {
			fired = error;
		}
		if (fired === false) continue;
		const authority = check.authority?.trim() ? ` (${check.authority.trim()})` : '';
		issues.push({
			code: check.code,
			severity: fired === true && check.severity === 'WARN' ? 'WARNING' : 'BLOCKER',
			message:
				fired === true
					? `${prefix}${check.message}${authority}`
					: `${prefix}check ${check.code} could not be evaluated: ${
							fired instanceof Error
								? getErrorMessage(fired)
								: `it produced ${String(fired)}, not a boolean`
						}.`,
			collection: options.collection,
			recordId: options.recordId
		});
	}
	return issues;
}

/** A blocker for every duty type that `blocks` this word and still has an OPEN instance on the subject. */
export function dutyBlockIssues(options: {
	readonly duties: readonly DutyType[];
	readonly block: NonNullable<DutyType['blocks']>;
	/** The duty codes still OPEN on the subject. */
	readonly open: readonly string[];
	readonly subject: string;
	readonly collection?: string | undefined;
	readonly recordId?: string | undefined;
}): RunIssue[] {
	const prefix = options.subject === '' ? '' : `${options.subject}: `;
	return options.duties
		.filter((duty) => duty.blocks === options.block && options.open.includes(duty.code))
		.map((duty) => ({
			code: `DUTY_OPEN_${duty.code}`,
			message: `${prefix}${duty.label?.trim() || duty.code} is still open (${duty.authority}); fulfil or waive it first.`,
			collection: options.collection,
			recordId: options.recordId
		}));
}

/** Refuses on the blockers, every sentence at once; returns the warnings for the caller to report. */
export function refuseChecks(
	issues: readonly RunIssue[],
	refuse: (message: string) => never
): RunIssue[] {
	const blocking = issues.filter((issue) => issue.severity !== 'WARNING');
	if (blocking.length > 0) refuse(blocking.map((issue) => issue.message).join(' '));
	return issues.filter((issue) => issue.severity === 'WARNING');
}

type CandidateEmployment = {
	readonly id?: string | null | undefined;
	readonly employee_id?: string | null | undefined;
	readonly company_id?: string | null | undefined;
	readonly employee_number?: string | null | undefined;
	readonly effective_range?: unknown;
	readonly prior_service_months?: number | null | undefined;
	readonly exit_ground?: string | null | undefined;
	readonly exit_facts?: Readonly<Record<string, unknown>> | null | undefined;
};

/** A candidate's placeholder id until the row is written. */
const NEW = '(new)';

/**
 * The issues one employment's stage raises, read as the transform's `db`: the version in force on `date`, the
 * person on that day with the candidate row (and candidate terms) in place of the stored ones, and the duties
 * OPEN on the employment. Nothing past the version is read where it declares nothing for the stage.
 */
export async function employmentCheckIssues(
	reads: Reads,
	options: {
		readonly at: CheckStage;
		/** The employment as it will be written. */
		readonly employment: CandidateEmployment;
		/** Terms rows as they will be written (a new contract's first terms, a revision); stored rows otherwise. */
		readonly terms?: readonly Readonly<Record<string, unknown>>[] | undefined;
		/** The rule date: the hire day, the change's first day, the last day, the entry's first day. */
		readonly date: string;
		readonly roots?: CheckRoots | undefined;
	}
): Promise<RunIssue[]> {
	const { employment, at, date } = options;
	if (employment.company_id == null || employment.employee_id == null) return [];
	const companies = await readAll<LeaveContext['companies'][number]>(reads, 'companies', {
		id: { in: [employment.company_id] }
	});
	const company = companies[0];
	if (company == null) return [];
	// Narrowed, so the custom `checks` and `duty_types` are read (a default projection omits them).
	const versions = await readAll<
		Parameters<typeof settingsInForce>[0][number] & { checks?: unknown; duty_types?: unknown }
	>(reads, 'jurisdiction_settings', sealedLineages([company.settings_code]).where, undefined, {
		id: true,
		code: true,
		sealed_at: true,
		voided_at: true,
		approval_id: true,
		effective_range: true,
		checks: true,
		duty_types: true
	});
	const version = settingsInForce(versions, company.settings_code, date);
	const checks = checksOf(version).filter((check) => check.at === at);
	// An employment's own duties block its exit; a run's are the precheck's (`payrollRunPrecheck`).
	const block = at === 'EXIT' ? 'EXIT' : null;
	const blocking = dutyTypesOf(version).filter((duty) => block != null && duty.blocks === block);
	if (checks.length === 0 && blocking.length === 0) return [];

	const id = employment.id ?? NEW;
	const context = await readLeaveContext(reads, employment.id == null ? [] : [employment.id]);
	const [employees, open] = await Promise.all([
		context.employees.some((row) => row.id === employment.employee_id)
			? []
			: readAll<LeaveContext['employees'][number]>(reads, 'employees', {
					id: { in: [employment.employee_id] }
				}),
		employment.id == null
			? []
			: readAll<{ readonly duty_code: string }>(
					reads,
					'obligation_instances',
					{
						subject_kind: { eq: 'EMPLOYMENT' },
						subject_id: { eq: employment.id },
						state: { eq: 'OPEN' }
					},
					undefined,
					{ duty_code: true }
				)
	]);
	const stored = context.employments.find((row) => row.id === id);
	// repository-health:allow R3b -- a candidate is a stored terms row merged with its validated input, so every terms field is there
	const candidateTerms = (options.terms ?? []).map((row) => ({
		...row,
		id: String(row.id ?? NEW),
		employment_id: id
	})) as unknown as LeaveContext['terms'];
	const spliced: LeaveContext = {
		...context,
		employments: [
			...context.employments.filter((row) => row.id !== id),
			{
				...stored,
				id,
				employee_id: employment.employee_id,
				company_id: employment.company_id,
				effective_range: readRange(employment.effective_range ?? stored?.effective_range),
				prior_service_months:
					employment.prior_service_months ?? stored?.prior_service_months ?? null,
				exit_ground: employment.exit_ground ?? stored?.exit_ground ?? null,
				exit_facts: employment.exit_facts ?? stored?.exit_facts ?? null
			}
		],
		companies: context.companies.some((row) => row.id === company.id)
			? context.companies
			: [...context.companies, company],
		employees: [...context.employees, ...employees],
		// Candidates first: the row in force is the first that covers the day, so a revision wins over the row it closes.
		terms: [
			...candidateTerms,
			...context.terms.filter((row) => !candidateTerms.some((candidate) => candidate.id === row.id))
		]
	};
	const person = personAt(spliced, id, date);
	const openCodes = open.map((row) => row.duty_code);
	const subject = employment.employee_number ?? '';
	// The terms before a change are those in force the day before it, as stored.
	const before =
		at === 'TERMS_CHANGE' && options.roots?.before == null
			? personAt({ ...spliced, terms: context.terms }, id, addDays(date, -1)).terms
			: options.roots?.before;
	return [
		...checkIssues({
			checks,
			at,
			context: checkContext({
				at,
				date,
				person,
				open: openCodes,
				roots: { ...options.roots, before }
			}),
			subject,
			collection: 'employments',
			recordId: employment.id ?? undefined
		}),
		...(block == null
			? []
			: dutyBlockIssues({
					duties: blocking,
					block,
					open: openCodes,
					subject,
					collection: 'employments',
					recordId: employment.id ?? undefined
				}))
	];
}
