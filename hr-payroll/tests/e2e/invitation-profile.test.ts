import { expect, it } from '@effect/vitest';
import { Effect, Schema } from 'effect';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { workspace } from '../kit.ts';

class InvitationResponseFailed extends Schema.TaggedError<InvitationResponseFailed>()(
	'InvitationResponseFailed',
	{
		cause: Schema.Defect()
	}
) {}

it.live(
	'staff invitations provision profiles once and acceptance links the existing profile',
	() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = t.as(t.admin);
			yield* admin.query({ sys_user: {} }).pipe(Effect.map((answer) => answer.sys_user));
			const actor = admin.authority.actor;
			if (actor.kind !== 'member') throw new Error('The invitation administrator is not a member');
			const cookie = yield* t.session(actor.id);
			const emails = ['employee-0@example.com', 'employee-1@example.com'];
			const firstEmail = 'employee-0@example.com';
			const result = yield* t.handle(
				new Request('http://localhost/__bolt/shell/settings', {
					method: 'POST',
					headers: { 'content-type': 'application/json', cookie },
					body: JSON.stringify({
						op: 'inviteMany',
						input: { invitations: emails.map((email) => ({ email })) }
					})
				}),
				{ address: '203.0.113.9' }
			);
			expect(result.ok, 'Invitation batch returned ' + result.status).toBe(true);
			const external = yield* t.handle(
				new Request('http://localhost/__bolt/shell/settings', {
					method: 'POST',
					headers: { 'content-type': 'application/json', cookie },
					body: JSON.stringify({
						op: 'invite',
						input: { email: 'external@example.com', external: true }
					})
				}),
				{ address: '203.0.113.9' }
			);
			expect(external.ok).toBe(true);
			yield* t.runDue();
			const profiles = yield* admin
				.query({ employment_profile: {} })
				.pipe(Effect.map((answer) => answer.employment_profile));
			expect(profiles.rows.filter((row) => emails.includes(String(row.email)))).toHaveLength(2);
			expect(profiles.rows.some((row) => row.email === 'external@example.com')).toBe(false);
			expect(
				t.fakes.sent.filter((message) => message._tag === 'Mail' && emails.includes(message.to))
			).toHaveLength(2);
			const before = profiles.rows.find((row) => row.email === firstEmail);
			if (before === undefined) throw new Error('The first invited employment profile is absent');
			expect(before.user_id).toBeNull();
			const repeated = yield* t.handle(
				new Request('http://localhost/__bolt/shell/settings', {
					method: 'POST',
					headers: { 'content-type': 'application/json', cookie },
					body: JSON.stringify({ op: 'invite', input: { email: firstEmail } })
				}),
				{ address: '203.0.113.9' }
			);
			expect(repeated.ok).toBe(true);
			yield* t.runDue();
			expect(
				(yield* admin.query({
					employment_profile: {
						where: { email: { eq: firstEmail } }
					}
				})).employment_profile.rows
			).toHaveLength(1);
			const code = yield* t.handle(
				new Request('http://localhost/__bolt/session/code', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ address: firstEmail })
				}),
				{ address: '203.0.113.9' }
			);
			expect(code.ok).toBe(true);
			const accepted = yield* t.handle(
				new Request('http://localhost/__bolt/session/verify', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ address: firstEmail, code: '123456' })
				}),
				{ address: '203.0.113.9' }
			);
			const answer = yield* Effect.tryPromise({
				try: async (): Promise<unknown> => accepted.json(),
				catch: (cause) => new InvitationResponseFailed({ cause })
			});
			expect(
				accepted.ok,
				'Invitation acceptance returned ' + accepted.status + ': ' + JSON.stringify(answer)
			).toBe(true);
			const session = yield* Schema.decodeUnknownEffect(
				Schema.Struct({ value: Schema.Struct({ user: Schema.String }) })
			)(answer);
			yield* t.runDue();
			const after = yield* admin
				.query({
					employment_profile: {
						where: { email: { eq: firstEmail } }
					}
				})
				.pipe(Effect.map((answer) => answer.employment_profile));
			expect(after.rows).toHaveLength(1);
			const linked = after.rows[0];
			if (linked === undefined) throw new Error('The accepted employment profile is absent');
			expect(linked.id).toBe(before.id);
			expect(linked.user_id).toBe(session.value.user);
			const failed = yield* t.db.rows(Schema.Struct({ error: Schema.NullOr(Schema.Json) }), {
				text: "SELECT error FROM sys_run WHERE automation = 'invitation_profile' AND state = 'failed'",
				params: []
			});
			expect(failed).toEqual([]);
		}).pipe(Effect.provide(workspace({ now: '2026-10-13T00:00:00Z' })), Effect.scoped)
);
