import { Schema } from 'effect';

/**
 * A leave date as two half-days, and the integer positions they line up in.
 *
 * Both sides of a half-day leave range use these two functions: the `leave_requests` hooks
 * validate an event's range and the range picker draws the same arithmetic, and the only way they
 * can disagree is twice. The point is an index into the day/half grid — `pointNumber` maps a half
 * to `2n + (1 for SECOND)` — and `pointAt` is its exact inverse.
 */

/** One half of a calendar day: the first or the second. */
const dayHalfSchema = Schema.Literals(['FIRST', 'SECOND']);
export type DayHalf = Schema.Schema.Type<typeof dayHalfSchema>;

/** A half-day boundary: which day, and which half of it. */
const halfDayPointSchema = Schema.Struct({ date: Schema.String, half: dayHalfSchema });
export type HalfDayPoint = Schema.Schema.Type<typeof halfDayPointSchema>;

/** The two ends of a half-day leave range, first and second, both inclusive. */
const halfDayRangeSchema = Schema.Struct({
	start: halfDayPointSchema,
	end: halfDayPointSchema
});
export type HalfDayRange = Schema.Schema.Type<typeof halfDayRangeSchema>;

const DAY_MS = 86_400_000;

/** The grid index of a half-day point: two slots per day, SECOND at the even/odd boundary. */
export function pointNumber(point: HalfDayPoint): number {
	return (
		Math.floor(Date.parse(`${point.date}T00:00:00.000Z`) / DAY_MS) * 2 +
		(point.half === 'SECOND' ? 1 : 0)
	);
}

/** The exact inverse of `pointNumber`: grid index back to which day, and which half of it. */
export function pointAt(number: number): HalfDayPoint {
	const day = Math.floor(number / 2);
	return {
		date: new Date(day * DAY_MS).toISOString().slice(0, 10),
		half: number % 2 === 0 ? 'FIRST' : 'SECOND'
	};
}
