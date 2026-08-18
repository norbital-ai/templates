import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Template discovery.
 *
 * A template declares itself by carrying `norbital.template.json` at the root of its own tree,
 * so the metadata travels with the `git subtree split` projection and lands in every tenant fork.
 * Colony reads it from the projected ref; nothing has to stay in sync across two files, and there
 * is no catalogue in this repository either — presence of the manifest is the whole registration.
 *
 * Templates live at the repository root, one directory per key. The directory name is the key,
 * which makes the projection prefix and the published ref name the same string a reader sees.
 */

export const repositoryRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
	'..'
);
export const templateRefNamespace = 'refs/heads/templates';
export const templateMetadataFile = 'norbital.template.json';

const keyPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const countKeys = ['collections', 'apps', 'automations'];

function fail(message) {
	throw new Error(message);
}

function countMatchingFiles(directory, predicate) {
	if (!existsSync(directory)) return 0;
	let count = 0;
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) count += countMatchingFiles(entryPath, predicate);
		else if (entry.isFile() && predicate(entry.name)) count += 1;
	}
	return count;
}

/** Counts derived from the tree, so declared picker metadata cannot drift from reality. */
export function actualCounts(directory) {
	return {
		collections: countMatchingFiles(
			path.join(directory, 'src', 'collections'),
			(filename) => filename === '+model.ts'
		),
		apps: countMatchingFiles(
			path.join(directory, 'src', 'apps'),
			(filename) => filename.startsWith('+') && filename.endsWith('.svelte')
		),
		automations: countMatchingFiles(
			path.join(directory, 'src', 'automation'),
			(filename) => filename.startsWith('+') && filename.endsWith('.ts')
		)
	};
}

function readMetadata(directoryName) {
	const directory = path.join(repositoryRoot, directoryName);
	const metadata = JSON.parse(readFileSync(path.join(directory, templateMetadataFile), 'utf8'));
	if (metadata.schemaVersion !== 1) {
		fail(`${directoryName}/${templateMetadataFile} must use schemaVersion 1.`);
	}
	if (!keyPattern.test(metadata.key)) fail(`Invalid template key: ${metadata.key}`);
	if (metadata.key !== directoryName) {
		fail(`Template ${metadata.key} must live in ${metadata.key}/, not ${directoryName}/.`);
	}
	for (const field of ['name', 'industry', 'description']) {
		if (typeof metadata[field] !== 'string' || metadata[field].trim() === '') {
			fail(`Template ${metadata.key} needs ${field}.`);
		}
	}
	if (!['public', 'unlisted'].includes(metadata.visibility)) {
		fail(`Template ${metadata.key} has invalid visibility.`);
	}
	for (const key of countKeys) {
		if (!Number.isInteger(metadata.counts?.[key]) || metadata.counts[key] < 0) {
			fail(`Template ${metadata.key} has invalid ${key} count.`);
		}
	}
	if (!existsSync(path.join(directory, 'package.json'))) {
		fail(`Template ${metadata.key} has no package.json.`);
	}
	return {
		key: metadata.key,
		path: metadata.key,
		directory,
		ref: `${templateRefNamespace}/${metadata.key}`,
		name: metadata.name,
		industry: metadata.industry,
		description: metadata.description,
		visibility: metadata.visibility,
		counts: { ...metadata.counts }
	};
}

/**
 * Every template in this repository, sorted by key. Presence of `norbital.template.json` on disk
 * is the source of truth — adding a template is adding a directory, not editing a list somewhere
 * else — which is also what keeps repository tooling (`scripts/`, `.github/`) from being mistaken
 * for one.
 */
export function discoverTemplates(filter) {
	const directories = readdirSync(repositoryRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
		.map((entry) => entry.name)
		.filter((name) => existsSync(path.join(repositoryRoot, name, templateMetadataFile)))
		.sort();
	if (directories.length === 0) fail('No templates found.');
	const templates = directories
		.map((entry) => readMetadata(entry))
		.filter((template) => filter === undefined || template.key === filter);
	if (templates.length === 0) fail(`No template matched ${filter}.`);
	return templates;
}
