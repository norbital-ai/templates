import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { DatabaseRequest, EffectId, InvocationId } from '@norbital-ai/bolt-protocol';
import { startPglite } from '@norbital-ai/test-utilities';

const query = async (binding, sql, parameters = []) =>
	binding.call(
		{
			invocationId: InvocationId.make('junction-unique'),
			effectId: EffectId.make('junction-unique'),
			deadlineEpochMs: Number.MAX_SAFE_INTEGER,
			idempotencyKey: crypto.randomUUID()
		},
		DatabaseRequest.cases.Query.make({ sql, parameters }),
		new AbortController().signal
	);

const MIGRATIONS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../.norbital/migrations');
const LEAVE_REQUEST_ID = 'aaaa2222-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const JAN_PAYSLIP = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const FEB_PAYSLIP = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';

test('DROP INDEX lets one leave request and one repayment land on two payslips', async () => {
	const folders = await readdir(MIGRATIONS_ROOT);
	const tag = folders.find((name) => name.endsWith('_drop_leave_and_loan_global_unique'));
	assert.ok(tag, 'bolt migrate must have written drop_leave_and_loan_global_unique');
	const dropSql = (await readFile(join(MIGRATIONS_ROOT, tag, 'migration.sql'), 'utf8'))
		.replace(/--> statement-breakpoint/g, '')
		.trim();
	const statements = dropSql
		.split(';')
		.map((statement) => statement.trim())
		.filter((statement) => statement.length > 0);
	assert.equal(statements.length, 2, 'the migration drops the leave unique and the loan unique');

	const pglite = await startPglite();
	try {
		for (const table of [
			{
				name: 'payslip_leave_request_inputs',
				source: 'leave_request_id',
				firstId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
				secondId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
				sameId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'
			},
			{
				name: 'payslip_loan_repayment_inputs',
				source: 'loan_repayment_id',
				firstId: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
				secondId: 'ffffffff-ffff-4fff-8fff-fffffffffff2',
				sameId: 'ffffffff-ffff-4fff-8fff-fffffffffff3'
			}
		]) {
			const created = await query(
				pglite.binding,
				`CREATE TABLE ${table.name} (` +
					'id uuid PRIMARY KEY, payslip_id uuid NOT NULL, ' +
					`${table.source} uuid NOT NULL, period text NOT NULL)`
			);
			assert.equal(created._tag, 'Success', JSON.stringify(created));
			const composite = await query(
				pglite.binding,
				`CREATE UNIQUE INDEX ${table.name}_payslip_id_${table.source}_index ` +
					`ON ${table.name} (payslip_id, ${table.source})`
			);
			assert.equal(composite._tag, 'Success', JSON.stringify(composite));
			const globalUnique = await query(
				pglite.binding,
				`CREATE UNIQUE INDEX ${table.name}_${table.source}_index ` +
					`ON ${table.name} (${table.source})`
			);
			assert.equal(globalUnique._tag, 'Success', JSON.stringify(globalUnique));
			const first = await query(
				pglite.binding,
				`INSERT INTO ${table.name} (id, payslip_id, ${table.source}, period) ` +
					'VALUES ($1, $2, $3, $4)',
				[table.firstId, JAN_PAYSLIP, LEAVE_REQUEST_ID, '2026-01']
			);
			assert.equal(first._tag, 'Success', JSON.stringify(first));
			const blocked = await query(
				pglite.binding,
				`INSERT INTO ${table.name} (id, payslip_id, ${table.source}, period) ` +
					'VALUES ($1, $2, $3, $4)',
				[table.secondId, FEB_PAYSLIP, LEAVE_REQUEST_ID, '2026-02']
			);
			assert.equal(
				blocked._tag,
				'Failure',
				`the live-tenant unique on ${table.name} must refuse a second-period capture`
			);
		}

		for (const statement of statements) {
			const dropped = await query(pglite.binding, statement);
			assert.equal(dropped._tag, 'Success', JSON.stringify(dropped));
		}

		for (const table of [
			{
				name: 'payslip_leave_request_inputs',
				source: 'leave_request_id',
				secondId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
				sameId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'
			},
			{
				name: 'payslip_loan_repayment_inputs',
				source: 'loan_repayment_id',
				secondId: 'ffffffff-ffff-4fff-8fff-fffffffffff2',
				sameId: 'ffffffff-ffff-4fff-8fff-fffffffffff3'
			}
		]) {
			const second = await query(
				pglite.binding,
				`INSERT INTO ${table.name} (id, payslip_id, ${table.source}, period) ` +
					'VALUES ($1, $2, $3, $4)',
				[table.secondId, FEB_PAYSLIP, LEAVE_REQUEST_ID, '2026-02']
			);
			assert.equal(second._tag, 'Success', JSON.stringify(second));
			const samePayslip = await query(
				pglite.binding,
				`INSERT INTO ${table.name} (id, payslip_id, ${table.source}, period) ` +
					'VALUES ($1, $2, $3, $4)',
				[table.sameId, JAN_PAYSLIP, LEAVE_REQUEST_ID, '2026-01']
			);
			assert.equal(
				samePayslip._tag,
				'Failure',
				`composite (payslip, ${table.source}) unique must remain`
			);
		}
	} finally {
		await pglite.close();
	}
});
