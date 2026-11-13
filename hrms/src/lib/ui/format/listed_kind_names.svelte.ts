import type { PageContext } from '@norbital-ai/bolt/page';
import { enum_text } from '@norbital-ai/ui';
import { isJsonObject } from '../../payroll_engine/foundation.js';
import { pageLaws } from '../law.svelte.js';
import { kindsOf } from '../../payroll_engine/listed_kinds.js';

/**
 * A stored kind code as the name the law's typed catalogue lists it under (`case_kinds`), across the laws in force
 * today, live; a code no law names reads as words. Call during component initialisation.
 */
export function listedKindNames(ctx: Pick<PageContext, 'query' | 'clock'>, rule: 'case_kinds') {
	const laws = pageLaws(ctx, () => null);
	const clock = ctx.clock('day');
	const names = $derived(
		new Map(
			laws.codes.flatMap((code) => {
				const lookup = laws.on(code, String(clock.today))?.settings.lookup;
				return kindsOf(isJsonObject(lookup) ? lookup[rule] : undefined).map(
					(kind) => [kind.code, kind.name] as const
				);
			})
		)
	);
	return (code: string): string => names.get(code) ?? enum_text(code);
}
