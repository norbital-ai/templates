import assert from 'node:assert/strict';
import test from 'node:test';
import { bearerHeaders, mutationPush, postGuestCommand } from '@norbital-ai/test-utilities';
import {
	EMPLOYMENT_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	SHIFT_OFF_ID,
	SHIFT_WORK_ID,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

/**
 * A roster that leaves no rest day is refused on the real host, by the same write the month rule
 * already accepted.
 *
 * The pair below is the whole point. Both writes move exactly one WORK day: the month keeps the
 * same count of WORK days and the same paid minutes either way, so `assertMonthConformsToPattern`
 * cannot tell them apart. What separates them is *where* the day lands — one joins two working
 * weeks into a thirteen-day run, the other moves the rest day one day along. The month rule is
 * blind to that ordering; this is the rule that is not.
 *
 * The fixture pattern is 6 WORK + 1 REST anchored on a Monday, so REST falls on Sundays. March 2026
 * opens on a Sunday, which puts them on the 1st, 8th, 15th, 22nd and 29th.
 */
const SUNDAY = '2026-03-15';
/** Monday the 16th: taking this off moves the rest day rather than deleting it. */
const NEXT_DAY = '2026-03-16';
/** Wednesday the 25th, past the Sunday the 22nd that ends the run either way. */
const LATER_WEEK = '2026-03-25';
const MUTATE = 'collections.mutate';

const writeDays = (
	session: Awaited<ReturnType<typeof startPublicSeedHost>>,
	days: ReadonlyArray<{ readonly date: string; readonly shift: string }>
) =>
	postGuestCommand(
		session.host.baseUrl,
		MUTATE,
		mutationPush(session.schemaFingerprint, {
			action: 'mutate',
			collection: 'work_days',
			rows: days.map(({ date, shift }) => ({
				action: 'create',
				values: {
					id: crypto.randomUUID(),
					employment_id: EMPLOYMENT_ID,
					work_date: date,
					shift_definition_id: shift,
					planned_origin: 'MANUAL'
				}
			}))
		}),
		bearerHeaders(session.credential)
	);

test(
	'a roster with no rest day in thirteen days is refused, while the same day moved one along is not',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-weekly-rest');
		try {
			// Working the rest day and taking a day off in the following week: the month balances,
			// and the run from Monday the 9th to Saturday the 21st has no rest day inside it.
			const refused = await writeDays(session, [
				{ date: SUNDAY, shift: SHIFT_WORK_ID },
				{ date: LATER_WEEK, shift: SHIFT_OFF_ID }
			]);
			const sentence = JSON.stringify(refused.value);
			assert.match(sentence, /consecutive worked/i, `${refused.status}: ${sentence}`);
			assert.match(sentence, /13/, `the run's length is named: ${sentence}`);
			assert.match(sentence, /rest day/i, sentence);
			const written = await session.query(
				'select count(*)::int as total from work_days where employment_id = $1 and work_date = any($2)',
				[EMPLOYMENT_ID, [SUNDAY, LATER_WEEK]]
			);
			assert.equal(
				(written as ReadonlyArray<{ readonly total: number }>)[0]?.total,
				0,
				'a refused batch writes neither row'
			);

			// The same Sunday worked, with the Monday beside it off instead: the rest day moved, and
			// the longest run is seven days.
			const accepted = await writeDays(session, [
				{ date: SUNDAY, shift: SHIFT_WORK_ID },
				{ date: NEXT_DAY, shift: SHIFT_OFF_ID }
			]);
			assert.ok(
				accepted.status >= 200 && accepted.status < 300,
				`the moved rest day lands: ${accepted.status} ${JSON.stringify(accepted.value)}`
			);
			assert.doesNotMatch(JSON.stringify(accepted.value), /rejected|refused/i);
		} finally {
			await session.stop();
		}
	}
);
