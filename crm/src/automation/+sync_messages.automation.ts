import { Effect } from 'effect';
import { isArray } from 'effect/Array';
import { automation, type Where } from '@norbital-ai/bolt';
import {
	conversationId,
	filesOf,
	jsonField,
	sentMailHandle,
	voiceNote
} from '../lib/conversations.js';
import {
	messageImportWhere,
	newestOf,
	selectBatch,
	skipRacedWrite
} from '../lib/message-import.js';
import { allowsAutomation } from '../lib/classifier.js';

/** Old history read per run: filed rows past the prefix drop out, and still a full batch unfiled can remain. */
const OLDEST_PAGE = 50;
/** Messages filed per run unless a start names a smaller catch-up batch. */
const BATCH = 25;
/** The conversation definitions whose messages HQ files. */
const TRANSPORTS = ['email', 'whatsapp', 'telegram', 'slack', 'discord'] as const;

export default automation({
	description:
		'Mirrors members’ WhatsApp and mailbox accounts and the workspace’s WhatsApp, email, Telegram, Slack and Discord accounts into the shared CRM intake table; a voice note is filed as its transcript, images and documents as its attachments.',
	on: [{ model: 'sys_message', verbs: ['create'] }],
	input: { batch: { kind: 'int', optional: true } },
	policies: ['hq_automation'],
	concurrency: { max: 1 },
	run: function* (input, ctx) {
		const batch = Math.min(input.batch ?? BATCH, BATCH);
		const connections = (yield* ctx.query({
			sys_integration: {
				// a member's own accounts and the workspace's (Telegram, Slack and Discord bots are always the workspace's)
				where: { integration: { in: [...TRANSPORTS] } },
				fields: ['integration', 'import_start', 'classifier']
			}
		})).sys_integration;
		const owned = connections.rows.filter((r) => allowsAutomation(r.classifier, 'sync_messages'));
		if (owned.length === 0) return;
		const transportOf = new Map(owned.map((r) => [r.id, r.integration]));
		const boundary = {
			...(yield* messageImportWhere(owned, ctx)),
			deleted_at: { is_null: true }
		} as const;
		// a message is filed when an activity names it: the activity's `source_message` layer (a system model has no tenant layer)
		const filed = { source_message: { is: boundary } } as const;
		/** Whether every message of the boundary up to `seq` is filed: as many activities name one as there are. */
		const filedThrough = Effect.fnUntraced(function* (seq: number) {
			const counts = yield* ctx.query({
				sys_message: { where: { ...boundary, seq: { lte: seq } }, aggregate: { count: true } },
				activities: { where: { ...filed, source_seq: { lte: seq } }, aggregate: { count: true } }
			});
			return counts.sys_message.count === counts.activities.count;
		});
		const page = (yield* ctx.query({
			sys_message: {
				where: boundary,
				fields: ['seq'],
				order_by: { seq: 'asc' },
				limit: OLDEST_PAGE
			}
		})).sys_message.rows;
		const last = page.at(-1);
		if (last === undefined) return;
		// a whole page of filed history: every lane reads past the longest filed prefix (by sequence), so it never fills one
		let low = 0;
		if (page.length === OLDEST_PAGE && (yield* filedThrough(last.seq))) {
			const newest = (yield* ctx.query({
				sys_message: { where: boundary, fields: ['seq'], order_by: { seq: 'desc' }, limit: 1 }
			})).sys_message.rows[0];
			if (newest === undefined || (yield* filedThrough(newest.seq))) return;
			let high = newest.seq;
			low = last.seq;
			while (high - low > 1) {
				const mid = Math.floor((low + high) / 2);
				if (yield* filedThrough(mid)) low = mid;
				else high = mid;
			}
		}
		const where: Where<'sys_message'> = { ...boundary, seq: { gt: low } };
		/** Each lane narrows the shared import boundary; an explicit type keeps the merged predicate checkable. */
		const narrowed = (lane: Where<'sys_message'>): Where<'sys_message'> => ({ ...where, ...lane });
		const fields = [
			'seq',
			'integration',
			'direction',
			'sender',
			'sender_name',
			'source_at',
			'sent_at',
			'created_at'
		] as const;
		const [oldest, recent] = yield* Effect.all(
			[
				ctx
					.query({
						sys_message: {
							where: narrowed({ integration: { in: owned.map((r) => r.id) } }),
							fields,
							order_by: { seq: 'asc' },
							limit: OLDEST_PAGE
						}
					})
					.pipe(Effect.map((answer) => answer.sys_message)),
				Effect.forEach(
					[...new Set(owned.map((r) => r.integration))],
					Effect.fnUntraced(function* (provider) {
						const integration = {
							in: owned.filter((r) => r.integration === provider).map((r) => r.id)
						};
						// Two differently ordered pages: a read request names a model once.
						const [dated, undated] = yield* Effect.all(
							[
								ctx
									.query({
										sys_message: {
											where: narrowed({ integration, source_at: { is_null: false } }),
											fields,
											order_by: [{ source_at: 'desc' }, { seq: 'desc' }],
											limit: 4
										}
									})
									.pipe(Effect.map((answer) => answer.sys_message)),
								ctx
									.query({
										sys_message: {
											where: narrowed({
												integration,
												source_at: { is_null: true }
											}),
											fields,
											order_by: [{ created_at: 'desc' }, { seq: 'desc' }],
											limit: 4
										}
									})
									.pipe(Effect.map((answer) => answer.sys_message))
							],
							{ concurrency: 3 }
						);
						return newestOf([...dated.rows, ...undated.rows], 4);
					}),
					{ concurrency: 3 }
				)
			],
			{ concurrency: 2 }
		);
		// a lane's message an activity already names (filed past the prefix, or by a run since) is not filed again
		const candidates = [...oldest.rows, ...recent.flat()].map((row) => row.id);
		const taken = new Set(
			(yield* ctx.query({
				activities: {
					where: { source_message: { in: candidates } },
					fields: ['source_message'],
					limit: candidates.length
				}
			})).activities.rows.map((row) => row.source_message)
		);
		const messages = selectBatch(oldest.rows, recent, taken, batch);
		if (messages.length === 0) return;
		for (const metadata of messages) {
			// the message and its conversation's inputs: a message's files are the inputs that name it
			const content = (yield* ctx.query({
				sys_message: {
					where: { id: { eq: metadata.id } },
					fields: ['text', 'email', 'conversation'],
					limit: 1
				}
			})).sys_message.rows[0];
			if (content === undefined) continue;
			const conversation =
				content.conversation === null
					? undefined
					: (yield* ctx.query({
							sys_conversation: {
								where: { id: { eq: conversationId(content.conversation) } },
								fields: ['inputs'],
								limit: 1
							}
						})).sys_conversation.rows[0];
			const m = { ...metadata, ...content };
			const transport = m.integration === null ? undefined : transportOf.get(m.integration);
			// a voice note with no text is filed as its transcript, the audio kept as the activity's recording
			const inputs = conversation?.inputs;
			const own = isArray(inputs)
				? inputs.filter((file) => jsonField(file, 'message') === m.id)
				: [];
			const note = (m.text ?? '') === '' ? voiceNote(own) : null;
			// images and documents the message carried, read with its text when its job's scope is extracted
			const attachments = filesOf(own).filter((file) => file.id !== note?.id);
			// the account, its member and the thread are the source message's own (the activities transform derives them)
			// the import selection may change after this run read it: that message is skipped, not the run
			const outcome = yield* skipRacedWrite(
				ctx.act({
					'activities.create': [
						{
							kind: 'message' as const,
							external_id: m.id,
							source_message: m.id,
							source_seq: m.seq,
							transport: transport ?? 'whatsapp',
							subject: String(
								jsonField(m.email, 'subject') ?? m.sender_name ?? m.sender ?? 'Message'
							),
							// a Telegram, Slack or Discord sender is a user id: prefixed so it is never read as a phone number
							handle:
								transport === 'email' && m.direction === 'outbound'
									? sentMailHandle(m.email)
									: (transport === 'telegram' ||
												transport === 'slack' ||
												transport === 'discord') &&
										  m.sender != null
										? `${transport}:${m.sender}`
										: (m.sender ?? ''),
							detail: m.text ?? '',
							direction: m.direction === 'outbound' ? ('outbound' as const) : ('inbound' as const),
							occurred_at: m.source_at ?? m.sent_at ?? m.created_at,
							...(attachments.length > 0 ? { attachments: attachments.map(file_ref) } : {}),
							// a voice note awaits classification until its transcript is the detail; the meeting transcriber never queues it
							...(note === null
								? { classification: 'pending' as const }
								: { recording: file_ref(note), transcription: 'none' as const })
						}
					]
				})
			);
			if (outcome === null) continue;
			if (outcome.kind !== 'committed')
				return yield* ctx.refuse('errors.intake_failed', { values: { kind: outcome.kind } });
			if (note === null) continue;
			// transcribed once the activity holds the recording: the run reads the file through it
			const activity = outcome.records.find((r) => r.model === 'activities');
			if (activity === undefined) continue;
			const heard = yield* ctx.convert.ingest(file_ref(note), { diarize: false }).pipe(
				Effect.map((got) => (got.kind === 'document' ? got.transcript : undefined)?.segments ?? []),
				Effect.map((segments) => ({
					detail: segments.map((segment) => segment.text.trim()).join(' '),
					transcription: 'done' as const,
					segments: segments.map(({ speaker, start, end, text }) => ({
						speaker,
						start,
						end,
						text
					}))
				})),
				Effect.catchTags({
					Unavailable: (error) =>
						Effect.succeed({
							detail: '[voice note — transcription unavailable]',
							transcription: 'unavailable' as const,
							transcription_error: error.reason
						}),
					FacilityFailure: (error) =>
						Effect.succeed({
							detail: '[voice note — transcription failed]',
							transcription: 'failed' as const,
							transcription_error: error.message
						})
				})
			);
			yield* ctx.act({
				'activities.update': [
					{
						target: { id: activity.id, revision: activity.revision },
						set: { ...heard, classification: 'pending' }
					}
				]
			});
		}
		yield* ctx.schedule(
			'classify_messages',
			{},
			{ at: ctx.now, key: 'crm-message-classification-backlog' }
		);
		yield* ctx.progress({ text: `${messages.length} personal account items synced` });
		if (messages.length === batch || oldest.rows.length === OLDEST_PAGE)
			yield* ctx.schedule('sync_messages', input, { at: ctx.now, key: 'crm-message-sync-backlog' });
	}
});
