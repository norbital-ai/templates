/**
 * Statutory leave entitlements, per jurisdiction, against the law the template publishes.
 *
 * Same contract as `statutory-golden.test.ts`: the rows are the public seed's own
 * `leave_catalogue` JSON under `seed/jurisdiction/<CODE>/`, and every expected number is derived
 * from those rows by the lineage's own vetting report. The law is the expectation;
 * `computedEntitlement` is what is being measured.
 *
 * Each lineage is asked for its statutory leaves at three service lengths — 3, 30 and 70 completed
 * months — and for the predicate cases the bands actually turn on: gender, marital status, solo
 * parenthood, citizenship, employment classification and the ages of the children.
 *
 * `terms.grade` is a context member no seeded leave band uses in any of the seven lineages, so
 * there is no grade case to assert: `employment.classification` (Vietnam's ARDUOUS cohorts, the
 * Philippine managerial exclusion) is the cohort axis the bank actually seeds, and it is covered.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { computedEntitlement, grantedDays, leaveWindowOf } from '../src/lib/leave/entitlement.ts';
import { inclusiveDays, monthsEnd } from '../src/lib/payroll/run/dates.ts';
import { planLeaveActivity } from '../src/lib/leave/activity.ts';
import type { LeaveEntitlement } from '../src/lib/datatypes/leave_entitlement.ts';
import { id, leaveContext, submission, timeOff } from './helpers/manual-leave-context.ts';
import {
	evaluateNumberOver,
	isEligible,
	personContext
} from '../src/lib/payroll/run/eligibility.ts';
import {
	LINEAGES,
	contributionSchemes,
	leaveCatalogue,
	settingsVersions,
	type Lineage
} from './fixtures/statutory-world.ts';

/**
 * Every `(lineage, sealed version)` this file actually asserted against, recorded as it goes.
 *
 * The goldens below name their versions in prose — "on all three sealed versions" — which is true
 * of the versions that existed when each was written and says nothing about a version sealed
 * afterwards. A new sealed version is a new law in force, and a law in force with no golden is the
 * one case this file exists to prevent. The completeness test at the foot of the file reads this.
 */
const asserted = new Set<string>();

/** The facts a seeded leave row or entitlement band can read about a person. */
type Facts = {
	readonly gender?: string;
	readonly marital_status?: string;
	readonly citizenship?: string;
	readonly solo_parent?: boolean;
	/** `employment.classification` — Vietnam's arduous-work cohorts, the Philippine exclusion. */
	readonly classification?: string;
	/** `employment.type` — a domestic employee outside the Malaysian Act's leave. */
	readonly employment_type?: string;
	/** `terms.statutory_work_category` — field personnel outside the Philippine SIL. */
	readonly statutory_work_category?: string;
	/** `employee.disabled` — Vietnam's fourteen days. */
	readonly disabled?: boolean;
	/** Completed years of each child on the entitlement date; `children.under(n)` counts these. */
	readonly childAges?: readonly number[];
	/** Each recorded child's citizenship, in `childAges` order; absent is unrecorded. */
	readonly childCitizenship?: readonly (string | null)[];
	/** The shared parental weeks this parent takes for each child, in `childAges` order. */
	readonly childSharedWeeks?: readonly (number | null)[];
	/** Statutory facts on the person root, by scheme code (`facts.SSS.since_months`). */
	readonly registrations?: ReadonlyArray<{ readonly code: string; readonly since: string }>;
	/** The event a PER_EVENT row is asked for: what happened, to whom, which child, when. */
	readonly event?: {
		readonly kind?: string;
		readonly relationship?: string;
		readonly child_index?: number;
		readonly wife_prior_living_biological_children?: number;
		readonly date?: string;
		/** The event's benefit case facts (`event.case.facts`), as its case type resolves them. */
		readonly case?: { readonly facts: Readonly<Record<string, string | number | boolean>> };
	};
	/**
	 * Completed years of age. It defaults to 40 rather than being left unrecorded, because an
	 * unrecorded birth date reads as `employee.age == 0` and Vietnam's `employee.age < 18` minor
	 * band would then claim every person the fixture did not think to age.
	 */
	readonly age?: number;
	/** The measured working week (`terms.ordinary_hours_per_week`, `terms.working_days_per_week`). */
	readonly week?: {
		readonly ordinary_hours_per_week: number;
		readonly working_days_per_week: number;
	};
	/** Lineage-declared terms facts (`terms.facts.<key>`). */
	readonly termsFacts?: Readonly<Record<string, number>>;
};

/**
 * A hire date and a query date that put the person on exactly `months` of service **without**
 * proration entering the answer.
 *
 * `computedEntitlement` prorates a grant by the part of the annual window the employment covers, so
 * the hire has to fall on or before the window's own start for the fraction to be one — which is
 * why the three-month case is hired on 1 January and asked in April rather than hired in April.
 * Every seeded row runs a January-to-December window bar none, and a row on a fiscal year would
 * still be covered: its window starts after these hire dates too.
 */
const AT: Readonly<Record<number, { readonly hire: string; readonly asOf: string }>> = {
	3: { hire: '2026-01-01', asOf: '2026-04-01' },
	30: { hire: '2024-01-01', asOf: '2026-07-01' },
	70: { hire: '2020-09-01', asOf: '2026-07-01' }
};

/** A birth date landing on exactly `years` completed years at `asOf`. */
const bornFor = (years: number, asOf: string): string =>
	`${Number(asOf.slice(0, 4)) - years}${asOf.slice(4)}`;

/**
 * The days that lineage version's `code` row grants a person of `months` service, or `null` when
 * the row's own eligibility puts them outside the leave entirely — the same two answers the bank's
 * `grant()` helper gives. `null` for an `UNLIMITED` row is the engine's own "not metered".
 */
function grant(
	lineage: Lineage,
	version: number,
	code: string,
	months: keyof typeof AT,
	facts: Facts = {}
): number | null {
	// Sealed versions in force order. Their ids are uuid v5 and sort into no useful order at all,
	// so the timeline is the only ordering: version 0 is the earliest sealed version of the lineage.
	const settingsId = settingsVersions(lineage)
		.toSorted((left, right) =>
			String(left.effective_range.start).localeCompare(String(right.effective_range.start))
		)
		.map((row) => row.id as string)[version];
	assert.ok(settingsId, `${lineage} has no leave rows for version ${version}`);
	asserted.add(`${lineage}:${settingsId}`);
	const row = leaveCatalogue(lineage).find(
		(candidate) => candidate.settings_id === settingsId && candidate.code === code
	);
	assert.ok(row, `${lineage} version ${version} has no ${code} row`);

	const { hire, asOf } = AT[months]!;
	const personOn = (date: string) =>
		personContext({
			employee: {
				gender: facts.gender ?? null,
				date_of_birth: bornFor(facts.age ?? 40, asOf),
				marital_status: facts.marital_status ?? null,
				solo_parent: facts.solo_parent ?? null,
				disabled: facts.disabled ?? null
			},
			employment: { service_start: hire },
			terms: {
				residency_status: facts.citizenship ?? null,
				work_classification: facts.classification ?? null,
				employment_type: facts.employment_type ?? null,
				statutory_work_category: facts.statutory_work_category ?? null,
				facts: facts.termsFacts ?? null
			},
			week: facts.week ?? null,
			children: (facts.childAges ?? []).map((age, index) => ({
				child_birthdate: bornFor(age, asOf),
				citizenship: facts.childCitizenship?.[index] ?? null,
				shared_parental_weeks: facts.childSharedWeeks?.[index] ?? null
			})),
			event: facts.event == null ? null : { date: asOf, ...facts.event },
			facts: [
				...contributionSchemes(lineage).map((scheme) => ({
					code: scheme.code,
					registered: false,
					since: null
				})),
				...(facts.registrations ?? []).map((row) => ({
					code: row.code,
					registered: true,
					since: row.since
				}))
			],
			asOf: date
		});
	if (!isEligible(row.eligibility, personOn(asOf))) return null;
	// A per-event row is no annual pool: the grant is what its bands say for this event.
	if (row.entitlement.availability === 'PER_EVENT')
		return grantedDays(row.entitlement, personOn(asOf));
	return computedEntitlement({
		rule: row.entitlement,
		window: leaveWindowOf(asOf, row.entitlement, hire),
		asOf,
		hireDate: hire,
		exitDate: null,
		servedOn: () => true,
		eligibleOn: () => true,
		personOn
	}).entitlement;
}

/** The service ladder of one row, as `[3 months, 30 months, 70 months]`. */
const ladder = (lineage: Lineage, version: number, code: string, facts: Facts = {}) =>
	([3, 30, 70] as const).map((months) => grant(lineage, version, code, months, facts));

