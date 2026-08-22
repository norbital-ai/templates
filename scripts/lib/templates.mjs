import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeJsonObject } from './json.mjs';

/**
 * Template discovery.
 *
 * A template declares itself by carrying `norbital.template.json` at the root of its own tree,
 * so the metadata travels with the `git subtree split` projection and lands in every tenant fork.
 * Colony reads it from the projected ref; nothing has to stay in sync across two files, and there
 * is no catalogue in this repository either — presence of the manifest is the whole registration.
 *
 * **Two names, two axes.** A template has a `slug` and a `handle`, and they are deliberately not the
 * same string:
 *
 *   - `slug` is the directory this template occupies at the repository root. It is what
 *     `git subtree split --prefix=` splits, what the published ref is named after, what the website
 *     serves `/templates/<slug>` from, and what the standalone build package is named after. It is a
 *     *repository* fact, and renaming it rewrites published refs and public URLs.
 *   - `handle` is the manifest's `key`: the organization handle a Colony host provisions the
 *     workspace under, which is also its tenant id and the string a person types on `/login`. It is
 *     a *product* fact, and it is the one the `norbital_*` scheme names.
 *
 * These used to be one string, enforced by a check that a template must live in `<key>/`. That check
 * is gone on purpose: `norbital_hr` is the handle of the template in `hr-payroll/`, and requiring the
 * directory to follow would have moved every published ref and every `norbital.ai/templates/*` URL
 * for a rename that is only about what an organization is called.
 *
 * Nothing in this repository consumes the handle — every script here works in slugs, because every
 * script here works on directories. It is validated and projected so the value a host will resolve
 * a tenant by cannot be malformed and reach production unnoticed.
 */

export const repositoryRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
	'..'
);
export const templateRefNamespace = 'refs/heads/templates';
export const templateMetadataFile = 'norbital.template.json';
export const templateBundleVersion = '0.0.1';
export const templateBundlePublishAccess = 'public';

export function templateBundlePackageManifest(template) {
	return {
		name: `@norbital-ai/bolt-template-${template.slug}`,
		version: templateBundleVersion,
		private: false,
		license: 'UNLICENSED',
		files: ['bundle.tar', 'norbital.template-build.json'],
		publishConfig: { access: templateBundlePublishAccess }
	};
}

/** A repository directory name, and so also a ref name, a URL path segment and a package suffix. */
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/**
 * An organization handle. Underscores are the whole reason this differs from `slugPattern`: the
 * handles are `norbital_hr`, `norbital_bca` and the rest, and a kebab-only pattern rejected every
 * one of them.
 */
const handlePattern = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;
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
			path.join(directory, 'src', 'automations'),
			(filename) => filename.startsWith('+') && filename.endsWith('.ts')
		)
	};
}

function readMetadata(slug) {
	const directory = path.join(repositoryRoot, slug);
	const metadata = decodeJsonObject(
		readFileSync(path.join(directory, templateMetadataFile), 'utf8'),
		`${slug}/${templateMetadataFile}`
	);
	if (metadata.schemaVersion !== 1) {
		fail(`${slug}/${templateMetadataFile} must use schemaVersion 1.`);
	}
	if (!slugPattern.test(slug)) fail(`Invalid template directory name: ${slug}`);
	// The manifest `key` is the organization handle, not this directory. It is checked here because
	// this is the only place that reads the manifest at all, and a malformed handle is not something
	// to discover on a host — it presents there as a workspace nobody can sign in to.
	if (typeof metadata.key !== 'string' || !handlePattern.test(metadata.key)) {
		fail(`Template ${slug} has an invalid organization handle: ${metadata.key}`);
	}
	for (const field of ['name', 'industry', 'description']) {
		if (typeof metadata[field] !== 'string' || metadata[field].trim() === '') {
			fail(`Template ${slug} needs ${field}.`);
		}
	}
	if (!['public', 'unlisted'].includes(metadata.visibility)) {
		fail(`Template ${slug} has invalid visibility.`);
	}
	for (const key of countKeys) {
		if (!Number.isInteger(metadata.counts?.[key]) || metadata.counts[key] < 0) {
			fail(`Template ${slug} has invalid ${key} count.`);
		}
	}
	if (!existsSync(path.join(directory, 'package.json'))) {
		fail(`Template ${slug} has no package.json.`);
	}
	return {
		slug,
		handle: metadata.key,
		path: slug,
		directory,
		ref: `${templateRefNamespace}/${slug}`,
		name: metadata.name,
		industry: metadata.industry,
		description: metadata.description,
		visibility: metadata.visibility,
		counts: { ...metadata.counts }
	};
}

/**
 * Every template in this repository, sorted by slug. Presence of `norbital.template.json` on disk
 * is the source of truth — adding a template is adding a directory, not editing a list somewhere
 * else — which is also what keeps repository tooling (`scripts/`, `.github/`) from being mistaken
 * for one.
 *
 * `filter` matches either name a person might have: the directory (`--template=hr-payroll`) or the
 * organization handle (`--template=norbital_hr`). Accepting only one of them would mean the string
 * printed by the tooling and the string printed by a running host are not interchangeable, and the
 * one that failed would fail as "no such template" rather than as the wrong axis.
 */
export function discoverTemplates(filter) {
	const directories = [];
	for (const entry of readdirSync(repositoryRoot, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
		if (existsSync(path.join(repositoryRoot, entry.name, templateMetadataFile))) {
			directories.push(entry.name);
		}
	}
	directories.sort();
	if (directories.length === 0) fail('No templates found.');
	const templates = directories
		.map((entry) => readMetadata(entry))
		.filter(
			(template) => filter === undefined || template.slug === filter || template.handle === filter
		);
	if (templates.length === 0) fail(`No template matched ${filter}.`);
	return templates;
}
