import { Effect } from 'effect';
import { type EffectCtx, model, type Row } from '@norbital-ai/bolt';

const columns = ['hard_filter', 'classification_sop'] as const;

const replayOwners = Effect.fnUntraced(function* (
	rows: readonly Row<'communication_settings'>[],
	ctx: Pick<EffectCtx, 'schedule' | 'now'>
) {
	for (const owner of new Set(rows.flatMap((row) => row.owner ?? [])))
		yield* ctx.schedule(
			'replay_message_routes',
			{ owner },
			{ at: ctx.now, key: `crm-user-history-${owner}` }
		);
});

export default model('communication_settings', {
	description:
		'Personal account intake rules and supplementary System 1 classification instructions.',
	icon: 'lucide:list-filter',
	record_label: 'record.owner.name',
	fields: {
		hard_filter: { kind: 'enum', values: ['customer_pics', 'all'], default: 'customer_pics' },
		classification_sop: { kind: 'text', format: 'markdown', optional: true },
		owner: { kind: 'ref', to: 'sys_user' }
	},
	constraints: { one_settings_per_owner: { unique: ['owner'] } },
	outputs: { default: { fields: 'all', owner: { fields: ['name'] } } },
	create: {
		fields: columns,
		transform: function* (changes, ctx) {
			if (ctx.actor.kind !== 'member') return yield* ctx.refuse('errors.intake_needs_member');
			const owner = ctx.actor.id;
			const row = changes.findIndex(({ set }) => (set.classification_sop?.length ?? 0) > 8000);
			if (row >= 0)
				return yield* ctx.refuse('errors.classification_too_long', {
					field: 'classification_sop',
					row
				});
			return changes.map(({ set }) => ({ ...set, owner }));
		},
		// changed connection filters reapply to that user's previously captured history
		effect: function* (changes, ctx) {
			yield* replayOwners(
				changes.map(({ after }) => after),
				ctx
			);
		}
	},
	update: {
		fields: columns,
		transform: function* (changes, ctx) {
			if (ctx.actor.kind !== 'member') return yield* ctx.refuse('errors.intake_needs_member');
			const owner = ctx.actor.id;
			if (changes.some(({ before }) => before.owner !== owner))
				return yield* ctx.refuse('errors.intake_not_own');
			const row = changes.findIndex(({ set }) => (set.classification_sop?.length ?? 0) > 8000);
			if (row >= 0)
				return yield* ctx.refuse('errors.classification_too_long', {
					field: 'classification_sop',
					row
				});
			return changes.map(({ set }) => set);
		},
		effect: function* (changes, ctx) {
			yield* replayOwners(
				changes.flatMap((change) =>
					change.changed('hard_filter', 'classification_sop') ? [change.after] : []
				),
				ctx
			);
		}
	}
});
