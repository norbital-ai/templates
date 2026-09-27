import * as Predicate from 'effect/Predicate';
import type { Refused } from '@norbital-ai/bolt';

/**
 * A refusal from a helper that holds no `ctx`: the thrown `Refused` ends the transform, query or action with this
 * message, exactly as a `Refused` rethrown from `ctx.act` does (§3.3.9). Bodies that hold a `ctx` call `ctx.refuse`.
 * It is an `Error` too, so a test's `assert.throws(fn, /message/)` reads the message.
 */
export function refuse(message: string): never {
	const refused: Refused = { kind: 'refused', code: 'refused', message };
	throw Object.assign(new Error(message), refused);
}

/** A thrown value's message: an `Error`'s (or an error-shaped object's) own, anything else as JSON. */
export const getErrorMessage = (error: unknown): string =>
	error instanceof Error
		? error.message
		: Predicate.hasProperty(error, 'message') && Predicate.isString(error.message)
			? error.message
			: Predicate.isObject(error)
				? JSON.stringify(error)
				: String(error);
