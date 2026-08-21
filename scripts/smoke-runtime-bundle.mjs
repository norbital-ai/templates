import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { prepareDepset } from './lib/depset.mjs';
import { inspectRuntimeArtifact } from './lib/runtime-smoke.mjs';
import { templateArtifactPath } from './lib/template-artifact.mjs';
import { discoverTemplates, repositoryRoot } from './lib/templates.mjs';

/**
 * Proves the portable artifact contract: Bolt sync against a materialized depset emits a module
 * accepted by the authoritative protocol decoder, with intact embedded browser assets.
 */

function fail(message) {
	throw new Error(message);
}

function argumentsFrom(argv) {
	const options = {};
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (!argument.startsWith('--')) fail(`Unknown argument: ${argument}`);
		const value = argv[++index];
		if (!value || value.startsWith('--')) fail(`${argument} requires a value.`);
		options[argument.slice(2)] = value;
	}
	return options;
}

function materializeTrackedTemplate(template, destination) {
	const sourceRoot = path.join(repositoryRoot, template.path);
	const tracked = execFileSync('git', ['ls-files', '--', template.path], {
		cwd: repositoryRoot,
		encoding: 'utf8'
	})
		.trim()
		.split('\n')
		.filter(Boolean);
	if (tracked.length === 0) fail(`Template ${template.slug} has no tracked files.`);
	for (const trackedFile of tracked) {
		const source = path.join(repositoryRoot, trackedFile);
		const target = path.join(destination, path.relative(sourceRoot, source));
		mkdirSync(path.dirname(target), { recursive: true });
		execFileSync('cp', [source, target]);
	}
	return destination;
}

const options = argumentsFrom(process.argv.slice(2));
// The contract under test is the bundle format, which no template owns, so any template proves it.
// Defaulting to the first discovered one keeps this script correct in a repository whose template
// set changes — and in the private template repository, which shares no key with this one.
const templateKey = options.template ?? process.env.RUNTIME_SMOKE_TEMPLATE;
const [template] = discoverTemplates(templateKey);
const outputPath = path.resolve(
	repositoryRoot,
	options.output ?? process.env.RUNTIME_SMOKE_OUTPUT ?? 'dist/runtime-smoke.json'
);
const storeDirectory = path.resolve(
	repositoryRoot,
	options['store-dir'] ?? process.env.NORBITAL_PNPM_STORE ?? '.tmp/pnpm-store'
);

mkdirSync(path.join(repositoryRoot, '.tmp'), { recursive: true });
const temporaryDirectory = mkdtempSync(path.join(repositoryRoot, '.tmp', 'runtime-smoke-'));
const workspace = path.join(temporaryDirectory, 'src');
const depsetRoot = path.join(temporaryDirectory, 'node_modules');
const runtimeEntry = templateArtifactPath(workspace);
let depset;
let buildElapsedMilliseconds;
let runtimeEntrySha256;
let runtimeExports;
let manifestSummary;

try {
	mkdirSync(workspace, { recursive: true });
	mkdirSync(storeDirectory, { recursive: true });
	materializeTrackedTemplate(template, workspace);

	depset = prepareDepset({ templateDirectory: workspace, storeDirectory, depsetRoot });
	execFileSync('ln', ['-sfn', depset.path, path.join(workspace, 'node_modules')]);

	const boltBin = path.join(
		workspace,
		'node_modules',
		'@norbital-ai',
		'bolt',
		'build',
		'compiler',
		'cli.js'
	);
	const buildStartedAt = process.hrtime.bigint();
	execFileSync(process.execPath, [boltBin, 'sync'], { cwd: workspace, stdio: 'inherit' });
	buildElapsedMilliseconds = Number(process.hrtime.bigint() - buildStartedAt) / 1_000_000;
	if (!statSync(runtimeEntry).isFile() || statSync(runtimeEntry).size === 0) {
		fail(`Bolt sync emitted no non-empty portable artifact at ${runtimeEntry}.`);
	}
	runtimeEntrySha256 = createHash('sha256').update(readFileSync(runtimeEntry)).digest('hex');

	console.log('Loading .norbital/artifact/bundle.mjs from the clean workspace.');
	const runtime = await import(pathToFileURL(runtimeEntry).href);
	const requireFromWorkspace = createRequire(path.join(workspace, 'package.json'));
	const [{ decodeBoltBundleModule }, { Effect }] = await Promise.all([
		import(pathToFileURL(requireFromWorkspace.resolve('@norbital-ai/bolt-protocol')).href),
		import(pathToFileURL(requireFromWorkspace.resolve('effect')).href)
	]);
	const decoded = await Effect.runPromise(decodeBoltBundleModule(runtime));
	const inspected = inspectRuntimeArtifact({
		runtime,
		bundle: decoded,
		artifactVersion: JSON.parse(readFileSync(path.join(workspace, 'package.json'), 'utf8')).version
	});
	runtimeExports = inspected.runtimeExports;
	manifestSummary = inspected.manifest;
} finally {
	rmSync(temporaryDirectory, { recursive: true, force: true });
}

const result = {
	$schema: '../release/runtime-smoke.schema.json',
	schemaVersion: 5,
	template: template.slug,
	lockHash: depset.lockHash,
	buildCommand: 'bolt sync',
	buildElapsedMilliseconds: Number(buildElapsedMilliseconds.toFixed(3)),
	runtimeEntry: '.norbital/artifact/bundle.mjs',
	runtimeEntrySha256,
	runtimeExports,
	manifest: manifestSummary,
	passed: true
};
mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
