import test from 'node:test';
import assert from 'node:assert/strict';
import {
	asRecord,
	mutationPush,
	mutationResolution,
	pageOf,
	postGuestCommand,
	recordedAi,
	requireOk,
	rowsOf,
	type RecordedGenerated
} from '@norbital-ai/test-utilities';
import { PUBLIC_ASSIGNMENT_ID, bootPublicSeedGuest } from './helpers/public-seed-guest.js';

const LOCAL_DATABASE_TEST_TIMEOUT_MILLIS = 120_000;
const MUTATE_COMMAND = 'collections.mutate';
const START_COMMAND = 'automations.start';
const SUSPICION_AUTOMATION = 'review_job_assignment_suspicion';

const sessionHeaders = (credential: string): Readonly<Record<string, string>> => ({
	authorization: `Bearer ${credential}`
});

const sessionFindMany = async (
	baseUrl: string,
	credential: string,
	input: Record<string, unknown>
): Promise<unknown> =>
	requireOk(
		await postGuestCommand(baseUrl, 'collections.findMany', input, sessionHeaders(credential)),
		'collections.findMany'
	);

const loadPublicAssignment = async (
	baseUrl: string,
	credential: string
): Promise<Readonly<Record<string, unknown>>> => {
	const listed = pageOf(
		await sessionFindMany(baseUrl, credential, {
			collection: 'job_assignments',
			where: { id: { eq: PUBLIC_ASSIGNMENT_ID } },
			limit: 1,
			columns: {
				id: true,
				row_version: true,
				status: true,
				completed_at: true,
				suspicion_checked_at: true
			}
		}),
		'public assignment'
	);
	assert.equal(listed.rows.length, 1, JSON.stringify(listed.rows));
	const row = listed.rows[0];
	assert.ok(row !== undefined);
	assert.equal(row.id, PUBLIC_ASSIGNMENT_ID);
	return row;
};

/**
 * I5: kanban persist on the public assignment, then Run now against recordedAi.
 *
 * `api.infer` requires Generated `{ result: { _tag: 'Object', value } }` matching
 * `suspicionInferenceSchema`. A canned Message cannot satisfy that. Public
 * `photo_evidence.json` is [], so `similar_photo_reviews` must be empty — the same
 * recorded clear object the suspicion-review harness already uses.
 *
 * A second `automations.start` is only UI-blocked in `+field_ops_controller.svelte`
 * (`if (suspicionReviewRunning) return`). This host has no server lock; do not invent one.
 * B6 streamed % / second-run lock stay UI-only.
 */
const PUBLIC_SEED_GENERATE_TRANSCRIPT_LENGTH = 32;

const recordedEmptyPhotoClear: RecordedGenerated = {
	_tag: 'Generated',
	result: {
		_tag: 'Object',
		value: {
			job_site_review: {
				suspicious: false,
				reason: 'The evidence does not justify a suspicion.',
				evidence_asset_name: ''
			},
			similar_photo_reviews: []
		}
	},
	observation: {
		callId: 'call-1',
		provider: 'fixture',
		model: 'provider/model',
		operation: 'language',
		charge: { currency: 'USD', coefficient: '125', scale: 6 },
		chargeSource: 'provider'
	}
};

test(
	'public seed mutate persists completed_at and Run now records Generated progress',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const guest = await bootPublicSeedGuest({
			tenantId: 'field-ops-public-seed-mutate',
			releaseId: 'field-ops-public-seed-mutate',
			gatewaySecret: 'field-ops-public-seed-mutate-gateway',
			founderEmail: 'field-ops-mutate-founder@example.test',
			founderClaimId: 'field-ops-public-seed-mutate-founder',
			secretsKey: 'field-ops-public-seed-mutate-secrets-key',
			invocationTimeoutMillis: 90_000,
			ai: recordedAi(
				Array.from(
					{ length: PUBLIC_SEED_GENERATE_TRANSCRIPT_LENGTH },
					() => recordedEmptyPhotoClear
				)
			)
		});
		try {
			const before = await loadPublicAssignment(guest.baseUrl, guest.credential);
			assert.equal(before.status, 'assigned');
			const rowVersion = Number(before.row_version);
			assert.ok(
				Number.isFinite(rowVersion) && rowVersion > 0,
				`row_version: ${String(before.row_version)}`
			);

			const mutated = await postGuestCommand(
				guest.baseUrl,
				MUTATE_COMMAND,
				mutationPush(
					guest.schemaFingerprint,
					{
						action: 'update',
						collection: 'job_assignments',
						values: { id: PUBLIC_ASSIGNMENT_ID, status: 'completed' }
					},
					[
						{
							row: { collection: 'job_assignments', recordId: PUBLIC_ASSIGNMENT_ID },
							rowVersion
						}
					]
				),
				sessionHeaders(guest.credential)
			);
			assert.ok(
				mutated.status >= 200 && mutated.status < 300,
				`${MUTATE_COMMAND} returned ${mutated.status}: ${JSON.stringify(mutated.value)}`
			);
			const resolution = mutationResolution(mutated.value, MUTATE_COMMAND);
			switch (resolution) {
				case 'accepted':
					break;
				case 'rebased':
				case 'rejected':
				case 'quarantined':
					throw new Error(`${MUTATE_COMMAND} ${resolution}: ${JSON.stringify(mutated.value)}`);
				default: {
					const _exhaustive: never = resolution;
					throw new Error(`unhandled mutation resolution: ${String(_exhaustive)}`);
				}
			}

			const after = await loadPublicAssignment(guest.baseUrl, guest.credential);
			assert.equal(after.status, 'completed');
			assert.equal(typeof after.completed_at, 'string');
			assert.ok(
				String(after.completed_at).length > 0,
				'completed_at must be stamped by the mutate hook'
			);

			const started = await postGuestCommand(
				guest.baseUrl,
				START_COMMAND,
				{ name: SUSPICION_AUTOMATION, input: {} },
				sessionHeaders(guest.credential)
			);
			const startedBody = JSON.stringify(started.value);
			if (started.status >= 200 && started.status < 300) {
				const record = asRecord(started.value, START_COMMAND);
				assert.equal(typeof record.taskId, 'string');
				assert.ok(String(record.taskId).length > 0, startedBody);
				const reloaded = await loadPublicAssignment(guest.baseUrl, guest.credential);
				const suspicionChecked =
					typeof reloaded.suspicion_checked_at === 'string' &&
					reloaded.suspicion_checked_at.length > 0;
				const result = record.result;
				const resultProgress =
					result !== null &&
					typeof result === 'object' &&
					!Array.isArray(result) &&
					(typeof (result as { reviewed_at?: unknown }).reviewed_at === 'string' ||
						typeof (result as { assignment_count?: unknown }).assignment_count === 'number');
				assert.ok(
					suspicionChecked || resultProgress,
					`expected suspicion_checked_at or automation result progress: ${JSON.stringify({
						reloaded,
						started: record
					})}`
				);
			} else {
				throw new Error(`${START_COMMAND} HTTP ${started.status}: ${startedBody}`);
			}

			const persisted = rowsOf(
				await sessionFindMany(guest.baseUrl, guest.credential, {
					collection: 'job_assignments',
					where: { id: { eq: PUBLIC_ASSIGNMENT_ID } },
					limit: 1
				}),
				'reload after Run now'
			);
			assert.equal(persisted[0]?.status, 'completed');
			assert.equal(typeof persisted[0]?.completed_at, 'string');
			assert.ok(String(persisted[0]?.completed_at).length > 0);
		} finally {
			await guest.stop();
		}
	}
);
