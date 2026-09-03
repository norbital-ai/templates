// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { payrollRunsExportQuery } from '../src/lib/ui/export-download.ts';

test('payroll export posts CollectionQueryRequest, not collection_name/record_ids', () => {
	const query = payrollRunsExportQuery(['run-1', 'run-2']);
	assert.deepEqual(query, {
		collection: 'payroll_runs',
		where: { id: { in: ['run-1', 'run-2'] } },
		limit: 2
	});
	assert.equal('collection_name' in query, false);
	assert.equal('record_ids' in query, false);
});
