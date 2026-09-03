import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { DatabaseRequest, EffectId, InvocationId } from '@norbital-ai/bolt-protocol';
import { startPglite } from '@norbital-ai/test-utilities';

const query = async (binding, sql, parameters = []) =>
	binding.call(
		{
			invocationId: InvocationId.make('component-entry-unique'),
			effectId: EffectId.make('component-entry-unique'),
			deadlineEpochMs: Number.MAX_SAFE_INTEGER,
			idempotencyKey: crypto.randomUUID()
		},
		DatabaseRequest.cases.Query.make({ sql, parameters }),
		new AbortController().signal
	);

const MIGRATIONS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../.norbital/migrations');
const DROP_UNIQUE_SQL = readFileSync(
	join(MIGRATIONS_ROOT, '20260902165257_drop_component_entry_global_unique', 'migration.sql'),
	'utf8'
)
	.replace(/--> statement-breakpoint/g, '')
	.trim();

const STANDING_ENTRY_ID = '88888888-8888-4888-8888-888888888888';
const JAN_PAYSLIP = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const FEB_PAYSLIP = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

test('DROP INDEX lets one standing entry land on two payslips', async () => {
	const pglite = await startPglite();
	try {
		const created = await query(
			pglite.binding,
			'CREATE TABLE payslip_component_entry_inputs (' +
				'id uuid PRIMARY KEY, payslip_id uuid NOT NULL, ' +
				'component_entry_id uuid NOT NULL, period text NOT NULL)'
		);
		assert.equal(created._tag, 'Success', JSON.stringify(created));
		const composite = await query(
			pglite.binding,
			'CREATE UNIQUE INDEX ' +
				'payslip_component_entry_inputs_payslip_id_component_entry_id_index ' +
				'ON payslip_component_entry_inputs (payslip_id, component_entry_id)'
		);
		assert.equal(composite._tag, 'Success', JSON.stringify(composite));
		const globalUnique = await query(
			pglite.binding,
			'CREATE UNIQUE INDEX ' +
				'payslip_component_entry_inputs_component_entry_id_index ' +
				'ON payslip_component_entry_inputs (component_entry_id)'
		);
		assert.equal(globalUnique._tag, 'Success', JSON.stringify(globalUnique));

		const first = await query(
			pglite.binding,
			'INSERT INTO payslip_component_entry_inputs ' +
				'(id, payslip_id, component_entry_id, period) VALUES ($1, $2, $3, $4)',
			['cccccccc-cccc-4ccc-8ccc-ccccccccccc1', JAN_PAYSLIP, STANDING_ENTRY_ID, '2026-01']
		);
		assert.equal(first._tag, 'Success', JSON.stringify(first));
		const blocked = await query(
			pglite.binding,
			'INSERT INTO payslip_component_entry_inputs ' +
				'(id, payslip_id, component_entry_id, period) VALUES ($1, $2, $3, $4)',
			['cccccccc-cccc-4ccc-8ccc-ccccccccccc2', FEB_PAYSLIP, STANDING_ENTRY_ID, '2026-02']
		);
		assert.equal(
			blocked._tag,
			'Failure',
			'the live-tenant unique must refuse a second-period standing capture'
		);

		const dropped = await query(pglite.binding, DROP_UNIQUE_SQL);
		assert.equal(dropped._tag, 'Success', JSON.stringify(dropped));
		const second = await query(
			pglite.binding,
			'INSERT INTO payslip_component_entry_inputs ' +
				'(id, payslip_id, component_entry_id, period) VALUES ($1, $2, $3, $4)',
			['cccccccc-cccc-4ccc-8ccc-ccccccccccc2', FEB_PAYSLIP, STANDING_ENTRY_ID, '2026-02']
		);
		assert.equal(second._tag, 'Success', JSON.stringify(second));
		const samePayslip = await query(
			pglite.binding,
			'INSERT INTO payslip_component_entry_inputs ' +
				'(id, payslip_id, component_entry_id, period) VALUES ($1, $2, $3, $4)',
			['cccccccc-cccc-4ccc-8ccc-ccccccccccc3', JAN_PAYSLIP, STANDING_ENTRY_ID, '2026-01']
		);
		assert.equal(samePayslip._tag, 'Failure', 'composite (payslip, entry) unique must remain');

		const counted = await query(
			pglite.binding,
			'SELECT count(*)::int AS n FROM payslip_component_entry_inputs'
		);
		assert.equal(counted._tag, 'Success', JSON.stringify(counted));
		if (counted._tag === 'Success') {
			assert.equal(counted.value.rows[0]?.n, 2);
		}
	} finally {
		await pglite.close();
	}
});
