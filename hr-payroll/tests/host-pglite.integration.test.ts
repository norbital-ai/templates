import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	DatabaseRequest,
	EffectId,
	EnvironmentName,
	GATEWAY_SECRET_VARIABLE,
	Invocation,
	InvocationId,
	PROTOCOL_VERSION,
	ReleaseId,
	SYSTEM_SIGNATURE_HEADER,
	SYSTEM_TIMESTAMP_HEADER,
	TenantId,
	decodeBoltBundleModule,
	success,
	systemSignaturePayload,
	type FacilityBindings
} from '@norbital-ai/bolt-protocol';
import {
	HealthSnapshot,
	ServerConfiguration,
	makeAiBinding,
	makeDatabaseFromConfig,
	startApplication
} from '@norbital-ai/bolt-server';
import { ConfigProvider, Effect, Redacted, Schema } from 'effect';

const artifactDirectory = fileURLToPath(new URL('../.norbital/artifact/', import.meta.url));
const LOCAL_DATABASE_TEST_TIMEOUT_MILLIS = 60_000;
const withConfiguration = (values: Record<string, string>) =>
	ConfigProvider.layer(ConfigProvider.fromUnknown(values));

type ReleaseManifest = {
	readonly code?: { readonly entrypoint?: string };
	readonly requiredFacilities?: ReadonlyArray<string>;
};

const readRelease = (): ReleaseManifest => {
	const path = join(artifactDirectory, 'release.json');
	assert.ok(existsSync(path), `compiled artifact is missing ${path}`);
	return JSON.parse(readFileSync(path, 'utf8')) as ReleaseManifest;
};

/** Catalog-only stub — the same shape bolt-server's facilities suite uses. No live provider. */
const stubAi = makeAiBinding({
	call: async () => ({
		_tag: 'Catalog',
		languageModels: [{ id: 'test/language' }],
		defaultLanguageModelId: 'test/language',
		embeddingModels: [{ id: 'test/embedding' }],
		defaultEmbeddingModelId: 'test/embedding'
	})
});

/**
 * Named refusal when the compiled guest cannot become a listening host without Colony.
 *
 * `schema.migrate` is the embedder's job (sample host does it), not a skip. Colony-only gaps
 * (files, identity, Obscura, a real AI provider) are skipped with this name rather than a fake
 * `/readyz`.
 */
const colonyListenRefusal = (error: unknown): string | undefined => {
	const message = error instanceof Error ? error.message : String(error);
	const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
	const text = `${message}\n${cause}`;
	if (/Required facilities are not bound|unavailable facilities/i.test(text)) {
		return `missing_colony_facility: ${message}`;
	}
	if (/facility is not bound|facility_unavailable/i.test(text)) {
		return `missing_colony_facility: ${message}`;
	}
	return undefined;
};

/**
 * The embedder a template would call: Effect Config selects PGlite, `startApplication` binds the
 * compiled hr-payroll artifact, and `/readyz` is the real health endpoint — not a fixture
 * bundle. `tasks` is injected by `startApplication`. AI is a catalog stub; Obscura, a live
 * model, and a browser walk are still required for H1 / H3 / H5.
 */
