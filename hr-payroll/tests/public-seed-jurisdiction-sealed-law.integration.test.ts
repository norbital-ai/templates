import test from 'node:test';
import assert from 'node:assert/strict';
import {
	asRecord,
	bearerHeaders,
	mutationPush,
	postGuestCommand,
	rowsOf
} from '@norbital-ai/test-utilities';
import {
	JURISDICTION_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

const JURISDICTION_COLUMNS = {
	id: true,
	row_version: true,
	code: true,
	name: true,
	lifecycle: true,
	tax_year_start_month: true
};

/**
 * A2 command half: a sealed public jurisdiction refuses a law-member edit.
 * Form chrome (sheet stays open) remains headed.
 */
test(
	'public seed refuses a law edit on the sealed PUB jurisdiction',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-a2-sealed-law');
		try {
			const headers = bearerHeaders(session.credential);
			const listed = await postGuestCommand(
				session.host.baseUrl,
				'collections.findMany',
				{
					collection: 'jurisdictions',
					where: { id: { eq: JURISDICTION_ID } },
					columns: JURISDICTION_COLUMNS,
					limit: 1
				},
				headers
			);
			assert.ok(
				listed.status >= 200 && listed.status < 300,
				`jurisdictions findMany ${listed.status}: ${JSON.stringify(listed.value)}`
			);
			const [row] = rowsOf(listed.value, 'PUB jurisdiction');
			assert.ok(row, 'public seed must include PUB');
			assert.equal(row.id, JURISDICTION_ID);
			assert.equal(row.code, 'PUB');
			assert.equal(row.lifecycle, 'SEALED');
			assert.equal(typeof row.row_version, 'number', JSON.stringify(row));

			const refused = await postGuestCommand(
				session.host.baseUrl,
				'collections.mutate',
				mutationPush(
					session.schemaFingerprint,
					{
						action: 'update',
						collection: 'jurisdictions',
						values: {
							id: JURISDICTION_ID,
							tax_year_start_month: 7
						}
					},
					[
						{
							row: { collection: 'jurisdictions', recordId: JURISDICTION_ID },
							rowVersion: row.row_version
						}
					]
				),
				headers
			);
			assert.ok(
				refused.status >= 200 && refused.status < 500,
				`sealed law mutate ${refused.status}: ${JSON.stringify(refused.value)}`
			);
			const body = asRecord(refused.value, 'sealed law mutate');
			assert.equal(body.resolution, 'rejected');
			assert.equal(body.code, 'refused');
			assert.match(
				String(body.message ?? ''),
				/SEALED.*tax_year_start_month|tax_year_start_month.*SEALED|cannot change/i
			);

			const reloaded = await postGuestCommand(
				session.host.baseUrl,
				'collections.findMany',
				{
					collection: 'jurisdictions',
					where: { id: { eq: JURISDICTION_ID } },
					columns: JURISDICTION_COLUMNS,
					limit: 1
				},
				headers
			);
			const [after] = rowsOf(reloaded.value, 'PUB after refuse');
			assert.ok(after);
			assert.equal(after.tax_year_start_month, row.tax_year_start_month);
			assert.equal(after.code, 'PUB');
			assert.equal(after.lifecycle, 'SEALED');
		} finally {
			await session.stop();
		}
	}
);
