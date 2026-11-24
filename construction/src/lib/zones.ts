import type { Id, WriteCtx } from '@norbital-ai/bolt';

type ZonedModel = 'tasks' | 'issues' | 'project_files';

/**
 * Validates that every non-null `zone` in a write batch matches a declared `projects.zones[].code`
 * on its parent project (when the project defines spatial zones). Reads with `as_of: 'act'` in one batch.
 */
export function* validateProjectZones<M extends ZonedModel>(
	changes: readonly {
		readonly after: { readonly project_id: Id<'projects'>; readonly zone?: string | null };
	}[],
	ctx: Pick<WriteCtx<M>, 'query'> & {
		refuse: (
			code: 'errors.invalid_zone',
			options: {
				readonly values: { readonly zone: string };
				readonly row: number;
				readonly field: 'zone';
			}
		) => ReturnType<WriteCtx<M>['refuse']>;
	}
) {
	const indexed = changes
		.map((c, row) => ({ row, after: c.after }))
		.filter((entry) => entry.after.zone != null && entry.after.zone.trim() !== '');
	if (indexed.length === 0) return;
	const projectIds = [...new Set(indexed.map((entry) => entry.after.project_id))];
	const { projects } = yield* ctx.query({
		projects: {
			where: { id: { in: projectIds } },
			fields: ['zones'],
			limit: projectIds.length,
			as_of: 'act'
		}
	});
	const allowedByProject = new Map<string, Set<string>>();
	for (const p of projects.rows) {
		if (p.zones != null && p.zones.length > 0) {
			allowedByProject.set(p.id, new Set(p.zones.map((z) => z.code)));
		}
	}
	for (const { row, after } of indexed) {
		const allowed = allowedByProject.get(after.project_id);
		if (allowed && after.zone != null && !allowed.has(after.zone)) {
			return yield* ctx.refuse('errors.invalid_zone', {
				values: { zone: after.zone },
				row,
				field: 'zone'
			});
		}
	}
}
