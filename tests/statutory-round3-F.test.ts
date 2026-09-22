/**
 * Round 3, letter F — a law that moves on a date is a new sealed version from that date.
 *
 *   PH RR 29-2025 s.3 (in force fifteen days after its 22 December 2025 posting → 6 January 2026):
 *     https://bir-cdn.bir.gov.ph/BIR/pdf/RR%20No.%2029-2025.pdf
 *   PH Wage Order NCR-DW-06 (published 22 January, effective 7 February 2026): nwpc.dole.gov.ph/ncr/
 *   SG Retirement and Re-employment Act 1993, ages 64 / 69 from 1 July 2026:
 *     https://www.mom.gov.sg/employment-practices/retirement and /re-employment
 *   VN Decree 105/2026/NĐ-CP (in force 16 May 2026, union-fee timing):
 *     https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-dinh-105-2026-nd-cp-ve-quy-dinh-huong-dan-thi-hanh-tai-chinh-cong-doan-119260414115729178.htm
 *
 * The payroll figures each new version prices are in the lineage goldens (so
 * `assertEveryVersionPriced` sees them); this file pins the dated values on each side of the seam.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { contributionSchemes, settingsVersions, type Lineage } from './fixtures/statutory-world.ts';
import { settingsInForce } from '../src/lib/jurisdiction_settings.ts';

const inForce = (code: Lineage, day: string) => {
	const version = settingsInForce(settingsVersions(code), code, day);
	assert.ok(version, `${code} has a version on ${day}`);
	return version;
};
const obligation = (code: Lineage, day: string, name: string) =>
	(inForce(code, day).obligations as { code: string; timing: string }[]).find(
		(row) => row.code === name
	)!;

test('every lineage F touched is one unbroken timeline: each version ends the day the next begins', () => {
	for (const code of ['PH', 'SG', 'VN'] as const) {
		const versions = settingsVersions(code).toSorted((a, b) =>
			String(a.effective_range.start).localeCompare(String(b.effective_range.start))
		);
		for (const [index, version] of versions.slice(1).entries())
			assert.equal(versions[index]!.effective_range.end, version.effective_range.start, code);
	}
});

test('PH — RR 29-2025 commences on 6 January 2026: ₱2,000 rice and 10 days before, ₱2,500 and 12 from', () => {
	// RR 11-2018 s.2.78.1(A)(3)(a), (d): unused vacation leave cash-out to 10 days a year, rice
	// ₱2,000 a month. RR 29-2025 s.1(a), (d): 12 days, ₱2,500. The WTAX base states both figures.
	const wtax = (day: string) =>
		contributionSchemes('PH').find(
			(row) => row.code === 'WTAX' && row.settings_id === inForce('PH', day).id
		)!.assessed_on as string;
	for (const [day, rice, days] of [
		['2026-01-05', '2000.0', '10.0'],
		['2026-01-06', '2500.0', '12.0']
	] as const) {
		const formula = wtax(day);
		assert.ok(formula.includes(`earned_monthly_excess('WTAX.RICE', ${rice})`), day);
		assert.ok(formula.includes(`annual_quantity_exempt('ANNUAL_LEAVE_ENCASHMENT', ${days})`), day);
	}
});

test('PH — the NCR kasambahay floor is ₱7,000 to 6 February 2026 and ₱7,800 from the 7th', () => {
	// NCR-DW-05 ₱7,000; NCR-DW-06 s.1: ₱7,000 + ₱800 = ₱7,800 a month, effective 7 February 2026.
	const floor = (day: string) =>
		inForce('PH', day).work_rules.wages.by_employment_type.DOMESTIC.NCR as number;
	assert.deepEqual(
		['2026-01-05', '2026-02-06', '2026-02-07', '2026-04-01'].map(floor),
		[7000, 7000, 7800, 7800]
	);
});

test('SG — the retirement register reads 63 / 68 on 30 June 2026 and 64 / 69 on 1 July', () => {
	assert.match(
		obligation('SG', '2026-06-30', 'RETIREMENT_AND_RE_EMPLOYMENT').timing,
		/^Minimum retirement age 63, re-employment up to 68/
	);
	assert.match(
		obligation('SG', '2026-07-01', 'RETIREMENT_AND_RE_EMPLOYMENT').timing,
		/^Minimum retirement age 64, re-employment up to 69/
	);
});

test('VN — the union fee is paid with SI to 15 May 2026 and by the next month’s end from the 16th', () => {
	// Decree 191/2013 art.6: monthly, at the same time as compulsory SI. Decree 105/2026 art.4:
	// by the last day of the following month, in force 16 May 2026.
	assert.match(obligation('VN', '2026-05-15', 'UNION_FEE_REMITTANCE').timing, /191\/2013/);
	assert.match(
		obligation('VN', '2026-05-16', 'UNION_FEE_REMITTANCE').timing,
		/^By the last day of the month after the month \(Decree 105\/2026/
	);
});
