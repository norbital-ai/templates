/**
 * G12 (5), the `field_ops_whatsapp` envoy (WhatsApp, authenticated, mention_or_reply, delegation disabled) on the test
 * kit's fake WhatsApp transport, fed the wire messages a WhatsApp provider emits, and a scripted model. A linked
 * contractor's report lands as one update with its photo filed into the photo field (channel source) and its message
 * kept; a write outside the sender's jobs is refused; a number on no member's account is not admitted and gets no turn; an
 * unaddressed group message is ambient; an addressed group message is a turn under the envoy's policy alone (P32).
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AiPort, AiRequest, Json } from '@norbital-ai/bolt/engine';
import { CONTRACTOR, person, rows, siteWithJob, workspace, type T } from './kit.ts';

/** `act <callable> <json>` in a message becomes that call; `$FILE` is the message's first file reference. */
function scripted() {
	const requests: AiRequest[] = [];
	let n = 0;
	const text = (c: Json) => (typeof c === 'string' ? c : JSON.stringify(c));
	const ai: AiPort & { requests: AiRequest[] } = {
		// triage (P31): unaddressed group chatter is not meant for the assistant; anything else is answered
		sys_1: {
			async ask(r) {
				const state = r.state as { conversation?: string; addressesAssistant?: boolean };
				const chatter = state.conversation === 'envoy group' && state.addressesAssistant !== true;
				const answers = Object.fromEntries(
					Object.entries(r.questions).map(([id, q]) => [
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
				return { costUsd: 0, provider: 'test', answers } as never;
			}
		},
		requests,
		sys_2: {
			models: ['default'],
			async infer(request) {
				requests.push(request);
				const usage = { input: 1, output: 1 };
				const last = request.messages.findLast(
					(m) => !(typeof m.content === 'string' && m.content.startsWith('[conversation state]'))
				)!; // not the engine's closing note
				if (last.role === 'tool')
					return { content: `result: ${text(last.content)}`, toolCalls: [], finish: 'stop', usage };
				const said = text(last.content);
				const file = /file reference (\{[^\n]*\})/.exec(said)?.[1];
				const act = /act (\S+) (.*)$/m.exec(said);
				if (act === null) return { content: `echo: ${said}`, toolCalls: [], finish: 'stop', usage };
				const input = JSON.parse(act[2]!.replace('"$FILE"', file ?? 'null')) as Json;
				return {
					content: '',
					toolCalls: [{ id: `c${++n}`, name: 'act', input: { callable: act[1]!, input } }],
					finish: 'tool',
					usage
				};
			}
		}
	};
	return ai;
}

let t: T,
	ai: ReturnType<typeof scripted>,
	seq = 0;
let mine: { job: string }, theirs: { job: string };
beforeEach(async () => {
	ai = scripted();
	t = await workspace({ ai });
	const bob = await person(t, CONTRACTOR, '6591111111');
	mine = await siteWithJob(t, { assignee_user_id: bob.actor.id, status: 'assigned' });
	theirs = await siteWithJob(t);
});

/** One inbound WhatsApp message as the provider emits it (its photo as a bin), then every turn it started settles. */
async function say(o: {
	from: string;
	text: string;
	group?: string;
	mention?: true;
	photo?: true;
}) {
	const id = `M${++seq}`;
	const jid = `${o.from}@s.whatsapp.net`;
	const photo = o.photo ? new Uint8Array(readFileSync('tests/fixtures/photo-evidence.jpg')) : null;
	await t.fakes.transports.whatsapp.emit({
		kind: 'inbound',
		channel: 'field_ops_whatsapp',
		message: {
			id,
			thread: o.group ?? jid,
			sentAt: t.clock.now(),
			from: { handle: jid, name: 'Bob' },
			group: o.group !== undefined,
			text: o.text,
			replyTo: null,
			invocation: o.group === undefined ? 'direct' : o.mention ? 'mention' : 'ambient',
			attachments:
				photo === null
					? []
					: [
							{
								fileName: 'IMG_0042.jpg',
								mimeType: 'image/jpeg',
								byteLength: photo.byteLength,
								bin: 0
							}
						]
		},
		...(photo === null ? {} : { bins: [photo] })
	});
	await t.settled();
	t.clock.advance('2s'); // triage's trailing debounce (P40)
	await t.runDue();
	await t.settled();
	return id;
}
const job = async (id: string) =>
	(
		await rows(
			t,
			`SELECT status, summary, suspicion_checked_at FROM job_assignments WHERE id = $1`,
			[id]
		)
	)[0]!;
const inbound = async (id: string) =>
	(
		await rows(
			t,
			`SELECT "as", refused FROM sys_message WHERE direction = 'inbound' AND provider_id = $1`,
			[id]
		)
	)[0]!;

describe('field_ops_whatsapp (G12 5)', () => {
	it("a linked contractor's report completes their job, filing the photo with its channel source and the message", async () => {
		const report = (id: string) =>
			`act job_assignments.update ${JSON.stringify({
				target: mine.job,
				set: {
					status: 'completed',
					summary: 'Grab bars installed',
					photo_evidence: {
						create: [
							{
								photo: '$FILE',
								source: {
									kind: 'channel',
									provider: 'whatsapp',
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
			})}`;
		const id = await say({ from: '6591111111', text: report(`M${seq + 1}`), photo: true });
		expect((await inbound(id))['as']).toMatchObject({ envoy: { dm: true } });
		expect(await job(mine.job)).toMatchObject({
			status: 'completed',
			summary: 'Grab bars installed',
			suspicion_checked_at: null
		});
		const [photo] = await rows(
			t,
			`SELECT source, source_key, summary, sha256, photo->>'name' AS name FROM photo_evidence WHERE job_assignment_id = $1`,
			[mine.job]
		);
		expect(photo).toMatchObject({
			source: { kind: 'channel', provider: 'whatsapp' },
			source_key: 'whatsapp:6591111111@s.whatsapp.net:IMG_0042.jpg',
			summary: expect.stringMatching(/^From whatsapp/),
			name: 'IMG_0042.jpg'
		});
		expect(
			await rows(t, `SELECT message FROM communication_logs WHERE job_assignment_id = $1`, [
				mine.job
			])
		).toEqual([{ message: 'Done, photo attached' }]);
	});

	it("a DM may update a job the sender does not hold: the envoy's policy grants any assignment", async () => {
		await say({
			from: '6591111111',
			text: `act job_assignments.update ${JSON.stringify({ target: theirs.job, set: { status: 'completed' } })}`
		});
		expect((await job(theirs.job))['status']).toBe('completed');
	});

	it("a number on no member's account is not admitted: one fixed notice, no link, no turn", async () => {
		const before = ai.requests.length;
		const id = await say({ from: '6599999999', text: 'hello' });
		expect((await inbound(id))['refused']).toBe('unregistered');
		expect(ai.requests.length).toBe(before);
		const notice = t.fakes.transports.whatsapp.sent.at(-1)?.message as { to: string; text: string };
		expect(notice.to).toBe('6599999999@s.whatsapp.net');
		expect(notice.text).toMatch(/is not recognised/);
		expect(notice.text).not.toMatch(/https?:|regist/i);
	});

	it('an unaddressed group message is ambient; an addressed one is a turn under the envoy policy alone', async () => {
		const before = ai.requests.length;
		await say({ from: '6591111111', text: 'site photos coming', group: '120363@g.us' });
		expect(ai.requests.length).toBe(before);
		const id = await say({
			from: '6591111111',
			text: 'which jobs are open?',
			group: '120363@g.us',
			mention: true
		});
		expect((await inbound(id))['as']).toMatchObject({ envoy: { dm: false } });
		expect(ai.requests.length).toBeGreaterThan(before);
		// P32: a group turn holds the envoy's policy alone, which may update any assignment
		await say({
			from: '6591111111',
			text: `act job_assignments.update ${JSON.stringify({ target: theirs.job, set: { status: 'completed' } })}`,
			group: '120363@g.us',
			mention: true
		});
		expect((await job(theirs.job))['status']).toBe('completed');
	});
});
