import { bolt } from '$bolt';
import { enumText } from '@norbital-ai/ui';
import { kindsOf } from '../../payroll_engine/listed_kinds.js';

/**
 * A stored kind code as the name the PAYROLL `rule_set` rows of that `rule` list it under (`rules.kinds[]`), across the
 * sealed versions, live; a code no version names reads as words. Call during component initialisation.
 */
export function listedKindNames(rule: 'exit_grounds' | 'case_kinds') {
	const rows = $derived.by(() =>
		bolt.query('rule_set', {
			where: { family: { eq: 'PAYROLL' }, code: { eq: rule } },
			select: { rules: true },
			all: true
		})
	);
	const names = $derived(
		new Map(
			(rows?.current?.rows ?? []).flatMap((row) =>
				kindsOf(row.rules).map((kind) => [kind.code, kind.name] as const)
			)
		)
	);
	return (code: string): string => names.get(code) ?? enumText(code);
}
