/**
 * Statutory leave entitlements, per jurisdiction, against the law the seed bank transcribes.
 *
 * Same contract as `statutory-golden.test.ts`: the rows are the bank's own `leave_catalogue` JSON,
 * snapshotted under `tests/fixtures/statutory/<CODE>/` by `scripts/refresh-statutory-fixtures.mjs`,
 * and every expected number is the one the bank's per-lineage test
 * (`seed_bank/norbital_hr/statutory/<code>-lineage.test.mjs`) derives from those rows. The law is
 * the expectation; `computedEntitlement` is what is being measured.
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
import { isEligible, personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';
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
		readonly date?: string;
	};
	/**
	 * Completed years of age. It defaults to 40 rather than being left unrecorded, because an
	 * unrecorded birth date reads as `employee.age == 0` and Vietnam's `employee.age < 18` minor
	 * band would then claim every person the fixture did not think to age.
	 */
	readonly age?: number;
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
				statutory_work_category: facts.statutory_work_category ?? null
			},
			children: (facts.childAges ?? []).map((age, index) => ({
				child_birthdate: bornFor(age, asOf),
				citizenship: facts.childCitizenship?.[index] ?? null,
				shared_parental_weeks: facts.childSharedWeeks?.[index] ?? null
			})),
			event: facts.event ?? null,
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
		window: leaveWindowOf(asOf, row.entitlement),
		asOf,
		hireDate: hire,
		exitDate: null,
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
// Both lineages carry three sealed versions and the leave ladder does not move across any seam.
// ─────────────────────────────────────────────────────────────────────────────────────────────

