// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A payroll run's pin of two thousand work days is not two thousand writes through the work day
 * transform: it is `link` actions on the payslip that consumed them, committed in the run's own
 * transaction. The source collections do not even accept `payslip_id` as input — the pin is the
 * payload's, so no caller and no transform of the source family ever sees it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { payrollRunPayload } from '../src/collections/payroll_runs/lib/graph.ts';
import workDays from '../src/collections/work_days/+collection.ts';
import claimRequests from '../src/collections/claim_requests/+collection.ts';
import allowanceEntries from '../src/collections/allowance_entries/+collection.ts';
import leaveEntries from '../src/collections/leave_entries/+collection.ts';
import adhocRequests from '../src/collections/adhoc_requests/+collection.ts';

test('every captured source becomes a link action on its payslip; allowance entries are created under it', () => {
	const slip = { id: 'slip-1', employment_id: 'emp-1', status: 'DRAFT' };
	const [payload] = payrollRunPayload({
		payslip_payroll_run: [slip],
		captures: [
			{
				payslipId: 'slip-1',
				workDays: ['day-1', 'day-2'],
				claims: ['claim-1'],
				adhoc: ['adhoc-1'],
				leave: ['leave-1'],
				loanRepayments: ['repayment-1'],
				materialised: [
					{
						id: 'm-1',
						sourceId: 'standing-1',
						collection: 'allowance_entries',
						payslipId: 'slip-1',
						values: { derived_from_id: 'standing-1', employment_id: 'emp-1', amount: 10 }
					}
				]
			}
		]
	});
	assert.equal(payload.id, 'slip-1');
	assert.deepEqual(payload.work_day_payslip, { link: [{ id: 'day-1' }, { id: 'day-2' }] });
	assert.deepEqual(payload.claim_request_payslip, { link: [{ id: 'claim-1' }] });
	assert.deepEqual(payload.adhoc_request_payslip, { link: [{ id: 'adhoc-1' }] });
	assert.deepEqual(payload.leave_entry_payslip, { link: [{ id: 'leave-1' }] });
	assert.deepEqual(payload.loan_repayment_payslip, { link: [{ id: 'repayment-1' }] });
	// The entry is born under the slip with no pin of its own to state.
	assert.deepEqual(payload.allowance_entry_payslip, {
		create: [{ id: 'm-1', derived_from_id: 'standing-1', employment_id: 'emp-1', amount: 10 }]
	});
});

test('a payslip that consumed nothing of a family carries no action for it', () => {
	const [payload] = payrollRunPayload({
		payslip_payroll_run: [{ id: 'slip-2' }],
		captures: [
			{
				payslipId: 'slip-2',
				workDays: [],
				claims: [],
				adhoc: [],
				leave: [],
				loanRepayments: [],
				materialised: []
			}
		]
	});
	assert.deepEqual(payload.work_day_payslip, {});
	assert.equal('allowance_entry_payslip' in payload, false);
});

test('no source family accepts the pin as input', () => {
	for (const collection of [
		workDays,
		claimRequests,
		adhocRequests,
		allowanceEntries,
		leaveEntries
	]) {
		assert.equal('payslip_id' in collection.create.input.columns, false);
		if (collection.update) assert.equal('payslip_id' in collection.update.input.columns, false);
	}
});
