import { expect, it } from '@effect/vitest';
import { Ai, DecisionResult, type AiRequest } from '@norbital-ai/bolt/engine';
import { Effect, Layer, Schema, Stream } from 'effect';
import { workspace, member, recordOf, pageOf, targetOf } from './workspace.js';
import { personalAccount } from './personal-fixture.js';

it.live(
	'honors sys_integration.classifier modes, 30-message conversation window, and spawns a batched System Agent when needs_update fires',
	() =>
		Effect.gen(function* () {
			const seenDecisions: Parameters<Ai['Service']['ask']>[0][] = [];
			const seenAgentPrompts: string[] = [];
			const ports = Layer.succeed(Ai, {
				maxChoices: undefined,
				models: ['default'],
				catalog: Effect.succeed({ models: [{ id: 'default', label: 'Test' }], default: 'default' }),
				deciders: Effect.succeed({
					models: [{ id: 'default', label: 'Test' }],
					default: 'default'
				}),
				embed: () => Effect.die(new Error('unused')),
				ask: (request) =>
					Effect.gen(function* () {
						seenDecisions.push(request);
						const companyIds = Object.keys(
							request.questions['company']?.type === 'choice'
								? request.questions['company'].criteria
								: {}
						).filter((id) => id !== 'none');
						const projectIds = Object.keys(
							request.questions['project']?.type === 'choice'
								? request.questions['project'].criteria
								: {}
						).filter((id) => id !== 'none');
						const msgText = JSON.stringify(request.state);
						const actionable = msgText.includes('update stage to qualified');
						return yield* Schema.decodeUnknownEffect(DecisionResult)({
							provider: 'test',
							cost_usd: 0,
							answers: {
								relevance: {
									type: 'choice',
									choice: 'useful',
									confidence: 0.95,
									probabilities: {}
								},
								company: {
									type: 'choice',
									choice: companyIds[0] ?? 'none',
									confidence: 0.95,
									probabilities: {}
								},
								project: {
									type: 'choice',
									choice: projectIds[0] ?? 'none',
									confidence: 0.95,
									probabilities: {}
								},
								certainty: {
									type: 'score',
									score: 2,
									level: 2,
									confidence: 0.95,
									probabilities: {},
									legend: {}
								},
								needs_update: {
									type: 'noul',
									noul: actionable ? 0.9 : 0.1
								}
							}
						}).pipe(Effect.orDie);
					}),
				infer: (req: AiRequest) =>
					Stream.succeed({
						_tag: 'Response' as const,
						response: (() => {
							seenAgentPrompts.push(JSON.stringify(req.messages));
							return {
								content: 'Reviewed client update.',
								tool_calls: [],
								finish: 'stop' as const,
								usage: { input: 10, output: 10 }
							};
						})()
					})
			});

			const t = yield* workspace({ ports });
			const admin = yield* t.as(t.admin);
			const alice = yield* member(t, ['sales', 'crm'], { email: 'alice@example.test' });
			const bob = yield* member(t, ['sales', 'crm'], { email: 'bob@example.test' });

			const companyRes = yield* admin.act({ 'companies.create': [{ name: 'Acme Corp' }] });
			if (companyRes.kind !== 'committed') throw new Error(JSON.stringify(companyRes));
			const companyId = recordOf(companyRes.records, 'companies', 0).id;
			const projectRes = yield* admin.act({
				'projects.create': [{ name: 'Acme Portal', company_id: companyId }]
			});
			if (projectRes.kind !== 'committed') throw new Error(JSON.stringify(projectRes));

			const aliceMail = yield* personalAccount(t, alice, 'email');
			const bobMail = yield* personalAccount(t, bob, 'email');

			// Configure Alice's mailbox with custom classifier instructions; turn Bob's mailbox classifier off
			const aliceConfigured = yield* (yield* t.as(alice)).act({
				'sys_integration.update': [
					{
						target: yield* targetOf(t, 'sys_integration', aliceMail),
						set: {
							classifier: { mode: 'smart', instructions: 'Prioritize deployment questions.' }
						}
					}
				]
			});
			expect(aliceConfigured.kind).toBe('committed');
			const bobConfigured = yield* (yield* t.as(bob)).act({
				'sys_integration.update': [
					{
						target: yield* targetOf(t, 'sys_integration', bobMail),
						set: { classifier: { mode: 'off' } }
					}
				]
			});
			expect(bobConfigured.kind).toBe('committed');

			// Two sequential emails in Alice's thread (reactive sys_message trigger -> sync_messages -> classify_messages)
			yield* t.receive(aliceMail, {
				id: '<alice-1@example.test>',
				thread: 'acme-thread-1',
				sent_at: '2026-10-01T02:00:00Z',
				from: { address: 'buyer@acme.test', name: 'Buyer' },
				to: [{ address: 'alice@example.test', name: null }],
				subject: 'Deployment kickoff',
				text: 'First note about Acme Portal deployment.',
				headers: {}
			});
			yield* t.receive(aliceMail, {
				id: '<alice-2@example.test>',
				thread: 'acme-thread-1',
				sent_at: '2026-10-01T02:05:00Z',
				from: { address: 'buyer@acme.test', name: 'Buyer' },
				to: [{ address: 'alice@example.test', name: null }],
				subject: 'Re: Deployment kickoff',
				text: 'Approved budget — please update stage to qualified and set a follow-up.',
				headers: {}
			});
			// Bob's mailbox has classifier.mode = 'off' -> reactive sync_messages is gated off
			yield* t.receive(bobMail, {
				id: '<bob-1@example.test>',
				sent_at: '2026-10-01T02:06:00Z',
				from: { address: 'someone@other.test', name: null },
				to: [{ address: 'bob@example.test', name: null }],
				subject: 'Ignored while off',
				text: 'Should not sync when classifier is off',
				headers: {}
			});

			yield* t.run_due();
			yield* t.settled();

			// Bob's off connection synced 0 activities
			const bobItems = pageOf(
				yield* admin.query({ activities: { where: { source_user: { eq: bob.id } } } }),
				'activities'
			);
			expect(bobItems.rows).toHaveLength(0);

			// Alice's second message received connection instructions AND earlier thread message as contextOnly
			expect(seenDecisions.length).toBeGreaterThanOrEqual(2);
			const secondDecision = seenDecisions.find((req) =>
				JSON.stringify(req.state).includes('update stage to qualified')
			);
			expect(secondDecision).toBeDefined();
			expect(secondDecision).toMatchObject({
				state: { channel_classifier: 'Prioritize deployment questions.' }
			});
			const parsedState = Schema.decodeUnknownSync(
				Schema.Struct({
					earlier: Schema.Array(Schema.Struct({ text: Schema.String, contextOnly: Schema.Boolean }))
				})
			)(secondDecision?.state);
			expect(
				parsedState.earlier.some(
					(e) => e.text.includes('First note about Acme Portal') && e.contextOnly
				)
			).toBe(true);

			// Actionable needs_update message spawned a batched System Agent task conversation
			const taskConvs = yield* t.db.rows(Schema.Struct({ id: Schema.String }), {
				text: "SELECT id FROM sys_conversation WHERE kind = 'task'",
				params: []
			});
			expect(taskConvs.length).toBeGreaterThanOrEqual(1);
			expect(seenAgentPrompts.length).toBeGreaterThanOrEqual(1);
		}).pipe(Effect.scoped)
);
