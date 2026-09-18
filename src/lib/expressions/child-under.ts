/**
 * `children.under(n)` — how many children are under `n` completed years.
 *
 * The count is returned as a **BigInt** because the signature declares CEL's `int`, and CEL
 * dispatches `==` on the runtime value: an `int`-typed call handing back a JavaScript number
 * compares against no integer literal at all, so `children.under(7) == 0` was false even for a
 * childless person while `< 1` and `>= 1` behaved, and `children.under(7) + 1` threw. Singapore's
 * seeded extended-childcare rule is written `children.under(13) >= 1 && children.under(7) == 0`,
 * and granted nobody on any version. The compile check cannot catch it: `false` is a boolean.
 *
 * One implementation for the run-time engines; `eligibility.ts` and `expressions/evaluate.ts`
 * both register it.
 */
export function childUnder(children: unknown, age: unknown): bigint {
	return countUnder((children as { ages?: unknown }).ages, age);
}

/** `children.citizens_under(n)` — of the children recorded as citizens, how many are under `n`. */
export function childCitizensUnder(children: unknown, age: unknown): bigint {
	return countUnder((children as { citizen_ages?: unknown }).citizen_ages, age);
}

/** `children.classed(x)` — how many children carry relief class `x` (declared, else MINOR / ADULT by age). */
export function childClassed(children: unknown, reliefClass: unknown): bigint {
	const classes = (children as { classes?: unknown }).classes;
	if (!Array.isArray(classes)) return 0n;
	return BigInt(classes.filter((value) => value === String(reliefClass)).length);
}

function countUnder(ages: unknown, age: unknown): bigint {
	const limit = Number(age);
	if (!Array.isArray(ages)) return 0n;
	return BigInt(ages.filter((value) => Number(value) < limit).length);
}
