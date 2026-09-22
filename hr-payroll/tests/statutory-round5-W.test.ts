import assert from 'node:assert/strict';
import test from 'node:test';
import { planLeaveActivity } from '../src/lib/leave/activity.ts';
import { leaveRules, type LeaveContext } from '../src/lib/leave/context.ts';
import type { LeaveActivity } from '../src/lib/leave/pending.ts';
import { refusalMessage } from './fixtures/memory-payroll-api.ts';
import { leaveCatalogue } from './fixtures/statutory-world.ts';
import { id, leaveContext, submission, timeOff } from './helpers/manual-leave-context.ts';

// Singapore family leave, Child Development Co-Savings Act 2001 (SSO informal consolidation in force
// from 15/10/2024, archived at https://web.archive.org/web/20250121024936/https://sso.agc.gov.sg/Act/
// CDCSA2001?ValidDate=20241015&ViewType=Pdf; unchanged since for these sections — MOM "Childcare
// leave eligibility and entitlement", last updated 24 August 2026, announces the NDR 2026 increase
// with "implementation date … released at a later stage").
//
// s.12B(1): an employee who "has served an employer for a period of not less than 3 months" and "has
// any child who is below 7 years of age and who is, or who becomes, a qualifying child, at any time
// during any relevant period" gets, for that period, 2 days if they serve "less than 5 months during
// that relevant period", 3 for 5 to under 7, 4 for 7 to under 9, 5 for 9 to under 11, 6 for 11 or
// more. s.12B(1A): 2 days of extended childcare leave for a child "of or above 7 … but below 13".
// s.12B(2)(a): no more than 42 days of childcare leave and 12 of extended childcare leave for any
// child, and "a combined total of 6 days … during any relevant period". EA s.87A: 2 days for a
// non-citizen child under 7, 14 a child, "cannot be pro-rated" (MOM "Pro-rated childcare leave").
// s.12D(1): 12 days of unpaid infant care leave for a period in which a citizen child is below 2 at
// any time; s.12D(2)(a): no more than 24 days for any child.

const CHILDCARE = id(27);
const INFANT = id(28);
const YEAR = { start: '2026-01-01', end: '2026-12-31' };

/** The SG rows of every sealed version, each in turn as the fixture's only version. */
const versions = [...new Set(leaveCatalogue('SG').map((row) => row.settings_id as string))].map(
	(settingsId) => leaveCatalogue('SG').filter((row) => row.settings_id === settingsId)
);

type Child = {
	readonly born: string;
	readonly citizen?: boolean;
	readonly prior?: number;
	readonly priorExtended?: number;
	readonly priorInfant?: number;
};

function sgContext(
	rows: ReturnType<typeof leaveCatalogue>,
	options: { hire?: string; exit?: string | null; children: readonly Child[] }
): LeaveContext {
	const context = leaveContext();
	const range = { start: options.hire ?? '2019-01-01', end: options.exit ?? null };
	const always = { start: '2015-01-01', end: null };
	context.employments[0]!.effective_range = range;
	context.terms[0]!.effective_range = range;
	context.versions[0]!.effective_range = always;
	context.versions[0]!.sealed_at = always.start;
	context.patterns[0]!.effective_range = always;
	context.shifts[0]!.effective_range = always;
	context.employees[0]!.children = options.children.map((child) => ({
		child_birthdate: child.born,
		relationship: 'CHILD',
		effective_range: null,
		citizenship: child.citizen === false ? 'FOREIGNER' : 'CITIZEN',
		...(child.prior == null ? {} : { prior_childcare_days: child.prior }),
		...(child.priorExtended == null ? {} : { prior_extended_childcare_days: child.priorExtended }),
		...(child.priorInfant == null ? {} : { prior_infant_care_days: child.priorInfant })
	})) as never;
	for (const [catalogueId, code] of [
		[CHILDCARE, 'CHILDCARE_LEAVE'],
		[INFANT, 'UNPAID_INFANT_CARE_LEAVE']
	] as const) {
		const row = rows.find((entry) => entry.code === code)!;
		context.catalogues.push({
			id: catalogueId,
			settings_id: id(6),
			code,
			name: row.name,
			is_npl: row.is_npl,
			can_encash: false,
			evidence_after_days: null,
			eligibility: row.eligibility,
			entitlement: row.entitlement
		} as never);
	}
	return context;
}

