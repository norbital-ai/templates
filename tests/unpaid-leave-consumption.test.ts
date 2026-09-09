// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { paymentRequest, claimRequest, requestPayPeriod } from '../src/lib/payroll/money.ts';
import { calculateFamilies } from '../src/lib/payroll/families.ts';

const APRIL = { start: '2026-04-01', end: '2026-04-30' };
const ATTENDANCE = { start: '2026-03-21', end: '2026-04-20' };
const BASIC = {
	id: 'work-salary',
	settings_id: 'settings',
	family: 'WORK',
	output: 'salary',
	code: 'BASIC',
	nature: 'EARNING',
	is_statutory: false,
	contribution_treatments: {},
	sequence: 10,
	eligibility: '',
	definition: { source: 'SCHEDULE', unit: 'MONEY', reducible: false }
};
const NPL = {
	id: 'leave-unpaid',
	settings_id: 'settings',
	code: 'NPL',
	name: 'Unpaid leave',
	is_statutory: false,
	eligibility: '',
	requires_certificate_after_days: null,
	entitlement: { availability: 'UNLIMITED', year_start_month: 1, proration: 'NONE', bands: [] },
	paid: false,
	treatments: {}
};
const TERM = {
	id: 'terms-1',
	employment_id: 'employment-1',
	base_salary: { value: 3000, currency: 'MYR' },
	pay_frequency: 'MONTHLY',
	shift_pattern_id: 'pattern-1',
	statutory_work_category: 'NON_MANUAL',
	employment_type: 'PERMANENT',
	work_classification: 'NON_MANUAL',
	department: null,
	payroll_group: null,
	effective_range: { start: '2021-01-01', end: null }
};
function leaveEntry(id, dates) {
	const charges = dates.map((date) => ({
		date,
		days: 1,
		leave_catalogue_id: NPL.id,
		employment_term_id: TERM.id,
		holiday_id: null,
		shift_definition_id: null,
		work_day_id: null
	}));
	return {
		id,
		employment_id: TERM.employment_id,
		leave_catalogue_id: NPL.id,
		leave_code: NPL.code,
		reference: id,
		event: {
			kind: 'TIME_OFF',
			range: {
				start: { date: dates[0], half: 'FIRST' },
				end: { date: dates.at(-1), half: 'SECOND' }
			},
			chargeable_days: dates.length,
			reason: 'Approved absence'
		},
		charges,
		allocations: [],
		approval_id: null
	};
}
function measure(entries) {
	const leave = {
		entries,
		catalogues: [NPL],
		captures: [],
		balances: {},
		deductionEligibility: Object.fromEntries(
			entries.flatMap((entry) =>
				entry.charges.map((charge) => [`${entry.id}/${charge.date}`, true])
			)
		)
	};
	return calculateFamilies({
		bundle: {
			employment: {
				id: TERM.employment_id,
				employee_id: 'employee-1',
				employee_number: 'TEST',
				company_id: 'company',
				hire_date: '2021-01-01',
				exit_date: null,
				effective_range: { start: '2021-01-01', end: null }
			},
			employee: { id: 'employee-1', date_of_birth: '1990-01-01', gender: 'MALE' },
			terms: [TERM],
			termsHistory: [TERM],
			children: [],
			statutoryFacts: [],
			payRequests: [],
			loans: [],
			loanRepayments: [],
			leave,
			workDays: [],
			serviceMonths: 63,
			age: 36,
			employedDays: APRIL,
			wageDays: APRIL,
			attendance: ATTENDANCE,
			payFrequency: 'MONTHLY',
			window: { period: '2026-04', salary: APRIL, attendance: ATTENDANCE },
			arrearsFor: null,
			deferral: null
		},
		configuration: {
			company: {
				id: 'company',
				name: 'Fixture',
				settings_code: 'TEST',
				pay_cutoff_day: 21,
				risk_class: null
			},
			jurisdiction: { id: 'settings', code: 'TEST', currency: 'MYR', tax_year_start_month: 1 },
			work: {
				jurisdiction_code: 'TEST',
				proration: { by: 'CALENDAR_DAYS' },
				ordinary_rate: { per: 'DAY', divisor: 26 }
			},
			holidayRestPrecedence: 'REST_DAY',
			contributions: [],
			treatments: new Map(),
			catalogueComponents: [BASIC],
			overtimeRules: [],
			overtimeLimits: [],
			overtimeCoverageRule: null,
			shiftById: new Map(),
			patternById: new Map([
				[
					'pattern-1',
					{
						id: 'pattern-1',
						code: 'GUARANTEED',
						pattern: {
							type: 'ROSTERED',
							expectation: {
								kind: 'GUARANTEED_SCHEDULE',
								period: 'WEEK',
								required_work_days: 6,
								required_paid_minutes: 2700
							}
						}
					}
				]
			]),
			holidays: new Map(),
			catalogueLeaves: [NPL],
			hash: 'test'
		},
		period: '2026-04',
		salary: APRIL,
		periodsRemaining: 9,
		headcount: 1,
		consumedEntries: new Map(),
		consumedRepayments: new Map()
	});
}

