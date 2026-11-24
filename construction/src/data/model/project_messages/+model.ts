import { Effect } from 'effect';
import { model, type CreateInput, type StoredTree, type WriteCtx } from '@norbital-ai/bolt';
import { messageImportAllows } from '../../../lib/message-import.js';

const columns = [
	'subject',
	'transport',
	'direction',
	'handle',
	'sender_name',
	'detail',
	'occurred_at',
	'attachments',
	'recording',
	'transcription',
	'transcription_error',
	'project_id',
	'contact_id',
	'classification',
	'classified_by',
	'classified_at',
	'reason',
	'extraction_status',
	'extraction_summary',
	'extracted_at',
	'source_message',
	'source_user',
	'source_key',
	'thread_key',
	'source_seq'
] as const;

const SOURCE = new Set<string>([
	'source_message',
	'source_user',
	'source_key',
	'thread_key',
	'source_seq',
	'transport',
	'handle',
	'direction'
]);

type Patch = { readonly [K in (typeof columns)[number]]?: CreateInput<'project_messages'>[K] };
type Entry = {
	readonly input: Patch;
	readonly after: Patch;
	readonly before: StoredTree<'project_messages', 'update'> | undefined;
};

const ids = <T>(values: readonly (T | null | undefined)[]) => [
	...new Set(values.filter((v): v is T => v != null))
];

const derived = Effect.fnUntraced(function* (
	entries: readonly Entry[],
	ctx: WriteCtx<'project_messages'>
) {
	const member = ctx.actor.kind === 'member' ? ctx.actor : null;
	const sourceIds = ids(entries.map(({ after }) => after.source_message));
	const sourceMessages =
		sourceIds.length === 0
			? []
			: (yield* ctx.query({
					sys_message: {
						where: { id: { in: sourceIds } },
						fields: ['integration', 'thread', 'conversation', 'source_at', 'sent_at', 'created_at'],
						limit: sourceIds.length,
						as_of: 'act'
					}
				})).sys_message.rows;
	const integrationIds = ids(sourceMessages.map((m) => m.integration));
	const sourceAccounts =
		integrationIds.length === 0
			? []
			: (yield* ctx.query({
					sys_integration: {
						where: { id: { in: integrationIds } },
						fields: ['owner', 'import_start'],
						limit: integrationIds.length,
						as_of: 'act'
					}
				})).sys_integration.rows;

	const result: Patch[] = [];
	for (const [row, { input, before, after }] of entries.entries()) {
		const source = sourceMessages.find((m) => m.id === after.source_message);
		const account = sourceAccounts.find((a) => a.id === source?.integration);
		if (before === undefined && source !== undefined && account !== undefined) {
			if (!(yield* messageImportAllows(account, source, ctx))) {
				return yield* ctx.refuse('errors.source_outside_import', { field: 'source_message', row });
			}
		}
		const manualFiled =
			member !== null &&
			before !== undefined &&
			input.classified_by === undefined &&
			input.project_id != null &&
			input.project_id !== before.project_id;
		result.push({
			...(account?.owner != null ? { source_user: account.owner } : {}),
			...(source == null
				? {}
				: {
						source_key: source.integration,
						thread_key: source.conversation ?? source.thread ?? source.id
					}),
			...(manualFiled
				? {
						classification: 'useful' as const,
						classified_by: 'manual' as const,
						classified_at: ctx.now,
						reason: input.reason ?? 'Project assigned manually.',
						extraction_status: 'pending' as const
					}
				: {})
		});
	}
	return result;
});

