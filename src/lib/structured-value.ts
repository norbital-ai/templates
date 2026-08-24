/**
 * The value a field-by-field editor reports after one cell changes.
 *
 * A structured column is either fully absent or a whole record, so an editor that has just had its
 * last filled cell cleared must report `null` rather than a record of empty strings. Every renderer
 * asked that question the same way, so it is asked here.
 */
export function patchedOrNull<Value extends object>(
	current: Value,
	patch: Partial<Value>
): Value | null {
	const next = { ...current, ...patch };
	const hasValue = Object.values(next).some((value) => value != null && value !== '');
	return hasValue ? next : null;
}
