/**
 * The type guards this workspace decodes untyped values with, named as effect's `Predicate` names them. The workspace
 * does not depend on effect, so each guard here is the one reviewed `typeof`.
 */

// repository-health:allow GUARD2 -- the reviewed stand-in for effect's Predicate.isString
export const isString = (value: unknown): value is string => typeof value === 'string';

// repository-health:allow GUARD2 -- the reviewed stand-in for effect's Predicate.isNumber
export const isNumber = (value: unknown): value is number => typeof value === 'number';

/** A non-null object or array (effect's `Predicate.isObjectOrArray`). */
export const isObjectOrArray = (
	value: unknown
): value is { [x: PropertyKey]: unknown } | Array<unknown> =>
	typeof value === 'object' && value !== null; // repository-health:allow GUARD2 -- the reviewed stand-in for effect's Predicate.isObjectOrArray
