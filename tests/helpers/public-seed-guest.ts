import { fileURLToPath } from 'node:url';
import {
	manifestSeedStages,
	requireReleaseBundle,
	startSelfHostSession,
	type WithSelfHostInput
} from '@norbital-ai/test-utilities';

export const artifactDirectory = fileURLToPath(
	new URL('../../.norbital/artifact/', import.meta.url)
);
export const seedDirectory = fileURLToPath(new URL('../fixtures/seed/', import.meta.url));
const templateManifestPath = fileURLToPath(
	new URL('../../norbital.template.json', import.meta.url)
);

/** Variant nibble 8 so `collections.mutate` accepts the row as a client-minted UUIDv7. */
export const PUBLIC_ASSIGNMENT_ID = '01990000-0000-7000-8005-000000000001';
export const DISTINCTIVE_SITE_TOKEN = 'PUB-SITE-AMBER-QUAY';
export const CONTRACTOR_TABLE_PAGE_SIZE = 25;

export const bootPublicSeedGuest = async (options: {
	readonly tenantId: string;
	readonly releaseId: string;
	readonly gatewaySecret: string;
	readonly founderEmail: string;
	readonly founderClaimId: string;
	readonly secretsKey: string;
	readonly invocationTimeoutMillis?: number;
	readonly ai?: WithSelfHostInput['ai'];
}) => {
	const { bundlePath, schemaFingerprint } = requireReleaseBundle(artifactDirectory);
	const session = await startSelfHostSession({
		bundlePath,
		tenantId: options.tenantId,
		releaseId: options.releaseId,
		gatewaySecret: options.gatewaySecret,
		secretsKey: options.secretsKey,
		founder: {
			email: options.founderEmail,
			claimId: options.founderClaimId
		},
		...(options.invocationTimeoutMillis !== undefined
			? { invocationTimeoutMillis: options.invocationTimeoutMillis }
			: {}),
		...(options.ai !== undefined ? { ai: options.ai } : {}),
		seed: {
			stages: manifestSeedStages(templateManifestPath),
			rows: seedDirectory
		}
	});
	if (session.credential === undefined || session.credential.length === 0) {
		throw new Error('identity.bootstrapFounder returned an empty credential');
	}
	return {
		baseUrl: session.baseUrl,
		credential: session.credential,
		schemaFingerprint,
		stop: session.stop
	};
};
