import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAiBinding } from '@norbital-ai/bolt-server';
import { asRecord, bearerHeaders, postGuestCommand, rowsOf } from '@norbital-ai/test-utilities';
import { bootPublicSeedGuest, PUBLIC_ASSIGNMENT_ID } from './helpers/public-seed-guest.js';

test(
	'overlapping reviews respect the checked-row policy and preserve the winning audit',
	{ timeout: 90_000 },
	async () => {
		const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
		const started = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
		let calls = 0;
		const ai = makeAiBinding({
			call: async (_metadata, request) => {
				assert.equal(request._tag, 'Generate');
				if (request._tag !== 'Generate') throw new Error('Expected a review generation');
				const turn = calls++;
				assert.ok(gates[turn], 'Each of the two runs infers exactly once.');
				started[turn].resolve();
				await gates[turn].promise;
				return {
					_tag: 'Generated',
					result: {
						_tag: 'Object',
						value: {
							job_site_review: {
								suspicious: false,
								reason: `Review ${turn}`,
								evidence_asset_name: ''
							},
							similar_photo_reviews: []
						}
					},
					observation: {
						callId: request.callId,
						provider: 'fixture',
						model: request.modelId,
						operation: 'language',
						charge: { currency: 'USD', coefficient: '125', scale: 6 },
						chargeSource: 'provider'
					}
				};
			}
		});
		const session = await bootPublicSeedGuest({
			tenantId: 'review-overlap',
			releaseId: 'review-overlap',
			gatewaySecret: 'review-overlap-gateway',
			founderEmail: 'review-overlap@example.test',
			founderClaimId: 'review-overlap-founder',
			secretsKey: 'review-overlap-secrets',
			invocationTimeoutMillis: 30_000,
			ai
		});
		const pending: ReturnType<typeof postGuestCommand>[] = [];
		const command = (name: string, input: Record<string, unknown>) =>
			postGuestCommand(session.baseUrl, name, input, bearerHeaders(session.credential));
		try {
			for (let turn = 0; turn < 2; turn++) {
				const run = command('automations.start', {
					name: 'review_job_assignment_suspicion',
					input: { assignment_id: PUBLIC_ASSIGNMENT_ID }
				});
				pending.push(run);
				await Promise.race([
					started[turn].promise,
					run.then((result) =>
						assert.fail(`Run ended before reaching inference: ${JSON.stringify(result)}`)
					)
				]);
			}
			gates[0].resolve();
			const winner = await pending[0];
			assert.equal(winner.status, 200, JSON.stringify(winner.value));
			assert.equal(
				asRecord(asRecord(winner.value, 'winner').result, 'winner result').failure_count,
				0
			);
			const before = rowsOf(
				(
					await command('collections.findMany', {
						collection: 'job_assignments',
						where: { id: { eq: PUBLIC_ASSIGNMENT_ID } },
						limit: 1
					})
				).value,
				'checked assignment'
			)[0];
			assert.equal(typeof before.suspicion_checked_at, 'string');
			gates[1].resolve();
			const loser = await pending[1];
			assert.equal(loser.status, 200, JSON.stringify(loser.value));
			const result = asRecord(asRecord(loser.value, 'loser').result, 'loser result');
			assert.equal(result.failure_count, 0);
			assert.deepEqual(result.counts, { checked: 0, failed: 0, skipped_no_longer_pending: 1 });
			const after = rowsOf(
				(
					await command('collections.findMany', {
						collection: 'job_assignments',
						where: { id: { eq: PUBLIC_ASSIGNMENT_ID } },
						limit: 1
					})
				).value,
				'still checked assignment'
			)[0];
			assert.equal(after.row_version, before.row_version);
			assert.equal(after.suspicion_checked_at, before.suspicion_checked_at);
			const reviews = rowsOf(
				(
					await command('collections.findMany', {
						collection: 'suspicion_reviews',
						where: { job_assignment_id: { eq: PUBLIC_ASSIGNMENT_ID } },
						limit: 10
					})
				).value,
				'immutable reviews'
			);
			assert.equal(reviews.length, 1);
			assert.equal(reviews[0].reason, 'Review 0');
			assert.equal(calls, 2);
		} finally {
			for (const gate of gates) gate.resolve();
			await Promise.allSettled(pending);
			await session.stop();
		}
	}
);
