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
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
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

function writeTemplateBundle(template, projection, outputDirectory, buildOutput) {
	const packageManifest = JSON.parse(readFileSync(path.join(template.directory, 'package.json')));
	const lockfile = readFileSync(path.join(template.directory, 'pnpm-lock.yaml'));
	const lockHash = sha256(lockfile).slice(0, 32);
	const boltVersion = packageManifest.dependencies?.['@norbital-ai/bolt'];
	if (typeof boltVersion !== 'string' || boltVersion.length === 0) {
		throw new Error(`Template ${template.key} pins no @norbital-ai/bolt version.`);
	}
	const packageDirectory = path.join(outputDirectory, template.key);
	mkdirSync(packageDirectory, { recursive: true });
	const bundlePath = path.join(packageDirectory, 'bundle.tar');
	run('tar', ['-cf', bundlePath, '-C', buildOutput, '.']);
	const bundle = readFileSync(bundlePath);
	const version = `0.0.0-${projection.revision}`;
	writeFileSync(
		path.join(packageDirectory, 'norbital.template-build.json'),
		`${JSON.stringify(
			{
				schemaVersion: 1,
				templateKey: template.key,
				sourceCommit: projection.revision,
				bundleFormatVersion: 1,
				lockHash,
				podVersion,
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
		`${JSON.stringify(
			{
				name: `@norbital-ai/template-bundle-${template.key}`,
				version,
				private: false,
				license: 'UNLICENSED',
				files: ['bundle.tar', 'norbital.template-build.json'],
				publishConfig: { access: 'restricted' }
			},
			null,
			2
		)}\n`
	);
	console.log(`Prepared immutable build package for ${template.key}@${projection.revision}.`);
}

function copyTrackedProjection(template, destination) {
	const trackedFiles = run('git', ['ls-files', '--', template.path])
		.trim()
		.split('\n')
		.filter(Boolean);
	if (trackedFiles.length === 0) throw new Error(`Template ${template.key} has no tracked files.`);
	for (const trackedFile of trackedFiles) {
		const source = path.join(repositoryRoot, trackedFile);
		const relative = path.relative(template.directory, source);
		const target = path.join(destination, relative);
		mkdirSync(path.dirname(target), { recursive: true });
		copyFileSync(source, target);
	}
}

const options = readArguments(process.argv.slice(2));
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'norbital-template-projections-'));
const revisions = options.revisions
	? JSON.parse(readFileSync(path.resolve(repositoryRoot, options.revisions), 'utf8'))
	: null;
const projections = new Map((revisions?.entries ?? []).map((entry) => [entry.key, entry]));
const bundleOutput = options.bundleOutput
	? path.resolve(repositoryRoot, options.bundleOutput)
	: null;
if (bundleOutput) {
	rmSync(bundleOutput, { recursive: true, force: true });
	mkdirSync(bundleOutput, { recursive: true });
}

try {
	for (const template of discoverTemplates(options.filter)) {
		const destination = path.join(temporaryDirectory, template.key);
		mkdirSync(destination, { recursive: true });
		copyTrackedProjection(template, destination);
		writeFileSync(path.join(destination, '.npmrc'), registryConfiguration());
		for (const [label, arguments_] of [
			['install', ['install', '--frozen-lockfile']],
			['sync', ['sync']],
			['lint', ['lint']],
			['build', ['build']]
		]) {
			try {
				const buildOutput = path.join(destination, '.norbital', 'dist', 'output');
				run('pnpm', arguments_, {
					cwd: destination,
					env:
						label === 'build' && bundleOutput
							? {
									...process.env,
									NORBITAL_BUILD_OUT: buildOutput,
									NORBITAL_POD_SYNCED: '1',
									NORBITAL_POD_CHECKED: '1'
								}
							: process.env
				});
			} catch (cause) {
				const detail = [cause?.stdout, cause?.stderr].filter(Boolean).join('\n').trim();
				throw new Error(
					`${template.key} standalone ${label} failed${detail ? `:\n${detail}` : '.'}`
				);
			}
		}
		if (bundleOutput) {
			const projection = projections.get(template.key);
			if (!projection) throw new Error(`No projected revision recorded for ${template.key}.`);
			writeTemplateBundle(
				template,
				projection,
				bundleOutput,
				path.join(destination, '.norbital', 'dist', 'output')
			);
		}
		console.log(`Validated clean standalone projection: ${template.key}.`);
	}
} finally {
	if (process.env.KEEP_TEMPLATE_PROJECTIONS === '1') {
		console.log(`Kept standalone projections at ${temporaryDirectory}.`);
	} else {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
}
