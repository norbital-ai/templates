import { Effect } from 'effect';
import type { EffectCtx, Id } from '@norbital-ai/bolt';

type Assigned = {
	readonly project_id?: Id<'projects'> | null;
	readonly company?: Id<'companies'> | null;
};

/**
 * Queues `update_requirements` once per job and `research_lead` (merged research + profile extraction)
 * once per customer the evidence rows name, coalesced by key.
 */
export const deriveFrom = Effect.fnUntraced(function* (
	rows: readonly Assigned[],
	ctx: Pick<EffectCtx, 'schedule' | 'now'>
) {
	for (const project of new Set(rows.flatMap((row) => row.project_id ?? [])))
		yield* ctx.schedule(
			'update_requirements',
			{ project },
			{ at: ctx.now, key: `hq:update-requirements:${project}` }
		);
	for (const company of new Set(rows.flatMap((row) => row.company ?? [])))
		yield* ctx.schedule(
			'research_lead',
			{ company },
			{ at: ctx.now, key: `hq:research:${company}` }
		);
});
