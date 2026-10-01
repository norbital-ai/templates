// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Dated tables: a settings version declares its tables, its `reference_rows` fill them, and
 * `table()`, `band()` and `bands()` read the rows in force on the site's date. A `code` input picks
 * a row's code. Rows are sealed and cloned with their version. Every figure below is hand-computed
 * from the fixture rows; nothing names a jurisdiction.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from 'effect';
import { factKeysValueSchema } from '../src/lib/datatypes/fact_keys.ts';
import { referenceTablesSchema } from '../src/lib/datatypes/reference_tables.ts';
import { factValuesFault } from '../src/lib/declared-facts.ts';
import {
	TABLE_FUNCTIONS,
	declaredTables,
	referenceCodes,
	referenceRowsFault,
	referenceTables,
	tableMentionFault
} from '../src/lib/expressions/functions/tables.ts';
import { evaluateNumber, runtimeExpressionEngine } from '../src/lib/expressions/evaluate.ts';
import settings from '../src/data/collection/jurisdiction_settings/+collection.ts';
import referenceRows from '../src/data/collection/reference_rows/+collection.ts';
import { action, caller, transform } from './helpers/bodies.ts';

const FLOOR = {
	name: 'FLOOR',
	keys: ['code'],
	columns: [{ key: 'hourly', type: 'number', required: true }]
};
const SECTOR_FLOOR = {
	name: 'SECTOR_FLOOR',
	keys: ['parent_code', 'sector'],
	columns: [
		{ key: 'sector', type: 'code', table: 'SECTOR' },
		{ key: 'hourly', type: 'number' }
	]
};
const SECTOR = { name: 'SECTOR', keys: ['code'], columns: [] };
const RATE = {
	name: 'RATE',
	keys: [],
	range: { from_inclusive: true, to_inclusive: true },
	columns: [{ key: 'percent', type: 'number' }]
};
const OPEN_LOW = {
	...RATE,
	name: 'OPEN_LOW',
	range: { from_inclusive: false, to_inclusive: true }
};
const DECLARED = [FLOOR, SECTOR_FLOOR, SECTOR, RATE, OPEN_LOW];

const row = (table, code, from, to, extra = {}) => ({
	table,
	code,
	effective_range: { from, to },
	values: {},
	...extra
});
const ROWS = [
	row('FLOOR', 'R1', '2025-01-01', '2025-11-30', { values: { hourly: 10 } }),
	row('FLOOR', 'R1', '2025-12-01', null, { values: { hourly: 11.5 } }),
	row('FLOOR', 'R2', '2025-01-01', null, { values: { hourly: 9 } }),
	row('SECTOR', 'S1', '2025-01-01', null, { parent_code: 'G1', label: 'Sector one' }),
	row('SECTOR_FLOOR', 'R1-S1', '2025-01-01', null, {
		parent_code: 'R1',
		values: { sector: 'S1', hourly: 12 }
	}),
	row('RATE', 'B1', '2025-01-01', null, { range_from: 0, range_to: 1000, values: { percent: 1 } }),
	row('RATE', 'B2', '2025-01-01', null, {
		range_from: 1000.01,
		range_to: 2000,
		values: { percent: 2 }
	}),
	row('RATE', 'B3', '2025-01-01', null, { range_from: 2000.01, values: { percent: 3 } }),
	row('OPEN_LOW', 'L1', '2025-01-01', null, { range_to: 1000, values: { percent: 1 } }),
	row('OPEN_LOW', 'L2', '2025-01-01', null, {
		range_from: 1000,
		range_to: 2000,
		values: { percent: 2 }
	})
];
const at = referenceTables(DECLARED, ROWS);

test('table() reads the row in force on the date: the effective-date boundary picks the successor', () => {
	assert.equal(at('2025-11-30').table('FLOOR', ['R1']).hourly, 10);
	assert.equal(at('2025-12-01').table('FLOOR', ['R1']).hourly, 11.5);
	assert.equal(at('2025-12-01').table('FLOOR', ['R2']).hourly, 9);
	assert.equal(at('2025-12-01').table('FLOOR', ['R9']), null, 'no match is null, never zero');
	assert.equal(at('2024-12-31').table('FLOOR', ['R1']), null, 'before any row is in force');
	const two = at('2025-12-01').table('SECTOR_FLOOR', ['R1', 'S1']);
	assert.deepEqual([two.hourly, two.code, two.parent_code, two.sector], [12, 'R1-S1', 'R1', 'S1']);
	assert.equal(at('2025-12-01').table('SECTOR_FLOOR', ['R2', 'S1']), null);
});

