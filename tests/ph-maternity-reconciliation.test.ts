// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { daysBetween } from '../src/lib/payroll/run/dates.ts';
import { reconcileBenefitCase } from '../src/lib/benefit-cases/reconciliation.ts';
import {
	benefitCashConflictsWithPayroll,
	benefitLeaveUnsafe
} from '../src/lib/benefit-cases/payroll-guard.ts';
import { MATERNITY, SOLO_PARENT_ID, soloParentFile } from './fixtures/benefit-cases.ts';

/** Through the seeded PH maternity case type: a case's facts, and its solo-parent file where present. */
const reconcilePhMaternity = ({ maternity_case, ...rest }) =>
	reconcileBenefitCase({
		case_type: MATERNITY,
		benefit_case: maternity_case,
		evidence: maternity_case.file === false ? [] : [soloParentFile(maternity_case.id)],
		...rest
	});
const phMaternityLeaveUnsafe = ({ cases, ...rest }) =>
	benefitLeaveUnsafe({
		case_types: [MATERNITY],
		cases,
		evidence: cases.flatMap((row) => (row.file === false ? [] : [soloParentFile(row.id)])),
		...rest
	});
const maternityCashConflictsWithPayroll = (input) =>
	benefitCashConflictsWithPayroll({ case_types: [MATERNITY], ...input });
/** A case with its facts updated, as `{ ...row, ...change }` spreads a column. */
const withFacts = (row, change) => ({ ...row, facts: { ...row.facts, ...change } });

const maternityCase = {
	id: 'case',
	employment_id: 'employment',
	case_type: 'MATERNITY_LEAVE',
	application_on: '2026-09-01',
	event_kind: 'BIRTH',
	event_on: '2026-10-05',
	facts: { solo_parent_claimed: false },
	leave_from: '2026-10-05',
	leave_through: '2027-01-17',
	award_amount: '70000.00'
};
const periods = [
	['2026-10-05', '2026-10-31'],
	['2026-11-01', '2026-11-30'],
	['2026-12-01', '2026-12-31'],
	['2027-01-01', '2027-01-17']
];
const entries = periods.map(([from, through], index) => ({
	id: `leave-${index}`,
	employment_id: 'employment',
	leave_code: 'MATERNITY_LEAVE',
	approval_id: null,
	event_kind: 'BIRTH',
	event_date: '2026-10-05',
	charges: daysBetween(from, through).map((date) => ({ date, days: 1 })),
	payslip_id: `slip-${index}`
}));
const payslips = periods.map((_, index) => ({
	id: `slip-${index}`,
	employment_id: 'employment',
	paid_at: `2027-01-25T00:00:00.000Z`
}));
const movements = [
	{ kind: 'SSS_ADVANCE', paid_on: '2026-09-30', amount: '70000.00' },
	{ kind: 'SALARY_DIFFERENTIAL', paid_on: '2026-10-01', amount: '30000.00' },
	{ kind: 'SSS_REIMBURSEMENT', paid_on: '2026-12-01', amount: '70000.00' }
];

test('PH case matches 105 continuous approved calendar days across four paid payroll cutoffs', () => {
	const result = reconcilePhMaternity({
		maternity_case: maternityCase,
		entries,
		payslips,
		movements,
		as_of: '2027-01-31'
	});
	assert.equal(result.leave.status, 'COMPLETE_APPROVED_SPAN');
	assert.equal(result.leave.expected_days, 105);
	assert.equal(result.leave.claims.solo_parent_documented, 'NOT_CLAIMED');
	assert.equal(result.leave.missing_dates.length, 0);
	assert.equal(result.payroll.status, 'CASH_AND_PAID_PAYROLL_UNRECONCILED');
	assert.equal(result.award.advance_due_on, '2026-10-01');
	assert.equal(result.award.advance_status, 'PROVEN_BY_DUE_DATE');
	assert.equal(result.award.reimbursement_received_by_employer, 70000);
	assert.equal(result.differential.paid_to_employee, 30000);
	assert.equal(result.differential.status, 'UNASSESSED_FULL_WAGE_AND_13TH_MONTH_BASIS');
});

