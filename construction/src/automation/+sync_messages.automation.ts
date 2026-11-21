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

const OLDEST_PAGE = 50;
const BATCH = 25;
const TRANSPORTS = ['whatsapp', 'telegram', 'email', 'slack', 'discord'] as const;

type SyncTransport = (typeof TRANSPORTS)[number];
const isSyncTransport = (value: string | undefined): value is SyncTransport =>
	value !== undefined && TRANSPORTS.some((item) => item === value);

export default automation({
	description:
		'Mirrors members’ WhatsApp and email accounts and the workspace’s WhatsApp, Telegram, Slack, Discord and email channels into project_messages; voice notes are transcribed and site photos attached.',
	on: [{ cron: '* * * * *', rest: '1d' }],
	input: { batch: { kind: 'int', optional: true } },
	policies: ['construction_automation'],
	concurrency: { max: 1 },
	run: function* (input, ctx) {
		const batch = Math.min(input.batch ?? BATCH, BATCH);
		const connections = (yield* ctx.query({
			sys_integration: {
				where: { integration: { in: [...TRANSPORTS] } },
				fields: ['integration', 'import_start']
			}
		})).sys_integration;
		const owned = connections.rows;
		if (owned.length === 0) return;
		const transportOf = new Map(owned.map((r) => [r.id, r.integration]));
		const boundary = {
			...(yield* messageImportWhere(owned, ctx)),
			deleted_at: { is_null: true }
		} as const;
		const filed = { source_message: { is: boundary } } as const;
		const filedThrough = Effect.fnUntraced(function* (seq: number) {
			const counts = yield* ctx.query({
				sys_message: { where: { ...boundary, seq: { lte: seq } }, aggregate: { count: true } },
				project_messages: {
					where: { ...filed, source_seq: { lte: seq } },
					aggregate: { count: true }
				}
			});
			return counts.sys_message.count === counts.project_messages.count;
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
											where: narrowed({ integration, source_at: { is_null: true } }),
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
		const candidates = [...oldest.rows, ...recent.flat()].map((row) => row.id);
		const taken = new Set(
			(yield* ctx.query({
				project_messages: {
					where: { source_message: { in: candidates } },
					fields: ['source_message'],
					limit: candidates.length
				}
			})).project_messages.rows.map((row) => row.source_message)
		);
		const messages = selectBatch(oldest.rows, recent, taken, batch);
		if (messages.length === 0) return;

		for (const metadata of messages) {
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
			const rawTransport = m.integration === null ? undefined : transportOf.get(m.integration);
			const transport: SyncTransport = isSyncTransport(rawTransport) ? rawTransport : 'whatsapp';
			const inputs = conversation?.inputs;
			const own = isArray(inputs)
				? inputs.filter((file) => jsonField(file, 'message') === m.id)
				: [];
			const note = (m.text ?? '') === '' ? voiceNote(own) : null;
			const attachments = filesOf(own).filter((file) => file.id !== note?.id);
			const handle =
				transport === 'email' && m.direction === 'outbound'
					? sentMailHandle(m.email)
					: (transport === 'telegram' || transport === 'slack' || transport === 'discord') &&
						  m.sender != null
						? `${transport}:${m.sender}`
						: (m.sender ?? '');
			const outcome = yield* skipRacedWrite(
				ctx.act({
					'project_messages.create': [
						{
							source_message: m.id,
							source_seq: m.seq,
							transport,
							direction: m.direction === 'outbound' ? ('outbound' as const) : ('inbound' as const),
							subject: String(
								jsonField(m.email, 'subject') ?? m.sender_name ?? m.sender ?? 'Site message'
							),
							sender_name: m.sender_name ?? m.sender ?? null,
							handle,
							detail: m.text ?? '',
							occurred_at: m.source_at ?? m.sent_at ?? m.created_at,
							...(attachments.length > 0 ? { attachments: attachments.map(file_ref) } : {}),
							...(note === null
								? { classification: 'pending' as const, transcription: 'none' as const }
								: {
										recording: file_ref(note),
										classification: 'pending' as const,
										transcription: 'pending' as const
									})
						}
					]
				})
			);
			if (outcome === null) continue;
			if (outcome.kind !== 'committed') {
				return yield* ctx.refuse('errors.intake_failed', { values: { kind: outcome.kind } });
			}
			if (note === null) continue;
			const created = outcome.records.find((r) => r.model === 'project_messages');
			if (created === undefined) continue;
			const heard = yield* ctx.convert.ingest(file_ref(note), { diarize: false }).pipe(
				Effect.map((got) => (got.kind === 'document' ? got.transcript : undefined)?.segments ?? []),
				Effect.map((segments) => ({
					detail: segments.map((s) => s.text.trim()).join(' '),
					transcription: 'done' as const
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
				'project_messages.update': [
					{
						target: { id: created.id, revision: created.revision },
						set: { ...heard, classification: 'pending' }
					}
				]
			});
		}

		yield* ctx.schedule(
			'classify_messages',
			{},
			{ at: ctx.now, key: 'construction-classify-backlog' }
		);
		yield* ctx.progress({ text: `${messages.length} coordination messages synced` });
		if (messages.length === batch || oldest.rows.length === OLDEST_PAGE) {
			yield* ctx.schedule('sync_messages', input, {
				at: ctx.now,
				key: 'construction-sync-backlog'
			});
		}
	}
});
