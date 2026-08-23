import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { Effect } from 'effect';
import { prepareDepset } from './lib/depset.mjs';
import { decodeJsonObject } from './lib/json.mjs';
import { inspectRuntimeArtifact } from './lib/runtime-smoke.mjs';
import { templateArtifactPath } from './lib/template-artifact.mjs';
import { discoverTemplates, repositoryRoot } from './lib/templates.mjs';

/**
 * Proves the portable artifact contract: Bolt sync is the compilation step. Against a materialized
 * depset it must emit a module accepted by the authoritative protocol decoder, with intact embedded
 * browser assets; no separate application build participates in this lifecycle.
 */

function fail(message) {
	throw new Error(message);
}

function argumentsFrom(argv) {
	const options = {};
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (!argument.startsWith('--')) fail(`Unknown argument: ${argument}`);
		const value = argv[++index];
		if (!value || value.startsWith('--')) fail(`${argument} requires a value.`);
		options[argument.slice(2)] = value;
	}
	return options;
}

function materializeTrackedTemplate(template, destination) {
	const sourceRoot = path.join(repositoryRoot, template.path);
	const tracked = execFileSync('git', ['ls-files', '--', template.path], {
		cwd: repositoryRoot,
		encoding: 'utf8'
	})
		.trim()
		.split('\n')
		.filter(Boolean);
	if (tracked.length === 0) fail(`Template ${template.slug} has no tracked files.`);
	for (const trackedFile of tracked) {
		const source = path.join(repositoryRoot, trackedFile);
		const target = path.join(destination, path.relative(sourceRoot, source));
		mkdirSync(path.dirname(target), { recursive: true });
		execFileSync('cp', [source, target]);
	}
	return destination;
}

const options = argumentsFrom(process.argv.slice(2));
// The contract under test is the bundle format, which no template owns, so any template proves it.
// Defaulting to the first discovered one keeps this script correct in a repository whose template
// set changes — and in the private template repository, which shares no key with this one.
const templateKey = options.template ?? process.env.RUNTIME_SMOKE_TEMPLATE;
const [template] = discoverTemplates(templateKey);
const outputPath = path.resolve(
	repositoryRoot,
	options.output ?? process.env.RUNTIME_SMOKE_OUTPUT ?? 'dist/runtime-smoke.json'
);
const storeDirectory = path.resolve(
	repositoryRoot,
	options['store-dir'] ?? process.env.NORBITAL_PNPM_STORE ?? '.tmp/pnpm-store'
);

const smoke = Effect.acquireUseRelease(
	Effect.try(() => {
		mkdirSync(path.join(repositoryRoot, '.tmp'), { recursive: true });
		const temporaryDirectory = mkdtempSync(path.join(repositoryRoot, '.tmp', 'runtime-smoke-'));
		const workspace = path.join(temporaryDirectory, 'src');
		return {
			temporaryDirectory,
			workspace,
			depsetRoot: path.join(temporaryDirectory, 'node_modules'),
			runtimeEntry: templateArtifactPath(workspace)
		};
	}),
	({ workspace, depsetRoot, runtimeEntry }) =>
		Effect.gen(function* () {
			const built = yield* Effect.try(() => {
				mkdirSync(workspace, { recursive: true });
				mkdirSync(storeDirectory, { recursive: true });
				materializeTrackedTemplate(template, workspace);
				const depset = prepareDepset({
					templateDirectory: workspace,
					storeDirectory,
					depsetRoot
				});
				execFileSync('ln', ['-sfn', depset.path, path.join(workspace, 'node_modules')]);
				const boltBin = path.join(
					workspace,
					'node_modules',
					'@norbital-ai',
					'bolt',
					'build',
					'compiler',
					'cli.js'
				);
				const buildStartedAt = process.hrtime.bigint();
				execFileSync(process.execPath, [boltBin, 'sync'], {
					cwd: workspace,
					stdio: 'inherit'
				});
				const buildElapsedMilliseconds =
					Number(process.hrtime.bigint() - buildStartedAt) / 1_000_000;
				if (!statSync(runtimeEntry).isFile() || statSync(runtimeEntry).size === 0) {
					fail(`Bolt sync emitted no non-empty portable artifact at ${runtimeEntry}.`);
				}
				return {
					depset,
					buildElapsedMilliseconds,
					runtimeEntrySha256: createHash('sha256').update(readFileSync(runtimeEntry)).digest('hex')
				};
			});

			console.log('Loading .norbital/artifact/bundle.mjs from the clean workspace.');
			const runtime = yield* Effect.tryPromise(() => import(pathToFileURL(runtimeEntry).href));
			const requireFromWorkspace = createRequire(path.join(workspace, 'package.json'));
			const [protocolModule, workspaceEffect] = yield* Effect.all(
				[
					Effect.tryPromise(
						() =>
							import(pathToFileURL(requireFromWorkspace.resolve('@norbital-ai/bolt-protocol')).href)
					),
					Effect.tryPromise(
						() => import(pathToFileURL(requireFromWorkspace.resolve('effect')).href)
					)
				],
				{ concurrency: 'unbounded' }
			);
			const decoded = yield* Effect.tryPromise(() =>
				workspaceEffect.Effect.runPromise(protocolModule.decodeBoltBundleModule(runtime))
			);
			const inspected = yield* Effect.try(() =>
				inspectRuntimeArtifact({
					runtime,
					bundle: decoded,
					artifactVersion: decodeJsonObject(
						readFileSync(path.join(workspace, 'package.json'), 'utf8'),
						`${workspace}/package.json`
					).version
				})
			);
			return {
				$schema: '../release/runtime-smoke.schema.json',
				schemaVersion: 5,
				template: template.slug,
				lockHash: built.depset.lockHash,
				buildCommand: 'bolt sync',
				buildElapsedMilliseconds: Number(built.buildElapsedMilliseconds.toFixed(3)),
				runtimeEntry: '.norbital/artifact/bundle.mjs',
				runtimeEntrySha256: built.runtimeEntrySha256,
				runtimeExports: inspected.runtimeExports,
				manifest: inspected.manifest,
				passed: true
			};
		}),
	({ temporaryDirectory }) =>
		Effect.sync(() => rmSync(temporaryDirectory, { recursive: true, force: true }))
).pipe(
	Effect.tap((result) =>
		Effect.try(() => {
			mkdirSync(path.dirname(outputPath), { recursive: true });
			writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
			console.log(JSON.stringify(result, null, 2));
		})
	),
	Effect.catch((error) =>
		Effect.sync(() => {
			console.error(error);
			process.exitCode = 1;
		})
	)
);

Effect.runFork(smoke);
