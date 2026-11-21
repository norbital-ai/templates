import type { Id, ModelName, WriteCtx } from '@norbital-ai/bolt';

/**
 * Validates that every non-null `zone` in a write batch matches a declared `projects.zones[].code`
 * on its parent project (when the project defines spatial zones). Runs in one batched read.
 */
export function* validateProjectZones<M extends ModelName>(
	changes: readonly {
		readonly after: { readonly project_id: Id<'projects'>; readonly zone?: string | null };
	}[],
	ctx: Pick<WriteCtx<M>, 'query' | 'refuse'>
) {
	const zoned = changes.filter((c) => c.after.zone != null && c.after.zone.trim() !== '');
	if (zoned.length === 0) return;
	const projectIds = [...new Set(zoned.map((c) => c.after.project_id))];
	const { projects } = yield* ctx.query({
		projects: {
			where: { id: { in: projectIds } },
			fields: ['zones']
		}
	});
	const allowedByProject = new Map<string, Set<string>>();
	for (const p of projects.rows) {
		if (p.zones != null && p.zones.length > 0) {
			allowedByProject.set(p.id, new Set(p.zones.map((z) => z.code)));
		}
	}
	for (const { after } of zoned) {
		const allowed = allowedByProject.get(after.project_id);
		if (allowed && after.zone != null && !allowed.has(after.zone)) {
			return yield* ctx.refuse('errors.invalid_zone', { values: { zone: after.zone } });
		}
	}
}