test('a lookup refuses an undeclared table, the wrong key count and the wrong lookup for its shape', () => {
	const on = at('2025-12-01');
	assert.throws(() => on.table('NOPE', ['R1']), /declares no table NOPE/);
	assert.throws(() => on.table('FLOOR', []), /keyed by code; this call passes 0 keys/);
	assert.throws(() => on.table('RATE', []), /band table; look it up with band/);
	assert.throws(() => on.band('FLOOR', 5, ['R1']), /declares no range/);
});

test('band() admits a value on an inclusive edge; a both-inclusive seam steps one cent', () => {
	const on = at('2026-01-01');
	assert.equal(on.band('RATE', 0, []).code, 'B1');
	assert.equal(on.band('RATE', 1000, []).code, 'B1', 'the ceiling is inclusive');
	assert.equal(on.band('RATE', 1000.01, []).code, 'B2', 'the next floor is one cent up');
	assert.equal(on.band('RATE', 2000, []).code, 'B2');
	assert.equal(on.band('RATE', 999999, []).code, 'B3', 'an empty ceiling is unbounded');
	assert.equal(on.band('RATE', -1, []), null, 'below every floor');
	// A floor-exclusive table shares its seam: 1000 is L1's ceiling and above L2's open floor.
	assert.equal(on.band('OPEN_LOW', 1000, []).code, 'L1');
	assert.equal(on.band('OPEN_LOW', 1000.001, []).code, 'L2');
	assert.equal(on.band('OPEN_LOW', -50, []).code, 'L1', 'an empty floor is unbounded');
});

test('bands() lists the matching rows lowest range first', () => {
	assert.deepEqual(
		at('2026-01-01')
			.bands('RATE', [])
			.map((band) => [band.code, band.range_from, band.range_to, band.percent]),
		[
			['B1', 0, 1000, 1],
			['B2', 1000.01, 2000, 2],
			['B3', 2000.01, null, 3]
		]
	);
	assert.deepEqual(at('2024-01-01').bands('RATE', []), []);
});

test('the write-time stand-in answers one typed placeholder per declared table', () => {
	const blank = declaredTables(DECLARED);
	assert.equal(blank.table('FLOOR', ['anything']).hourly, 0);
	assert.equal(blank.band('RATE', 5, []).percent, 0);
	assert.equal(blank.bands('RATE', []).length, 1);
	assert.throws(() => blank.table('NOPE', ['x']), /declares no table NOPE/);
	assert.throws(() => blank.table('FLOOR', ['x', 'y']), /passes 2 keys/);
});