const FEMALE = { gender: 'FEMALE' } as const;
const MALE = { gender: 'MALE' } as const;
const MARRIED_MALE = { gender: 'MALE', marital_status: 'MARRIED' } as const;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Malaysia, and Nihon Pigment's fork of it — Employment Act 1955 ss.60E, 60F, 37 and 60FA.
// Both lineages carry six active sealed versions (SKBBK phases from 2028-06-01 and 2031-06-01 change no
// leave row) and the leave ladder does not move across any seam.
// ─────────────────────────────────────────────────────────────────────────────────────────────

for (const lineage of ['MY'] as const)
	test(`${lineage} — the Employment Act leave ladders, on every sealed version`, () => {
		for (const version of settingsVersions(lineage).keys()) {
			// s.60E(1): eight days under two years, twelve under five, sixteen at five or more.
			assert.deepEqual(ladder(lineage, version, 'ANNUAL_LEAVE'), [8, 12, 16]);
			// s.60F(1)(aa): fourteen, eighteen and twenty-two on the same two-year and five-year steps.
			assert.deepEqual(ladder(lineage, version, 'MEDICAL_LEAVE'), [14, 18, 22]);
			// s.60F(1)(bb): sixty days of hospitalisation, in addition to (aa), from day one.
			assert.deepEqual(ladder(lineage, version, 'HOSPITALIZATION_LEAVE'), [60, 60, 60]);
			// s.37(1): ninety-eight consecutive days per confinement (the entry names the birth), and
			// the row is confined to a female employee.
			const BIRTH = { kind: 'BIRTH' } as const;
			assert.deepEqual(
				ladder(lineage, version, 'MATERNITY_LEAVE', { ...FEMALE, event: BIRTH }),
				[98, 98, 98]
			);
			assert.deepEqual(ladder(lineage, version, 'MATERNITY_LEAVE', { ...MALE, event: BIRTH }), [
				null,
				null,
				null
			]);
			// s.60FA(1) with (3)(a): seven days per confinement, a married male employee, twelve
			// months' service — so the three-month case is outside the row, not on a zero band.
			assert.deepEqual(
				ladder(lineage, version, 'PATERNITY_LEAVE', { ...MARRIED_MALE, event: BIRTH }),
				[null, 7, 7]
			);
			// An unmarried father is outside it at every service length.
			assert.deepEqual(ladder(lineage, version, 'PATERNITY_LEAVE', { ...MALE, event: BIRTH }), [
				null,
				null,
				null
			]);
			// s.37(2)(a): ninety days with this employer in the nine months before confinement,
			// plus some employment in the four months before it. The charged day cannot move either window.
			const maternity = leaveCatalogue(lineage).find(
				(row) =>
					row.settings_id === settingsVersions(lineage)[version]!.id &&
					row.code === 'MATERNITY_LEAVE'
			)!;
			const fractionAfter = (days: number) =>
				evaluateNumberOver(maternity.pay_fraction ?? '', {
					...personContext({
						employee: {
							gender: 'FEMALE',
							date_of_birth: '1990-01-01',
							marital_status: null,
							solo_parent: null,
							disabled: null
						},
						employment: { service_start: days === 90 ? '2026-01-01' : '2026-01-02' },
						servicePeriods: [{ start: days === 90 ? '2026-01-01' : '2026-01-02', end: null }],
						terms: {
							residency_status: 'CITIZEN',
							work_classification: 'EA_COVERED',
							employment_type: 'PERMANENT',
							statutory_work_category: null
						},
						children: [],
						event: { ...BIRTH, date: '2026-04-01' },
						facts: [],
						asOf: '2026-05-03'
					}),
					leave: { month_index: 1, day_index: 1, days: 98 }
				});
			assert.equal(fractionAfter(90), 1);
			assert.equal(fractionAfter(89), 0);
			// First Schedule para 2(5): a domestic employee is outside ss.60E, 60F and 60FA.
			assert.deepEqual(
				ladder(lineage, version, 'ANNUAL_LEAVE', {
					classification: 'EA_COVERED',
					employment_type: 'DOMESTIC'
				}),
				[null, null, null]
			);
		}
	});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Philippines — Labor Code art.95; RA 11210, RA 8187, RA 8972 as amended by RA 11861, RA 9262,
// RA 9710. One sealed version.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('Philippines — service incentive leave and the special statutory leaves', () => {
	// No sealed version changes the leave law: the same ladder on every one (each is a wage order,
	// RR 29-2025 or a withholding correction — none a leave row).
	const BIRTH = { kind: 'BIRTH' } as const;
	for (const version of settingsVersions('PH').keys()) {
		assert.deepEqual(ladder('PH', version, 'ANNUAL_LEAVE'), [0, 5, 5]);
		// RA 10361 s.29: a kasambahay has the five days on their own row, never encashed.
		assert.deepEqual(ladder('PH', version, 'ANNUAL_LEAVE', { employment_type: 'DOMESTIC' }), [
			null,
			null,
			null
		]);
		assert.deepEqual(
			ladder('PH', version, 'ANNUAL_LEAVE_DOMESTIC', { employment_type: 'DOMESTIC' }),
			[0, 5, 5]
		);
		assert.deepEqual(
			ladder('PH', version, 'PATERNITY_LEAVE', { ...MARRIED_MALE, event: BIRTH }),
			[7, 7, 7]
		);
	}
	// Handbook ch.7 §B: no service incentive leave for field personnel or in an establishment of
	// fewer than ten.
	assert.deepEqual(
		ladder('PH', 0, 'ANNUAL_LEAVE', { statutory_work_category: 'FIELD_PERSONNEL' }),
		[null, null, null]
	);
	// art.95: five days after one year. Below that no band matches at all, which the engine reports
	// as nought days rather than as an absent entitlement.
	assert.deepEqual(ladder('PH', 0, 'ANNUAL_LEAVE'), [0, 5, 5]);
	// The row excludes managerial staff outright, whatever the service.
	assert.deepEqual(ladder('PH', 0, 'ANNUAL_LEAVE', { classification: 'MANAGERIAL' }), [
		null,
		null,
		null
	]);
	// RA 11210: 105 days per birth, 120 for a qualified solo parent — the most specific band is
	// first — and 60 for a miscarriage or emergency termination. SSS contributions qualify the
	// cash benefit, not the private-sector leave entitlement (RA 11210 s.5). The solo parent is the
	// birth's benefit case proving it (`event.case.facts`), not the employee's current flag.
	const SSS = { registrations: [{ code: 'SSS', since: '2020-01-01' }] } as const;
	const DOCUMENTED = { case: { facts: { solo_parent_documented: true } } } as const;
	assert.deepEqual(
		ladder('PH', 0, 'MATERNITY_LEAVE', { ...FEMALE, ...SSS, event: { ...BIRTH, ...DOCUMENTED } }),
		[120, 120, 120]
	);
	assert.deepEqual(
		ladder('PH', 0, 'MATERNITY_LEAVE', { ...FEMALE, ...SSS, solo_parent: true, event: BIRTH }),
		[105, 105, 105]
	);
	assert.deepEqual(
		ladder('PH', 0, 'MATERNITY_LEAVE', { ...FEMALE, ...SSS, event: BIRTH }),
		[105, 105, 105]
	);
	assert.deepEqual(
		ladder('PH', 0, 'MATERNITY_LEAVE', { ...FEMALE, ...SSS, event: { kind: 'MISCARRIAGE' } }),
		[60, 60, 60]
	);
	assert.deepEqual(
		ladder('PH', 0, 'MATERNITY_LEAVE', { ...FEMALE, event: BIRTH }),
		[105, 105, 105]
	);
	// RA 8187: seven days per delivery, married male employee, no service condition.
	assert.deepEqual(
		ladder('PH', 0, 'PATERNITY_LEAVE', { ...MARRIED_MALE, event: BIRTH }),
		[7, 7, 7]
	);
	assert.deepEqual(ladder('PH', 0, 'PATERNITY_LEAVE', { ...FEMALE, event: BIRTH }), [
		null,
		null,
		null
	]);
	// RA 8972 as amended: seven working days after six months' service, solo parents only.
	assert.deepEqual(ladder('PH', 0, 'SOLO_PARENT_LEAVE', { solo_parent: true }), [0, 7, 7]);
	assert.deepEqual(ladder('PH', 0, 'SOLO_PARENT_LEAVE', {}), [null, null, null]);
	// RA 9262: ten days. RA 9710: sixty days after six months.
	assert.deepEqual(ladder('PH', 0, 'VAWC_LEAVE', FEMALE), [10, 10, 10]);
	// RA 9710: two months per gynaecological surgery, after six months' service.
	assert.deepEqual(
		ladder('PH', 0, 'SPECIAL_LEAVE_FOR_WOMEN', { ...FEMALE, event: { kind: 'SURGERY' } }),
		[null, 60, 60]
	);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Singapore — Employment Act 1968 ss.43 and 89; the Child Development Co-Savings Act. Three
