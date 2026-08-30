/**
 * Point the templates at the Bolt packages in the local yalc store.
 *
 * A template compiles with its own pinned Bolt — `bolt sync` runs the CLI out of the template's
 * node_modules — so a push that only reaches `.yalc/` leaves the next sync compiling against the
 * previous build. `pnpm install` is what moves it across; see `oss/scripts/lib/yalc-consumers.mjs`.
 *
 * Internal helper for Norbital's `pnpm run env -- dev` and `pnpm run env -- retreat` only.
 *
 *   --template=<name>  just that one, instead of every template — its directory
 *                      (`hr-payroll`) or its organization handle (`norbital_hr`)
 *   --skip-publish     required for linking; env already published the one candidate build
 *   --force            install even where node_modules already holds the pushed build
 *   --retreat          undo, restoring the templates to the registry versions
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { linkConsumers, resolveYalcStoreDirectory } from '../../oss/scripts/lib/yalc-consumers.mjs';
import { discoverTemplates, repositoryRoot } from './lib/templates.mjs';

const ossRoot = path.resolve(repositoryRoot, '../oss');
const yalcBin = path.join(ossRoot, 'node_modules/.bin/yalc');
const yalcStoreDirectory = resolveYalcStoreDirectory();
const { values: arguments_ } = parseArgs({
	options: {
		retreat: { type: 'boolean' },
		force: { type: 'boolean' },
		template: { type: 'string' },
		'skip-publish': { type: 'boolean' }
	},
	strict: true,
	allowPositionals: false
});
const retreat = arguments_.retreat ?? false;
const force = arguments_.force ?? false;
const templateFilter = arguments_.template;

const run = (command, args, cwd) => {
	execFileSync(command, args, { cwd, stdio: 'inherit' });
};

if (retreat) {
	if (force || templateFilter !== undefined || arguments_['skip-publish'] === true) {
		throw new Error('internal retreat accepts no linker options; use `pnpm run env -- retreat`');
	}
} else if (arguments_['skip-publish'] !== true) {
	throw new Error('yalc linking is internal; use `pnpm run env -- dev`');
}
/**
 * Installs must not depend on a TTY. pnpm asks a person to confirm a modules purge exactly when the
 * yalc link has just rewritten the manifest — which is precisely the automated case this script runs
 * in — so answer "yes" on its behalf by running as CI.
 */
const install = (directory) =>
	execFileSync('pnpm', ['install', '--no-frozen-lockfile', '--config.strict-dep-builds=false'], {
		cwd: directory,
		stdio: 'inherit',
		env: { ...process.env, CI: 'true' }
	});

const templates = discoverTemplates().filter((template) =>
	templateFilter === undefined
		? true
		: template.slug === templateFilter || template.handle === templateFilter
);
if (templates.length === 0) {
	throw new Error(`No template matches --template=${templateFilter}`);
}

if (retreat) {
	for (const template of templates) {
		run(yalcBin, ['--store-folder', yalcStoreDirectory, 'retreat', '--all'], template.directory);
		install(template.directory);
	}
} else {
	const states = linkConsumers({
		consumers: templates.map((template) => ({ ...template, name: template.slug })),
		force,
		yalcBin,
		yalcStoreDirectory,
		run,
		install: (changed) => {
			for (const template of changed) {
				install(template.directory);
			}
		}
	});
	for (const state of states) {
		console.log(
			force || state.prepared.length > 0 || state.stale.length > 0
				? `${state.slug}: linked ${state.stale.length > 0 ? state.stale.join(', ') : 'the Bolt packages'}.`
				: `${state.slug}: already compiles against the linked build.`
		);
	}
}
