import { expect, layer } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit, JobResult } from '@norbital-ai/bolt-cli/test';
import type { DriverOpen } from '@norbital-ai/bolt/engine';
import { DateTime, Effect, Schema } from 'effect';
import { messageImportWhere } from '../src/lib/message-import.js';
import { scriptedDecision } from './model.js';
import { personalAccount } from './personal-fixture.js';
import {
	idOf,
	member,
	recordOf,
	required,
	sharedWorkspace,
	wireAct,
	pageOf,
	targetOf
} from './workspace.js';

const NOW = '2026-10-21T02:00:00Z';
/** The context test's PIC: no other test's message is from it. */
const CONTEXT_SENDER = '6580000099';
const TODAY = '2026-10-20T16:00:00Z';
const OLD = '2026-10-20T15:59:59Z';
type ImportStart = NonNullable<DriverOpen['import_start']>;
const since = (at: string): ImportStart => ({
	kind: 'since',
	at,
	zone: 'Asia/Singapore',
	origin: 'date'
});
const chat = (
	id: string,
	sentAt: string,
	sourceAt: string | null = sentAt,
	sender = '6580000000'
) => ({
	id,
	thread: `${sender}@s.whatsapp.net`,
	sent_at: sentAt,
	source_at: sourceAt,
	from: { handle: `${sender}@s.whatsapp.net`, name: 'Unknown sender' },
	text: id,
	attachments: []
});
const setBoundary = (
	t: Kit,
	who: Parameters<Kit['as']>[0],
	target: Id<'sys_integration'>,
	importStart: ImportStart
) =>
	targetOf(t, 'sys_integration', target).pipe(
		Effect.flatMap((current) =>
			wireAct(t, who, 'sys_integration.update', [
				{ target: current, set: { import_start: importStart } }
			])
		)
	);

/** The account fields the import boundary reads, decoded from the kit's manifest-typed rows. */
const Accounts = Schema.Array(
	Schema.Struct({
		id: idOf('sys_integration'),
		import_start: Schema.Unknown
	})
);
/** A stored source message as a capture names it. */
const sourceOf = (row: unknown) =>
	Schema.decodeUnknownSync(Schema.Struct({ id: idOf('sys_message'), seq: Schema.Number }))(row);
/** The thread key the activities transform derives from a source message. */
const threadOf = (row: unknown) => {
	const message = Schema.decodeUnknownSync(
		Schema.Struct({
			id: Schema.String,
			conversation: Schema.NullOr(Schema.String),
			thread: Schema.NullOr(Schema.String)
		})
	)(row);
	return message.conversation ?? message.thread ?? message.id;
};

