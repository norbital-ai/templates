/**
 * Stored checks (E9): `jurisdiction_settings.checks`. A version declares what refuses or warns at a lifecycle
 * stage — a hire, a change of terms, an exit, a payslip, a leave entry, a deduction — as a boolean expression and
 * the sentence it prints. The engine knows no rule: it evaluates what the version stores (`src/lib/checks.ts`).
 *
 * `when` is the breach: `true` fires the check. It reads the person roots (`employee.*`, `employment.*`,
 * `terms.*`, `company.*`, `worksite.*`) on the stage's rule date, plus the stage's own roots:
 *
 * - every stage: `check.at`, `check.date`, and `obligations.open` — the duty codes still OPEN on the subject;
 * - TERMS_CHANGE: `before.*` and `after.*`, the terms before and after the change (`terms.*` is `after`);
 * - DEDUCTION: `deduction.{code, amount, gross, net, total}` — the line, the slip's gross and net before it, and
 *   every deduction of the slip including it;
 * - LEAVE_ENTRY: `leave.{code, from, to, days, facts.<key>}`;
 * - PAYSLIP: `payslip.{gross, net, deductions, lines.<code>, pay_date}`.
 */

import { programFor } from '../expressions/evaluate.js';
import { getErrorMessage } from '../refuse.js';

export const CHECK_STAGES = [
	'EMPLOYMENT_START',
	'TERMS_CHANGE',
	'EXIT',
	'PAYSLIP',
	'LEAVE_ENTRY',
	'DEDUCTION'
] as const;
export const CHECK_SEVERITIES = ['REFUSE', 'WARN'] as const;

export type CheckStage = (typeof CHECK_STAGES)[number];
export type CheckSeverity = (typeof CHECK_SEVERITIES)[number];

/** One declared check, as the version stores it. */
export type Check = {
	readonly code: string;
	readonly at: CheckStage;
	/** Boolean over the check context: `true` is the breach. */
	readonly when: string;
	readonly severity: CheckSeverity;
	/** What the operator reads when it fires. */
	readonly message: string;
	/** The instrument and section that imposes it. */
	readonly authority?: string | null;
};

/** The checks a stored version declares; `[]` where it declares none. */
export const checksOf = (version: object | null | undefined): readonly Check[] => {
	const checks = (version as { readonly checks?: unknown } | null | undefined)?.checks;
	return Array.isArray(checks) ? (checks as readonly Check[]) : [];
};

/**
 * Why a list of checks cannot be stored, or null. Members are judged by the version's seal against the check
 * site; here only the shape and the syntax.
 */
export function checksFault(checks: readonly Check[]): string | null {
	const codes = checks.map((check) => check.code);
	if (codes.some((code) => !/^[A-Z][A-Z0-9_]*$/.test(code)))
		return 'A check code is upper-case letters, digits and underscores.';
	if (new Set(codes).size !== codes.length) return 'Each check is declared once.';
	for (const check of checks) {
		if (!(CHECK_STAGES as readonly string[]).includes(check.at))
			return `${check.code}: a check runs at one of ${CHECK_STAGES.join(', ')}.`;
		if (!(CHECK_SEVERITIES as readonly string[]).includes(check.severity))
			return `${check.code}: a check either REFUSEs or WARNs.`;
		if (check.when.trim() === '') return `${check.code}: a check states when it fires.`;
		if (check.message.trim() === '')
			return `${check.code}: a check states what it tells the operator.`;
		try {
			programFor(check.when);
		} catch (error) {
			return `${check.code} when: ${getErrorMessage(error)}`;
		}
	}
	return null;
}
