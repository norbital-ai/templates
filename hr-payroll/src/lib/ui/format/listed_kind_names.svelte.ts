import { bolt } from '$bolt';
import { enumText } from '@norbital-ai/ui';
import { kindsOf } from '../../payroll_engine/listed_kinds.js';

/**
 * A stored kind code as the name the version's typed catalogue lists it under (`case_kinds`), across the
 * sealed versions, live; a code no version names reads as words. Call during component initialisation.
 */
export function listedKindNames(rule: 'case_kinds') {
	const rows = $derived.by(() =>
		bolt.query({
			jurisdiction_settings: { where: { status: { eq: 'SEALED' } }, fields: ['lookup'] }
		})
	);
	const names = $derived(
		new Map(
			(rows?.current?.jurisdiction_settings.rows ?? []).flatMap((row) =>
				kindsOf(row.lookup[rule]).map((kind) => [kind.code, kind.name] as const)
			)
		)
	);
	return (code: string): string => names.get(code) ?? enumText(code);
}