// sealed versions, and the 1 April 2026 one exists for exactly one change: shared parental leave.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('Singapore — the service ladders and the family schemes, on all five sealed versions', () => {
	// 1 July 2026 moves the retirement ages alone; its leave rows are clones of 1 April's.
	for (const version of [0, 1, 2, 3, 4]) {
		// s.43(1): seven days in the first year, one more a year to fourteen — after three months.
		// Seventy months is the "sixty or more" rung, twelve days, not the seventy-two-month thirteen.
		assert.deepEqual(ladder('SG', version, 'ANNUAL_LEAVE'), [7, 9, 12]);
		// s.89(1): five outpatient days at three months rising to fourteen at six.
		assert.deepEqual(ladder('SG', version, 'SICK_LEAVE'), [5, 14, 14]);
		// s.89(1)(b): fifteen hospitalisation days at three months rising to sixty at six.
		assert.deepEqual(ladder('SG', version, 'HOSPITALIZATION_LEAVE'), [15, 60, 60]);
		// CDCSA: four weeks of paternity leave per child born on or after 1 April 2025, three months'
		// service, a married father of a citizen child (the entry names the birth and the child); an
		// unmarried man, one with no child, or the father of a non-citizen child is outside the
		// scheme. A child born before 1 April 2025 carried two weeks.
		const BIRTH = { kind: 'BIRTH', child_index: 1, date: '2026-01-10' } as const;
		const FATHER = {
			...MARRIED_MALE,
			childAges: [0],
			childCitizenship: ['CITIZEN'],
			event: BIRTH
		} as const;
		assert.deepEqual(ladder('SG', version, 'PATERNITY_LEAVE', FATHER), [28, 28, 28]);
		assert.deepEqual(
			ladder('SG', version, 'PATERNITY_LEAVE', {
				...FATHER,
				event: { ...BIRTH, date: '2025-03-20' }
			}),
			[14, 14, 14]
		);
		assert.deepEqual(ladder('SG', version, 'PATERNITY_LEAVE', MALE), [null, null, null]);
		assert.deepEqual(
			ladder('SG', version, 'PATERNITY_LEAVE', { ...FATHER, childCitizenship: ['FOREIGNER'] }),
			[null, null, null]
		);
		// Sixteen weeks for the mother of a citizen child; the twelve-week Employment Act fallback
		// otherwise — the child's citizenship, not the mother's. The row is female-only.
		const MOTHER = { ...FEMALE, childAges: [0], event: BIRTH } as const;
		assert.deepEqual(
			ladder('SG', version, 'MATERNITY_LEAVE', {
				...MOTHER,
				citizenship: 'FOREIGNER',
				childCitizenship: ['CITIZEN']
			}),
			[112, 112, 112]
		);
		assert.deepEqual(
			ladder('SG', version, 'MATERNITY_LEAVE', {
				...MOTHER,
				citizenship: 'CITIZEN',
				childCitizenship: ['FOREIGNER']
			}),
			[84, 84, 84]
		);
		assert.deepEqual(ladder('SG', version, 'MATERNITY_LEAVE', { ...MALE, event: BIRTH }), [
			null,
			null,
			null
		]);
		// Childcare leave: six days for a parent of a citizen child under seven, two otherwise.
		assert.deepEqual(
			ladder('SG', version, 'CHILDCARE_LEAVE', { childAges: [3], childCitizenship: ['CITIZEN'] }),
			[6, 6, 6]
		);
		assert.deepEqual(
			ladder('SG', version, 'CHILDCARE_LEAVE', { childAges: [3], childCitizenship: ['FOREIGNER'] }),
			[2, 2, 2]
		);
		// A citizen child of nine carries extended childcare leave, which CDCA s.12B(1A) and (2)(a)(iii)
		// put in the same row and pool (a combined six a year): two days (asserted below).
		// Twelve days of unpaid infant care for a parent of a citizen child under two (CDCA s.12D) —
		// doubled from six with effect from 1 January 2024, before this lineage's first sealed
		// version opens. A non-citizen infant carries none.
		assert.deepEqual(
			ladder('SG', version, 'UNPAID_INFANT_CARE_LEAVE', {
				citizenship: 'CITIZEN',
				childAges: [1],
				childCitizenship: ['CITIZEN']
			}),
			[12, 12, 12]
		);
		assert.deepEqual(
			ladder('SG', version, 'UNPAID_INFANT_CARE_LEAVE', {
				citizenship: 'CITIZEN',
				childAges: [1],
				childCitizenship: ['FOREIGNER']
			}),
			[null, null, null]
		);
		// Adoption leave: twelve weeks for an adoptive mother of a citizen child under twelve
		// months at the Formal Intent to Adopt; a child of two is outside it.
		const ADOPTION = { kind: 'ADOPTION', child_index: 1 } as const;
		assert.deepEqual(
			ladder('SG', version, 'ADOPTION_LEAVE', {
				...FEMALE,
				childAges: [0],
				childCitizenship: ['CITIZEN'],
				event: ADOPTION
			}),
			[84, 84, 84]
		);
		assert.deepEqual(
			ladder('SG', version, 'ADOPTION_LEAVE', {
				...FEMALE,
				childAges: [2],
				childCitizenship: ['CITIZEN'],
				event: ADOPTION
			}),
			[null, null, null]
		);
		// National service leave is unmetered: the engine reports no entitlement figure at all.
		assert.deepEqual(ladder('SG', version, 'NS_LEAVE', { ...MALE, citizenship: 'CITIZEN' }), [
			null,
			null,
			null
		]);
	}
	// The whole point of the 1 April 2026 version: shared parental leave goes from six weeks to ten.
	// A married father qualifies; a mother qualifies whatever her marital status (MSF); an
	// unmarried father does not.
	// The weeks are the couple's pool: this parent's grant is the share recorded on the child
	// (`event.child_shared_weeks`, × 7 days) or the default share — three of six, five of ten —
	// and never more than the pool. They are keyed to the child's date of birth, not the day the
	// leave is taken: on the April version a child born before 1 April 2026 still shares six.
	const born = (date: string) => ({ kind: 'BIRTH', child_index: 1, date }) as const;
	const FATHER = { ...MARRIED_MALE, childAges: [0], childCitizenship: ['CITIZEN'] } as const;
	const UNMARRIED_MOTHER = { ...FEMALE, childAges: [0], childCitizenship: ['CITIZEN'] } as const;
	assert.deepEqual(
		ladder('SG', 0, 'SHARED_PARENTAL_LEAVE', { ...FATHER, event: born('2025-12-15') }),
		[21, 21, 21]
	);
	assert.deepEqual(
		ladder('SG', 1, 'SHARED_PARENTAL_LEAVE', { ...FATHER, event: born('2026-02-01') }),
		[21, 21, 21]
	);
	assert.deepEqual(
		ladder('SG', 2, 'SHARED_PARENTAL_LEAVE', { ...FATHER, event: born('2026-04-01') }),
		[35, 35, 35]
	);
	assert.deepEqual(
		ladder('SG', 2, 'SHARED_PARENTAL_LEAVE', { ...FATHER, event: born('2026-03-31') }),
		[21, 21, 21]
	);
	assert.deepEqual(
		ladder('SG', 3, 'SHARED_PARENTAL_LEAVE', { ...FATHER, event: born('2027-01-05') }),
		[35, 35, 35]
	);
	assert.deepEqual(
		ladder('SG', 2, 'SHARED_PARENTAL_LEAVE', { ...UNMARRIED_MOTHER, event: born('2026-05-01') }),
		[35, 35, 35]
	);
	// The couple agreed eight of the ten weeks to this parent; a share past the pool is the pool.
	assert.deepEqual(
		ladder('SG', 2, 'SHARED_PARENTAL_LEAVE', {
			...FATHER,
			childSharedWeeks: [8],
			event: born('2026-05-01')
		}),
		[56, 56, 56]
	);
	assert.deepEqual(
		ladder('SG', 2, 'SHARED_PARENTAL_LEAVE', {
			...FATHER,
			childSharedWeeks: [12],
			event: born('2026-05-01')
		}),
		[70, 70, 70]
	);
	assert.deepEqual(
		ladder('SG', 1, 'SHARED_PARENTAL_LEAVE', {
			...FATHER,
			childSharedWeeks: [2],
			event: born('2026-02-01')
		}),
		[14, 14, 14]
	);
	assert.deepEqual(
		ladder('SG', 2, 'SHARED_PARENTAL_LEAVE', {
			...MALE,
			childAges: [0],
			childCitizenship: ['CITIZEN'],
			event: born('2026-05-01')
		}),
		[null, null, null]
	);
});

