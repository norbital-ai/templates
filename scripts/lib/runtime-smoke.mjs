import { createHash } from 'node:crypto';

const requiredRuntimeExports = ['activate', 'dispatch', 'manifest', 'protocolVersion'];

/** Inspect the decoded host contract and its content-addressed sidecar assets in one place. */
export function inspectRuntimeArtifact({ runtime, bundle, artifactVersion, readAsset }) {
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
	for (const asset of [...manifest.browserAssets, ...manifest.serverAssets]) {
		const bytes = readAsset(asset);
		const digest = createHash('sha256').update(bytes).digest('hex');
		if (
			bytes.byteLength === 0 ||
			bytes.byteLength !== asset.byteLength ||
			digest !== asset.sha256
		) {
			throw new Error(`Sidecar asset ${asset.path} is empty or has the wrong size or digest.`);
		}
	}
	const workspaceEntry = manifest.browserAssets.find(({ path }) => path === '/workspace.js');
	if (workspaceEntry === undefined) {
		throw new Error('Runtime manifest contains no browser /workspace.js client entry.');
	}
	return {
		runtimeExports,
		manifest: {
			protocolVersion: manifest.protocolVersion,
			artifactId: manifest.artifactId,
			artifactVersion: manifest.artifactVersion,
			schemaFingerprint: manifest.schemaFingerprint,
			requiredFacilities: [...manifest.requiredFacilities].toSorted(),
			browserAssetCount: manifest.browserAssets.length,
			serverAssetCount: manifest.serverAssets.length,
			integrationCount: manifest.integrations.length,
			workspaceEntrySha256: workspaceEntry.sha256
		}
	};
}
