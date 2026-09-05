import { fileURLToPath } from 'node:url';
import {
	authoredSeedStages as stagesFromManifest,
	jsonSqlParameter,
	requireReleaseBundle,
	startSelfHostSession,
	type WithSelfHostInput
} from '@norbital-ai/test-utilities';

/** Kept in lockstep with `tests/fixtures/seed/` invented ids. */
export const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
export const EMPLOYMENT_ID = '44444444-4444-4444-8444-444444444444';
export const ANNUAL_LEAVE_TYPE_ID = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
export const ANNUAL_LEAVE_REQUEST_ID = 'ffffffff-ffff-4fff-8fff-fffffffffff2';
export const JURISDICTION_ID = '22222222-2222-4222-8222-222222222222';
export const SHIFT_WORK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
export const SHIFT_REST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
export const SHIFT_OFF_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
export const STATUTORY_PUB_EPF_ID = 'aaaaaaaa-dddd-4eee-8fff-aaaaaaaaaaa1';

export const LOCAL_DATABASE_TEST_TIMEOUT_MILLIS = 120_000;
export const FEBRUARY_2026 = '2026-02';
export const MARCH_2026 = '2026-03';
export const JANUARY_2026 = '2026-01';

export const artifactDirectory = fileURLToPath(
	new URL('../../.norbital/artifact/', import.meta.url)
);
export const templateManifestPath = fileURLToPath(
	new URL('../../norbital.template.json', import.meta.url)
);
export const publicSeedDirectory = fileURLToPath(new URL('../fixtures/seed/', import.meta.url));

export const startPublicSeedHost = async (
	label: string,
	options?: {
		readonly host?: string;
		readonly ai?: WithSelfHostInput['ai'];
		readonly connector?: WithSelfHostInput['connector'];
		readonly files?: boolean;
	}
) => {
	const { bundlePath, schemaFingerprint } = requireReleaseBundle(artifactDirectory, [
		'ai',
		'connector',
		'database',
		'tasks'
	]);
	const stages = stagesFromManifest(templateManifestPath, publicSeedDirectory);
	const slug = label.replaceAll(/[^a-z0-9-]+/gi, '-').toLowerCase();
	const session = await startSelfHostSession({
		bundlePath,
		tenantId: slug,
		secretsKey: `${slug}-secrets-key`,
		...(options?.host !== undefined ? { host: options.host } : {}),
		...(options?.ai !== undefined ? { ai: options.ai } : {}),
		...(options?.connector !== undefined ? { connector: options.connector } : {}),
		...(options?.files === true ? { files: true } : {}),
		seed: {
			stages,
			rows: publicSeedDirectory,
			mapParameters: jsonSqlParameter
		}
	});
	if (session.credential === undefined || session.credential.length === 0) {
		throw new Error('identity.bootstrapFounder returned an empty credential');
	}
	return {
		host: { baseUrl: session.baseUrl, address: session.address, stop: session.stop },
		credential: session.credential,
		schemaFingerprint,
		stages,
		query: session.query,
		guestCommand: session.guestCommand,
		files: session.files,
		stop: session.stop
	};
};
