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
import { computedEntitlement, leaveWindowOf } from '../src/lib/leave/entitlement.ts';
import { isEligible, personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';
import {
	LINEAGES,
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
	/** Completed years of each child on the entitlement date; `children.under(n)` counts these. */
	readonly childAges?: readonly number[];
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
				solo_parent: facts.solo_parent ?? null
			},
			employment: { hire_date: hire },
			terms: {
				residency_status: facts.citizenship ?? null,
				work_classification: facts.classification ?? null
			},
			children: (facts.childAges ?? []).map((age) => ({
				child_birthdate: bornFor(age, asOf)
			})),
			asOf: date
		});
	if (!isEligible(row.eligibility, personOn(asOf))) return null;
	return computedEntitlement({
		rule: row.entitlement,
		window: leaveWindowOf(asOf, row.entitlement.year_start_month),
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
			// s.37(1): ninety-eight consecutive days, and the row is confined to a female employee.
			assert.deepEqual(ladder(lineage, version, 'MATERNITY_LEAVE', FEMALE), [98, 98, 98]);
			assert.deepEqual(ladder(lineage, version, 'MATERNITY_LEAVE', MALE), [null, null, null]);
			// s.60FA(1) with (3)(a): seven days, a married male employee, twelve months' service —
			// so the three-month case is outside the row, not on a zero band.
			assert.deepEqual(ladder(lineage, version, 'PATERNITY_LEAVE', MARRIED_MALE), [null, 7, 7]);
			// An unmarried father is outside it at every service length.
			assert.deepEqual(ladder(lineage, version, 'PATERNITY_LEAVE', MALE), [null, null, null]);
		}
	});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Philippines — Labor Code art.95; RA 11210, RA 8187, RA 8972 as amended by RA 11861, RA 9262,
// RA 9710. One sealed version.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('Philippines — service incentive leave and the special statutory leaves', () => {
	// art.95: five days after one year. Below that no band matches at all, which the engine reports
	// as nought days rather than as an absent entitlement.
	assert.deepEqual(ladder('PH', 0, 'ANNUAL_LEAVE'), [0, 5, 5]);
	// The row excludes managerial staff outright, whatever the service.
	assert.deepEqual(ladder('PH', 0, 'ANNUAL_LEAVE', { classification: 'MANAGERIAL' }), [
		null,
		null,
		null
	]);
	// RA 11210: 105 days, and 120 for a qualified solo parent — the most specific band is first.
	assert.deepEqual(
		ladder('PH', 0, 'MATERNITY_LEAVE', { ...FEMALE, solo_parent: true }),
		[120, 120, 120]
	);
	assert.deepEqual(ladder('PH', 0, 'MATERNITY_LEAVE', FEMALE), [105, 105, 105]);
	// RA 8187: seven days, married male employee, no service condition.
	assert.deepEqual(ladder('PH', 0, 'PATERNITY_LEAVE', MARRIED_MALE), [7, 7, 7]);
	assert.deepEqual(ladder('PH', 0, 'PATERNITY_LEAVE', FEMALE), [null, null, null]);
	// RA 8972 as amended: seven working days after six months' service, solo parents only.
	assert.deepEqual(ladder('PH', 0, 'SOLO_PARENT_LEAVE', { solo_parent: true }), [0, 7, 7]);
	assert.deepEqual(ladder('PH', 0, 'SOLO_PARENT_LEAVE', {}), [null, null, null]);
	// RA 9262: ten days. RA 9710: sixty days after six months.
	assert.deepEqual(ladder('PH', 0, 'VAWC_LEAVE', FEMALE), [10, 10, 10]);
	assert.deepEqual(ladder('PH', 0, 'SPECIAL_LEAVE_FOR_WOMEN', FEMALE), [0, 60, 60]);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Singapore — Employment Act 1968 ss.43 and 89; the Child Development Co-Savings Act. Three