test('Singapore — extended childcare leave, for a parent whose youngest child is seven or over', () => {
	// CDCA s.12B(1A): 2 days a relevant period for a citizen child "of or above 7 years of age but
	// below 13"; s.12B(2)(a)(iii): "a combined total of 6 days of childcare leave and extended
	// childcare leave during any relevant period" — so it is the childcare row's two-day band, and a
	// citizen child under seven puts the parent on the six instead of adding two to them.
	for (const version of settingsVersions('SG').keys()) {
		assert.deepEqual(
			ladder('SG', version, 'CHILDCARE_LEAVE', {
				citizenship: 'CITIZEN',
				childAges: [9],
				childCitizenship: ['CITIZEN']
			}),
			[2, 2, 2]
		);
		assert.deepEqual(
			ladder('SG', version, 'CHILDCARE_LEAVE', {
				citizenship: 'CITIZEN',
				childAges: [3, 9],
				childCitizenship: ['CITIZEN', 'CITIZEN']
			}),
			[6, 6, 6]
		);
		// The child must be a citizen: a non-citizen nine-year-old carries no extended leave.
		assert.deepEqual(
			ladder('SG', version, 'CHILDCARE_LEAVE', {
				citizenship: 'CITIZEN',
				childAges: [9],
				childCitizenship: ['FOREIGNER']
			}),
			[null, null, null]
		);
		// …nor does a citizen of thirteen.
		assert.deepEqual(
			ladder('SG', version, 'CHILDCARE_LEAVE', {
				citizenship: 'CITIZEN',
				childAges: [13],
				childCitizenship: ['CITIZEN']
			}),
			[null, null, null]
		);
	}
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Vietnam — Labour Code 2019 arts.113, 114, 115 and 139; Law on Social Insurance 41/2024 art.43.
// Three sealed versions; no leave figure moves across either seam.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('Vietnam — the annual-leave cohorts, the seniority ladder and the SI sick bands', () => {
	// Version 2 (16 May 2026, Decree 105/2026) moves the union-fee payment date alone; version 3
	// is 1 July 2026.
	for (const version of [0, 1, 2, 3]) {
		// art.113(1)(a) with art.114: twelve days, one more for every five years with the employer.
		// Seventy months is past sixty, so it is thirteen.
		assert.deepEqual(ladder('VN', version, 'ANNUAL_LEAVE'), [12, 12, 13]);
		// art.113(1)(b): fourteen for a minor, a person with a disability, and the arduous-work
		// cohort — each on the art.114 ladder too, so seventy months is fifteen.
		assert.deepEqual(ladder('VN', version, 'ANNUAL_LEAVE', { age: 17 }), [14, 14, 15]);
		assert.deepEqual(ladder('VN', version, 'ANNUAL_LEAVE', { disabled: true }), [14, 14, 15]);
		// Decree 145/2020 art.66(2): a part month with at least half its days worked or paid counts
		// as a month of annual leave. A joiner on 15 January (17 of 31 days) carries January and
		// earns the whole twelve; one on 20 January (12 of 31) starts in February — eleven.
		const partYear = (hire: string) =>
			computedEntitlement({
				rule: leaveCatalogue('VN').find((row) => row.code === 'ANNUAL_LEAVE')!.entitlement,
				window: { start: '2026-01-01', end: '2026-12-31' },
				asOf: '2026-12-31',
				hireDate: hire,
				exitDate: null,
				servedOn: () => true,
				eligibleOn: () => true,
				personOn: (date) =>
					personContext({
						employee: { date_of_birth: '1990-01-01' },
						employment: { service_start: hire },
						terms: null,
						asOf: date
					})
			}).entitlement;
		assert.equal(partYear('2026-01-15'), 12);
		assert.equal(partYear('2026-01-20'), 11);
		// art.114 has no top: thirty-five years of service is nineteen days.
		assert.equal(
			grantedDays(
				leaveCatalogue('VN').find((row) => row.code === 'ANNUAL_LEAVE')!.entitlement,
				personContext({
					employee: { date_of_birth: '1970-01-01' },
					employment: { service_start: '1991-01-01' },
					terms: null,
					asOf: '2026-07-01'
				})
			),
			19
		);
		assert.deepEqual(
			ladder('VN', version, 'ANNUAL_LEAVE', { classification: 'ARDUOUS' }),
			[14, 14, 15]
		);
		// art.113(1)(c): sixteen for especially arduous work, on its own seniority ladder.
		assert.deepEqual(
			ladder('VN', version, 'ANNUAL_LEAVE', { classification: 'ESPECIALLY_ARDUOUS' }),
			[16, 16, 17]
		);
		// SI Law art.43: thirty days under fifteen years of contribution, forty under thirty, sixty
		// above; forty / fifty / seventy in the arduous cohort. The bands read years of
		// social-insurance contribution (`facts.SI.since_months`), not service with this employer.
		const SI_20Y = { registrations: [{ code: 'SI', since: '2006-01-01' }] } as const;
		assert.deepEqual(ladder('VN', version, 'SICK_LEAVE'), [30, 30, 30]);
		assert.deepEqual(ladder('VN', version, 'SICK_LEAVE', SI_20Y), [40, 40, 40]);
		assert.deepEqual(
			ladder('VN', version, 'SICK_LEAVE', { classification: 'ARDUOUS' }),
			[40, 40, 40]
		);
		assert.deepEqual(
			ladder('VN', version, 'SICK_LEAVE', { ...SI_20Y, classification: 'ARDUOUS' }),
			[50, 50, 50]
		);
		// art.139(1) and Law 41/2024 art.53(2): grants per birth for a member of six months'
		// contributions — six calendar months (`calendar_months`), seven for twins; five days, seven for a caesarean, ten for
		// twins, fourteen for twins by caesarean — and the art.115 personal leaves per event.
		const SI_1Y = { registrations: [{ code: 'SI', since: '2024-01-01' }] } as const;
		const MOTHER = { ...FEMALE, ...SI_1Y } as const;
		const wife = version === 3 ? { relationship: 'WIFE' } : {};
		assert.deepEqual(
			ladder('VN', version, 'MATERNITY_LEAVE', { ...MOTHER, event: { kind: 'BIRTH' } }),
			[6, 6, 6]
		);
		assert.deepEqual(
			ladder('VN', version, 'MATERNITY_LEAVE', { ...MOTHER, event: { kind: 'MULTIPLE_BIRTH' } }),
			[7, 7, 7]
		);
		// Labour Code art.139: the six months' leave is every mother's; a mother short of the six
		// contribution months is on leave without the fund's allowance, not without the leave.
		assert.deepEqual(
			ladder('VN', version, 'MATERNITY_LEAVE', { ...FEMALE, event: { kind: 'BIRTH' } }),
			[6, 6, 6]
		);
		assert.deepEqual(
			ladder('VN', version, 'MATERNITY_LEAVE', { ...MALE, event: { kind: 'BIRTH' } }),
			[null, null, null]
		);
		assert.deepEqual(
			ladder('VN', version, 'PATERNITY_LEAVE', {
				...MALE,
				event: { kind: 'BIRTH', ...wife, wife_prior_living_biological_children: 0 }
			}),
			[5, 5, 5]
		);
		assert.deepEqual(
			ladder('VN', version, 'PATERNITY_LEAVE', {
				...MALE,
				event: { kind: 'BIRTH_SURGERY', ...wife, wife_prior_living_biological_children: 0 }
			}),
			[7, 7, 7]
		);
		assert.deepEqual(
			ladder('VN', version, 'PATERNITY_LEAVE', {
				...MALE,
				event: { kind: 'MULTIPLE_BIRTH', ...wife }
			}),
			[10, 10, 10]
		);
		assert.deepEqual(
			ladder('VN', version, 'PATERNITY_LEAVE', {
				...MALE,
				event: { kind: 'MULTIPLE_BIRTH_SURGERY', ...wife }
			}),
			[14, 14, 14]
		);
		if (version === 3) {
			// Law 113/2025 art.28 (1 July 2026): a second child is seven months; triplets add a
			// month per child from the second (eight), and the father three working days per child
			// from the third — `children.born_on(event.date)` counts the confinement the profile
			// records.
			const triplets = (code: string, facts: Record<string, unknown>, priorChild = false) =>
				grantedDays(
					leaveCatalogue('VN')
						.filter((row) => row.settings_id === settingsVersions('VN')[3]!.id)
						.find((row) => row.code === code)!.entitlement,
					personContext({
						employee: { date_of_birth: '1990-01-01', gender: facts.gender },
						employment: { service_start: '2020-01-01' },
						terms: null,
						children: [
							...(priorChild ? [{ child_birthdate: '2024-08-01', relationship: 'CHILD' }] : []),
							...[0, 0, 0].map(() => ({
								child_birthdate: '2026-08-01',
								relationship: 'CHILD',
								citizenship: null,
								shared_parental_weeks: null
							}))
						],
						event: {
							kind: 'MULTIPLE_BIRTH',
							date: '2026-08-01',
							relationship: 'WIFE',
							...facts.event
						},
						asOf: '2026-08-01'
					} as never)
				);
			// Months (`calendar_months`): six plus one per child from the second — eight; nine after
			// one prior living child (seven plus two).
			assert.equal(triplets('MATERNITY_LEAVE', { gender: 'FEMALE', event: {} }), 8);
			assert.equal(triplets('MATERNITY_LEAVE', { gender: 'FEMALE', event: { child_index: 2 } }), 8);
			assert.equal(triplets('MATERNITY_LEAVE', { gender: 'FEMALE', event: {} }, true), 9);
			assert.equal(triplets('PATERNITY_LEAVE', { gender: 'MALE', event: {} }), 13);
			assert.equal(
				triplets('PATERNITY_LEAVE', { gender: 'MALE', event: { kind: 'MULTIPLE_BIRTH_SURGERY' } }),
				17
			);
			assert.deepEqual(
				ladder('VN', version, 'PATERNITY_LEAVE', {
					...MALE,
					event: {
						kind: 'BIRTH',
						relationship: 'WIFE',
						child_index: 2,
						wife_prior_living_biological_children: 1
					}
				}),
				[10, 10, 10]
			);
			assert.deepEqual(
				ladder('VN', version, 'PATERNITY_LEAVE', {
					...MALE,
					event: {
						kind: 'BIRTH',
						relationship: 'WIFE',
						child_index: 2,
						wife_prior_living_biological_children: 0
					}
				}),
				[5, 5, 5]
			);
			assert.deepEqual(
				ladder('VN', version, 'PATERNITY_LEAVE', {
					...MALE,
					event: { kind: 'BIRTH', relationship: 'WIFE', wife_prior_living_biological_children: 2 }
				}),
				[5, 5, 5]
			);
			assert.deepEqual(
				ladder('VN', version, 'PATERNITY_LEAVE', {
					...MALE,
					event: { kind: 'BIRTH', relationship: 'WIFE' }
				}),
				[null, null, null]
			);
			assert.deepEqual(
				ladder('VN', version, 'PATERNITY_LEAVE', {
					...MALE,
					event: { kind: 'BIRTH', relationship: 'OTHER', wife_prior_living_biological_children: 1 }
				}),
				[null, null, null]
			);
		}
		assert.deepEqual(
			ladder('VN', version, 'MARRIAGE_LEAVE', {
				event: { kind: 'MARRIAGE', relationship: 'SELF' }
			}),
			[3, 3, 3]
		);
		assert.deepEqual(
			ladder('VN', version, 'CHILD_MARRIAGE_LEAVE', {
				event: { kind: 'MARRIAGE', relationship: 'CHILD' }
			}),
			[1, 1, 1]
		);
		assert.deepEqual(
			ladder('VN', version, 'BEREAVEMENT_LEAVE', {
				event: { kind: 'DEATH', relationship: 'PARENT' }
			}),
			[3, 3, 3]
		);
		assert.deepEqual(
			ladder('VN', version, 'BEREAVEMENT_LEAVE', {
				event: { kind: 'DEATH', relationship: 'SIBLING' }
			}),
			[null, null, null]
		);
		assert.deepEqual(
			ladder('VN', version, 'BEREAVEMENT_LEAVE_UNPAID', {
				event: { kind: 'DEATH', relationship: 'SIBLING' }
			}),
			[1, 1, 1]
		);
		// art.112(1): eleven paid public holidays, seeded as a leave head of that size — twelve in the
		// fourth version, from 1 July 2026, when Nghị quyết 28/2026/QH16 điều 2 makes 24 November each
		// year Ngày Văn hóa Việt Nam, "nghỉ làm việc và hưởng nguyên lương". The resolution stands
		// alone rather than amending art.112(1), which still reads eleven.
		assert.deepEqual(
			ladder('VN', version, 'PUBLIC_HOLIDAY'),
			version === 3 ? [12, 12, 12] : [11, 11, 11]
		);
		// art.112(2): a foreign employee gets one further paid day for their own country's
		// traditional New Year and one for its national day. A Vietnamese employee gets neither.
		assert.deepEqual(
			ladder('VN', version, 'FOREIGN_NATIONAL_LEAVE', { citizenship: 'FOREIGNER' }),
			[2, 2, 2]
		);
		assert.deepEqual(ladder('VN', version, 'FOREIGN_NATIONAL_LEAVE', { citizenship: 'CITIZEN' }), [
			null,
			null,
			null
		]);
	}
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Taiwan — 勞動基準法第38條, 第43條, 第50條 and 性別平等工作法. Two sealed versions; the leave
// ladder is identical on both, only the insured-salary grade tables move on 1 January 2026.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('Taiwan — the §38 annual ladder and the 性平法 entitlements, on both live sealed versions', () => {
	for (const version of [0, 1]) {
		// 第38條: nothing under six months, three days at six, seven at one year, ten at two, then
		// fourteen at three and fifteen at five. Thirty months is the two-year rung, seventy the
		// five-year one.
		assert.deepEqual(ladder('TW', version, 'ANNUAL_LEAVE'), [0, 10, 15]);
		// 勞工請假規則第4條: thirty days of ordinary sickness leave; 第7條: fourteen days of personal
		// leave, unpaid. 第2條 and 第3條: eight days each for marriage and bereavement.
		assert.deepEqual(ladder('TW', version, 'SICK_LEAVE'), [30, 30, 30]);
		assert.deepEqual(ladder('TW', version, 'PERSONAL_LEAVE'), [14, 14, 14]);
		// 勞工請假規則 §2–3: eight days per marriage; bereavement per death by the relationship —
		// eight for a parent or spouse, six for a grandparent or child, three for a sibling.
		assert.deepEqual(
			ladder('TW', version, 'MARRIAGE_LEAVE', { event: { kind: 'MARRIAGE' } }),
			[8, 8, 8]
		);
		assert.deepEqual(
			ladder('TW', version, 'BEREAVEMENT_LEAVE', {
				event: { kind: 'DEATH', relationship: 'PARENT' }
			}),
			[8, 8, 8]
		);
		assert.deepEqual(
			ladder('TW', version, 'BEREAVEMENT_LEAVE', {
				event: { kind: 'DEATH', relationship: 'CHILD' }
			}),
			[6, 6, 6]
		);
		assert.deepEqual(
			ladder('TW', version, 'BEREAVEMENT_LEAVE', {
				event: { kind: 'DEATH', relationship: 'SIBLING' }
			}),
			[3, 3, 3]
		);
		// §4(1): a year of hospitalised sickness leave within any two, the outpatient thirty inside it.
		assert.deepEqual(ladder('TW', version, 'HOSPITALISED_SICK_LEAVE'), [365, 365, 365]);
		// 第50條: eight weeks of maternity leave. 性平法: seven days of paternity and prenatal
		// checkup leave, one menstrual day a month, seven days of family care leave.
		// 勞基法 §50 with 性平法 §15: eight weeks per birth, four for a miscarriage after three months
		// of pregnancy, one week after two, five days under two.
		assert.deepEqual(
			ladder('TW', version, 'MATERNITY_LEAVE', { ...FEMALE, event: { kind: 'BIRTH' } }),
			[56, 56, 56]
		);
		assert.deepEqual(
			ladder('TW', version, 'MATERNITY_LEAVE', { ...FEMALE, event: { kind: 'MISCARRIAGE_3M' } }),
			[28, 28, 28]
		);
		assert.deepEqual(
			ladder('TW', version, 'MATERNITY_LEAVE', {
				...FEMALE,
				event: { kind: 'MISCARRIAGE_UNDER_2M' }
			}),
			[5, 5, 5]
		);
		assert.deepEqual(
			ladder('TW', version, 'MATERNITY_LEAVE', { ...MALE, event: { kind: 'BIRTH' } }),
			[null, null, null]
		);
		assert.deepEqual(ladder('TW', version, 'PATERNITY_LEAVE'), [7, 7, 7]);
		assert.deepEqual(ladder('TW', version, 'PRENATAL_CHECKUP_LEAVE', FEMALE), [7, 7, 7]);
		assert.deepEqual(ladder('TW', version, 'MENSTRUAL_LEAVE', FEMALE), [1, 1, 1]);
		assert.deepEqual(ladder('TW', version, 'FAMILY_CARE_LEAVE'), [7, 7, 7]);
		// 育嬰留職停薪: two years, after six months' service — so the three-month case is outside it.
		assert.deepEqual(ladder('TW', version, 'PARENTAL_LEAVE'), [null, 730, 730]);
		// 職災醫療期間 and 哺乳時間 are unmetered.
		assert.deepEqual(ladder('TW', version, 'OCCUPATIONAL_INJURY_LEAVE'), [null, null, null]);
		// 性別平等工作法第18條 is gender-neutral: whichever parent nurses the child under two, and the
		// time itself is unmetered, so the ladder reads null for either parent and the row's own
		// predicate is the whole entitlement test.
		for (const parent of [MALE, FEMALE])
			assert.deepEqual(ladder('TW', version, 'BREASTFEEDING_TIME', { ...parent, childAges: [1] }), [
				null,
				null,
				null
			]);
		for (const row of leaveCatalogue('TW').filter(
			(candidate) => candidate.code === 'BREASTFEEDING_TIME'
		))
			assert.equal(row.eligibility, 'children.under(2) >= 1');
	}
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Indonesia — UU 13/2003 arts.79 and 93, UU 4/2024 (KIA) and the SKB 3 Menteri joint leave.
// Three sealed versions; no leave figure moves across either seam.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('Indonesia — the UU 13/2003 leave heads, on all three sealed versions', () => {
	for (const version of [0, 1, 2]) {
		// art.79(3): twelve days after twelve months of continuous service. The service test is on
		// the ROW, not only on its one band, so a person under a year is outside the leave itself.
		assert.deepEqual(ladder('ID', version, 'ANNUAL_LEAVE'), [null, 12, 12]);
		// UU 4/2024: three months of maternity leave, seeded as ninety-one days; two days of
		// paternity leave under art.93(4)(e); forty-five days after a miscarriage.
		// Grants per birth: three months, six where the birth had complications (UU 4/2024
		// art.4(3)); two days for the father, five with complications (art.6(2)(a)); 1.5 months per
		// miscarriage.
		const BIRTH = { kind: 'BIRTH' } as const;
		const COMPLICATED = { kind: 'BIRTH_COMPLICATION' } as const;
		assert.deepEqual(
			ladder('ID', version, 'MATERNITY_LEAVE', { ...FEMALE, event: BIRTH }),
			[91, 91, 91]
		);
		assert.deepEqual(
			ladder('ID', version, 'MATERNITY_LEAVE', { ...FEMALE, event: COMPLICATED }),
			[182, 182, 182]
		);
		// UU 13/2003 art.93(2)(e): religious duty leave is unmetered and paid, once with the employer
		// (PP 36/2021 art.40(3)) — the event is counted, the days are the duty's own.
		const religious = leaveCatalogue('ID').filter((row) => row.code === 'RELIGIOUS_DUTY_LEAVE');
		assert.equal(religious.length, settingsVersions('ID').length);
		assert.deepEqual(
			religious.map((row) => [
				row.entitlement.availability,
				row.entitlement.lifetime_events,
				row.is_npl
			]),
			settingsVersions('ID').map(() => ['UNLIMITED', 1, false])
		);
		assert.deepEqual(ladder('ID', version, 'MATERNITY_LEAVE', { ...MALE, event: BIRTH }), [
			null,
			null,
			null
		]);
		assert.deepEqual(
			ladder('ID', version, 'PATERNITY_LEAVE', { ...MALE, event: BIRTH }),
			[2, 2, 2]
		);
		assert.deepEqual(
			ladder('ID', version, 'PATERNITY_LEAVE', { ...MALE, event: COMPLICATED }),
			[5, 5, 5]
		);
		assert.deepEqual(
			ladder('ID', version, 'MISCARRIAGE_LEAVE', { ...FEMALE, event: { kind: 'MISCARRIAGE' } }),
			[45, 45, 45]
		);
		// art.81: two menstrual days, female employees only.
		assert.deepEqual(ladder('ID', version, 'MENSTRUAL_LEAVE', FEMALE), [2, 2, 2]);
		assert.deepEqual(ladder('ID', version, 'MENSTRUAL_LEAVE', MALE), [null, null, null]);
		// art.93(4): the family-event heads, and the SKB 3 Menteri joint leave for 2026.
		// Ps.93(4): each a grant per event.
		assert.deepEqual(
			ladder('ID', version, 'MARRIAGE_LEAVE', {
				event: { kind: 'MARRIAGE', relationship: 'SELF' }
			}),
			[3, 3, 3]
		);
		assert.deepEqual(
			ladder('ID', version, 'CHILD_MARRIAGE_LEAVE', {
				event: { kind: 'MARRIAGE', relationship: 'CHILD' }
			}),
			[2, 2, 2]
		);
		assert.deepEqual(
			ladder('ID', version, 'CHILD_CIRCUMCISION_LEAVE', { event: { kind: 'CIRCUMCISION' } }),
			[2, 2, 2]
		);
		assert.deepEqual(
			ladder('ID', version, 'CHILD_BAPTISM_LEAVE', { event: { kind: 'BAPTISM' } }),
			[2, 2, 2]
		);
		assert.deepEqual(
			ladder('ID', version, 'BEREAVEMENT_LEAVE', {
				event: { kind: 'DEATH', relationship: 'SPOUSE' }
			}),
			[2, 2, 2]
		);
		assert.deepEqual(
			ladder('ID', version, 'BEREAVEMENT_HOUSEHOLD_LEAVE', {
				event: { kind: 'DEATH', relationship: 'HOUSEHOLD' }
			}),
			[1, 1, 1]
		);
		assert.deepEqual(ladder('ID', version, 'JOINT_LEAVE'), [8, 8, 8]);
		// art.93(2)(a) sick pay is unmetered: certified from the first day and not a day count.
		assert.deepEqual(ladder('ID', version, 'MEDICAL_LEAVE'), [null, null, null]);
	}
});

