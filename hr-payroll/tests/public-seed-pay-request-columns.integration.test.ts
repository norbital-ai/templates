import test from 'node:test';
import assert from 'node:assert/strict';
import { writeRows } from './helpers/write.ts';
import {
	EMPLOYMENT_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

type Session = Awaited<ReturnType<typeof startPublicSeedHost>>;

const componentFor = async (session: Session, family: 'claim' | 'adhoc'): Promise<string> => {
	const rows = (await session.query(
		`select id from ${family}_catalogue limit 1`
	)) as ReadonlyArray<{ readonly id: string }>;
	assert.ok(rows[0], `Public fixture needs a ${family} catalogue definition.`);
	return rows[0].id;
};

const write = (session: Session, collection: string, values: Readonly<Record<string, unknown>>) =>
	writeRows(session, collection, 'create', [values]);

const accepted = (response: { status: number; value: unknown }) =>
	response.status >= 200 &&
	response.status < 300 &&
	(response.value as { resolution?: string }).resolution === 'accepted';

test(
	'the facts a request family requires are columns the database keeps, not rules a seed can miss',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-pay-request-columns');
		try {
			const claimComponent = await componentFor(session, 'claim');
			const adhocComponent = await componentFor(session, 'adhoc');
			assert.ok(
				claimComponent && adhocComponent,
				'the public catalogue declares a component per family'
			);

			// A claim with no incurred day. This was "A claim must say the day it was incurred", a
			// sentence in authored code over a jsonb path.
			const undatedClaim = await write(session, 'claim_requests', {
				employment_id: EMPLOYMENT_ID,
				catalogue_id: claimComponent,
				amount: 48
			});
			assert.equal(accepted(undatedClaim), false, JSON.stringify(undatedClaim.value));

			const datedClaim = await write(session, 'claim_requests', {
				employment_id: EMPLOYMENT_ID,
				catalogue_id: claimComponent,
				amount: 48,
				incurred_on: '2026-04-02'
			});
			assert.ok(
				accepted(datedClaim),
				`and one that says so lands: ${JSON.stringify(datedClaim.value)}`
			);

			// An ad hoc request is for a day: one with no day is refused by the column itself.
			const undated = await write(session, 'adhoc_requests', {
				employment_id: EMPLOYMENT_ID,
				catalogue_id: adhocComponent,
				amount: 100
			});
			assert.equal(accepted(undated), false, JSON.stringify(undated.value));

			const dated = await write(session, 'adhoc_requests', {
				employment_id: EMPLOYMENT_ID,
				catalogue_id: adhocComponent,
				amount: 100,
				event_date: '2026-04-15',
				reason: 'Reviewed departure payment'
			});
			assert.ok(accepted(dated), `a stated day lands: ${JSON.stringify(dated.value)}`);

			// And a shape that is simply unsayable: an ad hoc request carries no window — the day
			// is one column — and an unknown column is refused, not stripped.
			const windowed = await write(session, 'adhoc_requests', {
				employment_id: EMPLOYMENT_ID,
				catalogue_id: adhocComponent,
				amount: 100,
				event_date: '2026-04-15',
				effective_to: '2026-04-30'
			});
			assert.equal(
				accepted(windowed),
				false,
				`an unknown column is refused, not stripped: ${JSON.stringify(windowed.value)}`
			);
		} finally {
			await session.stop();
		}
	}
);
