/** L-TPL-hr-payroll-034 last-day close; L-TPL-hr-payroll-076 exit_facts shape the encash tap reads. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	closeContractWrites,
	lastDayRefusal,
	refuseClosedUpdate
} from '../src/lib/payroll_engine/offboarding.ts';

describe('offboarding', () => {
	it('L-TPL-hr-payroll-034 refuses a last day before hire and admits the hire day', () => {
		assert.notEqual(lastDayRefusal('2020-01-15', '2020-01-14'), null);
		assert.equal(lastDayRefusal('2020-01-15', '2020-01-15'), null);
		assert.equal(
			lastDayRefusal('2020-01-15', null),
			'Choose a last day of work on or after the hire date (2020-01-15).'
		);
	});

	it('L-TPL-hr-payroll-034 closes the range once and writes exit_facts the encash rule matches', () => {
		const set = closeContractWrites({
			from: '2019-01-01',
			lastDay: '2026-03-31',
			ground: 'RESIGNATION',
			note: 'notice served'
		});
		assert.deepEqual(set.effective_range, { from: '2019-01-01', to: '2026-03-31' });
		assert.equal(set.exit_ground, 'RESIGNATION');
		assert.deepEqual(set.exit_facts, {
			ground: 'RESIGNATION',
			last_day: '2026-03-31',
			note: 'notice served'
		});
		assert.equal(
			refuseClosedUpdate(
				{ effective_range: set.effective_range },
				{ effective_range: { from: '2019-01-01', to: null } }
			),
			'This contract has ended; departure closes its range once.'
		);
		assert.equal(
			refuseClosedUpdate(
				{ effective_range: { from: '2019-01-01', to: null } },
				{ effective_range: { from: '2019-01-01', to: '2026-03-31' } }
			),
			null
		);
	});
});
