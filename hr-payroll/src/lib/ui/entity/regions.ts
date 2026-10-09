import * as Predicate from 'effect/Predicate';

/**
 * The regions a version's rules name, sorted: every key of a `by_region` table in its rules (a minimum-wage area, a
 * contribution zone) and every region its holiday calendar limits a holiday to (`holidays[].regions`). An entity's
 * `region` is one of them.
 */
export function regionsIn(rules: readonly unknown[]): readonly string[] {
	const found = new Set<string>();
	const walk = (value: unknown): void => {
		if (Array.isArray(value)) return value.forEach(walk);
		if (!Predicate.isObject(value)) return;
		for (const [key, held] of Object.entries(value)) {
			if (key === 'by_region' && Predicate.isObject(held) && !Array.isArray(held))
				for (const region of Object.keys(held)) found.add(region);
			if (key === 'regions' && Array.isArray(held))
				for (const region of held) if (Predicate.isString(region)) found.add(region);
			walk(held);
		}
	};
	rules.forEach(walk);
	return [...found].toSorted();
}
