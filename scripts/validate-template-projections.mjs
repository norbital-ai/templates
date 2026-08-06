import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'norbital-template-projections-'));

try {
	for (const template of discoverTemplates(process.argv[2])) {
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
				run('pnpm', arguments_, { cwd: destination });
			} catch (cause) {
				const detail = [cause?.stdout, cause?.stderr].filter(Boolean).join('\n').trim();
				throw new Error(
					`${template.key} standalone ${label} failed${detail ? `:\n${detail}` : '.'}`
				);
			}
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
