/**
 * Template repo CI. Four verbs: check, lock, verify, publish.
 *
 * Run with `node --experimental-strip-types scripts/ci.ts <verb>`.
 * Templates are not workspace members — each pins published `@norbital-ai/*` and ships via
 * `git subtree split` to `refs/heads/templates/<slug>`.
 */
import { execFileSync } from 'node:child_process';
import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { glob } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const templateMetadataFile = 'norbital.template.json';
export const templateRefNamespace = 'refs/heads/templates';

export type TemplateCounts = {
	readonly collections: number;
	readonly apps: number;
	readonly automations: number;
};

export type Template = {
	readonly slug: string;
	readonly handle: string;
	readonly path: string;
	readonly directory: string;
	readonly ref: string;
	readonly name: string;
	readonly industry: string;
	readonly description: string;
	readonly visibility: string;
	readonly counts: TemplateCounts;
};

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const handlePattern = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;
const revisionPattern = /^[0-9a-f]{40}$/;
const localDependency = /^(?:workspace|catalog|file|link|portal):/;
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const fail = (message: string): never => {
	throw new Error(message);
};

export const readJson = (file: string): Record<string, unknown> => {
	const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		fail(`${file} must contain a JSON object.`);
	}
	return value;
};

const run = (
	command: string,
	args: readonly string[],
	options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv } = {}
): string => {
	try {
		return execFileSync(command, [...args], {
			cwd: options.cwd ?? repositoryRoot,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			env: options.env ?? process.env
		}).trim();
	} catch (error: unknown) {
		const detail =
			error !== null &&
			typeof error === 'object' &&
			'stderr' in error &&
			typeof error.stderr === 'string'
				? error.stderr.trim()
				: error instanceof Error
					? error.message
					: String(error);
		fail(`${command} ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`);
	}
};

export const registryConfiguration = (): string => {
	const registry = (
		process.env['NORBITAL_PACKAGE_REGISTRY'] ?? 'https://npm.pkg.github.com'
	).trim();
	const lines = [`@norbital-ai:registry=${registry}`];
	const token = process.env['NODE_AUTH_TOKEN']?.trim();
	if (token !== undefined && token.length > 0) {
		lines.push(`//${new URL(registry).host}/:_authToken=${token}`);
	}
	return `${lines.join('\n')}\n`;
};

const countFiles = async (directory: string, pattern: string): Promise<number> => {
	let count = 0;
	for await (const entry of glob(pattern, { cwd: directory, withFileTypes: true })) {
		if (entry.isFile()) count += 1;
	}
	return count;
};

export const actualCounts = async (directory: string): Promise<TemplateCounts> => {
	const [collections, apps, automations] = await Promise.all([
		countFiles(path.join(directory, 'src', 'collections'), '**/+model.ts'),
		countFiles(path.join(directory, 'src', 'apps'), '**/+*.svelte'),
		countFiles(path.join(directory, 'src', 'automations'), '**/+*.ts')
	]);
	return { collections, apps, automations };
};

