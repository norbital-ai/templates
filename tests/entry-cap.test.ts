/**
 * A pay line's entitlement ceiling, refused when the request is written.
 *
 * Before this the cap existed only inside MEASURE: a twelfth claim against an annual limit of ten
 * was accepted, sat in the workspace, and took down the whole company's payroll run weeks later.
 * The refusal named the run, not the entry, and reached somebody who was not the person who made
 * the mistake at a moment when it could no longer be corrected cheaply.
 *
 * `resolveEntryCap` is one rule with two callers — MEASURE and the write hook — so this file
 * covers the arithmetic once: which band is the person's, the capped period, sibling usage, and
 * BLOCK against ALLOW. `family-cap-history.test.ts` covers the hook and the run consuming it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { entryCapRefusal, resolveEntryCap } from '../src/collections/payroll_runs/lib/entry-cap.ts';
import type { PersonContext } from '../src/collections/payroll_runs/lib/eligibility.ts';

const PERSON: PersonContext = {
	employee: { gender: 'FEMALE', age: 34, citizenship: 'MY' },
	employment: {
		type: 'PERMANENT',
		classification: 'EA_COVERED',
		service_months: 40,
		hire_date: '2022-01-01'
	},
	terms: { basic_salary: 3451, workman: false, department: 'OPS', payroll_group: 'HQ', grade: '' },
	children: { count: 0, ages: [] }
};

const COMPONENT = { family: 'CLAIM', code: 'MEDICAL' };
const EMPLOYMENT = 'employment-1';

const cap = (over: Record<string, unknown> = {}) =>
	({
		period: 'CALENDAR_YEAR',
		on_exceed: 'BLOCK',
		bands: [{ eligibility: '', amount: 1000 }],
		...over
	}) as never;

const entry = (id: string, amount: number, date: string) => ({
	id,
	employment_id: EMPLOYMENT,
	component: COMPONENT,
	amount,
	date
});

const resolve = (over: Record<string, unknown> = {}) =>
	resolveEntryCap({
		cap: cap(),
		component: COMPONENT,
		employmentId: EMPLOYMENT,
		entry: entry('e2', 400, '2026-06-01'),
		eventDate: '2026-06-01',
		siblings: [],
		eventDateOf: (row) => row.date,
		componentOf: (row) => row.component,
		usedAmountOf: (row) => row.amount,
		subject: PERSON,
		...over
	} as never);

test('the ceiling is the first band whose predicate holds, so tiers go from specific to general', () => {
	const tiers = cap({
		bands: [
			{ eligibility: 'terms.grade == "G3"', amount: 2500 },
			{ eligibility: "employee.gender == 'FEMALE'", amount: 1500 },
			{ eligibility: '', amount: 1000 }
		]
	});
	assert.equal(
		resolve({ cap: tiers, subject: { ...PERSON, terms: { ...PERSON.terms, grade: 'G3' } } })
			?.amount,
		2500,
		'a G3 reads the G3 row, whatever the rows below would say'
	);
	assert.equal(resolve({ cap: tiers })?.amount, 1500, 'no grade, so the next row that holds');
	assert.equal(
		resolve({
			cap: tiers,
			subject: { ...PERSON, employee: { ...PERSON.employee, gender: 'MALE' } }
		})?.amount,
		1000,
		'and the everyone row for the rest'
	);
});

test('a person no band covers has no entitlement at all', () => {
	const none = resolve({
		cap: cap({ bands: [{ eligibility: 'terms.grade == "G3"', amount: 2500 }] })
	});
	assert.equal(none, null);
});

test('only entries before this one, in the same capped period, are already spent', () => {
	const siblings = [
		entry('e0', 300, '2026-01-10'), // earlier this year
		entry('e1', 200, '2026-05-01'), // earlier this year
		entry('e2', 400, '2026-06-01'), // the entry itself, excluded by id
		entry('e3', 500, '2026-09-01'), // later, so not yet spent
		entry('e9', 700, '2025-06-01') // a different calendar year
	];
	const resolved = resolve({ siblings });
	assert.equal(resolved?.exceededBy, 500, 'three hundred and two hundred, and nothing else');
});

test('the capped period decides what counts as already spent', () => {
	const siblings = [entry('e0', 300, '2026-01-10'), entry('e1', 200, '2026-06-02')];
	const spentUnder = (period: string) => resolve({ cap: cap({ period }), siblings })?.exceededBy;
	assert.equal(spentUnder('CALENDAR_YEAR'), 300, 'January counts; the later June entry does not');
	assert.equal(spentUnder('MONTH'), 0, 'January is a different month');
	assert.equal(spentUnder('LIFETIME'), 300, 'every earlier entry, whatever its year');
	assert.equal(spentUnder('PER_EVENT'), 0, 'each event stands alone, so nothing is ever spent');
});

test('two entries on one day break their tie by id, so neither refuses the other', () => {
	// Without a total order both would count the other as "already spent" and each would refuse.
	const sameDay = [entry('e1', 400, '2026-06-01'), entry('e2', 400, '2026-06-01')];
	assert.equal(resolve({ siblings: sameDay })?.exceededBy, 400, 'e2 sees e1 before it');
	const first = resolve({
		entry: entry('e1', 400, '2026-06-01'),
		siblings: sameDay
	});
	assert.equal(first?.exceededBy, 0, 'and e1 sees nothing before it');
});

test('a BLOCK cap refuses by name once the ceiling is passed, and not before', () => {
	const resolved = { amount: 1000, exceededBy: 800 };
	assert.equal(
		entryCapRefusal({
			cap: cap(),
			resolved,
			componentCode: 'MEDICAL',
			subject: 'PUB-EMP-0001',
			proposed: 200
		}),
		null,
		'exactly the ceiling is within it'
	);
	const refusal = entryCapRefusal({
		cap: cap(),
		resolved,
		componentCode: 'MEDICAL',
		subject: 'PUB-EMP-0001',
		proposed: 200.01
	});
	assert.match(refusal ?? '', /MEDICAL entitlement exceeded for PUB-EMP-0001/);
	assert.match(refusal ?? '', /1000\.01 requested against 1000\.00 allowed/);
});

test('an ALLOW cap states a ceiling for reporting and refuses nothing', () => {
	assert.equal(
		entryCapRefusal({
			cap: cap({ on_exceed: 'ALLOW' }),
			resolved: { amount: 1000, exceededBy: 5000 },
			componentCode: 'MEDICAL',
			subject: 'PUB-EMP-0001',
			proposed: 5000
		}),
		null
	);
});
