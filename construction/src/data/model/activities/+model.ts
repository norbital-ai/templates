import { Effect } from 'effect';
import { model, type Id, type WriteCtx } from '@norbital-ai/bolt';

const columns = [
	'about',
	'title',
	'description',
	'occurred_at',
	'attachments',
	'source_message_id'
] as const;

type AboutRef =
	| { readonly model: 'projects'; readonly id: Id<'projects'> }
	| { readonly model: 'tasks'; readonly id: Id<'tasks'> }
	| { readonly model: 'contracts'; readonly id: Id<'contracts'> }
	| { readonly model: 'contacts'; readonly id: Id<'contacts'> };

const resolveProjectIds = Effect.fnUntraced(function* (
	targets: readonly (AboutRef | null | undefined)[],
	ctx: WriteCtx<'activities'>
) {
	const taskIds = targets.flatMap((t) => (t?.model === 'tasks' ? [t.id] : []));
	const contractIds = targets.flatMap((t) => (t?.model === 'contracts' ? [t.id] : []));

	const taskProject = new Map<string, Id<'projects'>>();
	const contractProject = new Map<string, Id<'projects'>>();

	if (taskIds.length > 0 || contractIds.length > 0) {
		const loaded = yield* ctx.query({
			...(taskIds.length > 0
				? {
						tasks: {
							where: { id: { in: [...new Set(taskIds)] } },
							fields: ['project_id'],
							limit: taskIds.length,
							as_of: 'act'
						}
					}
				: {}),
			...(contractIds.length > 0
				? {
						contracts: {
							where: { id: { in: [...new Set(contractIds)] } },
							fields: ['project_id'],
							limit: contractIds.length,
							as_of: 'act'
						}
					}
				: {})
		});
		for (const r of loaded.tasks?.rows ?? []) taskProject.set(r.id, r.project_id);
		for (const r of loaded.contracts?.rows ?? []) contractProject.set(r.id, r.project_id);
	}

	return targets.map((t): Id<'projects'> | null => {
		if (t == null) return null;
		if (t.model === 'projects') return t.id;
		if (t.model === 'tasks') return taskProject.get(t.id) ?? null;
		if (t.model === 'contracts') return contractProject.get(t.id) ?? null;
		return null;
	});
});

/**
 * Polymorphic activity log across projects, tasks, contracts, and business partners:
 * a title, plain-text description, timestamp, and optional supporting documents/photos.
 */
export default model('activities', {
	description:
		'Polymorphic chronological activities logged against projects, tasks, contracts, or business partners — title, description, timestamp, and optional attachments.',
	icon: 'lucide:activity',
	record_label: 'record.title',
	fields: {
		/** The project, task, contract, or business partner this activity belongs to. */
		about: {
			kind: 'ref',
			to: ['projects', 'tasks', 'contracts', 'contacts'],
			inverse: 'activities',
			on_delete: 'cascade'
		},
		/** Derived parent project for project-level timeline roll-ups across tasks and contracts. */
		project_id: {
			kind: 'ref',
			to: 'projects',
			inverse: 'project_activities',
			optional: true,
			on_delete: 'cascade'
		},
		title: { kind: 'text' },
		/** Plain-text notes (no rich markdown chrome). */
		description: { kind: 'text', optional: true },
		/** When the activity happened. */
		occurred_at: { kind: 'instant', default: { var: 'now' } },
		/** Optional supporting documents or photos. */
		attachments: { kind: 'file', accept: ['*/*'], max: '20MiB', many: true, optional: true },
		/** Person who logged it (or envoy's member); empty when filed from an incoming message. */
		author: { kind: 'ref', to: 'sys_user', optional: true },
		/** The WhatsApp or email message this activity was filed from. */
		source_message_id: {
			kind: 'ref',
			to: 'project_messages',
			inverse: 'activities',
			optional: true,
			on_delete: 'set_null'
		}
	},
	indexes: {
		by_occurred_at: { on: ['occurred_at'] },
		by_project_occurred: { on: ['project_id', 'occurred_at'] },
		find: { text: ['title', 'description'] }
	},
	outputs: {
		default: {
			fields: 'all',
			project_id: { fields: ['project_number', 'project_name'] },
			author: { fields: ['name'] },
			source_message_id: { fields: ['transport', 'sender_name'] }
		}
	},
	create: {
		fields: [...columns, 'project_id'],
		transform: function* (changes, ctx) {
			const author =
				ctx.actor.kind === 'member'
					? ctx.actor.id
					: ctx.actor.kind === 'envoy'
						? ctx.actor.member
						: null;
			const projectIds = yield* resolveProjectIds(
				changes.map(({ after }) => after.about),
				ctx
			);
			return changes.map(({ set, after }, i) => ({
				...set,
				author,
				project_id:
					projectIds[i] ??
					(after.about?.model === 'tasks' || after.about?.model === 'contracts'
						? (set.project_id ?? null)
						: null)
			}));
		}
	},
	update: {
		fields: columns.filter((f) => f !== 'source_message_id'),
		transform: function* (changes, ctx) {
			const projectIds = yield* resolveProjectIds(
				changes.map(({ after }) => after.about),
				ctx
			);
			return changes.map((c, i) => ({
				...c.set,
				...(c.changed('about') ? { project_id: projectIds[i] ?? null } : {})
			}));
		}
	},
	delete: {}
});
