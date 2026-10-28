/**
 * L-TPL-hr-payroll-034: end a contract. Last day is inclusive; `behaviour_taps` then applies
 * `encash-leave-on-exit` from the written `exit_ground` and `exit_facts` (L-TPL-hr-payroll-076). The ground is one the
 * version governing the last day lists (`rule_set` PARAMETERS `exit_grounds`, `rules.kinds[] = { code, name }`); the
 * facts are the keys its `employee_input_schema.properties.exit_facts` declares. Nothing is defaulted.
 */

export function lastDayRefusal(
	hireFrom: string,
	lastDay: string | null | undefined
): string | null {
	if (lastDay == null || lastDay === '')
		return `Choose a last day of work on or after the hire date (${hireFrom}).`;
	if (lastDay < hireFrom)
		return `Choose a last day of work on or after the hire date (${hireFrom}).`;
	return null;
}

/**
 * Null when the range update is admitted; otherwise the refusal. A planned end (a fixed term) is no departure: the last
 * day moves freely, so a fixed-term contract exits early. A departure (an exit ground with the last day) is moved or
 * undone the same way — its effects are re-evaluated on the write (`retract-exit-effects`). Only a closed range's start
 * is fixed: a rehire is a new contract.
 */
export function refuseClosedUpdate(
	before: { readonly effective_range: { readonly from: string; readonly to: string | null } },
	set: { readonly effective_range?: { readonly from: string; readonly to: string | null } | null }
): string | null {
	const was = before.effective_range;
	if (set.effective_range === undefined) return null;
	if (set.effective_range == null) return 'A contract keeps its effective period.';
	if (was.to != null && set.effective_range.from !== was.from)
		return 'A closed contract keeps its start; rehire on a new contract.';
	if (set.effective_range.to == null || set.effective_range.to === was.to) return null;
	return lastDayRefusal(set.effective_range.from, set.effective_range.to);
}

/** A departure is an exit ground with its last day: a ground without one refuses. */
export const exitGroundRefusal = (input: {
	readonly ground: string | null | undefined;
	readonly to: string | null | undefined;
}): string | null =>
	input.ground != null && input.ground !== '' && input.to == null
		? 'An exit ground is written with the last day of work.'
		: null;
