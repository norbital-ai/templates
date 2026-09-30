// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readAll } from '../src/lib/reads.ts';

// F19 (probe FINDINGS #11): MY's second run read the first run's 84 payslips (1.6 MB of
// JSON) and its calculation trace in whole-row, unpaged crossings, past the 4 MiB answer wall at
// reads.ts. A whole-row read of a run-history collection now pages; a narrowed read does not.
const fake = (total) => {
	const calls = [];
	const rows = Array.from({ length: total }, (_, index) => ({ id: `r${index}` }));
	return {
		calls,
		read(collection, q) {
			calls.push({ collection, limit: q.limit, all: q.all, after: q.after });
			if (q.all) return Promise.resolve({ rows });
			const start = q.after ?? 0;
			const end = start + q.limit;
			return Promise.resolve({
				rows: rows.slice(start, end),
				...(end < total ? { next: end } : {})
			});
		}
	};
};

test('a whole-row payslip read of 84 slips takes two crossings of at most 50', async () => {
	const reads = fake(84);
	const rows = await readAll(reads, 'payslips', { employment_id: { in: ['e'] } });
	assert.equal(rows.length, 84);
	assert.deepEqual(rows.at(-1), { id: 'r83' });
	assert.deepEqual(
		reads.calls.map((call) => [call.limit, call.after]),
		[
			[50, undefined],
			[50, 50]
		]
	);
});

test('a whole-row run read takes one run per crossing', async () => {
	const reads = fake(3);
	const rows = await readAll(reads, 'payroll_runs', { company_id: { eq: 'c' } });
	assert.equal(rows.length, 3);
	assert.deepEqual(
		reads.calls.map((call) => call.limit),
		[1, 1, 1]
	);
});

test('a narrowed read and a collection outside the list stay one explicit `all` read', async () => {
	const narrowed = fake(84);
	await readAll(narrowed, 'payslips', { employment_id: { in: ['e'] } }, undefined, { id: true });
	assert.deepEqual(narrowed.calls, [
		{ collection: 'payslips', limit: undefined, all: true, after: undefined }
	]);
	const other = fake(5);
	await readAll(other, 'employees', { id: { in: ['a'] } });
	assert.equal(other.calls.length, 1);
	assert.equal(other.calls[0].all, true);
});

test('an explicit page still wins', async () => {
	const reads = fake(10);
	await readAll(reads, 'payslips', { employment_id: { in: ['e'] } }, 4);
	assert.deepEqual(
		reads.calls.map((call) => call.limit),
		[4, 4, 4]
	);
});
