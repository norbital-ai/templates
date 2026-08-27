/**
 * Provisioning the instalments of a SCHEDULED obligation.
 *
 * Two functions, both pure arithmetic over dates and cents: the monthly due dates a first payment
 * projects, and the equal split of a principal across them. They are what a form calls when
 * somebody types "1,000 over six months from 1 April" and wants six rows back.
 *
 * ## What is deliberately not here
 *
 * `repaymentScheduleIssues` was a third export beside these, carrying three cross-field checks —
 * the instalments must total the principal to the cent, the dates must strictly increase, and the
 * last one must fall inside the agreement's effective range. It was not ported. Validation of an
 * obligation belongs to `obligationTermsIssues` in `src/lib/obligation_refusals.ts`, which is the
 * one named refusal for how an obligation's payload must match the arm it declares; a second
 * validator over the same columns is a second chance for the two to disagree, which is exactly the
 * defect the merge into `obligations` set out to remove.
 *
 * **See the report: those three checks are not currently clauses of `obligationTermsIssues`, so
 * they are not enforced anywhere.** That is a gap, not a decision to drop them.
 *
 * ## `sequence` is not stored
 *
 * An instalment's number is its position in the array. `agreement_instalments` and the
 * `LOAN_INSTALMENT` rows that pointed at it were both a second copy of that index, and the two
 * could disagree; payroll reads the array and recovers against the obligation as a whole.
 */

import { Result } from 'effect';
import type { ObligationInstalment } from '../../../datatypes/obligation_instalment/+definition.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_INSTALMENTS = 600;

/** Scaled-to-cents value, as a Result so a caller can collect several failures at once. */
function cents(value: number, label: string): Result.Result<number, string> {
	const scaled = value * 100;
	const rounded = Math.round(scaled);
	return !Number.isFinite(value) || Math.abs(scaled - rounded) > 1e-7
		? Result.fail(`${label} must use whole cents.`)
		: Result.succeed(rounded);
}

/** The throwing adapter for a distribution that requires the strict contract. */
function centsOrThrow(value: number, label: string): number {
	const parsed = cents(value, label);
	if (Result.isFailure(parsed)) throw new Error(parsed.failure);
	return parsed.success;
}

function date(value: unknown, label: string): string {
	const key = String(value ?? '').slice(0, 10);
	if (!DATE.test(key) || Number.isNaN(Date.parse(`${key}T00:00:00.000Z`)))
		throw new Error(`${label} must be a valid date.`);
	return key;
}

/** Monthly due dates, retaining the selected day or the target month's final day. */
export function monthlyDueDates(firstDueDate: string, count: number): string[] {
	const first = date(firstDueDate, 'First repayment date');
	if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALMENTS)
		throw new Error(`Repayment count must be between 1 and ${MAX_INSTALMENTS}.`);
	const [year, month, day] = first.split('-').map(Number);
	return Array.from({ length: count }, (_value, index) => {
		const monthIndex = month - 1 + index;
		const targetYear = year + Math.floor(monthIndex / 12);
		const targetMonth = monthIndex % 12;
		const finalDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
		return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, finalDay)))
			.toISOString()
			.slice(0, 10);
	});
}

/**
 * Provision an equal schedule in cents. Any indivisible remainder is placed on the final
 * instalment so the stored rows always add back to the principal exactly.
 */
export function distributeRepaymentSchedule(
	principal: number,
	dueDates: readonly string[]
): readonly ObligationInstalment[] {
	const principalCents = centsOrThrow(principal, 'Loan principal');
	if (principalCents <= 0) throw new Error('Loan principal must be positive.');
	if (dueDates.length < 1 || dueDates.length > MAX_INSTALMENTS)
		throw new Error(`Repayment count must be between 1 and ${MAX_INSTALMENTS}.`);
	const base = Math.floor(principalCents / dueDates.length);
	if (base < 1) throw new Error('Every instalment must be at least 0.01.');
	const remainder = principalCents % dueDates.length;
	return dueDates.map((dueDate, index) => ({
		due_date: date(dueDate, `Repayment ${index + 1} date`),
		amount: (base + (index === dueDates.length - 1 ? remainder : 0)) / 100
	}));
}
