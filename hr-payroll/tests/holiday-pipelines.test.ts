// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The one door holidays come through, and the refusal behind it.
 *
 * `jurisdiction_holidays/+pipelines.ts` answers two documents on the same handler: the spreadsheet,
 * and a publication decision for the rows a person ticked in the table. The publication arm has no
 * write of its own — an import pipeline answers with the rows to write, and that is how bulk
 * publish gets written — so until now it was only ever reached by the headed calendar test, which
 * publishes exactly one row through the browser and asserts nothing about unpublishing.
 *
 * The last case is the wall on the other side: a holiday payroll has already taken cannot be
 * unpublished, whatever the table's bulk action answers with. It is asserted through the hook,
 * because the hook is where the refusal lives for every writer — the pipeline, the form and the
 * table alike.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import holidayHooks from '../src/collections/jurisdiction_holidays/+hooks.ts';
import holidayPipelines from '../src/collections/jurisdiction_holidays/+pipelines.ts';

/** A read-only api whose holidays table holds exactly the days the jurisdiction already has. */
const api = (existing: ReadonlyArray<{ jurisdiction_code: string; date: string }> = []) =>
	({ db: { jurisdiction_holidays: { findMany: () => Effect.succeed(existing) } } }) as never;

const runImport = (
	input: unknown,
	existing?: ReadonlyArray<{ jurisdiction_code: string; date: string }>
) => Effect.runPromise(holidayPipelines.import.handler({ input }, api(existing)));

const row = (date: string, name = 'Festival', jurisdiction_code = 'MY') => ({
	jurisdiction_code,
	date,
	name,
	original_date: null,
	source: null
});

test('publishing the selected rows answers one stamped row per id', async () => {
	const before = Date.now();
	const answered = await runImport({ publish: ['holiday-a', 'holiday-b'], published: true });
	const after = Date.now();

	assert.deepEqual(
		answered.map((written) => written.id),
		['holiday-a', 'holiday-b'],
		'one row per selected id, in the order they were selected'
	);
	for (const written of answered) {
		assert.deepEqual(Object.keys(written).toSorted(), ['id', 'published_at']);
		const stamped = Date.parse(written.published_at);
		assert.ok(Number.isFinite(stamped), `published_at is not a timestamp: ${written.published_at}`);
		assert.ok(stamped >= before && stamped <= after, 'the stamp is the moment it was published');
	}
	// Every selected row carries the same moment: one decision, one publication time.
	assert.equal(new Set(answered.map((written) => written.published_at)).size, 1);
});

test('unpublishing the selected rows answers the same rows with no stamp', async () => {
	const answered = await runImport({ publish: ['holiday-a'], published: false });
	assert.deepEqual(answered, [{ id: 'holiday-a', published_at: null }]);
	// Nothing selected is nothing written, rather than a write of the whole table.
	assert.deepEqual(await runImport({ publish: [], published: true }), []);
});

test('the spreadsheet arm still skips a day the jurisdiction already has', async () => {
	const answered = await runImport({ rows: [row('2027-01-01'), row('2027-02-01', 'New day')] }, [
		{ jurisdiction_code: 'MY', date: '2027-01-01' }
	]);
	assert.deepEqual(
		answered.map((written) => [written.jurisdiction_code, written.date, written.name]),
		[['MY', '2027-02-01', 'New day']],
		'the day already held is skipped, never duplicated or overwritten'
	);
	// An imported row arrives unpublished and names where it came from: an import proposes.
	assert.equal(answered[0].source, 'spreadsheet');
	assert.equal(Object.hasOwn(answered[0], 'published_at'), false);
});

test('a document that is neither a spreadsheet nor a publication is refused', async () => {
	await assert.rejects(() => runImport({ publish: ['holiday-a'] }));
	await assert.rejects(() => runImport({ rows: [{ date: '2027-01-01' }] }));
});

/**
 * A holiday payroll has taken is frozen where it is read, not where it is stored.
 *
 * The fixture below is what "payroll has taken this holiday" looks like to the hook today: the
 * `consumed_at` stamp a run writes when it reads the day. The assertion deliberately names the
 * behaviour rather than the column, because the mechanism is being replaced by live references to
 * the holiday — when it is, this fixture is the line that changes and the expectation is not.
 */
const takenByPayroll = {
	id: 'festival',
	jurisdiction_code: 'TEST',
	date: '2027-01-01',
	name: 'Festival',
	original_date: null,
	source: null,
	published_at: '2026-12-01T00:00:00.000Z',
	consumed_at: '2027-01-31T00:00:00.000Z'
};

test('a holiday payroll has taken refuses being unpublished', () => {
	const unpublish = (existing) =>
		holidayHooks.mutate.perRecord.before.handler({
			input: { published_at: null },
			existing,
			api: {}
		} as never);

	assert.throws(() => unpublish(takenByPayroll), /cannot be unpublished/);
	// The same write on a holiday nothing has read is allowed: the refusal is about consumption.
	assert.doesNotThrow(() => unpublish({ ...takenByPayroll, consumed_at: null }));
});
