import assert from 'node:assert/strict';
import test from 'node:test';
import {
	leaveEntryHooks,
	approve,
	id,
	leaveContext,
	timeOff
} from './helpers/manual-leave-context.ts';

const context = leaveContext();
const original = approve(context, timeOff('2026-04-01'));
const rewrite = (input: Record<string, unknown>) =>
	leaveEntryHooks.mutate.perRecord.before.handler({
		input,
		existing: original,
		recordId: original.id
	} as never);

test('approved Leave activity cannot change its event, evidence, reference or contract', () => {
	for (const change of [
		{ event: timeOff('2026-04-02') },
		{ reference: 'A replacement story' },
		{ charges: [] },
		{ allocations: [] },
		{ employment_id: id(20) }
	])
		assert.throws(() => rewrite({ id: original.id, ...change }), /immutable.*linked reversal/);
});

test('restating stored evidence unchanged is allowed without emitting a new contract seal', () => {
	for (const input of [{ id: original.id }, { id: original.id, row_version: 3 }, { ...original }]) {
		assert.deepEqual(rewrite(input), input);
	}
});

test('approved Leave activity cannot be deleted regardless of category or payroll capture', () => {
	assert.throws(
		() => leaveEntryHooks.delete.perRecord.before.handler(),
		/cannot be deleted.*linked reversal/
	);
});

test('an approved reversal preserves the original immutable record and cannot be reversed again', () => {
	const local = leaveContext();
	const taken = approve(local, timeOff('2026-04-01'));
	const reversed = approve(
		local,
		{
			kind: 'REVERSAL',
			entry_id: taken.id,
			effective_on: '2026-04-02',
			due_on: null,
			days: 99,
			gross_amount: null,
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
					kind: 'REVERSAL',
					entry_id: reversed.id,
					effective_on: '2026-04-03',
					due_on: null,
					days: 1,
					gross_amount: null,
					reason: 'Second reversal'
				},
				12
			),
		/original activity once/
	);
});
