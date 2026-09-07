/**
 * A claim's entitlement ceiling, refused when the claim is written.
 *
 * Before this the cap existed only inside MEASURE: a twelfth claim against an annual limit of ten
 * was accepted, sat in the workspace, and took down the whole company's payroll run weeks later.
 * The refusal named the run, not the entry, and reached somebody who was not the person who made
 * the mistake at a moment when it could no longer be corrected cheaply.
 *
 * `resolveEntryCap` is now one rule with two callers — MEASURE and the write hook — so this file
 * covers the arithmetic once, and `entry-cap-refusal.test.ts` covers the hook that consumes it.
 * None of it had any test at all: `resolveEntryCap`, the `MAX_WITH_COMPANY_LAYERS` merge, the five
 * cap periods and `reimbursement_percentage` were all unexercised.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
	entryCapRefusal,
	reimbursable,
	resolveEntryCap
} from '../src/collections/payroll_runs/lib/entry-cap.ts';
import type { PersonContext } from '../src/collections/payroll_runs/lib/eligibility.ts';

const PERSON: PersonContext = {
	employee: { gender: 'FEMALE', age: 34, citizenship: 'MY' },
	employment: { type: 'PERMANENT', classification: 'EA_COVERED', service_months: 40, hire_date: '2022-01-01' },
	terms: { basic_salary: 3451, workman: false, department: 'OPS', payroll_group: 'HQ' },
	children: { count: 0, ages: [] }
};

const COMPONENT = 'component-1';
const EMPLOYMENT = 'employment-1';

const layer = (over: Record<string, unknown> = {}) => ({
	level: 'ORGANISATION',
	effective_range: { start: '2020-01-01', end: null },
	eligibility: '',
	reimbursement_percentage: 100,
	award: { kind: 'FIXED', amount: 1000 },
	...over
});

const cap = (over: Record<string, unknown> = {}) =>
	({
		period: 'CALENDAR_YEAR',
		matrix: { merge: 'MAX_WITH_COMPANY_LAYERS', layers: [layer()] },
		on_exceed: 'BLOCK',
		...over
	}) as never;

const entry = (id: string, amount: number, date: string) => ({
	id,
	component_catalogue_id: COMPONENT,
	amount,
	date
});

const resolve = (over: Record<string, unknown> = {}) =>
	resolveEntryCap({
		cap: cap(),
		componentId: COMPONENT,
		employmentId: EMPLOYMENT,
		entry: entry('e2', 400, '2026-06-01'),
		eventDate: '2026-06-01',
		siblings: [],
		eventDateOf: (row) => row.date,
		signOf: () => 1,
		subject: PERSON,
		evaluateAward: (row) => (row.award.kind === 'FIXED' ? row.award.amount : null),
		...over
	} as never);

test('the ceiling is the highest layer that applies to this person on this day', () => {
	const resolved = resolve({
		cap: cap({
			matrix: {
				merge: 'MAX_WITH_COMPANY_LAYERS',
				layers: [
					layer({ award: { kind: 'FIXED', amount: 1000 } }),
					// A richer employee-level layer for this very employment: the merge takes the max.
					layer({ level: 'EMPLOYEE', employment_id: EMPLOYMENT, award: { kind: 'FIXED', amount: 2500 } }),
					// And one for somebody else, which must not raise this person's ceiling.
					layer({ level: 'EMPLOYEE', employment_id: 'someone-else', award: { kind: 'FIXED', amount: 9999 } })
				]
			}
		})
	});
	assert.equal(resolved?.amount, 2500);
});

test('a layer out of date, or one the person is not eligible for, does not apply', () => {
	const expired = resolve({
		cap: cap({
			matrix: {
				merge: 'MAX_WITH_COMPANY_LAYERS',
				layers: [layer({ effective_range: { start: '2020-01-01', end: '2021-12-31' } })]
			}
		})
	});
	assert.equal(expired, null, 'no layer covers the day, so there is no ceiling to state');

	const ineligible = resolve({
		cap: cap({
			matrix: {
				merge: 'MAX_WITH_COMPANY_LAYERS',
				layers: [layer({ eligibility: "employee.gender == 'MALE'" })]
			}
		})
	});
	assert.equal(ineligible, null);
	// The same layer for somebody it does cover.
	const eligible = resolveEntryCap({
		cap: cap({
			matrix: {
				merge: 'MAX_WITH_COMPANY_LAYERS',
				layers: [layer({ eligibility: "employee.gender == 'MALE'" })]
			}
		}),
		componentId: COMPONENT,
		employmentId: EMPLOYMENT,
		entry: entry('e2', 400, '2026-06-01'),
		eventDate: '2026-06-01',
		siblings: [],
		eventDateOf: (row) => row.date,
		signOf: () => 1,
		subject: { ...PERSON, employee: { ...PERSON.employee, gender: 'MALE' } },
		evaluateAward: (row) => (row.award.kind === 'FIXED' ? row.award.amount : null)
	} as never);
	assert.equal(eligible?.amount, 1000);
});

/**
 * An applicable layer nobody can price makes the whole ceiling unknowable.
 *
 * The merge takes the highest layer, so dropping the one that cannot be evaluated would understate
 * the ceiling and refuse an entry that is actually within it. The write hook relies on exactly
 * this: it answers `null` for a `FORMULA` layer and the cap then falls to the run, which is the
 * only place a payslip-dependent number exists.
 */
test('a cap with an unpriceable applicable layer states no ceiling at all', () => {
	const resolved = resolve({
		cap: cap({
			matrix: {
				merge: 'MAX_WITH_COMPANY_LAYERS',
				layers: [
					layer({ award: { kind: 'FIXED', amount: 1000 } }),
					layer({ award: { kind: 'FORMULA', expr: 'terms.basic_salary * 2' } })
				]
			}
		})
	});
	assert.equal(resolved, null);
	// …but a formula layer that does not apply cannot make the rest unknowable.
	const stillKnown = resolve({
		cap: cap({
			matrix: {
				merge: 'MAX_WITH_COMPANY_LAYERS',
				layers: [
					layer({ award: { kind: 'FIXED', amount: 1000 } }),
					layer({
						eligibility: "employee.gender == 'MALE'",
						award: { kind: 'FORMULA', expr: 'terms.basic_salary * 2' }
					})
				]
			}
		})
	});
	assert.equal(stillKnown?.amount, 1000);
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
	const spentUnder = (period: string) =>
		resolve({ cap: cap({ period }), siblings })?.exceededBy;
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

test('a reimbursement share below a hundred is what counts against the ceiling', () => {
	const resolved = resolve({
		cap: cap({
			matrix: {
				merge: 'MAX_WITH_COMPANY_LAYERS',
				layers: [layer({ reimbursement_percentage: 80 })]
			}
		}),
		siblings: [entry('e0', 500, '2026-01-10')]
	});
	assert.equal(resolved?.percentage, 80);
	assert.equal(resolved?.exceededBy, 400, 'eighty per cent of the five hundred already claimed');
	assert.equal(reimbursable(500, resolved!), 400);
});

test('a BLOCK cap refuses by name once the ceiling is passed, and not before', () => {
	const resolved = { amount: 1000, percentage: 100, exceededBy: 800 };
	assert.equal(
		entryCapRefusal({ cap: cap(), resolved, componentCode: 'MEDICAL', subject: 'PUB-EMP-0001', proposed: 200 }),
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
			resolved: { amount: 1000, percentage: 100, exceededBy: 5000 },
			componentCode: 'MEDICAL',
			subject: 'PUB-EMP-0001',
			proposed: 5000
		}),
		null
	);
});