for (const lineage of ['MY', 'MY-nihon'] as const)
	test(`${lineage} — the Employment Act leave ladders, on all three sealed versions`, () => {
		for (const version of [0, 1, 2]) {
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
	// The 2026-01-01 version changes no leave law: the same ladder on both sealed versions.
	const BIRTH = { kind: 'BIRTH' } as const;
	for (const version of [0, 1, 2]) {
		assert.deepEqual(ladder('PH', version, 'ANNUAL_LEAVE'), [0, 5, 5]);
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
	// first — and 60 for a miscarriage; for an SSS member of three months' contributions.
	const SSS = { registrations: [{ code: 'SSS', since: '2020-01-01' }] } as const;
	assert.deepEqual(
		ladder('PH', 0, 'MATERNITY_LEAVE', { ...FEMALE, ...SSS, solo_parent: true, event: BIRTH }),
		[120, 120, 120]
	);
	assert.deepEqual(
		ladder('PH', 0, 'MATERNITY_LEAVE', { ...FEMALE, ...SSS, event: BIRTH }),
		[105, 105, 105]
	);
	assert.deepEqual(
		ladder('PH', 0, 'MATERNITY_LEAVE', { ...FEMALE, ...SSS, event: { kind: 'MISCARRIAGE' } }),
		[60, 60, 60]
	);
	assert.deepEqual(ladder('PH', 0, 'MATERNITY_LEAVE', { ...FEMALE, event: BIRTH }), [
		null,
		null,
		null
	]);
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

test('Singapore — the service ladders and the family schemes, on all four sealed versions', () => {
	for (const version of [0, 1, 2, 3]) {
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
		// A child of nine reaches extended childcare leave instead, and only while none is under 7.
		assert.deepEqual(
			ladder('SG', version, 'CHILDCARE_LEAVE', { childAges: [9], childCitizenship: ['CITIZEN'] }),
			[null, null, null]
		);
		// Extended childcare leave is asserted on its own below: the engine cannot evaluate the
		// predicate that row is written with.
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
	// CDCA s.12C: a citizen child aged seven to twelve, and no citizen child under seven — the
	// seeded rule is `children.citizens_under(13) >= 1 && children.citizens_under(7) == 0`, and
	// the `== 0` half is what the count returning a CEL `int` makes answerable at all.
	for (const version of [0, 1, 2]) {
		assert.deepEqual(
			ladder('SG', version, 'EXTENDED_CHILDCARE_LEAVE', {
				citizenship: 'CITIZEN',
				childAges: [9],
				childCitizenship: ['CITIZEN']
			}),
			[2, 2, 2]
		);
		// A citizen child under seven puts the parent back on ordinary childcare leave instead.
		assert.deepEqual(
			ladder('SG', version, 'EXTENDED_CHILDCARE_LEAVE', {
				citizenship: 'CITIZEN',
				childAges: [3, 9],
				childCitizenship: ['CITIZEN', 'CITIZEN']
			}),
			[null, null, null]
		);
		// The child must be a citizen: a non-citizen nine-year-old carries no extended leave.
		assert.deepEqual(
			ladder('SG', version, 'EXTENDED_CHILDCARE_LEAVE', {
				citizenship: 'CITIZEN',
				childAges: [9],
				childCitizenship: ['FOREIGNER']
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
	for (const version of [0, 1, 2]) {
		// art.113(1)(a) with art.114: twelve days, one more for every five years with the employer.
		// Seventy months is past sixty, so it is thirteen.
		assert.deepEqual(ladder('VN', version, 'ANNUAL_LEAVE'), [12, 12, 13]);
		// art.113(1)(b): fourteen for a minor, a person with a disability, and the arduous-work
		// cohort — each on the art.114 ladder too, so seventy months is fifteen.
		assert.deepEqual(ladder('VN', version, 'ANNUAL_LEAVE', { age: 17 }), [14, 14, 15]);
		assert.deepEqual(ladder('VN', version, 'ANNUAL_LEAVE', { disabled: true }), [14, 14, 15]);
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
		// contributions — six months, seven for twins; five days, seven for a caesarean, ten for
		// twins, fourteen for twins by caesarean — and the art.115 personal leaves per event.
		const SI_1Y = { registrations: [{ code: 'SI', since: '2024-01-01' }] } as const;
		const MOTHER = { ...FEMALE, ...SI_1Y } as const;
		assert.deepEqual(
			ladder('VN', version, 'MATERNITY_LEAVE', { ...MOTHER, event: { kind: 'BIRTH' } }),
			[180, 180, 180]
		);
		assert.deepEqual(
			ladder('VN', version, 'MATERNITY_LEAVE', { ...MOTHER, event: { kind: 'MULTIPLE_BIRTH' } }),
			[210, 210, 210]
		);
		// Labour Code art.139: the six months' leave is every mother's; a mother short of the six
		// contribution months is on leave without the fund's allowance, not without the leave.
		assert.deepEqual(
			ladder('VN', version, 'MATERNITY_LEAVE', { ...FEMALE, event: { kind: 'BIRTH' } }),
			[180, 180, 180]
		);
		assert.deepEqual(
			ladder('VN', version, 'MATERNITY_LEAVE', { ...MALE, event: { kind: 'BIRTH' } }),
			[null, null, null]
		);
		assert.deepEqual(
			ladder('VN', version, 'PATERNITY_LEAVE', { ...MALE, event: { kind: 'BIRTH' } }),
			[5, 5, 5]
		);
		assert.deepEqual(
			ladder('VN', version, 'PATERNITY_LEAVE', { ...MALE, event: { kind: 'BIRTH_SURGERY' } }),
			[7, 7, 7]
		);
		assert.deepEqual(
			ladder('VN', version, 'PATERNITY_LEAVE', { ...MALE, event: { kind: 'MULTIPLE_BIRTH' } }),
			[10, 10, 10]
		);
		assert.deepEqual(
			ladder('VN', version, 'PATERNITY_LEAVE', {
				...MALE,
				event: { kind: 'MULTIPLE_BIRTH_SURGERY' }
			}),
			[14, 14, 14]
		);
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
		// third version, from 1 July 2026, when Nghị quyết 28/2026/QH16 điều 2 makes 24 November each
		// year Ngày Văn hóa Việt Nam, "nghỉ làm việc và hưởng nguyên lương". The resolution stands
		// alone rather than amending art.112(1), which still reads eleven.
		assert.deepEqual(
			ladder('VN', version, 'PUBLIC_HOLIDAY'),
			version === 2 ? [12, 12, 12] : [11, 11, 11]
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

test('Taiwan — the §38 annual ladder and the 性平法 entitlements, on all three sealed versions', () => {
	// The 1 January 2027 version moves the labour-insurance rate alone; its leave rows are clones.
	for (const version of [0, 1, 2]) {
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
