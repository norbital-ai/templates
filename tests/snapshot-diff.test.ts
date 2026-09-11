// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The snapshot diff behind Settings → Changes: matched rows keyed by code, one line per leaf that
 * moved, provenance columns never diffed, and a collection with no differences left out.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { diffCollection, diffSettingsRoot, formatLeafPath } from '../src/lib/snapshot_diff.ts';

const row = (overrides) => ({
	settings_id: 'v1',
	id: `id-${overrides.code ?? 'row'}`,
	created_at: '2026-01-01T00:00:00.000Z',
	...overrides
});

test('a changed band yields one line per moved leaf, not a JSON blob', () => {
	const previous = [
		row({
			code: 'LI',
			name: 'Labor insurance',
			rounding: 'NEAREST_CENT',
			bands: [
				{
					selector: { by: 'WAGE', from: 0.01, to: 29500 },
					award: { kind: 'FIXED', employee: 678.5, employer: 2374.75 }
				},
				{
					selector: { by: 'WAGE', from: 29500.01, to: 30300 },
					award: { kind: 'FIXED', employee: 696.9, employer: 2439.15 }
				}
			]
		})
	];
	const proposed = [
		{
			...previous[0],
			settings_id: 'v2',
			id: 'id-2',
			bands: [
				previous[0].bands[0],
				{ ...previous[0].bands[1], award: { kind: 'FIXED', employee: 727.2, employer: 2545.2 } }
			]
		}
	];
	const diff = diffCollection('statutory_contributions', previous, proposed);
	assert.equal(diff.collection, 'statutory_contributions');
	assert.deepEqual(
		diff.rows.map((r) => [r.code, r.state]),
		[['LI', 'CHANGED']]
	);
	assert.deepEqual(
		diff.rows[0].changes.map((c) => [c.path, c.previous, c.proposed]),
		[
			['bands[1].award.employee', 696.9, 727.2],
			['bands[1].award.employer', 2439.15, 2545.2]
		]
	);
});

test('an identical collection, and provenance-only changes, are not a diff', () => {
	const current = [
		row({
			code: 'LI',
			bands: [
				{
					selector: { by: 'WAGE', from: 0, to: null },
					award: { kind: 'PERCENT', employee: 2, employer: 7 }
				}
			]
		})
	];
	const resealed = [
		{ ...current[0], id: 'reissued', settings_id: 'v2', created_at: '2027-01-01T00:00:00.000Z' }
	];
	assert.equal(diffCollection('statutory_contributions', current, resealed), null);
});

test('added and removed rows are named, and a code-less collection matches as one row', () => {
	const previous = [
		row({ code: 'OLD_LEAVE' }),
		row({
			settings_id: 'v1',
			proration: { by: 'WORKING_DAYS' },
			ordinary_rate: [{ divisor: 'WORKING_DAYS' }]
		})
	];
	const proposed = [
		row({ code: 'NEW_LEAVE' }),
		{ ...previous[1], settings_id: 'v2', id: 'w2', proration: { by: 'CALENDAR_DAYS' } }
	];
	const leaves = diffCollection('leave_catalogue', previous.slice(0, 1), proposed.slice(0, 1));
	assert.deepEqual(
		leaves.rows.map((r) => [r.code, r.state]),
		[
			['NEW_LEAVE', 'ADDED'],
			['OLD_LEAVE', 'REMOVED']
		]
	);
	const work = diffCollection('work_catalogue', [previous[1]], [proposed[1]]);
	assert.deepEqual(
		work.rows.map((r) => [r.code, r.state, r.changes.map((c) => c.path)]),
		[['regime', 'CHANGED', ['proration.by']]]
	);
});

test('the root diff reads the payroll scalars and ignores the name', () => {
	const previous = {
		name: 'Malaysia',
		currency: 'MYR',
		tax_year_start_month: 1,
		minimum_wages: { 'DKI Jakarta': 5396761 }
	};
	const proposed = {
		name: 'Malaysia — 2026-01-01',
		currency: 'MYR',
		tax_year_start_month: 1,
		minimum_wages: { 'DKI Jakarta': 5729876 }
	};
	assert.deepEqual(
		diffSettingsRoot(previous, proposed).map((c) => [c.path, c.previous, c.proposed]),
		[['minimum_wages.DKI Jakarta', 5396761, 5729876]]
	);
	assert.deepEqual(diffSettingsRoot(previous, previous), []);
});

test('a leaf path is printed as the trail a reader follows, not as array syntax', () => {
	assert.equal(formatLeafPath('bands[1].award.employer'), 'Band 2 · Award · Employer');
	assert.equal(formatLeafPath('bands[0].selector.to'), 'Band 1 · Selector · To');
	assert.equal(formatLeafPath('minimum_wages[2].monthly_wage'), 'Minimum wage 3 · Monthly wage');
	assert.equal(formatLeafPath('tax_year_start_month'), 'Tax year start month');
	assert.equal(formatLeafPath('rates[10].divisor'), 'Rate 11 · Divisor');
});
