import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { Clock, Effect } from 'effect';
import { auditWorkspace } from './lib/authored-system-columns.mjs';
import { decodeJsonObject } from './lib/json.mjs';
import {
	archiveTemplateArtifact,
	templateArtifactPath,
	templateBundleFormatVersion
} from './lib/template-artifact.mjs';
import { registryConfiguration } from './lib/registry.mjs';
import {
	discoverTemplates,
	repositoryRoot,
	templateBundlePackageManifest
} from './lib/templates.mjs';

/**
 * Prove each template stands alone.
 *
 * What publishes is `git subtree split` of the template directory — the tracked files, and only
 * those. This copies exactly that set somewhere else and runs a tenant's lifecycle against it, so
 * a projection that silently depends on an untracked file, or on something this repository happens
 * to provide at its root, fails here rather than inside a tenant sandbox.
 *
 * The install is `--frozen-lockfile` against the committed per-template lockfile, because that
 * lockfile is what a sandbox installs. `pnpm templates:lock:check` owns whether it is current.
 */

function run(command, arguments_, options = {}) {
	return execFileSync(command, arguments_, {
		cwd: repositoryRoot,
		encoding: 'utf8',
		stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
		...options
	});
}

function readArguments(argv) {
	const options = { filter: undefined, bundleOutput: undefined, revisions: undefined };
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === '--bundle-output') options.bundleOutput = argv[++index];
		else if (argument === '--revisions') options.revisions = argv[++index];
		else if (!options.filter) options.filter = argument;
		else throw new Error(`Unknown argument: ${argument}`);
	}
	if (Boolean(options.bundleOutput) !== Boolean(options.revisions)) {
		throw new Error('--bundle-output and --revisions must be provided together.');
	}
	return options;
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function writeTemplateBundle(template, projection, outputDirectory, workspaceRoot) {
	const packageManifest = decodeJsonObject(
		readFileSync(path.join(template.directory, 'package.json')),
		`${template.directory}/package.json`
	);
	const lockfile = readFileSync(path.join(template.directory, 'pnpm-lock.yaml'));
	const lockHash = sha256(lockfile).slice(0, 32);
	const boltVersion = packageManifest.dependencies?.['@norbital-ai/bolt'];
	if (typeof boltVersion !== 'string' || boltVersion.length === 0) {
		throw new Error(`Template ${template.slug} pins no @norbital-ai/bolt version.`);
	}
	const packageDirectory = path.join(outputDirectory, template.slug);
	mkdirSync(packageDirectory, { recursive: true });
	const bundlePath = path.join(packageDirectory, 'bundle.tar');
	archiveTemplateArtifact(workspaceRoot, bundlePath);
	const bundle = readFileSync(bundlePath);
	writeFileSync(
		path.join(packageDirectory, 'norbital.template-build.json'),
		`${JSON.stringify(
			{
				schemaVersion: 1,
				templateSlug: template.slug,
				templateHandle: template.handle,
				sourceCommit: projection.revision,
				bundleFormatVersion: templateBundleFormatVersion,
				lockHash,
				boltVersion,
				packageKey: lockHash.slice(0, 16),
				bundleSha256: sha256(bundle),
				bundleBytes: statSync(bundlePath).size
			},
			null,
			2
		)}\n`
	);
	writeFileSync(
		path.join(packageDirectory, 'package.json'),
		`${JSON.stringify(templateBundlePackageManifest(template), null, 2)}\n`
	);
	console.log(`Prepared canonical build package for ${template.slug}@${projection.revision}.`);
}

function copyTrackedProjection(template, destination) {
	const trackedFiles = run('git', ['ls-files', '--', template.path])
		.trim()
		.split('\n')
		.filter(Boolean);
	if (trackedFiles.length === 0) throw new Error(`Template ${template.slug} has no tracked files.`);
	for (const trackedFile of trackedFiles) {
		const source = path.join(repositoryRoot, trackedFile);
		const relative = path.relative(template.directory, source);
		const target = path.join(destination, relative);
		mkdirSync(path.dirname(target), { recursive: true });
		copyFileSync(source, target);
	}
}