test(
	'listens on PGlite selected by Effect Config against the compiled hr-payroll artifact',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async (t) => {
		const release = readRelease();
		const entrypoint = release.code?.entrypoint;
		assert.equal(typeof entrypoint, 'string');
		assert.ok(entrypoint.length > 0, 'release.json code.entrypoint must name the bundle');
		const bundlePath = join(artifactDirectory, entrypoint);
		assert.ok(existsSync(bundlePath), `compiled entrypoint is missing: ${bundlePath}`);
		assert.deepEqual([...(release.requiredFacilities ?? [])].toSorted(), [
			'ai',
			'database',
			'tasks'
		]);

		const scope = {
			tenantId: TenantId.make('hr-payroll-pglite'),
			environment: EnvironmentName.make('test'),
			releaseId: ReleaseId.make('hr-payroll-pglite')
		};
		const gatewaySecret = 'hr-payroll-pglite-gateway';
		process.env[GATEWAY_SECRET_VARIABLE] = gatewaySecret;

		const configuration = ServerConfiguration.make({
			host: '127.0.0.1',
			port: 0,
			bundlePath,
			scope,
			mode: 'development',
			drainTimeoutMillis: 1_000,
			invocationTimeoutMillis: 30_000,
			requestBodyLimitBytes: 1024,
			gatewaySecret: Redacted.make(gatewaySecret)
		});
		const metadata = {
			invocationId: InvocationId.make('invocation-1'),
			effectId: EffectId.make('effect-1'),
			deadlineEpochMs: Number.MAX_SAFE_INTEGER,
			idempotencyKey: 'hr-payroll-pglite-1'
		};
		const signal = new AbortController().signal;

		const dataDirectory = await mkdtemp(join(tmpdir(), 'hr-payroll-pglite-'));
		let database:
			| {
					readonly binding: NonNullable<FacilityBindings['database']>;
					readonly close: () => Promise<void>;
			  }
			| undefined;
		let application: Awaited<ReturnType<typeof startApplication>> | undefined;
		try {
			database = await Effect.runPromise(
				makeDatabaseFromConfig().pipe(
					Effect.provide(
						withConfiguration({
							BOLT_SERVER_DATABASE_PROVIDER: 'pglite',
							BOLT_SERVER_DATABASE_DATA_DIRECTORY: dataDirectory
						})
					)
				)
			);
			const secretsKey = 'hr-payroll-pglite-secrets-key';
			const facilities: FacilityBindings = {
				scope,
				database: database.binding,
				ai: stubAi,
				config: {
					call: async (_metadata, input) =>
						success({
							...(input.key === GATEWAY_SECRET_VARIABLE
								? { value: gatewaySecret }
								: input.key === 'BOLT_SECRETS_KEY'
									? { value: secretsKey }
									: {})
						})
				}
			};

			const installed = await database.binding.call(
				metadata,
				DatabaseRequest.cases.Transaction.make({
					statements: [
						{ sql: 'create extension if not exists pg_trgm', parameters: [] },
						{ sql: 'create extension if not exists btree_gist', parameters: [] },
						{ sql: 'create extension if not exists vector', parameters: [] },
						{
							sql: `select extname from pg_extension where extname in ('btree_gist', 'pg_trgm', 'vector') order by extname`,
							parameters: []
						}
					]
				}),
				signal
			);
			assert.equal(installed._tag, 'Success');
			if (installed._tag !== 'Success') return;
			assert.deepEqual(installed.value.rows, [
				{ extname: 'btree_gist' },
				{ extname: 'pg_trgm' },
				{ extname: 'vector' }
			]);

			// The sample embedder migrates before `startApplication`; this is that step, not a Colony host.
			const bundle = await Effect.runPromise(
				decodeBoltBundleModule(await import(pathToFileURL(bundlePath).href))
			);
			const timestamp = Date.now();
			const migrateInput = {};
			const migrated = await bundle.dispatch(
				Invocation.cases.Command.make({
					protocolVersion: PROTOCOL_VERSION,
					id: InvocationId.make('hr-payroll-pglite-migrate'),
					scope,
					deadlineEpochMs: timestamp + 30_000,
					command: 'schema.migrate',
					input: migrateInput,
					headers: {
						[SYSTEM_SIGNATURE_HEADER]: [
							createHmac('sha256', gatewaySecret)
								.update(
									systemSignaturePayload({
										timestamp,
										command: 'schema.migrate',
										tenantId: scope.tenantId,
										input: migrateInput
									}),
									'utf8'
								)
								.digest('hex')
						],
						[SYSTEM_TIMESTAMP_HEADER]: [String(timestamp)]
					}
				}),
				facilities,
				AbortSignal.timeout(30_000)
			);
			assert.equal(migrated._tag, 'Success', `schema.migrate: ${JSON.stringify(migrated)}`);
			if (migrated._tag === 'Success') {
				assert.ok(
					migrated.response.status >= 200 && migrated.response.status < 300,
					`schema.migrate returned ${migrated.response.status}`
				);
			}

			try {
				application = await startApplication({ configuration, facilities });
			} catch (error) {
				const reason = colonyListenRefusal(error);
				if (reason !== undefined) {
					t.skip(reason);
					return;
				}
				throw error;
			}

			const base = `http://${application.address.host}:${application.address.port}`;
			const ready = await fetch(`${base}/readyz`);
			assert.equal(ready.status, 200);
			const snapshot = await Effect.runPromise(
				Schema.decodeUnknownEffect(HealthSnapshot)(await ready.json())
			);
			assert.equal(snapshot.ready, true);
			assert.equal(snapshot.accepting, true);
			assert.notEqual(application.address.port, 0);
		} finally {
			if (application !== undefined) await application.stop();
			if (database !== undefined) await database.close();
			await rm(dataDirectory, { recursive: true, force: true });
		}
	}
);
