/**
 * Point the templates at the Bolt packages in the local yalc store.
 *
 * A template compiles with its own pinned Bolt — `bolt sync` runs the CLI out of the template's
 * node_modules — so a push that only reaches `.yalc/` leaves the next sync compiling against the
 * previous build. `pnpm install` is what moves it across; see `oss/scripts/lib/yalc-consumers.mjs`.
 *
 *   --template=<key>   just that one, instead of every template
 *   --skip-publish     the caller already published this run (see the realm-level `dev` command)
 *   --force            install even where node_modules already holds the pushed build
 *   --retreat          undo, restoring the templates to the registry versions
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	ensurePureInstallation,
	managedPackages,
	stalePackages
} from '../../oss/scripts/lib/yalc-consumers.mjs';
import { discoverTemplates, repositoryRoot } from './lib/templates.mjs';

const ossRoot = path.resolve(repositoryRoot, '../oss');
const yalcBin = path.join(ossRoot, 'node_modules/.bin/yalc');
const retreat = process.argv.includes('--retreat');
const force = process.argv.includes('--force');
const templateFilter = process.argv.find((argument) => argument.startsWith('--template='))?.slice(11);
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
	templateFilter === undefined ? true : template.key === templateFilter
);
if (templates.length === 0) {
	throw new Error(`No template matches --template=${templateFilter}`);
}

for (const template of templates) {
	if (retreat) {
		run(yalcBin, ['retreat', '--all'], template.directory);
		continue;
	}
	const packages = managedPackages(template.directory);
	const migrated = ensurePureInstallation({
		consumerDirectory: template.directory,
		names: packages,
		yalcBin,
		run
	});
	const stale = stalePackages(template.directory, packages);
	if (!force && migrated.length === 0 && stale.length === 0) {
		console.log(`${template.key}: already compiles against the linked build.`);
		continue;
	}
	run('pnpm', ['install', '--config.strict-dep-builds=false'], template.directory);
	console.log(`${template.key}: linked ${stale.length > 0 ? stale.join(', ') : 'the Bolt packages'}.`);
}