test('PH solo-parent birth needs event-valid LGU document evidence for a complete 120-day span', () => {
	const soloCase = { ...maternityCase, leave_through: '2027-02-01', facts: SOLO_PARENT_ID };
	const soloEntries = [
		{
			...entries[0],
			charges: daysBetween('2026-10-05', '2027-02-01').map((date) => ({ date, days: 1 }))
		}
	];
	const reconcile = (maternity_case) =>
		reconcilePhMaternity({
			maternity_case,
			entries: soloEntries,
			payslips,
			movements: [],
			as_of: '2027-02-28'
		});
	assert.equal(reconcile(soloCase).leave.status, 'COMPLETE_APPROVED_SPAN');
	assert.equal(reconcile(soloCase).leave.expected_days, 120);
	assert.equal(reconcile(soloCase).leave.claims.solo_parent_documented, 'DOCUMENTED_FOR_EVENT');
	for (const changed of [
		{ ...soloCase, file: false },
		withFacts(soloCase, { solo_parent_social_worker_signature_seen: false }),
		withFacts(soloCase, { solo_parent_document_valid_through: '2026-10-04' }),
		withFacts(soloCase, { solo_parent_document_issued_on: '2026-10-06' })
	]) {
		const result = reconcile(changed);
		assert.equal(result.leave.status, 'INCOMPLETE_OR_UNPROVEN');
		assert.equal(result.leave.claims.solo_parent_documented, 'DOCUMENT_MISSING_OR_OUTSIDE_EVENT');
	}
	const firstTime = withFacts(soloCase, {
		solo_parent_document_kind: 'ELIGIBILITY_CERTIFICATE',
		solo_parent_document_issued_on: '2026-11-01',
		solo_parent_document_valid_from: '2026-11-01',
		solo_parent_document_valid_through: '2027-10-31',
		solo_parent_certificate_details_checked: true,
		solo_parent_first_time: true
	});
	assert.equal(reconcile(firstTime).leave.status, 'COMPLETE_APPROVED_SPAN');
	assert.equal(
		reconcile(withFacts(firstTime, { solo_parent_document_issued_on: '2027-04-06' })).leave.status,
		'INCOMPLETE_OR_UNPROVEN'
	);
	const undeclared = { ...soloCase, facts: { ...SOLO_PARENT_ID } };
	delete undeclared.facts.solo_parent_claimed;
	assert.equal(reconcile(undeclared).leave.claims.solo_parent_documented, 'UNDECLARED');
});

test('PH payroll rechecks day 106 against the current birth case before settling an old approval', () => {
	const approved = [
		...entries,
		{
			...entries[0],
			id: 'extension',
			charges: daysBetween('2027-01-18', '2027-02-01').map((date) => ({ date, days: 1 }))
		}
	];
	const paying = [
		{ employment_id: 'employment', salary: { start: '2027-01-01', end: '2027-01-31' } }
	];
	const check = (cases, salary = paying) =>
		phMaternityLeaveUnsafe({ entries: approved, cases, paying: salary });
	assert.equal(check([]), true);
	assert.equal(check([withFacts(maternityCase, { solo_parent_claimed: true })]), true);
	const evidenced = { ...maternityCase, facts: SOLO_PARENT_ID };
	assert.equal(check([evidenced]), false);
	assert.equal(check([{ ...evidenced, file: false }]), true);
	assert.equal(
		phMaternityLeaveUnsafe({
			entries: [
				...approved,
				{ ...entries[0], id: 'day-121', charges: [{ date: '2027-02-02', days: 1 }] }
			],
			cases: [evidenced],
			paying: [{ employment_id: 'employment', salary: { start: '2027-02-01', end: '2027-02-28' } }]
		}),
		true
	);
	assert.equal(
		check(
			[],
			[{ employment_id: 'employment', salary: { start: '2026-12-01', end: '2026-12-31' } }]
		),
		false
	);
});

