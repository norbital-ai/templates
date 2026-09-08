import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { DatabaseRequest, EffectId, InvocationId } from '@norbital-ai/bolt-protocol';
import { startPglite } from '@norbital-ai/test-utilities';

/** Captures are unique per payslip. Claim and Payment are also consumed once globally. */

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
const SOURCE_ROW_ID = 'aaaa2222-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const JAN_PAYSLIP = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const FEB_PAYSLIP = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';

const JUNCTIONS = [
	{
		name: 'payslip_allowance_request_inputs',
		source: 'allowance_request_id',
		firstId: 'cccccccc-cccc-4ccc-8ccc-cccccccc2001',
		secondId: 'cccccccc-cccc-4ccc-8ccc-cccccccc2002',
		sameId: 'cccccccc-cccc-4ccc-8ccc-cccccccc2003'
	},
	{
		name: 'payslip_leave_inputs',
		source: 'leave_entry_id',
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
];

/** Every `CREATE … INDEX` the committed lineage declares, in the order it declares them. */
const declaredIndexes = async (): Promise<readonly string[]> => {
	const folders = (await readdir(MIGRATIONS_ROOT)).toSorted();
	assert.ok(folders.length > 0, 'the template has a committed migration lineage');
	const statements: string[] = [];
	for (const folder of folders) {
		const sql = await readFile(join(MIGRATIONS_ROOT, folder, 'migration.sql'), 'utf8');
		for (const line of sql.split('\n')) {
			if (/CREATE\s+(UNIQUE\s+)?INDEX/i.test(line)) statements.push(line.trim());
		}
	}
	return statements;
};

test('every capture is unique per payslip, and only the single-use families are unique per source', async () => {
	const indexes = await declaredIndexes();
	for (const junction of JUNCTIONS) {
		const composite = indexes.filter(
			(statement) =>
				statement.includes(`ON "${junction.name}"`) &&
				statement.includes(`"payslip_id","${junction.source}"`)
		);
		assert.equal(
			composite.length,
			1,
			`${junction.name} must unique on (payslip_id, ${junction.source}): ${JSON.stringify(indexes)}`
		);

		const global = indexes.filter(
			(statement) =>
				statement.includes(`ON "${junction.name}"`) &&
				/UNIQUE/i.test(statement) &&
				statement.includes(`("${junction.source}")`)
		);
		if (junction.singleUse === true) {
			assert.equal(
				global.length,
				1,
				`${junction.name} must unique on ${junction.source} alone: a ${junction.source.replace(/_id$/, '').replace(/_/g, ' ')} is consumed once`
			);
		} else {
			assert.deepEqual(
				global,
				[],
				`${junction.name} declares a global unique on ${junction.source}, so one input can only ever reach one payslip`
			);
		}
	}
});

test('recurring captures can reach another payslip while single-use inputs cannot', async () => {
	const pglite = await startPglite();
	try {
		for (const junction of JUNCTIONS) {
			const created = await query(
				pglite.binding,
				`CREATE TABLE ${junction.name} (` +
					'id uuid PRIMARY KEY, payslip_id uuid NOT NULL, ' +
					`${junction.source} uuid NOT NULL, period text NOT NULL)`
			);
			assert.equal(created._tag, 'Success', JSON.stringify(created));
			// Exactly the index the baseline declares, and nothing else.
			const composite = await query(
				pglite.binding,
				`CREATE UNIQUE INDEX ${junction.name}_payslip_id_${junction.source}_index ` +
					`ON ${junction.name} (payslip_id, ${junction.source})`
			);
			assert.equal(composite._tag, 'Success', JSON.stringify(composite));
			if (junction.singleUse) {
				const uniqueSource = await query(
					pglite.binding,
					`CREATE UNIQUE INDEX ${junction.name}_source ON ${junction.name} (${junction.source})`
				);
				assert.equal(uniqueSource._tag, 'Success', JSON.stringify(uniqueSource));
			}

			const first = await query(
				pglite.binding,
				`INSERT INTO ${junction.name} (id, payslip_id, ${junction.source}, period) VALUES ($1, $2, $3, $4)`,
				[junction.firstId, JAN_PAYSLIP, SOURCE_ROW_ID, '2026-01']
			);
			assert.equal(first._tag, 'Success', JSON.stringify(first));

			// The remainder, on the next run's payslip. This is what a global unique forbade.
			const second = await query(
				pglite.binding,
				`INSERT INTO ${junction.name} (id, payslip_id, ${junction.source}, period) VALUES ($1, $2, $3, $4)`,
				[junction.secondId, FEB_PAYSLIP, SOURCE_ROW_ID, '2026-02']
			);
			assert.equal(
				second._tag,
				junction.singleUse ? 'Failure' : 'Success',
				`${junction.name} did not enforce its source consumption rule: ${JSON.stringify(second)}`
			);

			// Twice on one payslip is still a double capture, and still refused.
			const samePayslip = await query(
				pglite.binding,
				`INSERT INTO ${junction.name} (id, payslip_id, ${junction.source}, period) VALUES ($1, $2, $3, $4)`,
				[junction.sameId, JAN_PAYSLIP, SOURCE_ROW_ID, '2026-01']
			);
			assert.equal(
				samePayslip._tag,
				'Failure',
				`composite (payslip, ${junction.source}) unique must remain`
			);
		}
	} finally {
		await pglite.close();
	}
});

/**
 * `quantity` counts something, and a component entry does not.
 *
 * The column was on the entries table and nothing multiplied by it, so it was dropped, and none of
 * the request families carries it. A payslip adjustment keeps its own inside the `adjustments`
 * array, because that one is fed by sources that genuinely count: leave days, work hours.
 */
test('an entry states an amount; only a calculated line states a quantity', () => {
	const folders = readdirSync(MIGRATIONS_ROOT).toSorted();
	const sql = folders
		.map((folder) => readFileSync(join(MIGRATIONS_ROOT, folder, 'migration.sql'), 'utf8'))
		.join('\n');
	const columnsOf = (table: string): readonly string[] => {
		const body = new RegExp(`CREATE TABLE "${table}" \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1];
		assert.ok(body != null, `${table} is not created by the committed lineage`);
		return [...body.matchAll(/^\t"([a-z_]+)"/gm)].map((match) => match[1] ?? '');
	};
	for (const family of ['claim_requests', 'allowance_requests', 'payment_requests']) {
		const entry = columnsOf(family);
		assert.ok(entry.includes('amount'), `${family} states the amount it is worth`);
		assert.equal(
			entry.includes('quantity'),
			false,
			`${family} carries a quantity, and nothing multiplies by it`
		);
	}
	// The single-use sources carry their settlement pin; the multi-capture families keep rows.
	for (const source of ['work_days', 'claim_requests', 'payment_requests'])
		assert.ok(columnsOf(source).includes('settled_payslip_id'), `${source} pins its payslip`);
	assert.ok(columnsOf('payslips').includes('adjustments'));
});
