import test from 'node:test';
import assert from 'node:assert/strict';
import { bearerHeaders, postGuestCommand } from '@norbital-ai/test-utilities';
import {
	COMPANY_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

type Session = Awaited<ReturnType<typeof startPublicSeedHost>>;

const reconcilerRuns = async (session: Session) =>
	(await session.query(
		`select status, result::text as result from automation_run where name = 'leave_ledger_refresh' order by created_at`
	)) as ReadonlyArray<{ readonly status: string; readonly result: string }>;

const settle = (millis: number) => new Promise((resolve) => setTimeout(resolve, millis));

/**
 * The reconciler walks employments a slice at a time and starts the rest as the next run. It
 * used to ask for that run one second later; the runtime refuses any deferred start, so on a
 * bank-sized seed the walk ended after its first 25 employments on every host and nobody saw it
 * (the public seed has four). Walking with a slice of one over the four proves the chain: every
 * run lands, every employment is walked, and the last run reports the walk finished.
 */
test(
	'public seed: the leave walk chains its slices through the runtime until every employment is done',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-leave-walk');
		try {
			const before = (await reconcilerRuns(session)).length;
			const started = await postGuestCommand(
				session.host.baseUrl,
				'automations.start',
				{ name: 'leave_ledger_refresh', input: { company_id: COMPANY_ID, slice: 1 } },
				bearerHeaders(session.credential)
			);
			assert.ok(started.status < 300, JSON.stringify(started.value));
			let runs: Awaited<ReturnType<typeof reconcilerRuns>> = [];
			for (let attempt = 0; attempt < 60; attempt += 1) {
				await settle(500);
				runs = (await reconcilerRuns(session)).slice(before);
				const last = runs.at(-1);
				if (
					runs.length >= 4 &&
					runs.every((run) => run.status === 'done') &&
					last !== undefined &&
					JSON.parse(last.result).continued === false
				)
					break;
			}
			assert.ok(runs.length >= 4, `expected a chained walk, saw ${JSON.stringify(runs)}`);
			assert.ok(
				runs.every((run) => run.status === 'done'),
				`every slice lands: ${JSON.stringify(runs)}`
			);
			const walked = runs.reduce(
				(total, run) => total + Number(JSON.parse(run.result).employments),
				0
			);
			assert.equal(walked, 4, `every employment is walked once: ${JSON.stringify(runs)}`);
			assert.equal(JSON.parse(runs.at(-1)!.result).continued, false);
		} finally {
			await session.stop();
		}
	}
);
