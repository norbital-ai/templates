// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Standing allowances feed every period they cover; one-off entries do not.
 *
 * The model comment already said there is no global unique on `component_entry_id`. A later
 * index put one back. Gather only refuses depleting one-offs by name, so a second-period standing
 * capture died on the database. This file drives gather + the create hook, then persists the two
 * junction rows through the shipped DROP INDEX migration on PGlite.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect } from 'effect';
import { DatabaseRequest, EffectId, InvocationId } from '@norbital-ai/bolt-protocol';
import { makeLocalDatabase } from '@norbital-ai/bolt-server';
import { ENTRY_ALREADY_CAPTURED } from '../../src/lib/settlement_refusals.ts';
import payrollRunHooks from '../../src/collections/payroll_runs/+hooks.ts';
import { memoryPayrollApi, refusalMessage } from '../fixtures/memory-payroll-api.ts';
import {
	BONUS_ENTRY_ID,
	COMPANY_ID,
	EMPLOYMENT_ID,
	STANDING_ENTRY_ID,
	createPublicPayrollWorld
} from '../fixtures/public-payroll-world.ts';

const MIGRATIONS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../.norbital/migrations');
const DROP_UNIQUE_SQL = readFileSync(
	join(MIGRATIONS_ROOT, '20260902165257_drop_component_entry_global_unique', 'migration.sql'),
	'utf8'
).trim();

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
	'the drop-unique migration lets one standing entry land on two payslips',
	{ timeout: 30_000 },
	async () => {
		const dataDirectory = await mkdtemp(join(tmpdir(), 'hr-component-entry-unique-'));
		const database = await makeLocalDatabase({ dataDirectory });
		const metadata = {
			invocationId: InvocationId.make('component-entry-unique'),
			effectId: EffectId.make('component-entry-unique'),
			deadlineEpochMs: Number.MAX_SAFE_INTEGER,
			idempotencyKey: 'component-entry-unique'
		};
		const signal = new AbortController().signal;
		const exec = async (sql, parameters = []) =>
			database.binding.call(
				metadata,
				DatabaseRequest.cases.Query.make({ sql, parameters }),
				signal
			);
		try {
			const created = await exec(
				'CREATE TABLE payslip_component_entry_inputs (' +
					'id uuid PRIMARY KEY, payslip_id uuid NOT NULL, ' +
					'component_entry_id uuid NOT NULL, period text NOT NULL)'
			);
			assert.equal(created._tag, 'Success', JSON.stringify(created));
			const composite = await exec(
				'CREATE UNIQUE INDEX ' +
					'payslip_component_entry_inputs_payslip_id_component_entry_id_index ' +
					'ON payslip_component_entry_inputs (payslip_id, component_entry_id)'
			);
			assert.equal(composite._tag, 'Success', JSON.stringify(composite));
			const globalUnique = await exec(
				'CREATE UNIQUE INDEX ' +
					'payslip_component_entry_inputs_component_entry_id_index ' +
					'ON payslip_component_entry_inputs (component_entry_id)'
			);
			assert.equal(globalUnique._tag, 'Success', JSON.stringify(globalUnique));

			const first = await exec(
				'INSERT INTO payslip_component_entry_inputs ' +
					'(id, payslip_id, component_entry_id, period) VALUES ($1, $2, $3, $4)',
				['cccccccc-cccc-4ccc-8ccc-ccccccccccc1', JAN_PAYSLIP, STANDING_ENTRY_ID, '2026-01']
			);
			assert.equal(first._tag, 'Success', JSON.stringify(first));
			const blocked = await exec(
				'INSERT INTO payslip_component_entry_inputs ' +
					'(id, payslip_id, component_entry_id, period) VALUES ($1, $2, $3, $4)',
				['cccccccc-cccc-4ccc-8ccc-ccccccccccc2', FEB_PAYSLIP, STANDING_ENTRY_ID, '2026-02']
			);
			assert.equal(
				blocked._tag,
				'Failure',
				'the live-tenant unique must refuse a second-period standing capture'
			);

			const dropped = await exec(DROP_UNIQUE_SQL.replace(/--> statement-breakpoint/g, '').trim());
			assert.equal(dropped._tag, 'Success', JSON.stringify(dropped));
			const second = await exec(
				'INSERT INTO payslip_component_entry_inputs ' +
					'(id, payslip_id, component_entry_id, period) VALUES ($1, $2, $3, $4)',
				['cccccccc-cccc-4ccc-8ccc-ccccccccccc2', FEB_PAYSLIP, STANDING_ENTRY_ID, '2026-02']
			);
			assert.equal(second._tag, 'Success', JSON.stringify(second));

			const samePayslip = await exec(
				'INSERT INTO payslip_component_entry_inputs ' +
					'(id, payslip_id, component_entry_id, period) VALUES ($1, $2, $3, $4)',
				['cccccccc-cccc-4ccc-8ccc-ccccccccccc3', JAN_PAYSLIP, STANDING_ENTRY_ID, '2026-01']
			);
			assert.equal(samePayslip._tag, 'Failure', 'composite (payslip, entry) unique must remain');

			const counted = await exec('SELECT count(*)::int AS n FROM payslip_component_entry_inputs');
			assert.equal(counted._tag, 'Success', JSON.stringify(counted));
			if (counted._tag === 'Success') {
				assert.equal(counted.value.rows[0]?.n, 2);
			}
		} finally {
			await database.close();
			await rm(dataDirectory, { recursive: true, force: true });
		}
	}
);
