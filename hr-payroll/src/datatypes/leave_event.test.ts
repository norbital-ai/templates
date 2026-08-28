// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { leaveEventSchema } from './leave_event/+definition.js';

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
