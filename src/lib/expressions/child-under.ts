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
import { isCalendarDate } from '../iso-day.js';

export function childUnder(children: unknown, age: unknown): bigint {
	return countUnder((children as { ages?: unknown }).ages, age);
}

/** `children.citizens_under(n)` — of the children recorded as citizens, how many are under `n`. */
export function childCitizensUnder(children: unknown, age: unknown): bigint {
	return countUnder((children as { citizen_ages?: unknown }).citizen_ages, age);
}

/** `children.classed(x)` — how many children carry the declared relief class `x`. */
export function childClassed(children: unknown, reliefClass: unknown): bigint {
	const classes = (children as { classes?: unknown }).classes;
	if (!Array.isArray(classes)) return 0n;
	return BigInt(classes.filter((value) => value === String(reliefClass)).length);
}

/** `children.unclassed_under(age)` — family records with no class below the stated age; not tax claims. */
export function childUnclassedUnder(children: unknown, age: unknown): bigint {
	const { classes, ages } = children as { classes?: unknown; ages?: unknown };
	if (!Array.isArray(classes) || !Array.isArray(ages)) return 0n;
	const limit = Number(age);
	return BigInt(
		ages.filter((value, index) => classes[index] === '' && Number(value) < limit).length
	);
}

function countUnder(ages: unknown, age: unknown): bigint {
	const limit = Number(age);
	if (!Array.isArray(ages)) return 0n;
	return BigInt(ages.filter((value) => Number(value) < limit).length);
}

/** `children.born_on(date)` — how many children were born on that day: the size of one confinement. */
export function childBornOn(children: unknown, date: unknown): bigint {
	const birthdates = (children as { birthdates?: unknown }).birthdates;
	if (!Array.isArray(birthdates)) return 0n;
	const day = String(date).slice(0, 10);
	return BigInt(birthdates.filter((value) => String(value).slice(0, 10) === day).length);
}

type DatedChild = {
	readonly birth: string;
	readonly confinement: string;
	readonly death: string;
	readonly relationship: string;
	readonly from: string;
	readonly through: string;
};

/** The natural-child records that were alive on the event date, with newborns optional. */
function livingNaturalChildren(children: unknown, date: unknown, priorOnly: boolean): DatedChild[] {
	const day = String(date ?? '').slice(0, 10);
	const records = (children as { records?: readonly DatedChild[] | null }).records;
	if (day === '' && records == null) return []; // Blank expression context.
	if (!isCalendarDate(day)) throw new Error('Natural-child count needs a valid event date.');
	if (records == null) throw new Error('Dated child history is required for this event.');
	const living: DatedChild[] = [];
	for (const child of records) {
		if (child.relationship !== 'CHILD') continue;
		if (!isCalendarDate(child.birth))
			throw new Error('Natural-child history has no valid birth date.');
		if (!isCalendarDate(child.confinement) || child.confinement > child.birth)
			throw new Error('Natural-child history has an invalid confinement date.');
		if (child.birth > day || (priorOnly && child.confinement >= day)) continue;
		if (child.from !== '' && child.from > day) continue;
		if (child.through !== '' && child.through < day) continue;
		if (child.death === day)
			throw new Error('Child survival on the confinement day needs a time-specific determination.');
		if (child.death !== '' && (!isCalendarDate(child.death) || child.death < child.birth))
			throw new Error('Natural-child history has an invalid death date.');
		if (child.death !== '' && child.death < day) continue;
		living.push(child);
	}
	return living;
}

/** Natural children alive on a specified day, including births that day. */
export function naturalSurvivingOn(children: unknown, date: unknown): bigint {
	return BigInt(livingNaturalChildren(children, date, false).length);
}

/** Natural children already living before the named confinement. */
export function naturalSurvivingBefore(children: unknown, date: unknown): bigint {
	return BigInt(livingNaturalChildren(children, date, true).length);
}

/** Distinct previous confinements with at least one child still living at this confinement. */
export function naturalSurvivingConfinementsBefore(children: unknown, date: unknown): bigint {
	return BigInt(
		new Set(livingNaturalChildren(children, date, true).map((child) => child.confinement)).size
	);
}
