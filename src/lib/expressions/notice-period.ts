import {
	PlainDate,
	addDays,
	datePeriod,
	days as calendarDays,
	monthOf
} from '@norbital-ai/std/date';

type Employment = { service_start?: string; exit_date?: string };

/** Calendar service on the actual notice date, rather than the later departure. */
export function serviceYearsOn(employment: unknown, date: unknown): bigint {
	const start = (employment as Employment).service_start ?? '';
	if (start === '') return 0n; // Blank expression-compilation context.
	const day = PlainDate(String(date));
	if (day < PlainDate(start))
		throw new Error('Notice date must be a calendar date on or after employment started.');
	return BigInt(
		Number(day.slice(0, 4)) - Number(start.slice(0, 4)) - (day.slice(5) < start.slice(5) ? 1 : 0)
	);
}

/** The remaining interval after service and an expressly declared waiver of its final days. */
function noticeRemainder(employment: unknown, days: unknown, given: unknown, waived: unknown) {
	const { service_start: start = '', exit_date: exit = '' } = employment as Employment;
	if (start === '' && exit === '') return null;
	const period = Number(days);
	const waiver = Number(waived);
	if (!Number.isSafeInteger(period) || period < 0 || !Number.isSafeInteger(waiver) || waiver < 0)
		throw new Error('Notice and waived days must be non-negative whole days.');
	PlainDate(exit);
	const givenOn = String(given);
	if (givenOn !== '' && (PlainDate(givenOn) < PlainDate(start) || givenOn > exit))
		throw new Error(
			'Written notice must be dated within the employment up to the final service day.'
		);
	const from = addDays(exit, 1);
	// A written notice includes its giving day. Without notice, none of the prospective term
	// was served: wages begin after the final day already paid by ordinary payroll.
	const through = addDays(givenOn || from, period - 1);
	const remaining = through < from ? 0 : calendarDays(datePeriod(from, through));
	if (waiver > remaining)
		throw new Error('Waived notice days cannot exceed the unserved notice period.');
	return { from, through: addDays(through, -waiver), days: remaining - waiver };
}

export function noticeDaysRemaining(
	employment: unknown,
	days: unknown,
	given: unknown,
	waived: unknown
): number {
	return noticeRemainder(employment, days, given, waived)?.days ?? 0;
}

/** A constant monthly wage over the unexpired calendar interval; the catalogue owns rounding. */
export function noticeMonthlyWages(
	employment: unknown,
	wage: unknown,
	days: unknown,
	given: unknown,
	waived: unknown
): number {
	const interval = noticeRemainder(employment, days, given, waived);
	if (interval == null || interval.days === 0) return 0;
	const monthly = Number(wage);
	if (!Number.isFinite(monthly) || monthly < 0)
		throw new Error('Notice monthly wages must be a non-negative finite amount.');
	let amount = 0;
	for (let day = interval.from; day <= interval.through;) {
		const month = monthOf(day);
		const end = month.to!;
		const through = end < interval.through ? end : interval.through;
		amount += (monthly * calendarDays(datePeriod(day, through))) / calendarDays(month);
		day = addDays(through, 1);
	}
	return amount;
}
