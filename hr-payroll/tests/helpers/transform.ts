// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import { Effect } from 'effect';

/**
 * Drives one collection's transform the way the runtime does: the batch of inputs, the stored row
 * per input (`undefined` for a create) and a read surface. A refusal throws, so a test asserts it
 * with `assert.throws` / `assert.rejects` exactly as the runtime's caller sees the sentence.
 */
export const transformSync = (collection, inputs, options = {}) =>
	Effect.runSync(
		collection.transform(inputs, {
			existing: options.existing ?? inputs.map(() => undefined),
			db: options.db ?? {}
		})
	);

export const transform = (collection, inputs, options = {}) =>
	Effect.runPromise(
		collection.transform(inputs, {
			existing: options.existing ?? inputs.map(() => undefined),
			db: options.db ?? {}
		})
	);

/** One input through the transform, its payload back. */
export const transformOne = (collection, input, existing, db) =>
	transformSync(collection, [input], { existing: [existing], db })[0];
