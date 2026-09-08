/**
 * A real send, through a real guest, measured.
 *
 * Not the in-process runtime harness: this compiles the field-operations workspace, boots it on a
 * self-host with PGlite, mints a founder session, and posts `conversations.send` over HTTP — the
 * same path a person's browser takes, minus Colony's isolate hop. The provider is a local stub that
 * answers instantly, so what is left in the number is ours.
 *
 * Run: node --experimental-strip-types --import ./scripts/ts-source-resolve.mjs tests/agent-turn-latency.probe.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prompt } from 'effect/unstable/ai';
import { Schema } from 'effect';
import { makeAiBinding } from '@norbital-ai/bolt-server';
import { postGuestCommand } from '@norbital-ai/test-utilities';
import { bootPublicSeedGuest } from './helpers/public-seed-guest.ts';

const TURNS = 10;
const CONTEXT_WINDOW_TOKENS = 1_000_000;
const encodeMessage = Schema.encodeSync(Prompt.Message);

let askedAt = 0;
const generations: Array<number> = [];

/** Instant provider: the catalogue states a window, and a Generate answers with one sentence. */
const ai = makeAiBinding({
	call: async (
		_metadata: unknown,
		request: { readonly _tag: string; readonly callId?: string; readonly modelId?: string }
	) => {
		if (request._tag === 'Catalog') {
			return {
				_tag: 'Catalog' as const,
				languageModels: [{ id: 'probe/language', contextWindowTokens: CONTEXT_WINDOW_TOKENS }],
				defaultLanguageModelId: 'probe/language',
				embeddingModels: [{ id: 'probe/embedding', contextWindowTokens: CONTEXT_WINDOW_TOKENS }],
				defaultEmbeddingModelId: 'probe/embedding'
			};
		}
		if (request._tag !== 'Generate') throw new Error(`probe: unexpected ${request._tag}`);
		generations.push(performance.now() - askedAt);
		return {
			_tag: 'Generated' as const,
			result: {
				_tag: 'Message' as const,
				message: encodeMessage(
					Prompt.assistantMessage({ content: [Prompt.textPart({ text: 'Understood.' })] })
				)
			},
			observation: {
				callId: request.callId,
				provider: 'probe',
				model: request.modelId,
				operation: 'language' as const,
				usage: { inputTokens: { total: 400 }, outputTokens: { total: 12 } }
			}
		};
	}
});

const percentile = (values: ReadonlyArray<number>, fraction: number): number => {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))]!;
};

const guest = await bootPublicSeedGuest({
	tenantId: 'field-ops-latency-probe',
	releaseId: 'field-ops-latency-probe',
	gatewaySecret: 'field-ops-latency-probe-gateway',
	founderEmail: 'field-ops-latency-probe@example.test',
	founderClaimId: 'field-ops-latency-probe-founder',
	secretsKey: 'field-ops-latency-probe-secrets-key',
	ai
});

try {
	const session = await guest.guestCommand(
		'identity.continueSession',
		{ email: 'field-ops-latency-probe@example.test' },
		'system'
	);
	assert.ok(
		session.status < 300,
		`continueSession HTTP ${session.status}: ${JSON.stringify(session.value)}`
	);
	const credential = String((session.value as { readonly credential?: unknown }).credential);

	const conversationId = randomUUID();
	const sends: Array<number> = [];
	for (let turn = 0; turn < TURNS; turn += 1) {
		askedAt = performance.now();
		const result = await postGuestCommand(
			guest.baseUrl,
			'conversations.send',
			{
				conversationId,
				submissionId: randomUUID(),
				agentId: 'web',
				message: encodeMessage(
					Prompt.userMessage({ content: [Prompt.textPart({ text: `Turn ${turn + 1}.` })] })
				),
				mode: 'agent',
				priority: 'normal'
			},
			{ authorization: `Bearer ${credential}` }
		);
		assert.ok(
			result.status >= 200 && result.status < 300,
			`conversations.send HTTP ${result.status}: ${JSON.stringify(result.value)}`
		);
		sends.push(performance.now() - askedAt);
	}

	assert.equal(
		generations.length,
		TURNS,
		`expected ${TURNS} provider calls, saw ${generations.length}`
	);
	const line = (label: string, values: ReadonlyArray<number>) =>
		`${label}: p50 ${percentile(values, 0.5).toFixed(1)} ms, p95 ${percentile(values, 0.95).toFixed(1)} ms, max ${Math.max(...values).toFixed(1)} ms`;
	console.info(`PROBE ${line('send→provider', generations)}`);
	console.info(`PROBE ${line('send→response', sends)}`);
	console.info(
		`PROBE per turn send→provider: ${generations.map((v) => v.toFixed(0)).join(' ')} ms`
	);
	console.info(`PROBE per turn send→response: ${sends.map((v) => v.toFixed(0)).join(' ')} ms`);
} finally {
	await guest.stop();
}
