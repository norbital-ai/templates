/**
 * Point the templates at the Bolt packages in the local yalc store.
 *
 * A template compiles with its own pinned Bolt — `bolt sync` runs the CLI out of the template's
 * node_modules — so a push that only reaches `.yalc/` leaves the next sync compiling against the
 * previous build. `pnpm install` is what moves it across; see `oss/scripts/lib/yalc-consumers.mjs`.
 *
 *   --template=<name>  just that one, instead of every template — its directory
 *                      (`hr-payroll`) or its organization handle (`norbital_hr`)
 *   --skip-publish     the caller already published this run (see the realm-level `dev` command)
 *   --force            install even where node_modules already holds the pushed build
 *   --retreat          undo, restoring the templates to the registry versions
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkConsumers } from '../../oss/scripts/lib/yalc-consumers.mjs';
import { discoverTemplates, repositoryRoot } from './lib/templates.mjs';

const ossRoot = path.resolve(repositoryRoot, '../oss');
const yalcBin = path.join(ossRoot, 'node_modules/.bin/yalc');
const retreat = process.argv.includes('--retreat');
const force = process.argv.includes('--force');
const templateFilter = process.argv
	.find((argument) => argument.startsWith('--template='))
	?.slice(11);
const onlyFlag = process.argv.find((argument) => argument.startsWith('--only='));

const run = (command, args, cwd) => {
	execFileSync(command, args, { cwd, stdio: 'inherit' });
};

if (!retreat && !process.argv.includes('--skip-publish')) {
	run(
		'pnpm',
		[
			'exec',
			'node',
			'scripts/yalc-publish.mjs',
			'--push',
			...(force ? ['--force'] : []),
			...(onlyFlag === undefined ? [] : [onlyFlag])
		],
		ossRoot
	);
}

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
		run(yalcBin, ['retreat', '--all'], template.directory);
		run('pnpm', ['install', '--config.strict-dep-builds=false'], template.directory);
	}
} else {
	const states = linkConsumers({
		consumers: templates.map((template) => ({ ...template, name: template.slug })),
		force,
		yalcBin,
		run,
		install: (changed) => {
			for (const template of changed) {
				run('pnpm', ['install', '--config.strict-dep-builds=false'], template.directory);
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
