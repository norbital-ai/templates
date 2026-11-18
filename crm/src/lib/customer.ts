import { Effect } from 'effect';
import type { Actor, Id, WorkspaceQuery } from '@norbital-ai/bolt';

type Filing = { company?: Id<'companies'> | null; project_id?: Id<'projects'> | null };

/** Project-owned records follow their project customer; customer-only records retain their explicit filing. */
export function customerForProject(
	after: Filing,
	projects: readonly { id: Id<'projects'>; company_id: Id<'companies'> | null }[]
) {
	return after.project_id != null
		? (projects.find((row) => row.id === after.project_id)?.company_id ?? null)
		: (after.company ?? null);
}

/** Derive each change's customer from its row after the write, with one project read. */
export const projectCustomerRows = Effect.fnUntraced(function* <R>(
	changes: readonly { readonly set: R; readonly after: Filing }[],
	ctx: WorkspaceQuery
) {
	const { rows: projects } = (yield* ctx.query({
		projects: {
			where: {
				id: {
					in: changes.flatMap(({ after }) => (after.project_id == null ? [] : [after.project_id]))
				}
			},
			fields: ['company_id']
		}
	})).projects;
	return changes.map(({ set, after }) => ({
		...set,
		company: customerForProject(after, projects)
	}));
});

/** Whether a run's starter may work the CRM: an administrator or a sales member (an envoy as its linked member). */
export function salesStarter(
	trigger: { readonly kind: 'person'; readonly actor: Actor } | { readonly kind: 'system' }
) {
	if (trigger.kind !== 'person') return false;
	const member = trigger.actor.kind === 'envoy' ? trigger.actor.linked : trigger.actor;
	return member?.kind === 'member' && (member.admin || member.teams.includes('sales'));
}
