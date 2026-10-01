// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A holiday a payroll run captured cannot be unpublished, moved or deleted; the holidays spreadsheet resolves entity
 * names, skips days already on file and reports every row it did not write.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import holidays from '../src/data/collection/jurisdiction_holidays/+collection.ts';
import { action, caller, transform } from './helpers/bodies.ts';

const holiday = {
	id: 'h1',
	company_id: 'entity',
	date: '2026-05-01',
	name: 'Labour Day',
	published_at: '2026-01-01T00:00:00.000Z'
};
const captured = {
	payroll_runs: [{ id: 'run', company_id: 'entity', period: '2026-05', holidays: [{ id: 'h1' }] }]
};

test('a captured holiday cannot be unpublished, moved or deleted; an uncaptured one can', async () => {
	const one = (input, tables) => transform(holidays, [input], { existing: [holiday], tables });
	await assert.rejects(
		one({ published_at: null }, captured),
		/captured by payroll run 2026-05 and cannot be unpublished/
	);
	await assert.rejects(one({ date: '2026-05-02' }, captured), /move its day, entity or worksite/);
	await assert.rejects(one({ worksite: 'Navotas' }, captured), /move its day, entity or worksite/);
	await assert.rejects(one({ $delete: true }, captured), /cannot be deleted/);
	await one({ name: 'Hari Pekerja' }, captured);
	await one({ published_at: null }, {});
	await one({ $delete: true }, {});
});

test('an applies_when that does not compile as a person condition is refused; a valid one is kept', async () => {
	const one = (applies_when) =>
		transform(holidays, [{ ...holiday, id: undefined, applies_when }], {
			existing: [undefined],
			tables: {}
		});
	await assert.rejects(one('employee.religion =='), /Applies when:/);
	await assert.rejects(one('employee.religion'), /Applies when:/);
	const [row] = await one("employee.religion == 'HINDU'");
	assert.equal(row.applies_when, "employee.religion == 'HINDU'");
});

test('one row per entity, day and worksite: two cities keep their own day on one date; blank is company-wide', async () => {
	// RA 7669 s.1 (San Juan) and Proclamation 1186 (Las Piñas) both fall on 27 March 2026.
	const model = (await import('../src/data/model/jurisdiction_holidays/+model.ts')).default;
	assert.deepEqual(model.unique, [{ fields: ['company_id', 'date', 'worksite'] }]);
	const [row] = await transform(holidays, [{ ...holiday, id: undefined, worksite: '  ' }], {
		existing: [undefined],
		tables: {}
	});
	assert.equal(row.worksite, null);
});

test('the spreadsheet resolves entities by name, skips days on file and reports what it did not write', async () => {
	const tables = {
		companies: [{ id: 'entity', name: 'Public Fixture Co', registration_number: 'PUB-1' }],
		// A worksite's local day does not hold the company-wide date: 2027-02-01 still imports.
		jurisdiction_holidays: [
			{ company_id: 'entity', date: '2027-01-01', approval_id: null },
			{ company_id: 'entity', date: '2027-02-01', worksite: 'Navotas', approval_id: null }
		]
	};
	const row = (date, name, legal_entity = 'Public Fixture Co') => ({ legal_entity, date, name });
	const ctx = caller({ tables });
	await assert.rejects(
		action(
			holidays,
			'import_workbook',
			{ rows: [row('2027-01-01', 'New Year', 'Nobody Ltd')] },
			ctx
		),
		/cannot resolve:\n• Nobody Ltd/
	);
	const out = await action(
		holidays,
		'import_workbook',
		{
			rows: [
				row('2027-01-01', 'New Year'),
				row('2027-02-01', 'Draft'),
				row('2027-02-01', 'Federal Territory Day', 'pub-1')
			]
		},
		ctx
	);
	assert.deepEqual(out, {
		inserted: 1,
		skipped: [
			{ company_id: 'entity', date: '2027-02-01', name: 'Draft', reason: 'DUPLICATE_IN_FILE' },
			{ company_id: 'entity', date: '2027-01-01', name: 'New Year', reason: 'ALREADY_PRESENT' }
		]
	});
	assert.deepEqual(ctx.acts[0].input, [
		{
			company_id: 'entity',
			date: '2027-02-01',
			name: 'Federal Territory Day',
			replaces: null,
			source: 'spreadsheet'
		}
	]);
	await assert.rejects(
		action(holidays, 'import_workbook', { rows: [row('2027-02-30', 'Bad')] }, ctx),
		/not a calendar day/
	);
});
