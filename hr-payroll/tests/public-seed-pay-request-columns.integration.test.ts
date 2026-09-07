import test from 'node:test';
import assert from 'node:assert/strict';
import { bearerHeaders, mutationPush, postGuestCommand } from '@norbital-ai/test-utilities';
import {
	EMPLOYMENT_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

/**
 * The refusals that became columns, proven where they now live.
 *
 * This is the RFC's central claim and it is worth stating precisely. `component_entries` carried
 * five arms, and a hand-written arm rule said which optional columns each may and must carry. That
 * rule ran in `+hooks.ts` — on the authorization path. `seed-from-bank` does not take that path, so
 * **every** seeded correction shipped without the `corrects_adjustment_id` the rule required, and
 * five invalid rows loaded into a live workspace with nothing to stop them.
 *
 * A `notNull` column is enforced by Postgres, on every path, including the one the seed takes. The
 * cases below drive the write through the ordinary command boundary because that is what a test can
 * reach — but what refuses them is the table, not a hook, and the distinction is the whole reason
 * the split was worth doing.
 *
 * Each family is also written correctly, because a constraint that refuses everything reads exactly
 * like one that works from the refusing case alone.
 */
type Session = Awaited<ReturnType<typeof startPublicSeedHost>>;
const MUTATE = 'collections.mutate';

/** The seeded components, by the family each declares it takes. */
const componentFor = async (session: Session, family: string): Promise<string | null> => {
	const rows = (await session.query(
		`select id from component_catalogue where entry_kind = $1 limit 1`,
		[family]
	)) as ReadonlyArray<{ readonly id: string }>;
	return rows[0]?.id ?? null;
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
			const claimComponent = await componentFor(session, 'CLAIM');
			const correctionComponent = await componentFor(session, 'CORRECTION');
			const allowanceComponent = await componentFor(session, 'ALLOWANCE');
			assert.ok(
				claimComponent && correctionComponent && allowanceComponent,
				'the public catalogue declares a component per family'
			);

			// A claim with no incurred day. This was "A claim must say the day it was incurred", a
			// sentence in a hook over a jsonb path.
			const undatedClaim = await write(session, 'claim_requests', {
				employment_id: EMPLOYMENT_ID,
				component_catalogue_id: claimComponent,
				amount: 48
			});
			assert.equal(accepted(undatedClaim), false, JSON.stringify(undatedClaim.value));

			const datedClaim = await write(session, 'claim_requests', {
				employment_id: EMPLOYMENT_ID,
				component_catalogue_id: claimComponent,
				amount: 48,
				incurred_on: '2026-04-02'
			});
			assert.ok(
				accepted(datedClaim),
				`and one that says so lands: ${JSON.stringify(datedClaim.value)}`
			);

			/**
			 * A correction naming nothing. This is the one that actually shipped: five seeded rows,
			 * every one of them missing this, admitted by a path the rule did not run on.
			 */
			const unanchored = await write(session, 'correction_requests', {
				employment_id: EMPLOYMENT_ID,
				component_catalogue_id: correctionComponent,
				amount: 75,
				corrected_on: '2026-04-02',
				operation: 'CORRECTION',
				reason: 'wrong rate'
			});
			assert.equal(accepted(unanchored), false, JSON.stringify(unanchored.value));

			// An allowance with no recurrence: the arm that used to be empty, whose window was a
			// nullable column three other arms had to be refused for setting.
			const windowless = await write(session, 'allowance_requests', {
				employment_id: EMPLOYMENT_ID,
				component_catalogue_id: allowanceComponent,
				amount: 100
			});
			assert.equal(accepted(windowless), false, JSON.stringify(windowless.value));

			const windowed = await write(session, 'allowance_requests', {
				employment_id: EMPLOYMENT_ID,
				component_catalogue_id: allowanceComponent,
				amount: 100,
				recurrence: { kind: 'ONE_OFF', period: '2026-04' }
			});
			assert.ok(accepted(windowed), `a stated window lands: ${JSON.stringify(windowed.value)}`);

			// And the shapes that are simply unsayable now: a bonus cannot name a receipt, and an
			// allowance cannot claim an incurred day, because neither column exists on them.
			const receiptOnABonus = await write(session, 'bonus_requests', {
				employment_id: EMPLOYMENT_ID,
				component_catalogue_id: (await componentFor(session, 'BONUS')) ?? claimComponent,
				amount: 100,
				awarded_on: '2026-04-02',
				evidence_file: null
			});
			assert.equal(
				accepted(receiptOnABonus),
				false,
				`an unknown column is refused, not stripped: ${JSON.stringify(receiptOnABonus.value)}`
			);
		} finally {
			await session.stop();
		}
	}
);
