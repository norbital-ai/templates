import * as Predicate from 'effect/Predicate';

/** The first issue a Standard Schema reports for `value`, or undefined when it holds (a custom field's `validate`). */
export function fault(
	schema: {
		readonly '~standard': {
			validate(value: unknown): unknown;
		};
	},
	value: unknown
): string | undefined {
	const result = schema['~standard'].validate(value) as {
		readonly then?: unknown;
		readonly issues?: readonly { readonly message: string; readonly path?: readonly unknown[] }[];
	};
	// every value schema here is synchronous; an async one would pass unchecked, so refuse instead
	if (Predicate.isFunction(result.then)) return 'this value cannot be checked synchronously';
	const issue = result.issues?.[0];
	if (issue === undefined) return undefined;
	const at = (issue.path ?? []).map((p) =>
		Predicate.isObjectOrArray(p) && 'key' in p ? String(p.key) : String(p)
	);
	return at.length === 0 ? issue.message : `${at.join('.')}: ${issue.message}`;
}
