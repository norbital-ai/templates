import {
	workspace,
	workspaceServices,
	member,
	wireAct,
	recordOf,
	instance_id,
	pageOf,
	targetOf,
	connectedAccount
} from './workspace.js';
import { Context, Effect, Predicate } from 'effect';
import { TestWorkspace, JobResult } from '@norbital-ai/bolt-cli/test';
import { expect, it } from '@effect/vitest';
import type { Json, Provider } from '@norbital-ai/bolt/engine';
import { personalAccount } from './personal-fixture.js';

/** A personal-sync provider of `driver` that pairs on `{ account }` and delivers one history message once paired. */
const provider = (driver: 'email' | 'whatsapp', history: Json): Provider => ({
	driver,
	personal: true,
	id: `fake-${driver}`,
	label: `Fake ${driver}`,
	setup: { kind: 'form', steps: [], fields: [{ name: 'account', label: 'Account' }] },
	async open(ctx) {
		return {
			async pair(input) {
				const account = Predicate.isObject(input) ? input['account'] : undefined;
				if (typeof account !== 'string') throw new Error('an account is required');
				await ctx.credentials.write(new Map([['credential', { account }]]));
				await ctx.status({ state: 'connected', account });
				await ctx.emit({ kind: 'messages', messages: [history], history: true });
			},
			async close() {}
		};
	}
});
const providers = [
	provider('whatsapp', {
		id: 'w1',
		thread: '6581234506@s.whatsapp.net',
		sent_at: '2026-10-01T01:00:00Z',
		from: { handle: '6581234506@s.whatsapp.net', name: 'Aaron' },
		text: 'Call at 3?',
		attachments: []
	}),
	provider('email', {
		id: '<m1@example.test>',
		sent_at: '2026-10-01T01:00:00Z',
		from: { address: 'aaron@example.test', name: 'Aaron' },
		to: [{ address: 'alice@norbital.test', name: null }],
		subject: 'Pilot timetable',
		text: 'Here is the timetable.',
		headers: {}
	})
];
it.live(
	'a sales member connects and pairs their own WhatsApp and mailbox; a colleague neither sees nor manages them',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace({ now: '2026-10-01T02:00:00Z', providers });
			const alice = yield* member(t, ['sales', 'crm'], { email: 'alice@norbital.test' });
			const bob = yield* member(t, ['sales', 'crm'], { email: 'bob@norbital.test' });
			const phone = yield* personalAccount(t, alice, 'whatsapp');
			const mailbox = yield* personalAccount(t, alice, 'email');
			for (const [instance, account] of [
				[phone, '+6591110000'],
				[mailbox, 'alice@norbital.test']
			] as const) {
				// the pair verb authorizes as "may update this row": the owner's grant
				expect(yield* t.integrations.may(alice, instance)).toBe(true);
				expect(yield* t.integrations.may(bob, instance)).toBe(false);
				yield* t.integrations.pair(instance, { account });
				expect(
					pageOf(
						yield* (yield* t.as(alice)).query({
							sys_integration: { where: { id: { eq: instance } }, limit: 1 }
						}),
						'sys_integration'
					).rows[0] ?? null
				).toMatchObject({ owner: alice.id, status: { state: 'connected', account } });
			}
			// a workspace connection is no member's to manage
			expect(
				yield* t.integrations.may(alice, yield* connectedAccount(t, 'email', 'Client mailbox'))
			).toBe(false);

			// the paired accounts' history is filed under their member
			yield* t.run_due();
			yield* (yield* t.as(t.admin)).run('sync_messages', {}, JobResult);
			yield* t.run_due();
			const filed = pageOf(
				yield* (yield* t.as(t.admin)).query({
					activities: { fields: ['source_user', 'source_key', 'transport'] }
				}),
				'activities'
			);
			expect(filed.rows.map((r) => [r.source_key, r.transport, r.source_user]).sort()).toEqual(
				[
					[phone, 'whatsapp', alice.id],
					[mailbox, 'email', alice.id]
				].sort()
			);
			// a colleague's personal accounts are not readable, and neither are the workspace's connections
			expect(
				pageOf(yield* (yield* t.as(bob)).query({ sys_integration: {} }), 'sys_integration').rows
			).toEqual([]);
			expect(
				pageOf(
					yield* (yield* t.as(bob)).query({
						sys_integration: { where: { id: { eq: phone } }, limit: 1 }
					}),
					'sys_integration'
				).rows[0] ?? null
			).toBeNull();
			expect(
				pageOf(
					yield* (yield* t.as(alice)).query({ sys_integration: { fields: ['name'] } }),
					'sys_integration'
				)
					.rows.map((r) => r.id)
					.sort()
			).toEqual([phone, mailbox].sort());
		}).pipe(Effect.scoped)
);
it.live(
	'a sales member manages only their own accounts: no colleague’s, no workspace connection, no envoy',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const alice = yield* member(t, ['sales', 'crm']);
			const bob = yield* member(t, ['sales', 'crm']);
			const as = yield* t.as(alice);
			const phone = yield* personalAccount(t, alice, 'whatsapp');
			expect(
				yield* Effect.flip(
					as.act({
						'sys_integration.create': [
							{
								integration: 'whatsapp',
								name: 'Bob',
								owner: bob.id
							}
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(
				yield* Effect.flip(
					as.act({ 'sys_integration.create': [{ integration: 'whatsapp', name: 'Workspace' }] })
				)
			).toMatchObject({ _tag: 'ActRefused' });
			const shared = yield* connectedAccount(t, 'email', 'Client mailbox');
			expect(
				yield* Effect.flip(
					wireAct(t, alice, 'sys_integration.update', [
						{ target: yield* targetOf(t, 'sys_integration', shared), set: { name: 'Mine now' } }
					])
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(
				yield* Effect.flip(
					wireAct(t, alice, 'sys_integration.update', [
						{ target: yield* targetOf(t, 'sys_integration', phone), set: { owner: null } }
					])
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(
				yield* Effect.flip(
					(yield* t.as(bob)).act({
						'sys_integration.update': [
							{ target: yield* targetOf(t, 'sys_integration', phone), set: { active: false } }
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(
				(yield* as.act({
					'sys_integration.update': [
						{ target: yield* targetOf(t, 'sys_integration', phone), set: { name: 'Work phone' } }
					]
				})).kind
			).toBe('committed');
		}).pipe(Effect.scoped)
);
it.live('a member owns one Google Calendar account, and only a member’s own account imports', () =>
	Effect.gen(function* () {
		const services = yield* workspaceServices();
		const t = Context.get(services, TestWorkspace);
		const alice = yield* member(t, ['sales', 'crm']);
		const created = yield* (yield* t.as(alice)).act({
			'sys_integration.create': [
				{
					integration: 'google_calendar',
					name: 'Google Calendar',
					owner: alice.id
				}
			]
		});
		if (created.kind !== 'committed') throw new Error(JSON.stringify(created));
		const first = yield* instance_id(
			yield* t.as(alice),
			'google_calendar',
			recordOf(created.records, 'sys_integration', 0).id
		);
		expect(yield* Effect.flip(instance_id(yield* t.as(alice), 'email', first))).toMatchObject({
			_tag: 'SchemaError'
		});
		// one per member: the data refuses a second
		expect(
			yield* Effect.flip(
				(yield* t.as(alice)).act({
					'sys_integration.create': [
						{
							integration: 'google_calendar',
							name: 'Another calendar',
							owner: alice.id
						}
					]
				})
			)
		).toMatchObject({ _tag: 'ActRefused' });
		// the definition's default selects the primary calendar
		expect(
			pageOf(
				yield* (yield* t.as(alice)).query({
					sys_integration: { where: { id: { eq: first } }, limit: 1 }
				}),
				'sys_integration'
			).rows[0] ?? null
		).toMatchObject({
			configuration: { calendars: ['primary'] }
		});
		// a personal-only integration (`scope: 'personal'`) refuses an unowned workspace instance even as admin
		expect(
			yield* Effect.flip(
				(yield* t.as(t.admin)).act({
					'sys_integration.create': [
						{
							integration: 'google_calendar',
							name: 'Shared'
						}
					]
				})
			)
		).toMatchObject({ _tag: 'ActRefused' });
		// alice's own calendar imports cleanly
		t.fakes.links.page = Effect.fnUntraced(function* () {
			return {
				items: [
					{
						id: 'event-1',
						summary: 'Visit',
						description: null,
						location: null,
						url: null,
						status: 'confirmed',
						start: { date: '2026-10-13' },
						end: { date: '2026-10-14' },
						source: { id: 'event-1' }
					}
				],
				cursor: 'c1',
				more: false
			};
		});
		yield* t.syncs.read('calendar_entries.sync.google_calendar');
		const entries = pageOf(
			yield* (yield* t.as(t.admin)).query({
				calendar_entries: { fields: ['account', 'source_user'] }
			}),
			'calendar_entries'
		);
		expect(entries.rows.map((r) => [r.account, r.source_user])).toEqual([[first, alice.id]]);
	}).pipe(Effect.scoped)
);
