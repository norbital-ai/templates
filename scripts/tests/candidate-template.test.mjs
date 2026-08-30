import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
	candidatePackageArchives,
	stageCandidatePackageArchives
} from '../lib/candidate-template.mjs';

const archiveFiles = ['bolt-protocol.tgz', 'std.tgz', 'ui.tgz', 'bolt.tgz'];

test('candidate package archives affect only the temporary projection', (context) => {
	const root = mkdtempSync(path.join(tmpdir(), 'norbital-candidate-packages-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const archivesRoot = path.join(root, 'archives');
	const projection = path.join(root, 'projection');
	mkdirSync(archivesRoot);
	mkdirSync(projection);
	for (const filename of archiveFiles) writeFileSync(path.join(archivesRoot, filename), filename);
	writeFileSync(
		path.join(projection, 'package.json'),
		JSON.stringify({
			dependencies: {
				'@norbital-ai/bolt': '0.0.10',
				'@norbital-ai/bolt-protocol': '0.0.10',
				'@norbital-ai/std': '0.0.10',
				'@norbital-ai/ui': '0.0.10',
				effect: '4.0.0-rc.111'
			}
		})
	);
	writeFileSync(path.join(projection, 'pnpm-workspace.yaml'), 'verifyDepsBeforeRun: false\n');

	const archives = candidatePackageArchives(archivesRoot);
	assert.deepEqual(
		archives.map(({ name }) => name),
		['@norbital-ai/bolt-protocol', '@norbital-ai/std', '@norbital-ai/ui', '@norbital-ai/bolt']
	);
	stageCandidatePackageArchives(projection, archives);

	const manifest = JSON.parse(readFileSync(path.join(projection, 'package.json'), 'utf8'));
	assert.equal(manifest.dependencies.effect, '4.0.0-rc.111');
	for (const { name, archive } of archives) {
		assert.equal(manifest.dependencies[name], `file:${archive}`);
	}
	const workspace = readFileSync(path.join(projection, 'pnpm-workspace.yaml'), 'utf8');
	assert.match(workspace, /^overrides:/m);
	for (const { name, archive } of archives) {
		assert.ok(workspace.includes(`${JSON.stringify(name)}: ${JSON.stringify(`file:${archive}`)}`));
	}
});

test('candidate package archives require one complete exact set', (context) => {
	const root = mkdtempSync(path.join(tmpdir(), 'norbital-incomplete-candidate-packages-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	for (const filename of archiveFiles.slice(0, -1))
		writeFileSync(path.join(root, filename), filename);
	assert.throws(() => candidatePackageArchives(root), /Missing package archive: .*bolt\.tgz/);
});
