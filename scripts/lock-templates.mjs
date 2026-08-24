import { execFileSync } from 'node:child_process';
import {
	copyFileSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { Clock, Effect, Result } from 'effect';
import { registryConfiguration } from './lib/registry.mjs';
import { discoverTemplates, repositoryRoot } from './lib/templates.mjs';

const lockfileName = 'pnpm-lock.yaml';
const workspaceConfigName = 'pnpm-workspace.yaml';

function fail(message) {
	throw new Error(message);
}

/**
 * Wall-clock milliseconds through Effect's `Clock`, so the one measurement this script takes has an
 * injectable source rather than an ambient one.
 */
function currentTimeMillis() {
	return Effect.runSync(Clock.currentTimeMillis);
}

function copyTemplateProject(template, workingDirectory) {
	for (const filename of ['package.json', workspaceConfigName]) {
		copyFileSync(path.join(template.directory, filename), path.join(workingDirectory, filename));
	}
}

function readArguments(argv) {
	const options = { check: false, verifyInstall: false, filter: undefined };
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === '--check') {
			options.check = true;
			continue;
		}
		if (argument === '--verify-install') {
			options.verifyInstall = true;
			continue;
		}
		if (argument === '--filter') {
			options.filter = argv[++index];
			continue;
		}
		fail(`Unknown argument: ${argument}`);
	}
	if (options.filter === '') fail('--filter requires a template key.');
	return options;
}

/**
 * Resolve one template as a standalone project, outside this pnpm workspace, so the
 * lockfile records the published `@norbital-ai/*` archives a projected template installs
 * rather than the workspace links used for local development.
 *
 * Registry credentials are read from ambient npm configuration; only the scope-to-registry
 * mapping is written, and the temporary directory is always removed.
 */
function resolveLockfile(template) {
	const workingDirectory = mkdtempSync(path.join(tmpdir(), `norbital-lock-${template.slug}-`));
	const storeDirectory = path.join(workingDirectory, '.pnpm-store');
	const cacheDirectory = path.join(workingDirectory, '.pnpm-cache');
	const resolution = Result.try(() => {
		copyTemplateProject(template, workingDirectory);
		writeFileSync(path.join(workingDirectory, '.npmrc'), registryConfiguration());
		const installed = Result.try(() =>
			execFileSync(
				'pnpm',
				[
					'install',
					'--lockfile-only',
					'--ignore-workspace',
					'--force',
					'--store-dir',
					storeDirectory,
					'--cache-dir',
					cacheDirectory
				],
				{
					cwd: workingDirectory,
					encoding: 'utf8',
					stdio: ['ignore', 'pipe', 'pipe']
				}
			)
		);
		if (Result.isFailure(installed)) {
			const detail =
				installed.failure?.stderr?.toString().trim() ||
				installed.failure?.stdout?.toString().trim();
			fail(`Resolving ${template.slug} failed${detail ? `:\n${detail}` : ''}`);
		}
		const resolved = path.join(workingDirectory, lockfileName);
		if (!existsSync(resolved)) fail(`Resolving ${template.slug} produced no ${lockfileName}.`);
		return readFileSync(resolved, 'utf8');
	});
	rmSync(workingDirectory, { recursive: true, force: true });
	if (Result.isFailure(resolution)) throw resolution.failure;
	return resolution.success;
}

/**
 * Prove the committed lockfile installs the way an offline host installs it: warm one shared
 * content-addressed store over the network, then install with no network and no registry
 * credentials. A shared store across templates also exercises cross-template package reuse.
 */
function verifyOfflineInstall(template, lockfile, storeDirectory) {
	const workingDirectory = mkdtempSync(path.join(tmpdir(), `norbital-verify-${template.slug}-`));
	const verification = Result.try(() => {
		copyTemplateProject(template, workingDirectory);
		writeFileSync(path.join(workingDirectory, lockfileName), lockfile);
		const npmrcPath = path.join(workingDirectory, '.npmrc');
		writeFileSync(npmrcPath, registryConfiguration());

		const pnpm = (arguments_) =>
			execFileSync('pnpm', arguments_, {
				cwd: workingDirectory,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe']
			});
		const fetched = Result.try(() =>
			pnpm(['fetch', '--frozen-lockfile', '--store-dir', storeDirectory])
		);
		if (Result.isFailure(fetched)) {
			const detail =
				fetched.failure?.stderr?.toString().trim() || fetched.failure?.stdout?.toString().trim();
			fail(`Warming the store for ${template.slug} failed${detail ? `:\n${detail}` : ''}`);
		}
		// Removing credentials before the offline install proves the sandbox needs neither
		// network egress nor registry access once the host store is warm.
		rmSync(npmrcPath, { force: true });
		const started = currentTimeMillis();
		const installed = Result.try(() =>
			pnpm([
				'install',
				'--frozen-lockfile',
				'--offline',
				'--ignore-scripts',
				'--store-dir',
				storeDirectory
			])
		);
		if (Result.isFailure(installed)) {
			const detail =
				installed.failure?.stderr?.toString().trim() ||
				installed.failure?.stdout?.toString().trim();
			fail(`Offline install for ${template.slug} failed${detail ? `:\n${detail}` : ''}`);
		}
		return currentTimeMillis() - started;
	});
	rmSync(workingDirectory, { recursive: true, force: true });
	if (Result.isFailure(verification)) throw verification.failure;
	return verification.success;
}

const options = readArguments(process.argv.slice(2));
const templates = discoverTemplates(options.filter);
const drifted = [];
const verifyStore = options.verifyInstall
	? mkdtempSync(path.join(tmpdir(), 'norbital-verify-store-'))
	: undefined;

for (const template of templates) {
	const committedPath = path.join(template.directory, lockfileName);
	const resolved = resolveLockfile(template);
	const committed = existsSync(committedPath) ? readFileSync(committedPath, 'utf8') : undefined;

	if (options.check) {
		if (committed === undefined) {
			drifted.push(`${template.slug}: missing ${lockfileName}`);
		} else if (committed !== resolved) {
			drifted.push(`${template.slug}: ${lockfileName} does not match resolved dependencies`);
		} else {
			console.log(`${template.slug}: up to date`);
		}
	} else if (committed === resolved) {
		console.log(`${template.slug}: unchanged`);
	} else {
		writeFileSync(committedPath, resolved);
		console.log(`${template.slug}: wrote ${path.relative(repositoryRoot, committedPath)}`);
	}

	if (verifyStore) {
		const elapsed = verifyOfflineInstall(template, resolved, verifyStore);
		console.log(`${template.slug}: offline install from a warm store in ${elapsed} ms`);
	}
}

if (verifyStore) rmSync(verifyStore, { recursive: true, force: true });

if (drifted.length > 0) {
	fail(`Template lockfiles are stale. Run \`pnpm templates:lock\`.\n  ${drifted.join('\n  ')}`);
}