test('PH payroll refuses duplicate, fractional and gapped birth-day charges', () => {
	const paying = [
		{ employment_id: 'employment', salary: { start: '2026-10-01', end: '2026-10-31' } }
	];
	const unsafe = (birthEntries) =>
		phMaternityLeaveUnsafe({ entries: birthEntries, cases: [], paying });
	assert.equal(unsafe(entries), false);
	assert.equal(
		unsafe([
			...entries,
			{ ...entries[0], id: 'duplicate', charges: [{ date: '2026-10-05', days: 1 }] }
		]),
		true
	);
	assert.equal(unsafe([{ ...entries[0], charges: [{ date: '2026-10-05', days: 0.5 }] }]), true);
	assert.equal(
		unsafe([
			{
				...entries[0],
				charges: [
					{ date: '2026-10-05', days: 1 },
					{ date: '2026-10-07', days: 1 }
				]
			}
		]),
		true
	);
});

test('PH payroll holds miscarriage and emergency-termination leave to 60 consecutive days from the event', () => {
	for (const event_kind of ['MISCARRIAGE', 'EMERGENCY_TERMINATION']) {
		const paying = [
			{ employment_id: 'employment', salary: { start: '2026-12-01', end: '2026-12-31' } }
		];
		const entry = {
			...entries[0],
			event_kind,
			charges: daysBetween('2026-10-05', '2026-12-03').map((date) => ({ date, days: 1 }))
		};
		const unsafe = (changed) => phMaternityLeaveUnsafe({ entries: [changed], cases: [], paying });
		assert.equal(unsafe(entry), false);
		assert.equal(
			unsafe({ ...entry, charges: [...entry.charges, { date: '2026-12-04', days: 1 }] }),
			true
		);
		assert.equal(
			unsafe({
				...entry,
				charges: daysBetween('2026-10-06', '2026-12-04').map((date) => ({ date, days: 1 }))
			}),
			true
		);
		assert.equal(unsafe({ ...entry, event_kind: null }), true);
	}
});

test('PH case flags cash recorded after a paid maternity payslip without an allocated offset', () => {
	const before = reconcilePhMaternity({
		maternity_case: maternityCase,
		entries,
		payslips,
		movements: [],
		as_of: '2027-01-31'
	});
	assert.equal(before.payroll.status, 'CAPTURED_AND_PAID_WAGE_UNASSESSED');
	const after = reconcilePhMaternity({
		maternity_case: maternityCase,
		entries,
		payslips,
		movements: [{ kind: 'SSS_ADVANCE', paid_on: '2027-01-30', amount: '1000.00' }],
		as_of: '2027-01-31'
	});
	assert.equal(after.payroll.status, 'CASH_AND_PAID_PAYROLL_UNRECONCILED');
	assert.equal(
		reconcilePhMaternity({
			maternity_case: maternityCase,
			entries,
			payslips,
			movements: [{ kind: 'SSS_REIMBURSEMENT', paid_on: '2027-01-30', amount: '1000.00' }],
			as_of: '2027-01-31'
		}).payroll.status,
		'CAPTURED_AND_PAID_WAGE_UNASSESSED'
	);
});

test('PH case refuses to pronounce a short, reversed or unsettled span complete', () => {
	for (const variant of [
		{ maternity_case: { ...maternityCase, leave_through: '2026-10-05' } },
		{
			entries: [
				...entries,
				{ id: 'reversal', approval_id: null, as_adjustment_entry: true, reversal_of_id: 'leave-0' }
			]
		},
		{ entries: entries.slice(1) }
	]) {
		const result = reconcilePhMaternity({
			maternity_case: maternityCase,
			entries,
			payslips,
			movements: [],
			as_of: '2027-01-31',
			...variant
		});
		assert.equal(result.leave.status, 'INCOMPLETE_OR_UNPROVEN');
		assert.equal(result.payroll.status, 'UNSETTLED_OR_UNPROVEN');
	}
});

test('PH cash proof keeps employer reimbursement outside employee payments and distinguishes lateness', () => {
	const result = reconcilePhMaternity({
		maternity_case: maternityCase,
		entries,
		payslips,
		movements: [
			{ kind: 'SSS_ADVANCE', paid_on: '2026-10-05', amount: '70000.00' },
			{ kind: 'SSS_REIMBURSEMENT', paid_on: '2026-12-01', amount: '71000.00' }
		],
		as_of: '2027-01-31'
	});
	assert.equal(result.award.advance_status, 'NOT_PROVEN_BY_DUE_DATE');
	assert.equal(result.award.reimbursement_status, 'EXCEEDS_RECORDED_ADVANCE_OR_AWARD');
	assert.equal(result.differential.paid_to_employee, 0);
});

