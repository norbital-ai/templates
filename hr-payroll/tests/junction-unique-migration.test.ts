import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { DatabaseRequest, EffectId, InvocationId } from '@norbital-ai/bolt-protocol';
import { startPglite } from '@norbital-ai/test-utilities';

/**
 * One captured input may appear on several payslips, and never twice on the same one.
 *
 * True of all three input junctions for the same reason, so they are one table of cases rather
 * than three files repeating it. A standing allowance recurs into the next period; net-pay
 * protection can leave a leave request or a loan repayment part-recovered, so the next run
 * captures the remainder — the same source row, a second payslip. A global unique on the
 * source column forbids that and quietly caps recovery at one period; a composite unique on
 * `(payslip_id, source_id)` allows it while still refusing a double capture on one slip.
 *
 * This used to prove it by replaying `drop_leave_and_loan_global_unique` — a migration that no
 * longer exists, because the template was re-baselined to a single migration like its three
 * siblings. Pinning a lineage entry made the test an artefact of how the schema was *reached*
 * rather than of what it *is*, so it now reads the baseline in force and asserts the shape there:
 * the composite index exists, no global one does, and the database behaves accordingly.
 */

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
		name: 'payslip_component_entry_inputs',
		source: 'component_entry_id',
		firstId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
		secondId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
		sameId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'
	},
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

test('the schema in force uniques a capture per payslip, not per source row', async () => {
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
		// The one that must not exist: a unique on the source column alone caps a part-recovered
		// input at a single payslip, which is the bug this shape was chosen to prevent.
		const global = indexes.filter(
			(statement) =>
				statement.includes(`ON "${junction.name}"`) &&
				/UNIQUE/i.test(statement) &&
				statement.includes(`("${junction.source}")`)
		);
		assert.deepEqual(
			global,
			[],
			`${junction.name} declares a global unique on ${junction.source}, so one input can only ever reach one payslip`
		);
	}
});

test('a captured input lands on two payslips, and never twice on one', async () => {
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
				'Success',
				`${junction.name} refused a part-recovered input a second payslip: ${JSON.stringify(second)}`
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
 * The column was on `component_entries` and nothing multiplied by it — the engine copied it onto
 * the payslip adjustment and used it nowhere — so it was dropped. `payslip_adjustments` keeps its
 * own, because that one is fed by sources that genuinely count: leave days, work hours.
 *
 * Two tables, one word, opposite answers. Written down here because the asymmetry reads as an
 * oversight otherwise, and the cheap "fix" is to put the column back on the input where a form
 * would then offer a number nothing consumes.
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
	const entry = columnsOf('component_entries');
	assert.ok(entry.includes('amount'), 'a component entry states the amount it is worth');
	assert.equal(
		entry.includes('quantity'),
		false,
		'component_entries carries a quantity again, and nothing multiplies by it'
	);
	const adjustment = columnsOf('payslip_adjustments');
	assert.ok(
		adjustment.includes('quantity'),
		'a calculated line lost the quantity its leave days and work hours are counted in'
	);
});