/** The pay fraction of a lineage version's `code` row for one charged day. */
function payFraction(
	lineage: Lineage,
	version: number,
	code: string,
	leave: { readonly day_index: number; readonly year_taken?: Record<string, number> }
): number {
	const settingsId = settingsVersions(lineage).toSorted((left, right) =>
		String(left.effective_range.start).localeCompare(String(right.effective_range.start))
	)[version]!.id;
	const row = leaveCatalogue(lineage).find(
		(candidate) => candidate.settings_id === settingsId && candidate.code === code
	)!;
	return evaluateNumberOver(row.pay_fraction ?? '1.0', {
		...personContext({
			employee: {
				gender: 'FEMALE',
				date_of_birth: '1990-01-01',
				marital_status: null,
				solo_parent: null,
				disabled: null
			},
			employment: { service_start: '2020-01-01' },
			terms: {
				residency_status: 'CITIZEN',
				work_classification: null,
				employment_type: 'PERMANENT',
				statutory_work_category: null
			},
			children: [],
			event: { kind: 'BIRTH', date: '2026-04-01' },
			facts: [],
			asOf: '2026-05-01'
		}),
		leave: { month_index: 1, days: 1, year_taken: {}, ...leave }
	});
}

test('Thailand — the Labour Protection Act leaves, across the Act No.9 cutover', () => {
	const BIRTH = { event: { kind: 'BIRTH' } } as const;
	for (const version of settingsVersions('TH').keys()) {
		// LPA s.30: six working days after twelve months' continuous service.
		assert.deepEqual(ladder('TH', version, 'ANNUAL_LEAVE'), [null, 6, 6]);
		// ss.32, 57: sick leave as actually ill, unmetered; paid for the first 30 days of the year.
		assert.deepEqual(ladder('TH', version, 'SICK_LEAVE'), [null, null, null]);
		assert.equal(
			payFraction('TH', version, 'SICK_LEAVE', { day_index: 1, year_taken: { SICK_LEAVE: 29 } }),
			1
		);
		assert.equal(
			payFraction('TH', version, 'SICK_LEAVE', { day_index: 1, year_taken: { SICK_LEAVE: 30 } }),
			0
		);
		// ss.34, 57/1: three paid working days of personal business leave a year.
		assert.deepEqual(ladder('TH', version, 'PERSONAL_BUSINESS_LEAVE'), [3, 3, 3]);
		// s.41 with s.59: 98 days, 45 paid, until Act No.9 B.E.2568 (from 7 Dec 2025): 120 days, 60 paid.
		const [days, paid] = version === 0 ? [98, 45] : [120, 60];
		assert.deepEqual(ladder('TH', version, 'MATERNITY_LEAVE', { ...FEMALE, ...BIRTH }), [
			days,
			days,
			days
		]);
		assert.deepEqual(ladder('TH', version, 'MATERNITY_LEAVE', { ...MALE, ...BIRTH }), [
			null,
			null,
			null
		]);
		assert.equal(payFraction('TH', version, 'MATERNITY_LEAVE', { day_index: paid }), 1);
		assert.equal(payFraction('TH', version, 'MATERNITY_LEAVE', { day_index: paid + 1 }), 0);
		// Act No.9 B.E.2568: fifteen days' spouse-birth leave and fifteen days' child-care leave at 50%.
		if (version === 0) continue;
		assert.deepEqual(ladder('TH', version, 'CHILD_BIRTH_LEAVE', BIRTH), [15, 15, 15]);
		assert.deepEqual(
			ladder('TH', version, 'CHILD_CARE_LEAVE', { ...FEMALE, ...BIRTH }),
			[15, 15, 15]
		);
		assert.equal(payFraction('TH', version, 'CHILD_CARE_LEAVE', { day_index: 1 }), 0.5);
	}
});