export default model('project_messages', {
	description:
		'Synced WhatsApp and email messages routed into projects for automatic extraction into cashflow documents, contracts/VOs, progression tasks, and BIM issues.',
	icon: 'lucide:message-square-text',
	record_label: 'record.subject',
	fields: {
		subject: { kind: 'text' },
		transport: {
			kind: 'enum',
			values: ['whatsapp', 'email', 'manual'],
			default: 'whatsapp'
		},
		direction: { kind: 'enum', values: ['inbound', 'outbound'], default: 'inbound' },
		handle: { kind: 'text', optional: true },
		sender_name: { kind: 'text', optional: true },
		detail: { kind: 'text', format: 'markdown', optional: true },
		occurred_at: { kind: 'instant', default: { var: 'now' } },
		attachments: { kind: 'file', accept: ['*/*'], max: '20MiB', many: true, optional: true },
		recording: { kind: 'file', accept: ['audio/*', 'video/*'], max: '20MiB', optional: true },
		transcription: {
			kind: 'enum',
			values: ['none', 'pending', 'done', 'failed', 'unavailable'],
			default: 'none'
		},
		transcription_error: { kind: 'text', optional: true },
		classification: {
			kind: 'enum',
			values: ['pending', 'useful', 'ignored', 'review'],
			default: 'pending'
		},
		classified_by: {
			kind: 'enum',
			values: ['hard_filter', 'model', 'manual'],
			optional: true
		},
		classified_at: { kind: 'instant', optional: true },
		reason: { kind: 'text', optional: true },
		extraction_status: {
			kind: 'enum',
			values: ['pending', 'extracted', 'none', 'failed'],
			default: 'pending'
		},
		extraction_summary: { kind: 'text', optional: true },
		extracted_at: { kind: 'instant', optional: true },
		source_key: { kind: 'text', optional: true, hidden: true },
		thread_key: { kind: 'text', optional: true, hidden: true },
		source_seq: { kind: 'int', optional: true, hidden: true },
		source_message: {
			kind: 'ref',
			to: 'sys_message',
			inverse: 'project_messages',
			optional: true
		},
		source_user: { kind: 'ref', to: 'sys_user', optional: true },
		project_id: {
			kind: 'ref',
			to: 'projects',
			inverse: 'messages',
			optional: true,
			on_delete: 'set_null'
		},
		contact_id: {
			kind: 'ref',
			to: 'contacts',
			inverse: 'messages',
			optional: true,
			on_delete: 'set_null'
		}
	},
	constraints: {
		one_message_per_native_message: { unique: ['source_message'] }
	},
	indexes: {
		by_occurred_at: { on: ['occurred_at'] },
		by_classification_seq: { on: ['classification', 'source_seq'] },
		by_thread: { on: ['source_key', 'thread_key', 'occurred_at'] },
		find: { text: ['subject', 'detail', 'sender_name', 'handle'] }
	},
	outputs: {
		default: {
			fields: 'all',
			project_id: { fields: ['project_name', 'project_number'] },
			contact_id: { fields: ['full_name', 'company_name', 'role', 'trade_specialty'] },
			source_message: {
				fields: ['conversation', 'integration', 'source_at', 'sent_at', 'deleted_at']
			}
		}
	},
	create: {
		fields: columns,
		transform: function* (changes, ctx) {
			const patches = yield* derived(
				changes.map(({ set, after }) => ({ input: set, before: undefined, after })),
				ctx
			);
			return changes.map(({ set }, i) => ({ ...set, ...patches[i] }));
		},
		effect: function* (changes, ctx) {
			const rows = changes.map(({ after }) => after);
			if (
				rows.some(
					(r) =>
						r.source_message == null &&
						(r.classification === 'pending' || r.classification === 'review')
				)
			) {
				yield* ctx.schedule(
					'classify_messages',
					{},
					{ at: ctx.now, key: 'construction-classify-backlog' }
				);
			}
			const extractIds = rows.flatMap((r) =>
				r.project_id != null && r.classification === 'useful' && r.extraction_status === 'pending'
					? [r.id]
					: []
			);
			if (extractIds.length > 0) {
				yield* ctx.schedule(
					'extract_project_updates',
					{ message_ids: extractIds },
					{ at: ctx.now, key: `construction-extract-${extractIds[0]}` }
				);
			}
		}
	},
	update: {
		fields: columns.filter((f) => !SOURCE.has(f)),
		transform: function* (changes, ctx) {
			const patches = yield* derived(
				changes.map(({ before, set, after }) => ({ input: set, before, after })),
				ctx
			);
			return changes.map(({ set }, i) => ({ ...set, ...patches[i] }));
		},
		effect: function* (changes, ctx) {
			const extractIds = changes.flatMap(({ before, after }) =>
				after.project_id != null &&
				after.classification === 'useful' &&
				after.extraction_status === 'pending' &&
				(before.project_id !== after.project_id ||
					before.classification !== after.classification ||
					before.extraction_status !== after.extraction_status)
					? [after.id]
					: []
			);
			if (extractIds.length > 0) {
				yield* ctx.schedule(
					'extract_project_updates',
					{ message_ids: extractIds },
					{ at: ctx.now, key: `construction-extract-${extractIds[0]}` }
				);
			}
		}
	}
});