// One workspace: every test owns its accounts, senders and rows.
const model = scriptedDecision([]);
layer(sharedWorkspace({ now: NOW, ports: model.ports }), { excludeTestServices: true })(
	'import boundary',
	(it) => {
		it.effect(
			'admits stored history by inclusive authoritative source time, keeping the raw messages',
			() =>
				Effect.gen(function* () {
					const t = yield* TestWorkspace;
					const admin = yield* t.as(t.admin);
					const phone = yield* personalAccount(t, yield* member(t, ['sales', 'crm']), 'whatsapp');
					// already stored when the account chooses its import boundary
					for (const [id, sentAt, sourceAt] of [
						['before', NOW, OLD],
						['exact', OLD, TODAY],
						['between', NOW, '2026-10-20T20:00:00Z'],
						['unknown-source', NOW, null]
					] satisfies readonly [string, string, string | null][])
						yield* t.receive(phone, chat(id, sentAt, sourceAt));
					expect((yield* setBoundary(t, t.admin, phone, since(TODAY))).kind).toBe('committed');
					const account = yield* Schema.decodeUnknownEffect(Accounts)(
						pageOf(
							yield* admin.query({
								sys_integration: {
									where: { id: { eq: phone } },
									fields: ['import_start']
								}
							}),
							'sys_integration'
						).rows
					);
					// the boundary sync and classification read through filters intake; raw history stays stored
					const sources = pageOf(
						yield* admin.query({
							sys_message: { where: { integration: { eq: phone } }, fields: ['seq', 'text'] }
						}),
						'sys_message'
					).rows;
					expect(sources).toHaveLength(4);
					const admitted = pageOf(
						yield* admin.query({
							sys_message: {
								where: yield* messageImportWhere(account, {
									refuse: (...refused) => Effect.die(refused)
								}),
								fields: ['text']
							}
						}),
						'sys_message'
					).rows;
					expect(admitted.map((row) => row.text).sort()).toEqual(['between', 'exact']);
					// capture rechecks the boundary: a stored message before it is never filed
					const stale = required(sources.find((row) => row.text === 'before'));
					expect(
						yield* Effect.flip(
							admin.act({
								'activities.create': [
									{
										kind: 'message',
										subject: 'Forged current activity time',
										source_message: sourceOf(stale).id,
										source_seq: sourceOf(stale).seq,
										occurred_at: DateTime.formatIso(DateTime.makeUnsafe(NOW))
									}
								]
							})
						)
					).toMatchObject({ _tag: 'ActRefused' });
				})
		);

		it.effect(
			'excludes pre-boundary raw history from classifier context while retaining manual context',
			() =>
				Effect.gen(function* () {
					const t = yield* TestWorkspace;
					const asked = model.requests.length;
					const admin = yield* t.as(t.admin);
					// a workspace number (no owner)
					const line = yield* admin.act({
						'sys_integration.create': [{ integration: 'whatsapp', name: 'Workspace line' }]
					});
					if (line.kind !== 'committed') throw new Error(JSON.stringify(line));
					const account = recordOf(line.records, 'sys_integration');
					const companyResult = yield* admin.act({
						'companies.create': [{ name: 'Context customer' }]
					});
					if (companyResult.kind !== 'committed') throw new Error(JSON.stringify(companyResult));
					yield* admin.act({
						'contacts.create': [
							{
								full_name: 'Context PIC',
								phone: '+65 8000 0099',
								company_id: recordOf(companyResult.records, 'companies').id
							}
						]
					});
					const priorDisplay = '2026-10-21T01:58:00Z';
					const cutoff = '2026-10-21T01:55:00Z';
					yield* t.receive(
						account.id,
						chat('raw-context', priorDisplay, '2026-10-21T01:50:00Z', CONTEXT_SENDER)
					);
					const oldSource = required(
						pageOf(
							yield* admin.query({
								sys_message: { where: { text: { eq: 'raw-context' } }, fields: ['seq'] }
							}),
							'sys_message'
						).rows[0]
					);
					expect(
						(yield* admin.act({
							'activities.create': [
								{
									kind: 'message',
									classification: 'ignored',
									subject: 'Earlier raw message',
									detail: 'PRE_BOUNDARY_RAW_SECRET',
									source_message: sourceOf(oldSource).id,
									source_seq: sourceOf(oldSource).seq,
									transport: 'whatsapp',
									handle: `${CONTEXT_SENDER}@s.whatsapp.net`,
									occurred_at: DateTime.formatIso(DateTime.makeUnsafe(priorDisplay))
								}
							]
						})).kind
					).toBe('committed');
					expect((yield* setBoundary(t, t.admin, account.id, since(cutoff))).kind).toBe(
						'committed'
					);
					yield* t.receive(account.id, chat('fresh-context', NOW, NOW, CONTEXT_SENDER));
					const freshSource = required(
						pageOf(
							yield* admin.query({
								sys_message: {
									where: { text: { eq: 'fresh-context' } },
									fields: ['seq', 'conversation', 'thread']
								}
							}),
							'sys_message'
						).rows[0]
					);
					const context = yield* admin.act({
						'activities.create': [
							{
								kind: 'message',
								classification: 'ignored',
								subject: 'Manual context',
								detail: 'MANUAL_CONTEXT_RETAINED',
								source_key: account.id,
								thread_key: threadOf(freshSource),
								transport: 'whatsapp',
								handle: `${CONTEXT_SENDER}@s.whatsapp.net`,
								occurred_at: DateTime.formatIso(DateTime.makeUnsafe('2026-10-21T01:59:00Z'))
							}
						]
					});
					if (context.kind !== 'committed') throw new Error(JSON.stringify(context));
					expect(
						pageOf(
							yield* admin.query({
								activities: {
									where: { id: { eq: recordOf(context.records, 'activities').id } },
									limit: 1
								}
							}),
							'activities'
						).rows[0] ?? null
					).toMatchObject({ source_message: null, source_user: null });
					// the same thread on another account is never context
					yield* admin.act({
						'activities.create': [
							{
								kind: 'message',
								classification: 'useful',
								subject: 'Other account',
								detail: 'OTHER_ACCOUNT_CONTEXT',
								source_key: 'another-account',
								thread_key: threadOf(freshSource),
								transport: 'whatsapp',
								handle: `${CONTEXT_SENDER}@s.whatsapp.net`,
								occurred_at: DateTime.formatIso(DateTime.makeUnsafe('2026-10-21T01:59:30Z'))
							}
						]
					});
					expect(
						(yield* admin.act({
							'activities.create': [
								{
									kind: 'message',
									classification: 'pending',
									subject: 'Fresh message',
									detail: 'FRESH_ELIGIBLE_CONTEXT',
									source_message: sourceOf(freshSource).id,
									source_seq: sourceOf(freshSource).seq,
									transport: 'whatsapp',
									handle: `${CONTEXT_SENDER}@s.whatsapp.net`,
									occurred_at: DateTime.formatIso(DateTime.makeUnsafe(NOW))
								}
							]
						})).kind
					).toBe('committed');
					yield* admin.run('classify_messages', {}, JobResult);
					yield* t.run_due();
					// other tests' pending rows may be asked too: find this message's request
					const request = model.requests
						.slice(asked)
						.map((r) => JSON.stringify(r))
						.find((r) => r.includes('FRESH_ELIGIBLE_CONTEXT'));
					expect(request).toBeDefined();
					expect(request).toContain('MANUAL_CONTEXT_RETAINED');
					expect(request).not.toContain('PRE_BOUNDARY_RAW_SECRET');
					expect(request).not.toContain('OTHER_ACCOUNT_CONTEXT');
				})
		);
	}
);
