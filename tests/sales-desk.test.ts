/**
 * G12 (4), the `sales_desk` envoy (Telegram, public, groups disabled, delegation enabled), on the test kit's Telegram
 * fake with a scripted model: an unlinked sender's DM runs as the envoy under its four policies alone, never as admin;
 * a linked staff member's DM holds those and the member's own authority; the 9th message a minute from one sender and
 * the 101st distinct sender an hour are limited; a group message makes no turn; a delegated sub-agent reports back.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { AiPort, AiRequest, Json } from '@norbital-ai/bolt/engine';
import { respondSystem1 } from '@norbital-ai/bolt/test';
import { DAVIN, workspace } from './kit.ts';

const text = (c: Json) => (typeof c === 'string' ? c : JSON.stringify(c));
/**
 * A message line `act <callable> <json>` becomes that `act` call; `delegate <task>` spawns a sub-agent; a sub-agent
 * (its first message is the task) reports `report: <task>`; after a tool result the turn ends with it.
 */
function scripted() {
	const requests: AiRequest[] = [];
	let n = 0;
	const ai: AiPort & { requests: AiRequest[] } = {
		sys_1: respondSystem1,
		requests,
		sys_2: {
			models: ['default'],
			async infer(request) {
				requests.push(request);
				const usage = { input: 1, output: 1 },
					last = request.messages.findLast(
						(m) => !(typeof m.content === 'string' && m.content.startsWith('[conversation state]'))
					)!; // not the engine's closing note
				if (last.role === 'tool')
					return { content: `result: ${text(last.content)}`, toolCalls: [], finish: 'stop', usage };
				const said = text(last.content);
				const task = /^task: (.*)$/m.exec(text(request.messages[0]!.content));
				if (
					task !== null &&
					requests.filter((r) => r === request).length === 1 &&
					!/^delegate /m.test(said)
				) {
					if (JSON.stringify(request.messages).includes('SUBTASK'))
						return { content: 'report: SUBTASK done', toolCalls: [], finish: 'stop', usage };
				}
				const act = /^(?:\[[^\]\n]*\] )?act (\S+) (.*)$/m.exec(said);
				if (act !== null)
					return {
						content: '',
						toolCalls: [
							{
								id: `c${++n}`,
								name: 'act',
								input: { callable: act[1]!, input: JSON.parse(act[2]!) }
							}
						],
						finish: 'tool',
						usage
					};
				const sub = /^(?:\[[^\]\n]*\] )?delegate (.*)$/m.exec(said);
				if (sub !== null)
					return {
						content: '',
						toolCalls: [
							{ id: `c${++n}`, name: 'subagent', input: { action: 'spawn', task: sub[1]! } }
						],
						finish: 'tool',
						usage
					};
				if (JSON.stringify(request.messages).includes('SUBTASK'))
					return { content: 'report: SUBTASK done', toolCalls: [], finish: 'stop', usage };
				return { content: `echo: ${said}`, toolCalls: [], finish: 'stop', usage };
			}
		}
	};
	return ai;
}

let t: Awaited<ReturnType<typeof workspace>>,
	ai: ReturnType<typeof scripted>,
	seq = 0;
beforeEach(async () => {
	ai = scripted();
	t = await workspace({ sample: true, ai });
	await t.db.write({ text: `UPDATE sys_user SET telegram = '555' WHERE id = $1`, params: [DAVIN] }); // Procurement
});
const say = async (from: string, message: string, over: { [k: string]: Json } = {}) => {
	await t.fakes.transports.telegram.emit({
		kind: 'inbound',
		channel: 'sales_desk',
		message: {
			id: `m${++seq}`,
			thread: from,
			sentAt: t.clock.now(),
			from: { handle: from, name: null },
			text: message,
			attachments: [],
			...over
		}
	});
	// triage (on wherever the host binds AI, P31) holds the row and queues its decision: one wake admits it
	await t.settled();
	t.clock.advance('2s'); // triage's trailing debounce (P40)
	await t.runDue();
	await t.settled();
};
const row = async (message: string) =>
	(
		await t.db.read([
			{
				text: `SELECT "as", refused, role FROM sys_message WHERE direction = 'inbound' AND text = $1`,
				params: [message]
			}
		])
	)[0]!.rows[0];
const count = async (c: string, where = '') =>
	Number(
		(await t.db.read([{ text: `SELECT count(*)::int AS n FROM ${c} ${where}`, params: [] }]))[0]!
			.rows[0]!['n']
	);
const supplier = (code: string) =>
	`act suppliers.create ${JSON.stringify({ external_code: code, code, name: code, active: true })}`;

describe('sales_desk (G12 4)', () => {
	it("an unlinked customer's DM runs as the envoy under its four policies alone", async () => {
		const [account] = (await t.as(t.admin).read('accounts', { limit: 1 })).rows;
		const activity = `act activities.create ${JSON.stringify({ regarding: { collection: 'accounts', id: account!.id }, subject: 'Called back', owner_id: DAVIN })}`;
		await say('777', activity);
		expect((await row(activity))!['as']).toEqual({
			envoy: { name: 'sales_desk', channel: 'sales_desk', sender: '777', member: null, dm: true }
		});
		expect(await count('activities', `WHERE subject = 'Called back'`)).toBe(1); // sales_rep grants it
		await say('777', supplier('S777'));
		expect(await count('suppliers', `WHERE code = 'S777'`)).toBe(0); // none of the four does
	});

	it("a linked staff member's DM holds the envoy's policies and the member's own; a write neither grants is refused", async () => {
		await say('555', supplier('S555'));
		expect((await row(supplier('S555')))!['as']).toMatchObject({
			envoy: { member: DAVIN, dm: true }
		});
		expect(await count('suppliers', `WHERE code = 'S555'`)).toBe(1); // Procurement's suppliers_manage
		const account = `act accounts.create ${JSON.stringify({ external_code: 'C555', name: 'Nobody', active: true })}`;
		await say('555', account);
		expect(await count('accounts', `WHERE external_code = 'C555'`)).toBe(0);
	});

	it('limits the 9th message a minute from one sender', async () => {
		for (let i = 1; i <= 9; i++) await say('888', `burst ${i}`);
		expect((await row('burst 8'))!['refused']).toBeNull();
		expect((await row('burst 9'))!['refused']).toBe('rateLimited');
	});

	it("limits the desk's 101st distinct sender in an hour (its turns are one actor's)", async () => {
		for (let i = 1; i <= 101; i++) {
			if (i % 50 === 0) t.clock.advance('1min'); // under the desk-wide 300 a minute
			await say(`9${i}`, `hello ${i}`);
		}
		expect((await row('hello 100'))!['refused']).toBeNull();
		expect((await row('hello 101'))!['refused']).toBe('rateLimited');
		t.clock.advance('1h');
		await say('9999', 'next hour');
		expect((await row('next hour'))!['refused']).toBeNull();
	});

	it('ignores group messages, and delegates to a sub-agent that reports back', async () => {
		const before = ai.requests.length;
		await say('777', 'chatter', { thread: '-100', group: true, invocation: 'mention' });
		expect(ai.requests).toHaveLength(before);
		expect((await row('chatter'))!['role']).toBeNull();
		await say('777', 'delegate SUBTASK: list my quotes');
		expect(ai.requests.some((r) => (r.tools ?? []).some((x) => x.name === 'subagent'))).toBe(true);
		expect(
			ai.requests.some((r) => JSON.stringify(r.messages).includes('report: SUBTASK done'))
		).toBe(true);
	});
});
