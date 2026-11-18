import { Effect } from 'effect';
import { model } from '@norbital-ai/bolt';
import type { CreateInput, EffectCtx, Row, StoredTree, WriteCtx } from '@norbital-ai/bolt';
import { customerForProject } from '../../../../../lib/customer.js';
import { deriveFrom } from '../../../../../lib/derive.js';
import { messageImportAllows } from '../../../../../lib/message-import.js';
import { calendarAccountOf, syncedChange } from '../../../../../lib/calendar.js';

const columns = [
	'subject',
	'kind',
	'occurred_at',
	'happened_on',
	'scheduled_start_at',
	'scheduled_end_at',
	'scheduled_start_on',
	'scheduled_end_on',
	'calendar_status',
	'calendar_manual',
	'location',
	'attendees',
	'calendar_account',
	'calendar_id',
	'calendar_etag',
	'calendar_revision',
	'calendar_notify',
	'company',
	'project_id',
	'contact_id',
	'detail',
	'recording',
	'attachments',
	'source_key',
	'thread_key',
	'source_user',
	'source_message',
	'source_calendar',
	'external_id',
	'source_seq',
	'transport',
	'handle',
	'direction',
	'classification',
	'reason',
	'classified_at',
	'classified_by',
	'owner',
	'status',
	'transcription',
	'transcription_error',
	'language',
	'segments',
	'notes',
	'notes_at'
] as const;
/** What identifies a captured message's source: set once, never edited. */
const SOURCE = new Set<string>([
	'source_key',
	'thread_key',
	'source_user',
	'source_message',
	'external_id',
	'source_seq',
	'transport',
	'handle',
	'direction'
]);

/** What a write sends and what the transform derives: any of the writable columns, as a writer may send them. */
type Patch = { readonly [K in (typeof columns)[number]]?: CreateInput<'activities'>[K] };
type Entry = {
	readonly input: Patch;
	/** The row after the write: on update, the stored row with `input` applied. */
	readonly after: Patch;
	readonly before: StoredTree<'activities', 'update'> | undefined;
};
const ids = <T>(values: readonly (T | null | undefined)[]) => [
	...new Set(values.filter((v): v is T => v != null))
];
/**
 * What every activity write derives, created or updated: its customer from the job or contact, the source message's
 * account and thread, a member's own calendar for a new meeting and one more calendar revision for each of their
 * edits to a synced meeting, manual filing, reminders and transcription resets. Two reads for the whole batch.
 */
