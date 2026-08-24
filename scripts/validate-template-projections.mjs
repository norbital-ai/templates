import { execFileSync } from 'node:child_process';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { Clock, Effect } from 'effect';
import { auditWorkspace } from './lib/authored-system-columns.mjs';
import {
	templateEnvironmentVariables,
	validateTemplateEnvironmentVariables
} from './lib/artifact-environment.mjs';
import { decodeJsonObject } from './lib/json.mjs';
import { templateArtifactPath } from './lib/template-artifact.mjs';
import { registryConfiguration } from './lib/registry.mjs';
import { discoverTemplates, repositoryRoot } from './lib/templates.mjs';

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
	const [filter, ...unexpected] = argv;
	if (unexpected.length > 0) throw new Error(`Unknown argument: ${unexpected[0]}`);
	return { filter };
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
 * Optional package archives for a pre-publication rehearsal.
 *
 * The committed lockfile still has to install frozen first: that proves the published template is
 * self-contained. A pre-publication archive set may then replace the four first-party packages in
 * the temporary projection, proving the next `0.0.1` package set before the existing registry
 * versions are removed. Nothing in the tracked projection is rewritten.
 */
function packageArchives() {
	const directory = process.env.NORBITAL_PACKAGE_ARCHIVES?.trim();
	if (!directory) return [];
	return [
		['@norbital-ai/bolt-protocol', 'bolt-protocol.tgz'],
		['@norbital-ai/std', 'std.tgz'],
		['@norbital-ai/ui', 'ui.tgz'],
		['@norbital-ai/bolt', 'bolt.tgz']
	].map(([name, filename]) => {
		const archive = path.resolve(directory, filename);
		if (!existsSync(archive)) throw new Error(`Missing package archive: ${archive}`);
		return { name, archive };
	});
}

function stagePackageArchives(destination, archives) {
	const manifestPath = path.join(destination, 'package.json');
	const manifest = decodeJsonObject(readFileSync(manifestPath, 'utf8'), manifestPath);
	const specifiers = Object.fromEntries(
		archives.map(({ name, archive }) => [name, `file:${archive}`])
	);
	writeFileSync(
		manifestPath,
		`${JSON.stringify(
			{
				...manifest,
				dependencies: { ...manifest.dependencies, ...specifiers }
			},
			null,
			2
		)}\n`
	);
	const workspacePath = path.join(destination, 'pnpm-workspace.yaml');
	const workspace = readFileSync(workspacePath, 'utf8');
	if (/^overrides:/m.test(workspace)) {
		throw new Error(`${workspacePath} already declares overrides; archive staging is ambiguous.`);
	}
	writeFileSync(
		workspacePath,
		`${workspace.trimEnd()}\n\noverrides:\n${Object.entries(specifiers)
			.map(([name, specifier]) => `  ${JSON.stringify(name)}: ${JSON.stringify(specifier)}`)
			.join('\n')}\n`
	);
}

/**
 * Environment declarations are server-only, so the public artifact manifest deliberately does not
 * publish them. `secrets.status` is the supported observable projection of the compiled
 * `workspace.definition.environment.variables` declaration: decoding and dispatching the emitted
 * artifact proves the declaration survived compilation instead of merely re-reading `+env.ts`.
 */
function validateArtifactEnvironment(template, destination) {
	const expected = templateEnvironmentVariables.get(template.slug);
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
		let databaseRead = 0;
		const databaseAnswer = (input) => {
			if (input._tag !== 'Query') {
				return {
					_tag: 'Failure',
					error: {
						code: 'unexpected_database_request',
						message: `Environment contract issued an unexpected database request: ${input._tag}`,
						retryable: false,
						outcome: 'known'
					}
				};
			}
			databaseRead += 1;
			if (databaseRead === 1) {
				return {
					_tag: 'Success',
					value: {
						rows: [
							{
								id: 'environment-contract-admin',
								tenantId,
								status: 'admin',
								team_id: null
							}
						],
						affectedRows: 0
					}
				};
			}
			// Authentication resolves team ancestry, then secrets.status reads configured vault names.
			if (databaseRead === 2 || databaseRead === 3) {
				return { _tag: 'Success', value: { rows: [], affectedRows: 0 } };
			}
			return {
				_tag: 'Failure',
				error: {
					code: 'unexpected_database_request',
					message: `Environment contract issued unexpected database read #${databaseRead}`,
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
		yield* Effect.try(() => validateTemplateEnvironmentVariables(template.slug, actual));
		console.log(
			`Validated artifact environment declaration: ${template.slug} (${actual.join(', ')}).`
		);
	});
}

const options = readArguments(process.argv.slice(2));

function runLifecycle(template, destination) {
	return Effect.gen(function* () {
		const archives = yield* Effect.try(packageArchives);
		const runStep = (label, arguments_) =>
			Effect.try(() => run('pnpm', arguments_, { cwd: destination, env: process.env })).pipe(
				Effect.mapError((cause) => {
					const detail = [cause?.stdout, cause?.stderr].filter(Boolean).join('\n').trim();
					return new Error(
						`${template.slug} standalone ${label} failed${detail ? `:\n${detail}` : '.'}`
					);
				})
			);
		yield* runStep('install', ['install', '--frozen-lockfile']);
		if (archives.length > 0) {
			yield* Effect.try(() => stagePackageArchives(destination, archives));
			yield* runStep('package archive format', [
				'exec',
				'prettier',
				'--write',
				'package.json',
				'pnpm-workspace.yaml'
			]);
			yield* runStep('package archive install', [
				'install',
				'--no-frozen-lockfile',
				'--ignore-scripts'
			]);
		}
		for (const [label, arguments_] of [
			['sync', ['sync']],
			['lint', ['lint']]
		]) {
			yield* runStep(label, arguments_);
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
		const { findings } = yield* Effect.try(() => auditWorkspace(destination));
		if (findings.length > 0) {
			const detail = findings
				.map(
					(finding) =>
						`${path.relative(destination, finding.file)} <${finding.component} ${finding.property}>`
				)
				.join('\n  ');
			return yield* Effect.fail(
				new Error(
					`${template.slug} projection hands a framework system column to a component:\n  ${detail}`
				)
			);
		}
		yield* validateArtifactEnvironment(template, destination);
		yield* Effect.sync(() => {
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
