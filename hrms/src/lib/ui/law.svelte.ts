import type { PageContext } from '@norbital-ai/bolt/page';
import { lawsOf, type Law } from '../law.js';
import { jsonObject } from '../payroll_engine/foundation.js';

/**
 * The laws of these jurisdictions, live: `on(code, day)` is the law in force on a day. `codes` answering null reads
 * every jurisdiction. Call during component initialisation.
 */
export function pageLaws(ctx: Pick<PageContext, 'query'>, codes: () => readonly string[] | null) {
	const read = $derived.by(() => {
		const only = codes();
		return ctx.query({
			jurisdiction: {
				where: { code: only === null ? { is_null: false } : { in: [...only] } },
				limit: 1000
			},
			jurisdiction_change: {
				where: {
					jurisdiction_code: only === null ? { is_null: false } : { in: [...only] }
				},
				fields: ['jurisdiction_code', 'effective_from', 'finding_id', 'law'],
				limit: 10000,
				finding_id: { fields: ['status'] }
			}
		});
	});
	const laws = $derived(
		lawsOf({
			jurisdiction: (read.current?.jurisdiction.rows ?? []).map(jsonObject),
			jurisdiction_change: (read.current?.jurisdiction_change.rows ?? []).map(jsonObject)
		})
	);
	return {
		get loading() {
			return read.loading;
		},
		/** The codes of the jurisdictions read. */
		get codes(): readonly string[] {
			return (read.current?.jurisdiction.rows ?? []).map((row) => row.code);
		},
		on: (code: unknown, day: string): Law | undefined => laws(code, day)
	};
}