const derived = Effect.fnUntraced(function* (
	entries: readonly Entry[],
	ctx: WriteCtx<'activities'>
) {
	const member = ctx.actor.kind === 'member' ? ctx.actor : null;
	// a member's new meeting goes to their own Google Calendar; only then is it read
	const defaultsCalendar =
		member !== null &&
		entries.some(
			({ input, before }) =>
				before === undefined && input.kind === 'meeting' && input.calendar_account == null
		);
	const {
		projects,
		contacts,
		sys_message: sourceMessages,
		calendar_entries: sourceCalendars
	} = yield* ctx.query({
		projects: {
			where: {
				id: { in: ids(entries.map(({ after }) => after.project_id)) }
			},
			fields: ['company_id']
		},
		contacts: {
			where: {
				id: { in: ids(entries.map(({ after }) => after.contact_id)) }
			},
			fields: ['company_id']
		},
		sys_message: {
			where: {
				id: {
					in: ids(entries.map(({ after }) => after.source_message))
				}
			},
			fields: ['integration', 'thread', 'conversation', 'source_at', 'sent_at', 'created_at']
		},
		calendar_entries: {
			where: {
				id: {
					in: ids(entries.map(({ after }) => after.source_calendar))
				}
			},
			fields: ['source_user']
		}
	});
	// One read of the accounts: the source messages' own (an unrelated connection's change never conflicts this
	// write), the meetings' calendar accounts, and the member's own active Google Calendar when a new meeting needs one.
	const accounts = (yield* ctx.query({
		sys_integration: {
			where: {
				or: [
					{ id: { in: ids(sourceMessages.rows.map((message) => message.integration)) } },
					{
						id: {
							in: ids(entries.map(({ after }) => after.calendar_account))
						}
					},
					{
						integration: { eq: 'google_calendar' },
						owner: { in: defaultsCalendar && member !== null ? [member.id] : [] },
						active: { eq: true }
					}
				]
			},
			fields: ['integration', 'owner', 'import_start', 'active']
		}
	})).sys_integration.rows;
	const sourceAccounts = { rows: accounts },
		calendarAccounts = { rows: accounts },
		ownCalendars = {
			rows: accounts.filter(
				(account) =>
					defaultsCalendar &&
					account.integration === 'google_calendar' &&
					account.active &&
					account.owner === member?.id
			)
		};
	const result: Patch[] = [];
	for (const [row, { input, before, after }] of entries.entries()) {
		const kind = after.kind ?? 'note';
		if (
			input.source_calendar !== undefined &&
			member !== null &&
			input.source_calendar !== (before?.source_calendar ?? null)
		)
			return yield* ctx.refuse('errors.calendar_source_automatic', { row });
		const calendar = sourceCalendars.rows.find((entry) => entry.id === after.source_calendar);
		const source = sourceMessages.rows.find((m) => m.id === after.source_message);
		const sourceAccount = sourceAccounts.rows.find((account) => account.id === source?.integration);
		if (before === undefined && source !== undefined && sourceAccount !== undefined) {
			if (!(yield* messageImportAllows(sourceAccount, source, ctx)))
				return yield* ctx.refuse('errors.source_outside_import', { field: 'source_message', row });
		}
		const company =
			customerForProject(after, projects.rows) ??
			contacts.rows.find((r) => r.id === after.contact_id)?.company_id ??
			null;
		const sourceUser = sourceAccount?.owner ?? null;
		// two-way calendar: a member's edit of a synced meeting is one more revision for Google; sync writes never are
		let calendarSync: Pick<
			Patch,
			'calendar_account' | 'calendar_id' | 'calendar_etag' | 'calendar_revision' | 'calendar_notify'
		> = {};
		if (kind === 'meeting' && member !== null) {
			if (before !== undefined)
				for (const field of ['calendar_id', 'calendar_etag', 'calendar_revision'] as const)
					if (input[field] !== undefined && input[field] !== before[field])
						return yield* ctx.refuse('errors.calendar_fields_synced', {
							field,
							row
						});
			if (
				input.calendar_account != null &&
				input.calendar_account !== before?.calendar_account &&
				calendarAccounts.rows.find((account) => account.id === input.calendar_account)?.owner !==
					member.id
			)
				return yield* ctx.refuse('errors.calendar_not_own', {
					field: 'calendar_account',
					row
				});
			const own = before === undefined ? ownCalendars.rows[0] : undefined;
			const account = after.calendar_account ?? (own === undefined ? null : calendarAccountOf(own));
			if (account !== null && (before === undefined || syncedChange(input, before))) {
				const owner =
					calendarAccounts.rows.find((r) => r.id === account)?.owner ??
					ownCalendars.rows.find((r) => r.id === account)?.owner;
				if (owner !== member.id) return yield* ctx.refuse('errors.calendar_owner_only', { row });
				calendarSync = {
					calendar_account: account,
					calendar_id: before?.calendar_id ?? 'primary',
					...(before === undefined ? { calendar_etag: null } : {}),
					calendar_revision: (before?.calendar_revision ?? 0) + 1,
					// guests are emailed only when this very save asks
					calendar_notify: input.calendar_notify === true
				};
			} else
				calendarSync =
					before === undefined
						? { calendar_etag: null, calendar_revision: 0, calendar_notify: false }
						: { calendar_notify: before.calendar_notify };
		}
		// a member choosing a message's job files it manually: the classifier only rewrites pending or review messages
		const filed =
			member !== null &&
			before?.kind === 'message' &&
			input.classified_by === undefined &&
			input.project_id != null &&
			input.project_id !== before.project_id;
		// Synced voice notes own their transcription; manual forms may send the default `none` explicitly.
		const recorded =
			input.recording != null &&
			input.recording.id !== before?.recording?.id &&
			(before !== undefined || source == null) &&
			(input.transcription === undefined ||
				input.transcription === 'none' ||
				input.transcription === 'pending');
		result.push({
			source_user: calendar?.source_user ?? sourceUser,
			...(before === undefined && kind === 'message' && sourceUser != null && input.owner == null
				? { owner: sourceUser }
				: {}),
			...(source == null
				? {}
				: {
						source_key: source.integration,
						thread_key: source.conversation ?? source.thread ?? source.id
					}),
			status: after.status ?? 'open',
			...calendarSync,
			company,
			...(filed
				? {
						classification: 'useful' as const,
						classified_by: 'manual' as const,
						reason: input.reason ?? 'Customer assignment changed manually.',
						classified_at: ctx.now
					}
				: {}),
			...(before === undefined
				? {
						occurred_at:
							input.occurred_at ??
							(input.happened_on == null ? ctx.now : `${input.happened_on}T00:00:00.000Z`)
					}
				: {}),
			...(recorded
				? {
						transcription: 'pending' as const,
						transcription_error: null,
						segments: null,
						language: null,
						notes: null,
						notes_at: null
					}
				: {})
		});
	}
	return result;
});