// sealed versions, and the 1 April 2026 one exists for exactly one change: shared parental leave.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('Singapore — the service ladders and the family schemes, on all three sealed versions', () => {
	for (const version of [0, 1, 2]) {
		// s.43(1): seven days in the first year, one more a year to fourteen — after three months.
		// Seventy months is the "sixty or more" rung, twelve days, not the seventy-two-month thirteen.
		assert.deepEqual(ladder('SG', version, 'ANNUAL_LEAVE'), [7, 9, 12]);
		// s.89(1): five outpatient days at three months rising to fourteen at six.
		assert.deepEqual(ladder('SG', version, 'SICK_LEAVE'), [5, 14, 14]);
		// s.89(1)(b): fifteen hospitalisation days at three months rising to sixty at six.
		assert.deepEqual(ladder('SG', version, 'HOSPITALIZATION_LEAVE'), [15, 60, 60]);
		// CDCSA: four weeks of paternity leave, three months' service, a male employee.
		assert.deepEqual(ladder('SG', version, 'PATERNITY_LEAVE', MALE), [28, 28, 28]);
		// Sixteen weeks for the mother of a citizen child; the twelve-week Employment Act fallback
		// otherwise. The row is female-only.
		assert.deepEqual(
			ladder('SG', version, 'MATERNITY_LEAVE', { ...FEMALE, citizenship: 'CITIZEN' }),
			[112, 112, 112]
		);
		assert.deepEqual(
			ladder('SG', version, 'MATERNITY_LEAVE', { ...FEMALE, citizenship: 'FOREIGNER' }),
			[84, 84, 84]
		);
		assert.deepEqual(ladder('SG', version, 'MATERNITY_LEAVE', MALE), [null, null, null]);
		// Childcare leave: six days for a parent of a citizen child under seven, two otherwise.
		assert.deepEqual(
			ladder('SG', version, 'CHILDCARE_LEAVE', { citizenship: 'CITIZEN', childAges: [3] }),
			[6, 6, 6]
		);
		assert.deepEqual(
			ladder('SG', version, 'CHILDCARE_LEAVE', { citizenship: 'FOREIGNER', childAges: [3] }),
			[2, 2, 2]
		);
		// A child of nine reaches extended childcare leave instead, and only while none is under 7.
		assert.deepEqual(
			ladder('SG', version, 'CHILDCARE_LEAVE', { citizenship: 'CITIZEN', childAges: [9] }),
			[null, null, null]
		);
		// Extended childcare leave is asserted on its own below: the engine cannot evaluate the
		// predicate that row is written with.
		// Six days of unpaid infant care for a parent of a child under two; twelve weeks of adoption
		// leave for an adoptive mother.
		assert.deepEqual(
			ladder('SG', version, 'UNPAID_INFANT_CARE_LEAVE', {
				citizenship: 'CITIZEN',
				childAges: [1]
			}),
			[6, 6, 6]
		);
		assert.deepEqual(
			ladder('SG', version, 'ADOPTION_LEAVE', { ...FEMALE, citizenship: 'CITIZEN' }),
			[84, 84, 84]
		);
		// National service leave is unmetered: the engine reports no entitlement figure at all.
		assert.deepEqual(ladder('SG', version, 'NS_LEAVE', { ...MALE, citizenship: 'CITIZEN' }), [
			null,
			null,
			null
		]);
	}
	// The whole point of the 1 April 2026 version: shared parental leave goes from six weeks to ten.
	assert.deepEqual(ladder('SG', 0, 'SHARED_PARENTAL_LEAVE'), [42, 42, 42]);
	assert.deepEqual(ladder('SG', 1, 'SHARED_PARENTAL_LEAVE'), [70, 70, 70]);
	assert.deepEqual(ladder('SG', 2, 'SHARED_PARENTAL_LEAVE'), [70, 70, 70]);
});

