import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { Result } from 'effect';
import { decodeJsonObject, decodeJsonString } from './lib/json.mjs';

const bundleRoot = path.resolve(process.argv[2] ?? 'dist/template-bundles');
const registry = process.env.NORBITAL_PACKAGE_REGISTRY ?? 'https://npm.pkg.github.com';

function run(command, arguments_, options = {}) {
	const output = execFileSync(command, arguments_, {
		encoding: 'utf8',
		stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
		...options
	});
	return typeof output === 'string' ? output.trim() : '';
}

function manifest(directory, filename = 'package.json') {
	return decodeJsonObject(
		readFileSync(path.join(directory, filename), 'utf8'),
		path.join(directory, filename)
	);
}

function packageExists(name, version) {
	const viewed = Result.try(
		() =>
			decodeJsonString(
				run('npm', ['view', `${name}@${version}`, 'version', '--json', `--registry=${registry}`]),
				`npm view ${name}@${version} version --json`
			) === version
	);
	if (Result.isSuccess(viewed)) return viewed.success;
	const detail = `${viewed.failure?.stdout ?? ''}\n${viewed.failure?.stderr ?? ''}`;
	if (/E404|404 Not Found|npm error code E404/.test(detail)) return false;
	throw viewed.failure;
}

function assertPublishedBundleMatches(directory, name, version) {
	const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'norbital-template-bundle-'));
	const verified = Result.try(() => {
		const packed = run('npm', [
			'pack',
			`${name}@${version}`,
			'--silent',
			`--registry=${registry}`,
			`--pack-destination=${temporaryDirectory}`
		])
			.split(/\s+/)
			.at(-1);
		if (!packed) throw new Error(`npm pack returned no archive for ${name}@${version}.`);
		const archive = path.isAbsolute(packed) ? packed : path.join(temporaryDirectory, packed);
		run('tar', ['-xzf', archive, '-C', temporaryDirectory]);
		const current = manifest(directory, 'norbital.template-build.json');
		const published = manifest(
			path.join(temporaryDirectory, 'package'),
			'norbital.template-build.json'
		);
		const keys = [
			'templateSlug',
			'templateHandle',
			'sourceCommit',
			'bundleFormatVersion',
			'lockHash',
			'boltVersion',
			'packageKey',
			'bundleSha256',
			'bundleBytes'
		];
		const mismatch = keys.find((key) => published[key] !== current[key]);
		if (mismatch) {
			throw new Error(
				`${name}@${version} already exists with a different ${mismatch}. ` +
					'Package versions are immutable: intentionally delete that version, then rerun this workflow.'
			);
		}
		console.log(`${name}@${version} already contains this exact build; skipping publish.`);
	});
	rmSync(temporaryDirectory, { recursive: true, force: true });
	if (Result.isFailure(verified)) throw verified.failure;
}

if (!existsSync(bundleRoot) || !statSync(bundleRoot).isDirectory()) {
	throw new Error(`Bundle directory does not exist: ${bundleRoot}`);
}

for (const entry of readdirSync(bundleRoot, { withFileTypes: true })) {
	if (!entry.isDirectory()) continue;
	const directory = path.join(bundleRoot, entry.name);
	const { name, version } = manifest(directory);
	if (packageExists(name, version)) {
		assertPublishedBundleMatches(directory, name, version);
	} else {
		run('npm', ['publish', directory, `--registry=${registry}`, '--tag', 'template-build'], {
			stdio: 'inherit'
		});
	}
	run('npm', ['view', `${name}@${version}`, 'dist.integrity', `--registry=${registry}`]);
}
