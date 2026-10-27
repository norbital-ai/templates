import { present } from './test-runtime.js';
import { Schema, Effect, Layer, Stream } from 'effect';
/**
 * G12 (5), the `field_ops_whatsapp` envoy (WhatsApp, private, mention_or_reply, delegation disabled) on its named
 * instance over the test kit's fake WhatsApp link, fed the wire messages a WhatsApp provider emits, and a scripted model.
 * A linked contractor's report lands as one update with its photo filed into the photo field (message source) and its
 * message kept; the envoy's policy lets a DM update any assignment; a number on no member's account is not admitted and
 * gets no turn; an unaddressed group message is ambient; a mention or a reply is a turn under the envoy's policy alone
 * (P32); the policy's `envoys.receive` limit answers a flood once.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from '@effect/vitest';
import {
	Ai,
	Metering,
	Port,
	type AiRequest,
	type AiResponse,
	type DecisionAnswer,
	type DecisionResult,
	type Json
} from '@norbital-ai/bolt/engine';
import { CONTRACTOR, person, rows, siteWithJob, workspace, type T } from './kit.ts';
import { fixtureId } from './test-runtime.js';
/** `act <callable> <json batch>` in a message becomes that call; `$FILE` is the message's first file reference. */
function scripted() {
	const requests: AiRequest[] = [];
	let n = 0;
	const text = (c: Json) => (typeof c === 'string' ? c : JSON.stringify(c));
	const state = Schema.Struct({
		conversation: Schema.optionalKey(Schema.String),
		addressesAssistant: Schema.optionalKey(Schema.Boolean)
	});
	const ai: Ai['Service'] = {
		// triage (P31): unaddressed group chatter is not meant for the assistant; anything else is answered
		ask: (r) =>
			Effect.sync((): DecisionResult => {
				const decoded = Schema.decodeUnknownSync(state)(r.state);
				const chatter =
					decoded.conversation === 'envoy group' && decoded.addressesAssistant !== true;
				const answers = Object.fromEntries(
					Object.entries(r.questions).map(([id, q]): [string, DecisionAnswer] => [
						id,
						q.type === 'choice'
							? {
									type: 'choice',
									choice: chatter ? 'ignore' : 'respond',
									confidence: 1,
									probabilities: {}
								}
							: q.type === 'score'
								? {
										type: 'score',
										score: 0,
										level: 0,
										confidence: 1,
										probabilities: {},
										legend: {}
									}
								: { type: 'noul', noul: 0 }
					])
				);
				return { costUsd: 0, provider: 'test', answers };
			}),
		maxChoices: undefined,
		models: ['default'],
		catalog: Port.unavailable('ai'),
		embed: (inputs, _model, dimensions = 1536) =>
			Effect.succeed(
				inputs.map(() => Array.from({ length: dimensions }, (_, index) => (index === 0 ? 1 : 0)))
			),
		infer: (request) =>
			Stream.fromEffect(
				Effect.sync((): AiResponse => {
					requests.push(request);
					const usage = { input: 1, output: 1, cost: 0, call: `field-fixture-${requests.length}` };
					if (request.tools?.some((tool) => tool.name === 'submit'))
						return {
							content: {
								suspicious: false,
								reason: 'No suspicious evidence in this fixture.',
								evidence_asset_name: ''
							},
							toolCalls: [],
							finish: 'stop',
							usage
						};
					const last = request.messages.findLast(
						(m) => !(typeof m.content === 'string' && m.content.startsWith('[conversation state]'))
					); // not the engine's closing note
					if (last === undefined) throw new Error('Missing conversation message');
					if (last.role === 'tool')
						return {
							content: `result: ${text(last.content)}`,
							toolCalls: [],
							finish: 'stop',
							usage
						};
					const said = text(last.content);
					const file = /file reference (\{[^\n]*\})/.exec(said)?.[1];
					const act = /act (\S+) (.*)$/m.exec(said);
					if (act === null)
						return { content: `echo: ${said}`, toolCalls: [], finish: 'stop', usage };
					const callable = act[1],
						body = act[2];
					if (callable === undefined || body === undefined)
						throw new Error('Missing scripted action');
					const input = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(
						body.replace('"$FILE"', file ?? 'null')
					);
					return {
						content: '',
						toolCalls: [{ id: `c${++n}`, name: 'act', input: { callable, input } }],
						finish: 'tool',
						usage
					};
				})
			).pipe(Stream.map((response) => ({ _tag: 'Response' as const, response })))
	};
	return {
		requests,
		layer: Layer.merge(
			Layer.succeed(Ai, ai),
			Layer.succeed(Metering, { record: () => Effect.void })
		)
	};
}
let t: T,
	ai: ReturnType<typeof scripted>,
	seq = 0;