const readTemplate = (slug: string): Template => {
	const directory = path.join(repositoryRoot, slug);
	const metadata = readJson(path.join(directory, templateMetadataFile));
	if (metadata['schemaVersion'] !== 1)
		fail(`${slug}/${templateMetadataFile} must use schemaVersion 1.`);
	if (!slugPattern.test(slug)) fail(`Invalid template directory name: ${slug}`);
	const handle = metadata['key'];
	if (typeof handle !== 'string' || !handlePattern.test(handle)) {
		fail(`Template ${slug} has an invalid organization handle: ${handle}`);
	}
	for (const field of ['name', 'industry', 'description'] as const) {
		const value = metadata[field];
		if (typeof value !== 'string' || value.trim() === '') fail(`Template ${slug} needs ${field}.`);
	}
	if (metadata['visibility'] !== 'public' && metadata['visibility'] !== 'unlisted') {
		fail(`Template ${slug} has invalid visibility.`);
	}
	const countsRaw = metadata['counts'];
	if (countsRaw === null || typeof countsRaw !== 'object' || Array.isArray(countsRaw)) {
		fail(`Template ${slug} has invalid counts.`);
	}
	const counts = countsRaw as Record<string, unknown>;
	for (const key of ['collections', 'apps', 'automations'] as const) {
		if (!Number.isInteger(counts[key]) || Number(counts[key]) < 0) {
			fail(`Template ${slug} has invalid ${key} count.`);
		}
	}
	if (!existsSync(path.join(directory, 'package.json')))
		fail(`Template ${slug} has no package.json.`);
	return {
		slug,
		handle,
		path: slug,
		directory,
		ref: `${templateRefNamespace}/${slug}`,
		name: String(metadata['name']),
		industry: String(metadata['industry']),
		description: String(metadata['description']),
		visibility: String(metadata['visibility']),
		counts: {
			collections: Number(counts['collections']),
			apps: Number(counts['apps']),
			automations: Number(counts['automations'])
		}
	};
};

export const discoverTemplates = (filter?: string): Template[] => {
	const slugs = readdirSync(repositoryRoot, { withFileTypes: true })
		.filter(
			(entry) =>
				entry.isDirectory() &&
				!entry.name.startsWith('.') &&
				existsSync(path.join(repositoryRoot, entry.name, templateMetadataFile))
		)
		.map((entry) => entry.name)
		.sort();
	if (slugs.length === 0) fail('No templates found.');
	const templates = slugs
		.map(readTemplate)
		.filter(
			(template) => filter === undefined || template.slug === filter || template.handle === filter
		);
	if (templates.length === 0) fail(`No template matched ${filter}.`);
	return templates;
};

const validateManifest = (template: Template): void => {
	const manifest = readJson(path.join(template.directory, 'package.json'));
	if (manifest['private'] !== true)
		fail(`Template ${template.slug} must remain a private application package.`);
	const scripts = manifest['scripts'];
	if (scripts === null || typeof scripts !== 'object' || Array.isArray(scripts)) {
		fail(`Template ${template.slug} needs scripts.`);
	}
	for (const script of ['lint', 'sync']) {
		const value = (scripts as Record<string, unknown>)[script];
		if (typeof value !== 'string' || value === '')
			fail(`Template ${template.slug} needs a ${script} script.`);
	}
	for (const section of [
		'dependencies',
		'devDependencies',
		'optionalDependencies',
		'peerDependencies'
	]) {
		const block = manifest[section];
		if (block === null || typeof block !== 'object' || Array.isArray(block)) continue;
		for (const [name, version] of Object.entries(block)) {
			if (typeof version === 'string' && localDependency.test(version)) {
				fail(
					`Template ${template.slug} cannot project ${section}.${name} with local protocol ${version}.`
				);
			}
		}
	}
	const dependencies = manifest['dependencies'];
	const bolt =
		dependencies !== null && typeof dependencies === 'object' && !Array.isArray(dependencies)
			? (dependencies as Record<string, unknown>)['@norbital-ai/bolt']
			: undefined;
	if (typeof bolt !== 'string' || !exactVersion.test(bolt)) {
		fail(`Template ${template.slug} must pin @norbital-ai/bolt to an exact version.`);
	}
	const dev = manifest['devDependencies'];
	if (dev === null || typeof dev !== 'object' || Array.isArray(dev)) {
		fail(`Template ${template.slug} needs standalone devDependencies.`);
	}
	for (const dependency of ['prettier', 'prettier-plugin-svelte', 'svelte-check', 'typescript']) {
		if (typeof (dev as Record<string, unknown>)[dependency] !== 'string') {
			fail(`Template ${template.slug} needs standalone dev dependency ${dependency}.`);
		}
	}
};