test('Singapore — extended childcare leave, for a parent whose youngest child is seven or over', () => {
	// The seeded rule is `children.under(13) >= 1 && children.under(7) == 0`, and the `== 0` half
	// is what `under` returning a CEL `int` makes answerable at all.
	for (const version of [0, 1, 2]) {
		// Employment Act 1968 / CDCSA: two days for a parent whose children are all seven or over
		// but at least one is under thirteen.
		assert.deepEqual(
			ladder('SG', version, 'EXTENDED_CHILDCARE_LEAVE', {
				citizenship: 'CITIZEN',
				childAges: [9]
			}),
			[2, 2, 2]
		);
		// A child under seven puts the parent back on ordinary childcare leave instead.
		assert.deepEqual(
			ladder('SG', version, 'EXTENDED_CHILDCARE_LEAVE', {
				citizenship: 'CITIZEN',
				childAges: [3, 9]
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
		// art.113(1)(b): fourteen for a minor, and for the arduous-work cohort.
		assert.deepEqual(ladder('VN', version, 'ANNUAL_LEAVE', { age: 17 }), [14, 14, 14]);
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
		// above; forty / fifty / seventy in the arduous cohort. Seventy months is inside the first
		// rung of both, because the bands read service with this employer (residue 11).
		assert.deepEqual(ladder('VN', version, 'SICK_LEAVE'), [30, 30, 30]);
		assert.deepEqual(
			ladder('VN', version, 'SICK_LEAVE', { classification: 'ARDUOUS' }),
			[40, 40, 40]
		);
		// art.139(1) and art.53(2), and the art.115 personal-leave pools.
		assert.deepEqual(ladder('VN', version, 'MATERNITY_LEAVE', FEMALE), [180, 180, 180]);
		assert.deepEqual(ladder('VN', version, 'MATERNITY_LEAVE', MALE), [null, null, null]);
		assert.deepEqual(ladder('VN', version, 'PATERNITY_LEAVE', MALE), [5, 5, 5]);
		assert.deepEqual(ladder('VN', version, 'MARRIAGE_LEAVE'), [3, 3, 3]);
		assert.deepEqual(ladder('VN', version, 'CHILD_MARRIAGE_LEAVE'), [1, 1, 1]);
		assert.deepEqual(ladder('VN', version, 'BEREAVEMENT_LEAVE'), [3, 3, 3]);
		assert.deepEqual(ladder('VN', version, 'BEREAVEMENT_LEAVE_UNPAID'), [1, 1, 1]);
		// art.112(1): eleven paid public holidays, seeded as a leave head of that size.
		assert.deepEqual(ladder('VN', version, 'PUBLIC_HOLIDAY'), [11, 11, 11]);
	}
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Taiwan — 勞動基準法第38條, 第43條, 第50條 and 性別平等工作法. Two sealed versions; the leave
// ladder is identical on both, only the insured-salary grade tables move on 1 January 2026.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('Taiwan — the §38 annual ladder and the 性平法 entitlements, on both sealed versions', () => {
	for (const version of [0, 1]) {
		// 第38條: nothing under six months, three days at six, seven at one year, ten at two, then
		// fourteen at three and fifteen at five. Thirty months is the two-year rung, seventy the
		// five-year one.
		assert.deepEqual(ladder('TW', version, 'ANNUAL_LEAVE'), [0, 10, 15]);
		// 勞工請假規則第4條: thirty days of ordinary sickness leave; 第7條: fourteen days of personal
		// leave, unpaid. 第2條 and 第3條: eight days each for marriage and bereavement.
		assert.deepEqual(ladder('TW', version, 'SICK_LEAVE'), [30, 30, 30]);
		assert.deepEqual(ladder('TW', version, 'PERSONAL_LEAVE'), [14, 14, 14]);
		assert.deepEqual(ladder('TW', version, 'MARRIAGE_LEAVE'), [8, 8, 8]);
		assert.deepEqual(ladder('TW', version, 'BEREAVEMENT_LEAVE'), [8, 8, 8]);
		// 第50條: eight weeks of maternity leave. 性平法: seven days of paternity and prenatal
		// checkup leave, one menstrual day a month, seven days of family care leave.
		assert.deepEqual(ladder('TW', version, 'MATERNITY_LEAVE', FEMALE), [56, 56, 56]);
		assert.deepEqual(ladder('TW', version, 'MATERNITY_LEAVE', MALE), [null, null, null]);
		assert.deepEqual(ladder('TW', version, 'PATERNITY_LEAVE'), [7, 7, 7]);
		assert.deepEqual(ladder('TW', version, 'PRENATAL_CHECKUP_LEAVE', FEMALE), [7, 7, 7]);
		assert.deepEqual(ladder('TW', version, 'MENSTRUAL_LEAVE', FEMALE), [1, 1, 1]);
		assert.deepEqual(ladder('TW', version, 'FAMILY_CARE_LEAVE'), [7, 7, 7]);
		// 育嬰留職停薪: two years, after six months' service — so the three-month case is outside it.
		assert.deepEqual(ladder('TW', version, 'PARENTAL_LEAVE'), [null, 730, 730]);
		// 職災醫療期間 and 哺乳時間 are unmetered.
		assert.deepEqual(ladder('TW', version, 'OCCUPATIONAL_INJURY_LEAVE'), [null, null, null]);
		assert.deepEqual(ladder('TW', version, 'BREASTFEEDING_TIME', { ...FEMALE, childAges: [1] }), [
			null,
			null,
			null
		]);
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
		assert.deepEqual(ladder('ID', version, 'MATERNITY_LEAVE', FEMALE), [91, 91, 91]);
		assert.deepEqual(ladder('ID', version, 'MATERNITY_LEAVE', MALE), [null, null, null]);
		assert.deepEqual(ladder('ID', version, 'PATERNITY_LEAVE', MALE), [2, 2, 2]);
		assert.deepEqual(ladder('ID', version, 'MISCARRIAGE_LEAVE', FEMALE), [45, 45, 45]);
		// art.81: two menstrual days, female employees only.
		assert.deepEqual(ladder('ID', version, 'MENSTRUAL_LEAVE', FEMALE), [2, 2, 2]);
		assert.deepEqual(ladder('ID', version, 'MENSTRUAL_LEAVE', MALE), [null, null, null]);
		// art.93(4): the family-event heads, and the SKB 3 Menteri joint leave for 2026.
		assert.deepEqual(ladder('ID', version, 'MARRIAGE_LEAVE'), [3, 3, 3]);
		assert.deepEqual(ladder('ID', version, 'CHILD_MARRIAGE_LEAVE'), [2, 2, 2]);
		assert.deepEqual(ladder('ID', version, 'CHILD_CIRCUMCISION_LEAVE'), [2, 2, 2]);
		assert.deepEqual(ladder('ID', version, 'CHILD_BAPTISM_LEAVE'), [2, 2, 2]);
		assert.deepEqual(ladder('ID', version, 'BEREAVEMENT_LEAVE'), [2, 2, 2]);
		assert.deepEqual(ladder('ID', version, 'BEREAVEMENT_HOUSEHOLD_LEAVE'), [1, 1, 1]);
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