let mine: Effect.Success<ReturnType<typeof siteWithJob>>,
	theirs: Effect.Success<ReturnType<typeof siteWithJob>>;
const setup = Effect.fnUntraced(function* () {
	ai = scripted();
	t = yield* workspace({ ports: ai.layer });
	const bob = yield* person(t, CONTRACTOR, '6591111111');
	mine = yield* siteWithJob(t, { assignee_user_id: fixtureId('sys_user', bob.id) });
	theirs = yield* siteWithJob(t);
	// Creation reviews are separate from the inbound envoy turn counted by each scenario.
	yield* t.runDue();
	yield* t.settled();
});
const say = Effect.fnUntraced(function* (o: {
	from: string;
	text: string;
	group?: string;
	mention?: true;
	reply?: true;
	photo?: true;
}) {
	const id = `M${++seq}`;
	const jid = `${o.from}@s.whatsapp.net`;
	const photo = o.photo ? new Uint8Array(readFileSync('tests/fixtures/photo-evidence.jpg')) : null;
	yield* t.receive(
		'field_ops_whatsapp',
		[
			{
				id,
				thread: o.group ?? jid,
				sentAt: t.clock.now(),
				from: { handle: jid, name: 'Bob' },
				group: o.group !== undefined,
				text: o.text,
				replyTo: null,
				invocation:
					o.group === undefined ? 'direct' : o.mention ? 'mention' : o.reply ? 'reply' : 'ambient',
				attachments:
					photo === null
						? []
						: [
								{
									name: 'IMG_0042.jpg',
									mime: 'image/jpeg',
									bytes: photo.byteLength,
									bin: 0
								}
							]
			}
		],
		photo === null ? {} : { bins: [photo] }
	);
	yield* t.runDue();
	yield* t.settled();
	t.clock.advance('2s'); // triage's trailing debounce (P40)
	yield* t.runDue();
	yield* t.settled();
	return id;
});
const job = Effect.fnUntraced(function* (id: string) {
	return present(
		(yield* rows(
			t,
			`SELECT status, summary, suspicion_checked_at FROM job_assignments WHERE id = $1`,
			[id]
		))[0]
	);
});
const inbound = Effect.fnUntraced(function* (id: string) {
	return present(
		(yield* rows(
			t,
			`SELECT "as", refused FROM sys_message WHERE direction = 'inbound' AND provider_id = $1`,
			[id]
		))[0]
	);
});
describe('field_ops_whatsapp (G12 5)', () => {
	it.live(
		"a linked contractor's report completes their job, filing the photo with its message source and the message",
		() =>
			Effect.gen(function* () {
				yield* setup();
				const report = (id: string) =>
					`act job_assignments.update ${JSON.stringify([
						{
							target: mine.job,
							set: {
								status: 'completed',
								summary: 'Grab bars installed',
								photo_evidence: {
									create: [
										{
											photo: '$FILE',
											source: {
												kind: 'message',
												integration: 'whatsapp',
												conversation_id: '6591111111@s.whatsapp.net',
												message_id: id,
												attachment_id: 'IMG_0042.jpg',
												sender_id: '6591111111@s.whatsapp.net'
											}
										}
									]
								},
								communication_logs: {
									create: [
										{
											message: 'Done, photo attached',
											sent_at: '2026-09-25T10:00:00.000Z',
											sender: '6591111111@s.whatsapp.net',
											source_message_id: id
										}
									]
								}
							}
						}
					])}`;
				const id = yield* say({ from: '6591111111', text: report(`M${seq + 1}`), photo: true });
				expect((yield* inbound(id)).as).toMatchObject({
					envoy: { name: 'field_ops_whatsapp', instance: 'field_ops_whatsapp', dm: true }
				});
				expect(yield* job(mine.job)).toMatchObject({
					status: 'completed',
					summary: 'Grab bars installed'
				});
				const [photo] = yield* rows(
					t,
					`SELECT source, source_key, summary, sha256, photo->>'name' AS name FROM photo_evidence WHERE job_assignment_id = $1`,
					[mine.job]
				);
				expect(photo).toMatchObject({
					source: { kind: 'message', integration: 'whatsapp' },
					source_key: 'whatsapp:6591111111@s.whatsapp.net:IMG_0042.jpg',
					summary: expect.stringMatching(/^From whatsapp/),
					name: 'IMG_0042.jpg'
				});
				expect(
					yield* rows(t, `SELECT message FROM communication_logs WHERE job_assignment_id = $1`, [
						mine.job
					])
				).toEqual([{ message: 'Done, photo attached' }]);
			})
	);
	it.live(
		"a DM may update a job the sender does not hold: the envoy's policy grants any assignment",
		() =>
			Effect.gen(function* () {
				yield* setup();
				yield* say({
					from: '6591111111',
					text: `act job_assignments.update ${JSON.stringify([{ target: theirs.job, set: { status: 'completed' } }])}`
				});
				expect((yield* job(theirs.job)).status).toBe('completed');
			})
	);
	it.live(
		"a number on no member's account is not admitted: one fixed notice, no link, no turn",
		() =>
			Effect.gen(function* () {
				yield* setup();
				const before = ai.requests.length;
				const id = yield* say({ from: '6599999999', text: 'hello' });
				expect((yield* inbound(id)).refused).toBe('unregistered');
				expect(ai.requests.length).toBe(before);
				const notice = t.fakes.links.sent.findLast(
					(entry) => entry.instance === 'field_ops_whatsapp'
				)?.message;
				const decoded = Schema.decodeUnknownSync(
					Schema.Struct({ to: Schema.String, text: Schema.String })
				)(notice);
				expect(decoded.to).toBe('6599999999@s.whatsapp.net');
				expect(decoded.text).toMatch(/is not recognised/);
				expect(decoded.text).not.toMatch(/https?:|regist/i);
			})
	);
	it.live(
		'an unaddressed group message is ambient; an addressed one is a turn under the envoy policy alone',
		() =>
			Effect.gen(function* () {
				yield* setup();
				const before = ai.requests.length;
				yield* say({ from: '6591111111', text: 'site photos coming', group: '120363@g.us' });
				expect(ai.requests.length).toBe(before);
				const id = yield* say({
					from: '6591111111',
					text: 'which jobs are open?',
					group: '120363@g.us',
					mention: true
				});
				expect((yield* inbound(id)).as).toMatchObject({ envoy: { dm: false } });
				expect(ai.requests.length).toBeGreaterThan(before);
				// P32: a group turn holds the envoy's policy alone, which may update any assignment
				yield* say({
					from: '6591111111',
					text: `act job_assignments.update ${JSON.stringify([{ target: theirs.job, set: { status: 'completed' } }])}`,
					group: '120363@g.us',
					mention: true
				});
				expect((yield* job(theirs.job)).status).toBe('completed');
			})
	);
	it.live("a reply to the envoy's message in a group is a turn, as a mention is", () =>
		Effect.gen(function* () {
			yield* setup();
			const before = ai.requests.length;
			const id = yield* say({
				from: '6591111111',
				text: 'is the Kismis job still open?',
				group: '120363@g.us',
				reply: true
			});
			expect((yield* inbound(id)).as).toMatchObject({
				envoy: { name: 'field_ops_whatsapp', instance: 'field_ops_whatsapp', dm: false }
			});
			expect(ai.requests.length).toBeGreaterThan(before);
		})
	);
	it.live(
		"the policy's envoys.receive limit (30 a minute per sender) answers a flood once and admits no more",
		() =>
			Effect.gen(function* () {
				yield* setup();
				const jid = '6591111111@s.whatsapp.net';
				yield* t.receive(
					'field_ops_whatsapp',
					Array.from({ length: 32 }, (_, n) => ({
						id: `F${n + 1}`,
						thread: jid,
						sentAt: t.clock.now(),
						from: { handle: jid, name: 'Bob' },
						group: false,
						text: `update ${n + 1}`,
						replyTo: null,
						invocation: 'direct',
						attachments: []
					}))
				);
				yield* t.runDue();
				yield* t.settled();
				const count = Effect.fnUntraced(function* (where: string) {
					return present(
						(yield* rows(
							t,
							`SELECT count(*)::int AS n FROM sys_message WHERE direction = 'inbound' AND ${where}`
						))[0]
					).n;
				});
				expect(yield* count(`refused = 'rateLimited'`)).toBe(2);
				expect(yield* count(`"as" #>> '{envoy,name}' = 'field_ops_whatsapp'`)).toBe(30);
				const limited = t.fakes.links.sent.filter(
					(entry) =>
						entry.instance === 'field_ops_whatsapp' &&
						/faster than I can answer/.test(
							Schema.decodeUnknownSync(Schema.Struct({ text: Schema.String }))(entry.message).text
						)
				);
				expect(limited).toHaveLength(1);
				expect(
					Schema.decodeUnknownSync(Schema.Struct({ to: Schema.String }))(limited[0]?.message).to
				).toBe(jid);
			})
	);
});
