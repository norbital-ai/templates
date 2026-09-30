// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A payroll run's pin of two thousand work days is not two thousand writes through the work day transform: it is
 * `link` actions on the payslip that consumed them, committed in the run's own statement. The source collections
 * do not accept `payslip_id` as input — the pin is the payload's.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { payrollRunPayload } from '../src/lib/payroll/run/graph.ts';
import workDays from '../src/data/collection/work_days/+collection.ts';
import claimRequests from '../src/data/collection/claim_requests/+collection.ts';
import leaveEntries from '../src/data/collection/leave_entries/+collection.ts';
import adhocRequests from '../src/data/collection/adhoc_requests/+collection.ts';

const captures = (overrides = {}) => ({
	payslipId: 'slip-1',
	workDays: [],
	claims: [],
	adhoc: [],
	leave: [],
	loanRepayments: [],
	orderRepayments: [],
	wagePeriods: [],
	...overrides
});

test('every captured source becomes a link action on its payslip; a family it consumed nothing of carries none', () => {
	const [payload] = payrollRunPayload({
		payslip_payroll_run: [{ id: 'slip-1', employment_id: 'emp-1', status: 'DRAFT' }],
		captures: [
			captures({
				workDays: ['day-1', 'day-2'],
				claims: ['claim-1'],
				leave: ['leave-1'],
				loanRepayments: ['repayment-1'],
				wagePeriods: ['wage-period-1']
			})
		]
	});
	assert.deepEqual(payload, {
		employment_id: 'emp-1',
		status: 'DRAFT',
		work_days: { link: ['day-1', 'day-2'] },
		claim_requests: { link: ['claim-1'] },
		leave_entries: { link: ['leave-1'] },
		loan_repayments: { link: ['repayment-1'] },
		payslip_wage_periods: { create: [{ wage_period_id: 'wage-period-1' }] }
	});
});

test('no source family accepts the pin as input', () => {
	for (const collection of [workDays, claimRequests, adhocRequests, leaveEntries])
		for (const op of ['create', 'update'])
			assert.equal(collection.spec[op]?.input.columns.includes('payslip_id') ?? false, false);
});
