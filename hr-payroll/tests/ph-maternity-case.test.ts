// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import cases from '../src/data/collection/benefit_cases/+collection.ts';
import movements from '../src/data/collection/benefit_case_movements/+collection.ts';
import { daysBetween } from '../src/lib/payroll/run/dates.ts';
import { caller, query, transform } from './helpers/bodies.ts';
import { lineageTables } from './fixtures/benefit-cases.ts';

const tables = lineageTables();
const application = {
	employee_id: 'mother',
	employment_id: 'contract',
	case_type: 'MATERNITY_LEAVE',
	case_reference: 'SSS-MBA-2026-001',
	application_on: '2026-09-01',
	expected_event_on: '2026-10-05',
	leave_from: '2026-09-20',
	leave_through: '2027-01-02'
};

test('PH maternity case may open before childbirth and later store actual event and SSS award', async () => {
	await transform(cases, [application], { tables });
	await transform(
		cases,
		[
			{
				event_kind: 'BIRTH',
				event_on: '2026-10-05',
				facts: { solo_parent_claimed: false },
				notified_on: '2026-09-02',
				notification_reference: 'SSS-NOTICE-001',
				award_amount: '70000.00',
				awarded_on: '2026-10-20',
				award_reference: 'SSS-AWARD-001'
			}
		],
		{ existing: [{ id: 'case-1', ...application }], tables }
	);
});

test('PH maternity case refuses incomplete event, award, exemption and mismatched employment', async () => {
	for (const [change, refusal] of [
		[{ event_kind: 'BIRTH' }, /kind and date together/],
		[{ event_kind: 'BIRTH', event_on: '2026-09-19' }, /inside the planned leave span/],
		[
			{ event_kind: 'BIRTH', event_on: '2026-10-05' },
			/Solo-parent extension claimed for this birth is required/
		],
		[
			{ event_kind: 'MISCARRIAGE', event_on: '2026-10-05', facts: { solo_parent_claimed: true } },
			/live birth only/
		],
		[
			{
				event_kind: 'BIRTH',
				event_on: '2026-10-05',
				facts: { solo_parent_claimed: true, solo_parent_document_kind: 'SOLO_PARENT_ID' }
			},
			/LGU document type, issue and validity dates/
		],
		[{ event_kind: 'STILLBIRTH', event_on: '2026-10-05' }, /records one of these events/],
		[{ award_amount: '70000.00' }, /actual award needs the event/],
		[{ facts: { exemption_kind: 'DISTRESSED' } }, /claimed DOLE exemption needs/],
		[{ notified_on: '2026-09-02' }, /date and receipt reference together/],
		[{ leave_through: '2026-09-19' }, /ordered calendar dates/],
		[{ employee_id: 'other' }, /this employee’s employment/],
		[{ facts: { undeclared: true } }, /declares no case fact undeclared/]
	] as const)
		await assert.rejects(transform(cases, [{ ...application, ...change }], { tables }), refusal);
	await assert.rejects(
		transform(cases, [application], {
			tables: lineageTables(undefined, 'TH')
		}),
		/declare no MATERNITY_LEAVE benefit case/
	);
});

test('PH maternity case stores event-specific solo-parent document evidence', async () => {
	const solo = {
		...application,
		event_kind: 'BIRTH',
		event_on: '2026-10-05',
		facts: {
			solo_parent_claimed: true,
			solo_parent_document_kind: 'ELIGIBILITY_CERTIFICATE',
			solo_parent_document_issued_on: '2026-11-01',
			solo_parent_document_valid_from: '2026-11-01',
			solo_parent_document_valid_through: '2027-10-31',
			solo_parent_document_reference: 'LGU-SP-001',
			solo_parent_document_issuer_lgu: 'City LGU',
			solo_parent_social_worker_signature_seen: true,
			solo_parent_mayor_signature_seen: true,
			solo_parent_certificate_details_checked: true,
			solo_parent_first_time: true
		}
	};
	await transform(cases, [solo], { tables });
	for (const change of [
		{ solo_parent_social_worker_signature_seen: false },
		{ solo_parent_mayor_signature_seen: false },
		{ solo_parent_certificate_details_checked: false },
		{ solo_parent_document_valid_from: '2026-12-01' }
	])
		await assert.rejects(
			transform(cases, [{ ...solo, facts: { ...solo.facts, ...change } }], { tables }),
			/checked signatures\/details/
		);
});