const childcare = (context: LeaveContext, asOf: string, window = YEAR) =>
	leaveRules(context, id(1), CHILDCARE).entitlementAt(window, asOf).entitlement;

let serial = 100;
/** Plans a request; '' when it fits, else the refusal. Approved (kept) when `keep`. */
function book(context: LeaveContext, catalogueId: string, from: string, to = from, keep = false) {
	serial += 1;
	try {
		const plan = planLeaveActivity(
			context,
			{ ...submission(timeOff(from, to), `W-${serial}`), catalogue_id: catalogueId },
			id(serial)
		);
		if (keep) context.entries.push({ ...plan, id: id(serial), approval_id: null } as LeaveActivity);
		return '';
	} catch (error) {
		return refusalMessage(error);
	}
}

const CITIZEN_3 = { born: '2023-05-10' } as const; // three in 2026, under 7 all year

test('W1 SG s.12B(1): a joiner’s childcare leave follows the months served in the year — every version', () => {
	for (const rows of versions) {
		const joiner = (hire: string) =>
			childcare(sgContext(rows, { hire, children: [CITIZEN_3] }), '2026-12-31');
		// 15 Mar → 14 Dec is 9 completed months (15 Dec–31 Dec is not a month): 9 ≤ m < 11 → 5.
		assert.equal(joiner('2026-03-15'), 5);
		// 1 Feb → 31 Dec: 11 months → 6.
		assert.equal(joiner('2026-02-01'), 6);
		// 20 Jan → 19 Dec: 11 completed months → 6.
		assert.equal(joiner('2026-01-20'), 6);
		// 1 Jun → 31 Dec: 7 → 7 ≤ m < 9 → 4.
		assert.equal(joiner('2026-06-01'), 4);
		// 1 Aug → 31 Dec: 5 → 5 ≤ m < 7 → 3.
		assert.equal(joiner('2026-08-01'), 3);
		// 1 Sep → 31 Dec: 4 → under 5 → 2.
		assert.equal(joiner('2026-09-01'), 2);
		// 15 Sep → 14 Dec: 3 completed months, qualifying on 15 Dec → under 5 → 2.
		assert.equal(joiner('2026-09-15'), 2);
		// 1 Oct → 31 Dec: 3 months served, completed only as 31 Dec closes: MOM "3 → 2" — the year's
		// 2 days are earned, though the qualifying period leaves no day to take them in.
		assert.equal(joiner('2026-10-01'), 2);
		assert.notEqual(
			book(sgContext(rows, { hire: '2026-10-01', children: [CITIZEN_3] }), CHILDCARE, '2026-12-31'),
			''
		);
		// 1 Nov → 31 Dec: 2 months — never 3 months' service in the year: nothing (MOM: "2 Not eligible").
		assert.equal(joiner('2026-11-01'), 0);
		// A joiner's grant is the year's from the start: asked in June, the 15 March hire holds 5.
		assert.equal(
			childcare(sgContext(rows, { hire: '2026-03-15', children: [CITIZEN_3] }), '2026-06-30'),
			5
		);
	}
});

