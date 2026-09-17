import assert from 'node:assert/strict';
import test from 'node:test';
import leaveEntries from '../src/collections/leave_entries/+collection.ts';
import { approve, leaveContext, timeOff } from './helpers/manual-leave-context.ts';

test('approved Leave activity is immutable and undeletable by declaration: a correction is a linked reversal', () => {
	assert.equal(leaveEntries.update, undefined, 'no update endpoint: nothing can rewrite an entry');
	assert.equal(
		leaveEntries.delete,
		undefined,
		'no delete endpoint: an entry remains audit evidence'
	);
	assert.ok(leaveEntries.create, 'a reversal is a new entry through the create input');
	assert.equal('payslip_id' in leaveEntries.create.input.columns, false, 'the pin is payroll’s');
	assert.equal('charges' in leaveEntries.create.input.columns, false, 'charges are derived');
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
