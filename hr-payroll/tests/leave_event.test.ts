// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultTimeOffEvent, leaveEventSchema } from '../src/datatypes/leave_event/+definition.js';

const TIME_OFF = {
	kind: 'TIME_OFF',
	range: {
		start: { date: '2026-08-31', half: 'FIRST' },
		end: { date: '2026-08-31', half: 'SECOND' }
	},
	chargeable_days: 1,
	reason: 'Medical leave'
};

function refuses(value: unknown): boolean {
	const result = leaveEventSchema['~standard'].validate(value);
	assert.ok(!(result instanceof Promise), 'leave events must validate synchronously');
	return result.issues !== undefined;
}

describe('leave_event', () => {
	it('accepts time off without an embedded certificate member', () => {
		assert.equal(refuses(TIME_OFF), false);
	});

	it('opens a new time-off request on one full day without charging it yet', () => {
		assert.deepEqual(defaultTimeOffEvent('2026-09-03'), {
			kind: 'TIME_OFF',
			range: {
				start: { date: '2026-09-03', half: 'FIRST' },
				end: { date: '2026-09-03', half: 'SECOND' }
			},
			chargeable_days: null,
			reason: null
		});
		assert.equal(refuses(defaultTimeOffEvent('2026-09-03')), false);
	});

	it('accepts a posted carry-forward with its closing, and refuses a negative movement', () => {
		const carry = {
			kind: 'CARRY_FORWARD',
			leave_year: 2026,
			effective_on: '2026-01-01',
			movement_days: 5,
			expires_on: '2026-04-01',
			forfeited_days: 3,
			closing: {
				entitlement: 8,
				carried_in: 0,
				accrued: 8,
				adjusted: 0,
				taken: 0,
				encashed: 0,
				expired: 0,
				closing: 8
			},
			statutory_profile_id: '22222222-2222-4222-8222-222222222222'
		};
		assert.equal(refuses(carry), false);
		assert.equal(refuses({ ...carry, movement_days: -1 }), true);
		assert.equal(refuses({ ...carry, forfeited_days: -1 }), true);
		assert.equal(refuses({ ...carry, leave_year: undefined }), true);
	});

	it('refuses the legacy nested certificate member instead of dropping it', () => {
		assert.equal(refuses({ ...TIME_OFF, certificate_file: null }), true);
		assert.equal(
			refuses({
				...TIME_OFF,
				certificate_file: {
					storage_key: 'certificates/example.pdf',
					file_name: 'example.pdf',
					file_size: 100,
					mime_type: 'application/pdf'
				}
			}),
			true
		);
	});
});
