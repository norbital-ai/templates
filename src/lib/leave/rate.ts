import { refuse } from '@norbital-ai/bolt/authoring';
import { decodeNumber } from '@norbital-ai/std/json';

export type LeavePayBasis = 'ORDINARY_DIV26' | 'MONTHLY_DIV30' | 'DAILY_WAGE';

/**
 * The daily rate leave money is priced at, from the terms in force on the day the ledger line
 * was posted and the basis the statute states: MY ordinary rate ÷26, TW and ID monthly ÷30,
 * SG and PH a daily wage (a 313-day year for monthly pay, or the daily rate as stated).
 * Payroll calls this when it prints a COMMUTED or ENCASHED line; nothing stores the result.
 */
export function leaveDailyRate(
	term: { readonly pay_frequency?: unknown; readonly base_salary?: unknown } | null | undefined,
	payBasis: LeavePayBasis
): number {
	const salary = term?.base_salary as { value?: unknown } | null;
	const value = salary == null ? NaN : decodeNumber(salary.value);
	if (!(value > 0))
		refuse('Leave money needs a positive base salary in the terms in force on that date.');
	if (term?.pay_frequency === 'DAILY' && payBasis === 'DAILY_WAGE') return value;
	if (term?.pay_frequency === 'MONTHLY' && payBasis === 'ORDINARY_DIV26') return value / 26;
	if (term?.pay_frequency === 'MONTHLY' && payBasis === 'MONTHLY_DIV30') return value / 30;
	if (term?.pay_frequency === 'MONTHLY' && payBasis === 'DAILY_WAGE') return (value * 12) / 313;
	return refuse(
		`Leave pay basis ${payBasis} is not stated for ${String(term?.pay_frequency ?? 'missing')} pay frequency.`
	);
}
