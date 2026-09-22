// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Every sealed row of the public seed passes the write path a clone takes.
 *
 * `new_settings_version` clones a version and every row under it through the collections' own
 * transforms, and so does `statutory_drift`. A row whose expression the transform refuses is a
 * law an operator cannot enact a successor to — the seed ships it, the runtime prices it, and the
 * Settings timeline cannot clone it. That is a mechanism gap, not a data one, so every lineage
 * under `seed/jurisdiction/` is replayed here as a clone writes it: children without a parent key,
 * an empty database, and the custom-typed columns decoded by the platform schema.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lawFileExists, readLawFile } from './fixtures/law-file.ts';
import { transformSync } from './helpers/transform.ts';
import statutoryContributions from '../src/collections/statutory_contributions/+collection.ts';
import leaveCatalogue from '../src/collections/leave_catalogue/+collection.ts';
import loanCatalogue from '../src/collections/loan_catalogue/+collection.ts';
import claimCatalogue from '../src/collections/claim_catalogue/+collection.ts';
import adhocCatalogue from '../src/collections/adhoc_catalogue/+collection.ts';
import allowanceCatalogue from '../src/collections/allowance_catalogue/+collection.ts';
import catalogueBand from '../src/datatypes/catalogue_band/+definition.ts';
import contributionRules from '../src/datatypes/contribution_rules/+definition.ts';
import codeList from '../src/datatypes/code_list/+definition.ts';
import factKeys from '../src/datatypes/fact_keys/+definition.ts';
import leaveEntitlement from '../src/datatypes/leave_entitlement/+definition.ts';
import obligations from '../src/datatypes/obligations/+definition.ts';
import payrollSettings from '../src/datatypes/payroll_settings/+definition.ts';
import sources from '../src/datatypes/sources/+definition.ts';
import workRules from '../src/datatypes/work_rules/+definition.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../seed/jurisdiction');
const FAMILIES = [
	['statutory_contributions', statutoryContributions],
	['leave_catalogue', leaveCatalogue],
	['loan_catalogue', loanCatalogue],
	['claim_catalogue', claimCatalogue],
	['adhoc_catalogue', adhocCatalogue],
	['allowance_catalogue', allowanceCatalogue]
] as const;

/** An empty database: a clone's children are created before their parent key exists. */
const EMPTY_DB = Object.fromEntries(
	[
		'jurisdiction_settings',
		'statutory_contributions',
		'leave_catalogue',
		'loan_catalogue',
		'claim_catalogue',
		'adhoc_catalogue',
		'allowance_catalogue'
	].map((collection) => [collection, { findMany: () => Effect.succeed([]) }])
);

/** The columns the runtime owns, which a nested create never carries. */
const SYSTEM_COLUMNS = [
	'id',
	'settings_id',
	'approval_id',
	'created_at',
	'updated_at',
	'row_version'
];

/**
 * Every custom-typed column the seeded tables carry, and the datatype the write path decodes it
 * with. A datatype's `~standard` schema is the same decode a draft write runs, so a seed value it
 * refuses is a version an operator cannot clone or revise — the gap this file exists to catch.
 */
const CUSTOM_COLUMNS = {
	jurisdiction_settings: [
		['payroll', payrollSettings],
		['sources', sources],
		['work_rules', workRules],
		['facts', factKeys],
		['exit_facts', factKeys],
		['obligations', obligations]
	],
	statutory_contributions: [
		['elections', factKeys],
		['rules', contributionRules],
		['parts', codeList]
	],
	leave_catalogue: [['entitlement', leaveEntitlement]],
	claim_catalogue: [
		['bands', catalogueBand],
		['counts_toward', codeList]
	],
	adhoc_catalogue: [
		['bands', catalogueBand],
		['counts_toward', codeList]
	],
	allowance_catalogue: [
		['bands', catalogueBand],
		['counts_toward', codeList]
	],
	loan_catalogue: [['bands', catalogueBand]]
};

/** One table's rows through their own datatypes; returns how many values were decoded. */
const validateColumns = (where, table, rows) => {
	let decoded = 0;
	for (const row of rows) {
		for (const [column, datatype] of CUSTOM_COLUMNS[table]) {
			const value = row[column];
			if (value == null) continue;
			const outcome = datatype.schema['~standard'].validate(value);
			assert.equal(
				outcome.issues,
				undefined,
				`${where} ${table} ${row.code ?? row.id} ${column}: the write path would refuse — ${JSON.stringify(outcome.issues)?.slice(0, 400)}`
			);
			decoded += 1;
		}
	}
	return decoded;
};

const childInputs = (rows) =>
	rows.map((row) =>
		Object.fromEntries(Object.entries(row).filter(([column]) => !SYSTEM_COLUMNS.includes(column)))
	);

test('every sealed public-seed row survives the clone write path', () => {
	let versions = 0;
	let rows = 0;
	let decoded = 0;
	for (const lineage of readdirSync(ROOT)) {
		const directory = resolve(ROOT, lineage);
		if (!lawFileExists(resolve(directory, 'jurisdiction_settings'))) continue;
		for (const version of readLawFile(resolve(directory, 'jurisdiction_settings'))) {
			versions += 1;
			decoded += validateColumns(`${lineage} ${version.code}`, 'jurisdiction_settings', [version]);
			for (const [table, collection] of FAMILIES) {
				if (!lawFileExists(resolve(directory, table))) continue;
				const inputs = childInputs(
					readLawFile(resolve(directory, table)).filter((row) => row.settings_id === version.id)
				);
				if (inputs.length === 0) continue;
				rows += inputs.length;
				decoded += validateColumns(`${lineage} ${version.code}`, table, inputs);
				try {
					transformSync(collection, inputs, { db: EMPTY_DB });
				} catch (error) {
					assert.fail(
						`${lineage} ${version.code} ${version.id} ${table}: a clone would refuse — ${error instanceof Error ? error.message : String(error)}`
					);
				}
			}
		}
	}
	assert.ok(versions > 0, 'the public seed carries sealed versions to replay');
	assert.ok(rows > 0, 'the public seed carries catalogue rows to replay');
	assert.ok(decoded > rows, 'the public seed carries custom-typed values to decode');
});