/** One chronological customer record. Kind selects the payload; source IDs make ingestion idempotent. */
const assigned = (row: Row<'activities'>) => row.project_id != null || row.company != null;
/** Evidence a job's extraction reads: assigned, and not a message unless it was filed as useful. */
const useful = (row: Row<'activities'>) =>
	assigned(row) && (row.kind !== 'message' || row.classification === 'useful');
/** A newly pending recording is transcribed by `transcribe_meeting`, which holds the transcription facility. */
const transcribe = Effect.fnUntraced(function* (
	rows: readonly Row<'activities'>[],
	ctx: Pick<EffectCtx, 'schedule' | 'now'>
) {
	const ids = rows.flatMap((row) =>
		row.transcription === 'pending' && row.recording != null ? [row.id] : []
	);
	if (ids.length > 0) yield* ctx.schedule('transcribe_meeting', { ids }, { at: ctx.now });
});

export default model('activities', {
	description: 'Customer messages, meetings, calls, notes and milestones in one timeline.',
	icon: 'lucide:activity',
	record_label: 'record.subject',
	fields: {
		subject: { kind: 'text' },
		kind: {
			kind: 'enum',
			values: ['note', 'recording', 'call', 'message', 'meeting', 'milestone'],
			default: 'note'
		},
		occurred_at: { kind: 'instant', default: { var: 'now' } },
		happened_on: { kind: 'date', optional: true },
		scheduled_start_at: { kind: 'instant', optional: true },
		scheduled_end_at: { kind: 'instant', optional: true },
		scheduled_start_on: { kind: 'date', optional: true },
		scheduled_end_on: { kind: 'date', optional: true },
		calendar_manual: { kind: 'bool', default: false },
		location: { kind: 'text', optional: true },
		/** Guests' email addresses; the organiser's own calendar entry is never listed. */
		attendees: { kind: 'text', many: true, optional: true },
		/** Two-way sync: the Google calendar a meeting lives in (its account is `calendar_account`). */
		calendar_id: { kind: 'text', optional: true, hidden: true },
		/** The Google event version HQ last applied; an inbound event with it is HQ's own echo. */
		calendar_etag: { kind: 'text', optional: true, hidden: true },
		/** Bumped by each member edit of a synced meeting: one write to Google per revision. */
		calendar_revision: { kind: 'int', default: 0, hidden: true },
		/** Email Google Calendar guests about this edit: opted into per save, never by default. */
		calendar_notify: { kind: 'bool', default: false },
		calendar_status: {
			kind: 'enum',
			values: ['confirmed', 'tentative', 'cancelled'],
			optional: true
		},
		detail: { kind: 'text', format: 'markdown', optional: true },
		recording: { kind: 'file', accept: ['audio/*', 'video/*'], max: '20MiB', optional: true },
		/** Images and documents a message carried: `update_requirements` reads them with its text. */
		attachments: { kind: 'file', accept: ['*/*'], max: '20MiB', many: true, optional: true },
		source_key: { kind: 'text', optional: true, hidden: true },
		thread_key: { kind: 'text', optional: true, hidden: true },
		external_id: { kind: 'text', optional: true, hidden: true },
		source_seq: { kind: 'int', optional: true, hidden: true },
		transport: { kind: 'text', optional: true },
		handle: { kind: 'text', optional: true },
		direction: { kind: 'enum', values: ['inbound', 'outbound'], optional: true },
		classification: {
			kind: 'enum',
			values: ['pending', 'useful', 'ignored', 'review'],
			optional: true
		},
		reason: { kind: 'text', optional: true },
		classified_at: { kind: 'instant', optional: true },
		classified_by: {
			kind: 'enum',
			values: ['hard_filter', 'model', 'manual', 'calendar'],
			optional: true
		},
		status: {
			kind: 'state',
			initial: 'open',
			states: {
				open: { to: ['done', 'cancelled'] },
				done: { to: ['open'] },
				cancelled: { to: ['open'] }
			}
		},
		transcription: {
			kind: 'enum',
			values: ['none', 'pending', 'done', 'failed', 'unavailable'],
			default: 'none'
		},
		transcription_error: { kind: 'text', optional: true },
		language: { kind: 'text', optional: true },
		segments: {
			kind: 'json',
			optional: true,
			shape: {
				kind: 'object',
				many: true,
				fields: {
					speaker: { kind: 'text' },
					start: { kind: 'number' },
					end: { kind: 'number' },
					text: { kind: 'text' }
				}
			}
		},
		notes: { kind: 'text', format: 'markdown', optional: true },
		notes_at: { kind: 'instant', optional: true },
		/** The calendar entry a meeting was imported from or linked to; a removed entry unlinks it. */
		source_calendar: {
			kind: 'ref',
			to: 'calendar_entries',
			inverse: 'crm_activities',
			optional: true,
			on_delete: 'set_null'
		},
		/** The member's Google Calendar account a meeting is written to: it picks the sync's instance. */
		calendar_account: {
			kind: 'ref',
			to: 'sys_integration',
			where: { integration: { eq: 'google_calendar' } },
			optional: true
		},
		source_user: { kind: 'ref', to: 'sys_user', optional: true },
		source_message: { kind: 'ref', to: 'sys_message', inverse: 'crm_activities', optional: true },
		owner: { kind: 'ref', to: 'sys_user', optional: true, default: { var: 'actor.id' } },
		company: { kind: 'ref', to: 'companies', inverse: 'activities', optional: true },
		project_id: { kind: 'ref', to: 'projects', inverse: 'activities', optional: true },
		contact_id: { kind: 'ref', to: 'contacts', inverse: 'activities', optional: true }
	},
	constraints: {
		one_activity_per_external_message: {
			unique: ['source_key', 'external_id'],
			where: {
				source_key: { is_null: false },
				external_id: { is_null: false },
				source_calendar: { is_null: true }
			}
		},
		one_activity_per_native_message: { unique: ['source_message'] },
		one_activity_per_calendar_event: {
			unique: ['source_calendar', 'external_id'],
			where: { source_calendar: { is_null: false }, external_id: { is_null: false } }
		}
	},
	indexes: {
		by_occurred_at: { on: ['occurred_at'] },
		by_kind_status: { on: ['kind', 'status'] },
		by_classification_seq: { on: ['classification', 'source_seq'] },
		by_user_occurred_at: { on: ['source_user', 'occurred_at'] },
		by_thread: { on: ['source_key', 'thread_key', 'occurred_at'] },
		find: { text: ['subject', 'detail', 'handle', 'company', 'project_id'] }
	},
	// the layers timelines, reminders, replies and meeting notes read with an activity
	outputs: {
		default: {
			fields: 'all',
			project_id: { fields: ['name', 'company_id'], company_id: { fields: ['name', 'uen'] } },
			company: { fields: ['name', 'stage'] },
			// an owner shows by name, as every member reads the directory
			owner: { fields: ['name'] },
			source_message: {
				fields: ['conversation', 'integration', 'source_at', 'sent_at', 'deleted_at']
			},
			speakers: {
				fields: ['label', 'name', 'contact', 'voice_enrolled_at', 'recording'],
				contact: { fields: ['full_name'] }
			},
			action_items: { fields: ['subject'] }
		}
	},
	create: {
		fields: columns,
		filled: { fields: ['company', 'occurred_at', 'status'] },
		transform: function* (changes, ctx) {
			const patches = yield* derived(
				changes.map(({ set, after }) => ({ input: set, before: undefined, after })),
				ctx
			);
			return changes.map(({ set }, i) => ({ ...set, ...patches[i] }));
		},
		effect: function* (changes, ctx) {
			const rows = changes.map(({ after }) => after);
			// filed evidence refreshes its job and customer
			yield* deriveFrom(rows.filter(useful), ctx);
			// a message captured without a source message (logged by hand) is classified now, not at the next sweep
			if (
				rows.some(
					(row) =>
						row.kind === 'message' &&
						row.source_message == null &&
						(row.classification === 'pending' || row.classification === 'review')
				)
			)
				yield* ctx.schedule(
					'classify_messages',
					{},
					{ at: ctx.now, key: 'crm-message-classification-backlog' }
				);
			yield* transcribe(rows, ctx);
		}
	},
	update: {
		fields: columns.filter((field) => !SOURCE.has(field)),
		transform: function* (changes, ctx) {
			const patches = yield* derived(
				changes.map(({ before, set, after }) => ({ input: set, before, after })),
				ctx
			);
			return changes.map(({ set }, i) => ({ ...set, ...patches[i] }));
		},
		effect: function* (changes, ctx) {
			yield* deriveFrom(
				changes.flatMap(({ before, after }) =>
					// a changed or cleared assignment also refreshes the former job and customer
					before.project_id !== after.project_id || before.company !== after.company
						? [before, after]
						: (assigned(after) &&
									(before.kind !== after.kind || before.classification !== after.classification)) ||
							  (useful(after) &&
									(before.subject !== after.subject ||
										before.occurred_at !== after.occurred_at ||
										before.detail !== after.detail ||
										before.notes !== after.notes ||
										JSON.stringify(before.segments) !== JSON.stringify(after.segments)))
							? [after]
							: []
				),
				ctx
			);
			yield* transcribe(
				changes.flatMap(({ before, after }) =>
					before.transcription === after.transcription ? [] : [after]
				),
				ctx
			);
		}
	}
});
