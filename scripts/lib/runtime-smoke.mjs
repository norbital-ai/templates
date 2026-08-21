import { createHash } from 'node:crypto';

export const requiredRuntimeExports = ['activate', 'dispatch', 'manifest', 'protocolVersion'];

/** Inspect the decoded host contract and the embedded client bytes in one place. */
export function inspectRuntimeArtifact({ runtime, bundle, artifactVersion }) {
	const runtimeExports = Object.keys(runtime).toSorted();
	for (const name of requiredRuntimeExports) {
		if (!runtimeExports.includes(name)) throw new Error(`Runtime entry does not export ${name}.`);
	}
	const { manifest } = bundle;
	if (bundle.protocolVersion !== manifest.protocolVersion) {
		throw new Error('Runtime and manifest protocol versions do not agree.');
	}
	if (manifest.artifactVersion !== artifactVersion) {
		throw new Error(
			`Runtime artifact version ${manifest.artifactVersion} does not match ${artifactVersion}.`
		);
	}
	for (const asset of manifest.staticAssets) {
		const digest = createHash('sha256').update(asset.bytes).digest('hex');
		if (asset.bytes.byteLength === 0 || digest !== asset.sha256) {
			throw new Error(`Embedded asset ${asset.path} is empty or has the wrong digest.`);
		}
	}
	const workspaceEntry = manifest.staticAssets.find(({ path }) => path === '/workspace.js');
	if (workspaceEntry === undefined) {
		throw new Error('Runtime manifest contains no embedded /workspace.js client entry.');
	}
	return {
		runtimeExports,
		manifest: {
			protocolVersion: manifest.protocolVersion,
			artifactId: manifest.artifactId,
			artifactVersion: manifest.artifactVersion,
			schemaFingerprint: manifest.schemaFingerprint,
			requiredFacilities: [...manifest.requiredFacilities].toSorted(),
			staticAssetCount: manifest.staticAssets.length,
			integrationCount: manifest.integrations.length,
			workspaceEntrySha256: workspaceEntry.sha256
		}
	};
}