for (const lineage of ['CN-shanghai', 'CN-kunming'] as const) {
	test(`${lineage} — family-planning procedure days on every sealed version`, () => {
		// Shanghai 沪府规〔2022〕18号 art.19; Yunnan population-planning regulation art.19.
		const days =
			lineage === 'CN-shanghai'
				? {
						IUD_INSERTION: 2,
						IUD_REMOVAL: 2,
						IUD_FOLLOWUP: 1,
						VASECTOMY: 7,
						TUBAL_LIGATION: 30,
						IMPLANT_INSERTION: 5,
						IMPLANT_REMOVAL: 3,
						DIAGNOSTIC_CURETTAGE: 5
					}
				: {
						IUD_INSERTION: 7,
						IUD_REMOVAL: 7,
						TUBAL_LIGATION: 30,
						VASECTOMY: 15,
						TUBAL_REVERSAL: 30,
						VAS_REVERSAL: 15,
						CONTRACEPTION_FAILURE_UNDER_4M: 15,
						CONTRACEPTION_FAILURE_4M_PLUS: 42
					};
		for (const version of settingsVersions(lineage).keys()) {
			for (const [kind, count] of Object.entries(days))
				assert.equal(
					grant(lineage, version, 'FAMILY_PLANNING_PROCEDURE_LEAVE', 30, {
						event: { kind }
					}),
					count,
					`${lineage} ${kind}`
				);
			assert.equal(
				grant(lineage, version, 'FAMILY_PLANNING_PROCEDURE_LEAVE', 30, {
					event: { kind: 'UNRECORDED_PROCEDURE' }
				}),
				null
			);
			if (lineage === 'CN-shanghai')
				assert.equal(
					grant(lineage, version, 'FAMILY_PLANNING_PROCEDURE_LEAVE', 30, {
						event: { kind: 'IUD_INSERTION', date: '2027-11-01' }
					}),
					null
				);
		}
	});
	test(`${lineage} — unpaid leave is unmetered on every sealed version`, () => {
		for (const version of settingsVersions(lineage).keys())
			assert.deepEqual(ladder(lineage, version, 'UNPAID_LEAVE'), [null, null, null]);
	});
	test(`${lineage} — annual, maternity, paternity and marriage leave on every sealed version`, () => {
		// Shanghai: 沪府规〔2022〕18号 art.2 (to 31 Oct 2027) — marriage +7, 生育假 +60, 配偶陪产假 10.
		// Yunnan: 云南省人口与计划生育条例 art.18 (17 Jan 2022) — marriage +15, 生育假 +60, 护理假 30.
		const city =
			lineage === 'CN-shanghai'
				? { extra: 60, paternity: 10, marriage: 10 }
				: { extra: 60, paternity: 30, marriage: 18 };
		for (const version of settingsVersions(lineage).keys()) {
			// 职工带薪年休假条例 art.2: twelve months' continuous work first — the three-month hire is
			// outside the row; arts.3: 1–10 years' cumulative service is 5 days.
			assert.deepEqual(ladder(lineage, version, 'ANNUAL_LEAVE'), [null, 5, 5]);
			// 女职工劳动保护特别规定 art.7: 98 days, +15 difficult birth, +15 the second infant;
			// miscarriage 15 under four months, 42 from four; the city 生育假 adds 60 to a birth only.
			const days = (kind: string) =>
				ladder(lineage, version, 'MATERNITY_LEAVE', { ...FEMALE, event: { kind } })[1];
			assert.equal(days('BIRTH'), 98 + city.extra);
			assert.equal(days('DIFFICULT_BIRTH'), 98 + 15 + city.extra);
			// Twins are two children recorded on the event date; none recorded refuses (CN-N20).
			assert.throws(() => days('MULTIPLE_BIRTH'), /multiple birth/i);
			assert.throws(() => days('DIFFICULT_MULTIPLE_BIRTH'), /multiple birth/i);
			assert.equal(days('MISCARRIAGE_UNDER_4M'), 15);
			assert.equal(days('MISCARRIAGE_4M'), 42);
			assert.deepEqual(
				ladder(lineage, version, 'MATERNITY_LEAVE', { ...MALE, event: { kind: 'BIRTH' } }),
				[null, null, null]
			);
			// The partner's leave is the husband's (夫妻 / 男方), from day one of service.
			const BIRTH = { kind: 'BIRTH' } as const;
			assert.deepEqual(
				ladder(lineage, version, 'PATERNITY_LEAVE', { ...MARRIED_MALE, event: BIRTH }),
				[city.paternity, city.paternity, city.paternity]
			);
			assert.deepEqual(ladder(lineage, version, 'PATERNITY_LEAVE', { ...MALE, event: BIRTH }), [
				null,
				null,
				null
			]);
			// 国劳总薪字〔1980〕29号 1–3 days (the seed grants 3) plus the city's addition.
			assert.deepEqual(
				ladder(lineage, version, 'MARRIAGE_LEAVE', { event: { kind: 'MARRIAGE' } }),
				[city.marriage, city.marriage, city.marriage]
			);
		}
	});
}

