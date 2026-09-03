import test from 'node:test';
import assert from 'node:assert/strict';
import {
	asRecord,
	postGuestCommand,
	requireOk,
	requireReleaseBundle,
	rowsOf
} from '@norbital-ai/test-utilities';
import { contractorAssignmentQuery } from './helpers/contractor-assignment-query.js';
import {
	CONTRACTOR_TABLE_PAGE_SIZE,
	DISTINCTIVE_SITE_TOKEN,
	artifactDirectory,
	bootPublicSeedGuest
} from './helpers/public-seed-guest.js';

const LOCAL_DATABASE_TEST_TIMEOUT_MILLIS = 60_000;

/**
 * Contractor `CollectionTable` uses `query.limit ?? 25` when the board omits `limit`.
 * Public seed authors page-size + 1 so the list is not a single-page 26/26 coincidence.
 */
const PUBLIC_ASSIGNMENT_FLOOR = CONTRACTOR_TABLE_PAGE_SIZE + 1;

const sessionFindMany = async (
	baseUrl: string,
	credential: string,
	input: Record<string, unknown>
): Promise<unknown> => {
	const headers = { authorization: `Bearer ${credential}` };
	const listed = await postGuestCommand(baseUrl, 'collections.findMany', input, headers);
	if (listed.status >= 200 && listed.status < 300) return listed.value;
	if (/unknown_command/i.test(JSON.stringify(listed.value))) {
		return requireOk(
			await postGuestCommand(baseUrl, 'collections.export', input, headers),
			'collections.export'
		);
	}
	return requireOk(listed, 'collections.findMany');
};

/**
 * T5: public-seed integration lists assignments and finds one invented site on bolt-server.
 * Does not skip `missing_colony_facility` — catalogAi + database + config, no `tasks`.
 */
test(
	'public seed lists assigned jobs and finds PUB-SITE-AMBER-QUAY on the listening guest',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		requireReleaseBundle(artifactDirectory, ['ai', 'database', 'tasks']);

		const guest = await bootPublicSeedGuest({
			tenantId: 'field-ops-public-seed',
			releaseId: 'field-ops-public-seed',
			gatewaySecret: 'field-ops-public-seed-gateway',
			founderEmail: 'field-ops-public-founder@example.test',
			founderClaimId: 'field-ops-public-seed-founder',
			secretsKey: 'field-ops-public-seed-secrets-key'
		});
		try {
			const ready = await fetch(`${guest.baseUrl}/readyz`);
			assert.equal(ready.status, 200);
			const snapshot = asRecord(await ready.json(), '/readyz');
			assert.equal(snapshot.ready, true);

			const assignments = rowsOf(
				await sessionFindMany(guest.baseUrl, guest.credential, {
					collection: 'job_assignments',
					...contractorAssignmentQuery(null),
					limit: 250
				}),
				'assignment list'
			);
			assert.ok(
				assignments.length >= PUBLIC_ASSIGNMENT_FLOOR,
				`expected ≥ ${PUBLIC_ASSIGNMENT_FLOOR} assignments (contractor table page-size ${CONTRACTOR_TABLE_PAGE_SIZE} + 1), got ${assignments.length}`
			);
			assert.ok(
				assignments.every((row) => row.status === 'assigned'),
				`seeded assignments must be assigned: ${JSON.stringify(assignments.map((row) => row.status))}`
			);

			const sites = rowsOf(
				await sessionFindMany(guest.baseUrl, guest.credential, {
					collection: 'sites',
					where: { site_code: { eq: DISTINCTIVE_SITE_TOKEN } },
					limit: 10
				}),
				'site find'
			);
			assert.equal(sites.length, 1, JSON.stringify(sites));
			assert.equal(sites[0]?.site_code, DISTINCTIVE_SITE_TOKEN);
			assert.equal(
				typeof sites[0]?.name === 'string' && String(sites[0]?.name).includes(DISTINCTIVE_SITE_TOKEN),
				true
			);
		} finally {
			await guest.stop();
		}
	}
);