test('PH employee cash locks an actual event and preserves a recorded prebirth span', async () => {
	const funded = {
		...tables,
		benefit_case_movements: [
			{ benefit_case_id: 'case-1', kind: 'SSS_ADVANCE', direction: 'EMPLOYEE_PAYMENT' }
		]
	};
	const existing = [{ id: 'case-1', ...application }];
	for (const change of [{ application_on: '2026-09-02' }, { case_reference: 'SSS-MBA-2026-002' }])
		await assert.rejects(
			transform(cases, [change], { existing, tables: funded }),
			/funded benefit application date or reference cannot change/
		);
	await assert.rejects(
		transform(cases, [{ expected_event_on: '2026-10-06' }], {
			existing,
			tables: funded
		}),
		/funded benefit expected event cannot change/
	);
	await transform(
		cases,
		[{ event_kind: 'BIRTH', event_on: '2026-10-05', facts: { solo_parent_claimed: false } }],
		{
			existing,
			tables: funded
		}
	);
	await transform(cases, [{ leave_from: '2026-09-20', leave_through: '2027-01-02' }], {
		existing: [{ id: 'case-1', ...application, leave_from: null, leave_through: null }],
		tables: funded
	});
	await transform(cases, [{ leave_from: '2026-09-21', leave_through: '2027-01-03' }], {
		existing,
		tables: {
			...funded,
			benefit_case_movements: [
				{
					benefit_case_id: 'case-1',
					kind: 'SSS_ADVANCE',
					direction: 'EMPLOYEE_PAYMENT',
					planned_leave_span_at_payment: { from: '2026-09-20', to: '2027-01-02' }
				}
			]
		}
	});
	const delivered = [
		{
			...existing[0],
			event_kind: 'BIRTH',
			event_on: '2026-10-05',
			facts: { solo_parent_claimed: false }
		}
	];
	for (const change of [
		{ leave_from: '2026-09-21' },
		{ leave_through: '2027-01-03' },
		{ event_on: '2026-10-06' }
	])
		await assert.rejects(
			transform(cases, [change], { existing: delivered, tables: funded }),
			/funded benefit event or unsnapshotted leave span cannot change/
		);
	await assert.rejects(
		transform(cases, [{ leave_from: '2026-09-21' }], { existing, tables: funded }),
		/unsnapshotted leave span cannot change/
	);
});

test('PH claimed salary-differential exemption stores category, dated approval and evidence reference', async () => {
	await transform(
		cases,
		[
			{
				...application,
				facts: {
					exemption_kind: 'SMALL_RETAIL_SERVICE',
					exemption_effective_from: '2026-01-01',
					exemption_effective_through: '2026-12-31',
					exemption_approved_on: '2026-03-01',
					exemption_reference: 'DOLE-2026-001'
				}
			}
		],
		{ tables }
	);
});

test('PH cash movements keep employee payments and employer SSS receipts distinct', async () => {
	const caseTable = { ...tables, benefit_cases: [{ id: 'case-1', ...application }] };
	for (const kind of ['SSS_ADVANCE', 'SALARY_DIFFERENTIAL', 'SSS_REIMBURSEMENT']) {
		const [result] = await transform(
			movements,
			[
				{
					benefit_case_id: 'case-1',
					kind,
					paid_on: '2026-10-20',
					amount: '1000.00',
					payment_reference: `${kind}-BANK-001`,
					evidence_file: { path: `${kind}-receipt.pdf` }
				}
			],
			{ tables: caseTable }
		);
		assert.equal(
			result.direction,
			kind === 'SSS_REIMBURSEMENT' ? 'EMPLOYER_RECEIPT' : 'EMPLOYEE_PAYMENT'
		);
		assert.deepEqual(
			result.planned_leave_span_at_payment ?? null,
			kind === 'SSS_REIMBURSEMENT' ? null : { from: '2026-09-20', to: '2027-01-02' }
		);
	}
	for (const [change, refusal] of [
		[{ amount: '0.00' }, /positive amount to the cent/],
		[{ amount: '1000.001' }, /positive amount to the cent/],
		[{ paid_on: '2026-02-30' }, /actual payment date/],
		[{ payment_reference: ' ' }, /receipt reference/],
		[{ benefit_case_id: 'other' }, /existing benefit case/],
		[{ kind: 'SSS_LOAN' }, /declares no cash movement SSS_LOAN/]
	] as const)
		await assert.rejects(
			transform(
				movements,
				[
					{
						benefit_case_id: 'case-1',
						kind: 'SSS_ADVANCE',
						paid_on: '2026-10-20',
						amount: '1000.00',
						payment_reference: 'BANK-001',
						evidence_file: { path: 'bank-credit.pdf' },
						...change
					}
				],
				{ tables: caseTable }
			),
			refusal
		);
	await assert.rejects(
		transform(
			movements,
			[
				{
					benefit_case_id: 'case-1',
					kind: 'SSS_ADVANCE',
					paid_on: '2026-10-20',
					amount: '1000.00',
					payment_reference: 'BANK-NO-FILE'
				}
			],
			{ tables: caseTable }
		),
		/bank credit or signed cash voucher file/
	);
	await assert.rejects(
		transform(movements, [{ amount: '999.00' }], {
			existing: [
				{
					id: 'cash-1',
					benefit_case_id: 'case-1',
					kind: 'SSS_ADVANCE',
					direction: 'EMPLOYEE_PAYMENT',
					paid_on: '2026-10-20',
					amount: '1000.00',
					payment_reference: 'BANK-001',
					evidence_file: { path: 'bank-credit.pdf' }
				}
			],
			tables: {
				...caseTable,
				payment_events: [
					{ external_source_kind: 'BENEFIT_CASE_MOVEMENT', external_source_id: 'cash-1' }
				]
			}
		}),
		/credited by an immutable payment event cannot change/
	);
});

