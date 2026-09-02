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
	ServerConfiguration,
	makeAiBinding,
	makeDatabaseFromConfig,
	startApplication
} from '@norbital-ai/bolt-server';
import { ConfigProvider, Effect, Redacted } from 'effect';

const artifactDirectory = fileURLToPath(new URL('../../.norbital/artifact/', import.meta.url));

type ReleaseManifest = {
	readonly code?: { readonly entrypoint?: string };
	readonly requiredFacilities?: ReadonlyArray<string>;
	readonly schema?: { readonly fingerprint?: string };
};

const withConfiguration = (values: Record<string, string>) =>
	ConfigProvider.layer(ConfigProvider.fromUnknown(values));

const stubAi = makeAiBinding({
	call: async () => ({
		_tag: 'Catalog',
		languageModels: [{ id: 'test/language' }],
		defaultLanguageModelId: 'test/language',
		embeddingModels: [{ id: 'test/embedding' }],
		defaultEmbeddingModelId: 'test/embedding'
	})
});

export const colonyListenRefusal = (error: unknown): string | undefined => {
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

export const readRelease = (): ReleaseManifest => {
	const path = join(artifactDirectory, 'release.json');
	if (!existsSync(path)) throw new Error(`compiled artifact is missing ${path}`);
	return JSON.parse(readFileSync(path, 'utf8')) as ReleaseManifest;
};

type Bundle = Awaited<ReturnType<typeof decodeBoltBundleModule>>;
type DatabaseHandle = {
	readonly binding: NonNullable<FacilityBindings['database']>;
	readonly close: () => Promise<void>;
};

export type FieldOpsPgliteHost = {
	readonly scope: FacilityBindings['scope'];
	readonly gatewaySecret: string;
	readonly schemaFingerprint: string;
	readonly bundle: Bundle;
	readonly facilities: FacilityBindings;
	readonly database: DatabaseHandle;
	readonly dataDirectory: string;
	readonly application: Awaited<ReturnType<typeof startApplication>> | undefined;
	readonly dispatchSigned: (command: string, input: Record<string, unknown>) => Promise<unknown>;
	readonly dispatchSession: (
		command: string,
		credential: string,
		input: Record<string, unknown>
	) => Promise<unknown>;
	readonly stop: () => Promise<void>;
};

const commandValue = (result: unknown, command: string): unknown => {
	if (typeof result !== 'object' || result === null) {
		throw new Error(`${command} returned a non-object: ${String(result)}`);
	}
	const tagged = result as {
		readonly _tag?: string;
		readonly response?: { readonly value?: unknown };
	};
	if (tagged._tag !== 'Success') {
		throw new Error(`${command} failed: ${JSON.stringify(result)}`);
	}
	return tagged.response?.value;
};

export const openFieldOpsPgliteHost = async (options?: {
	readonly listen?: boolean;
}): Promise<FieldOpsPgliteHost> => {
	const release = readRelease();
	const entrypoint = release.code?.entrypoint;
	if (typeof entrypoint !== 'string' || entrypoint.length === 0) {
		throw new Error('release.json code.entrypoint must name the bundle');
	}
	const bundlePath = join(artifactDirectory, entrypoint);
	if (!existsSync(bundlePath)) throw new Error(`compiled entrypoint is missing: ${bundlePath}`);

	const scope = {
		tenantId: TenantId.make('field-ops-pglite'),
		environment: EnvironmentName.make('test'),
		releaseId: ReleaseId.make('field-ops-pglite')
	};
	const gatewaySecret = 'field-ops-pglite-gateway';
	process.env[GATEWAY_SECRET_VARIABLE] = gatewaySecret;

	const configuration = ServerConfiguration.make({
		host: '127.0.0.1',
		port: 0,
		bundlePath,
		scope,
		mode: 'development',
		drainTimeoutMillis: 1_000,
		invocationTimeoutMillis: 30_000,
		requestBodyLimitBytes: 16_384,
		gatewaySecret: Redacted.make(gatewaySecret)
	});
	const metadata = {
		invocationId: InvocationId.make('invocation-1'),
		effectId: EffectId.make('effect-1'),
		deadlineEpochMs: Number.MAX_SAFE_INTEGER,
		idempotencyKey: 'field-ops-pglite-1'
	};
	const signal = new AbortController().signal;
	const dataDirectory = await mkdtemp(join(tmpdir(), 'field-ops-pglite-'));

	const database = await Effect.runPromise(
		makeDatabaseFromConfig().pipe(
			Effect.provide(
				withConfiguration({
					BOLT_SERVER_DATABASE_PROVIDER: 'pglite',
					BOLT_SERVER_DATABASE_DATA_DIRECTORY: dataDirectory
				})
			)
		)
	);
	const secretsKey = 'field-ops-pglite-secrets-key';
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
	if (installed._tag !== 'Success') {
		await database.close();
		await rm(dataDirectory, { recursive: true, force: true });
		throw new Error(`extension install failed: ${JSON.stringify(installed)}`);
	}

	const bundle = await Effect.runPromise(
		decodeBoltBundleModule(await import(pathToFileURL(bundlePath).href))
	);

	let sequence = 0;
	const dispatchSigned = async (command: string, input: Record<string, unknown>) => {
		const timestamp = Date.now();
		sequence += 1;
		const result = await bundle.dispatch(
			Invocation.cases.Command.make({
				protocolVersion: PROTOCOL_VERSION,
				id: InvocationId.make(`field-ops-signed-${sequence}`),
				scope,
				deadlineEpochMs: timestamp + 30_000,
				command,
				input,
				headers: {
					[SYSTEM_SIGNATURE_HEADER]: [
						createHmac('sha256', gatewaySecret)
							.update(
								systemSignaturePayload({
									timestamp,
									command,
									tenantId: scope.tenantId,
									input
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
		return commandValue(result, command);
	};

	const dispatchSession = async (
		command: string,
		credential: string,
		input: Record<string, unknown>
	) => {
		const timestamp = Date.now();
		sequence += 1;
		const result = await bundle.dispatch(
			Invocation.cases.Command.make({
				protocolVersion: PROTOCOL_VERSION,
				id: InvocationId.make(`field-ops-session-${sequence}`),
				scope,
				deadlineEpochMs: timestamp + 30_000,
				command,
				input,
				headers: { authorization: [`Bearer ${credential}`] }
			}),
			facilities,
			AbortSignal.timeout(30_000)
		);
		return commandValue(result, command);
	};

	const schemaFingerprint = release.schema?.fingerprint ?? '';
	await dispatchSigned('schema.migrate', {});
	if (schemaFingerprint.length === 0) {
		await database.close();
		await rm(dataDirectory, { recursive: true, force: true });
		throw new Error('release.json schema.fingerprint is missing');
	}

	let application: Awaited<ReturnType<typeof startApplication>> | undefined;
	if (options?.listen !== false) {
		try {
			application = await startApplication({ configuration, facilities });
		} catch (error) {
			const reason = colonyListenRefusal(error);
			if (reason === undefined) {
				await database.close();
				await rm(dataDirectory, { recursive: true, force: true });
				throw error;
			}
		}
	}

	return {
		scope,
		gatewaySecret,
		schemaFingerprint,
		bundle,
		facilities,
		database,
		dataDirectory,
		application,
		dispatchSigned,
		dispatchSession,
		stop: async () => {
			if (application !== undefined) await application.stop();
			await database.close();
			await rm(dataDirectory, { recursive: true, force: true });
		}
	};
};
