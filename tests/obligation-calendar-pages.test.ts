// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import calendar from '../src/automation/+obligation_calendar.automation.ts';
import { memoryDb, memoryCtx } from './helpers/ctx.ts';

test('obligation sweep pages wide settings and retains duties under every historical version', async () => {
	const version = (id, from, to, duty) => ({
		id,
		code: 'TEST',
		sealed_at: '2025-01-01',
		voided_at: null,
		approval_id: null,
		effective_range: { from, to },
		payroll: { currency: 'USD' },
		work_rules: { padding: 'x'.repeat(2_200_000) },
		duty_types: [
			{
				code: duty,
				authority: 'Synthetic legal duty',
				subject: 'COMPANY',
				trigger: { on: 'CALENDAR', every: 'QUARTER' },
				due: 'period.end'
			}
		]
	});
	const tables = {
		companies: [
			{
				id: 'co',
				name: 'Fixture',
				settings_code: 'TEST',
				pay_frequency: 'MONTHLY',
				facts: {},
				effective_range: { from: '2025-12-01', to: null },
				approval_id: null
			}
		],
		jurisdiction_settings: [
			version('old', '2025-12-01', '2025-12-31', 'OLD'),
			version('new', '2026-01-01', null, 'NEW')
		]
	};
	tables.employees = [{ id: 'synthetic', name: 'x'.repeat(2_000_000), approval_id: null }];
	tables.reference_rows = Array.from({ length: 3000 }, (_, index) => ({
		id: `ref-${index}`,
		settings_id: index < 1500 ? 'old' : 'new',
		table: 'PLACE',
		code: `${index}-${'x'.repeat(750)}`,
		parent_code: null,
		effective_range: { from: '2025-01-01', to: null },
		approval_id: null
	}));
	let crossingBytes = 0,
		clearing = false;
	const referenceIds = [];
	const db = memoryDb(tables),
		reads = [],
		written = [];
	const ctx = {
		...memoryCtx(tables, { now: '2026-02-01T00:00:00Z' }),
		read: async (collection, query) => {
			const result = await db.read(collection, query);
			crossingBytes += Buffer.byteLength(JSON.stringify(result));
			if (!clearing) {
				clearing = true;
				queueMicrotask(() => {
					crossingBytes = 0;
					clearing = false;
				});
			}
			assert.ok(
				crossingBytes <= 4 * 1024 * 1024,
				`aggregate crossing ${crossingBytes} exceeds 4 MiB`
			);
			if (collection === 'reference_rows') referenceIds.push(...result.rows.map((row) => row.id));
			if (collection === 'jurisdiction_settings') {
				const bytes = Buffer.byteLength(JSON.stringify(result));
				assert.ok(bytes <= 4 * 1024 * 1024, `settings crossing ${bytes} exceeds 4 MiB`);
				reads.push({ ids: result.rows.map((row) => row.id), after: query.after });
			}
			return result;
		},
		progress: async () => {},
		act: async (callable, input) => {
			written.push(...input);
			return { kind: 'committed', records: [] };
		}
	};
	const result = await calendar.body({}, ctx);
	assert.deepEqual(
		reads.flatMap((read) => read.ids),
		['old', 'new']
	);
	assert.equal(reads.length, 2);
	assert.ok(reads[1].after != null);
	assert.deepEqual(new Set(written.map((row) => row.duty_code)), new Set(['OLD', 'NEW']));
	assert.deepEqual(result.failures, []);
	assert.deepEqual(
		referenceIds,
		tables.reference_rows.map((row) => row.id)
	);
});
