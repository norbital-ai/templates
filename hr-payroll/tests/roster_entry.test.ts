/** L-TPL-hr-payroll-051 interval order and payslip freeze. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	refusePinnedRoster,
	refuseWorkedIntervals
} from '../src/lib/payroll_engine/roster_entry.ts';

describe('roster entry', () => {
	it('L-TPL-hr-payroll-051 refuses overlapping or out-of-order intervals and an open interval that is not last', () => {
		assert.equal(
			refuseWorkedIntervals([
				{ start: '2026-01-01T09:00:00.000Z', end: '2026-01-01T12:00:00.000Z' },
				{ start: '2026-01-01T11:00:00.000Z', end: '2026-01-01T13:00:00.000Z' }
			]),
			'Worked intervals must be in time order and cannot overlap.'
		);
		assert.equal(
			refuseWorkedIntervals([
				{ start: '2026-01-01T09:00:00.000Z', end: null },
				{ start: '2026-01-01T13:00:00.000Z', end: '2026-01-01T17:00:00.000Z' }
			]),
			'Only the final worked interval may still be open.'
		);
		assert.equal(
			refuseWorkedIntervals([
				{ start: '2026-01-01T09:00:00.000Z', end: '2026-01-01T12:00:00.000Z' },
				{ start: '2026-01-01T13:00:00.000Z', end: null }
			]),
			null
		);
	});

	it('L-TPL-hr-payroll-051 freezes a day a payslip already consumed', () => {
		assert.equal(refusePinnedRoster({ payslip_id: 'p1' }), 'A settled day cannot be changed.');
		assert.equal(refusePinnedRoster({ payslip_id: null }), null);
	});
});
