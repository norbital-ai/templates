import type { Id } from '@norbital-ai/bolt';
import type { PageContext } from '@norbital-ai/bolt/page';

/**
 * A company's stints by their employee number and the person's name, for a list that names a stint: a reference
 * shows what it points at, never its id. Call during component initialisation.
 */
export function stintNames(
	ctx: Pick<PageContext, 'query'>,
	/** The company whose stints are named; `'all'` for a list across companies; `null` reads nothing. */
	company: () => Id<'entity'> | 'all' | null
) {
	const read = $derived.by(() => {
		const id = company();
		return id === null
			? null
			: ctx.query({
					employment: {
						...(id === 'all' ? {} : { where: { entity_id: { eq: id } } }),
						fields: ['employee_number'],
						limit: 10000,
						employee_id: { fields: ['name'] }
					}
				});
	});
	const names = $derived(
		new Map(
			(read?.current?.employment.rows ?? []).map((row) => [
				String(row.id),
				[row.employee_number, row.employee_id?.name].filter((part) => part).join(' · ')
			])
		)
	);
	return {
		/** A stint's label, from the stint or its id; empty while the names load. */
		of: (stint: unknown): string =>
			names.get(
				stint !== null && typeof stint === 'object' && 'id' in stint
					? String(stint.id)
					: String(stint)
			) ?? ''
	};
}
