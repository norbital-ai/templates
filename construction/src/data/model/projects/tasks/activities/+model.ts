import { model } from '@norbital-ai/bolt';

const columns = [
	'kind',
	'title',
	'body',
	'attachments',
	'occurred_at',
	'issue_type',
	'severity',
	'status',
	'attendees',
	'source_message_id'
] as const;

/**
 * What happens on a task, in one timeline: a `comment`, an `issue` (an incident on site, open until closed) or a
 * `meeting` (who met, when, and its minutes). Each has its body (Markdown with pictures), files, author or the message
 * it came from; an issue adds its type, severity and status, a meeting its attendees.
 */
export default model('activities', {
	description:
		'What happens on a task: comments, issues (incidents on site, open until closed) and meetings, each with its body, files, and its author or the message it came from.',
	icon: 'lucide:activity',
	record_label: 'record.title != null ? record.title : record.body',
	fields: {
		task_id: { kind: 'ref', to: 'tasks', inverse: 'activities', owned: true },
		kind: { kind: 'enum', values: ['comment', 'issue', 'meeting'], default: 'comment' },
		/** An issue's or a meeting's headline. */
		title: { kind: 'text', optional: true },
		body: { kind: 'text', format: 'markdown', images: 'attachments', optional: true },
		attachments: { kind: 'file', accept: ['*/*'], max: '20MiB', many: true, optional: true },
		/** When it happened: a comment's posting, an issue's raising, a meeting's start. */
		occurred_at: { kind: 'instant', default: { var: 'now' } },
		/** Who wrote it: the person posting it (an envoy's member for them); none when it came from a message. */
		author: { kind: 'ref', to: 'sys_user', optional: true },
		issue_type: {
			kind: 'enum',
			values: ['defect', 'rfi', 'clash', 'safety', 'snag'],
			optional: true
		},
		severity: { kind: 'enum', values: ['low', 'medium', 'high', 'critical'], optional: true },
		status: { kind: 'enum', values: ['open', 'closed'], optional: true },
		attendees: { kind: 'text', many: true, optional: true },
		/** The WhatsApp or email message this activity was filed from. */
		source_message_id: {
			kind: 'ref',
			to: 'project_messages',
			inverse: 'activities',
			optional: true,
			on_delete: 'set_null'
		}
	},
	constraints: {
		// an issue says what happened, what it is, how bad, and whether it is still open; a meeting what it was
		issue_complete: {
			check: {
				or: [
					{ kind: { ne: 'issue' } },
					{
						title: { is_null: false },
						issue_type: { is_null: false },
						severity: { is_null: false },
						status: { is_null: false }
					}
				]
			}
		},
		meeting_titled: { check: { or: [{ kind: { ne: 'meeting' } }, { title: { is_null: false } }] } },
		said_something: { check: { or: [{ body: { is_null: false } }, { title: { is_null: false } }] } }
	},
	indexes: { by_task_kind: { on: ['task_id', 'kind'] } },
	outputs: {
		default: {
			fields: 'all',
			task_id: { fields: ['task_code', 'title'] },
			author: { fields: ['name'] },
			source_message_id: { fields: ['transport', 'sender_name'] }
		}
	},
	create: {
		fields: ['task_id', ...columns],
		transform: function* (changes, ctx) {
			const author =
				ctx.actor.kind === 'member'
					? ctx.actor.id
					: ctx.actor.kind === 'envoy'
						? ctx.actor.member
						: null;
			// a new issue is open, at medium severity, unless the writer says otherwise
			return changes.map(({ set, after }) => ({
				...set,
				author,
				...(after.kind === 'issue'
					? {
							status: after.status ?? 'open',
							severity: after.severity ?? 'medium',
							issue_type: after.issue_type ?? 'defect'
						}
					: {})
			}));
		}
	},
	update: { fields: columns.filter((f) => f !== 'kind') },
	delete: {}
});
