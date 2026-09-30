/**
 * The obligation ledger (L1), hand-computed over jurisdiction-free duty types: an event materialises the duties that
 * listen for it with their stored due day, amount and retention; raising again is a no-op; LATE is derived; a
 * fulfilment is refused until the evidence the duty declares is recorded.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	calendarOccurrences,
	daysLate,
	fulfilmentFault,
	instanceKey,
	lateCharge,
	materialise,
	obligationContext,
	obligationStatus,
	openObligations,
	type DutyEvent,
	type DutyType
} from '../src/lib/obligations/materialise.ts';
import { evaluateDate, expressionEngine } from '../src/lib/expressions/evaluate.ts';

const REMIT: DutyType = {
	code: 'REMIT',
	authority: 'Levy Act s.1',
	subject: 'RUN',
	trigger: { on: 'RUN_FINALISED', when: 'run.headcount > 0' },
	due: 'add_months(period.end, 1)',
	amount: 'run.remittances.LEVY * 2.0',
	late_charge: 'obligation.amount_due * 0.01 * obligation.days_late',
	retain_years: '7'
};
const RETURN: DutyType = {
	code: 'QUARTER_RETURN',
	authority: 'Returns Act s.2',
	subject: 'COMPANY',
	trigger: { on: 'CALENDAR', every: 'QUARTER' },
	due: 'add_months(period.end, 1)'
};

const runEvent = (headcount: number): DutyEvent => ({
	on: 'RUN_FINALISED',
	subject: { kind: 'RUN', id: 'run-1' },
	ref: '2026-01',
	date: '2026-01-31',
	context: obligationContext({
		period: { start: '2026-01-01', end: '2026-01-31' },
		run: { headcount, remittances: { LEVY: 125.5 } }
	})
});
const raise = (event: DutyEvent, existing: ReadonlySet<string> = new Set()) =>
	materialise({
		duties: [REMIT, RETURN],
		settingsId: 'v1',
		companyId: 'c1',
		event,
		existing
	});

test('obligations: a finalised run raises its duty due a month after the period end, with its stored amount', () => {
	const [row, ...rest] = raise(runEvent(3));
	assert.equal(rest.length, 0);
	assert.deepEqual(row, {
		duty_code: 'REMIT',
		subject_kind: 'RUN',
		subject_id: 'run-1',
		trigger_ref: '2026-01',
		company_id: 'c1',
		settings_id: 'v1',
		authority: 'Levy Act s.1',
		triggered_on: '2026-01-31',
		// 31 January + 1 month clamps to 28 February
		due_on: '2026-02-28',
		// 125.50 × 2
		amount_due: 251,
		// seven years from the due day
		retain_until: '2033-02-28',
		state: 'OPEN',
		facts: {}
	});
});

test('obligations: a duty whose condition is false, or whose trigger or subject differs, is not raised', () => {
	assert.deepEqual(raise(runEvent(0)), []);
	assert.deepEqual(raise({ ...runEvent(3), on: 'EXIT' }), []);
	assert.deepEqual(raise({ ...runEvent(3), subject: { kind: 'COMPANY', id: 'c1' } }), []);
});

test('obligations: raising an event again is idempotent on (duty, subject, trigger)', () => {
	const first = raise(runEvent(3));
	assert.deepEqual(raise(runEvent(3), new Set(first.map(instanceKey))), []);
});

test('obligations: a calendar duty is raised only by an occurrence of its own cadence', () => {
	const occurrence = (every: 'MONTH' | 'QUARTER', ref: string, end: string): DutyEvent => ({
		on: 'CALENDAR',
		every,
		subject: { kind: 'COMPANY', id: 'c1' },
		ref,
		date: '2026-01-01',
		context: obligationContext({ period: { start: '2026-01-01', end } })
	});
	assert.deepEqual(raise(occurrence('MONTH', '2026-01', '2026-01-31')), []);
	const [row] = raise(occurrence('QUARTER', '2026-Q1', '2026-03-31'));
	assert.equal(row?.duty_code, 'QUARTER_RETURN');
	// 31 March + 1 month clamps to 30 April
	assert.equal(row?.due_on, '2026-04-30');
	assert.equal(row?.amount_due, null);
	assert.equal(row?.retain_until, null);
});

test('obligations: calendar occurrences are calendar-aligned, overlap the start and stop at the through day', () => {
	assert.deepEqual(calendarOccurrences('QUARTER', '2025-12-01', '2026-04-02'), [
		{ ref: '2025-Q4', start: '2025-10-01', end: '2025-12-31' },
		{ ref: '2026-Q1', start: '2026-01-01', end: '2026-03-31' },
		{ ref: '2026-Q2', start: '2026-04-01', end: '2026-06-30' }
	]);
	assert.deepEqual(calendarOccurrences('YEAR', '2025-12-01', '2026-01-01'), [
		{ ref: '2025', start: '2025-01-01', end: '2025-12-31' },
		{ ref: '2026', start: '2026-01-01', end: '2026-12-31' }
	]);
	// a leap February
	assert.deepEqual(calendarOccurrences('MONTH', '2028-02-10', '2028-02-29'), [
		{ ref: '2028-02', start: '2028-02-01', end: '2028-02-29' }
	]);
	assert.deepEqual(calendarOccurrences('MONTH', '2026-03-01', '2026-02-28'), []);
});

test('obligations: LATE is derived — open past the due day, counted in calendar days', () => {
	const open = { state: 'OPEN', due_on: '2026-02-28' };
	assert.equal(obligationStatus(open, '2026-02-28'), 'OPEN');
	assert.equal(daysLate(open, '2026-02-28'), 0);
	assert.equal(obligationStatus(open, '2026-03-02'), 'LATE');
	// 1 and 2 March
	assert.equal(daysLate(open, '2026-03-02'), 2);
	const fulfilled = { state: 'FULFILLED', due_on: '2026-02-28', fulfilled_on: '2026-03-01' };
	assert.equal(obligationStatus(fulfilled, '2026-06-01'), 'FULFILLED');
	assert.equal(daysLate(fulfilled, '2026-06-01'), 1);
	assert.equal(daysLate({ state: 'WAIVED', due_on: '2026-02-28' }, '2026-06-01'), 0);
});

test('obligations: the late charge is the stored expression over the amount and the days late', () => {
	const open = { state: 'OPEN', due_on: '2026-02-28', amount_due: 251 };
	// 251 × 1% × 2 days
	assert.equal(lateCharge(REMIT, open, '2026-03-02'), 5.02);
	assert.equal(lateCharge(REMIT, open, '2026-02-28'), 0);
	assert.equal(lateCharge(RETURN, open, '2026-03-02'), 0);
});

test('obligations: a fulfilment is refused until its day, evidence facts, evidence rows and full amount are recorded', () => {
	const duty: Pick<DutyType, 'code' | 'evidence'> = {
		code: 'REMIT',
		evidence: [
			{ key: 'receipt', type: 'string', label: 'Receipt', evidence: { kind: 'REFERENCE' } },
			{ key: 'filed_on', type: 'date' }
		]
	};
	const done = {
		fulfilled_on: '2026-02-20',
		facts: { receipt: 'R-1', filed_on: '2026-02-20' },
		amount_due: 251,
		amount_settled: 251
	};
	const evidenced = new Set(['receipt']);
	assert.match(
		fulfilmentFault(duty, { ...done, fulfilled_on: null }, evidenced)!,
		/day it was fulfilled/
	);
	assert.match(
		fulfilmentFault(duty, { ...done, facts: { filed_on: '2026-02-20' } }, evidenced)!,
		/record Receipt/
	);
	assert.match(
		fulfilmentFault(
			duty,
			{ ...done, facts: { receipt: 'R-1', filed_on: '2026-13-01' } },
			evidenced
		)!,
		/calendar day/
	);
	assert.match(fulfilmentFault(duty, done, new Set())!, /Receipt needs its evidence/);
	assert.match(
		fulfilmentFault(duty, { ...done, amount_settled: 200 }, evidenced)!,
		/settled in full/
	);
	assert.equal(fulfilmentFault(duty, done, evidenced), null);
	assert.equal(fulfilmentFault({ code: 'NOTE' }, { fulfilled_on: '2026-02-20' }, new Set()), null);
});

test('obligations: open duties of one code are what a stored check reads', () => {
	const rows = [
		{ duty_code: 'REMIT', state: 'OPEN', due_on: '2026-02-28' },
		{ duty_code: 'REMIT', state: 'FULFILLED', due_on: '2026-01-31' },
		{ duty_code: 'QUARTER_RETURN', state: 'OPEN', due_on: '2026-04-30' }
	];
	assert.deepEqual(openObligations(rows, 'REMIT'), [rows[0]]);
});

test('obligations: a due expression that is not a calendar day is refused by name', () => {
	assert.throws(
		() => evaluateDate(expressionEngine, '"soon"', obligationContext()),
		/not a YYYY-MM-DD day/
	);
	assert.equal(
		evaluateDate(expressionEngine, 'add_months(trigger.date, 2)', {
			trigger: { date: '2026-01-31' }
		}),
		'2026-03-31'
	);
	const blank = obligationContext({ run: { headcount: 2 } });
	assert.equal(blank.run.headcount, 2);
	assert.equal(blank.run.gross, 0);
	assert.deepEqual(blank.company.facts, {});
});