test('an expression names only declared tables, each with the lookup its shape takes', () => {
	assert.equal(
		tableMentionFault(DECLARED, "max(table('FLOOR', region).hourly, band('RATE', 5).percent)"),
		null
	);
	assert.match(tableMentionFault(DECLARED, "table('NOPE', x).v"), /does not declare/);
	assert.match(tableMentionFault(DECLARED, "table('RATE').percent"), /use band\('RATE'/);
	assert.match(tableMentionFault(DECLARED, "band('FLOOR', 1, x).hourly"), /use table\('FLOOR'/);
});

test('the registered functions read the engine’s bound tables, and refuse where none are bound', () => {
	const call = (signature, engine, ...args) =>
		TABLE_FUNCTIONS.find((entry) => entry.signature === signature).handler(engine, ...args);
	const engine = { tables: at('2025-12-01') };
	assert.equal(call('table(string, dyn): dyn', engine, 'FLOOR', 'R1').hourly, 11.5);
	assert.equal(call('band(string, dyn): dyn', engine, 'RATE', 1500n).code, 'B2', 'a CEL int');
	assert.equal(call('table(string, dyn, dyn): dyn', engine, 'SECTOR_FLOOR', 'R1', 'S1').hourly, 12);
	assert.equal(call('bands(string): list', engine, 'RATE').length, 3);
	assert.throws(() => call('table(string, dyn): dyn', {}, 'FLOOR', 'R1'), /no reference tables/);
});

test('a stored floor expression takes the higher of two table rows through the engine', () => {
	const engine = runtimeExpressionEngine({ tables: at('2025-12-01') });
	const floor =
		"max(table('FLOOR', region).hourly, table('SECTOR_FLOOR', region, sector) == null ? 0.0 : table('SECTOR_FLOOR', region, sector).hourly)";
	// R1 from 2025-12-01: 11.5 against the sector's 12 → 12; R2: 9 against no sector row → 9.
	assert.equal(evaluateNumber(engine, floor, { region: 'R1', sector: 'S1' }), 12);
	assert.equal(evaluateNumber(engine, floor, { region: 'R2', sector: 'S1' }), 9);
});

test('rows fit their declarations: keys present, values typed, ranges only on band tables', () => {
	assert.equal(referenceRowsFault(DECLARED, ROWS), null);
	const fault = (extra) => referenceRowsFault(DECLARED, [...ROWS, extra]);
	assert.match(fault(row('NOPE', 'X', '2025-01-01', null)), /does not declare/);
	assert.match(fault(row('FLOOR', 'R3', '2025-01-01', null)), /hourly is required/);
	assert.match(
		fault(row('FLOOR', 'R3', '2025-01-01', null, { values: { hourly: 'ten' } })),
		/must be a number/
	);
	assert.match(
		fault(row('FLOOR', 'R3', '2025-01-01', null, { values: { hourly: 1, daily: 8 } })),
		/carries daily/
	);
	assert.match(
		fault(row('FLOOR', 'R3', '2025-01-01', null, { values: { hourly: 1 }, range_to: 5 })),
		/declares none/
	);
	assert.match(
		fault(row('SECTOR_FLOOR', 'R2-S1', '2025-01-01', null, { values: { sector: 'S1' } })),
		/has no parent_code/
	);
	assert.match(
		fault(
			row('SECTOR_FLOOR', 'R2-S9', '2025-01-01', null, {
				parent_code: 'R2',
				values: { sector: 'S9' }
			})
		),
		/S9 is not a code of table SECTOR/
	);
	assert.match(
		fault(row('RATE', 'B0', '2025-01-01', null, { range_from: 5, range_to: 1 })),
		/ends its range below its start/
	);
});

test('rows of one key never overlap: not in dates, and on a band table not in range', () => {
	const fault = (extra) => referenceRowsFault(DECLARED, [...ROWS, extra]);
	assert.match(
		fault(row('FLOOR', 'R1', '2025-11-01', null, { values: { hourly: 1 } })),
		/FLOOR\/R1 and FLOOR\/R1 overlap/
	);
	assert.equal(
		fault(row('FLOOR', 'R1', '2024-01-01', '2024-12-31', { values: { hourly: 1 } })),
		null,
		'a row ending the day before the next begins'
	);
	// Both bounds inclusive: a band starting on B1's ceiling overlaps it by the one value 1000.
	assert.match(
		fault(row('RATE', 'BX', '2025-01-01', null, { range_from: 1000, range_to: 1000 })),
		/overlap/
	);
	// A floor-exclusive table shares its seam without overlap.
	assert.equal(
		fault(row('OPEN_LOW', 'L3', '2025-01-01', null, { range_from: 2000, range_to: 3000 })),
		null
	);
	assert.match(
		fault(row('OPEN_LOW', 'L4', '2025-01-01', null, { range_from: 1999, range_to: 3000 })),
		/overlap/
	);
});

test('a code input names its table; its parent is another code input of the list, or a record column', () => {
	const decode = Schema.decodeUnknownSync(factKeysValueSchema);
	assert.doesNotThrow(() =>
		decode([
			{ key: 'group', type: 'code', table: 'GROUP' },
			{ key: 'sector', type: 'code', table: 'SECTOR', parent_fact: 'group' }
		])
	);
	assert.throws(() => decode([{ key: 'sector', type: 'code' }]), /names the table/);
	assert.throws(() => decode([{ key: 'n', type: 'number', table: 'SECTOR' }]), /belong to a code/);
	assert.throws(
		() =>
			decode([
				{ key: 'group', type: 'string' },
				{ key: 'sector', type: 'code', table: 'SECTOR', parent_fact: 'group' }
			]),
		/parent input group is not a code input/
	);
	// naming no input of the list, the parent is the subject record's column (a worksite's region)
	assert.doesNotThrow(() =>
		decode([{ key: 'sector', type: 'code', table: 'SECTOR', parent_fact: 'region' }])
	);
	assert.doesNotThrow(() => Schema.decodeUnknownSync(referenceTablesSchema)(DECLARED));
	assert.throws(
		() =>
			Schema.decodeUnknownSync(referenceTablesSchema)([
				{ name: 'T', keys: ['region'], columns: [] }
			]),
		/key region is neither/
	);
	assert.throws(
		() => Schema.decodeUnknownSync(referenceTablesSchema)([SECTOR, SECTOR]),
		/declared once/
	);
});

test('a code value must be a row in force on its date, under its parent code', () => {
	const fields = [
		{ key: 'group', type: 'code', table: 'GROUP' },
		{ key: 'sector', type: 'code', table: 'SECTOR', parent_fact: 'group' }
	];
	const rows = [
		row('GROUP', 'G1', '2025-01-01', null),
		row('GROUP', 'G2', '2025-01-01', null),
		row('SECTOR', 'S1', '2025-01-01', '2025-12-31', { parent_code: 'G1' })
	];
	const on = (day) => referenceCodes(rows, day);
	const check = (values, day) =>
		factValuesFault(fields, values, false, undefined, undefined, on(day));
	assert.equal(check({ group: 'G1', sector: 'S1' }, '2025-06-01'), null);
	assert.match(
		check({ group: 'G1', sector: 'S9' }, '2025-06-01'),
		/S9 is not a code of table SECTOR/
	);
	assert.match(
		check({ group: 'G1', sector: 'S1' }, '2026-01-01'),
		/not a code .* in force/,
		'expired'
	);
	assert.match(
		check({ group: 'G2', sector: 'S1' }, '2025-06-01'),
		/does not belong under group G2/
	);
	assert.equal(
		factValuesFault(fields, { sector: 'S9' }),
		null,
		'without a resolver only the type is checked'
	);
});

const version = (id, from, sealed, extra = {}) => ({
	id,
	code: 'PUB',
	jurisdiction_code: 'PUB',
	name: `PUB ${from}`,
	sealed_at: sealed ? `${from}T00:00:00.000Z` : null,
	voided_at: null,
	void_reason: null,
	approval_id: null,
	payroll: { currency: 'XXX' },
	facts: [],
	exit_facts: [],
	obligations: [],
	tables: DECLARED,
	effective_range: { from, to: null },
	...extra
});
const under = (settingsId) =>
	ROWS.map((stored, index) => ({
		...stored,
		id: `r${index}`,
		revision: 1,
		settings_id: settingsId,
		approval_id: null
	}));

test('a new version clones every reference row under it', async () => {
	const ctx = caller({
		tables: {
			jurisdiction_settings: [version('v1', '2025-01-01', true)],
			reference_rows: under('v1')
		}
	});
	await action(
		settings,
		'new_settings_version',
		{ settings_id: 'v1', starts_on: '2026-07-01' },
		ctx
	);
	const [{ input }] = ctx.acts;
	assert.deepEqual(input.tables, DECLARED);
	assert.deepEqual(input.reference_rows.create, ROWS);
});

test('sealing judges the version’s rows, table mentions and code inputs', async () => {
	const seal = (draft, rows) =>
		transform(settings, [{ sealed_at: '2026-07-01T00:00:00.000Z' }], {
			existing: [draft],
			tables: { jurisdiction_settings: [draft], reference_rows: rows }
		});
	const draft = version('v2', '2026-07-01', false);
	await seal(draft, under('v2'));
	await assert.rejects(
		seal(draft, [...under('v2'), { ...under('v2')[0], id: 'dup', values: { hourly: 1 } }]),
		/overlap/
	);
	await assert.rejects(
		seal(
			version('v2', '2026-07-01', false, {
				terms_facts: [{ key: 'kind', type: 'code', table: 'KIND' }]
			}),
			under('v2')
		),
		/table KIND, which this settings version does not declare/
	);
	await assert.rejects(
		seal(
			version('v2', '2026-07-01', false, {
				terms_facts: [{ key: 'sector', type: 'code', table: 'SECTOR', default_value: 'S9' }]
			}),
			under('v2')
		),
		/S9 is not a code of table SECTOR when this version begins/
	);
	const permit = (document) =>
		version('v2', '2026-07-01', false, {
			tables: [...DECLARED, { name: 'DOCUMENT_TYPE', keys: ['code'], columns: [] }],
			terms_facts: [{ key: 'permit', type: 'boolean', evidence: { kind: 'FILE', document } }]
		});
	const documents = [
		...under('v2'),
		{ ...row('DOCUMENT_TYPE', 'D1', '2025-01-01', null), settings_id: 'v2', approval_id: null }
	];
	await seal(permit('D1'), documents);
	await assert.rejects(
		seal(permit('D9'), documents),
		/document D9, which is not a DOCUMENT_TYPE row/
	);
});

test('a reference row of a sealed version cannot be created, changed or moved', async () => {
	const tables = {
		jurisdiction_settings: [
			version('sealed', '2025-01-01', true),
			version('draft', '2026-01-01', false)
		]
	};
	const mutate = (input, existing) =>
		transform(referenceRows, [input], { existing: [existing], tables });
	const stored = { ...under('sealed')[0] };
	const sealed = /is sealed, so it cannot be created, changed or deleted/;
	await assert.rejects(mutate({ ...ROWS[0], settings_id: 'sealed' }), sealed);
	await assert.rejects(mutate({ values: { hourly: 99 } }, stored), sealed);
	const draft = { ...stored, settings_id: 'draft' };
	assert.deepEqual(await mutate({ values: { hourly: 99 } }, draft), [{ values: { hourly: 99 } }]);
});
