import { Clock, Effect } from 'effect';
import { deskToday } from './desk-date.js';

/**
 * The moment a workflow runs, read from the injected clock rather than ambient time.
 *
 * A workflow that reaches for `new Date()` — or builds one from the clock in its own body — cannot
 * be run against a test clock, so the conversion from milliseconds to an instant lives here, once,
 * outside every workflow that needs it.
 */
export const currentInstant: Effect.Effect<Date> = Effect.map(
	Clock.currentTimeMillis,
	(millis) => new Date(millis)
);

/** The desk's calendar day at the moment a workflow runs. */
export const currentDeskDate: Effect.Effect<string> = Effect.map(currentInstant, deskToday);