// Vietnam maternity months (Labour Code 2019 art.139(1): 06 tháng; Law 41/2024 art.53(9): holidays
// and weekly rest days inside the period) are calendar months from the first leave day. The law
// states no day arithmetic; the register default ends the period the day before the same day of the
// closing month, or on that month's last day where it has none.
test('VN — a maternity grant of N months ends on the calendar, not after 30 × N days', () => {
	const span = (start: string, months: number) => {
		const end = monthsEnd(start, months);
		return [end, inclusiveDays(start, end)];
	};
	assert.deepEqual(span('2026-03-15', 6), ['2026-09-14', 184]);
	assert.deepEqual(span('2026-03-01', 6), ['2026-08-31', 184]);
	assert.deepEqual(span('2026-09-01', 6), ['2027-02-28', 181]);
	assert.deepEqual(span('2026-08-31', 6), ['2027-02-28', 182]);
	// Population Law 113/2025 art.14(1)(a): seven months for the second child from 1 July 2026.
	assert.deepEqual(span('2026-07-10', 7), ['2027-02-09', 215]);
	// A leap February: 30 August has no 30 February, so the period closes on the 29th; 29 August
	// has one, so it closes the day before.
	assert.equal(monthsEnd('2027-08-30', 6), '2028-02-29');
	assert.equal(monthsEnd('2027-08-29', 6), '2028-02-28');
	for (const row of leaveCatalogue('VN').filter((row) => row.code === 'MATERNITY_LEAVE'))
		assert.equal(row.entitlement.calendar_months, true);
});

test('JP — 労働基準法 §39 and 育児・介護休業法 leaves on every sealed version', () => {
	// 労働基準法施行規則 §24-3: five-hour days, so a week under 30 hours on `days` working days.
	const PART = (days: number) => ({
		week: { ordinary_hours_per_week: 5 * days, working_days_per_week: days }
	});
	for (const version of settingsVersions('JP').keys()) {
		// §39(1)–(3): 10, then 11, 12, 14, 16, 18, 20 at 0.5–6.5 years, each given six months early
		// (recorded default): the hire day 10, 30 months (the grant due at 2.5 years) 12, 70 months
		// (due at 5.5 years) 18.
		assert.deepEqual(ladder('JP', version, 'ANNUAL_LEAVE'), [10, 12, 18]);
		// §24-3, the same six-month-early shift: 4 days 7/…/9/…/13, 3 days 5/…/6/…/10,
		// 2 days 3/…/4/…/6, 1 day 1/…/2/…/3.
		assert.deepEqual(ladder('JP', version, 'ANNUAL_LEAVE', PART(4)), [7, 9, 13]);
		assert.deepEqual(ladder('JP', version, 'ANNUAL_LEAVE', PART(3)), [5, 6, 10]);
		assert.deepEqual(ladder('JP', version, 'ANNUAL_LEAVE', PART(2)), [3, 4, 6]);
		assert.deepEqual(ladder('JP', version, 'ANNUAL_LEAVE', PART(1)), [1, 2, 3]);
		// Five days a week at under 30 hours is no §24-3 worker: the full ladder.
		assert.deepEqual(ladder('JP', version, 'ANNUAL_LEAVE', PART(5)), [10, 12, 18]);
		// §65(1)–(2): 42 + 56 = 98 calendar days; 98 + 56 = 154 for a multiple pregnancy; a woman's.
		const birth = (kind: string) => ({ event: { kind } });
		assert.deepEqual(
			ladder('JP', version, 'MATERNITY_LEAVE', { ...FEMALE, ...birth('BIRTH') }),
			[98, 98, 98]
		);
		assert.deepEqual(
			ladder('JP', version, 'MATERNITY_LEAVE', { ...FEMALE, ...birth('MULTIPLE_BIRTH') }),
			[154, 154, 154]
		);
		assert.deepEqual(ladder('JP', version, 'MATERNITY_LEAVE', { ...MALE, ...birth('BIRTH') }), [
			null,
			null,
			null
		]);
		// 育児・介護休業法 §9-2: 28 days of 出生時育児休業 per birth or adoption, from day one.
		assert.deepEqual(
			ladder('JP', version, 'POSTNATAL_CHILDCARE_LEAVE', birth('BIRTH')),
			[28, 28, 28]
		);
		assert.deepEqual(
			ladder('JP', version, 'POSTNATAL_CHILDCARE_LEAVE', birth('ADOPTION')),
			[28, 28, 28]
		);
		// §5: 育児休業 is bounded by the child's age, which the engine does not meter.
		assert.deepEqual(ladder('JP', version, 'CHILDCARE_LEAVE'), [null, null, null]);
		// §11, §15(1): 93 days per 対象家族; only a family-care event opens it.
		assert.deepEqual(
			ladder('JP', version, 'FAMILY_CARE_LEAVE', birth('FAMILY_CARE')),
			[93, 93, 93]
		);
		assert.deepEqual(ladder('JP', version, 'FAMILY_CARE_LEAVE', birth('BIRTH')), [
			null,
			null,
			null
		]);
		// §16-5(1): 5 days a year, 10 for two or more 対象家族.
		const carers = (care_family_members: number) => ({ termsFacts: { care_family_members } });
		assert.deepEqual(ladder('JP', version, 'FAMILY_CARE_DAYS', carers(0)), [0, 0, 0]);
		assert.deepEqual(ladder('JP', version, 'FAMILY_CARE_DAYS', carers(1)), [5, 5, 5]);
		assert.deepEqual(ladder('JP', version, 'FAMILY_CARE_DAYS', carers(3)), [10, 10, 10]);
		// §16-2(1): 5 days a year, 10 for two or more children; a child under ten counts (default).
		const kids = (childAges: readonly number[]) => ({ childAges });
		assert.deepEqual(ladder('JP', version, 'CHILD_NURSING_LEAVE', kids([9])), [5, 5, 5]);
		assert.deepEqual(ladder('JP', version, 'CHILD_NURSING_LEAVE', kids([2, 9])), [10, 10, 10]);
		assert.deepEqual(ladder('JP', version, 'CHILD_NURSING_LEAVE', kids([10])), [0, 0, 0]);
	}
});