test('W2 SG s.12B(1): a leaver’s childcare leave follows the months served in the year of leaving — every version', () => {
	for (const rows of versions) {
		const leaver = (exit: string) =>
			childcare(sgContext(rows, { exit, children: [CITIZEN_3] }), exit);
		// MOM's own example: "resigned … on 15 March … based on 2 months (January and February) …
		// entitled to 2 days" — under 5 months → 2.
		assert.equal(leaver('2026-03-15'), 2);
		// Jan–Aug: 8 → 7 ≤ m < 9 → 4.
		assert.equal(leaver('2026-08-31'), 4);
		// Jan–Oct 30: 9 complete months (October ends on the 31st) → 5.
		assert.equal(leaver('2026-10-30'), 5);
		// Jan–Nov: 11 → 6.
		assert.equal(leaver('2026-11-30'), 6);
	}
});

test('W3 SG EA s.87A and s.12B(1A): the two-day grants are never prorated — every version', () => {
	for (const rows of versions) {
		// A non-citizen child of three: EA s.87A, 2 days. A 1 June joiner's 7 months would prorate
		// 2 × 7/12 = 1.17 → 1; MOM: "the 2 days … cannot be pro-rated" → 2.
		const foreign = { born: '2023-05-10', citizen: false };
		assert.equal(
			childcare(sgContext(rows, { hire: '2026-06-01', children: [foreign] }), '2026-12-31'),
			2
		);
		// A citizen child of nine: extended childcare, 2 days; the 1 June joiner still holds 2
		// (MOM: "Extended childcare leave are not pro-rated").
		const nine = { born: '2017-03-01' };
		assert.equal(
			childcare(sgContext(rows, { hire: '2026-06-01', children: [nine] }), '2026-12-31'),
			2
		);
		// A leaver in March with the same child: 2.
		assert.equal(
			childcare(sgContext(rows, { exit: '2026-03-15', children: [nine] }), '2026-03-15'),
			2
		);
	}
});

test('W4 SG s.12B(1)(b): a child below 7 at any time in the year keeps the year’s six — every version', () => {
	for (const rows of versions) {
		// Born 1 Aug 2019: seven on 1 Aug 2026, so below 7 at a time during 2026 → 6 for all of 2026,
		// asked after the birthday too.
		const seven = sgContext(rows, { children: [{ born: '2019-08-01' }] });
		assert.equal(childcare(seven, '2026-10-01'), 6);
		// A day after the birthday is still childcare leave (the fixture works every day).
		assert.equal(book(seven, CHILDCARE, '2026-09-01', '2026-09-06'), '');
		// 2027: seven all year, citizen, under 13 → extended childcare, 2.
		assert.equal(childcare(seven, '2027-06-01', { start: '2027-01-01', end: '2027-12-31' }), 2);
		// A child born on 1 September 2026 to a parent whose other child is nine: the newborn is
		// below 7 during 2026, so the year is six, not the nine-year-old's two plus six (s.12B(2)(a)(iii)).
		const newborn = sgContext(rows, { children: [{ born: '2017-03-01' }, { born: '2026-09-01' }] });
		assert.equal(childcare(newborn, '2026-12-31'), 6);
	}
});

test('W5 SG s.12B(1)(a): the three months’ service still bars the first days — every version', () => {
	for (const rows of versions) {
		// Hired 5 January 2026 with a citizen child of three: 5 Jan → 4 Dec is 11 months → 6 for the
		// year, but none of it before three months are served.
		const context = sgContext(rows, { hire: '2026-01-05', children: [CITIZEN_3] });
		assert.equal(childcare(context, '2026-12-31'), 6);
		assert.notEqual(book(context, CHILDCARE, '2026-03-02'), '');
		assert.equal(book(context, CHILDCARE, '2026-04-10'), '');
	}
});

