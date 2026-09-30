/**
 * A run's world is read inside one invocation's 40-crossing budget and 4 MiB-per-answer wall.
 * PH-HR14-1 (a December run after eleven) read each earlier run in its own crossing; JP's cloned
 * reference tables (9,356 rows) answered in one crossing over 4 MiB.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createStatutoryWorld, COMPANY_ID } from './fixtures/statutory-world.ts';
import { readPayrollWorlds } from '../src/lib/payroll/world.ts';
import { memoryDb } from './helpers/ctx.ts';

const counting = (tables: object) => {
	const db = memoryDb(tables);
	const reads: string[] = [];
	return {
		reads,
		db: {
			...db,
			read: (collection: string, q: object) => {
				reads.push(collection);
				return db.read(collection, q);
			}
		}
	};
};

test('earlier runs of a small company are one crossing, and every reference row is read in pages', async () => {
	const world = createStatutoryWorld({
		code: 'TW',
		period: '2026-12',
		riskClass: '1',
		people: [{ key: 'TW-CROSS', wage: 50_000 }]
	});
	world.payroll_runs = Array.from({ length: 11 }, (_, index) => ({
		id: `d9500000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
		company_id: COMPANY_ID,
		period: `2026-${String(index + 1).padStart(2, '0')}`,
		kind: 'REGULAR',
		sequence: 1,
		attendance_to: `2026-${String(index + 1).padStart(2, '0')}-28`
	})) as never;
	const settingsId = (world.jurisdiction_settings as readonly { readonly id: string }[])[0]!.id;
	world.reference_rows = Array.from({ length: 5001 }, (_, index) => ({
		id: `d9600000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
		settings_id: settingsId,
		table: 'T',
		code: `C${index}`,
		effective_range: { from: '2026-01-01', to: null },
		values: {},
		approval_id: null
	})) as never;
	const { db, reads } = counting(world);
	const worlds = await readPayrollWorlds(db as never, [
		{ company_id: COMPANY_ID, period: '2026-12' }
	]);
	const loaded = worlds.get(`${COMPANY_ID}:2026-12`)!;
	assert.equal(loaded.payroll_runs.length, 11);
	assert.equal(reads.filter((collection) => collection === 'payroll_runs').length, 1);
	assert.equal(loaded.reference_rows?.length, 5001);
	assert.equal(reads.filter((collection) => collection === 'reference_rows').length, 2);
	assert.ok(reads.length <= 40, `${reads.length} crossings`);
});
