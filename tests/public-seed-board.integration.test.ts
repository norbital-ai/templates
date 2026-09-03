import test from 'node:test';
import assert from 'node:assert/strict';
import { pageOf, postGuestCommand, requireOk } from '@norbital-ai/test-utilities';
import { contractorAssignmentQuery } from './helpers/contractor-assignment-query.js';
import {
	CONTRACTOR_TABLE_PAGE_SIZE,
	DISTINCTIVE_SITE_TOKEN,
	bootPublicSeedGuest
} from './helpers/public-seed-guest.js';

const LOCAL_DATABASE_TEST_TIMEOUT_MILLIS = 60_000;

const sessionFindMany = async (
	baseUrl: string,
	credential: string,
	input: Record<string, unknown>
): Promise<unknown> =>
	requireOk(
		await postGuestCommand(baseUrl, 'collections.findMany', input, {
			authorization: `Bearer ${credential}`
		}),
		'collections.findMany'
	);

const rowIds = (rows: ReadonlyArray<Readonly<Record<string, unknown>>>): readonly string[] =>
	rows.map((row) => {
		assert.equal(typeof row.id, 'string', JSON.stringify(row));
		return String(row.id);
	});

/**
 * I4: public-seed contractor board — real `nextCursor` pagination, lexical site search, and the
 * completed filter on an all-assigned world. T5 keeps the sites findMany for PUB-SITE-AMBER-QUAY.
 */
test(
	'public seed findMany pages assignments, searches PUB-SITE-AMBER-QUAY, and completed is empty',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const guest = await bootPublicSeedGuest({
			tenantId: 'field-ops-public-seed-board',
			releaseId: 'field-ops-public-seed-board',
			gatewaySecret: 'field-ops-public-seed-board-gateway',
			founderEmail: 'field-ops-board-founder@example.test',
			founderClaimId: 'field-ops-public-seed-board-founder',
			secretsKey: 'field-ops-public-seed-board-secrets-key'
		});
		try {
			const firstInput = {
				collection: 'job_assignments',
				orderBy: { dispatched_at: 'desc' },
				limit: CONTRACTOR_TABLE_PAGE_SIZE
			};
			const firstPage = pageOf(
				await sessionFindMany(guest.baseUrl, guest.credential, firstInput),
				'job_assignments page 1'
			);
			assert.equal(
				firstPage.rows.length,
				CONTRACTOR_TABLE_PAGE_SIZE,
				`page 1 must be exactly the contractor table page size: ${JSON.stringify(firstPage.rows.map((row) => row.id))}`
			);
			assert.equal(
				typeof firstPage.nextCursor,
				'string',
				`nextCursor must be a non-empty string on a full page: ${JSON.stringify(firstPage.nextCursor)}`
			);
			assert.ok(
				String(firstPage.nextCursor).length > 0,
				`nextCursor must be a non-empty string: ${JSON.stringify(firstPage.nextCursor)}`
			);
			const firstIds = new Set(rowIds(firstPage.rows));

			const secondPage = pageOf(
				await sessionFindMany(guest.baseUrl, guest.credential, {
					collection: 'job_assignments',
					after: firstPage.nextCursor,
					limit: CONTRACTOR_TABLE_PAGE_SIZE,
					orderBy: { dispatched_at: 'desc' }
				}),
				'job_assignments page 2'
			);
			assert.ok(secondPage.rows.length >= 1, 'page 2 must return the remainder of the public seed');
			const secondIds = rowIds(secondPage.rows);
			assert.ok(
				secondIds.every((id) => !firstIds.has(id)),
				`page 2 overlapped page 1: ${JSON.stringify({ first: [...firstIds], second: secondIds })}`
			);

			const searched = pageOf(
				await sessionFindMany(guest.baseUrl, guest.credential, {
					collection: 'job_assignments',
					search: { mode: 'lexical', term: DISTINCTIVE_SITE_TOKEN },
					limit: CONTRACTOR_TABLE_PAGE_SIZE
				}),
				'job_assignments lexical search'
			);
			assert.ok(searched.rows.length >= 1, `lexical search for ${DISTINCTIVE_SITE_TOKEN} returned 0 rows`);
			assert.ok(
				searched.rows.some((row) => {
					const searchText = typeof row.search_text === 'string' ? row.search_text : '';
					return searchText.includes(DISTINCTIVE_SITE_TOKEN);
				}),
				`no searched row carried ${DISTINCTIVE_SITE_TOKEN} in search_text: ${JSON.stringify(searched.rows)}`
			);

			const completedQuery = contractorAssignmentQuery('completed');
			assert.deepEqual(completedQuery.where, { status: { eq: 'completed' } });
			const completed = pageOf(
				await sessionFindMany(guest.baseUrl, guest.credential, {
					collection: 'job_assignments',
					where: { status: { eq: 'completed' } },
					limit: 250
				}),
				'job_assignments completed filter'
			);
			assert.equal(
				completed.rows.length,
				0,
				`public seed is all assigned; completed filter must be empty: ${JSON.stringify(completed.rows)}`
			);
		} finally {
			await guest.stop();
		}
	}
);
