import test from 'node:test';
import assert from 'node:assert/strict';
import { bearerHeaders, mutationPush, postGuestCommand } from '@norbital-ai/test-utilities';
import {
	EMPLOYMENT_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

type Session = Awaited<ReturnType<typeof startPublicSeedHost>>;
const MUTATE = 'collections.mutate';

const componentFor = async (
	session: Session,
	family: 'claim' | 'allowance' | 'payment'
): Promise<string> => {
	const rows = (await session.query(
		`select id from ${family}_catalogue limit 1`
	)) as ReadonlyArray<{ readonly id: string }>;
	assert.ok(rows[0], `Public fixture needs a ${family} catalogue definition.`);
	return rows[0].id;
};

const write = (session: Session, collection: string, values: Readonly<Record<string, unknown>>) =>
	postGuestCommand(
		session.host.baseUrl,
		MUTATE,
		mutationPush(session.schemaFingerprint, {
			action: 'mutate',
			collection,
			rows: [{ action: 'create', values: { id: crypto.randomUUID(), ...values } }]
		}),
		bearerHeaders(session.credential)
	);

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
			const paymentComponent = await componentFor(session, 'payment');
			const allowanceComponent = await componentFor(session, 'allowance');
			assert.ok(
				claimComponent && paymentComponent && allowanceComponent,
				'the public catalogue declares a component per family'
			);

			// A claim with no incurred day. This was "A claim must say the day it was incurred", a
			// sentence in a hook over a jsonb path.
			const undatedClaim = await write(session, 'claim_requests', {
				employment_id: EMPLOYMENT_ID,
				claim_catalogue_id: claimComponent,
				amount: 48
			});
			assert.equal(accepted(undatedClaim), false, JSON.stringify(undatedClaim.value));

			const datedClaim = await write(session, 'claim_requests', {
				employment_id: EMPLOYMENT_ID,
				claim_catalogue_id: claimComponent,
				amount: 48,
				incurred_on: '2026-04-02'
			});
			assert.ok(
				accepted(datedClaim),
				`and one that says so lands: ${JSON.stringify(datedClaim.value)}`
			);

			for (const missing of ['employment_id', 'effective_on', 'reason']) {
				const payment: Record<string, unknown> = {
					employment_id: EMPLOYMENT_ID,
					payment_catalogue_id: paymentComponent,
					amount: 100,
					effective_on: '2026-04-02',
					reason: 'Reviewed departure payment'
				};
				delete payment[missing];
				const response = await write(session, 'payment_requests', payment);
				assert.equal(accepted(response), false, `${missing}: ${JSON.stringify(response.value)}`);
			}
			const payment = await write(session, 'payment_requests', {
				employment_id: EMPLOYMENT_ID,
				payment_catalogue_id: paymentComponent,
				amount: 100,
				effective_on: '2026-04-02',
				reason: 'Reviewed departure payment'
			});
			assert.ok(accepted(payment), JSON.stringify(payment.value));

			// An allowance with no recurrence: the arm that used to be empty, whose window was a
			// nullable column three other arms had to be refused for setting.
			const windowless = await write(session, 'allowance_requests', {
				employment_id: EMPLOYMENT_ID,
				allowance_catalogue_id: allowanceComponent,
				amount: 100
			});
			assert.equal(accepted(windowless), false, JSON.stringify(windowless.value));

			const windowed = await write(session, 'allowance_requests', {
				employment_id: EMPLOYMENT_ID,
				allowance_catalogue_id: allowanceComponent,
				amount: 100,
				recurrence: { kind: 'ONE_OFF', period: '2026-04' }
			});
			assert.ok(accepted(windowed), `a stated window lands: ${JSON.stringify(windowed.value)}`);

			// And a shape that is simply unsayable: an allowance cannot claim an incurred day, because
			// the column does not exist on it.
			const datedAllowance = await write(session, 'allowance_requests', {
				employment_id: EMPLOYMENT_ID,
				allowance_catalogue_id: allowanceComponent,
				amount: 100,
				recurrence: { kind: 'ONE_OFF', period: '2026-04' },
				incurred_on: '2026-04-02'
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
