/**
 * Leave coverage of one date, for the writers that must respect it.
 *
 * The roster and attendance hooks refuse a working day that an approved leave already owns
 * ("one writer wins"), and the board draws the same coverage. The rule is a pure function over the
 * stored half-day steps: a date is fully covered unless it is one of the request's half-day
 * boundary dates — the morning-free start day or the afternoon-free end day.
 */

export type LeaveRequestLike = {
	readonly kind?: string | null;
	readonly from_date?: string | Date | null;
	readonly to_date?: string | Date | null;
	readonly half_day_start?: boolean | null;
	readonly half_day_end?: boolean | null;
};

function dateKey(value: string | Date | null | undefined): string {
	if (value == null) return '';
	return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

export type LeaveCoverage = { readonly covered: boolean; readonly fullDay: boolean };

/** How one request covers one date. */
export function leaveCoverage(request: LeaveRequestLike, date: string): LeaveCoverage {
	const from = dateKey(request.from_date);
	const to = dateKey(request.to_date);
	if (request.kind != null && request.kind !== 'TIME_OFF')
		return { covered: false, fullDay: false };
	if (from === '' || to === '' || date < from || date > to) {
		return { covered: false, fullDay: false };
	}
	const morningFree = date === from && request.half_day_start === true;
	const afternoonFree = date === to && request.half_day_end === true;
	return { covered: true, fullDay: !morningFree && !afternoonFree };
}

/** Whether any approved request fully owns the date — the day nobody may assign work to. */
export function fullDayLeaveCovered(requests: readonly LeaveRequestLike[], date: string): boolean {
	return requests.some((request) => leaveCoverage(request, date).fullDay);
}
