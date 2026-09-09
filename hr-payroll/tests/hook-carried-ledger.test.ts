import assert from 'node:assert/strict';
import test from 'node:test';
import {
	leaveEntryHooks,
	id,
	leaveContext,
	submission,
	timeOff
} from './helpers/manual-leave-context.ts';

const before = (input: Record<string, unknown>, context = leaveContext()) =>
	leaveEntryHooks.mutate.perRecord.before.handler({
		input,
		recordId: id(100),
		prepared: { context, inputs: [input] }
	} as never);

test('the entry hook freezes server-measured date charges and ignores caller-supplied quantities', () => {
	const context = leaveContext();
	context.holidays.push({
		id: id(2026),
		jurisdiction_code: 'TEST-JUR',
		date: '2026-04-02',
		name: 'Observed',
		original_date: null,
		published_at: '2025-01-01T00:00:00.000Z'
	});
	const input = {
		...submission(timeOff('2026-04-01', '2026-04-03')),
		charges: [],
		allocations: []
	};
	const first = before(input, context);
	assert.equal(first.event.kind, 'TIME_OFF');
	assert.equal(first.event.kind === 'TIME_OFF' && first.event.chargeable_days, 2);
	assert.deepEqual(
		first.charges.map((row) => [row.date, row.days]),
		[
			['2026-04-01', 1],
			['2026-04-03', 1]
		]
	);
	assert.equal(
		first.allocations.reduce((sum, row) => sum + row.days, 0),
		-2
	);
	assert.deepEqual(
		before(input, context),
		first,
		'planning is deterministic without clock-dependent annual writes'
	);
	assert.deepEqual(context.entries, []);
});

test('every charge names the holiday that excluded its day, or none; the entry writes no side rows', () => {
	const result = before(submission(timeOff('2026-04-01', '2026-04-02')));
	assert.deepEqual(
		result.charges.map((row) => [row.date, row.holiday_id]),
		[
			['2026-04-01', null],
			['2026-04-02', null]
		]
	);
	assert.equal(result.employment_id, id(1));
	assert.equal('entry_leave_entitlement' in result, false);
	assert.equal('employment_contract_input' in result, false);
});

test('entry creation requires complete contract-scoped facts and a supporting reference', () => {
	const input = submission(timeOff('2026-04-01'));
	for (const missing of ['employment_id', 'leave_catalogue_id', 'event', 'reference']) {
		assert.throws(
			() => before({ ...input, [missing]: undefined }),
			/employment, leave type, event and unique reference/
		);
	}
	assert.throws(() => before({ ...input, reference: ' ' }), /unique reference/);
});

test('the entry hook requires the certificate identified by the shared Leave planner', () => {
	const context = leaveContext();
	context.catalogues[0]!.requires_certificate_after_days = 0;
	const input = submission(timeOff('2026-04-01'));
	assert.throws(() => before(input, context), /certificate is required/);
	assert.equal(before({ ...input, certificate_file: id(200) }, context).certificate_file, id(200));
});