test('PH miscarriage needs 60 days starting on the event; unproved solo-parent and prenatal-heavy spans stay unassessed', () => {
	const miscarriage = {
		...maternityCase,
		event_kind: 'MISCARRIAGE',
		facts: {},
		leave_through: '2026-12-03'
	};
	const miscarriageEntry = {
		...entries[0],
		event_kind: 'MISCARRIAGE',
		charges: daysBetween('2026-10-05', '2026-12-03').map((date) => ({ date, days: 1 }))
	};
	assert.equal(
		reconcilePhMaternity({
			maternity_case: miscarriage,
			entries: [miscarriageEntry],
			payslips,
			movements: [],
			as_of: '2026-12-31'
		}).leave.status,
		'COMPLETE_APPROVED_SPAN'
	);
	for (const variant of [
		{ ...withFacts(maternityCase, { solo_parent_claimed: true }), leave_through: '2027-02-01' },
		{ ...maternityCase, leave_from: '2026-06-23', leave_through: '2026-10-05' }
	]) {
		const revisedEntries = [
			{
				...entries[0],
				charges: daysBetween(variant.leave_from, variant.leave_through).map((date) => ({
					date,
					days: 1
				}))
			}
		];
		assert.equal(
			reconcilePhMaternity({
				maternity_case: variant,
				entries: revisedEntries,
				payslips,
				movements: [],
				as_of: '2027-02-28'
			}).leave.status,
			'INCOMPLETE_OR_UNPROVEN'
		);
	}
});

test('PH payroll refuses a second full BASIC payout after recorded maternity cash', () => {
	const probe = {
		entries: [],
		cases: [
			{
				id: 'case',
				employment_id: 'employment',
				case_type: 'MATERNITY_LEAVE',
				event_kind: 'BIRTH',
				event_on: '2026-10-05',
				leave_from: '2026-10-05',
				leave_through: '2027-01-17'
			}
		],
		movements: [{ benefit_case_id: 'case', kind: 'SSS_ADVANCE' }],
		paying: [
			{
				employment_id: 'employment',
				salary: { start: '2026-10-01', end: '2026-10-31' }
			}
		]
	};
	assert.equal(maternityCashConflictsWithPayroll(probe), true);
	assert.equal(
		maternityCashConflictsWithPayroll({
			...probe,
			cases: [{ ...probe.cases[0], leave_from: '2026-11-01', leave_through: '2027-02-13' }],
			movements: [
				{
					benefit_case_id: 'case',
					kind: 'SSS_ADVANCE',
					planned_leave_span_at_payment: { from: '2026-10-05', to: '2027-01-17' }
				}
			]
		}),
		true
	);
	assert.equal(
		maternityCashConflictsWithPayroll({
			...probe,
			cases: [{ ...probe.cases[0], leave_from: null, leave_through: null }],
			paying: [{ employment_id: 'employment', salary: { start: '2026-09-01', end: '2026-09-30' } }]
		}),
		true
	);
	assert.equal(
		maternityCashConflictsWithPayroll({
			...probe,
			entries: entries.map((row) => ({ ...row, approval_id: 'pending', payslip_id: null }))
		}),
		true
	);
	assert.equal(
		maternityCashConflictsWithPayroll({
			...probe,
			movements: [{ benefit_case_id: 'case', kind: 'SSS_REIMBURSEMENT' }]
		}),
		false
	);
	assert.equal(
		maternityCashConflictsWithPayroll({
			...probe,
			paying: [{ employment_id: 'employment', salary: { start: '2026-09-01', end: '2026-09-30' } }]
		}),
		false
	);
	assert.equal(
		maternityCashConflictsWithPayroll({
			...probe,
			paying: [{ employment_id: 'other', salary: probe.paying[0].salary }]
		}),
		false
	);
});