test('every sealed version of every lineage has a leave golden', () => {
	// Not "were the numbers checked" — the tests above do that — but "was any version skipped".
	const missing: string[] = [];
	for (const lineage of LINEAGES) {
		for (const version of settingsVersions(lineage)) {
			const key = `${lineage}:${String(version.id)}`;
			if (!asserted.has(key))
				missing.push(
					`${lineage} version in force from ${String(version.effective_range.start).slice(0, 10)}`
				);
		}
	}
	assert.deepEqual(missing, [], 'a sealed version with no leave golden is a law nothing checks');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// LIT-06 — the leave rounding and fraction steps are the row's stored configuration: the engine
// reads `scaled_rounding`, `hour_rounding`, `month_counts_when` and `hour_share_step`, and each
// lineage's seed carries the step it applied before the steps moved out of the engine.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** A 2026 calendar-year grant for a 2025 hire, asked on 30 June, optionally measured in hours. */
const grantOf = (
	rule: LeaveEntitlement,
	hourly?: { readonly grantHoursPerDay: number; readonly normalDailyHours: number }
) =>
	computedEntitlement({
		rule,
		window: { start: '2026-01-01', end: '2026-12-31' },
		asOf: '2026-06-30',
		hireDate: '2025-01-01',
		exitDate: null,
		servedOn: () => true,
		eligibleOn: () => true,
		personOn: (date) =>
			personContext({
				employee: { date_of_birth: '1990-01-01' },
				employment: { service_start: '2025-01-01' },
				terms: null,
				asOf: date
			}),
		hourlyBasisOn: hourly == null ? undefined : () => hourly
	}).entitlement;

const UPFRONT_SEVEN: LeaveEntitlement = {
	availability: 'UPFRONT',
	proration: 'NONE',
	year_start_month: 1,
	bands: [{ eligibility: '', days: 7 }]
};

test('LIT-06 — a grant the scale moved rounds by the row’s scaled_rounding, not its day rounding', () => {
	// 7 × 0.6 = 4.2 days. Up to the half day: 8.4 half days → 9 → 4.5. Down to the day: 4.
	// Absent is the exact figure. The row's WHOLE_DAY (4.2 → 4) does not reach a scaled grant.
	const scaled = { ...UPFRONT_SEVEN, scale: '0.6', rounding: 'WHOLE_DAY' } as const;
	assert.equal(grantOf({ ...scaled, scaled_rounding: { step: 0.5, mode: 'UP' } }), 4.5);
	assert.equal(grantOf({ ...scaled, scaled_rounding: { step: 1, mode: 'DOWN' } }), 4);
	assert.ok(Math.abs(grantOf(scaled)! - 4.2) < 1e-9);
	// Unscaled, the named day rounding stands: 4.2 whole days, a fraction under a half dropped.
	assert.equal(
		grantOf({ ...UPFRONT_SEVEN, rounding: 'WHOLE_DAY', bands: [{ eligibility: '', days: 4.2 }] }),
		4
	);
});

test('LIT-06 — an hourly grant rounds by the row’s hour_rounding', () => {
	// 7 days × (20 / 44 × 8) hours = 1120 / 44 = 25.4545… hours. Up to the thousandth: 25.455.
	// Down to the hour: 25. Absent is exact.
	const hourly = { grantHoursPerDay: (20 / 44) * 8, normalDailyHours: 5 };
	const rule = { ...UPFRONT_SEVEN, requires_hourly_for_part_time: true };
	assert.equal(grantOf({ ...rule, hour_rounding: { step: 0.001, mode: 'UP' } }, hourly), 25.455);
	assert.equal(grantOf({ ...rule, hour_rounding: { step: 1, mode: 'DOWN' } }, hourly), 25);
	assert.ok(Math.abs(grantOf(rule, hourly)! - 1120 / 44) < 1e-9);
});

test('LIT-06 — a HALF_MONTHS month counts at the row’s month_counts_when share', () => {
	const annual = leaveCatalogue('VN').find((row) => row.code === 'ANNUAL_LEAVE')!.entitlement;
	const partYear = (rule: LeaveEntitlement) =>
		computedEntitlement({
			rule,
			window: { start: '2026-01-01', end: '2026-12-31' },
			asOf: '2026-12-31',
			hireDate: '2026-01-15',
			exitDate: null,
			servedOn: () => true,
			eligibleOn: () => true,
			personOn: (date) =>
				personContext({
					employee: { date_of_birth: '1990-01-01' },
					employment: { service_start: '2026-01-15' },
					terms: null,
					asOf: date
				})
		}).entitlement;
	// A 15 January joiner holds 17 of January's 31 days: 17 ≥ 0.5 × 31 = 15.5 counts January (12
	// months → 12 days); 17 < 0.6 × 31 = 18.6 does not (11 months → 11 days).
	assert.equal(partYear(annual), 12);
	assert.equal(partYear({ ...annual, month_counts_when: 0.6 }), 11);
	assert.throws(
		() => partYear({ ...annual, month_counts_when: null }),
		/share of days a month counts at/
	);
});

test('LIT-06 — leave by the hour charges the share of the shift to the row’s hour_share_step', () => {
	// The fixture's shift is 09:00–18:00 with an hour's break: 480 paid minutes, 8 hours.
	const share = (hours: number, step: number | null) => {
		const context = leaveContext();
		context.catalogues.push({
			...context.catalogues[0]!,
			id: id(90),
			code: 'HOURLY',
			unit: 'HOUR',
			entitlement: { ...UPFRONT_SEVEN, hour_share_step: step }
		});
		return planLeaveActivity(
			context,
			{ ...submission({ ...timeOff('2026-02-03'), hours }, 'H1'), catalogue_id: id(90) },
			id(91)
		).days;
	};
	// 3.1 / 8 = 0.3875 = 3.1 eighths → 3 eighths = 0.375; absent, the exact 0.3875.
	assert.equal(share(3.1, 0.125), 0.375);
	assert.equal(share(3.1, null), 0.3875);
	// 0.4 / 8 = 0.05 = 0.4 eighths → 0, held at one step: 0.125.
	assert.equal(share(0.4, 0.125), 0.125);
	// A quarter-day step: 3.1 / 8 = 1.55 quarters → 2 → 0.5.
	assert.equal(share(3.1, 0.25), 0.5);
});

test('LIT-06 — every lineage seeds the step its rows applied before the steps were stored', () => {
	for (const lineage of LINEAGES)
		for (const row of leaveCatalogue(lineage)) {
			const rule = row.entitlement;
			const where = `${lineage} ${row.code}`;
			// A scaled grant was rounded up to the half day, never below the hours owed.
			if ((rule.scale ?? '').trim() !== '')
				assert.deepEqual(rule.scaled_rounding, { step: 0.5, mode: 'UP' }, where);
			// An hourly grant was rounded up to the thousandth of an hour.
			if (rule.requires_hourly_for_part_time === true)
				assert.deepEqual(rule.hour_rounding, { step: 0.001, mode: 'UP' }, where);
			// VN Decree 145/2020 art.66(2): a part month counts at half its days.
			if (rule.proration === 'HALF_MONTHS') assert.equal(rule.month_counts_when, 0.5, where);
			// An hourly row charged to the eighth of the shift (an hour of an eight-hour day).
			if (row.unit === 'HOUR') assert.equal(rule.hour_share_step, 0.125, where);
		}
});