test('W6 SG s.12B(2)(a): 42 childcare and 12 extended childcare days for each child, earlier employers included — every version', () => {
	for (const rows of versions) {
		// A citizen child of nine (born 1 Mar 2017: 8 on 1 Jan 2026, 9 on 31 Dec) with 42 childcare
		// and 10 extended days declared at earlier employers: only the extended cap reaches 2026,
		// room 12 − 10 = 2. Three days refused; two fit.
		const nine = () =>
			sgContext(rows, { children: [{ born: '2017-03-01', prior: 42, priorExtended: 10 }] });
		assert.match(
			book(nine(), CHILDCARE, '2026-03-02', '2026-03-04'),
			/granted for 2 days in a lifetime; 0 are already taken and this would add 3/
		);
		assert.equal(book(nine(), CHILDCARE, '2026-03-02', '2026-03-03'), '');
		// With nothing declared the year's two bind, not the 12: a third day is refused by the pool.
		const plain = sgContext(rows, { children: [{ born: '2017-03-01' }] });
		assert.equal(book(plain, CHILDCARE, '2026-03-02', '2026-03-03', true), '');
		assert.notEqual(book(plain, CHILDCARE, '2026-03-04'), '');
		// Two citizen children: a fourteen-year-old (born 15 Jan 2012) who never had a day, and a
		// three-year-old with 40 declared. Summed over the children the room was 42 × 2 + 12 − 40 = 56;
		// each child's own: the fourteen-year-old is past 12 all 2026, so only the younger child's
		// 42 − 40 = 2 is reachable. Three days refused, two fit.
		const pair = () =>
			sgContext(rows, { children: [{ born: '2012-01-15' }, { ...CITIZEN_3, prior: 40 }] });
		assert.match(
			book(pair(), CHILDCARE, '2026-03-02', '2026-03-04'),
			/granted for 2 days in a lifetime; 0 are already taken and this would add 3/
		);
		assert.equal(book(pair(), CHILDCARE, '2026-03-02', '2026-03-03'), '');
		// Two children under 7, the elder (born 1 Feb 2021) with 40 declared and the younger with none:
		// a day goes on whichever child has room, so the year's six fit (2 + 42 ≥ 6).
		assert.equal(
			book(
				sgContext(rows, { children: [{ born: '2021-02-01', prior: 40 }, CITIZEN_3] }),
				CHILDCARE,
				'2026-03-02',
				'2026-03-07'
			),
			''
		);
	}
});

test('W7 SG s.12D: infant care leave is the whole year’s 12, and 24 days a child — every version', () => {
	for (const rows of versions) {
		// Born 1 March 2025: two on 1 March 2027, so below 2 at a time in 2025, 2026 and 2027.
		const context = sgContext(rows, { hire: '2024-01-01', children: [{ born: '2025-03-01' }] });
		const window2027 = { start: '2027-01-01', end: '2027-12-31' };
		assert.equal(
			leaveRules(context, id(1), INFANT).entitlementAt(window2027, '2027-06-01').entitlement,
			12
		);
		// 20 infant care days declared at earlier employers for this child: room 24 − 20 = 4 — five
		// days in June 2026 refused, four fit.
		const declared = () =>
			sgContext(rows, { hire: '2024-01-01', children: [{ born: '2025-03-01', priorInfant: 20 }] });
		assert.match(
			book(declared(), INFANT, '2026-06-01', '2026-06-05'),
			/granted for 4 days in a lifetime; 0 are already taken and this would add 5/
		);
		assert.equal(book(declared(), INFANT, '2026-06-01', '2026-06-04'), '');
		// June 2027 is after the second birthday, yet inside a year the child was below 2 in.
		assert.equal(book(context, INFANT, '2027-06-01'), '');
		// 12 in June 2025 and 12 in June 2026 exhaust the child's 24: a June 2027 day — in a year the
		// child was below 2, so otherwise open — is refused by the lifetime cap.
		assert.equal(book(context, INFANT, '2025-06-02', '2025-06-13', true), '');
		assert.equal(book(context, INFANT, '2026-06-01', '2026-06-12', true), '');
		assert.match(
			book(context, INFANT, '2027-06-01'),
			/granted for 24 days in a lifetime; 24 are already taken and this would add 1/
		);
	}
});
