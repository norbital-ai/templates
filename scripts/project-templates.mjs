import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Result } from 'effect';
import { decodeJsonObject } from './lib/json.mjs';
import {
	actualCounts,
	discoverTemplates,
	repositoryRoot,
	templateMetadataFile
} from './lib/templates.mjs';

const revisionPattern = /^[0-9a-f]{40}$/;
const localDependencyProtocol = /^(?:workspace|catalog|file|link|portal):/;
const dependencySections = [
	'dependencies',
	'devDependencies',
	'optionalDependencies',
	'peerDependencies'
];

function fail(message) {
	throw new Error(message);
}

/** Arguments that consume the next token, mapped to the option they set. */
const valueArguments = new Map([
	['--push', 'pushRemote'],
	['--output', 'output'],
	['--source-revision', 'sourceRevision'],
	['--repository', 'repository']
]);

function readArguments(argv) {
	const options = {
		check: false,
		updateLocal: false,
		pushRemote: undefined,
		output: undefined,
		sourceRevision: 'HEAD',
		repository: undefined
	};
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === '--check') {
			options.check = true;
			continue;
		}
		if (argument === '--update-local') {
			options.updateLocal = true;
			continue;
		}
		const optionKey = valueArguments.get(argument);
		if (optionKey === undefined) fail(`Unknown argument: ${argument}`);
		options[optionKey] = argv[++index];
	}
	if (!options.check && !options.updateLocal && !options.pushRemote && !options.output) {
		fail('Choose --check, --update-local, --push <remote>, or --output <path>.');
	}
	if (options.pushRemote === '') fail('--push requires a remote name or URL.');
	if (options.output === '') fail('--output requires a path.');
	return options;
}

function runGit(arguments_, options = {}) {
	const executed = Result.try(() =>
		execFileSync('git', arguments_, {
			cwd: repositoryRoot,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
			...options
		}).trim()
	);
	if (Result.isSuccess(executed)) return executed.success;
	const detail = executed.failure?.stderr?.toString().trim();
	fail(`git ${arguments_.join(' ')} failed${detail ? `: ${detail}` : ''}`);
}

/** The `origin` URL, or undefined when this clone has none. Absence is not an error. */
function originUrl() {
	return Result.getOrElse(
		Result.try(
			() =>
				execFileSync('git', ['config', '--get', 'remote.origin.url'], {
					cwd: repositoryRoot,
					encoding: 'utf8',
					stdio: ['ignore', 'pipe', 'ignore']
				}).trim() || undefined
		),
		() => undefined
	);
}

function validateStandaloneManifest(template) {
	const manifest = decodeJsonObject(
		readFileSync(path.join(template.directory, 'package.json'), 'utf8'),
		`${template.directory}/package.json`
	);
	if (!manifest.private)
		fail(`Template ${template.slug} must remain a private application package.`);
	// `bolt sync` now emits the production bundle as well as generated source. There is no separate
	// template-local build command to require or run.
	for (const script of ['lint', 'sync']) {
		if (typeof manifest.scripts?.[script] !== 'string' || manifest.scripts[script] === '') {
			fail(`Template ${template.slug} needs a ${script} script.`);
		}
	}
	const yalcLockPath = path.join(template.directory, 'yalc.lock');
	const yalcOverlay = existsSync(yalcLockPath)
		? decodeJsonObject(readFileSync(yalcLockPath, 'utf8'), yalcLockPath)
		: undefined;
	for (const section of dependencySections) {
		for (const [name, version] of Object.entries(manifest[section] ?? {})) {
			if (!localDependencyProtocol.test(version)) continue;
			const replaced = yalcOverlay?.packages?.[name]?.replaced;
			if (
				typeof version === 'string' &&
				version.startsWith('file:.yalc/') &&
				typeof replaced === 'string' &&
				/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(replaced)
			) {
				continue;
			}
			fail(
				`Template ${template.slug} cannot project ${section}.${name} with local protocol ${version}.`
			);
		}
	}
	// A template pins its own Bolt version. Nothing propagates a bump into it; a developer
	// commits one when they choose to. The only requirement here is that the pin is exact,
	// so the projected tree resolves to the same bytes the committed lockfile describes.
	// A local yalc overlay may rewrite the working-tree dependency to file:.yalc/; the
	// committed pin is the version yalc recorded as `replaced`.
	const boltVersion =
		typeof yalcOverlay?.packages?.['@norbital-ai/bolt']?.replaced === 'string'
			? yalcOverlay.packages['@norbital-ai/bolt'].replaced
			: manifest.dependencies?.['@norbital-ai/bolt'];
	if (typeof boltVersion !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(boltVersion)) {
		fail(`Template ${template.slug} must pin @norbital-ai/bolt to an exact version.`);
	}
	for (const dependency of ['prettier', 'prettier-plugin-svelte', 'svelte-check', 'typescript']) {
		if (typeof manifest.devDependencies?.[dependency] !== 'string') {
			fail(`Template ${template.slug} needs standalone dev dependency ${dependency}.`);
		}
	}
}

