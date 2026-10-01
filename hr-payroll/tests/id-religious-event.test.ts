import assert from 'node:assert/strict';
import test from 'node:test';
import { createStatutoryWorld, leaveCatalogue } from './fixtures/statutory-world.ts';
import { refusalMessage } from './fixtures/memory-payroll-api.ts';
import { memoryDb } from './helpers/ctx.ts';
import { readLeaveContext, type LeaveContext } from '../src/lib/leave/context.ts';
import { planLeaveActivity } from '../src/lib/leave/activity.ts';

// UU 13/2003 art.93(2)(e); PP 36/2021 art.40(3): one religious duty during employment
// with the same employer. Separate approved blocks of that duty are not further events.
// https://jdih.kemnaker.go.id/asset/data_puu/PP362021.pdf
const id = (n: number) => `a3800000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function context() {
	const world = createStatutoryWorld({
		code: 'ID',
		period: '2026-02',
		region: 'Provinsi DKI Jakarta',
		people: [{ key: 'DUTY', wage: 10_000_000, hire_date: '2025-12-01' }]
	});
	world.leave_catalogue.push(...leaveCatalogue('ID').map((row) => ({ ...row, approval_id: null })));
	return readLeaveContext(
		memoryDb(world) as never,
		[String(world.employments[0]!.id)],
		{ start: '2026-02-01', end: '2026-02-28' },
		true
	);
}

function block(ctx: LeaveContext, n: number, day: string, eventDate = '2026-02-02') {
	const version = ctx.versions.find(
		(row) => String(row.effective_range?.start).slice(0, 10) === '2026-01-01'
	)!;
	const catalogue = ctx.catalogues.find(
		(row) => row.settings_id === version.id && row.code === 'RELIGIOUS_DUTY_LEAVE'
	)!;
	return planLeaveActivity(
		ctx,
		{
			employment_id: ctx.employments[0]!.id,
			catalogue_id: catalogue.id,
			reference: `DUTY-${n}`,
			from_date: day,
			to_date: day,
			facts: { event_kind: 'RELIGIOUS_DUTY', event_date: eventDate }
		},
		id(n)
	);
}

test('ID religious duty: approved split blocks consume one dated event', async () => {
	const ctx = await context();
	const first = block(ctx, 1, '2026-02-02');
	ctx.entries.push({ ...first, id: id(1), approval_id: null });
	const second = block(ctx, 2, '2026-02-03');
	ctx.entries.push({ ...second, id: id(2), approval_id: null });
	assert.equal(second.days, 1);
	assert.deepEqual(
		second.charges.map((row) => row.date),
		['2026-02-03']
	);
	assert.equal(block(ctx, 3, '2026-02-04').days, 1);
	let message = '';
	try {
		block(ctx, 4, '2026-02-05', '2026-02-05');
	} catch (error) {
		message = refusalMessage(error);
	}
	assert.match(message, /1 events with this employer; this would be event 2/);
	assert.equal(ctx.entries.length, 2);
});

test('ID religious duty: reversing the sole block releases the once-only event', async () => {
	const ctx = await context();
	const first = block(ctx, 1, '2026-02-02');
	ctx.entries.push({ ...first, id: id(1), approval_id: null });
	const reversed = planLeaveActivity(
		ctx,
		{
			employment_id: ctx.employments[0]!.id,
			catalogue_id: first.catalogue_id,
			reference: 'DUTY-REV',
			from_date: null,
			to_date: null,
			as_adjustment_entry: true,
			reversal_of_id: id(1),
			effective_on: '2026-02-03',
			reason: 'Duty cancelled',
			facts: {}
		},
		id(2)
	);
	ctx.entries.push({ ...reversed, id: id(2), approval_id: null });
	assert.equal(reversed.days, 1);
	assert.equal(block(ctx, 3, '2026-02-05', '2026-02-05').days, 1);
});

test('ID religious duty: another employer does not consume this employer event', async () => {
	const ctx = await context();
	const prior = block(ctx, 1, '2026-02-02');
	ctx.priorEntries = [
		{
			...prior,
			id: id(1),
			employment_id: id(99),
			company_id: id(98),
			employee_id: ctx.employments[0]!.employee_id,
			approval_id: null
		}
	];
	const current = block(ctx, 2, '2026-02-05', '2026-02-05');
	assert.equal(current.days, 1);
	assert.deepEqual(
		current.charges.map((row) => row.date),
		['2026-02-05']
	);
});

test('ID religious duty: a rehire with the same employer cannot take a second duty', async () => {
	const ctx = await context();
	const prior = block(ctx, 1, '2026-02-02');
	ctx.priorEntries = [
		{
			...prior,
			id: id(1),
			employment_id: id(99),
			company_id: ctx.employments[0]!.company_id,
			employee_id: ctx.employments[0]!.employee_id,
			approval_id: null
		}
	];
	let message = '';
	try {
		block(ctx, 2, '2026-02-05', '2026-02-05');
	} catch (error) {
		message = refusalMessage(error);
	}
	assert.match(message, /1 events with this employer; this would be event 2/);
	assert.equal(ctx.entries.length, 0);
});

test('ID religious duty: a dated duty split across same-employer contracts stays one event', async () => {
	const ctx = await context();
	const prior = block(ctx, 1, '2026-02-02');
	ctx.priorEntries = [
		{
			...prior,
			id: id(1),
			employment_id: id(99),
			company_id: ctx.employments[0]!.company_id,
			employee_id: ctx.employments[0]!.employee_id,
			approval_id: null
		}
	];
	const continuation = block(ctx, 2, '2026-02-03');
	assert.equal(continuation.days, 1);
	assert.deepEqual(
		continuation.charges.map((row) => row.date),
		['2026-02-03']
	);
});