export const checkTemplates = async (filter?: string): Promise<void> => {
	const templates = discoverTemplates(filter);
	for (const template of templates) {
		validateManifest(template);
		const actual = await actualCounts(template.directory);
		for (const key of ['collections', 'apps', 'automations'] as const) {
			if (template.counts[key] !== actual[key]) {
				fail(
					`Template ${template.slug} declares ${String(template.counts[key])} ${key} in ${templateMetadataFile}; found ${String(actual[key])}.`
				);
			}
		}
	}
	console.log(`Validated ${String(templates.length)} template declarations.`);
};

const git = (args: readonly string[]): string => run('git', args);

const projectTemplate = (template: Template, sourceRevision: string): string => {
	const output = git(['subtree', 'split', `--prefix=${template.path}`, sourceRevision]);
	const revision = output.split(/\s+/).at(-1);
	if (revision === undefined || !revisionPattern.test(revision)) {
		fail(`Projection for ${template.slug} did not produce a commit revision.`);
	}
	return revision;
};

const originUrl = (): string | undefined => {
	try {
		const url = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
			cwd: repositoryRoot,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore']
		}).trim();
		return url.length > 0 ? url : undefined;
	} catch {
		return undefined;
	}
};

const publishTemplates = (options: {
	readonly output?: string;
	readonly push?: string;
	readonly updateLocal: boolean;
	readonly sourceRevision: string;
	readonly repository?: string;
}): void => {
	const sourceRevision = git(['rev-parse', '--verify', `${options.sourceRevision}^{commit}`]);
	const sourceRepository = options.repository ?? originUrl();
	if (options.output !== undefined && sourceRepository === undefined) {
		fail('A source repository is required for output; pass --repository <url>.');
	}
	const entries = discoverTemplates().map((template) => {
		const revision = projectTemplate(template, sourceRevision);
		if (options.updateLocal) git(['update-ref', template.ref, revision]);
		console.log(`${template.slug}: ${template.ref} -> ${revision}`);
		return {
			slug: template.slug,
			handle: template.handle,
			ref: template.ref,
			revision,
			name: template.name,
			industry: template.industry,
			description: template.description,
			visibility: template.visibility,
			counts: template.counts
		};
	});
	if (options.push !== undefined) {
		git([
			'push',
			'--atomic',
			options.push,
			...entries.map((entry) => `${entry.revision}:${entry.ref}`)
		]);
	}
	if (options.output !== undefined) {
		const outputPath = path.isAbsolute(options.output)
			? options.output
			: path.resolve(repositoryRoot, options.output);
		mkdirSync(path.dirname(outputPath), { recursive: true });
		writeFileSync(
			outputPath,
			`${JSON.stringify({ schemaVersion: 1, source: { repository: sourceRepository, revision: sourceRevision }, entries }, null, 2)}\n`
		);
		console.log(`Wrote ${outputPath}.`);
	}
};

export const resolveLockfile = (template: Template, execute = run): string => {
	const workingDirectory = mkdtempSync(path.join(tmpdir(), `norbital-lock-${template.slug}-`));
	try {
		copyFileSync(
			path.join(template.directory, 'package.json'),
			path.join(workingDirectory, 'package.json')
		);
		copyFileSync(
			path.join(template.directory, 'pnpm-workspace.yaml'),
			path.join(workingDirectory, 'pnpm-workspace.yaml')
		);
		const committed = path.join(template.directory, 'pnpm-lock.yaml');
		if (existsSync(committed))
			copyFileSync(committed, path.join(workingDirectory, 'pnpm-lock.yaml'));
		writeFileSync(path.join(workingDirectory, '.npmrc'), registryConfiguration());
		execute(
			'pnpm',
			[
				'install',
				'--lockfile-only',
				'--no-frozen-lockfile',
				'--store-dir',
				path.join(workingDirectory, '.pnpm-store'),
				'--cache-dir',
				path.join(workingDirectory, '.pnpm-cache')
			],
			{ cwd: workingDirectory }
		);
		const resolved = path.join(workingDirectory, 'pnpm-lock.yaml');
		if (!existsSync(resolved)) fail(`Resolving ${template.slug} produced no pnpm-lock.yaml.`);
		return readFileSync(resolved, 'utf8');
	} finally {
		rmSync(workingDirectory, { recursive: true, force: true });
	}
};

