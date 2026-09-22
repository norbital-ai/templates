/**
 * Round 3, letter K — a wage order commencing inside the pay period governs its own days only.
 *
 * Every expected figure is derived by hand in the comment beside it from the instrument named;
 * none was read off an engine run.
 *
 *   Wage Order NCR-26 (nwpc.dole.gov.ph/ncr/): ₱695 a day non-agriculture from 18 July 2025.
 *   Wage Order NCR-28 (DOLE, https://dole.gov.ph/news/dole-issues-new-ncr-wage-order/; PNA
 *     https://www.pna.gov.ph/articles/1283906): ₱695 + ₱60 = ₱755 a day from 26 September 2026.
 *   RR 11-2018 s.2.78.1(B)(13) (as RR 10-2008): an MWE is one paid the statutory minimum wage,
 *     "the rate fixed by the RTWPB" — the rate in force on the day, so a wage order binds from its
 *     effective date and not back to the start of the month it lands in.
 *
 * Fixture: NCR, five-day pattern, daily-rated. The seed states each floor as a month at 313 days
 * (695 × 313 ÷ 12 = 18,127.92; 755 × 313 ÷ 12 = 19,692.92) and restates it on a five-day worker's
 * 261 days (`wages.scale` 261 ÷ 313): ₱695 → 15,116.25, ₱755 → 16,421.25. A daily rate's month is
 * rate × 261 ÷ 12 = rate × 21.75: ₱695 → 15,116.25; ₱720 → 15,660.
 *
 * September 2026 is 1–25 under NCR-26 (25 days) and 26–30 under NCR-28 (5 days). The floor a
 * scheme reads as `wage_floor` is each day's floor averaged over the month's 30 days:
 * (15,116.25 × 25 + 16,421.25 × 5) ÷ 30 = (377,906.25 + 82,106.25) ÷ 30 = 15,333.75. RA 9504's
 * exemption does not read that average (round 4, letter N): it attaches to the pay for the days on
 * which the employee is an MWE (`person.wage_floor_pay`), so September splits at the 26th.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { assessStatutory, buildStatutory } from './fixtures/statutory-world.ts';

const PEOPLE = [
	{ key: 'NCR-695', wage: 695, pay_frequency: 'DAILY' },
	{ key: 'NCR-720', wage: 720, pay_frequency: 'DAILY' }
] as const;

const warnings = (period: string) =>
	buildStatutory({ code: 'PH', period, region: 'NCR', people: PEOPLE }).warnings.filter((line) =>
		line.startsWith('MINIMUM_WAGE_BELOW')
	);

test('PH — NCR-28 from 26 September 2026: a ₱695 daily rate is below the floor on 26–30 September only', () => {
	// August: 15,116.25 paid against NCR-26's 15,116.25 — at the floor, not below it.
	assert.deepEqual(warnings('2026-08'), []);
	// September: 1–25 hold ₱695 to NCR-26 (met, as in August); 26–30 hold it to NCR-28's 16,421.25
	// (15,116.25 < 16,421.25), so the warning names those five days. ₱720 (15,660) clears ₱695's
	// floor and misses ₱755's on the same five days.
	const september = warnings('2026-09');
	assert.equal(september.length, 2, september.join('\n'));
	assert.match(
		september[0]!,
		/NCR-695 is contracted at 15116\.25 a month, below the NCR minimum wage of 19692\.92 the version states from 2026-09-26 to 2026-09-30\./
	);
	assert.match(september[1]!, /NCR-720 .* from 2026-09-26 to 2026-09-30\./);
	// October is wholly NCR-28: the warning stands for the whole month, with no dates.
	const october = warnings('2026-10');
	assert.equal(october.length, 2, october.join('\n'));
	assert.doesNotMatch(october[0]!, / from 2026-/);
});

test('PH — RA 9504 MWE status in September 2026 splits at NCR-28: taxed to the 25th, exempt from the 26th', () => {
	const wtax = (period: string, key: string) =>
		assessStatutory({ code: 'PH', period, region: 'NCR', people: PEOPLE }).get(key)!.get('WTAX');
	// ₱695: 15,116.25 ≤ 15,116.25 under NCR-26 and ≤ 16,421.25 under NCR-28 — an MWE on every day
	// of August, September and October; the whole WTAX base is exempt and the scheme is skipped.
	for (const period of ['2026-08', '2026-09', '2026-10'])
		assert.equal(wtax(period, 'NCR-695'), undefined, period);
	// ₱720 on the fixture's Mon–Fri pattern, full attendance, paid per day worked.
	// August 2026: 21 weekdays × ₱720 = ₱15,120, all above NCR-26 (15,660 > 15,116.25) — taxed whole.
	assert.equal(wtax('2026-08', 'NCR-720')?.base, 15_120);
	// September 2026 (the 1st a Tuesday): weekdays 1–25 are 4 + 5 + 5 + 5 = 19, 28–30 are 3; basic
	// 22 × 720 = 15,840. The 19 days to the 25th are above NCR-26's floor — taxed; the 3 from the
	// 26th are at or below NCR-28's (15,660 ≤ 16,421.25) — exempt, 3 × 720 = 2,160. The base is
	// 15,840 − 2,160 = 19 × 720 = 13,680.
	assert.equal(wtax('2026-09', 'NCR-720')?.base, 13_680);
	// October is wholly NCR-28: an MWE every day, nothing withheld.
	assert.equal(wtax('2026-10', 'NCR-720'), undefined);
});
