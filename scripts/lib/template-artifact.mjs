import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

/** The archive layout consumed by a host; version 2 is a single portable Bolt artifact. */
export const templateBundleFormatVersion = 2;
const templateArtifactRelativePath = path.join('.norbital', 'artifact', 'bundle.mjs');

export function templateArtifactPath(workspaceRoot) {
	return path.join(workspaceRoot, templateArtifactRelativePath);
}

/** Archive exactly the portable artifact `bolt sync` reports, never its compiler intermediates. */
export function archiveTemplateArtifact(workspaceRoot, bundlePath) {
	const artifactPath = templateArtifactPath(workspaceRoot);
	if (!existsSync(artifactPath) || !statSync(artifactPath).isFile()) {
		throw new Error(`Bolt sync emitted no portable artifact at ${artifactPath}.`);
	}
	execFileSync(
		'tar',
		['-cf', bundlePath, '-C', path.dirname(artifactPath), path.basename(artifactPath)],
		{ stdio: ['ignore', 'pipe', 'pipe'] }
	);
}