/**
 * Environment declarations are server-only, so the public artifact manifest deliberately does not
 * publish them. `secrets.status` is the supported observable projection of the compiled
 * `workspace.definition.environment.variables` declaration: decoding and dispatching the emitted
 * artifact proves the declaration survived compilation instead of merely re-reading `+env.ts`.
 */
const expectedEnvironmentVariables = new Map([
	['construction', ['REPORTS_WEBHOOK_SECRET']],
	['crm', ['EXTERNAL_SYSTEM_TOKEN']],
	['field-operations', ['DISPATCH_WEBHOOK_SECRET']]
]);

function validateArtifactEnvironment(template, destination) {
	const expected = expectedEnvironmentVariables.get(template.slug);
	if (expected === undefined) return Effect.void;

	const requireFromProjection = createRequire(path.join(destination, 'package.json'));
	return Effect.gen(function* () {
		const [protocolModule, workspaceEffect, runtime] = yield* Effect.all(
			[
				Effect.tryPromise(
					() =>
						import(pathToFileURL(requireFromProjection.resolve('@norbital-ai/bolt-protocol')).href)
				),
				Effect.tryPromise(
					() => import(pathToFileURL(requireFromProjection.resolve('effect')).href)
				),
				Effect.tryPromise(() => import(pathToFileURL(templateArtifactPath(destination)).href))
			],
			{ concurrency: 'unbounded' }
		);
		const bundle = yield* Effect.tryPromise(() =>
			workspaceEffect.Effect.runPromise(protocolModule.decodeBoltBundleModule(runtime))
		);
		const tenantId = `environment-contract-${template.slug}`;
		const scope = { tenantId, environment: 'test', releaseId: 'environment-contract' };
		const databaseAnswer = (input) => {
			if (input._tag === 'Query' && input.sql.includes('from bolt_auth_session')) {
				return {
					_tag: 'Success',
					value: {
						rows: [
							{
								userId: 'environment-contract-admin',
								tenantId,
								status: 'admin',
								team_id: null,
								teamPath: []
							}
						],
						affectedRows: 0
					}
				};
			}
			if (input._tag === 'Query' && input.sql === 'select name, updated_at from bolt_secrets') {
				return { _tag: 'Success', value: { rows: [], affectedRows: 0 } };
			}
			return {
				_tag: 'Failure',
				error: {
					code: 'unexpected_database_request',
					message: `Environment contract issued an unexpected database request: ${input._tag}`,
					retryable: false,
					outcome: 'known'
				}
			};
		};
		const database = {
			// The decoded artifact owns a separately loaded Effect runtime; this callback is its Promise API.
			call: (_metadata, input) =>
				workspaceEffect.Effect.runPromise(workspaceEffect.Effect.succeed(databaseAnswer(input)))
		};
		const now = yield* Clock.currentTimeMillis;
		const result = yield* Effect.tryPromise(() =>
			bundle.dispatch(
				{
					_tag: 'Command',
					protocolVersion: bundle.protocolVersion,
					id: `environment-contract-${template.slug}`,
					scope,
					deadlineEpochMs: now + 30_000,
					command: 'secrets.status',
					input: {},
					headers: { authorization: ['Bearer environment-contract'] }
				},
				{ scope, database },
				new AbortController().signal
			)
		);
		if (result._tag !== 'Success' || !Array.isArray(result.response.value)) {
			return yield* Effect.fail(
				new Error(
					`${template.slug} artifact did not expose its environment declaration: ${JSON.stringify(result)}`
				)
			);
		}
		const actual = result.response.value
			.map((entry) =>
				entry !== null && typeof entry === 'object' && typeof entry.name === 'string'
					? entry.name
					: undefined
			)
			.filter(Boolean)
			.toSorted();
		const expectedSorted = expected.toSorted();
		const matches = workspaceEffect.Equivalence.Array(workspaceEffect.Equivalence.String)(
			actual,
			expectedSorted
		);
		if (!matches) {
			return yield* Effect.fail(
				new Error(
					`${template.slug} artifact environment variables differ: expected ${expectedSorted.join(', ')}, received ${actual.join(', ') || '(none)'}.`
				)
			);
		}
		console.log(
			`Validated artifact environment declaration: ${template.slug} (${actual.join(', ')}).`
		);
	});
}

