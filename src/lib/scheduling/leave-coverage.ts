import { Schema } from 'effect';
import { dateKey } from '../iso-day.js';

/**
 * Leave coverage of one date, for the writers that must respect it.
 *
 * The roster and attendance hooks refuse a working day that an approved leave already owns
 * ("one writer wins"), and the board draws the same coverage. The rule is a pure function over the
 * stored half-day steps: a date is fully covered unless it is one of the request's half-day
 * boundary dates — the morning-free start day or the afternoon-free end day.
 */

/** A leave request as every reader holds it: authored instants are ISO strings on every path. */
const leaveRequestLikeSchema = Schema.Struct({
	kind: Schema.optional(Schema.NullOr(Schema.String)),
	from_date: Schema.optional(Schema.NullOr(Schema.String)),
	to_date: Schema.optional(Schema.NullOr(Schema.String)),
	half_day_start: Schema.optional(Schema.NullOr(Schema.Boolean)),
	half_day_end: Schema.optional(Schema.NullOr(Schema.Boolean))
});
type LeaveRequestLike = Schema.Schema.Type<typeof leaveRequestLikeSchema>;
export type { LeaveRequestLike };

/** One request's answer for one date, as the writers and the board read it. */
const leaveCoverageSchema = Schema.Struct({ covered: Schema.Boolean, fullDay: Schema.Boolean });
type LeaveCoverage = Schema.Schema.Type<typeof leaveCoverageSchema>;

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
