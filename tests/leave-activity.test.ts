// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultTimeOffFields, leaveActivityOf } from '../src/lib/leave/activity-fields.ts';
import { planLeaveActivity } from '../src/lib/leave/activity.ts';
import { id, leaveContext, submission, timeOff } from './helpers/manual-leave-context.ts';

describe('leave activity fields', () => {
	it('classifies stored activity by the fields each one carries', () => {
		assert.equal(
			leaveActivityOf({
				from_date: '2026-08-31',
				to_date: '2026-08-31',
				days: 1,
				charges: [
					{
						date: '2026-08-31',
						days: 1,
						catalogue_id: id(7),
						employment_term_id: id(4),
						holiday_id: null,
						shift_definition_id: id(8),
						work_day_id: null
					}
				]
			}),
			'TIME_OFF'
		);
		assert.equal(leaveActivityOf({ encash_days: 1, days: 1 }), 'ENCASHMENT');
		assert.equal(leaveActivityOf({ destination_from: '2027-01-01' }), 'CARRY_FORWARD');
		assert.equal(leaveActivityOf({ from_date: '2026-01-01', days: 1 }), 'ADJUSTMENT');
		assert.equal(leaveActivityOf({ as_adjustment_entry: true, reversal_of_id: id(9) }), 'REVERSAL');
	});

	it('classifies a submitted time off by its still-unmeasured days', () => {
		assert.equal(
			leaveActivityOf({ from_date: '2026-09-03', to_date: '2026-09-03', days: null }),
			'TIME_OFF'
		);
	});

	it('opens a new time-off request on one full day without charging it', () => {
		assert.deepEqual(defaultTimeOffFields('2026-09-03'), {
			from_date: '2026-09-03',
			to_date: '2026-09-03',
			half_day_start: false,
			half_day_end: false,
			days: null,
			hours: null,
			encash_days: null,
			as_adjustment_entry: false,
			reversal_of_id: null,
			effective_on: null,
			due_on: null,
			destination_from: null,
			destination_to: null,
			available_from: null,
			expires_on: null,
			reason: null,
			event_kind: null,
			event_relationship: null,
			event_child_index: null,
			event_date: null
		});
	});

	it('refuses a time-off range that is not stated before it reaches the ledger', () => {
		assert.throws(
			() => planLeaveActivity(leaveContext(), submission({ days: null, reason: null }), id(10)),
			/start and end date/
		);
	});

	it('refuses ledger movements that have not stated both carry windows', () => {
		assert.throws(
			() =>
				planLeaveActivity(
					leaveContext(),
					submission({
						from_date: '2026-01-01',
						to_date: '2026-12-31',
						destination_from: '2027-01-01',
						days: 5,
						effective_on: '2027-01-01'
					}),
					id(10)
				),
			/Carry-forward/
		);
	});

	it('refuses a reversal that also carries charges, encashed days or a destination', () => {
		for (const fields of [
			{
				charges: [
					{
						date: '2026-04-01',
						days: 1,
						catalogue_id: id(7),
						employment_term_id: id(4),
						holiday_id: null,
						shift_definition_id: id(8),
						work_day_id: null
					}
				]
			},
			{ encash_days: 1, days: 1 },
			{ destination_from: '2027-01-01', destination_to: '2027-12-31' }
		])
			assert.throws(
				() =>
					planLeaveActivity(
						leaveContext(),
						submission({
							as_adjustment_entry: true,
							reversal_of_id: id(10),
							effective_on: '2026-04-02',
							reason: 'Correction',
							...fields
						}),
						id(11)
					),
				/cannot also carry/
			);
	});
});

it('a generated time-off entry keeps its stated halves', () => {
	const context = leaveContext();
	const planned = planLeaveActivity(
		context,
		submission(timeOff('2026-04-01', '2026-04-02')),
		id(10)
	);
	assert.equal(planned.half_day_start, false);
	assert.equal(planned.half_day_end, false);
	assert.equal(planned.days, 2);
});
