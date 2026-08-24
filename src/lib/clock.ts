import { Clock, Effect } from 'effect';

/**
 * Now, as a `Date`, read through Effect's `Clock`.
 *
 * The construction lives here rather than inside each workflow so that a hook, an automation or an
 * inspection only ever *reads the service*: `TestClock` moves this exactly as it moves
 * `Clock.currentTimeMillis`, and nothing has to reach for the ambient constructor to get a stamp.
 */
export const currentDate = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis));
