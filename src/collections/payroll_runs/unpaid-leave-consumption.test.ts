// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { entryEventDate, entryPayPeriod } from './lib/entries.ts';
import { measureEmployment } from './lib/measure.ts';
import { PLAIN_CALENDAR } from './lib/settlement.ts';

const JURISDICTION = {
	norbital_id: 'jur-my',
	code: 'MY',
	proration: { by: 'CALENDAR_DAYS' },
	ordinary_rate_divisor: 26,
	ordinary_rate_basis: 'DAYS_PER_MONTH',
	tax_year_start_month: 1,
	effective_range: { start: '2020-01-01', end: null }
};

const COMPANY = {
	norbital_id: 'co-nihon-my',
	name: 'Nihon (MY)',
	jurisdiction_id: 'jur-my',
	pay_cutoff_day: 21,
	pay_day: 25,
	leave_year_start_month: 1,
	overtime_calculation_method: 'STATUTORY_AGGREGATE',
	risk_class: null,
	settlement_policy: null,
	effective_range: { start: '2020-01-01', end: null }
};

const BASIC = {
	norbital_id: 'pc-basic',
	company_id: 'co-nihon-my',
	code: 'BASIC',
	name: 'Basic salary',
	nature: 'EARNING',
	policy: { kind: 'EARNING', settlement: 'ADD', statutory_treatments: [] },
	sequence: 10,
	eligibility: [],
	definition: { source: 'SCHEDULE', unit: 'MONEY', reducible: false },
	effective_range: { start: '2020-01-01', end: null }
};

const NPL = {
	norbital_id: '00000000-0000-4000-8000-0000000000n1',
	company_id: 'co-nihon-my',
	code: 'NPL',
	name: 'Unpaid leave',
	nature: 'ABSENCE',
	policy: { kind: 'ABSENCE', settlement: 'DEDUCT', statutory_treatments: [] },
	sequence: 20,
	eligibility: [],
	definition: { source: 'FORMULA', unit: 'MONEY', expr: '100.0' },
	effective_range: { start: '2020-01-01', end: null }
};

const NPL_TYPE = {
	norbital_id: '00000000-0000-4000-8000-0000000000t1',
	company_id: 'co-nihon-my',
	code: 'NPL',
	name: 'Unpaid leave',
	eligibility: [],
	aggregates_with: null,
	encash_on_exit: false,
	requires_certificate_after_days: null,
	accrual: { kind: 'PER_EVENT' },
	entitlement: { layers: [] },
	payroll_effect: { kind: 'UNPAID', component_id: NPL.norbital_id },
	effective_range: { start: '2020-01-01', end: null }
};

const GUARANTEED_PATTERN = {
	type: 'ROSTERED',
	expectation: {
		kind: 'GUARANTEED_SCHEDULE',
		period: 'WEEK',
		required_work_days: 6,
		required_paid_minutes: 2700
	}
};

function configuration(leaveTypes = [NPL_TYPE]) {
	return {
		company: COMPANY,
		jurisdiction: JURISDICTION,
		contributions: [],
		treatments: new Map(),
		payComponents: [BASIC, NPL],
		overtimeRules: [],
		overtimeLimits: [],
		overtimeCoverageRule: null,
		restBreakRules: new Map(),
		shiftById: new Map(),
		holidays: new Map(),
		leaveTypes,
		hash: 'test'
	};
}

function bundle(ledger = []) {
	return {
		employment: {
			norbital_id: 'emp-nhpmy0290',
			employee_id: 'ee-1',
			employee_number: 'NHPMY0290',
			company_id: 'co-nihon-my',
			hire_date: '2021-06-01',
			exit_date: null,
			department: null,
			payroll_group: null,
			employment_type: 'PERMANENT',
			work_classification: 'NON_MANUAL',
			effective_range: { start: '2021-06-01', end: null }
		},
		employee: { norbital_id: 'ee-1', date_of_birth: '1990-01-01', gender: 'MALE' },
		terms: [
			{
				norbital_id: 'terms-1',
				employment_id: 'emp-nhpmy0290',
				base_salary: { value: 3000, currency: 'MYR' },
				pay_frequency: 'MONTHLY',
				work_pattern: GUARANTEED_PATTERN,
				statutory_work_category: 'NON_MANUAL',
				effective_range: { start: '2020-01-01', end: null }
			}
		],
		statutoryFacts: [],
		entries: [],
		ledger,
		timeEntries: [],
		rosterEntries: [],
		agreements: [],
		serviceMonths: 58,
		age: 36,
		employedDays: { start: '2026-04-01', end: '2026-04-30' },
		wageDays: { start: '2026-04-01', end: '2026-04-30' },
		attendance: { start: '2026-03-21', end: '2026-04-20' },
		arrearsFor: null,
		deferral: null,
		extendedLeaveSettlesInOwnMonth: false
	};
}

test('unpaid leave emits a LEAVE_UNPAID line linked to the leave requests', () => {
	const leaveRequestId = '00000000-0000-4000-8000-0000000000r1';
	const measured = measureEmployment({
		bundle: bundle([
			{
				norbital_id: leaveRequestId,
				leave_type_id: NPL_TYPE.norbital_id,
				entry_date: '2026-04-10',
				kind: 'TAKEN',
				days: -1,
				source_id: leaveRequestId,
				norbital_approval_id: null
			}
		]),
		configuration: configuration(),
		period: '2026-04',
		salary: { start: '2026-04-01', end: '2026-04-30' },
		periodsRemaining: 9,
		headcount: 1,
		policy: PLAIN_CALENDAR
	});
	const npl = measured.lines.filter((line) => line.payComponent.code === 'NPL');
	assert.equal(npl.length, 1);
	assert.deepEqual(npl[0].component, {
		kind: 'LEAVE_UNPAID',
		pay_component_id: NPL.norbital_id,
		leave_request_ids: [leaveRequestId]
	});
	assert.equal(npl[0].quantity, 1);
});

test('a formula component with no unpaid leave in the window stays a bare FORMULA', () => {
	const measured = measureEmployment({
		bundle: bundle([]),
		configuration: configuration(),
		period: '2026-04',
		salary: { start: '2026-04-01', end: '2026-04-30' },
		periodsRemaining: 9,
		headcount: 1,
		policy: PLAIN_CALENDAR
	});
	const npl = measured.lines.filter((line) => line.payComponent.code === 'NPL');
	assert.equal(npl.length, 1);
	assert.deepEqual(npl[0].component, {
		kind: 'FORMULA',
		pay_component_id: NPL.norbital_id
	});
});

test('a claim with incurred_on settles by that date, not event_date', () => {
	const claim = {
		norbital_id: 'claim-1',
		pay_period: null,
		event_date: '2026-04-25',
		origin: { kind: 'CLAIM', evidence_file: null, incurred_on: '2026-04-10' }
	};
	assert.equal(entryPayPeriod(claim, 21), '2026-04');
	assert.equal(entryEventDate(claim, new Map([[claim.norbital_id, claim]])), '2026-04-10');
});

test('a claim without incurred_on falls back to event_date for the cutoff', () => {
	const claim = {
		norbital_id: 'claim-2',
		pay_period: null,
		event_date: '2026-04-25',
		origin: { kind: 'ONE_OFF', note: 'adhoc' }
	};
	assert.equal(entryPayPeriod(claim, 21), '2026-05');
});
