/**
 * A pay line's entitlement ceiling, refused when the request is written.
 *
 * Before this the cap existed only inside MEASURE: a twelfth claim against an annual limit of ten
 * was accepted, sat in the workspace, and took down the whole company's payroll run weeks later.
 * The refusal named the run, not the entry, and reached somebody who was not the person who made
 * the mistake at a moment when it could no longer be corrected cheaply.
 *
 * `resolveEntryLimit` is one rule with two callers — MEASURE and the write hook — so this file
 * covers the arithmetic once: the capped period, sibling usage, and BLOCK against ALLOW. Which band
 * is the person's is the catalogue band table's job now; `family-cap-history.test.ts` covers the
 * hook and the run consuming it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
	entryLimitRefusal,
	resolveEntryLimit,
	type LimitSibling
} from '../src/collections/payroll_runs/lib/entry-cap.ts';

const COMPONENT = { family: 'CLAIM', code: 'MEDICAL' };
const EMPLOYMENT = 'employment-1';

const limit = (over: Record<string, unknown> = {}) =>
	({
		period: 'CALENDAR_YEAR',
		on_exceed: 'BLOCK',
		amount: 1000,
		...over
	}) as never;

const entry = (id: string, amount: number, date: string): LimitSibling => ({
	id,
	employment_id: EMPLOYMENT,
	event_date: date,
	amount
});

const resolve = (over: Record<string, unknown> = {}) =>
	resolveEntryLimit({
		limit: limit(),
		limitAmount: 1000,
		entryId: 'e2',
		employmentId: EMPLOYMENT,
		eventDate: '2026-06-01',
		siblings: [],
		...over
	} as never);

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
		resolve({ limit: limit({ period }), siblings })?.exceededBy;
	assert.equal(spentUnder('CALENDAR_YEAR'), 300, 'January counts; the later June entry does not');
	assert.equal(spentUnder('MONTH'), 0, 'January is a different month');
	assert.equal(spentUnder('LIFETIME'), 300, 'every earlier entry, whatever its year');
	assert.equal(spentUnder('PER_EVENT'), 0, 'each event stands alone, so nothing is ever spent');
});

test('two entries on one day break their tie by id, so neither refuses the other', () => {
	// Without a total order both would count the other as "already spent" and each would refuse.
	const sameDay = [entry('e1', 400, '2026-06-01'), entry('e2', 400, '2026-06-01')];
	assert.equal(resolve({ siblings: sameDay })?.exceededBy, 400, 'e2 sees e1 before it');
	const first = resolve({ entryId: 'e1', siblings: sameDay });
	assert.equal(first?.exceededBy, 0, 'and e1 sees nothing before it');
});

test('a BLOCK cap refuses by name once the ceiling is passed, and not before', () => {
	const resolved = { amount: 1000, exceededBy: 800 };
	assert.equal(
		entryLimitRefusal({
			limit: limit(),
			resolved,
			componentCode: 'MEDICAL',
			subject: 'PUB-EMP-0001',
			proposed: 200
		}),
		null,
		'exactly the ceiling is within it'
	);
	const refusal = entryLimitRefusal({
		limit: limit(),
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
		entryLimitRefusal({
			limit: limit({ on_exceed: 'ALLOW' }),
			resolved: { amount: 1000, exceededBy: 5000 },
			componentCode: 'MEDICAL',
			subject: 'PUB-EMP-0001',
			proposed: 5000
		}),
		null
	);
});
