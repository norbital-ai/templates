// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Standing allowances feed every period they cover; one-off entries do not.
 *
 * The model comment already said there is no global unique on `component_entry_id`. A later
 * index put one back. Gather only refuses depleting one-offs by name, so a second-period standing
 * capture died on the database. This file drives gather + the create hook in memory, then proves
 * the migrated public-seed guest can land the same standing entry on two payroll periods.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import {
	mutationPush,
	postGuestCommand,
	requireAccepted
} from '@norbital-ai/test-utilities';
import { ENTRY_ALREADY_CAPTURED } from '../src/lib/settlement_refusals.ts';
import payrollRunHooks from '../src/collections/payroll_runs/+hooks.ts';
import { memoryPayrollApi, refusalMessage } from './fixtures/memory-payroll-api.ts';
import {
	BONUS_ENTRY_ID,
	COMPANY_ID,
	EMPLOYMENT_ID,
	STANDING_ENTRY_ID,
	createPublicPayrollWorld
} from './fixtures/public-payroll-world.ts';
import {
	FEBRUARY_2026,
	JANUARY_2026,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

const PUBLIC_STANDING_ENTRY_ID = '88888888-8888-4888-8888-888888888888';
const CREATE_PAYROLL_COMMAND = 'collections.mutate';

const JAN_RUN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const FEB_RUN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const JAN_PAYSLIP = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const FEB_PAYSLIP = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

async function createPayrollRun(world, period) {
	const api = memoryPayrollApi(world);
	const prepared = await Effect.runPromise(
		payrollRunHooks.mutate.prepare({
			inputs: [{ company_id: COMPANY_ID, period }],
			api
		})
	);
	return Effect.runPromise(
		payrollRunHooks.mutate.perRecord.before.handler({
			input: { company_id: COMPANY_ID, period },
			existing: undefined,
			prepared,
			api
		})
	);
}

function entryCaptures(created) {
	const payslips = created.payslip_payroll_run ?? [];
	return payslips.flatMap((payslip) => payslip.payslip_component_entry_input_payslip ?? []);
}

function persistStandingCapture(world, options) {
	world.payroll_runs.push({
		id: options.runId,
		company_id: COMPANY_ID,
		period: options.period,
		lifecycle: options.lifecycle,
		approval_id: null
	});
	world.payslips.push({
		id: options.payslipId,
		payroll_run_id: options.runId,
		employment_id: EMPLOYMENT_ID,
		statutory: [],
		approval_id: null
	});
	for (const capture of options.captures) {
		world.payslip_component_entry_inputs.push({
			id: capture.id,
			payslip_id: options.payslipId,
			component_entry_id: capture.component_entry_id,
			period: capture.period
		});
	}
}

test('a standing allowance is captured on two periods and two payslips', async () => {
	const world = createPublicPayrollWorld();
	const january = await createPayrollRun(world, '2026-01');
	const januaryCaptures = entryCaptures(january);
	assert.deepEqual(januaryCaptures.map((row) => row.component_entry_id).toSorted(), [
		STANDING_ENTRY_ID
	]);
	persistStandingCapture(world, {
		runId: JAN_RUN,
		payslipId: JAN_PAYSLIP,
		period: '2026-01',
		lifecycle: 'PAID',
		captures: januaryCaptures
	});

	const february = await createPayrollRun(world, '2026-02');
	const februaryCaptures = entryCaptures(february);
	assert.deepEqual(februaryCaptures.map((row) => row.component_entry_id).toSorted(), [
		STANDING_ENTRY_ID
	]);
	assert.equal(januaryCaptures[0].period, '2026-01');
	assert.equal(februaryCaptures[0].period, '2026-02');
	assert.notEqual(january.payslip_payroll_run[0].employment_id, undefined);
	assert.equal(february.payslip_payroll_run[0].employment_id, EMPLOYMENT_ID);
});

test('a one-off depleting entry is refused by gather with ENTRY_ALREADY_CAPTURED', async () => {
	const world = createPublicPayrollWorld({ includeBonus: true });
	const january = await createPayrollRun(world, '2026-01');
	const januaryCaptures = entryCaptures(january);
	assert.ok(
		januaryCaptures.some((row) => row.component_entry_id === BONUS_ENTRY_ID),
		'January must capture the bonus so February can refuse it by name'
	);
	persistStandingCapture(world, {
		runId: JAN_RUN,
		payslipId: JAN_PAYSLIP,
		period: '2026-01',
		lifecycle: 'PAID',
		captures: januaryCaptures
	});

	await assert.rejects(
		() => createPayrollRun(world, '2026-02'),
		(error) => {
			const message = refusalMessage(error);
			assert.match(message, new RegExp(ENTRY_ALREADY_CAPTURED));
			assert.match(message, /2026-01/);
			assert.doesNotMatch(message, /unique|duplicate key|already exists/i);
			return true;
		}
	);
});

test(
	'public seed standing allowance lands on January and February payslips',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-component-entry-capture');
		try {
			for (const period of [JANUARY_2026, FEBRUARY_2026]) {
				const created = await postGuestCommand(
					session.host.baseUrl,
					CREATE_PAYROLL_COMMAND,
					mutationPush(session.schemaFingerprint, {
						action: 'create',
						collection: 'payroll_runs',
						values: {
							id: crypto.randomUUID(),
							company_id: COMPANY_ID,
							period
						}
					}),
					{ authorization: `Bearer ${session.credential}` }
				);
				assert.ok(
					created.status >= 200 && created.status < 300,
					`${CREATE_PAYROLL_COMMAND} ${period} returned ${created.status}: ${JSON.stringify(created.value)}`
				);
				requireAccepted(created.value, `${CREATE_PAYROLL_COMMAND} ${period}`);
				if (period === JANUARY_2026) {
					await session.query(
						`update payroll_runs set lifecycle = 'PAID' where company_id = $1 and period = $2`,
						[COMPANY_ID, JANUARY_2026]
					);
				}
			}

			const captures = (await session.query(
				`select period, payslip_id from payslip_component_entry_inputs
				 where component_entry_id = $1
				 order by period`,
				[PUBLIC_STANDING_ENTRY_ID]
			)) as ReadonlyArray<{ readonly period: string; readonly payslip_id: string }>;
			const periods = [...new Set(captures.map((row) => row.period))].toSorted();
			assert.deepEqual(
				periods,
				[JANUARY_2026, FEBRUARY_2026],
				`standing entry must land on both public periods, got ${JSON.stringify(captures)}`
			);

			const january = captures.find((row) => row.period === JANUARY_2026);
			assert.ok(january, 'January capture must exist');
			await assert.rejects(() =>
				session.query(
					`insert into payslip_component_entry_inputs
					 (id, payslip_id, component_entry_id, period)
					 values ($1, $2, $3, $4)`,
					[crypto.randomUUID(), january.payslip_id, PUBLIC_STANDING_ENTRY_ID, JANUARY_2026]
				)
			);
		} finally {
			await session.stop();
		}
	}
);