test('PH saved cash assessment requires the actual award, exact full-span wages and approved days', async () => {
	const awardedCase = {
		id: 'case-1',
		...application,
		event_kind: 'BIRTH',
		event_on: '2026-10-05',
		facts: { solo_parent_claimed: false },
		award_amount: '70000.00',
		awarded_on: '2026-10-20',
		award_reference: 'SSS-AWARD-001',
		award_file: { path: 'sss-award.pdf' }
	};
	const wage = {
		id: 'wages-1',
		employment_id: 'contract',
		period: { from: application.leave_from, to: application.leave_through },
		currency: 'PHP',
		normal_wages: '100000.00',
		reference: 'CONTRACT-FULL-SPAN-001'
	};
	const entry = {
		id: 'leave-1',
		employment_id: 'contract',
		leave_code: 'MATERNITY_LEAVE',
		approval_id: null,
		event_kind: 'BIRTH',
		event_date: '2026-10-05',
		charges: daysBetween(application.leave_from, application.leave_through).map((date) => ({
			date,
			days: 1
		}))
	};
	const saved = {
		...tables,
		benefit_cases: [awardedCase],
		employment_wage_periods: [wage],
		leave_entries: [entry],
		payslips: [],
		benefit_case_movements: [
			{
				kind: 'SSS_ADVANCE',
				benefit_case_id: 'case-1',
				paid_on: '2026-09-30',
				amount: '70000.00'
			},
			{
				kind: 'SALARY_DIFFERENTIAL',
				benefit_case_id: 'case-1',
				paid_on: '2026-10-01',
				amount: '30000.00'
			},
			{
				kind: 'SSS_REIMBURSEMENT',
				benefit_case_id: 'case-1',
				paid_on: '2026-12-01',
				amount: '70000.00'
			}
		]
	};
	const assess = (tables) =>
		query(
			cases,
			'assess_cash_evidence',
			{ case_id: 'case-1', as_of: '2027-01-31' },
			caller({ tables })
		);
	assert.deepEqual(await assess(saved), {
		status: 'ALLOCATION_UNASSESSED',
		full_span_normal_wages: 100000,
		wage_reference: 'CONTRACT-FULL-SPAN-001',
		award_amount: 70000,
		award_reference: 'SSS-AWARD-001',
		advance_paid: 70000,
		salary_differential_paid: 30000,
		reimbursement_received_by_employer: 70000
	});
	await assert.rejects(
		assess({ ...saved, benefit_cases: [{ ...awardedCase, award_file: null }] }),
		/actual award amount, date, reference and document/
	);
	await assert.rejects(
		assess({
			...saved,
			employment_wage_periods: [{ ...wage, period: { from: '2026-09-20', to: '2026-12-31' } }]
		}),
		/exact complete leave span/
	);
	await assert.rejects(
		assess({ ...saved, leave_entries: [{ ...entry, charges: entry.charges.slice(1) }] }),
		/complete approved continuous leave span/
	);
	await assert.rejects(
		assess({
			...saved,
			leave_entries: [{ ...entry, payslip_id: 'slip-1' }],
			payslips: [{ id: 'slip-1', employment_id: 'contract', paid_at: '2027-01-25T00:00:00.000Z' }]
		}),
		/Paid benefit payslips lack a saved award, full-wage and prior-cash allocation/
	);
});
