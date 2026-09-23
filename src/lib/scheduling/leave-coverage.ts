import { dateKey } from '../iso-day.js';

/**
 * Leave coverage of one date, for the writers that must respect it.
 *
 * The work day transform refuses a working day that an approved leave already owns
 * ("one writer wins"), and the board draws the same coverage. The rule is a pure function over the
 * stored half-day steps: a date is fully covered unless it is one of the request's half-day
 * boundary dates — the morning-free start day or the afternoon-free end day.
 */
/** A leave request as every reader holds it: authored instants are ISO strings on every path. */
type LeaveRequestLike = {
	readonly from_date?: string | null | undefined;
	readonly to_date?: string | null | undefined;
	readonly half_day_start?: boolean | null | undefined;
	readonly half_day_end?: boolean | null | undefined;
};
export type { LeaveRequestLike };

/** One request's answer for one date, as the writers and the board read it. */
type LeaveCoverage = {
	readonly covered: boolean;
	readonly fullDay: boolean;
};

/** How one request covers one date. */
export function leaveCoverage(request: LeaveRequestLike, date: string): LeaveCoverage {
	const from = dateKey(request.from_date);
	const to = dateKey(request.to_date);
	if (from === '' || to === '' || date < from || date > to) {
		return { covered: false, fullDay: false };
	}
	const morningFree = date === from && request.half_day_start === true;
	const afternoonFree = date === to && request.half_day_end === true;
	return { covered: true, fullDay: !morningFree && !afternoonFree };
}
