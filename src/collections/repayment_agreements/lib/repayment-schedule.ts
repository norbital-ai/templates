import { Result } from 'effect';
import type { RepaymentSchedule } from '../../../datatypes/repayment_schedule/+definition.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_INSTALMENTS = 600;

/** Scaled-to-cents value, as a Result so the issue builder can collect several failures at once. */
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
): RepaymentSchedule {
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

/**
 * The same cross-field validation is used by the browser form and the collection hooks. Returning
 * messages rather than throwing lets the form attach every issue before the server repeats it.
 */
function calendarDay(value: unknown): string | null {
	const key = String(value ?? '').slice(0, 10);
	if (!DATE.test(key) || Number.isNaN(Date.parse(`${key}T00:00:00.000Z`))) return null;
	return key;
}

/**
 * The three cross-field checks a complete repayment schedule must pass, as an issue list.
 *
 * The validation is `repaymentScheduleIssues`, which is cross-field — instalments must total the
 * principal to the cent, dates must strictly increase, the last one must fall inside
 * `effective_range` — and reports every failure at once so the form can attach them all. A schema
 * would check the shape and still leave those three to hand-written code, so the issue builder
 * follows the validator rather than replacing it.
 */
export function repaymentScheduleIssues(input: {
	readonly principal: unknown;
	readonly effectiveRange: unknown;
	readonly schedule: unknown;
}): string[] {
	const issues: string[] = [];
	const principal = Number(input.principal);
	let principalCents: number | null = null;
	const principalParsed = cents(principal, 'Loan principal');
	if (Result.isFailure(principalParsed)) {
		issues.push(principalParsed.failure);
	} else {
		principalCents = principalParsed.success;
		if (principalCents <= 0) issues.push('Loan principal must be positive.');
	}

	const range =
		input.effectiveRange != null && typeof input.effectiveRange === 'object'
			? input.effectiveRange
			: {};
	const startRaw = Reflect.get(range, 'start');
	const endRaw = Reflect.get(range, 'end');
	let rangeStart: string | null = null;
	let rangeEnd: string | null = null;
	if (startRaw != null && startRaw !== '') {
		rangeStart = calendarDay(startRaw);
		if (rangeStart == null) issues.push('Agreement period start must be a valid date.');
	}
	if (endRaw != null && endRaw !== '') {
		rangeEnd = calendarDay(endRaw);
		if (rangeEnd == null) issues.push('Agreement period end must be a valid date.');
	}

	if (!Array.isArray(input.schedule) || input.schedule.length === 0) {
		issues.push('At least one repayment instalment is required.');
		return [...new Set(issues)];
	}
	if (input.schedule.length > MAX_INSTALMENTS)
		issues.push(`A loan cannot have more than ${MAX_INSTALMENTS} instalments.`);

	let totalCents = 0;
	let previous = '';
	for (let index = 0; index < input.schedule.length; index += 1) {
		const raw = input.schedule[index];
		if (raw == null || typeof raw !== 'object') {
			issues.push(`Repayment ${index + 1} is invalid.`);
			continue;
		}
		const dueDate = String(Reflect.get(raw, 'due_date') ?? '').slice(0, 10);
		if (!DATE.test(dueDate) || Number.isNaN(Date.parse(`${dueDate}T00:00:00.000Z`))) {
			issues.push(`Repayment ${index + 1} date must be valid.`);
		} else {
			if (previous !== '' && previous >= dueDate)
				issues.push('Repayment dates must be unique and strictly increasing.');
			previous = dueDate;
		}
		const amountParsed = cents(Number(Reflect.get(raw, 'amount')), `Repayment ${index + 1}`);
		if (Result.isFailure(amountParsed)) {
			issues.push(amountParsed.failure);
		} else {
			if (amountParsed.success <= 0) issues.push(`Repayment ${index + 1} must be positive.`);
			totalCents += amountParsed.success;
		}
	}

	if (principalCents != null && totalCents !== principalCents)
		issues.push(
			`Repayment instalments must total ${(principalCents / 100).toFixed(2)} exactly; ` +
				`the current total is ${(totalCents / 100).toFixed(2)}.`
		);
	if (previous !== '' && rangeStart != null && previous < rangeStart)
		issues.push(
			`The final repayment ${previous} is earlier than the agreement period starting ${rangeStart}.`
		);
	if (previous !== '' && rangeEnd != null && previous > rangeEnd)
		issues.push(
			`The final repayment ${previous} is later than the agreement period ending ${rangeEnd}.`
		);
	return [...new Set(issues)];
}