const verifyOfflineInstall = (
	template: Template,
	lockfile: string,
	storeDirectory: string
): void => {
	const workingDirectory = mkdtempSync(path.join(tmpdir(), `norbital-verify-${template.slug}-`));
	try {
		copyFileSync(
			path.join(template.directory, 'package.json'),
			path.join(workingDirectory, 'package.json')
		);
		copyFileSync(
			path.join(template.directory, 'pnpm-workspace.yaml'),
			path.join(workingDirectory, 'pnpm-workspace.yaml')
		);
		writeFileSync(path.join(workingDirectory, 'pnpm-lock.yaml'), lockfile);
		const npmrc = path.join(workingDirectory, '.npmrc');
		writeFileSync(npmrc, registryConfiguration());
		run('pnpm', ['fetch', '--frozen-lockfile', '--store-dir', storeDirectory], {
			cwd: workingDirectory
		});
		rmSync(npmrc, { force: true });
		run(
			'pnpm',
			[
				'install',
				'--frozen-lockfile',
				'--offline',
				'--ignore-scripts',
				'--store-dir',
				storeDirectory
			],
			{ cwd: workingDirectory }
		);
	} finally {
		rmSync(workingDirectory, { recursive: true, force: true });
	}
};

const lockTemplates = (options: {
	readonly check: boolean;
	readonly verifyInstall: boolean;
	readonly filter?: string;
}): void => {
	const templates = discoverTemplates(options.filter);
	const drifted: string[] = [];
	const store = options.verifyInstall
		? mkdtempSync(path.join(tmpdir(), 'norbital-verify-store-'))
		: undefined;
	try {
		for (const template of templates) {
			const committedPath = path.join(template.directory, 'pnpm-lock.yaml');
			const resolved = resolveLockfile(template);
			const committed = existsSync(committedPath) ? readFileSync(committedPath, 'utf8') : undefined;
			if (options.check) {
				if (committed === undefined) drifted.push(`${template.slug}: missing pnpm-lock.yaml`);
				else if (committed !== resolved) {
					drifted.push(`${template.slug}: pnpm-lock.yaml does not match resolved dependencies`);
				} else console.log(`${template.slug}: up to date`);
			} else if (committed === resolved) {
				console.log(`${template.slug}: unchanged`);
			} else {
				writeFileSync(committedPath, resolved);
				console.log(`${template.slug}: wrote ${path.relative(repositoryRoot, committedPath)}`);
			}
			if (store !== undefined) {
				verifyOfflineInstall(template, resolved, store);
				console.log(`${template.slug}: offline install from a warm store`);
			}
		}
	} finally {
		if (store !== undefined) rmSync(store, { recursive: true, force: true });
	}
	if (drifted.length > 0)
		fail(`Template lockfiles are stale. Run \`pnpm templates:lock\`.\n  ${drifted.join('\n  ')}`);
};

const inside = (root: string, candidate: string, label: string): string => {
	const relative = path.relative(root, candidate);
	if (
		relative === '' ||
		relative === '..' ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative)
	) {
		fail(`${label} escapes ${root}: ${candidate}`);
	}
	return relative;
};

