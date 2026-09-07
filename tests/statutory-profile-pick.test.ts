// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * HR16 and HR24: a run is priced against the one sealed, unvoided version of its company's
 * settings lineage that covers its period. No such version refuses the run with a sentence naming
 * the company and its lineage; a draft never governs; a voided version never governs again; two
 * sealed versions covering one day is the overlap the database exclusion keeps out.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { countryOf, coversDay, settingsInForce } from '../src/lib/jurisdiction_settings.ts';
import { createPublicPayrollWorld, COMPANY_ID } from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';

const prepare = (world, period = '2026-01') =>
	Effect.runPromise(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period })
	);

test('a period no sealed version covers is refused naming the company, its lineage and the period', async () => {
	const world = createPublicPayrollWorld();
	world.jurisdiction_settings[0].effective_range = { start: '2020-01-01', end: '2025-12-31' };
	await assert.rejects(
		prepare(world),
		(error) =>
			/Public Fixture Co operates under jurisdiction settings PF, which has no sealed version covering 2026-01-31/.test(
				error.message
			) &&
			/2026-01 payroll cannot be priced/.test(error.message) &&
			/Seal a PF version/.test(error.message)
	);
});

test('a draft never governs, whatever its range says', async () => {
	const world = createPublicPayrollWorld();
	world.jurisdiction_settings[0].sealed_at = null;
	await assert.rejects(prepare(world), /has no sealed version covering/);
});

test('a voided version never governs again', async () => {
	const world = createPublicPayrollWorld();
	world.jurisdiction_settings[0].voided_at = '2026-01-15T00:00:00.000Z';
	world.jurisdiction_settings[0].void_reason = 'wrong divisor';
	await assert.rejects(prepare(world), /has no sealed version covering/);
});

test('the sealed version covering the period end is the one picked, and the run cites it', async () => {
	const world = createPublicPayrollWorld();
	const prepared = await prepare(world);
	assert.equal(prepared.configuration.jurisdiction.id, world.jurisdiction_settings[0].id);
});

test('the lineage is read half-open: a successor starting the day its predecessor ends is adjacent', () => {
	const rows = [
		{
			id: 'a',
			code: 'SG',
			name: 'SG 2026',
			sealed_at: '2026-01-01T00:00:00.000Z',
			voided_at: null,
			effective_range: { start: '2026-01-01', end: '2026-04-01' },
			approval_id: null
		},
		{
			id: 'b',
			code: 'SG',
			name: 'SG April',
			sealed_at: '2026-04-01T00:00:00.000Z',
			voided_at: null,
			effective_range: { start: '2026-04-01', end: null },
			approval_id: null
		},
		{
			id: 'c',
			code: 'SG',
			name: 'SG draft',
			sealed_at: null,
			voided_at: null,
			effective_range: { start: '2026-01-01', end: null },
			approval_id: null
		}
	];
	assert.equal(settingsInForce(rows, 'SG', '2026-03-31')?.id, 'a');
	assert.equal(
		settingsInForce(rows, 'SG', '2026-04-01')?.id,
		'b',
		'the boundary day is the successor'
	);
	assert.equal(settingsInForce(rows, 'MY', '2026-03-31'), null, 'another code is another lineage');
	assert.equal(coversDay(rows[0].effective_range, '2026-04-01'), false);
	assert.equal(coversDay(rows[0].effective_range, '2026-03-31'), true);
});

test('two sealed versions covering one day cannot be told apart, so the pick refuses by name', () => {
	const rows = [
		{
			id: 'a',
			code: 'SG',
			name: 'SG 2026',
			sealed_at: '2026-01-01T00:00:00.000Z',
			voided_at: null,
			effective_range: { start: '2026-01-01', end: null },
			approval_id: null
		},
		{
			id: 'b',
			code: 'SG',
			name: 'SG April',
			sealed_at: '2026-04-01T00:00:00.000Z',
			voided_at: null,
			effective_range: { start: '2026-04-01', end: null },
			approval_id: null
		}
	];
	assert.throws(
		() => settingsInForce(rows, 'SG', '2026-04-30'),
		/Sealed SG settings versions SG 2026, SG April overlap on 2026-04-30/
	);
	assert.equal(settingsInForce(rows, 'SG', '2026-03-31')?.id, 'a');
	assert.equal(
		settingsInForce(
			[{ ...rows[0], voided_at: '2026-05-01T00:00:00.000Z' }, rows[1]],
			'SG',
			'2026-04-30'
		)?.id,
		'b',
		'a voided version drops out of the pick'
	);
});

test('the country of a lineage is the first segment of its code', () => {
	assert.equal(countryOf('PH'), 'PH');
	assert.equal(countryOf('PH-opsph'), 'PH');
	assert.equal(countryOf('SG-fixture'), 'SG');
});
