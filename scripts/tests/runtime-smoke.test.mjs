import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { inspectRuntimeArtifact } from '../lib/runtime-smoke.mjs';

const validArtifact = () => {
	const bytes = new TextEncoder().encode('workspace client');
	const manifest = {
		protocolVersion: 2,
		artifactId: '@template/test:local',
		artifactVersion: '0.0.1',
		schemaFingerprint: `sha256:${'a'.repeat(64)}`,
		requiredFacilities: ['tasks', 'ai', 'database'],
		browserAssets: [
			{
				path: '/workspace.js',
				contentType: 'text/javascript',
				sha256: createHash('sha256').update(bytes).digest('hex'),
				byteLength: bytes.byteLength
			}
		],
		serverAssets: [],
		integrations: []
	};
	const runtime = {
		activate: () => undefined,
		dispatch: () => undefined,
		manifest,
		protocolVersion: 2
	};
	return { runtime, bundle: runtime, artifactVersion: '0.0.1', readAsset: () => bytes };
};

describe('runtime smoke contract', () => {
	it('summarizes the decoded portable artifact and its sidecar client asset', () => {
		assert.deepEqual(inspectRuntimeArtifact(validArtifact()), {
			runtimeExports: ['activate', 'dispatch', 'manifest', 'protocolVersion'],
			manifest: {
				protocolVersion: 2,
				artifactId: '@template/test:local',
				artifactVersion: '0.0.1',
				schemaFingerprint: `sha256:${'a'.repeat(64)}`,
				requiredFacilities: ['ai', 'database', 'tasks'],
				browserAssetCount: 1,
				serverAssetCount: 0,
				integrationCount: 0,
				workspaceEntrySha256: createHash('sha256')
					.update(new TextEncoder().encode('workspace client'))
					.digest('hex')
			}
		});
	});

	it('rejects disagreement between the module and embedded manifest', () => {
		const fixture = validArtifact();
		fixture.bundle.protocolVersion = 3;
		assert.throws(() => inspectRuntimeArtifact(fixture), /protocol versions do not agree/);
	});

	it('rejects corrupt sidecar client bytes', () => {
		const fixture = validArtifact();
		fixture.bundle.manifest.browserAssets[0].sha256 = '0'.repeat(64);
		assert.throws(() => inspectRuntimeArtifact(fixture), /wrong size or digest/);
	});
});
