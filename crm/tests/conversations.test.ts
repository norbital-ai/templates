/** Client mail, WhatsApp and Telegram are filed under the contact they are with; an unknown sender waits in the inbox. */
import { describe, expect, it, layer } from '@effect/vitest';
import { TestWorkspace, JobResult } from '@norbital-ai/bolt-cli/test';
import {
	sharedWorkspace,
	member,
	recordAt,
	required,
	recordOf,
	pageOf,
	targetOf,
	nativeId,
	connectedAccount
} from './workspace.js';
import { Effect } from 'effect';
import type { Id } from '@norbital-ai/bolt';
import { personalAccount } from './personal-fixture.js';
import { handleKey, matchContact } from '../src/lib/conversations.js';
describe('matching a handle', () => {
	it.each([
		['Avery <AVERY@Example.test>', 'avery@example.test'],
		['whatsapp:+65 8123 4501', '6581234501'],
		['6581234501@s.whatsapp.net', '6581234501'],
		['6581234501:14@s.whatsapp.net', '6581234501'],
		['120363123456@g.us', null],
		['113377445566@lid', null],
		['telegram:@Avery_Lim', '@avery_lim'],
		['telegram:avery_lim', '@avery_lim'],
		['@Avery_Lim', '@avery_lim'],
		['telegram:5512345678', '@5512345678'],
		['slack:U012AB', 'slack:u012ab'],
		['discord:@81234501', 'discord:81234501'],
		['not a handle', null]
	])('%s → %s', (handle, key) => expect(handleKey(handle)).toBe(key));
	it('matches exactly one contact, never a shared number', () => {
		const a = {
			id: 'a',
			email_key: 'a@x.test',
			phone_key: '6581234501',
			telegram_key: '@avery',
			slack_key: 'slack:u012ab',
			discord_key: null
		};
		const b = {
			id: 'b',
			email_key: null,
			phone_key: '6581234501',
			telegram_key: null,
			slack_key: null,
			discord_key: 'discord:6581234501'
		};
		expect(matchContact('A@X.test', [a, b])).toBe(a);
		expect(matchContact('telegram:@Avery', [a, b])).toBe(a);
		expect(matchContact('telegram:6581234501', [a, b])).toBeNull();
		expect(matchContact('slack:U012AB', [a, b])).toBe(a);
		// a Discord id is never read as a phone number
		expect(matchContact('discord:6581234501', [a, b])).toBe(b);
		expect(matchContact('whatsapp:+6581234501', [a, b])).toBeNull();
		expect(matchContact('someone@else.test', [a, b])).toBeNull();
	});
});
// One workspace: each test reads only its own source's rows.
layer(sharedWorkspace({ now: '2026-10-01T02:00:00Z' }), { excludeTestServices: true })(
	'conversations',
	(it) => {
		it.effect(
			'files inbound mail under the contact and leaves strangers in the inbox for explicit assignment',
			() =>
				Effect.gen(function* () {
					const t = yield* TestWorkspace;
					const admin = yield* t.as(t.admin);
					const company = yield* admin.act({
						'companies.create': [{ name: 'Lumen Learning Centre' }]
					});
					if (company.kind !== 'committed') throw new Error(JSON.stringify(company));
					const companyId = recordOf(company.records, 'companies', 0).id;
					const contact = yield* admin.act({
						'contacts.create': [
							{
								full_name: 'Aaron Lim',
								email: 'Aaron.Lim@example.test',
								phone: '+65 8123 4506',
								company_id: companyId
							}
						]
					});
					if (contact.kind !== 'committed') throw new Error(JSON.stringify(contact));
					const aaron = recordOf(contact.records, 'contacts', 0).id;
					const at = t.clock.now();
					const sales = yield* member(t, ['sales', 'crm']);
					const mailbox = yield* personalAccount(t, sales, 'email');
					yield* t.receive(mailbox, [
						{
							id: '<m1@example.test>',
							sent_at: at,
							from: { address: 'aaron.lim@example.test', name: 'Aaron Lim' },
							to: [{ address: 'hq@norbital.test', name: null }],
							subject: 'Pilot timetable',
							text: 'Here is the sample timetable.',
							headers: {}
						},
						{
							id: '<m2@example.test>',
							sent_at: at,
							from: { address: 'someone@unknown.test', name: 'Someone' },
							to: [{ address: 'hq@norbital.test', name: null }],
							subject: 'Partnership',
							text: 'Hello.',
							headers: {}
						}
					]);
					yield* admin.run('sync_messages', {}, JobResult);
					t.clock.advance('5min');
					yield* t.run_due();
					const { rows } = pageOf(
						yield* admin.query({
							activities: { where: { source_user: { eq: sales.id } }, order_by: { subject: 'asc' } }
						}),
						'activities'
					);
					expect(
						rows.map((r) => [r['transport'], r['subject'], r['contact_id'], r['company']])
					).toEqual([
						['email', 'Partnership', null, null],
						['email', 'Pilot timetable', aaron, companyId]
					]);
					// Logs allow explicit assignment without a review queue.
					const stranger = nativeId(
						'activities',
						required(rows.find((r) => r['subject'] === 'Partnership')).id
					);
					expect(
						(yield* admin.act({
							'activities.update': [
								{ target: yield* targetOf(t, 'activities', stranger), set: { contact_id: aaron } }
							]
						})).kind
					).toBe('committed');
					expect(
						pageOf(
							yield* admin.query({ activities: { where: { id: { eq: stranger } }, limit: 1 } }),
							'activities'
						).rows[0] ?? null
					).toMatchObject({
						contact_id: aaron,
						company: companyId
					});
				})
		);
		it.effect('replies only through the workspace connection the conversation is on', () =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const admin = yield* t.as(t.admin);
				const chat = {
					thread: '6581234506@s.whatsapp.net',
					sent_at: t.clock.now(),
					from: { handle: '6581234506@s.whatsapp.net', name: 'Aaron' },
					text: 'Call at 3?',
					attachments: []
				};
				// two workspace numbers (no owner) and a sales member's own phone
				const mainLine = yield* connectedAccount(t, 'whatsapp', 'Main line');
				const supportLine = yield* connectedAccount(t, 'whatsapp', 'Support line');
				const sales = yield* member(t, ['sales', 'crm']);
				const phone = yield* personalAccount(t, sales, 'whatsapp');
				yield* t.receive(mainLine, { ...chat, id: 'on-main-line' });
				yield* t.receive(supportLine, { ...chat, id: 'on-support-line' });
				yield* t.receive(phone, { ...chat, id: 'on-personal-phone' });
				const thread = Effect.fnUntraced(function* (integration: Id<'sys_integration'>) {
					const message = pageOf(
						yield* admin.query({
							sys_message: { where: { integration: { eq: integration } }, fields: ['conversation'] }
						}),
						'sys_message'
					).rows[0];
					if (message === undefined) throw new Error('The received source message is missing.');
					const created = yield* admin.act({
						'activities.create': [
							{
								kind: 'message',
								subject: 'Call',
								handle: chat.from.handle,
								source_message: nativeId('sys_message', message.id)
							}
						]
					});
					if (created.kind !== 'committed') throw new Error(JSON.stringify(created));
					return {
						activity: recordOf(created.records, 'activities', 0).id,
						conversation: message['conversation']
					};
				});
				for (const line of [mainLine, supportLine]) {
					const on = yield* thread(line);
					yield* admin.run(
						'send_message',
						{ activity: on.activity, text: 'Yes, 3pm works.' },
						JobResult
					);
					yield* t.run_due();
					expect(t.fakes.links.sent.at(-1)).toMatchObject({
						instance: line,
						message: { text: 'Yes, 3pm works.' }
					});
					const [reply] = pageOf(
						yield* admin.query({
							sys_message: {
								where: { integration: { eq: line }, direction: { eq: 'outbound' } },
								fields: ['conversation']
							}
						}),
						'sys_message'
					).rows;
					expect(reply?.['conversation']).toBe(on.conversation);
				}
				// a member's own phone synchronizes messages; it never sends a reply
				const personal = yield* thread(phone);
				yield* admin.run(
					'send_message',
					{ activity: personal.activity, text: 'Wrong line.' },
					JobResult
				);
				yield* t.run_due();
				expect(t.fakes.links.sent).toHaveLength(2);
				const [failed] = recordAt(
					yield* t.db.read([
						{
							text: "SELECT error FROM sys_run WHERE automation = 'send_message' AND state = 'failed'",
							params: []
						}
					]),
					0
				).rows;
				expect(JSON.stringify(failed?.['error'])).toContain(
					'Personal connections synchronize messages; they do not send replies.'
				);
			})
		);
	}
);
