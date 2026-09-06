import test from 'node:test';
import assert from 'node:assert/strict';
import {
	asRecord,
	bearerHeaders,
	mutationPush,
	postGuestCommand
} from '@norbital-ai/test-utilities';
import {
	EMPLOYMENT_ID,
	HOSPITALIZATION_LEAVE_ACCOUNT_ID,
	HOSPITALIZATION_LEAVE_TYPE_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

/**
 * HR10: hospitalization leave end-to-end on public fixtures.
 *
 * The public `jurisdictions.json` seals a 60-day HOSPITALIZATION floor and
 * `leave_types.json` maps it; the after-seed `leave_ledger_refresh` generates the
 * accounts (fixtures carry zero `leave_accounts`/`entries`). A founder-committed
 * two-day request then charges the ledger through the same hooks payroll reads.
 */
test(
	'public seed hospitalization leave generates its account and charges taken days',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-hospitalization');
		try {
			const accounts = await session.query(
				`select id, employment_id, leave_code, leave_year, entitlement_days, opening_statutory_profile_id
				 from leave_accounts where leave_code = 'HOSPITALIZATION' and leave_year = 2026`
			);
			assert.equal(
				accounts.length,
				4,
				`every public employment gets a 2026 hospitalization account: ${JSON.stringify(accounts)}`
			);
			const account = asRecord(
				accounts.find(
					(row) => String(asRecord(row, 'row').id) === HOSPITALIZATION_LEAVE_ACCOUNT_ID
				),
				'fixture hospitalization account'
			);
			assert.equal(Number(account.entitlement_days), 60);
			assert.equal(account.opening_statutory_profile_id, '22222222-2222-4222-8222-222222222222');

			const openings = await session.query(
				`select kind, days, source_key from leave_entries where leave_account_id = $1`,
				[HOSPITALIZATION_LEAVE_ACCOUNT_ID]
			);
			assert.equal(openings.length, 1, JSON.stringify(openings));
			const opening = asRecord(openings[0], 'hospitalization opening entry');
			assert.equal(opening.kind, 'OPENING_ENTITLEMENT');
			assert.equal(Number(opening.days), 60);
			assert.equal(opening.source_key, 'opening');

			const requestId = crypto.randomUUID();
			const created = await postGuestCommand(
				session.host.baseUrl,
				'collections.mutate',
				mutationPush(session.schemaFingerprint, {
					action: 'mutate',
					collection: 'leave_requests',
					rows: [
						{
							action: 'create',
							values: {
								id: requestId,
								employment_id: EMPLOYMENT_ID,
								leave_type_id: HOSPITALIZATION_LEAVE_TYPE_ID,
								leave_account_id: HOSPITALIZATION_LEAVE_ACCOUNT_ID,
								event: {
									kind: 'TIME_OFF',
									range: {
										start: { date: '2026-06-03', half: 'FIRST' },
										end: { date: '2026-06-04', half: 'SECOND' }
									},
									chargeable_days: null,
									reason: 'Hospitalization fixture admission'
								}
							}
						}
					]
				}),
				bearerHeaders(session.credential)
			);
			assert.ok(
				created.status >= 200 && created.status < 300,
				`leave_requests.mutate ${created.status}: ${JSON.stringify(created.value)}`
			);
			const stored = await session.query(`select event from leave_requests where id = $1`, [
				requestId
			]);
			assert.equal(stored.length, 1, 'founder-committed request must land');
			assert.equal(
				Number(asRecord(stored[0], 'stored request').event.chargeable_days),
				2,
				'two scheduled work days normalized by the request hook'
			);

			const entries = await session.query(
				`select kind, days, source_key from leave_entries
				 where leave_account_id = $1 order by effective_on, kind`,
				[HOSPITALIZATION_LEAVE_ACCOUNT_ID]
			);
			const taken = entries.filter(
				(row) => String(asRecord(row, 'entry').source_key) === `request:${requestId}`
			);
			assert.equal(taken.length, 1, JSON.stringify(entries));
			assert.equal(asRecord(taken[0], 'taken entry').kind, 'TAKEN');
			assert.equal(Number(asRecord(taken[0], 'taken entry').days), -2);

			const balance = await session.query(
				`select coalesce(sum(days), 0) as remaining from leave_entries
				 where leave_account_id = $1 and effective_on <= '2026-12-31'`,
				[HOSPITALIZATION_LEAVE_ACCOUNT_ID]
			);
			assert.equal(Number(asRecord(balance[0], 'balance').remaining), 58);
		} finally {
			await session.stop();
		}
	}
);
