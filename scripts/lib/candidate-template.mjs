import { execFileSync } from 'node:child_process';
import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	writeFileSync
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { decodeJsonObject } from './json.mjs';

const candidateArchiveFiles = [
	['@norbital-ai/bolt-protocol', 'bolt-protocol.tgz'],
	['@norbital-ai/std', 'std.tgz'],
	['@norbital-ai/ui', 'ui.tgz'],
	['@norbital-ai/bolt', 'bolt.tgz']
];

function relativeInside(root, candidate, label) {
	const relative = path.relative(root, candidate);
	if (
		relative === '' ||
		relative === '..' ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative)
	) {
		throw new Error(`${label} escapes ${root}: ${candidate}`);
	}
	return relative;
}

function currentRegularFile(templateDirectory, relative) {
	let current = templateDirectory;
	const components = relative.split(path.sep);
	for (const [index, component] of components.entries()) {
		current = path.join(current, component);
		let status;
		try {
			status = lstatSync(current);
		} catch (error) {
			if (error?.code === 'ENOENT') return undefined;
			throw error;
		}
		if (status.isSymbolicLink()) {
			throw new Error(`Template projection refuses symbolic link: ${current}`);
		}
		const isLeaf = index === components.length - 1;
		if (!isLeaf && !status.isDirectory()) {
			throw new Error(`Template projection path component is not a directory: ${current}`);
		}
		if (isLeaf && !status.isFile()) {
			throw new Error(`Template projection refuses non-regular file: ${current}`);
		}
	}
	return current;
}

/** Materialize the effective, nonignored candidate worktree for one template. */
export function materializeCandidateTemplate({ repositoryRoot, template, destination }) {
	const rootStatus = lstatSync(template.directory);
	if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
		throw new Error(`Template root must be a real directory: ${template.directory}`);
	}
	const candidates = [
		...new Set(
			execFileSync(
				'git',
				['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', template.path],
				{ cwd: repositoryRoot, encoding: 'utf8' }
			)
				.split('\0')
				.filter(Boolean)
		)
	];
	let copied = 0;
	for (const candidate of candidates) {
		const source = path.resolve(repositoryRoot, candidate);
		const relative = relativeInside(template.directory, source, 'Template candidate');
		const current = currentRegularFile(template.directory, relative);
		// The index still reports tracked files deleted by the candidate worktree.
		if (current === undefined) continue;
		const target = path.resolve(destination, relative);
		relativeInside(destination, target, 'Template projection target');
		mkdirSync(path.dirname(target), { recursive: true });
		copyFileSync(current, target);
		copied += 1;
	}
	if (copied === 0) throw new Error(`Template ${template.slug} has no candidate files.`);
	return destination;
}

/** Resolve the optional unpublished package set used by pre-publication candidate gates. */
export function candidatePackageArchives(
	directory = process.env.NORBITAL_PACKAGE_ARCHIVES?.trim()
) {
	if (!directory) return [];
	return candidateArchiveFiles.map(([name, filename]) => {
		const archive = path.resolve(directory, filename);
		if (!existsSync(archive)) throw new Error(`Missing package archive: ${archive}`);
		return { name, archive };
	});
}

/** Point only a temporary candidate projection at unpublished package archives. */
export function stageCandidatePackageArchives(destination, archives) {
	if (archives.length === 0) return;
	const manifestPath = path.join(destination, 'package.json');
	const manifest = decodeJsonObject(readFileSync(manifestPath, 'utf8'), manifestPath);
	const specifiers = Object.fromEntries(
		archives.map(({ name, archive }) => [name, `file:${archive}`])
	);
	writeFileSync(
		manifestPath,
		`${JSON.stringify(
			{
				...manifest,
				dependencies: { ...manifest.dependencies, ...specifiers }
			},
			null,
			2
		)}\n`
	);
	const workspacePath = path.join(destination, 'pnpm-workspace.yaml');
	const workspace = readFileSync(workspacePath, 'utf8');
	if (/^overrides:/m.test(workspace)) {
		throw new Error(`${workspacePath} already declares overrides; archive staging is ambiguous.`);
	}
	writeFileSync(
		workspacePath,
		`${workspace.trimEnd()}\n\noverrides:\n${Object.entries(specifiers)
			.map(([name, specifier]) => `  ${JSON.stringify(name)}: ${JSON.stringify(specifier)}`)
			.join('\n')}\n`
	);
}
