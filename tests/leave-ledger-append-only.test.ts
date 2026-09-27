import assert from 'node:assert/strict';
import test from 'node:test';
import leaveEntries from '../src/data/collection/leave_entries/+collection.ts';
import { approve, leaveContext, timeOff } from './helpers/manual-leave-context.ts';

test('approved Leave activity is immutable and undeletable by declaration: a correction is a linked reversal', () => {
	const { spec } = leaveEntries;
	assert.equal(spec.update, undefined, 'no update: nothing can rewrite an entry');
	assert.equal(spec.delete, undefined, 'no delete: an entry remains audit evidence');
	assert.ok(spec.create, 'a reversal is a new entry through the create input');
	for (const derived of [
		'payslip_id',
		'charges',
		'allocations',
		'activity',
		'leave_code',
		'summary'
	])
		assert.equal(spec.create.input.columns.includes(derived), false, `${derived} is not an input`);
});

test('an approved reversal preserves the original immutable record and cannot be reversed again', () => {
	const local = leaveContext();
	const taken = approve(local, timeOff('2026-04-01'));
	const reversed = approve(
		local,
		{
			as_adjustment_entry: true,
			reversal_of_id: taken.id,
			effective_on: '2026-04-02',
			due_on: null,
			days: null,
			reason: 'Cancelled leave'
		},
		11
	);
	assert.equal(local.entries[0], taken);
	assert.equal(reversed.allocations[0]?.days, 1);
	assert.throws(
		() =>
			approve(
				local,
				{
					as_adjustment_entry: true,
					reversal_of_id: reversed.id,
					effective_on: '2026-04-03',
					due_on: null,
					days: null,
					reason: 'Second reversal'
				},
				12
			),
		/original activity once/
	);
});
