import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
	archiveTemplateArtifact,
	templateArtifactPath,
	templateBundleFormatVersion
} from '../lib/template-artifact.mjs';

describe('template artifact archive', () => {
	it('archives only the portable bundle emitted by bolt sync', () => {
		const root = mkdtempSync(path.join(tmpdir(), 'norbital-template-artifact-'));
		try {
			const artifactPath = templateArtifactPath(root);
			mkdirSync(path.dirname(artifactPath), { recursive: true });
			writeFileSync(artifactPath, 'portable artifact');
			const archive = path.join(root, 'bundle.tar');

			archiveTemplateArtifact(root, archive);

			assert.equal(templateBundleFormatVersion, 2);
			assert.deepEqual(
				execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).trim().split('\n'),
				['bundle.mjs']
			);
			const extracted = path.join(root, 'extracted');
			mkdirSync(extracted);
			execFileSync('tar', ['-xf', archive, '-C', extracted]);
			assert.equal(readFileSync(path.join(extracted, 'bundle.mjs'), 'utf8'), 'portable artifact');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('does not accept the removed dist/output layout', () => {
		const root = mkdtempSync(path.join(tmpdir(), 'norbital-template-artifact-'));
		try {
			mkdirSync(path.join(root, '.norbital', 'dist', 'output'), { recursive: true });
			assert.throws(
				() => archiveTemplateArtifact(root, path.join(root, 'bundle.tar')),
				/no portable artifact/
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
