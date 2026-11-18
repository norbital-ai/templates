import { Effect } from 'effect';
import type { AutomationCtx, InputOf } from '@norbital-ai/bolt';
import { messageImportAllows } from './message-import.js';

type CommandCtx = Pick<AutomationCtx, 'query' | 'act' | 'now' | 'refuse'>;

export const RECONSIDER_JOB_RULES_INPUT = {
	target: { kind: 'ref', to: 'activities' },
	project: { kind: 'ref', to: 'projects' }
} as const;

export const reconsiderJobRules = Effect.fnUntraced(function* (
	input: InputOf<typeof RECONSIDER_JOB_RULES_INPUT>,
	ctx: CommandCtx
) {
	const target =
		(yield* ctx.query({ activities: { where: { id: { eq: input.target } }, limit: 1 } })).activities
			.rows[0] ?? null;
	if (target === null) return yield* ctx.refuse('errors.record_unavailable');
	if (
		target.kind !== 'message' ||
		target.source_message == null ||
		target.classified_by === 'manual'
	)
		return;
	const job =
		(yield* ctx.query({
			projects: { where: { id: { eq: input.project } }, fields: ['company_id'], limit: 1 }
		})).projects.rows[0] ?? null;
	if (
		job?.company_id == null ||
		(target.project_id !== input.project &&
			(target.project_id != null || target.company !== job.company_id))
	)
		return;
	yield* ctx.act({
		'activities.update': [
			{
				target,
				set: {
					classification: 'pending',
					classified_by: null,
					classified_at: null,
					reason: 'Job capture rules changed. Automatic classification will retry.'
				}
			}
		]
	});
});

export const RETRY_ROUTING_INPUT = { target: { kind: 'ref', to: 'activities' } } as const;

export const retryRouting = Effect.fnUntraced(function* (
	input: InputOf<typeof RETRY_ROUTING_INPUT>,
	ctx: CommandCtx
) {
	const target =
		(yield* ctx.query({ activities: { where: { id: { eq: input.target } }, limit: 1 } })).activities
			.rows[0] ?? null;
	if (target === null) return yield* ctx.refuse('errors.record_unavailable');
	if (
		target.kind !== 'message' ||
		target.classification !== 'ignored' ||
		target.classified_by !== 'hard_filter'
	)
		return;
	yield* ctx.act({
		'activities.update': [
			{
				target,
				set: {
					classification: 'pending',
					classified_by: null,
					classified_at: null,
					reason: 'Routing rules changed. Automatic classification will retry.'
				}
			}
		]
	});
});

export const CLASSIFY_ACTIVITY_INPUT = {
	target: { kind: 'ref', to: 'activities' },
	classification: { kind: 'enum', values: ['pending', 'useful', 'ignored', 'review'] },
	reason: { kind: 'text' },
	classified_by: { kind: 'enum', values: ['hard_filter', 'model', 'manual', 'calendar'] },
	company: { kind: 'ref', to: 'companies', optional: true },
	contact_id: { kind: 'ref', to: 'contacts', optional: true },
	project_id: { kind: 'ref', to: 'projects', optional: true }
} as const;

export const classifyActivity = Effect.fnUntraced(function* (
	input: InputOf<typeof CLASSIFY_ACTIVITY_INPUT>,
	ctx: CommandCtx
) {
	const { target: targetId, ...classification } = input;
	const target =
		(yield* ctx.query({ activities: { where: { id: { eq: targetId } }, limit: 1 } })).activities
			.rows[0] ?? null;
	if (target === null) return yield* ctx.refuse('errors.record_unavailable');
	if (target.kind !== 'message' || !['pending', 'review'].includes(target.classification ?? ''))
		return;
	if (target.source_message != null) {
		const source =
			(yield* ctx.query({
				sys_message: {
					where: { id: { eq: target.source_message } },
					fields: ['integration', 'source_at', 'created_at'],
					limit: 1
				}
			})).sys_message.rows[0] ?? null;
		const account =
			source?.integration == null
				? null
				: ((yield* ctx.query({
						sys_integration: {
							where: { id: { eq: source.integration } },
							fields: ['import_start'],
							limit: 1
						}
					})).sys_integration.rows[0] ?? null);
		if (source === null || account === null) return yield* ctx.refuse('errors.source_unavailable');
		// outside the current import selection: not applied, like a raced write
		if (!(yield* messageImportAllows(account, source, ctx))) return;
	}
	// a concurrent write moved this message: classification is not applied and the next run retries it
	yield* ctx
		.act({
			'activities.update': [
				{
					target,
					set: {
						...classification,
						company: input.company ?? null,
						contact_id: input.contact_id ?? null,
						project_id: input.project_id ?? null,
						classified_at: ctx.now
					}
				}
			]
		})
		.pipe(Effect.catchTag('ActConflict', () => Effect.void));
});