const materializeCandidate = (template: Template, destination: string): void => {
	const rootStatus = lstatSync(template.directory);
	if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
		fail(`Template root must be a real directory: ${template.directory}`);
	}
	const candidates = [
		...new Set(
			run('git', [
				'ls-files',
				'-z',
				'--cached',
				'--others',
				'--exclude-standard',
				'--',
				template.path
			]).split('\0')
		)
	].filter(Boolean);
	let copied = 0;
	for (const candidate of candidates) {
		const source = path.resolve(repositoryRoot, candidate);
		const relative = inside(template.directory, source, 'Template candidate');
		const parts = relative.split(path.sep);
		let current = template.directory;
		let missing = false;
		for (const [index, component] of parts.entries()) {
			current = path.join(current, component);
			if (!existsSync(current)) {
				missing = true;
				break;
			}
			const status = lstatSync(current);
			if (status.isSymbolicLink()) fail(`Template projection refuses symbolic link: ${current}`);
			const leaf = index === parts.length - 1;
			if (!leaf && !status.isDirectory())
				fail(`Template projection path component is not a directory: ${current}`);
			if (leaf && !status.isFile())
				fail(`Template projection refuses non-regular file: ${current}`);
		}
		if (missing) continue;
		const target = path.resolve(destination, relative);
		inside(destination, target, 'Template projection target');
		mkdirSync(path.dirname(target), { recursive: true });
		copyFileSync(current, target);
		copied += 1;
	}
	if (copied === 0) fail(`Template ${template.slug} has no candidate files.`);
};

const verifyTemplates = (filter?: string): void => {
	const root = mkdtempSync(path.join(tmpdir(), 'norbital-template-projections-'));
	try {
		for (const template of discoverTemplates(filter)) {
			const destination = path.join(root, template.slug);
			mkdirSync(destination, { recursive: true });
			materializeCandidate(template, destination);
			writeFileSync(path.join(destination, '.npmrc'), registryConfiguration());
			const pnpm = (label: string, args: readonly string[]): void => {
				try {
					run('pnpm', args, { cwd: destination });
				} catch (error: unknown) {
					fail(
						`${template.slug} standalone ${label} failed${error instanceof Error ? `: ${error.message}` : ''}`
					);
				}
			};
			pnpm('install', ['install', '--frozen-lockfile']);
			pnpm('sync', ['sync']);
			const artifact = path.join(destination, '.norbital', 'artifact', 'bundle.mjs');
			if (!existsSync(artifact)) fail(`${template.slug} bolt sync emitted no ${artifact}.`);
			pnpm('lint', ['lint']);
			console.log(`Validated clean standalone projection: ${template.slug}.`);
		}
	} finally {
		if (process.env['KEEP_TEMPLATE_PROJECTIONS'] === '1') {
			console.log(`Kept standalone projections at ${root}.`);
		} else {
			rmSync(root, { recursive: true, force: true });
		}
	}
};

const flag = (values: Record<string, unknown>, name: string): string | undefined => {
	const value = values[name];
	if (value === undefined) return undefined;
	if (typeof value !== 'string' || value === '') fail(`--${name} requires a value.`);
	return value;
};

const main = async (): Promise<void> => {
	const command = process.argv[2];
	const { values } = parseArgs({
		args: process.argv.slice(3),
		options: {
			check: { type: 'boolean' },
			'verify-install': { type: 'boolean' },
			filter: { type: 'string' },
			output: { type: 'string' },
			push: { type: 'string' },
			'update-local': { type: 'boolean' },
			'source-revision': { type: 'string' },
			repository: { type: 'string' }
		},
		strict: true,
		allowPositionals: false
	});
	switch (command) {
		case 'check':
			await checkTemplates(flag(values, 'filter'));
			return;
		case 'lock':
			lockTemplates({
				check: values.check === true,
				verifyInstall: values['verify-install'] === true,
				...(flag(values, 'filter') === undefined ? {} : { filter: flag(values, 'filter') })
			});
			return;
		case 'verify':
			verifyTemplates(flag(values, 'filter'));
			return;
		case 'publish':
			await checkTemplates();
			publishTemplates({
				updateLocal: values['update-local'] === true,
				sourceRevision: flag(values, 'source-revision') ?? 'HEAD',
				...(flag(values, 'output') === undefined ? {} : { output: flag(values, 'output') }),
				...(flag(values, 'push') === undefined ? {} : { push: flag(values, 'push') }),
				...(flag(values, 'repository') === undefined
					? {}
					: { repository: flag(values, 'repository') })
			});
			return;
		default:
			fail('Usage: ci.ts <check|lock|verify|publish> [flags]');
	}
};

const invoked =
	process.argv[1] !== undefined &&
	pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