test('unpaid leave names the approved entry and exact day that caused the deduction', () => {
	const measured = measure([leaveEntry('leave-1', ['2026-04-10'])]);
	const [deduction] = measured.adjustments;
	assert.deepEqual(deduction.input, { family: 'LEAVE', id: 'leave-1' });
	assert.equal(deduction.catalogueComponent.catalogue_id, NPL.id);
	assert.equal(deduction.quantity, 1);
	assert.equal(deduction.amount, 100, '3000 monthly salary / 30 calendar days');
	assert.deepEqual(
		measured.base.map((row) => row.label),
		['BASIC']
	);
	assert.deepEqual(
		measured.captured.leave[0].charges.map((row) => row.date),
		['2026-04-10']
	);
	assert.equal(measured.captured.leave[0].gross_amount.value, -100);
});

test('three approved entries retain three dated deductions and their exact total', () => {
	const measured = measure([
		leaveEntry('leave-a', ['2026-04-08']),
		leaveEntry('leave-b', ['2026-04-09']),
		leaveEntry('leave-c', ['2026-04-10'])
	]);
	assert.deepEqual(
		measured.adjustments.map((row) => row.input.id),
		['leave-a', 'leave-b', 'leave-c']
	);
	assert.deepEqual(
		measured.adjustments.map((row) => row.amount),
		[100, 100, 100]
	);
	assert.equal(
		measured.adjustments.reduce((total, row) => total + row.amount, 0),
		300
	);
	assert.equal(
		measured.adjustments.reduce((total, row) => total + row.quantity, 0),
		3
	);
});

test('an entry spanning the cutoff captures only its approved dates inside this payroll window', () => {
	const measured = measure([
		leaveEntry('leave-spanning', ['2026-03-20', '2026-03-21', '2026-04-05', '2026-04-21'])
	]);
	assert.equal(measured.captured.leave.length, 1);
	assert.equal(measured.captured.leave[0].leave_entry_id, 'leave-spanning');
	assert.deepEqual(
		measured.captured.leave[0].charges.map((row) => row.date),
		['2026-03-21', '2026-04-05']
	);
	assert.deepEqual(
		measured.adjustments.map((row) => row.amount),
		[96.77, 100],
		'each date uses its own salary month denominator'
	);
});

test('without approved unpaid dates Leave produces neither money nor captures', () => {
	const measured = measure([]);
	assert.deepEqual(measured.adjustments, []);
	assert.deepEqual(measured.captured.leave, []);
	assert.deepEqual(
		measured.base.map((row) => row.label),
		['BASIC']
	);
});

test('Claim uses its incurred day and Payment its effective day to select the default period', () => {
	const core = { id: 'request', employment_id: 'employment-1', amount: 42, pay_period: null };
	const claim = claimRequest({
		...core,
		claim_catalogue_id: 'claim',
		incurred_on: '2026-04-10',
		description: null
	});
	assert.equal(claim.event_date, '2026-04-10');
	assert.equal(requestPayPeriod(claim, 21), '2026-04');
	const payment = paymentRequest({
		...core,
		payment_catalogue_id: 'payment',
		effective_on: '2026-04-25',
		reason: 'Agreed payment'
	});
	assert.equal(payment.event_date, '2026-04-25');
	assert.equal(requestPayPeriod(payment, 21), '2026-05');
	assert.equal(requestPayPeriod({ ...payment, pay_period: '2026-04' }, 21), '2026-04');
});