const options = readArguments(process.argv.slice(2));
const parsedRevisions = options.revisions
	? decodeJsonObject(
			readFileSync(path.resolve(repositoryRoot, options.revisions), 'utf8'),
			path.resolve(repositoryRoot, options.revisions)
		)
	: null;
if (options.revisions && !Array.isArray(parsedRevisions.entries)) {
	throw new Error(`${options.revisions} must contain { entries: [...] }.`);
}
const revisions = parsedRevisions;
const projections = new Map((revisions?.entries ?? []).map((entry) => [entry.slug, entry]));
const bundleOutput = options.bundleOutput
	? path.resolve(repositoryRoot, options.bundleOutput)
	: null;
if (bundleOutput) {
	rmSync(bundleOutput, { recursive: true, force: true });
	mkdirSync(bundleOutput, { recursive: true });
}

function runLifecycle(template, destination) {
	return Effect.gen(function* () {
		for (const [label, arguments_] of [
			['install', ['install', '--frozen-lockfile']],
			['sync', ['sync']],
			['lint', ['lint']]
		]) {
			yield* Effect.try(() => run('pnpm', arguments_, { cwd: destination, env: process.env })).pipe(
				Effect.mapError((cause) => {
					const detail = [cause?.stdout, cause?.stderr].filter(Boolean).join('\n').trim();
					return new Error(
						`${template.slug} standalone ${label} failed${detail ? `:\n${detail}` : '.'}`
					);
				})
			);
		}
	});
}

function validateProjection(template, temporaryDirectory) {
	const destination = path.join(temporaryDirectory, template.slug);
	return Effect.gen(function* () {
		yield* Effect.try(() => {
			mkdirSync(destination, { recursive: true });
			copyTrackedProjection(template, destination);
			writeFileSync(path.join(destination, '.npmrc'), registryConfiguration());
		});
		yield* runLifecycle(template, destination);
		yield* Effect.try(() => {
			const { findings } = auditWorkspace(destination);
			if (findings.length === 0) return;
			const detail = findings
				.map(
					(finding) =>
						`${path.relative(destination, finding.file)} <${finding.component} ${finding.property}>`
				)
				.join('\n  ');
			throw new Error(
				`${template.slug} projection hands a framework system column to a component:\n  ${detail}`
			);
		});
		yield* validateArtifactEnvironment(template, destination);
		yield* Effect.try(() => {
			if (bundleOutput) {
				const projection = projections.get(template.slug);
				if (!projection) throw new Error(`No projected revision recorded for ${template.slug}.`);
				writeTemplateBundle(template, projection, bundleOutput, destination);
			}
			console.log(`Validated clean standalone projection: ${template.slug}.`);
		});
	});
}

const validation = Effect.acquireUseRelease(
	Effect.try(() => mkdtempSync(path.join(tmpdir(), 'norbital-template-projections-'))),
	(temporaryDirectory) =>
		Effect.forEach(
			discoverTemplates(options.filter),
			(template) => validateProjection(template, temporaryDirectory),
			{ concurrency: 1, discard: true }
		),
	(temporaryDirectory) =>
		Effect.sync(() => {
			if (process.env.KEEP_TEMPLATE_PROJECTIONS === '1') {
				console.log(`Kept standalone projections at ${temporaryDirectory}.`);
				return;
			}
			rmSync(temporaryDirectory, { recursive: true, force: true });
		})
).pipe(
	Effect.catch((error) =>
		Effect.sync(() => {
			console.error(error);
			process.exitCode = 1;
		})
	)
);

Effect.runFork(validation);
