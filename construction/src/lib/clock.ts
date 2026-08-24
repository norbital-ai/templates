import { Clock, Effect } from 'effect';

/**
 * The moment a workflow runs, read from the injected clock rather than ambient time.
 *
 * A workflow that reaches for `new Date()` — or builds one from the clock in its own body — cannot
 * be run against a test clock, so the conversion from milliseconds to an instant lives here, once,
 * outside every workflow that needs it.
 */
const currentInstant: Effect.Effect<Date> = Effect.map(
	Clock.currentTimeMillis,
	(millis) => new Date(millis)
);

/** The moment a workflow runs, as the UTC ISO-8601 instant every stored timestamp is written in. */
export const currentInstantIso: Effect.Effect<string> = Effect.map(currentInstant, (instant) =>
	instant.toISOString()
);
