import test from 'node:test';
import assert from 'node:assert/strict';
import { writeRows } from './helpers/write.ts';
import {
	EMPLOYMENT_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

type Session = Awaited<ReturnType<typeof startPublicSeedHost>>;

const componentFor = async (session: Session, family: 'claim' | 'allowance'): Promise<string> => {
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
			const allowanceComponent = await componentFor(session, 'allowance');
			assert.ok(
				claimComponent && allowanceComponent,
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

			// An allowance is a window: one with no opening day is refused by the column itself.
			const windowless = await write(session, 'allowances', {
				employment_id: EMPLOYMENT_ID,
				catalogue_id: allowanceComponent,
				amount: 100
			});
			assert.equal(accepted(windowless), false, JSON.stringify(windowless.value));

			const windowed = await write(session, 'allowances', {
				employment_id: EMPLOYMENT_ID,
				catalogue_id: allowanceComponent,
				amount: 100,
				effective_from: '2026-04-01',
				effective_to: '2026-04-30',
				reason: 'Reviewed departure payment'
			});
			assert.ok(accepted(windowed), `a stated window lands: ${JSON.stringify(windowed.value)}`);

			// And a shape that is simply unsayable: an allowance carries no recurrence — the window
			// is two columns — and an unknown column is refused, not stripped.
			const datedAllowance = await write(session, 'allowances', {
				employment_id: EMPLOYMENT_ID,
				catalogue_id: allowanceComponent,
				amount: 100,
				effective_from: '2026-04-01',
				recurrence: { kind: 'ONE_OFF', on: '2026-04-15' }
			});
			assert.equal(
				accepted(datedAllowance),
				false,
				`an unknown column is refused, not stripped: ${JSON.stringify(datedAllowance.value)}`
			);
		} finally {
			await session.stop();
		}
	}
);