function validate(template) {
	validateStandaloneManifest(template);
	const actual = actualCounts(template.directory);
	for (const key of ['collections', 'apps', 'automations']) {
		if (template.counts[key] !== actual[key]) {
			fail(
				`Template ${template.slug} declares ${template.counts[key]} ${key} in ${templateMetadataFile}; found ${actual[key]}.`
			);
		}
	}
}

function projectTemplate(template, sourceRevision) {
	const output = runGit(['subtree', 'split', `--prefix=${template.path}`, sourceRevision]);
	const revision = output.split(/\s+/).at(-1);
	if (!revisionPattern.test(revision)) {
		fail(`Projection for ${template.slug} did not produce a commit revision.`);
	}
	return revision;
}

const options = readArguments(process.argv.slice(2));
const templates = discoverTemplates();
for (const template of templates) validate(template);

if (options.check && !options.updateLocal && !options.pushRemote && !options.output) {
	console.log(`Validated ${templates.length} template declarations.`);
	process.exit(0);
}

const sourceRevision = runGit(['rev-parse', '--verify', `${options.sourceRevision}^{commit}`]);
// Only `--output` records where the projection came from. `git config --get` exits non-zero when
// the key is unset, so reading it through `runGit` turned "this clone has no origin" into a hard
// failure of `--check` and `--update-local`, neither of which needs a URL at all.
const sourceRepository = options.repository ?? originUrl();
if (!sourceRepository && options.output) {
	fail('A source repository is required for output; pass --repository <url>.');
}

const entries = [];
for (const template of templates) {
	const revision = projectTemplate(template, sourceRevision);
	if (options.updateLocal) runGit(['update-ref', template.ref, revision]);
	entries.push({
		// The repository axis (`slug`) and the product axis (`handle`) are both recorded, because a
		// consumer of this file needs one or the other and guessing which is which from a single
		// `key` is what this split exists to stop.
		slug: template.slug,
		handle: template.handle,
		ref: template.ref,
		revision,
		name: template.name,
		industry: template.industry,
		description: template.description,
		visibility: template.visibility,
		counts: template.counts
	});
	console.log(`${template.slug}: ${template.ref} -> ${revision}`);
}

if (options.pushRemote) {
	runGit([
		'push',
		'--atomic',
		options.pushRemote,
		...entries.map((entry) => `${entry.revision}:${entry.ref}`)
	]);
}

if (options.output) {
	const outputPath = path.resolve(repositoryRoot, options.output);
	mkdirSync(path.dirname(outputPath), { recursive: true });
	writeFileSync(
		outputPath,
		`${JSON.stringify(
			{
				schemaVersion: 1,
				source: { repository: sourceRepository, revision: sourceRevision },
				entries
			},
			null,
			2
		)}\n`
	);
	console.log(`Wrote ${path.relative(repositoryRoot, outputPath)}.`);
}
