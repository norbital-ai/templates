import { fileURLToPath } from 'node:url';
import {
	authoredSeedStages,
	requireReleaseBundle,
	startSelfHostSession
} from '@norbital-ai/test-utilities';

export const artifactDirectory = fileURLToPath(
	new URL('../../.norbital/artifact/', import.meta.url)
);
export const publicSeedDirectory = fileURLToPath(new URL('../fixtures/seed/', import.meta.url));
export const templateManifestPath = fileURLToPath(
	new URL('../../norbital.template.json', import.meta.url)
);

/** The compiled artifact, seeded from the public fixtures, listening with a bootstrapped founder. */
export const startPublicSeedHost = async (label: string, options?: { readonly host?: string }) => {
	const { bundlePath, schemaFingerprint } = requireReleaseBundle(artifactDirectory, [
		'ai',
		'connector',
		'database',
		'tasks'
	]);
	const session = await startSelfHostSession({
		bundlePath,
		tenantId: label,
		secretsKey: `${label}-secrets-key`,
		...(options?.host !== undefined ? { host: options.host } : {}),
		seed: {
			stages: authoredSeedStages(templateManifestPath, publicSeedDirectory),
			rows: publicSeedDirectory
		}
	});
	if (session.credential === undefined || session.credential.length === 0) {
		throw new Error('identity.bootstrapFounder returned an empty credential');
	}
	return {
		baseUrl: session.baseUrl,
		address: session.address,
		credential: session.credential,
		schemaFingerprint,
		query: session.query,
		guestCommand: session.guestCommand,
		stop: session.stop
	};
};
