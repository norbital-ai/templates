/**
 * China — Shanghai and Kunming: expected payslips against the law itself.
 *
 * The register is docs/inventory/china.md; each case names the row it prices. Figures come from the
 * instruments, never from the engine:
 *
 * - Social insurance: Social Insurance Law (CN-N07). Shanghai base 7,460–37,302 from 1 July 2025 and
 *   7,546–37,731 from 1 July 2026 (CN-SH05); pension 16% / 8% (HRSS employer guidance, CN-SH06);
 *   medical 9% / 2% under 沪医保规〔2025〕2号 and 〔2026〕2号 (CN-SH06); unemployment 0.5% / 0.5% to
 *   31 December 2025 (CN-SH06); injury employer-only by assigned class rate (CN-SH07). Kunming base
 *   4,357–21,789 (2025) and 4,403–22,017 (2026, CN-KM03); pension 16% / 8% (CN-KM25); medical 7%
 *   employer (CN-KM04; the employee 2% is in Yunnan Government Order 86 art.6); maternity 0.9% employer (CN-KM32);
 *   unemployment 0.7% / 0.3% to 31 December 2025 (CN-KM27); injury employer-only (CN-KM26).
 * - Housing fund: Shanghai 2,690–37,302 (CN-SH09) then 2,740–37,731 (CN-SH40), equal 5–7%; Kunming cap
 *   32,470 (2025) and 32,543 (2026), equal 5–12% (CN-KM05, CN-KM20). Each side is rounded to the whole
 *   yuan half-up separately (the Shanghai centre Q&A; Kunming measure art.13).
 * - IIT: STA 2018 No.61 (CN-N09, CN-N38) — resident cumulative withholding on the annual table, the
 *   non-resident monthly table; MOF/STA 2023 No.30 separate annual bonus (CN-N10); STA 2020 No.13
 *   (CN-N44) and No.19 (CN-N11); the CNY1,500 rent cap (CN-N54). Tax to the fen.
 * - Pay: Labour Law art.44 (150/200/300%) and 人社部发〔2025〕2号 21.75 days / 8 hours (CN-N01, CN-N02,
 *   CN-SH03). No text read prescribes part-month proration; the seed prices a joiner, leaver or rate
 *   change on the month's working days — the cases below that depend on it say so.
 *
 * Social insurance is kept to the fen: no instrument read states another rounding, and the Kunming
 * county notice's own examples (704.48, 352.24, 30.82, 13.21) are fen figures.
 *
 * 2026 unemployment rates are an entity fact the operator records from the agency notice (no 2026
 * instrument was located, CN-SH06 / CN-KM27). The fixtures record 0.5 / 0.5 (Shanghai) and 0.7 / 0.3
 * (Kunming) only so a run happens; no golden asserts a 2026 unemployment figure as law.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	COMPANY_ID,
	adhocCatalogue,
	allowanceCatalogue,
	assessStatutory,
	assertEveryVersionPriced,
	buildStatutory,
	expectStatutory,
	expectStatutorySkipped,
	leaveCatalogue,
	contributionSchemes,
	rowIn,
	settingsIdOn,
	settingsVersions,
	type BuiltPayslip
} from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';
import { computedEntitlement, grantedDays, leaveWindowOf } from '../src/lib/leave/entitlement.ts';
import { isEligible, personContext } from '../src/lib/payroll/run/eligibility.ts';
import { planLeaveActivity } from '../src/lib/leave/activity.ts';
import { refusalMessage } from './fixtures/memory-payroll-api.ts';
import { checkContext, checkIssues } from '../src/lib/checks.ts';
import { checksOf } from '../src/lib/datatypes/checks.ts';
import { id, leaveContext, submission, timeOff } from './helpers/manual-leave-context.ts';

const SH = 'CN-shanghai';
const KM = 'CN-kunming';
const KM_WUHUA = '云南省/昆明市/五华区';
const KM_FUMIN = '云南省/昆明市/富民县';
const KM_MOHAN = '云南省/西双版纳傣族自治州/勐腊县/磨憨镇';

const SH_2025_FACTS = {
	injury_rate: 0.2,
	housing_fund_rate: 7,
	housing_fund_supplementary_rate: 0
};
/** 2026: the unemployment rates are recorded, not law (see the header). */
const SH_2026_FACTS = {
	...SH_2025_FACTS,
	unemployment_employer_rate: 0.5,
	unemployment_employee_rate: 0.5
};
const KM_2025_FACTS = {
	injury_rate: 0.2,
	housing_fund_rate: 12,
	housing_fund_supplementary_rate: 0
};
const KM_2026_FACTS = {
	...KM_2025_FACTS,
	unemployment_employer_rate: 0.7,
	unemployment_employee_rate: 0.3
};

type Extra = {
	base?: number;
	hfBase?: number;
	hf?: Record<string, unknown>;
	iit?: Record<string, unknown>;
	[key: string]: unknown;
};
/** A resident citizen whose declared contribution bases are the wage unless stated. */
const person = (key: string, wage: number, extra: Extra = {}) => {
	const { base, hfBase, hf, iit, ...rest } = extra;
	return {
		key,
		wage,
		citizenship: 'CITIZEN',
		tax_residency: 'RESIDENT',
		...(key.startsWith('KM-') || key.startsWith(`${KM}-`) ? { worksite: KM_WUHUA } : {}),
		...rest,
		registrations: {
			PENSION: { kind: 'REGISTERED', elections: { contribution_base: base ?? wage } },
			HOUSING_FUND: {
				kind: 'REGISTERED',
				elections: { contribution_base: hfBase ?? base ?? wage, ...hf }
			},
			...(iit == null ? {} : { IIT: { kind: 'REGISTERED', ...iit } }),
			...((rest.registrations as object | undefined) ?? {})
		}
	};
};

const charge = (slip: BuiltPayslip, code: string) => {
	const row = slip.statutory.find((entry) => entry.scheme_code === code)!;
	return [row.base_amount, row.employee_amount, row.employer_amount] as const;
};
const basic = (slip: BuiltPayslip) =>
	slip.proration
		.filter((row) => row.component_code === 'BASIC')
		.map((row) => [row.days, row.denominator, row.prorated_amount]);

/** Earlier PAID payslips of this tax year, carrying the statutory rows a cumulative method reads. */
function priorSlips(
	world: PayrollWorld,
	key: string,
	months: ReadonlyArray<{ period: string; rows: Record<string, [number, number]> }>
) {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	for (const { period, rows } of months) {
		if (!world.payroll_runs.some((run) => run.id === `prior-${period}`))
			world.payroll_runs.push({ id: `prior-${period}`, company_id: COMPANY_ID, period });
		world.payslips.push({
			id: `payslip-${key}-${period}`,
			payroll_run_id: `prior-${period}`,
			employment_id: employment.id,
			status: 'PAID',
			paid_at: `${period}-28T00:00:00.000Z`,
			currency: 'CNY',
			base: [],
			adjustments: [],
			statutory: Object.entries(rows).map(([scheme_code, [base_amount, employee_amount]]) => ({
				scheme_code,
				employee_amount,
				employer_amount: 0,
				base_amount,
				rule_when: null,
				authority: null
			}))
		});
	}
}

function adhoc(
	world: PayrollWorld,
	key: string,
	code: string,
	amount: number,
	date: string,
	lineage: typeof SH | typeof KM = SH
) {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	const row = world.adhoc_catalogue!.find(
		(item) => item.code === code && item.settings_id === settingsIdOn(lineage, date)
	)!;
	world.adhoc_requests!.push({
		id: `d0000000-0000-4000-8000-${String(world.adhoc_requests!.length).padStart(12, '0')}`,
		employment_id: employment.id,
		catalogue_id: row.id,
		amount,
		event_date: date,
		pay_period: null,
		payslip_id: null,
		reason: code,
		evidence_file: null,
		as_adjustment_entry: false,
		approval_id: null
	});
}

// ─────────────────────────────────── Shanghai: social insurance and housing fund ───────────────────

test('Shanghai — December 2025: pension, medical, unemployment, injury and housing fund on a declared base (CN-SH05, SH06, SH07, SH09)', () => {
	const book = assessStatutory({
		code: SH,
		period: '2025-12',
		region: 'SHANGHAI',
		companyFacts: SH_2025_FACTS,
		people: [person('SH-20000', 20_000)]
	});
	// 20,000 × 8% = 1,600 / × 16% = 3,200; medical × 2% = 400 / × 9% = 1,800; unemployment 0.5% each
	// side = 100; injury employer 0.2% (class I, no float) = 40; housing fund 7% each side = 1,400.
	expectStatutory(book, 'SH-20000', 'PENSION', 1600, 3200);
	expectStatutory(book, 'SH-20000', 'MEDICAL', 400, 1800);
	expectStatutory(book, 'SH-20000', 'UNEMPLOYMENT', 100, 100);
	expectStatutory(book, 'SH-20000', 'INJURY', 0, 40);
	expectStatutory(book, 'SH-20000', 'HOUSING_FUND', 1400, 1400);
});

test('Shanghai — the base floor and ceiling to 30 June 2026, and the fen above the ceiling (CN-SH05, SH09)', () => {
	const book = assessStatutory({
		code: SH,
		period: '2025-12',
		region: 'SHANGHAI',
		companyFacts: SH_2025_FACTS,
		people: [
			person('SH-5000', 5_000),
			person('SH-37302', 37_302),
			person('SH-37302.01', 37_302.01),
			person('SH-50000', 50_000)
		]
	});
	// Floor 7,460: × 8% = 596.80, × 16% = 1,193.60; × 2% = 149.20, × 9% = 671.40; × 0.5% = 37.30.
	// The housing-fund floor is 2,690, so 5,000 stands: × 7% = 350 each side.
	expectStatutory(book, 'SH-5000', 'PENSION', 596.8, 1193.6);
	expectStatutory(book, 'SH-5000', 'MEDICAL', 149.2, 671.4);
	expectStatutory(book, 'SH-5000', 'UNEMPLOYMENT', 37.3, 37.3);
	expectStatutory(book, 'SH-5000', 'HOUSING_FUND', 350, 350);
	// Ceiling 37,302 (ceiling-inclusive; the fen above it is charged on it): × 8% = 2,984.16,
	// × 16% = 5,968.32; × 2% = 746.04, × 9% = 3,357.18; × 0.5% = 186.51. Housing fund 37,302 × 7% =
	// 2,611.14 → 2,611 each side.
	for (const key of ['SH-37302', 'SH-37302.01', 'SH-50000']) {
		expectStatutory(book, key, 'PENSION', 2984.16, 5968.32);
		expectStatutory(book, key, 'MEDICAL', 746.04, 3357.18);
		expectStatutory(book, key, 'UNEMPLOYMENT', 186.51, 186.51);
		expectStatutory(book, key, 'HOUSING_FUND', 2611, 2611);
	}
});

test('Shanghai — 30 June / 1 July 2026: the new base 7,546–37,731 and fund 2,740–37,731 (CN-SH05, SH40)', () => {
	const people = [person('SH-7500', 7_500), person('SH-37500', 37_500), person('SH-50000', 50_000)];
	const june = assessStatutory({
		code: SH,
		period: '2026-06',
		region: 'SHANGHAI',
		companyFacts: SH_2026_FACTS,
		people
	});
	const july = assessStatutory({
		code: SH,
		period: '2026-07',
		region: 'SHANGHAI',
		companyFacts: SH_2026_FACTS,
		people
	});
	// June (old bounds): 7,500 is above 7,460 → × 8% = 600, × 16% = 1,200; 37,500 is over 37,302.
	expectStatutory(june, 'SH-7500', 'PENSION', 600, 1200);
	expectStatutory(june, 'SH-37500', 'PENSION', 2984.16, 5968.32);
	expectStatutory(june, 'SH-37500', 'HOUSING_FUND', 2611, 2611);
	// June is the 1 March 2026 medical instrument (沪医保规〔2026〕2号) at the same 2% / 9%.
	expectStatutory(june, 'SH-7500', 'MEDICAL', 150, 675);
	// July: 7,500 is below the new floor 7,546 → × 8% = 603.68, × 16% = 1,207.36, × 2% = 150.92,
	// × 9% = 679.14; the fund floor is 2,740, so 7,500 × 7% = 525.
	expectStatutory(july, 'SH-7500', 'PENSION', 603.68, 1207.36);
	expectStatutory(july, 'SH-7500', 'MEDICAL', 150.92, 679.14);
	expectStatutory(july, 'SH-7500', 'HOUSING_FUND', 525, 525);
	// 37,500 is now inside: 3,000 / 6,000; fund 37,500 × 7% = 2,625.
	expectStatutory(july, 'SH-37500', 'PENSION', 3000, 6000);
	expectStatutory(july, 'SH-37500', 'HOUSING_FUND', 2625, 2625);
	// 50,000 on 37,731: 3,018.48 / 6,036.96; 754.62 / 3,395.79; fund 2,641.17 → 2,641 each side,
	// combined 5,282 — the published 7% maximum (CN-SH40).
	expectStatutory(july, 'SH-50000', 'PENSION', 3018.48, 6036.96);
	expectStatutory(july, 'SH-50000', 'MEDICAL', 754.62, 3395.79);
	expectStatutory(july, 'SH-50000', 'HOUSING_FUND', 2641, 2641);
});

test('Shanghai — each fund share rounds to the yuan on its own side (CN-SH40)', () => {
	const book = assessStatutory({
		code: SH,
		period: '2026-07',
		region: 'SHANGHAI',
		companyFacts: { ...SH_2026_FACTS, housing_fund_rate: 5 },
		people: [person('SH-20010', 20_010)]
	});
	// 20,010 × 5% = 1,000.50 → 1,001 on each side, combined 2,002 rather than 2,001.
	expectStatutory(book, 'SH-20010', 'HOUSING_FUND', 1001, 1001);
	const supplementary = assessStatutory({
		code: SH,
		period: '2026-07',
		region: 'SHANGHAI',
		companyFacts: { ...SH_2026_FACTS, housing_fund_rate: 5, housing_fund_supplementary_rate: 1 },
		people: [person('SH-20010', 20_010)]
	});
	// Supplementary 1%: 200.10 → 200, rounded apart from the ordinary 1,001: 1,201 each side.
	expectStatutory(supplementary, 'SH-20010', 'HOUSING_FUND', 1201, 1201);
	// The 7% minimum at the 2,740 floor: 191.80 → 192 each side, the published combined 384.
	const floor = assessStatutory({
		code: SH,
		period: '2026-07',
		region: 'SHANGHAI',
		companyFacts: SH_2026_FACTS,
		people: [person('SH-FLOOR', 20_000, { hfBase: 2_000 })]
	});
	expectStatutory(floor, 'SH-FLOOR', 'HOUSING_FUND', 192, 192);
});

test('Shanghai — a pensioned retiree, a worker past retirement age, and a foreign worker (CN-N13, N25, SH25, SH41)', () => {
	const book = assessStatutory({
		code: SH,
		period: '2026-01',
		region: 'SHANGHAI',
		companyFacts: SH_2026_FACTS,
		people: [
			person('SH-PENSIONER', 20_000, { receiving_pension: true, age: 63 }),
			person('SH-63', 20_000, { age: 63 }),
			person('SH-FOREIGN', 20_000, { citizenship: 'FOREIGNER' }),
			person('SH-FOREIGN-HF', 20_000, {
				citizenship: 'FOREIGNER',
				hf: { voluntary_agreement: true }
			})
		]
	});
	// A retiree drawing a pension is outside ordinary employee insurance (CN-SH25: injury-only
	// enrolment is a separate optional branch) and does not contribute to the fund (2023 measure
	// art.21); tax is 20,000 − 5,000 = 15,000 × 3% = 450.
	for (const code of ['PENSION', 'MEDICAL', 'UNEMPLOYMENT', 'INJURY', 'HOUSING_FUND'])
		expectStatutorySkipped(book, 'SH-PENSIONER', code);
	expectStatutory(book, 'SH-PENSIONER', 'IIT', 450, 0);
	// Age alone does not end coverage: a worker not drawing a pension contributes (CN-N13).
	expectStatutory(book, 'SH-63', 'PENSION', 1600, 3200);
	// A foreign employee is insured like anyone else (Social Insurance Law art.97, CN-N25) but joins
	// the fund only by mutual agreement (CN-SH41).
	expectStatutory(book, 'SH-FOREIGN', 'PENSION', 1600, 3200);
	expectStatutorySkipped(book, 'SH-FOREIGN', 'HOUSING_FUND');
	expectStatutory(book, 'SH-FOREIGN-HF', 'HOUSING_FUND', 1400, 1400);
});

test('Shanghai — an undeclared base refuses the run rather than choosing one (register review contract)', () => {
	assert.throws(
		() =>
			assessStatutory({
				code: SH,
				period: '2025-12',
				region: 'SHANGHAI',
				companyFacts: SH_2025_FACTS,
				people: [
					{
						key: 'SH-NOBASE',
						wage: 20_000,
						citizenship: 'CITIZEN',
						tax_residency: 'RESIDENT'
					}
				]
			}),
		/contribution base/
	);
});

// ─────────────────────────────────── Shanghai: IIT ────────────────────────────────────────────────

test('Shanghai — January resets the cumulative year: 20,000 withholds 345 (CN-N09, N38)', () => {
	const book = assessStatutory({
		code: SH,
		period: '2026-01',
		region: 'SHANGHAI',
		companyFacts: SH_2026_FACTS,
		people: [person('SH-20000', 20_000), person('SH-8000', 8_000), person('SH-6000', 6_000)]
	});
	// 20,000 − (1,600 + 400 + 100 + 1,400) − 5,000 = 11,500 × 3% = 345.
	expectStatutory(book, 'SH-20000', 'IIT', 345, 0);
	// 8,000 is above the 7,460 floor: 8,000 − (640 + 160 + 40 + 560) − 5,000 = 1,600 × 3% = 48.
	expectStatutory(book, 'SH-8000', 'IIT', 48, 0);
	// 6,000 insures on the 7,460 floor (596.80 + 149.20 + 37.30) with the fund on 6,000 (420):
	// 6,000 − 1,203.30 − 5,000 is negative: nothing.
	expectStatutory(book, 'SH-6000', 'IIT', 0, 0);
});

test('Shanghai — December 2025 withholds the cumulative year less what January–November withheld (CN-N09)', () => {
	// Each month 20,000 − 3,500 − 5,000 = 11,500 of cumulative taxable income. Through November:
	// 126,500 → 1,080 + 90,500 × 10% = 10,130 withheld; December: 138,000 → 1,080 + 102,000 × 10% =
	// 11,280; 11,280 − 10,130 = 1,150.
	const monthly = [345, 345, 345, 1045, 1150, 1150, 1150, 1150, 1150, 1150, 1150];
	assert.equal(
		monthly.reduce((a, b) => a + b, 0),
		10_130
	);
	const book = assessStatutory(
		{
			code: SH,
			period: '2025-12',
			region: 'SHANGHAI',
			companyFacts: SH_2025_FACTS,
			people: [person('SH-20000', 20_000)]
		},
		(world) =>
			priorSlips(
				world,
				'SH-20000',
				monthly.map((tax, index) => ({
					period: `2025-${String(index + 1).padStart(2, '0')}`,
					rows: {
						PENSION: [20_000, 1600],
						MEDICAL: [20_000, 400],
						UNEMPLOYMENT: [20_000, 100],
						HOUSING_FUND: [20_000, 1400],
						IIT: [20_000, tax]
					}
				}))
			)
	);
	expectStatutory(book, 'SH-20000', 'IIT', 1150, 0);
});

test('Shanghai — the register probe: 35,000 taxable and 1,050 withheld, then 2,000 more → 130 (CN-N09, N38)', () => {
	// January: base 43,500 less 3,500 insurance and 5,000 = 35,000, tax 1,050. February: 10,500 on a
	// declared 20,000 base — 10,500 − 3,500 − 5,000 = 2,000; cumulative 37,000 → 37,000 × 10% − 2,520
	// = 1,180; 1,180 − 1,050 = 130.
	const book = assessStatutory(
		{
			code: SH,
			period: '2026-02',
			region: 'SHANGHAI',
			companyFacts: SH_2026_FACTS,
			people: [person('SH-PROBE', 10_500, { base: 20_000 })]
		},
		(world) =>
			priorSlips(world, 'SH-PROBE', [
				{
					period: '2026-01',
					rows: {
						PENSION: [20_000, 1600],
						MEDICAL: [20_000, 400],
						UNEMPLOYMENT: [20_000, 100],
						HOUSING_FUND: [20_000, 1400],
						IIT: [43_500, 1050]
					}
				}
			])
	);
	expectStatutory(book, 'SH-PROBE', 'IIT', 130, 0);
});

test('Shanghai — a negative cumulative balance withholds nothing; there is no payroll refund (CN-N09)', () => {
	// January over-withheld 1,000 on 20,000. February's cumulative 23,000 → 690 < 1,000: nothing.
	const book = assessStatutory(
		{
			code: SH,
			period: '2026-02',
			region: 'SHANGHAI',
			companyFacts: SH_2026_FACTS,
			people: [person('SH-20000', 20_000)]
		},
		(world) =>
			priorSlips(world, 'SH-20000', [
				{
					period: '2026-01',
					rows: {
						PENSION: [20_000, 1600],
						MEDICAL: [20_000, 400],
						UNEMPLOYMENT: [20_000, 100],
						HOUSING_FUND: [20_000, 1400],
						IIT: [20_000, 1000]
					}
				}
			])
	);
	expectStatutory(book, 'SH-20000', 'IIT', 0, 0);
});

test('Shanghai — the 3% / 10% seam of the annual table is ceiling-inclusive (CN-N38)', () => {
	const retired = (key: string, wage: number) =>
		person(key, wage, { age: 60, receiving_pension: true });
	const book = assessStatutory({
		code: SH,
		period: '2026-01',
		region: 'SHANGHAI',
		companyFacts: SH_2026_FACTS,
		people: [
			retired('T-41000', 41_000),
			retired('T-41000.01', 41_000.01),
			retired('T-41010', 41_010)
		]
	});
	// A working pensioner has no contribution deductions: 41,000 − 5,000 = 36,000 → 3% = 1,080.00; 36,000.01 → 1,080 + 0.001 → 1,080.00;
	// 36,010 → 1,080 + 1.00 = 1,081.00.
	expectStatutory(book, 'T-41000', 'IIT', 1080, 0);
	expectStatutory(book, 'T-41000.01', 'IIT', 1080, 0);
	expectStatutory(book, 'T-41010', 'IIT', 1081, 0);
});

test('Shanghai — a non-resident is withheld monthly on wage − 5,000, no insurance relief (CN-N38)', () => {
	// IIT Law art.6(2) (https://fgk.chinatax.gov.cn/zcfgk/c100009/c5193028/content.html): 非居民个人的工资、
	// 薪金所得，以每月收入额减除费用五千元后的余额为应纳税所得额; the withholding return (STA 2022 No.7 annex 2
	// item 11(1)②, https://fgk.chinatax.gov.cn/zcfgk/c100012/c5196775/content.html) states it as 收入额减去减除
	// 费用. The employee's own insurance and fund shares are not taken off (财税〔2006〕10号 is read for residents).
	// The tax authority answers the same way: STA Foshan bureau filing guide Q(十), 2025-10-09
	// (https://guangdong.chinatax.gov.cn/gdsw/fssw_nsrxt_kjxz/2025-10/09/content_00a4ed7054fc4d82ac30702f52001a14.shtml),
	// on IIT Law art.6 and STA 2018 No.61 art.9: 非居民个人缴纳的三险一金暂不允许扣除 (EM1 rejected).
	const nonres = (key: string, wage: number) =>
		person(key, wage, { tax_residency: 'NON_RESIDENT' });
	const book = assessStatutory({
		code: SH,
		period: '2026-01',
		region: 'SHANGHAI',
		companyFacts: SH_2026_FACTS,
		people: [
			nonres('NR-8000', 8_000),
			nonres('NR-17000', 17_000),
			nonres('NR-17000.01', 17_000.01),
			nonres('NR-30000', 30_000)
		]
	});
	// 3,000 × 3% = 90; 12,000 → 90 + 900 = 990; 12,000.01 → 990.00; 25,000 → 990 + 2,600 = 3,590.
	expectStatutory(book, 'NR-8000', 'IIT', 90, 0);
	expectStatutory(book, 'NR-17000', 'IIT', 990, 0);
	expectStatutory(book, 'NR-17000.01', 'IIT', 990, 0);
	expectStatutory(book, 'NR-30000', 'IIT', 3590, 0);
});

test('Shanghai — an unrecorded tax residence refuses (CN-N09)', () => {
	assert.throws(
		() =>
			assessStatutory({
				code: SH,
				period: '2026-01',
				region: 'SHANGHAI',
				companyFacts: SH_2026_FACTS,
				people: [person('SH-NORES', 20_000, { tax_residency: null })]
			}),
		/tax residence/
	);
});

test('Shanghai — a separately taxed annual bonus: ÷ 12 picks the rate, and the 36,000 / 36,001 cliff (CN-N10)', () => {
	const run = (amount: number) =>
		buildStatutory(
			{
				code: SH,
				period: '2026-01',
				region: 'SHANGHAI',
				companyFacts: SH_2026_FACTS,
				people: [person('SH-BONUS', 20_000)]
			},
			(world) => adhoc(world, 'SH-BONUS', 'ANNUAL_BONUS_SEPARATE', amount, '2026-01-10')
		).slips.get('SH-BONUS')!;
	// 12,000 ÷ 12 = 1,000 → 3%: 360 (the register's probe). The wage's own IIT is unchanged at 345.
	const twelve = run(12_000);
	assert.deepEqual(charge(twelve, 'IIT_BONUS'), [12_000, 360, 0]);
	assert.deepEqual(charge(twelve, 'IIT'), [20_000, 345, 0]);
	// 36,000 ÷ 12 = 3,000 → still 3%: 1,080. 36,001 → 10% less 210: 3,600.10 − 210 = 3,390.10.
	assert.deepEqual(charge(run(36_000), 'IIT_BONUS'), [36_000, 1080, 0]);
	assert.deepEqual(charge(run(36_001), 'IIT_BONUS'), [36_001, 3390.1, 0]);
});

test('Shanghai — an ordinary bonus joins the month’s cumulative wage; a second separate bonus in the year refuses (CN-N10)', () => {
	const { slips } = buildStatutory(
		{
			code: SH,
			period: '2026-01',
			region: 'SHANGHAI',
			companyFacts: SH_2026_FACTS,
			people: [person('SH-BONUS', 20_000)]
		},
		(world) => adhoc(world, 'SH-BONUS', 'BONUS', 12_000, '2026-01-10')
	);
	// 32,000 − 3,500 − 5,000 = 23,500 × 3% = 705.
	assert.deepEqual(charge(slips.get('SH-BONUS')!, 'IIT'), [32_000, 705, 0]);
	assert.throws(
		() =>
			buildStatutory(
				{
					code: SH,
					period: '2026-02',
					region: 'SHANGHAI',
					companyFacts: SH_2026_FACTS,
					people: [person('SH-BONUS', 20_000)]
				},
				(world) => {
					priorSlips(world, 'SH-BONUS', [
						{ period: '2026-01', rows: { IIT_BONUS: [12_000, 360], IIT: [20_000, 345] } }
					]);
					adhoc(world, 'SH-BONUS', 'ANNUAL_BONUS_SEPARATE', 12_000, '2026-02-10');
				}
			),
		/once per tax year/
	);
	// A non-resident's multi-month bonus (MOF/STA 2019 No.35 item 3(2), transcribed into every Shanghai
	// version 30 Sep 2026): [(12,000 ÷ 6) × 3% − 0] × 6 = 360, apart from the wage.
	const nonResident = buildStatutory(
		{
			code: SH,
			period: '2026-01',
			region: 'SHANGHAI',
			companyFacts: SH_2026_FACTS,
			people: [person('SH-NR-BONUS', 20_000, { tax_residency: 'NON_RESIDENT' })]
		},
		(world) => adhoc(world, 'SH-NR-BONUS', 'ANNUAL_BONUS_SEPARATE', 12_000, '2026-01-10')
	).slips.get('SH-NR-BONUS')!;
	assert.deepEqual(charge(nonResident, 'IIT_BONUS'), [12_000, 360, 0]);
});

test('Shanghai — first wage income in July deducts from January; the 60,000 election; the rent cap (CN-N11, N44, N54)', () => {
	const book = assessStatutory({
		code: SH,
		period: '2026-07',
		region: 'SHANGHAI',
		companyFacts: SH_2026_FACTS,
		people: [
			person('SH-JULY', 20_000, { hire_date: '2026-07-01' }),
			person('SH-JULY-FIRST', 20_000, {
				hire_date: '2026-07-01',
				iit: { elections: { first_wage_income_this_year: true } }
			})
		]
	});
	// Without the declaration July is month one here: 20,000 − 3,500 − 5,000 = 11,500 → 345.
	expectStatutory(book, 'SH-JULY', 'IIT', 345, 0);
	// STA 2020 No.13: 5,000 × 7 = 35,000 deducted: 20,000 − 3,500 − 35,000 < 0 → nothing.
	expectStatutory(book, 'SH-JULY-FIRST', 'IIT', 0, 0);
	const january = assessStatutory({
		code: SH,
		period: '2026-01',
		region: 'SHANGHAI',
		companyFacts: SH_2026_FACTS,
		people: [
			// STA 2020 No.19: 60,000 from January — 10,000 − 1,750 − 60,000 < 0 → nothing (the probe).
			person('SH-60K', 10_000, { iit: { elections: { annual_60000_from_january: true } } }),
			// Rent declared 2,000 is capped at 1,500 a month: 11,500 − 1,500 = 10,000 × 3% = 300.
			person('SH-RENT', 20_000, {
				iit: {
					deduction_claims: [
						{
							period: '2026-01',
							category: 'HOUSING_RENT',
							amount: 2_000,
							source: 'EMPLOYEE',
							reference: 'RENT-1'
						}
					]
				}
			})
		]
	});
	expectStatutory(january, 'SH-60K', 'IIT', 0, 0);
	expectStatutory(january, 'SH-RENT', 'IIT', 300, 0);
	assert.throws(
		() =>
			assessStatutory({
				code: SH,
				period: '2026-01',
				region: 'SHANGHAI',
				companyFacts: SH_2026_FACTS,
				people: [
					person('SH-BOTH', 20_000, {
						iit: {
							deduction_claims: ['HOUSING_RENT', 'HOUSING_LOAN_INTEREST'].map((category) => ({
								period: '2026-01',
								category,
								amount: 1_000,
								source: 'EMPLOYEE',
								reference: category
							}))
						}
					})
				]
			}),
		/cannot both be deducted/
	);
});

// ─────────────────────────────────── Shanghai: pay ────────────────────────────────────────────────

/** `HH:MM` one hour later, for the break that separates two worked intervals. */
const anHourLater = (time: string) => {
	const minutes = (Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + 60) % 1440;
	return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};
/**
 * A punch from `start` to `end` on `date`, in Shanghai's +08:00 frame. `mealStart` names the hour the
 * shift's break is taken: only a gap between worked intervals proves it, so a break the punches do not
 * show is worked time (PRC Labour Law art.36, art.41/44 hours; `work_rules.breaks`).
 */
const punch = (
	world: PayrollWorld,
	key: string,
	date: string,
	start: string,
	end: string,
	mealStart?: string
) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	const at = (from: string, to: string) => ({
		start: `${date}T${from}:00+08:00`,
		end: `${date}T${to}:00+08:00`
	});
	world.work_days.push({
		id: `wd-${key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals:
			mealStart == null
				? [at(start, end)]
				: [at(start, mealStart), at(anHourLater(mealStart), end)],
		approval_id: null
	});
};

test('Shanghai — overtime at 150% / 200% / 300% on the 21.75-day hour (CN-N01, N02, SH03)', () => {
	const { slips } = buildStatutory(
		{
			code: SH,
			period: '2026-01',
			region: 'SHANGHAI',
			companyFacts: SH_2026_FACTS,
			people: [person('SH-21750', 21_750), person('SH-4350', 4_350)]
		},
		(world) => {
			world.jurisdiction_holidays.push({
				id: 'holiday-2026-01-01',
				company_id: COMPANY_ID,
				date: '2026-01-01',
				name: '元旦',
				kind: 'PUBLIC_HOLIDAY',
				replaces: null,
				source: null,
				published_at: '2025-11-04T00:00:00.000Z',
				approval_id: null
			});
			punch(world, 'SH-21750', '2026-01-01', '09:00', '18:00', '13:00'); // statutory holiday: the shift, 8 h net of its break
			punch(world, 'SH-21750', '2026-01-05', '09:00', '20:00', '13:00'); // Monday: 10 worked, 2 beyond
			punch(world, 'SH-21750', '2026-01-10', '09:00', '17:00'); // Saturday rest day, 8 h
			punch(world, 'SH-4350', '2026-01-05', '09:00', '20:00', '13:00');
		}
	);
	// 21,750 ÷ 21.75 = 1,000 a day, ÷ 8 = 125 an hour (CN-N02). Holiday 8 × 125 × 300% = 3,000 on top
	// of the paid holiday; Monday 2 × 125 × 150% = 375; Saturday with no compensatory rest 8 × 125 ×
	// 200% = 2,000.
	const lines = (slip: BuiltPayslip) =>
		slip.adjustments
			.filter((row) => row.family === 'WORK_DAY')
			.map((row) => [row.source_id.slice(-10), row.label, row.quantity, row.amount])
			.toSorted((a, b) => String(a[0]).localeCompare(String(b[0])));
	assert.deepEqual(lines(slips.get('SH-21750')!), [
		['2026-01-01', 'OT-3.0X', 8, 3000],
		['2026-01-05', 'OT-1.5X', 2, 375],
		['2026-01-10', 'OT-2.0X', 8, 2000]
	]);
	assert.equal(slips.get('SH-21750')!.gross, 21_750 + 5_375);
	// CN-SH03: 4,350 → 200 a day, 25 an hour; two weekday hours pay 75 (25 of it premium).
	assert.deepEqual(lines(slips.get('SH-4350')!), [['2026-01-05', 'OT-1.5X', 2, 75]]);
	// Overtime is taxable wage: 21,750 + 5,375 − (1,740 + 435 + 108.75 + 1,523) − 5,000 = 18,318.25
	// × 3% = 549.5475 → 549.55. (The fund: 21,750 × 7% = 1,522.50 → 1,523.)
	assert.deepEqual(charge(slips.get('SH-21750')!, 'HOUSING_FUND'), [21_750, 1523, 1523]);
	assert.deepEqual(charge(slips.get('SH-21750')!, 'IIT'), [27_125, 549.55, 0]);
});

test('Shanghai — one day of unpaid personal leave is the 21.75 day (CN-N02, N04)', () => {
	const { slips } = buildStatutory(
		{
			code: SH,
			period: '2026-01',
			region: 'SHANGHAI',
			companyFacts: SH_2026_FACTS,
			people: [person('SH-NPL', 21_750)]
		},
		(world) => {
			const row = leaveCatalogue(SH).find(
				(item) =>
					item.code === 'UNPAID_LEAVE' && item.settings_id === settingsIdOn(SH, '2026-01-14')
			)!;
			world.leave_catalogue.push(row);
			const employment = world.employments[0]!;
			const term = world.employment_terms[0]!;
			world.leave_entries.push({
				id: 'e1000000-0000-4000-8000-000000000001',
				employment_id: employment.id,
				catalogue_id: row.id,
				leave_code: 'UNPAID_LEAVE',
				reference: 'NPL-1',
				from_date: '2026-01-14',
				to_date: '2026-01-14',
				half_day_start: false,
				half_day_end: false,
				days: 1,
				effective_on: '2026-01-14',
				reason: '事假',
				allocations: [],
				charges: [
					{
						date: '2026-01-14',
						days: 1,
						catalogue_id: row.id,
						employment_term_id: term.id,
						holiday_id: null,
						shift_definition_id: null,
						work_day_id: null
					}
				],
				approval_id: null
			});
		}
	);
	const slip = slips.get('SH-NPL')!;
	// 21,750 ÷ 21.75 = 1,000 off the month.
	const unpaid = slip.adjustments
		.filter((row) => row.bucket === 'ABSENCE')
		.reduce((sum, row) => sum + row.amount, 0);
	assert.equal(unpaid, 1000);
	assert.equal(slip.gross, 20_750);
	// The insured base is the declared annual base, untouched by the absence: 21,750 × 8% = 1,740.
	assert.deepEqual(charge(slip, 'PENSION'), [21_750, 1740, 3480]);
	// IIT: 20,750 − (1,740 + 435 + 108.75 + 1,523) − 5,000 = 11,943.25 × 3% = 358.2975 → 358.30.
	assert.deepEqual(charge(slip, 'IIT'), [20_750, 358.3, 0]);
	// rowIn keeps the catalogue lookup honest across reissued versions.
	assert.ok(rowIn(leaveCatalogue(SH), settingsIdOn(SH, '2026-01-14'), 'UNPAID_LEAVE'));
});

test('Shanghai — a mid-month joiner and a leaver on the 21.75-day conversion (a reading, not an express rule)', () => {
	const { slips } = buildStatutory({
		code: SH,
		period: '2026-01',
		region: 'SHANGHAI',
		companyFacts: SH_2026_FACTS,
		people: [
			person('SH-JOINER', 22_000, { hire_date: '2026-01-19', hf: { first_ever_account: true } }),
			person('SH-LEAVER', 22_000, { exit_date: '2026-01-15', exit_ground: 'RESIGNATION' })
		]
	});
	// 22,000 ÷ 21.75 a paid day. Joiner on Monday 19 January: 10 working days → 10,114.942… →
	// 10,114.94. Leaver on Thursday the 15th: 11 (1–2, 5–9, 12–15; 元旦 is not planted) → 11,126.44.
	assert.deepEqual(basic(slips.get('SH-JOINER')!), [[10, 21.75, 10_114.94]]);
	assert.deepEqual(basic(slips.get('SH-LEAVER')!), [[11, 21.75, 11_126.44]]);
	// A first-ever fund worker pays from the second month (Regulation art.17; CN-SH43): no fund row.
	assert.equal(
		slips.get('SH-JOINER')!.statutory.find((row) => row.scheme_code === 'HOUSING_FUND'),
		undefined
	);
	// Joiner IIT: 10,114.94 − (1,760 + 440 + 110) − 5,000 = 2,804.94 × 3% = 84.1482 → 84.15.
	assert.deepEqual(charge(slips.get('SH-JOINER')!, 'IIT'), [10_114.94, 84.15, 0]);
	// The insured base is the declared one — the new hire's first full month — not the part month.
	assert.deepEqual(charge(slips.get('SH-JOINER')!, 'PENSION'), [22_000, 1760, 3520]);
	// Leaver IIT, the exit month insured whole on the declared base (the register sources no
	// exit-month rule; the charge is the month the employment exists in): 11,126.44 − (1,760 + 440 +
	// 110 + 1,540) − 5,000 = 2,276.44 × 3% = 68.2932 → 68.29.
	assert.deepEqual(charge(slips.get('SH-LEAVER')!, 'IIT'), [11_126.44, 68.29, 0]);
});

test('Shanghai — the fund month after a first-ever join, and a transferred joiner (Regulation art.17; CN-SH43)', () => {
	// Regulation art.17 (Order 844 text): a new worker pays from the second month, a transferred
	// worker from the first wage the new unit pays, each on 本人当月工资 × rate. The seed takes that
	// month's wage as the declared `contribution_base` (register CN-SH43).
	const feb = buildStatutory({
		code: SH,
		period: '2026-02',
		region: 'SHANGHAI',
		companyFacts: SH_2026_FACTS,
		people: [
			person('SH-JOINER', 22_000, { hire_date: '2026-01-19', hf: { first_ever_account: true } })
		]
	});
	// Second month: 22,000 × 7% = 1,540 each side.
	assert.deepEqual(charge(feb.slips.get('SH-JOINER')!, 'HOUSING_FUND'), [22_000, 1540, 1540]);
	const jan = buildStatutory({
		code: SH,
		period: '2026-01',
		region: 'SHANGHAI',
		companyFacts: SH_2026_FACTS,
		people: [person('SH-TRANSFER', 22_000, { hire_date: '2026-01-19' })]
	});
	// Transferred (not first-ever): due in the join month, 22,000 × 7% = 1,540 each side.
	assert.deepEqual(charge(jan.slips.get('SH-TRANSFER')!, 'HOUSING_FUND'), [22_000, 1540, 1540]);
});

test('Shanghai — a mid-month rise leaves the insured base alone (CN-SH05); the pay side is below', () => {
	const { slips } = buildStatutory(
		{
			code: SH,
			period: '2026-01',
			region: 'SHANGHAI',
			companyFacts: SH_2026_FACTS,
			people: [person('SH-RAISE', 22_000)]
		},
		(world) => {
			const old = world.employment_terms[0]!;
			world.employment_terms.push({
				...old,
				id: 'b0000000-0000-4000-8000-00000000a001',
				base_salary: 26_400,
				effective_range: { start: '2026-01-16', end: null }
			});
			old.effective_range = { start: '2015-01-01', end: '2026-01-15' };
		}
	);
	// The contribution base is fixed for the contribution year: 22,000 × 8% / 16%.
	assert.deepEqual(charge(slips.get('SH-RAISE')!, 'PENSION'), [22_000, 1760, 3520]);
});

test('Shanghai — a mid-month rise pays at most one month across its two rates', () => {
	const { slips } = buildStatutory(
		{
			code: SH,
			period: '2026-01',
			region: 'SHANGHAI',
			companyFacts: SH_2026_FACTS,
			people: [person('SH-RAISE', 22_000)]
		},
		(world) => {
			const old = world.employment_terms[0]!;
			world.employment_terms.push({
				...old,
				id: 'b0000000-0000-4000-8000-00000000a001',
				base_salary: 26_400,
				effective_range: { start: '2026-01-16', end: null }
			});
			old.effective_range = { start: '2015-01-01', end: '2026-01-15' };
		}
	);
	// January 2026 holds 22 working days, 11 each side of the 16th. A whole month is 21.75 paid
	// days (人社部发〔2025〕2号), so the two segments share 21.75 by their working days: 10.875 each,
	// 22,000 × 0.5 + 26,400 × 0.5 = 24,200 — never 22/21.75 of a month.
	const rows = basic(slips.get('SH-RAISE')!);
	assert.deepEqual(rows, [
		[10.875, 21.75, 11_000],
		[10.875, 21.75, 13_200]
	]);
	assert.ok(rows.reduce((sum, [days]) => sum + days, 0) <= 21.75);
});

test('Shanghai — a mid-month rise in a short month still pays one whole month across its two rates', () => {
	const { slips } = buildStatutory(
		{
			code: SH,
			period: '2026-02',
			region: 'SHANGHAI',
			companyFacts: SH_2026_FACTS,
			people: [person('SH-RAISE', 22_000)]
		},
		(world) => {
			const old = world.employment_terms[0]!;
			world.employment_terms.push({
				...old,
				id: 'b0000000-0000-4000-8000-00000000a001',
				base_salary: 26_400,
				effective_range: { start: '2026-02-16', end: null }
			});
			old.effective_range = { start: '2015-01-01', end: '2026-02-15' };
		}
	);
	// February has fewer working days than 21.75. Unsplit it is one month; split, the two rows
	// still share one month's 21.75 rather than pricing their own working days under the factor.
	const rows = basic(slips.get('SH-RAISE')!);
	assert.deepEqual(rows, [
		[10.875, 21.75, 11_000],
		[10.875, 21.75, 13_200]
	]);
});

/**
 * The seeded statutory annual leave row and cash-out rule (CN-N05, N06, N18), both cities:
 * - 职工带薪年休假条例 art.3: cumulative service of 1–10 years is 5 days, 10–20 years 10, 20+ 15;
 *   实施办法 art.4 counts service with every employer, so the ladder reads the recorded months with
 *   earlier employers beside this stint; art.3 opens it at twelve months' continuous work.
 * - 实施办法 arts.5, 12: a part year is (calendar days this year with this employer ÷ 365) × the
 *   year's days, the part day dropped (不足1整天的部分不…).
 * - 实施办法 arts.10–11 (条例 art.5): unused days at 300% of the day wage, which includes the normal
 *   pay already paid — the leaver is owed the other 200%; the day wage is the previous twelve
 *   months' average wage with this employer excluding overtime ÷ 21.75 (fewer months where
 *   employed shorter).
 */
function annualLeaveOnExit(
	code: typeof SH | typeof KM,
	key: string,
	prior: number,
	companyFacts: Record<string, number>,
	region: string,
	bonus = 0
) {
	// Hired 1 January 2019; resigns Tuesday 30 June 2026.
	const exit = '2026-06-30';
	const settingsId = settingsIdOn(code, exit);
	const row = leaveCatalogue(code).find(
		(item) => item.settings_id === settingsId && item.code === 'ANNUAL_LEAVE'
	)!;
	const personOn = (date: string) =>
		personContext({
			employee: null,
			employment: { service_start: '2019-01-01', exit_date: exit, prior_service_months: prior },
			terms: {},
			asOf: date
		});
	const days = computedEntitlement({
		rule: row.entitlement as never,
		window: leaveWindowOf(exit, row.entitlement as never),
		asOf: exit,
		hireDate: '2019-01-01',
		exitDate: exit,
		servedOn: () => true,
		eligibleOn: (date) => isEligible(row.eligibility as string, personOn(date)),
		personOn
	}).available;
	const { slips } = buildStatutory(
		{
			code,
			period: '2026-06',
			region,
			companyFacts,
			people: [
				// Kunming insures on a declared 21,000, inside both years' pension bounds (CN-KM03).
				person(key, 22_000, {
					...(code === KM ? { base: 21_000 } : {}),
					hire_date: '2019-01-01',
					exit_date: exit,
					exit_ground: 'RESIGNATION'
				})
			]
		},
		(world) => {
			const employment = world.employments.find((item) => item.employee_number === key)!;
			(employment as { prior_service_months?: number }).prior_service_months = prior;
			world.leave_catalogue.push(row as never);
			// Twelve paid months, June 2025–May 2026: 22,000 each, 1,500 of overtime in three of them.
			priorWages(world, key, 22_000, '2026-06', (offset) => (offset % 4 === 0 ? 1_500 : 0));
			// An ordinary bonus paid on the December 2025 slip.
			if (bonus > 0)
				(
					world.payslips.find((slip) => slip.id === `payslip-${key}-2025-12`)!
						.adjustments as unknown[]
				).push({
					family: 'ADHOC',
					source_id: `bonus-${key}`,
					component_code: 'BONUS',
					label: 'BONUS',
					bucket: 'EARNING',
					amount: bonus
				});
			world.leave_entries.push({
				id: 'a3000000-0000-4000-8000-0000000000c1',
				employment_id: employment.id,
				catalogue_id: row.id,
				leave_code: 'ANNUAL_LEAVE',
				reference: `exit:${employment.id}:ANNUAL_LEAVE`,
				from_date: '2026-01-01',
				to_date: '2026-12-31',
				days,
				encash_days: days,
				effective_on: exit,
				due_on: exit,
				charges: [],
				allocations: [],
				approval_id: null,
				payslip_id: null,
				as_adjustment_entry: false
			} as never);
		}
	);
	return {
		days,
		paid: slips
			.get(key)!
			.adjustments.find((item) => item.component_code === 'ANNUAL_LEAVE_ENCASHMENT')?.amount
	};
}

/**
 * Twelve PAID payslips before `period`, each `wage` of BASIC plus `overtime(offset)` of priced
 * work-day overtime (offset 12 is the earliest month, 1 the month before `period`).
 */
function priorWages(
	world: PayrollWorld,
	key: string,
	wage: number | ((offset: number) => number),
	period: string,
	overtime: (offset: number) => number = () => 0
) {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	const [year, month] = period.split('-').map(Number);
	for (let offset = 12; offset >= 1; offset -= 1) {
		const month_ = new Date(Date.UTC(year!, month! - 1 - offset, 1)).toISOString().slice(0, 7);
		if (!world.payroll_runs.some((run) => run.id === `prior-${month_}`))
			world.payroll_runs.push({ id: `prior-${month_}`, company_id: COMPANY_ID, period: month_ });
		const ot = overtime(offset);
		world.payslips.push({
			id: `payslip-${key}-${month_}`,
			payroll_run_id: `prior-${month_}`,
			employment_id: employment.id,
			status: 'PAID',
			paid_at: `${month_}-28T00:00:00.000Z`,
			currency: 'CNY',
			base: [{ component_code: 'BASIC', amount: typeof wage === 'number' ? wage : wage(offset) }],
			adjustments:
				ot > 0
					? [
							{
								family: 'WORK_DAY',
								source_id: `wd-${month_}`,
								component_code: 'OT-1.5X',
								label: 'OT-1.5X',
								bucket: 'EARNING',
								amount: ot
							}
						]
					: [],
			statutory: []
		} as never);
	}
}

test('Shanghai — a leaver’s unused statutory annual leave is paid at 200% more of the 12-month day wage (CN-N05, N06, N18)', () => {
	// Hired 1 January 2019 with 36 months' work for earlier employers. Cumulative service 90 + 36 =
	// 126 months ≥ 10 years: 10 days a year (条例 art.3) — this stint alone would be 5. Art.12: 181
	// calendar days (1 January–30 June) ÷ 365 × 10 = 4.96 → 4 whole days, none taken.
	const withPrior = annualLeaveOnExit(SH, 'SH-AL-LEAVER', 36, SH_2026_FACTS, 'SHANGHAI');
	assert.equal(withPrior.days, 4);
	// Day wage: 22,000 (the overtime left out) ÷ 21.75 = 1,011.4943; the further 200% is 2,022.9885
	// a day; × 4 = 8,091.954 → 8,091.95. With the overtime in, it would be 22,375 ÷ 21.75 × 2 × 4 = 8,229.89.
	assert.equal(withPrior.paid, 8_091.95);
	// Without the earlier employers the ladder is 5: 181 ÷ 365 × 5 = 2.48 → 2; 2,022.9885 × 2 =
	// 4,045.977 → 4,045.98.
	const alone = annualLeaveOnExit(SH, 'SH-AL-LEAVER', 0, SH_2026_FACTS, 'SHANGHAI');
	assert.equal(alone.days, 2);
	assert.equal(alone.paid, 4_045.98);
});

test('Both cities — a bonus in the 12 months enters the annual-leave day wage; overtime alone is left out (CN-N05, N06)', () => {
	// 实施办法 art.11 (https://rsj.sh.gov.cn/trlzyhshbzbgz_17256/20200617/t0035_1388390.html, from
	// 18 Sep 2008): the month wage is the 12-month average 剔除加班工资 — overtime is the only
	// exclusion, so a 奖金 stays in (实施条例 art.27 says the
	// same of the art.47 wage). 12 × 22,000 + 12,000 = 276,000 ÷ 12 = 23,000;
	// ÷ 21.75 × 2 = 2,114.9425 a day; × 4 = 8,459.770 → 8,459.77.
	for (const [code, key, facts, region] of [
		[SH, 'SH-AL-BONUS', SH_2026_FACTS, 'SHANGHAI'],
		[KM, 'KM-AL-BONUS', KM_2026_FACTS, 'CATEGORY_I']
	] as const) {
		const leaver = annualLeaveOnExit(code, key, 36, facts, region, 12_000);
		assert.equal(leaver.days, 4);
		assert.equal(leaver.paid, 8_459.77);
	}
});

test('Kunming — the same national annual-leave cash-out on the seeded row (CN-N05, N06, N18)', () => {
	// The leave law is national: 90 months alone is 5 days, 181 ÷ 365 × 5 = 2.48 → 2; 126 months
	// with earlier employers is 10, → 4. 22,000 ÷ 21.75 × 2 = 2,022.9885 a day.
	const alone = annualLeaveOnExit(KM, 'KM-AL-LEAVER', 0, KM_2026_FACTS, 'CATEGORY_I');
	assert.equal(alone.days, 2);
	assert.equal(alone.paid, 4_045.98);
	const withPrior = annualLeaveOnExit(KM, 'KM-AL-LEAVER', 36, KM_2026_FACTS, 'CATEGORY_I');
	assert.equal(withPrior.days, 4);
	assert.equal(withPrior.paid, 8_091.95);
});

test('Both cities — the first eligible year and a mid-year band crossing are granted in full (CN-N05 recorded defaults)', () => {
	// 人社厅函〔2009〕149号 answers only the twelve months and cumulative service; 实施办法 arts.5
	// and 12 pro-rate a new hire's and a leaver's year, nothing else. Owner rule 2026-09-28: the
	// seed grants the year's band in full from the day it is reached.
	for (const code of [SH, KM]) {
		const row = leaveCatalogue(code).find(
			(item) =>
				item.settings_id === settingsIdOn(code, '2026-06-30') && item.code === 'ANNUAL_LEAVE'
		)!;
		const days = (hire: string, asOf: string, exit: string | null = null) => {
			const personOn = (date: string) =>
				personContext({
					employee: null,
					employment: { service_start: hire, exit_date: exit, prior_service_months: 0 },
					terms: {},
					asOf: date
				});
			return computedEntitlement({
				rule: row.entitlement as never,
				window: leaveWindowOf(asOf, row.entitlement as never),
				asOf,
				hireDate: hire,
				exitDate: exit,
				servedOn: () => true,
				eligibleOn: (date) => isEligible(row.eligibility as string, personOn(date)),
				personOn
			}).available;
		};
		// Hired 1 October 2025, no earlier service: twelve months on 1 October 2026. Nothing before
		// it; from it the whole 5 (a pro-rata from that day would be 92 ÷ 365 × 5 = 1.26 → 1).
		assert.equal(days('2025-10-01', '2026-09-30'), 0);
		assert.equal(days('2025-10-01', '2026-10-01'), 5);
		// A 31 December 2026 exit: 365 ÷ 365 × 5 = 5 paid out.
		assert.equal(days('2025-10-01', '2026-12-31', '2026-12-31'), 5);
		// Hired 1 July 2016: 119 months on 30 June 2026 → 5; 120 on 1 July → the whole 10.
		assert.equal(days('2016-07-01', '2026-06-30'), 5);
		assert.equal(days('2016-07-01', '2026-07-01'), 10);
	}
});

test('Shanghai — a full-time contract under 2,740 gross is blocked (CN-SH01)', () => {
	assert.throws(
		() =>
			buildStatutory({
				code: SH,
				period: '2026-01',
				region: 'SHANGHAI',
				companyFacts: SH_2026_FACTS,
				people: [person('SH-2700', 2_700)]
			}),
		/MINIMUM_WAGE_BELOW.*2740/
	);
});

test('Shanghai — 2,740 gross less the employee’s statutory shares fails the net floor (CN-SH01)', () => {
	// January 2026: pension 8% × 7,460 = 596.80, medical 2% = 149.20, unemployment 0.5% = 37.30,
	// housing fund 7% × 2,740 = 191.80 → 192. 2,740 − 975.30 = 1,764.70 < 2,740.
	assert.throws(
		() =>
			buildStatutory({
				code: SH,
				period: '2026-01',
				region: 'SHANGHAI',
				companyFacts: SH_2026_FACTS,
				people: [person('SH-2740', 2_740)]
			}),
		/MINIMUM_WAGE_BELOW.*1764\.7 a month net of 975\.3 employee.*2740/
	);
	// 3,800: housing fund 266, shares 1,049.30, net 2,750.70 — meets the floor and runs.
	buildStatutory({
		code: SH,
		period: '2026-01',
		region: 'SHANGHAI',
		companyFacts: SH_2026_FACTS,
		people: [person('SH-3800', 3_800)]
	});
});

// ─────────────────────────────────── Kunming ──────────────────────────────────────────────────────

test('Kunming — December 2025 on a 10,000 base, and the 4,357 floor (CN-KM03, KM04, KM05, KM25–27, KM32)', () => {
	const book = assessStatutory({
		code: KM,
		period: '2025-12',
		region: 'CATEGORY_I',
		companyFacts: KM_2025_FACTS,
		people: [person('KM-10000', 10_000), person('KM-3000', 3_000)]
	});
	// Pension 8% / 16% = 800 / 1,600; medical 2% / 7% = 200 / 700; maternity employer 0.9% = 90;
	// unemployment 0.3% / 0.7% = 30 / 70; injury 0.2% = 20; fund 12% each side = 1,200.
	expectStatutory(book, 'KM-10000', 'PENSION', 800, 1600);
	expectStatutory(book, 'KM-10000', 'MEDICAL', 200, 700);
	expectStatutory(book, 'KM-10000', 'MATERNITY', 0, 90);
	expectStatutory(book, 'KM-10000', 'UNEMPLOYMENT', 30, 70);
	expectStatutory(book, 'KM-10000', 'INJURY', 0, 20);
	expectStatutory(book, 'KM-10000', 'HOUSING_FUND', 1200, 1200);
	// 3,000 is under the 4,357 floor: 348.56 / 697.12; 87.14 / 304.99; maternity 39.213 → 39.21;
	// unemployment 13.071 → 13.07 / 30.499 → 30.50. The fund base 3,000 is above 2,170: 360 each.
	expectStatutory(book, 'KM-3000', 'PENSION', 348.56, 697.12);
	expectStatutory(book, 'KM-3000', 'MEDICAL', 87.14, 304.99);
	expectStatutory(book, 'KM-3000', 'MATERNITY', 0, 39.21);
	expectStatutory(book, 'KM-3000', 'UNEMPLOYMENT', 13.07, 30.5);
	expectStatutory(book, 'KM-3000', 'HOUSING_FUND', 360, 360);
});

test('Kunming — January–August 2026: pension, unemployment and injury on the 2026 bounds from 1 January, medical on 2025’s (CN-KM03); the 32,543 fund cap (CN-KM05)', () => {
	const book = assessStatutory({
		code: KM,
		period: '2026-01',
		region: 'CATEGORY_I',
		companyFacts: KM_2026_FACTS,
		people: [person('KM-21789', 21_789, { hfBase: 40_000 }), person('KM-10000', 10_000)]
	});
	// 21,789 is the 2025 ceiling and inside 2026's: 1,743.12 / 3,486.24. Medical stays on the
	// 2025 bounds until 1 September: 435.78 / 1,525.23.
	expectStatutory(book, 'KM-21789', 'PENSION', 1743.12, 3486.24);
	expectStatutory(book, 'KM-21789', 'MEDICAL', 435.78, 1525.23);
	// Fund 40,000 on the final 2026 cap 32,543 × 12% = 3,905.16 → 3,905 each side.
	expectStatutory(book, 'KM-21789', 'HOUSING_FUND', 3905, 3905);
	// IIT: 10,000 − (800 + 200 + 30 + 1,200) − 5,000 = 2,770 × 3% = 83.10.
	expectStatutory(book, 'KM-10000', 'IIT', 83.1, 0);
	// Owner rule 2026-09-28 (register CN-KM03): 云人社发〔2026〕8号 dates only medical (1 September);
	// the other funds' 2026年度 bounds 4,403–22,017 run from 1 January. August, 22,000: inside 2026's
	// ceiling, 1,760 / 3,520; medical clamps to 2025's 21,789: 435.78 / 1,525.23. January, 4,000:
	// the 2026 floor 4,403 → 352.24 / 704.48, injury 0.2% = 8.806 → 8.81; medical on 2025's 4,357 floor
	// 87.14 / 304.99.
	const august = assessStatutory({
		code: KM,
		period: '2026-08',
		region: 'CATEGORY_I',
		companyFacts: KM_2026_FACTS,
		people: [person('KM-22000', 22_000)]
	});
	expectStatutory(august, 'KM-22000', 'PENSION', 1760, 3520);
	expectStatutory(august, 'KM-22000', 'MEDICAL', 435.78, 1525.23);
	const january = assessStatutory({
		code: KM,
		period: '2026-01',
		region: 'CATEGORY_I',
		companyFacts: KM_2026_FACTS,
		people: [person('KM-4000', 4_000, { hfBase: 4_000 })]
	});
	expectStatutory(january, 'KM-4000', 'PENSION', 352.24, 704.48);
	expectStatutory(january, 'KM-4000', 'INJURY', 0, 8.81);
	expectStatutory(january, 'KM-4000', 'MEDICAL', 87.14, 304.99);
});

test('Kunming — September 2026 at the 4,403 floor matches the county HRSS examples (CN-KM25, KM26)', () => {
	const book = assessStatutory({
		code: KM,
		period: '2026-09',
		region: 'CATEGORY_I',
		companyFacts: { ...KM_2026_FACTS, housing_fund_rate: 5 },
		people: [person('KM-4403', 4_403, { hfBase: 2_270 }), person('KM-20010', 20_010)]
	});
	// 4,403 × 16% = 704.48 and × 8% = 352.24; injury class I 0.2% = 8.806 → 8.81; medical 88.06 /
	// 308.21; maternity 39.627 → 39.63.
	expectStatutory(book, 'KM-4403', 'PENSION', 352.24, 704.48);
	expectStatutory(book, 'KM-4403', 'INJURY', 0, 8.81);
	expectStatutory(book, 'KM-4403', 'MEDICAL', 88.06, 308.21);
	expectStatutory(book, 'KM-4403', 'MATERNITY', 0, 39.63);
	// Fund: 2,270 × 5% = 113.50 → 114 each side, combined 228 not 227 (CN-KM20); 20,010 × 5% =
	// 1,000.50 → 1,001 each side.
	expectStatutory(book, 'KM-4403', 'HOUSING_FUND', 114, 114);
	expectStatutory(book, 'KM-20010', 'HOUSING_FUND', 1001, 1001);
});

test('Kunming — a fund base under the new-account floor refuses while the existing-account floor is unsettled (CN-KM05)', () => {
	for (const [period, facts, base] of [
		['2025-12', KM_2025_FACTS, 2_100],
		['2026-01', KM_2026_FACTS, 2_100],
		['2026-09', KM_2026_FACTS, 2_200]
	] as const)
		assert.throws(
			() =>
				assessStatutory({
					code: KM,
					period,
					region: 'CATEGORY_I',
					companyFacts: facts,
					people: [person(`KM-HF-LOW-${period}`, 10_000, { hfBase: base })]
				}),
			/floor/
		);
});

test('Kunming — Mo Han uses category III wage floors and refuses uncertified housing-fund thresholds (CN-KM02, KM05)', () => {
	const versions = settingsVersions(KM);
	assert.deepEqual(
		versions.map((version) => [
			version.work_rules.wages.by_region[KM_MOHAN],
			version.work_rules.wages.hourly_by_region[KM_MOHAN]
		]),
		// One CN version per date either city's law moved: Mo Han keeps 1,870 / 19 until September 2026.
		[
			[1870, 19],
			[1870, 19],
			[1870, 19],
			[1870, 19],
			[1970, 20]
		]
	);
	for (const [period, facts, lowBase] of [
		['2025-12', KM_2025_FACTS, 1800],
		['2026-01', KM_2026_FACTS, 1800],
		['2026-09', KM_2026_FACTS, 1900]
	] as const)
		for (const base of [lowBase, 10_000])
			assert.throws(
				() =>
					assessStatutory({
						code: KM,
						period,
						region: 'CATEGORY_III',
						companyFacts: facts,
						people: [
							person(`MOHAN-${period}-${base}`, 10_000, { hfBase: base, worksite: KM_MOHAN })
						]
					}),
				/Mo Han housing-fund category-III floor/
			);
});

test('Kunming — one company selects each worker’s district wage and fund floor from recorded worksite (CN-KM01, KM05)', () => {
	const book = assessStatutory({
		code: KM,
		period: '2025-12',
		region: 'CATEGORY_I',
		companyFacts: KM_2025_FACTS,
		people: [
			person('KM-WUHUA', 10_000, { hfBase: 2_170, worksite: KM_WUHUA }),
			person('KM-FUMIN', 10_000, { hfBase: 2_020, worksite: KM_FUMIN })
		]
	});
	expectStatutory(book, 'KM-WUHUA', 'HOUSING_FUND', 260, 260);
	expectStatutory(book, 'KM-FUMIN', 'HOUSING_FUND', 242, 242);
	const run = (wage: number, site: string, fundBase: number, region = 'CATEGORY_I') =>
		buildStatutory({
			code: KM,
			period: '2025-12',
			region,
			companyFacts: KM_2025_FACTS,
			people: [person('KM-SITE-PROBE', wage, { base: 4_500, hfBase: fundBase, worksite: site })]
		});
	assert.equal(run(2_050, KM_FUMIN, 2_020).slips.get('KM-SITE-PROBE')!.gross, 2050);
	assert.throws(() => run(2_050, KM_WUHUA, 2_170), /MINIMUM_WAGE_BELOW.*2170/);
	assert.throws(() => run(10_000, KM_FUMIN, 2_000), /declared housing-fund base is below/);
	assert.throws(() => run(10_000, '云南省/昆明市/不存在区', 10_000), /cannot price.*不存在区/);
	assert.throws(() => run(10_000, '', 10_000, KM_WUHUA), /record the worksite/);
});

test('Kunming — 2,170 in a category I district passes in August and is blocked in September 2026 (CN-KM01, KM02)', () => {
	const run = (period: string) =>
		buildStatutory({
			code: KM,
			period,
			region: 'CATEGORY_I',
			companyFacts: KM_2026_FACTS,
			// Insured on a declared 4,500 (inside both years' bounds) so the floor test stands alone.
			people: [person('KM-2170', 2_170, { base: 4_500, hfBase: 2_270 })]
		});
	// The Yunnan floor includes the employee's insurance and fund shares, so gross 2,170 meets it.
	assert.equal(run('2026-08').slips.get('KM-2170')!.gross, 2170);
	assert.throws(() => run('2026-09'), /MINIMUM_WAGE_BELOW.*2270/);
});

// ─────────────────────────────────── Both cities: overtime caps and final pay ─────────────────────

/** Weekday punches 09:00–21:00: 11 worked hours net of the 1-hour break, 3 beyond the 8-hour day. */
const JANUARY_OT_DAYS = ['05', '06', '07', '08', '09', '12', '13', '14', '15', '16', '19', '20'];

for (const [code, region, facts] of [
	[SH, 'SHANGHAI', SH_2026_FACTS],
	[KM, 'CATEGORY_I', KM_2026_FACTS]
] as const)
	test(`${code === SH ? 'Shanghai' : 'Kunming'} — 36 overtime hours a month and 3 a day are the art.41 caps; hours beyond them are still paid at 150% (CN-N40)`, () => {
		const key = `${code}-OT-CAP`;
		const { slips, warnings } = buildStatutory(
			{ code, period: '2026-01', region, companyFacts: facts, people: [person(key, 21_750)] },
			(world) => {
				// Friday 2 January 09:00–22:00: 4 beyond the day (元旦 on the 1st is not planted).
				punch(world, key, '2026-01-02', '09:00', '22:00', '13:00');
				for (const day of JANUARY_OT_DAYS)
					punch(world, key, `2026-01-${day}`, '09:00', '21:00', '13:00');
				punch(world, key, '2026-01-17', '09:00', '13:00'); // Saturday rest day: 4 h at 200%
			}
		);
		// Labour Law art.41: at most 3 extended hours a day and 36 a month (the seeded `daily_ot` /
		// `monthly_ot` limits). The 2nd keeps 3 within the daily cap, 1 beyond; the next eleven
		// weekdays (to Monday 19 January) bring the month to 36; Tuesday the 20th's 3 are beyond it.
		// Art.44 still owes 150% on every extended hour worked — the cap forbids the employer, it
		// forfeits nothing — so the 4 hours beyond settle on the INCENTIVE line at the same multiple.
		// 21,750 ÷ 21.75 ÷ 8 = 125 an hour; × 150% = 187.50: 36 × 187.50 = 6,750 and 4 × 187.50 = 750.
		// The Saturday is rest-day work (art.44(2), 200%; the OVERTIME_HOURS measure counts no rest
		// day): 4 × 250 = 1,000.
		const slip = slips.get(key)!;
		const work = slip.adjustments.filter((row) => row.family === 'WORK_DAY');
		const sum = (line: string, label: string, field: 'quantity' | 'amount') =>
			work
				.filter((row) => row.component_code === line && row.label === label)
				.reduce((total, row) => total + (row[field] ?? 0), 0);
		assert.deepEqual(
			[sum('OVERTIME', 'OT-1.5X', 'quantity'), sum('OVERTIME', 'OT-1.5X', 'amount')],
			[36, 6_750]
		);
		assert.deepEqual(
			[sum('INCENTIVE', 'OT-1.5X', 'quantity'), sum('INCENTIVE', 'OT-1.5X', 'amount')],
			[4, 750]
		);
		assert.deepEqual(
			work
				.filter((row) => row.component_code === 'INCENTIVE')
				.map((row) => [row.source_id.slice(-10), row.quantity])
				.toSorted((a, b) => String(a[0]).localeCompare(String(b[0]))),
			[
				['2026-01-02', 1],
				['2026-01-20', 3]
			]
		);
		assert.equal(sum('OVERTIME', 'OT-2.0X', 'amount'), 1_000);
		assert.equal(slip.gross, 21_750 + 6_750 + 750 + 1_000);
		// The breach is reported, not refused, at payroll (the schedule gate is where art.41 refuses):
		// 4 + 11 × 3 + 3 = 40 regulated hours against 36, and 4 on the 2nd against 3.
		assert.deepEqual(
			warnings.filter((line) => line.includes(key)).map((line) => line.split(':')[0]),
			['OVERTIME_LIMIT_EXCEEDED', 'DAILY_OVERTIME_LIMIT_EXCEEDED']
		);
		// The monthly warning cites the monthly_ot limit's own authority, not the whole work_rules one.
		const monthly = warnings.find((line) =>
			line.includes('worked 40 regulated overtime hours in 2026-01')
		);
		assert.ok(monthly?.includes('(Labour Law art.41: at most 36 extended hours a month)'), monthly);
		// The daily warning cites the daily_ot limit's own authority (art.41: three hours a day).
		assert.ok(
			warnings.some(
				(line) =>
					line.startsWith(
						`DAILY_OVERTIME_LIMIT_EXCEEDED: ${key} worked 4.00 overtime hours on 2026-01-02`
					) &&
					line.includes(
						'above the 3-hour daily overtime limit (Labour Law art.41: at most three extended hours a day for special reasons).'
					)
			),
			warnings.join('\n')
		);
	});

test('Shanghai — final pay is due on the exit day; a month-end run pays a mid-month leaver late (CN-SH02)', () => {
	// 上海市企业工资支付办法 item 7 (沪人社规〔2026〕10号): wages paid in one sum when the exit is
	// completed. The January run pays on Saturday 31 January.
	const { warnings } = buildStatutory({
		code: SH,
		period: '2026-01',
		region: 'SHANGHAI',
		companyFacts: SH_2026_FACTS,
		people: [
			person('SH-MID', 22_000, { exit_date: '2026-01-15', exit_ground: 'RESIGNATION' }),
			person('SH-END', 22_000, { exit_date: '2026-01-31', exit_ground: 'RESIGNATION' })
		]
	});
	const late = warnings.filter((line) => line.startsWith('FINAL_PAY_LATE'));
	assert.equal(late.length, 1);
	assert.match(
		late[0]!,
		/SH-MID left on 2026-01-15.*within 0 days.*by 2026-01-15.*pays on 2026-01-31/
	);
});

test('Kunming — final pay within five working days of the end of the relationship (CN-KM-WP06)', () => {
	// 昆明市工资支付条例 art.13. Thursday 15 January: 16, 19, 20, 21, 22 → due Thursday 22 January,
	// and the 31 January run is late. Tuesday 27 January: 28, 29, 30, 2 and 3 February → due
	// 3 February; the 31 January run is in time.
	const { warnings } = buildStatutory({
		code: KM,
		period: '2026-01',
		region: 'CATEGORY_I',
		companyFacts: KM_2026_FACTS,
		people: [
			person('KM-MID', 21_000, { exit_date: '2026-01-15', exit_ground: 'RESIGNATION' }),
			person('KM-LATE-MONTH', 21_000, { exit_date: '2026-01-27', exit_ground: 'RESIGNATION' })
		]
	});
	const late = warnings.filter((line) => line.startsWith('FINAL_PAY_LATE'));
	assert.equal(late.length, 1);
	assert.match(
		late[0]!,
		/KM-MID left on 2026-01-15.*5 working days.*by 2026-01-22.*pays on 2026-01-31/
	);
});

// ─────────────────────────────────── Kunming: pay and tax ─────────────────────────────────────────

test('Kunming — a joiner and a leaver on the 21.75-day conversion, one unpaid day, and both bonus methods (CN-N02, N04, N09, N10)', () => {
	const { slips } = buildStatutory(
		{
			code: KM,
			period: '2026-01',
			region: 'CATEGORY_I',
			companyFacts: KM_2026_FACTS,
			people: [
				person('KM-JOINER', 21_750, { hire_date: '2026-01-19', hf: { first_ever_account: true } }),
				person('KM-LEAVER', 21_750, { exit_date: '2026-01-15', exit_ground: 'RESIGNATION' }),
				person('KM-NPL', 21_750),
				person('KM-BONUS', 20_000),
				person('KM-YEB', 20_000)
			]
		},
		(world) => {
			const row = leaveCatalogue(KM).find(
				(item) =>
					item.code === 'UNPAID_LEAVE' && item.settings_id === settingsIdOn(KM, '2026-01-14')
			)!;
			world.leave_catalogue.push(row);
			const employment = world.employments.find((item) => item.employee_number === 'KM-NPL')!;
			const term = world.employment_terms.find((item) => item.employment_id === employment.id)!;
			world.leave_entries.push({
				id: 'e1000000-0000-4000-8000-000000000002',
				employment_id: employment.id,
				catalogue_id: row.id,
				leave_code: 'UNPAID_LEAVE',
				reference: 'KM-NPL-1',
				from_date: '2026-01-14',
				to_date: '2026-01-14',
				half_day_start: false,
				half_day_end: false,
				days: 1,
				effective_on: '2026-01-14',
				reason: '事假',
				allocations: [],
				charges: [
					{
						date: '2026-01-14',
						days: 1,
						catalogue_id: row.id,
						employment_term_id: term.id,
						holiday_id: null,
						shift_definition_id: null,
						work_day_id: null
					}
				],
				approval_id: null
			});
			// A contractual 13th month or other bonus is no statutory pay (CN-N53); paid, it is wages.
			adhoc(world, 'KM-BONUS', 'BONUS', 10_000, '2026-01-20', KM);
			adhoc(world, 'KM-YEB', 'ANNUAL_BONUS_SEPARATE', 36_000, '2026-01-20', KM);
		}
	);
	// 21,750 ÷ 21.75 = 1,000 a paid day. Joiner from Monday 19 January: 10 working days → 10,000;
	// leaver to Thursday the 15th: 11 → 11,000; one unpaid day off a full month → 20,750.
	assert.deepEqual(basic(slips.get('KM-JOINER')!), [[10, 21.75, 10_000]]);
	assert.deepEqual(basic(slips.get('KM-LEAVER')!), [[11, 21.75, 11_000]]);
	assert.equal(slips.get('KM-NPL')!.gross, 20_750);
	// Insured on the declared 21,750 (inside both years' bounds): pension 8% 1,740, medical 2% 435,
	// unemployment 0.3% 65.25 (the recorded rate), fund 12% 2,610 each side. A first-ever fund
	// account pays from the second month (Regulation art.17): the joiner has no fund row.
	for (const key of ['KM-JOINER', 'KM-LEAVER', 'KM-NPL']) {
		assert.deepEqual(charge(slips.get(key)!, 'PENSION'), [21_750, 1740, 3480]);
		assert.deepEqual(charge(slips.get(key)!, 'MEDICAL'), [21_750, 435, 1522.5]);
	}
	assert.equal(
		slips.get('KM-JOINER')!.statutory.find((row) => row.scheme_code === 'HOUSING_FUND'),
		undefined
	);
	assert.deepEqual(charge(slips.get('KM-LEAVER')!, 'HOUSING_FUND'), [21_750, 2610, 2610]);
	// IIT (STA 2018 No.61, January is month one): joiner 10,000 − (1,740 + 435 + 65.25) − 5,000 =
	// 2,759.75 × 3% = 82.7925 → 82.79. Leaver, the exit month insured whole: 11,000 − 4,850.25 −
	// 5,000 = 1,149.75 × 3% = 34.4925 → 34.49. Unpaid day: 20,750 − 4,850.25 − 5,000 = 10,899.75 ×
	// 3% = 326.9925 → 326.99.
	assert.equal(charge(slips.get('KM-JOINER')!, 'IIT')[1], 82.79);
	assert.equal(charge(slips.get('KM-LEAVER')!, 'IIT')[1], 34.49);
	assert.equal(charge(slips.get('KM-NPL')!, 'IIT')[1], 326.99);
	// An ordinary bonus joins the month: 30,000 − (1,600 + 400 + 60 + 2,400) − 5,000 = 20,540 × 3%
	// = 616.20. A separately taxed annual bonus (MOF/STA 2023 No.30): 36,000 ÷ 12 = 3,000 → 3% =
	// 1,080 on IIT_BONUS; the wage alone 20,000 − 4,460 − 5,000 = 10,540 × 3% = 316.20.
	assert.equal(charge(slips.get('KM-BONUS')!, 'IIT')[1], 616.2);
	assert.equal(charge(slips.get('KM-YEB')!, 'IIT_BONUS')[1], 1080);
	assert.equal(charge(slips.get('KM-YEB')!, 'IIT')[1], 316.2);
});

test('Kunming — a non-resident’s multi-month bonus: ÷ 6 on the monthly table, × 6, apart from the wage, once a year (MOF/STA 2019 No.35 item 3(2); CN-KM-A1)', () => {
	const run = (period: string, code: string, prior = false) =>
		buildStatutory(
			{
				code: KM,
				period,
				region: 'CATEGORY_I',
				companyFacts: { ...KM_2026_FACTS, injury_rate: 0.4, housing_fund_rate: 5 },
				people: [
					person('KM-NR-BONUS', 30_000, { citizenship: 'FOREIGNER', tax_residency: 'NON_RESIDENT' })
				]
			},
			(world) => {
				if (prior)
					priorSlips(world, 'KM-NR-BONUS', [
						{ period: '2026-01', rows: { IIT_BONUS: [60_000, 4740], IIT: [30_000, 3590] } }
					]);
				adhoc(world, 'KM-NR-BONUS', code, 60_000, `${period}-20`, KM);
			}
		).slips.get('KM-NR-BONUS')!;
	// 60,000 ÷ 6 = 10,000 → 10% less 210 = 790; × 6 = 4,740. The wage alone: 30,000 − 5,000 = 25,000
	// on the monthly table → 990 + 13,000 × 20% = 3,590. Total 8,330, on every 2025–2026 version.
	for (const period of ['2025-12', '2026-01', '2026-09']) {
		const slip = run(period, 'ANNUAL_BONUS_SEPARATE');
		assert.deepEqual(charge(slip, 'IIT_BONUS'), [60_000, 4740, 0], period);
		assert.deepEqual(charge(slip, 'IIT'), [30_000, 3590, 0], period);
	}
	// A bonus not for several months is wages of the month: 90,000 − 5,000 = 85,000 → 45% − 15,160 =
	// 23,090 (STA 2018 No.61 art.9).
	assert.deepEqual(charge(run('2026-01', 'BONUS'), 'IIT'), [90_000, 23_090, 0]);
	// Once per non-resident per calendar year.
	assert.throws(() => run('2026-02', 'ANNUAL_BONUS_SEPARATE', true), /once per tax year/);
});

test('Kunming — overtime at 150% / 200% on the 21.75-day hour (CN-N01, N02, KM-WP08)', () => {
	const { slips } = buildStatutory(
		{
			code: KM,
			period: '2026-01',
			region: 'CATEGORY_I',
			companyFacts: KM_2026_FACTS,
			people: [person('KM-21750', 21_750)]
		},
		(world) => {
			punch(world, 'KM-21750', '2026-01-05', '09:00', '20:00', '13:00'); // Monday: 2 beyond
			punch(world, 'KM-21750', '2026-01-10', '09:00', '17:00'); // Saturday rest day, 8 h
		}
	);
	// 125 an hour: 2 × 125 × 150% = 375; 8 × 125 × 200% = 2,000 (Labour Law art.44).
	const lines = slips
		.get('KM-21750')!
		.adjustments.filter((row) => row.family === 'WORK_DAY')
		.map((row) => [row.source_id.slice(-10), row.label, row.quantity, row.amount])
		.toSorted((a, b) => String(a[0]).localeCompare(String(b[0])));
	assert.deepEqual(lines, [
		['2026-01-05', 'OT-1.5X', 2, 375],
		['2026-01-10', 'OT-2.0X', 8, 2000]
	]);
});

// ─────────────────────────────────── Both cities: economic compensation (经济补偿) ─────────────────

/**
 * 经济补偿 as seeded in every CN-shanghai and CN-kunming version: the ad hoc SEVERANCE_PAY class
 * (counts toward IIT_SEVERANCE only, per `tests/counts-toward-matrix.test.ts`), the IIT_SEVERANCE
 * scheme and the LCL exit facts. The figures below come from the law, not from those rows.
 *
 * - Labour Contract Law (LCL, https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2023/art_0abfdd261c03417b949df19d869add8d.html)
 *   art.46: owed on art.38 (the worker resigns for the employer's fault), art.36 where the employer
 *   proposed the mutual ending, art.40, art.41, art.44(1) fixed-term expiry unless the employer
 *   offered equal or better terms and the worker refused, art.44(4)–(5) bankruptcy, licence
 *   revocation, closure. Not on art.37 resignation or art.39 dismissal.
 * - art.47: one month's wage per full year of service; six months to under a year counts as a
 *   year; under six months half a month. A monthly wage above three times the prior-year monthly
 *   average the city government published is paid at that three times, for at most twelve years.
 *   The monthly wage is the average of the twelve months before the ending (fewer where employed
 *   shorter).
 * - Implementing Regulation (https://xzfg.moj.gov.cn/front/law/detail?LawID=284) art.27: that
 *   wage is the wage due, including hourly or piece wages, bonuses, allowances and subsidies; below
 *   the local minimum wage it is the minimum. art.20: an art.40 ending without thirty days'
 *   notice adds one month at the previous month's wage. art.25: unlawful termination pays the
 *   art.87 damages of twice art.47, and no art.47 compensation beside it.
 * - art.97 para.3 (LCL, read on samr.gov.cn 28 Sep 2026): the art.47 years count from 1 January
 *   2008; earlier service is paid under the rules then in force — a recorded amount, outside the
 *   cap. Regulation art.10: uncompensated service carried from an employer the worker was moved
 *   from counts. Regulation art.25: art.87 damages count every year from hire. A bonus is inside
 *   the average (art.27): both bonus classes mark WAGES.
 *
 * The published average is a departure fact with a dated default per version (owner rule
 * 2026-09-28, register CN-SH50): the calendar year before the exit (literal 上年度), on Shanghai's
 * one published series, 全口径城镇单位就业人员 (CNY12,434 for 2024, CNY12,577 for 2025), and
 * Kunming's 城镇非私营单位就业人员 (CNY126,383 for 2024, https://tjj.km.gov.cn/c/2025-08-21/5011808.shtml
 * → 10,531.92; CNY130,174 for 2025, https://tjj.km.gov.cn/c/2026-08-19/5105682.shtml → 10,847.83).
 * The cases that record a figure test the override, not the default.
 */
type Leaver = {
	key: string;
	wage: number;
	hire: string;
	exit: string;
	ground: string;
	/** The published average recorded on the exit; omitted, the version's default applies. */
	average?: number;
	/** LCL art.97: counted months before 2008 and their compensation under the rules then in force. */
	pre2008?: readonly [months: number, compensation: number];
	/** Regulation art.10: uncompensated months carried from a transferring employer. */
	transferred?: number;
	notice?: number;
	refused?: boolean;
	/** The twelve months' paid wage, where it differs from `wage`. */
	earned?: number;
	/** An ordinary BONUS paid on the December 2025 slip. */
	bonus?: number;
	base?: number;
	hfBase?: number;
};

function severance(
	code: typeof SH | typeof KM,
	period: string,
	region: string,
	companyFacts: Record<string, number>,
	leavers: readonly Leaver[]
) {
	return buildStatutory(
		{
			code,
			period,
			region,
			companyFacts,
			people: leavers.map((leaver) =>
				person(leaver.key, leaver.wage, {
					hire_date: leaver.hire,
					exit_date: leaver.exit,
					exit_ground: leaver.ground === 'ART_41' ? 'REDUNDANCY' : 'MUTUAL',
					...(leaver.base == null ? {} : { base: leaver.base }),
					...(leaver.hfBase == null ? {} : { hfBase: leaver.hfBase })
				})
			)
		},
		(world) => {
			const settingsId = settingsIdOn(code, leavers[0]!.exit);
			const catalogueId = rowIn(world.adhoc_catalogue!, settingsId, 'SEVERANCE_PAY');
			for (const [index, leaver] of leavers.entries()) {
				const employment = world.employments.find((row) => row.employee_number === leaver.key)!;
				(employment as { exit_facts?: Record<string, unknown> }).exit_facts = {
					lcl_termination_ground: leaver.ground,
					renewal_offer_refused: leaver.refused ?? false,
					...(leaver.average == null ? {} : { lcl47_average_monthly_wage: leaver.average }),
					...(leaver.pre2008 == null
						? {}
						: {
								lcl97_pre2008_months: leaver.pre2008[0],
								lcl97_pre2008_compensation: leaver.pre2008[1]
							}),
					...(leaver.transferred == null
						? {}
						: { lcl10_transferred_service_months: leaver.transferred }),
					...(leaver.notice == null ? {} : { notice_days_given: leaver.notice })
				};
				priorWages(world, leaver.key, leaver.earned ?? leaver.wage, period);
				if (leaver.bonus != null)
					(
						world.payslips.find((slip) => slip.id === `payslip-${leaver.key}-2025-12`)!
							.adjustments as unknown[]
					).push({
						family: 'ADHOC',
						source_id: `bonus-${leaver.key}`,
						component_code: 'BONUS',
						label: 'BONUS',
						bucket: 'EARNING',
						amount: leaver.bonus
					});
				world.adhoc_requests!.push({
					id: `d0000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
					employment_id: employment.id,
					catalogue_id: catalogueId,
					amount: 0,
					event_date: leaver.exit,
					pay_period: period,
					payslip_id: null,
					reason: 'SEVERANCE_PAY',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		}
	);
}

const severancePaid = (slip: BuiltPayslip | undefined) =>
	slip!.adjustments.find((row) => row.component_code === 'SEVERANCE_PAY')?.amount ?? 0;

test('Shanghai — 经济补偿: a bonus in the twelve months is inside the monthly wage (Regulation art.27)', () => {
	// 实施条例 art.27 (https://xzfg.moj.gov.cn/front/law/detail?LawID=284, from 18 Sep 2008): the
	// art.47 wage includes 奖金. 12 × 22,000 + 12,000 = 276,000 ÷ 12 = 23,000, under 3 × 12,434;
	// 78 months = 6 years 6 months → 7 × 23,000 = 161,000 (154,000 without the bonus).
	const { slips } = severance(SH, '2026-06', 'SHANGHAI', SH_2026_FACTS, [
		{
			key: 'SH-SEV-BONUS',
			wage: 22_000,
			hire: '2020-01-01',
			exit: '2026-06-30',
			ground: 'ART_41',
			average: 12_434,
			bonus: 12_000
		}
	]);
	assert.equal(severancePaid(slips.get('SH-SEV-BONUS')), 161_000);
});

test('Shanghai — 经济补偿: a month a year, a half year rounds up, under six months is half; none on resignation or a refused renewal (CN-N41)', () => {
	// Exit Tuesday 30 June 2026; twelve paid months June 2025–May 2026 at 22,000 (LCL art.47).
	const { slips } = severance(SH, '2026-06', 'SHANGHAI', SH_2026_FACTS, [
		// 2020-01-01 – 2026-06-30: 78 months = 6 years 6 months → 7 months × 22,000 = 154,000.
		{
			key: 'SH-SEV-RED',
			wage: 22_000,
			hire: '2020-01-01',
			exit: '2026-06-30',
			ground: 'ART_41',
			average: 12_434
		},
		// 2021-02-01: 65 months = 5 years 5 months → 5.5 × 22,000 = 121,000.
		{
			key: 'SH-SEV-5Y5M',
			wage: 22_000,
			hire: '2021-02-01',
			exit: '2026-06-30',
			ground: 'ART_36_EMPLOYER',
			average: 12_434
		},
		// 2023-06-16: 3 years and 15 days (16 June 2026 – 30 June). The 15 days are 不满六个月 →
		// half a month: 3.5 × 22,000 = 77,000 (register CN-N41). Art.87 doubles it: 154,000.
		{
			key: 'SH-SEV-3Y15D',
			wage: 22_000,
			hire: '2023-06-16',
			exit: '2026-06-30',
			ground: 'ART_41',
			average: 12_434
		},
		{
			key: 'SH-SEV-3Y15D-87',
			wage: 22_000,
			hire: '2023-06-16',
			exit: '2026-06-30',
			ground: 'ART_87',
			average: 12_434
		},
		// 2026-02-01: 5 months → half a month, 11,000 (the average over the months employed).
		{
			key: 'SH-SEV-5M',
			wage: 22_000,
			hire: '2026-02-01',
			exit: '2026-06-30',
			ground: 'ART_44_4_5',
			average: 12_434
		},
		// Art.40 with 10 days' notice: 154,000 + the previous month's (May) 22,000 = 176,000.
		{
			key: 'SH-SEV-40',
			wage: 22_000,
			hire: '2020-01-01',
			exit: '2026-06-30',
			ground: 'ART_40',
			notice: 10,
			average: 12_434
		},
		// Art.40 with the full thirty days: 154,000 only.
		{
			key: 'SH-SEV-40N',
			wage: 22_000,
			hire: '2020-01-01',
			exit: '2026-06-30',
			ground: 'ART_40',
			notice: 30,
			average: 12_434
		},
		// Art.87 unlawful termination: twice art.47, 308,000, and no art.47 beside it.
		{
			key: 'SH-SEV-87',
			wage: 22_000,
			hire: '2020-01-01',
			exit: '2026-06-30',
			ground: 'ART_87',
			average: 12_434
		},
		// Fixed-term expiry: owed unless the worker refused equal or better renewal terms.
		{
			key: 'SH-SEV-EXP',
			wage: 22_000,
			hire: '2020-01-01',
			exit: '2026-06-30',
			ground: 'ART_44_1',
			average: 12_434
		},
		{
			key: 'SH-SEV-EXP-R',
			wage: 22_000,
			hire: '2020-01-01',
			exit: '2026-06-30',
			ground: 'ART_44_1',
			refused: true,
			average: 12_434
		},
		{
			key: 'SH-SEV-37',
			wage: 22_000,
			hire: '2020-01-01',
			exit: '2026-06-30',
			ground: 'ART_37',
			average: 12_434
		}
	]);
	assert.equal(severancePaid(slips.get('SH-SEV-RED')), 154_000);
	assert.equal(severancePaid(slips.get('SH-SEV-5Y5M')), 121_000);
	assert.equal(severancePaid(slips.get('SH-SEV-5M')), 11_000);
	assert.equal(severancePaid(slips.get('SH-SEV-3Y15D')), 77_000);
	assert.equal(severancePaid(slips.get('SH-SEV-3Y15D-87')), 154_000);
	assert.equal(severancePaid(slips.get('SH-SEV-40')), 176_000);
	assert.equal(severancePaid(slips.get('SH-SEV-40N')), 154_000);
	assert.equal(severancePaid(slips.get('SH-SEV-87')), 308_000);
	assert.equal(severancePaid(slips.get('SH-SEV-EXP')), 154_000);
	assert.equal(severancePaid(slips.get('SH-SEV-EXP-R')), 0);
	assert.equal(severancePaid(slips.get('SH-SEV-37')), 0);
	// 164号 5(1): 154,000 is under 3 × 12,434 × 12 = 447,624 — no tax; nor does it enter the
	// month's cumulative wage: IIT reads the June wage alone.
	assert.deepEqual(charge(slips.get('SH-SEV-RED')!, 'IIT_SEVERANCE'), [154_000, 0, 0]);
	assert.equal(charge(slips.get('SH-SEV-RED')!, 'IIT')[0], 22_000);
});

test('Shanghai — 经济补偿 above three times the average: capped wage, twelve years, and the tax on the excess (CN-N41, SH50, N39)', () => {
	// 50,000 a month over 15 years (2011-07-01 – 2026-06-30, 180 months). Exit in June 2026: the
	// published prior-year figure then is 2024's 12,434, × 3 = 37,302 < 50,000, so 37,302 × 12
	// years = 447,624. September 2026, after the 18 August publication of 2025's 12,577: 37,731 × 12
	// = 452,772 (the register's CN-SH50 probe).
	const june = severance(SH, '2026-06', 'SHANGHAI', SH_2026_FACTS, [
		{
			key: 'SH-SEV-HIGH',
			wage: 50_000,
			hire: '2011-07-01',
			exit: '2026-06-30',
			ground: 'ART_41',
			average: 12_434
		},
		// Art.87 doubles it: 895,248. Tax: 895,248 − 36 × 12,434 (447,624) = 447,624 taxable alone on
		// the annual table: × 30% − 52,920 = 81,367.20.
		{
			key: 'SH-SEV-HIGH-87',
			wage: 50_000,
			hire: '2011-07-01',
			exit: '2026-06-30',
			ground: 'ART_87',
			average: 12_434
		}
	]);
	assert.equal(severancePaid(june.slips.get('SH-SEV-HIGH')), 447_624);
	// Capped compensation equals the 36 × average exemption exactly: nothing to withhold.
	assert.deepEqual(charge(june.slips.get('SH-SEV-HIGH')!, 'IIT_SEVERANCE'), [447_624, 0, 0]);
	assert.equal(severancePaid(june.slips.get('SH-SEV-HIGH-87')), 895_248);
	assert.deepEqual(
		charge(june.slips.get('SH-SEV-HIGH-87')!, 'IIT_SEVERANCE'),
		[895_248, 81_367.2, 0]
	);
	const september = severance(SH, '2026-09', 'SHANGHAI', SH_2026_FACTS, [
		{
			key: 'SH-SEV-HIGH-SEP',
			wage: 50_000,
			hire: '2011-10-01',
			exit: '2026-09-30',
			ground: 'ART_41',
			average: 12_577
		}
	]);
	assert.equal(severancePaid(september.slips.get('SH-SEV-HIGH-SEP')), 452_772);
});

test('Kunming — 经济补偿 on the national formula, the Yunnan minimum-wage floor and the three-times cap (CN-N41)', () => {
	// Exit Wednesday 30 September 2026, twelve paid months September 2025–August 2026.
	const { slips } = severance(KM, '2026-09', 'CATEGORY_I', KM_2026_FACTS, [
		// 2023-03-01 – 2026-09-30: 43 months = 3 years 7 months → 4 × 10,000 = 40,000.
		{
			key: 'KM-SEV-RED',
			wage: 10_000,
			hire: '2023-03-01',
			exit: '2026-09-30',
			ground: 'ART_41',
			average: 10_847.83
		},
		// Paid 2,000 a month in the twelve months — under category I's 2,270 from 1 September 2026
		// (Regulation art.27): one year (2025-10-01 – 2026-09-30) at 2,270.
		{
			key: 'KM-SEV-MIN',
			wage: 2_300,
			earned: 2_000,
			hire: '2025-10-01',
			exit: '2026-09-30',
			ground: 'ART_41',
			average: 10_847.83,
			base: 4_403,
			hfBase: 2_300
		},
		// 40,000 over 15 years with the recorded 10,847.83 (130,174 ÷ 12): 3 × 10,847.83 = 32,543.49
		// × 12 = 390,521.88; art.40 without notice adds August's 40,000: 430,521.88. Tax: 430,521.88
		// − 36 × 10,847.83 (390,521.88) = 40,000 × 10% − 2,520 = 1,480.
		{
			key: 'KM-SEV-HIGH',
			wage: 40_000,
			hire: '2011-10-01',
			exit: '2026-09-30',
			ground: 'ART_40',
			notice: 0,
			average: 10_847.83,
			base: 22_017
		}
	]);
	assert.equal(severancePaid(slips.get('KM-SEV-RED')), 40_000);
	assert.equal(severancePaid(slips.get('KM-SEV-MIN')), 2_270);
	assert.equal(severancePaid(slips.get('KM-SEV-HIGH')), 430_521.88);
	assert.deepEqual(charge(slips.get('KM-SEV-HIGH')!, 'IIT_SEVERANCE'), [430_521.88, 1_480, 0]);
	assert.deepEqual(charge(slips.get('KM-SEV-RED')!, 'IIT_SEVERANCE'), [40_000, 0, 0]);
});

test('Both cities — 经济补偿 for a leaver hired in the exit month: the one month worked at the wage due (CN-SH-A2)', () => {
	// LCL art.47: under six months is half a month; 工作不满12个月的，按照实际工作的月数计算平均工资.
	// Regulation art.27: the wage due (应得工资). Hired 11 June, out 30 June 2026: no earlier month,
	// so the average is the contract month, 22,000 (register CN-SH-A2): 0.5 × 22,000 = 11,000.
	// Art.40 without notice adds art.20's previous month, none here, so the contract month too:
	// 11,000 + 22,000 = 33,000.
	const june = severance(SH, '2026-06', 'SHANGHAI', SH_2026_FACTS, [
		{
			key: 'SH-SEV-NEW-CLOSE',
			wage: 22_000,
			hire: '2026-06-11',
			exit: '2026-06-30',
			ground: 'ART_44_4_5',
			average: 12_434
		},
		{
			key: 'SH-SEV-NEW-RED',
			wage: 22_000,
			hire: '2026-06-11',
			exit: '2026-06-30',
			ground: 'ART_41',
			average: 12_434
		},
		{
			key: 'SH-SEV-NEW-40',
			wage: 22_000,
			hire: '2026-06-11',
			exit: '2026-06-30',
			ground: 'ART_40',
			notice: 0,
			average: 12_434
		}
	]);
	assert.equal(severancePaid(june.slips.get('SH-SEV-NEW-CLOSE')), 11_000);
	assert.equal(severancePaid(june.slips.get('SH-SEV-NEW-RED')), 11_000);
	assert.equal(severancePaid(june.slips.get('SH-SEV-NEW-40')), 33_000);
	// Kunming: hired 11 September, out 30 September 2026 at 10,000: 0.5 × 10,000 = 5,000.
	const september = severance(KM, '2026-09', 'CATEGORY_I', KM_2026_FACTS, [
		{
			key: 'KM-SEV-NEW',
			wage: 10_000,
			hire: '2026-09-11',
			exit: '2026-09-30',
			ground: 'ART_41',
			average: 10_847.83
		}
	]);
	assert.equal(severancePaid(september.slips.get('KM-SEV-NEW')), 5_000);
});

test('Shanghai — 经济补偿 in the first sealed version (December 2025): six whole years (CN-N41)', () => {
	// 2020-01-01 – Wednesday 31 December 2025: 72 months = 6 years → 6 × 22,000 = 132,000, under
	// 3 × 12,434 (the 2024 average published 18 Sep 2025, CN-SH50); no tax under 164号 5(1).
	const { slips } = severance(SH, '2025-12', 'SHANGHAI', SH_2025_FACTS, [
		{
			key: 'SH-SEV-DEC',
			wage: 22_000,
			hire: '2020-01-01',
			exit: '2025-12-31',
			ground: 'ART_41',
			average: 12_434
		}
	]);
	assert.equal(severancePaid(slips.get('SH-SEV-DEC')), 132_000);
	assert.deepEqual(charge(slips.get('SH-SEV-DEC')!, 'IIT_SEVERANCE'), [132_000, 0, 0]);
});

test('Shanghai — 经济补偿 with service before 2008: art.47 counts from 1 January 2008, the earlier years as recorded, art.87 from hire (CN-N41, LCL art.97)', () => {
	// Hire 1 March 2005, exit Wednesday 30 September 2026, 22,000 a month: 259 months, 34 of them
	// before 2008. art.97 para.3: 225 months = 18 years 9 months → 19 × 22,000 = 418,000, plus the
	// unit's recorded 66,000 for the 2005–2007 service under the rules then in force = 484,000.
	// No recorded average: the version's default 12,577 (2025, owner rule) → cap 37,731, not reached.
	// Tax (164号 5(1)): 484,000 − 36 × 12,577 (452,772) = 31,228 × 3% = 936.84.
	// Fixed-term expiry: the pre-2008 rules owed nothing on expiry, so the unit records 0: 418,000.
	// art.87 (Regulation art.25: 赔偿金的计算年限自用工之日起计算): 259 months = 21 years 7 months → 22 ×
	// 22,000 × 2 = 968,000, the pre-2008 figure not added. Tax: 968,000 − 452,772 = 515,228 × 30% −
	// 52,920 = 101,648.40.
	const { slips } = severance(SH, '2026-09', 'SHANGHAI', SH_2026_FACTS, [
		{
			key: 'SH-SEV-2005',
			wage: 22_000,
			hire: '2005-03-01',
			exit: '2026-09-30',
			ground: 'ART_41',
			pre2008: [34, 66_000]
		},
		{
			key: 'SH-SEV-2005-EXP',
			wage: 22_000,
			hire: '2005-03-01',
			exit: '2026-09-30',
			ground: 'ART_44_1',
			pre2008: [34, 0]
		},
		{
			key: 'SH-SEV-2005-87',
			wage: 22_000,
			hire: '2005-03-01',
			exit: '2026-09-30',
			ground: 'ART_87',
			pre2008: [34, 66_000]
		}
	]);
	assert.equal(severancePaid(slips.get('SH-SEV-2005')), 484_000);
	assert.deepEqual(charge(slips.get('SH-SEV-2005')!, 'IIT_SEVERANCE'), [484_000, 936.84, 0]);
	assert.equal(severancePaid(slips.get('SH-SEV-2005-EXP')), 418_000);
	assert.equal(severancePaid(slips.get('SH-SEV-2005-87')), 968_000);
	assert.deepEqual(charge(slips.get('SH-SEV-2005-87')!, 'IIT_SEVERANCE'), [968_000, 101_648.4, 0]);
	// A pre-2008 hire without the art.97 facts is not priced (the request is skipped by name with a
	// warning) rather than counting 2005–2007 under art.47.
	const blank = severance(SH, '2026-09', 'SHANGHAI', SH_2026_FACTS, [
		{
			key: 'SH-SEV-2005-BLANK',
			wage: 22_000,
			hire: '2005-03-01',
			exit: '2026-09-30',
			ground: 'ART_41'
		}
	]);
	assert.equal(severancePaid(blank.slips.get('SH-SEV-2005-BLANK')), 0);
	assert.ok(
		blank.warnings.some(
			(line) => line.includes('SH-SEV-2005-BLANK') && line.includes('before 1 January 2008')
		),
		blank.warnings.join('\n')
	);
});

test('Shanghai — 经济补偿 counts service carried from a transferring employer (Regulation art.10)', () => {
	// Hire 1 January 2022, exit 30 September 2026: 57 months = 4 years 9 months → 5 × 22,000 = 110,000.
	// With 30 uncompensated months carried: 87 = 7 years 3 months → 7.5 × 22,000 = 165,000.
	const { slips } = severance(SH, '2026-09', 'SHANGHAI', SH_2026_FACTS, [
		{ key: 'SH-SEV-OWN', wage: 22_000, hire: '2022-01-01', exit: '2026-09-30', ground: 'ART_41' },
		{
			key: 'SH-SEV-MOVED',
			wage: 22_000,
			hire: '2022-01-01',
			exit: '2026-09-30',
			ground: 'ART_41',
			transferred: 30
		}
	]);
	assert.equal(severancePaid(slips.get('SH-SEV-OWN')), 110_000);
	assert.equal(severancePaid(slips.get('SH-SEV-MOVED')), 165_000);
});

test('both cities — the default published average is the prior calendar year’s (owner rule 2026-09-28, CN-SH50, N39)', () => {
	// Shanghai June 2026, nothing recorded: 2025's 12,577 → 37,731 × 12 years = 452,772, exactly the
	// 36 × 12,577 exemption: no tax.
	const shanghai = severance(SH, '2026-06', 'SHANGHAI', SH_2026_FACTS, [
		{ key: 'SH-SEV-DEF', wage: 50_000, hire: '2011-07-01', exit: '2026-06-30', ground: 'ART_41' }
	]);
	assert.equal(severancePaid(shanghai.slips.get('SH-SEV-DEF')), 452_772);
	assert.deepEqual(charge(shanghai.slips.get('SH-SEV-DEF')!, 'IIT_SEVERANCE'), [452_772, 0, 0]);
	// Kunming December 2025: 2024's non-private 126,383 ÷ 12 = 10,531.92 → 31,595.76 × 12 years =
	// 379,149.12 for 40,000 a month over 15 years; equal to the exemption, no tax.
	const kunming = severance(KM, '2025-12', 'CATEGORY_I', KM_2025_FACTS, [
		{
			key: 'KM-SEV-DEF',
			wage: 40_000,
			hire: '2010-12-01',
			exit: '2025-12-31',
			ground: 'ART_41',
			base: 21_789
		}
	]);
	assert.equal(severancePaid(kunming.slips.get('KM-SEV-DEF')), 379_149.12);
	assert.deepEqual(charge(kunming.slips.get('KM-SEV-DEF')!, 'IIT_SEVERANCE'), [379_149.12, 0, 0]);
	// One CN lineage: the exit fact has no single default; each rule reading it falls back to the
	// worksite city's published figure in force on the version.
	const defaults = settingsVersions(SH).map((version) => {
		const fact = (version.exit_facts as { key: string; default_value?: number }[]).find(
			(row) => row.key === 'lcl47_average_monthly_wage'
		)!;
		const amount = String(seeded(adhocCatalogue(SH), version.id, 'SEVERANCE_PAY').bands[0].amount);
		const [, shanghai, kunming] =
			/exit_facts\.lcl47_average_monthly_wage : \(person\.terms\.worksite == "SHANGHAI" \? ([\d.]+) : \(person\.terms\.worksite in \[[^\]]*\] \? ([\d.]+)/.exec(
				amount
			)!;
		return [fact.default_value ?? null, Number(shanghai), Number(kunming)];
	});
	assert.deepEqual(defaults, [
		[null, 12_434, 10_531.92],
		[null, 12_577, 10_847.83],
		[null, 12_577, 10_847.83],
		[null, 12_577, 10_847.83],
		[null, 12_577, 10_847.83]
	]);
});

// ─────────────────────────────────── Both cities: maternity allowance against the wage ────────────

/** Paid maternity leave on every weekday of `from`–`to`, and the allowance the fund paid the worker. */
function maternityMonth(
	code: typeof SH | typeof KM,
	period: string,
	region: string,
	companyFacts: Record<string, number>,
	cases: ReadonlyArray<{
		key: string;
		wage: number;
		from: string;
		to: string;
		allowance: number;
		/** The share of the benefit the employer owes itself (MATERNITY_BENEFIT_EMPLOYER). */
		employerShare?: number;
	}>
) {
	return buildStatutory(
		{
			code,
			period,
			region,
			companyFacts,
			people: cases.map((row) => person(row.key, row.wage, { gender: 'FEMALE' }))
		},
		(world) => {
			const row = leaveCatalogue(code).find(
				(item) =>
					item.code === 'MATERNITY_LEAVE' && item.settings_id === settingsIdOn(code, `${period}-01`)
			)!;
			world.leave_catalogue.push(row);
			for (const [index, entry] of cases.entries()) {
				const employment = world.employments.find((item) => item.employee_number === entry.key)!;
				const term = world.employment_terms.find((item) => item.employment_id === employment.id)!;
				const dates: string[] = [];
				for (
					let day = new Date(`${entry.from}T00:00:00Z`);
					day <= new Date(`${entry.to}T00:00:00Z`);
					day.setUTCDate(day.getUTCDate() + 1)
				)
					if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6)
						dates.push(day.toISOString().slice(0, 10));
				world.leave_entries.push({
					id: `e2000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
					employment_id: employment.id,
					catalogue_id: row.id,
					leave_code: 'MATERNITY_LEAVE',
					reference: `ML-${index}`,
					from_date: entry.from,
					to_date: entry.to,
					facts: {
						event_kind: 'BIRTH',
						event_date: entry.from
					},
					half_day_start: false,
					half_day_end: false,
					days: dates.length,
					effective_on: entry.from,
					reason: '产假',
					allocations: [],
					charges: dates.map((date) => ({
						date,
						days: 1,
						catalogue_id: row.id,
						employment_term_id: term.id,
						holiday_id: null,
						shift_definition_id: null,
						work_day_id: null
					})),
					approval_id: null
				});
				adhoc(world, entry.key, 'MATERNITY_ALLOWANCE_OFFSET', entry.allowance, entry.to, code);
				if (entry.employerShare != null)
					adhoc(
						world,
						entry.key,
						'MATERNITY_BENEFIT_EMPLOYER',
						entry.employerShare,
						entry.to,
						code
					);
			}
		}
	);
}

const offsetOf = (slip: BuiltPayslip | undefined) =>
	slip!.adjustments.find((row) => row.component_code === 'MATERNITY_ALLOWANCE_OFFSET')?.amount ?? 0;

test('Shanghai — the allowance paid to the worker offsets the leave wage; the employer pays the shortfall (CN-SH14, SH21)', () => {
	// The August 2026 payslip settles the leave of its 21 July–20 August window (23 weekdays). SH-MAT at
	// 20,000, every weekday on paid maternity leave: the fund paid her 15,000 for those days (the
	// agency's figure). 沪医保规〔2026〕5号 item 4: the employer pays the 5,000 below the wage — gross
	// 20,000 − 15,000 = 5,000, and the IIT base is that 5,000 (the allowance is exempt, 财税〔2008〕8号).
	// SH-MAT-HIGH at 20,000 with 25,000 paid: the line stops at the leave days' wage, 20,000; she keeps
	// the higher allowance. SH-MAT-PART on leave 21 July–7 August only (14 of 23 weekdays): the leave
	// days' wage is 20,000 × 14 ÷ 23 = 12,173.91 (person.period.leave_pay), below the 15,000 paid, so
	// there is no shortfall and the line takes back 12,173.91 — never the worked days' wage:
	// gross 20,000 − 12,173.91 = 7,826.09.
	const { slips } = maternityMonth(SH, '2026-08', 'SHANGHAI', SH_2026_FACTS, [
		{ key: 'SH-MAT', wage: 20_000, from: '2026-07-21', to: '2026-08-20', allowance: 15_000 },
		{ key: 'SH-MAT-HIGH', wage: 20_000, from: '2026-07-21', to: '2026-08-20', allowance: 25_000 },
		{ key: 'SH-MAT-PART', wage: 20_000, from: '2026-07-21', to: '2026-08-07', allowance: 15_000 }
	]);
	const slip = slips.get('SH-MAT')!;
	assert.equal(offsetOf(slip), 15_000);
	assert.equal(slip.gross, 5_000);
	assert.equal(charge(slip, 'IIT')[0], 5_000);
	assert.equal(offsetOf(slips.get('SH-MAT-HIGH')), 20_000);
	assert.equal(slips.get('SH-MAT-HIGH')!.gross, 0);
	assert.equal(offsetOf(slips.get('SH-MAT-PART')), 12_173.91);
	assert.equal(slips.get('SH-MAT-PART')!.gross, 7_826.09);
	assert.equal(charge(slips.get('SH-MAT-PART')!, 'IIT')[0], 7_826.09);
});

test('Kunming — the employer tops the allowance up to the wage (CN-KM32, owner rule 2026-09-28)', () => {
	// The August 2026 window (21 July–20 August) wholly on paid maternity leave at 12,000; the fund paid
	// the worker 9,000 (employer prior-year average ÷ 30 × days, item 2): the employer pays the 3,000 difference.
	const { slips } = maternityMonth(KM, '2026-08', 'CATEGORY_I', KM_2026_FACTS, [
		{ key: 'KM-MAT', wage: 12_000, from: '2026-07-21', to: '2026-08-20', allowance: 9_000 }
	]);
	assert.equal(offsetOf(slips.get('KM-MAT')), 9_000);
	assert.equal(slips.get('KM-MAT')!.gross, 3_000);
	assert.equal(charge(slips.get('KM-MAT')!, 'IIT')[0], 3_000);
});

test('every CN version seeds MATERNITY_ALLOWANCE_OFFSET', () => {
	for (const code of [SH, KM] as const)
		for (const version of settingsVersions(code))
			for (const row of [
				'MATERNITY_ALLOWANCE_OFFSET',
				'MATERNITY_BENEFIT_EMPLOYER',
				'NO_WRITTEN_CONTRACT_WAGE',
				'EARLY_RETIREMENT_SUBSIDY',
				'INTERNAL_RETIREMENT_SUBSIDY'
			])
				rowIn(adhocCatalogue(code), version.id, row);
});

test('China — internal-retirement subsidy and this month’s wage share one tax base and rate (1999 No.58 art.1)', () => {
	for (const [code, region, companyFacts] of [
		[SH, 'SHANGHAI', SH_2026_FACTS],
		[KM, 'CATEGORY_I', KM_2026_FACTS]
	] as const) {
		const key = `${code}-INTERNAL`;
		const slip = buildStatutory(
			{ code, period: '2026-01', region, companyFacts, people: [person(key, 10_000)] },
			(world) => {
				world.employments.find((row) => row.employee_number === key)!.exit_facts = {
					iit164_internal_retirement_months: 24
				};
				adhoc(world, key, 'INTERNAL_RETIREMENT_SUBSIDY', 120_000, '2026-01-20', code);
			}
		).slips.get(key)!;
		// 国税发〔1999〕58号 art.1: the one-off spread over the 24 months to statutory age is merged
		// with this month's wage to choose the rate — 10,000 + 120,000 ÷ 24 − 5,000 = 10,000, the
		// 10% rung — and that rate is charged on wage plus the whole one-off less the 5,000 monthly
		// deduction: 125,000 × 10% − 210 = 12,290. STA's annual-settlement FAQ (Shanxi 2021, Q20)
		// then takes off the wage's own monthly tax so only the subsidy is charged: 10,000 − 5,000 =
		// 5,000 taxable is 3,000 at 3% (90) plus 2,000 at 10% (200) = 290. 12,290 − 290 = 12,000.
		// The wage stays in ordinary cumulative IIT: STA 2018 No.61 art.6 withholds on the ANNEX table 1
		// annual scale (3% to 36,000, 10% to 144,000…), not the monthly one. Shanghai's 1,750 of
		// employee social insurance and housing fund leaves 10,000 − 1,750 − 5,000 = 3,250 taxable,
		// so 3% = 97.50; this golden once withheld 115 there, the monthly scale's 3,250 × 10% − 210.
		// Kunming's recorded contributions leave 2,770, 3% = 83.10 — inside the 3% rung either way.
		assert.deepEqual(charge(slip, 'IIT_INTERNAL_RETIREMENT'), [130_000, 12_000, 0]);
		assert.deepEqual(charge(slip, 'IIT'), [10_000, code === SH ? 97.5 : 83.1, 0]);
	}
});

test('every CN version seeds SEVERANCE_PAY, IIT_SEVERANCE and the LCL exit facts', () => {
	for (const code of [SH, KM] as const)
		for (const version of settingsVersions(code)) {
			rowIn(adhocCatalogue(code), version.id, 'SEVERANCE_PAY');
			rowIn(contributionSchemes(code), version.id, 'IIT_SEVERANCE');
			rowIn(contributionSchemes(code), version.id, 'IIT_EARLY_RETIREMENT');
			rowIn(contributionSchemes(code), version.id, 'IIT_INTERNAL_RETIREMENT');
			assert.deepEqual(
				(version.exit_facts as { key: string }[]).map((fact) => fact.key),
				[
					'lcl_termination_ground',
					'notice_days_given',
					'renewal_offer_refused',
					'lcl47_average_monthly_wage',
					'lcl97_pre2008_months',
					'lcl97_pre2008_compensation',
					'lcl10_transferred_service_months',
					'iit164_early_retirement_years',
					'iit164_internal_retirement_months'
				],
				`${code} ${version.name}`
			);
		}
});

// ─────────────────────────────────── Both cities: maternity for a third infant; Yunnan childcare ────

/** One leave row of a version, read for a person with the given children and event on `asOf`. */
function leaveGrant(
	code: typeof SH | typeof KM,
	settingsId: string,
	leave: string,
	options: {
		gender: string;
		births: readonly string[];
		asOf: string;
		event?: { kind: string; date: string; relationship?: string };
	}
) {
	const row = leaveCatalogue(code).find(
		(item) => item.settings_id === settingsId && item.code === leave
	)!;
	const personOn = (date: string) =>
		personContext({
			employee: { gender: options.gender, marital_status: 'MARRIED' },
			employment: { service_start: '2020-01-01' },
			// The worksite's locality selects the city's leave rows.
			terms: { worksite: code === SH ? 'SHANGHAI' : KM_WUHUA },
			children: options.births.map((birth) => ({ child_birthdate: birth })),
			event: options.event ?? null,
			asOf: date
		} as never);
	if (!isEligible(row.eligibility as string, personOn(options.asOf))) return null;
	const rule = row.entitlement as never as Parameters<typeof computedEntitlement>[0]['rule'];
	if (rule.availability === 'PER_EVENT') return grantedDays(rule, personOn(options.asOf));
	return computedEntitlement({
		rule,
		window: leaveWindowOf(options.asOf, rule),
		asOf: options.asOf,
		hireDate: '2020-01-01',
		exitDate: null,
		servedOn: () => true,
		eligibleOn: () => true,
		personOn
	}).entitlement;
}

test('both cities — a third and fourth infant each add 15 maternity days, on every version (CN-N20)', () => {
	// 女职工劳动保护特别规定 art.7 (https://xzfg.moj.gov.cn/mobile/law/detail?LawID=343): 98 days,
	// 15 more for a difficult birth, "生育多胞胎的，每多生育1个婴儿，增加产假15天"; the city 生育假 adds 60
	// (沪府规〔2022〕18号 art.2; 云南省人口与计划生育条例 as amended 17 Jan 2022). Triplets: 98 + 30 + 60
	// = 188; difficult: 203; quadruplets: 98 + 45 + 60 = 203. Two recorded: twins, 173.
	const day = '2026-03-10';
	for (const code of [SH, KM] as const)
		for (const version of settingsVersions(code)) {
			const days = (kind: string, infants: number) =>
				leaveGrant(code, version.id, 'MATERNITY_LEAVE', {
					gender: 'FEMALE',
					births: Array.from({ length: infants }, () => day),
					asOf: day,
					event: { kind, date: day }
				});
			assert.deepEqual(
				[
					days('MULTIPLE_BIRTH', 2),
					days('MULTIPLE_BIRTH', 3),
					days('DIFFICULT_MULTIPLE_BIRTH', 3),
					days('MULTIPLE_BIRTH', 4),
					days('DIFFICULT_BIRTH', 1),
					days('BIRTH', 1)
				],
				[173, 188, 203, 203, 173, 158],
				`${code} ${version.name}`
			);
			// The recorded children are the infant count: a multiple birth with fewer than two recorded
			// on the event date is refused, never granted the twins' days.
			for (const [kind, infants] of [
				['MULTIPLE_BIRTH', 1],
				['DIFFICULT_MULTIPLE_BIRTH', 0]
			] as const)
				assert.throws(() => days(kind, infants), /multiple birth/i, `${code} ${version.name}`);
		}
});

test('Kunming — 育儿假: 10 days a calendar year for a child under three, 15 for two or more, each parent (CN-KM12)', () => {
	// 云南省人口与计划生育条例 (17 Jan 2022, read on https://sft.yn.gov.cn/yfzs/pages_1_3173.aspx):
	// "子女不满3周岁的，夫妻双方所在单位分别给予每年累计10天的育儿假。有两个以上不满3周岁子女的，再增加5天";
	// the year is the calendar year, not carried over (楚雄市卫生健康局, https://www.cxs.gov.cn/info/9025/254978.htm).
	const asOf = '2026-06-15';
	for (const version of settingsVersions(KM)) {
		const days = (gender: string, births: readonly string[]) =>
			leaveGrant(KM, version.id, 'CHILDCARE_LEAVE', { gender, births, asOf });
		assert.deepEqual(
			[
				days('FEMALE', ['2025-02-01']),
				days('MALE', ['2025-02-01']),
				days('FEMALE', ['2025-02-01', '2024-01-10']),
				days('FEMALE', ['2025-02-01', '2021-01-10']),
				days('FEMALE', ['2023-06-14'])
			],
			// The last child turned three on 14 June: no leave from that day.
			[10, 10, 15, 10, null],
			version.name
		);
	}
});

test('Shanghai — 育儿假: 5 days for each child under three, in each year from that child’s birth date (CN-SH13)', () => {
	// 沪府规〔2022〕18号 art.3 (https://www.shanghai.gov.cn/nw12344/20221110/87151565cd6246c99854c129797d178c.html):
	// "双方每年可以享受育儿假各5天 … 育儿假按照生育的子女数量累计计算天数 … 每年的育儿假从其子女出生之日起计算".
	// 上海市卫生健康委 口径 Q4 (https://www.shqp.gov.cn/wsjkw/wsjkw/upload/202112/1202_170513_376.pdf):
	// "周年" — born 1 Dec 2021, the year runs to 30 Nov 2022.
	for (const version of settingsVersions(SH)) {
		const row = leaveCatalogue(SH).find(
			(item) => item.settings_id === version.id && item.code === 'CHILDCARE_LEAVE'
		)!;
		const world = (births: readonly string[]) => {
			const context = leaveContext();
			context.terms[0]!.worksite = 'SHANGHAI';
			context.employees[0]!.children = births.map((child_birthdate) => ({
				child_birthdate,
				relationship: 'CHILD',
				effective_range: null
			}));
			context.catalogues.push({
				id: id(90),
				settings_id: id(6),
				code: 'CHILDCARE_LEAVE',
				name: row.name as string,
				is_npl: false,
				can_encash: false,
				evidence_after_days: null,
				eligibility: row.eligibility as string,
				entitlement: row.entitlement as never
			});
			let n = 100;
			return (from: string, to: string): string => {
				n += 1;
				try {
					const plan = planLeaveActivity(
						context,
						{ ...submission(timeOff(from, to), `C${n}`), catalogue_id: id(90) },
						id(n)
					);
					context.entries.push({ ...plan, id: id(n), approval_id: null });
					return `${plan.days}`;
				} catch (error) {
					return refusalMessage(error).includes('year from a child') ? 'refused' : 'ineligible';
				}
			};
		};
		// One child born 1 Dec 2024: its year 1 Dec 2025 – 30 Nov 2026 holds 5 days. A sixth on
		// 30 Nov is refused; 1 Dec 2026 opens its next year, though calendar 2026 then holds 6 days.
		const one = world(['2024-12-01']);
		assert.deepEqual(
			[
				one('2026-01-05', '2026-01-09'),
				one('2026-11-30', '2026-11-30'),
				one('2026-12-01', '2026-12-05'),
				one('2026-12-06', '2026-12-06')
			],
			['5', 'refused', '5', 'refused'],
			version.name
		);
		// Two children under three: 5 days each, each child on its own year. A second child born
		// 10 Mar 2026 adds 5 days from that date, so 30 Nov 2026 is its day, not the first's.
		const two = world(['2024-12-01', '2026-03-10']);
		assert.deepEqual(
			[
				two('2026-01-05', '2026-01-09'),
				two('2026-03-02', '2026-03-02'),
				two('2026-03-10', '2026-03-13'),
				two('2026-11-30', '2026-11-30'),
				two('2026-12-01', '2026-12-01')
			],
			['5', 'refused', '4', '1', '1'],
			version.name
		);
		// Born 14 Jun 2023: the year 14 Jun 2025 – 13 Jun 2026 is the last before the third
		// birthday ("年满3周岁之前"); from 14 Jun 2026 nothing is owed.
		const turning = world(['2023-06-14']);
		assert.deepEqual(
			[turning('2026-06-09', '2026-06-13'), turning('2026-06-14', '2026-06-14')],
			['5', 'ineligible'],
			version.name
		);
	}
});

// ─────────────────────────────────── Both cities: the employer's own maternity share (round 6) ─────

const employerShareOf = (slip: BuiltPayslip | undefined) =>
	slip!.adjustments.find((row) => row.component_code === 'MATERNITY_BENEFIT_EMPLOYER')?.amount ?? 0;

test('Shanghai — under 12 / 9 insured months the employer advances the fund’s missing twelfths; above 300% it pays the excess (CN-SH14, SH21)', () => {
	// 沪医保规〔2026〕5号 (read on shanghai.gov.cn 28 Sep 2026) item 3(1): allowance = the unit's
	// prior-year monthly average ÷ 30 × leave days; item 4(1) para.2: under 12 cumulative and 9
	// consecutive insured months the fund pays months ÷ 12 of it, the unit 先行垫付 the rest; item 4(2)
	// para.1: the part of the unit average above 300% of the city average is the unit's.
	// The August 2026 window 21 July–20 August: 31 calendar days, every weekday on maternity leave.
	// SH-MAT-ADV at 12,000, unit average 15,000, 6 months insured: allowance 15,000 ÷ 30 × 31 =
	// 15,500; the fund pays 6/12 = 7,750 to her, the unit advances 7,750. The offset takes back the
	// 12,000 leave wage (never above it), the unit's line pays 7,750: gross 7,750, IIT base 0 (both the
	// offset and the advance are outside it, 财税〔2008〕8号); with the fund's 7,750 she has 15,500.
	// SH-MAT-EXC at 50,000: the fund paid 38,000 at the 300% cap, the unit average above it owes
	// 8,500 more (agency figures), allowance 46,500 < 50,000: the offset takes 46,500, the unit's
	// line pays 8,500: gross 50,000 − 46,500 + 8,500 = 12,000; with the fund's 38,000 she has her wage.
	const { slips } = maternityMonth(SH, '2026-08', 'SHANGHAI', SH_2026_FACTS, [
		{
			key: 'SH-MAT-ADV',
			wage: 12_000,
			from: '2026-07-21',
			to: '2026-08-20',
			allowance: 15_500,
			employerShare: 7_750
		},
		{
			key: 'SH-MAT-EXC',
			wage: 50_000,
			from: '2026-07-21',
			to: '2026-08-20',
			allowance: 46_500,
			employerShare: 8_500
		}
	]);
	const adv = slips.get('SH-MAT-ADV')!;
	assert.equal(offsetOf(adv), 12_000);
	assert.equal(employerShareOf(adv), 7_750);
	assert.equal(adv.gross, 7_750);
	assert.equal(charge(adv, 'IIT')[0], 0);
	const exc = slips.get('SH-MAT-EXC')!;
	assert.equal(offsetOf(exc), 46_500);
	assert.equal(employerShareOf(exc), 8_500);
	assert.equal(exc.gross, 12_000);
	assert.equal(charge(exc, 'IIT')[0], 3_500);
});

test('Kunming — an employer that did not enrol pays the allowance and the 1,000 nutrition grant itself (CN-KM32 item 3)', () => {
	// Kunming rules of 17 July 2024 item 3: a unit that did not enrol pays every benefit at the
	// standard. Allowance (item 2(8)): unit prior-year average 10,000 ÷ 30 × 31 days = 10,333.33;
	// nutrition grant (item 2(13)): 1,000 for a single birth. KM-MAT-UNINS at 12,000, the window
	// wholly on leave: the offset takes back 10,333.33, the unit's line pays 10,333.33 + 1,000 =
	// 11,333.33: gross 12,000 − 10,333.33 + 11,333.33 = 13,000 = the wage (the top-up default) + the
	// grant. IIT base: 12,000 − 10,333.33 = 1,666.67 (the benefit line is exempt, 财税〔2008〕8号).
	const { slips } = maternityMonth(KM, '2026-08', 'CATEGORY_I', KM_2026_FACTS, [
		{
			key: 'KM-MAT-UNINS',
			wage: 12_000,
			from: '2026-07-21',
			to: '2026-08-20',
			allowance: 10_333.33,
			employerShare: 11_333.33
		}
	]);
	const slip = slips.get('KM-MAT-UNINS')!;
	assert.equal(offsetOf(slip), 10_333.33);
	assert.equal(employerShareOf(slip), 11_333.33);
	assert.equal(slip.gross, 13_000);
	assert.equal(charge(slip, 'IIT')[0], 1_666.67);
});

// ─────────────────────────────────── Both cities: no written contract (LCL art.82, round 6) ────────

const secondWageOf = (slip: BuiltPayslip | undefined) =>
	slip!.adjustments.find((row) => row.component_code === 'NO_WRITTEN_CONTRACT_WAGE')?.amount ?? 0;

test('both cities — no written contract: a second wage from the day after the first month to the day before signing, at most eleven months (CN-N41, LCL art.82, Regulation arts.6–7)', () => {
	// 实施条例 (https://xzfg.moj.gov.cn/front/law/detail?LawID=284, read 28 Sep 2026) art.6 para.2:
	// 起算时间为用工之日起满一个月的次日，截止时间为补订书面劳动合同的前一日; art.7: at one year, to the day
	// before it. The line is raised on the day the contract is concluded (or the anniversary).
	// Hired 1 Jan 2026, signed 16 Apr 2026: 1 Feb – 15 Apr = 2 months and 15 of April's 30 days =
	// 2.5 × 10,000 = 25,000. Hired 1 Apr, signed 20 Apr: inside the first month, nothing.
	// Hired 1 Sep 2025, never signed: at the anniversary, 1 Oct 2025 – 31 Aug 2026 = 11 months =
	// 110,000 (art.7), never 12.
	const cases = [
		{
			code: SH,
			period: '2026-04',
			region: 'SHANGHAI',
			facts: SH_2026_FACTS,
			key: 'SH-NWC',
			hire: '2026-01-01',
			signed: '2026-04-16',
			owed: 25_000
		},
		{
			code: SH,
			period: '2026-04',
			region: 'SHANGHAI',
			facts: SH_2026_FACTS,
			key: 'SH-NWC-EARLY',
			hire: '2026-04-01',
			signed: '2026-04-20',
			owed: 0
		},
		{
			code: SH,
			period: '2026-09',
			region: 'SHANGHAI',
			facts: SH_2026_FACTS,
			key: 'SH-NWC-YEAR',
			hire: '2025-09-01',
			signed: '2026-09-01',
			owed: 110_000
		},
		{
			code: KM,
			period: '2026-04',
			region: 'CATEGORY_I',
			facts: KM_2026_FACTS,
			key: 'KM-NWC',
			hire: '2026-01-01',
			signed: '2026-04-16',
			owed: 25_000
		},
		{
			code: KM,
			period: '2026-09',
			region: 'CATEGORY_I',
			facts: KM_2026_FACTS,
			key: 'KM-NWC-YEAR',
			hire: '2025-09-01',
			signed: '2026-09-01',
			owed: 110_000
		}
	] as const;
	for (const row of cases) {
		const { slips } = buildStatutory(
			{
				code: row.code,
				period: row.period,
				region: row.region,
				companyFacts: row.facts,
				people: [person(row.key, 10_000, { hire_date: row.hire })]
			},
			(world) => adhoc(world, row.key, 'NO_WRITTEN_CONTRACT_WAGE', 0, row.signed, row.code)
		);
		assert.equal(secondWageOf(slips.get(row.key)), row.owed, row.key);
	}
});

test('Shanghai — a worker who will not sign after the first month is ended with art.47 compensation (CN-N41, Regulation art.6 para.1)', () => {
	// 实施条例 art.6 para.1: 劳动者不与用人单位订立书面劳动合同的，用人单位应当书面通知劳动者终止劳动关系，
	// 并依照劳动合同法第四十七条的规定支付经济补偿. Hired 1 Jan 2026, ended 30 June 2026: 6 months =
	// 一年 under art.47 → 1 × 22,000.
	const { slips } = severance(SH, '2026-06', 'SHANGHAI', SH_2026_FACTS, [
		{
			key: 'SH-SEV-REG6',
			wage: 22_000,
			hire: '2026-01-01',
			exit: '2026-06-30',
			ground: 'REG_6',
			average: 12_577
		}
	]);
	assert.equal(severancePaid(slips.get('SH-SEV-REG6')), 22_000);
});

// ─────────────────────────────────── Both cities: probation and the open-ended contract (LCL arts.19–20, 82–83, round 7) ──

const lineOf = (slip: BuiltPayslip | undefined, code: string) =>
	slip!.adjustments.find((row) => row.component_code === code)?.amount ?? 0;

/** One contract with its probation and open-ended facts on the terms, and one line raised on `raised`. */
function contractLine(
	row: {
		readonly code: typeof SH | typeof KM;
		readonly period: string;
		readonly key: string;
		readonly wage: number;
		readonly hire: string;
		readonly end?: string;
		readonly probationEnd?: string;
		readonly after?: number;
		readonly due?: string;
		readonly raised: string;
	},
	line: string
) {
	const { slips } = buildStatutory(
		{
			code: row.code,
			period: row.period,
			region: row.code === SH ? 'SHANGHAI' : 'CATEGORY_I',
			companyFacts: row.code === SH ? SH_2026_FACTS : KM_2026_FACTS,
			people: [
				person(row.key, row.wage, {
					hire_date: row.hire,
					...(row.end == null ? {} : { exit_date: row.end, employment_type: 'CONTRACT' })
				})
			]
		},
		(world) => {
			const employment = world.employments.find((item) => item.employee_number === row.key)!;
			const terms = world.employment_terms.find((item) => item.employment_id === employment.id)!;
			// The contract determinations are the version's declared terms inputs (`terms_facts`).
			terms.facts = {
				...terms.facts,
				...(row.probationEnd == null ? {} : { probation_end: row.probationEnd }),
				...(row.after == null ? {} : { post_probation_wage: row.after }),
				...(row.due == null ? {} : { open_ended_due_on: row.due })
			};
			adhoc(world, row.key, line, 0, row.raised, row.code);
			world.adhoc_requests!.at(-1)!.pay_period = row.period;
		}
	);
	return lineOf(slips.get(row.key), line);
}

test('both cities — probation served beyond the art.19 limit is paid as damages at the wage after probation (CN-N41, LCL arts.19, 83)', () => {
	// LCL (samr.gov.cn, re-read 29 Sep 2026) art.19: a term of 1 to under 3 years allows at most
	// 2 months, 3 years or open-ended 6, under 3 months none; art.83: 以劳动者试用期满月工资为标准，
	// 按已经履行的超过法定试用期的期间 支付赔偿金. Raised on the probation's last day.
	// 1-year term (2026-01-01 – 2026-12-31 = 12 months → limit 2), probation to 31 Mar = 3 months,
	// wage after probation 10,000: (3 − 2) × 10,000 = 10,000.
	// Same term, probation to 16 Mar: 2 months + 16 of March's 31 days = 2.516129 → 0.516129 ×
	// 10,000 = 5,161.29.
	// Open-ended, probation to 30 June = 6 months: at the limit, 0.
	// 2-month term (to 28 Feb → limit 0), probation to 31 Jan = 1 month, no separate wage recorded
	// (owner rule: the contract wage 10,000): 1 × 10,000 = 10,000.
	for (const code of [SH, KM] as const) {
		const base = { code, wage: 8_000, hire: '2026-01-01', after: 10_000 };
		assert.equal(
			contractLine(
				{
					...base,
					period: '2026-03',
					key: `${code}-P83`,
					end: '2026-12-31',
					probationEnd: '2026-03-31',
					raised: '2026-03-31'
				},
				'PROBATION_EXCESS_DAMAGES'
			),
			10_000,
			code
		);
		assert.equal(
			contractLine(
				{
					...base,
					period: '2026-03',
					key: `${code}-P83-PART`,
					end: '2026-12-31',
					probationEnd: '2026-03-16',
					raised: '2026-03-16'
				},
				'PROBATION_EXCESS_DAMAGES'
			),
			5_161.29,
			code
		);
		assert.equal(
			contractLine(
				{
					...base,
					period: '2026-06',
					key: `${code}-P83-OPEN`,
					probationEnd: '2026-06-30',
					raised: '2026-06-30'
				},
				'PROBATION_EXCESS_DAMAGES'
			),
			0,
			code
		);
		assert.equal(
			contractLine(
				{
					code,
					period: '2026-01',
					key: `${code}-P83-SHORT`,
					wage: 10_000,
					hire: '2026-01-01',
					end: '2026-02-28',
					probationEnd: '2026-01-31',
					raised: '2026-01-31'
				},
				'PROBATION_EXCESS_DAMAGES'
			),
			10_000,
			code
		);
	}
});

test('both cities — a probation wage under 80% of the agreed wage is owed as arrears (CN-N41, LCL art.20, Regulation art.15)', () => {
	// Regulation art.15 (xzfg.moj.gov.cn, re-read 29 Sep 2026): 不得低于劳动合同约定工资的80%.
	// Open-ended, probation 1 Jan – 31 Mar = 3 months, agreed 10,000 → floor 8,000.
	// Paid 7,000: (8,000 − 7,000) × 3 = 3,000. Paid 8,000: 0.
	for (const code of [SH, KM] as const) {
		const base = {
			code,
			period: '2026-03',
			hire: '2026-01-01',
			after: 10_000,
			probationEnd: '2026-03-31',
			raised: '2026-03-31'
		};
		assert.equal(
			contractLine({ ...base, key: `${code}-P20`, wage: 7_000 }, 'PROBATION_WAGE_SHORTFALL'),
			3_000,
			code
		);
		assert.equal(
			contractLine({ ...base, key: `${code}-P20-AT`, wage: 8_000 }, 'PROBATION_WAGE_SHORTFALL'),
			0,
			code
		);
	}
});

test('both cities — an open-ended contract not concluded when due pays a second wage from that day (CN-N41, LCL arts.14, 82 para.2)', () => {
	// LCL art.82 para.2: 自应当订立无固定期限劳动合同之日起向劳动者每月支付二倍的工资. Hired 1 Jan 2016,
	// ten years' service on 1 Jan 2026 (art.14 para.2(1)), due recorded 1 Jan 2026; the open-ended
	// contract concluded 16 Apr, the line raised 15 Apr: 1 Jan – 15 Apr = 3 months + 15 of April's
	// 30 days = 3.5 × 10,000 = 35,000. A due date later than the request refuses: the liability runs
	// FROM the day the contract fell due, so a request dated before it states a liability that cannot
	// have arisen — the line was settled at nothing before this workstream, which read a determination
	// the contract does not carry as a nil one.
	for (const code of [SH, KM] as const) {
		const base = {
			code,
			period: '2026-04',
			wage: 10_000,
			hire: '2016-01-01',
			raised: '2026-04-15'
		};
		assert.equal(
			contractLine({ ...base, key: `${code}-OE`, due: '2026-01-01' }, 'OPEN_ENDED_CONTRACT_WAGE'),
			35_000,
			code
		);
		assert.throws(
			() =>
				contractLine(
					{ ...base, key: `${code}-OE-LATER`, due: '2026-05-01' },
					'OPEN_ENDED_CONTRACT_WAGE'
				),
			/OPEN_ENDED_CONTRACT_WAGE: record an open_ended_due_on from service start through the liability event date/,
			code
		);
	}
});

// ─────────────────────────────────── Both cities: early retirement (财税〔2018〕164号 5(2), round 6) ──

test('both cities — an early-retirement subsidy is spread over the actual years to statutory age on the annual table (CN-N39)', () => {
	// 164号 item 5(2) (STA copy https://fgk.chinatax.gov.cn/zcfgk/c102416/c5202364/content.html):
	// tax = {[(subsidy ÷ years) − 60,000] × rate − QD} × years, alone; 60,000 is IIT Law art.6(1).
	// 500,000 over 4 years: 125,000 − 60,000 = 65,000 → 10% − 2,520 = 3,980 × 4 = 15,920.
	// 240,000 over 4: 60,000 − 60,000 = 0 → nothing. The 3% / 10% seam over 2 years: 192,000 →
	// 36,000 × 3% = 1,080 × 2 = 2,160; 192,002 → 36,001 × 10% − 2,520 = 1,080.10 × 2 = 2,160.20.
	// Unrecorded years refuse.
	const run = (code: typeof SH | typeof KM, amount: number, years: number | null) => {
		const key = `${code}-ER`;
		const book = buildStatutory(
			{
				code,
				period: '2026-06',
				region: code === SH ? 'SHANGHAI' : 'CATEGORY_I',
				companyFacts: code === SH ? SH_2026_FACTS : KM_2026_FACTS,
				people: [
					person(key, 20_000, {
						hire_date: '2010-01-01',
						exit_date: '2026-06-30',
						exit_ground: 'RETIREMENT'
					})
				]
			},
			(world) => {
				const employment = world.employments.find((row) => row.employee_number === key)!;
				(employment as { exit_facts?: Record<string, unknown> }).exit_facts = {
					lcl_termination_ground: 'ART_44_2_3',
					...(years == null ? {} : { iit164_early_retirement_years: years })
				};
				adhoc(world, key, 'EARLY_RETIREMENT_SUBSIDY', amount, '2026-06-30', code);
				// The exit day is past the cutoff: the leaver's final payslip settles it.
				world.adhoc_requests!.at(-1)!.pay_period = '2026-06';
			}
		);
		return book;
	};
	for (const code of [SH, KM] as const) {
		const tax = (amount: number, years: number) =>
			charge(run(code, amount, years).slips.get(`${code}-ER`)!, 'IIT_EARLY_RETIREMENT');
		assert.deepEqual(tax(500_000, 4), [500_000, 15_920, 0], code);
		assert.deepEqual(tax(240_000, 4), [240_000, 0, 0], code);
		assert.deepEqual(tax(192_000, 2), [192_000, 2_160, 0], code);
		assert.deepEqual(tax(192_002, 2), [192_002, 2_160.2, 0], code);
		assert.throws(() => run(code, 500_000, null), /iit164_early_retirement_years/, code);
	}
});

// ─────────────────────────────────── Both cities: exempt receipts, heat, funeral and injury leave ──

/** One seeded catalogue row of a version, whole. */
const seeded = <Row extends { settings_id: string; code: string }>(
	rows: readonly Row[],
	settingsId: string,
	code: string
) =>
	rows.find((row) => row.settings_id === settingsId && row.code === code) ??
	assert.fail(`No ${code} in ${settingsId}`);

test('both cities — 独生子女补贴, 托儿补助费, 差旅费津贴 and 误餐补助 stay out of the IIT base (国税发〔1994〕89号 item 2; CN-N55)', () => {
	// 国税发〔1994〕89号 item 2 (https://fgk.chinatax.gov.cn/zcfgk/c100011/c5216297/content.html): these are
	// 不属于工资、薪金性质的补贴、津贴 and 不征税. 100 + 200 + 300 + 50 = 650 is paid on top of the wage and the
	// wage's tax is unchanged: Shanghai 20,000 − 3,500 − 5,000 = 11,500 × 3% = 345; Kunming 10,000 −
	// (800 + 200 + 30 + 1,200) − 5,000 = 2,770 × 3% = 83.10.
	const exempt = [
		['ONE_CHILD_SUBSIDY', 100],
		['CHILDCARE_SUBSIDY', 200],
		['TRAVEL_ALLOWANCE', 300],
		['MISSED_MEAL_SUBSIDY', 50]
	] as const;
	const run = (
		code: typeof SH | typeof KM,
		key: string,
		wage: number,
		region: string,
		facts: Record<string, number>
	) =>
		buildStatutory(
			{ code, period: '2026-01', region, companyFacts: facts, people: [person(key, wage)] },
			(world) => {
				for (const [row, amount] of exempt) adhoc(world, key, row, amount, '2026-01-10', code);
			}
		).slips.get(key)!;
	const sh = run(SH, 'SH-EXEMPT', 20_000, 'SHANGHAI', SH_2026_FACTS);
	assert.deepEqual(charge(sh, 'IIT'), [20_000, 345, 0]);
	assert.equal(sh.gross, 20_650);
	const km = run(KM, 'KM-EXEMPT', 10_000, 'CATEGORY_I', KM_2026_FACTS);
	assert.deepEqual(charge(km, 'IIT'), [10_000, 83.1, 0]);
	assert.equal(km.gross, 10_650);
	for (const code of [SH, KM] as const)
		for (const version of settingsVersions(code))
			for (const [row] of exempt)
				assert.deepEqual(
					seeded(adhocCatalogue(code), version.id, row).counts_toward,
					[],
					`${code} ${version.name} ${row}`
				);
});

test('Shanghai — the summer heat allowance is 300 a month from June to September, taxed as wages (沪人社规〔2019〕19号; CN-SH19)', () => {
	// 沪人社规〔2019〕19号 items 1–3 (in force to 31 Dec 2028 by 沪人社规〔2023〕29号): CNY300 a month, June to
	// September, for open-air work or a workplace not brought below 33℃; in 工资总额. On a 20,000 wage the
	// July slip is 20,300 gross and the IIT base 20,300; May pays none (20,000); a contract figure of 400
	// is kept (the notice is a floor for the months it covers).
	const run = (period: string, amount: number) =>
		buildStatutory(
			{
				code: SH,
				period,
				region: 'SHANGHAI',
				companyFacts: SH_2026_FACTS,
				people: [person('SH-HEAT', 20_000)]
			},
			(world) => {
				const row = world.allowance_catalogue!.find(
					(item) =>
						item.code === 'HEAT_ALLOWANCE' && item.settings_id === settingsIdOn(SH, `${period}-15`)
				)!;
				for (const terms of world.employment_terms)
					terms.allowances = [{ catalogue_id: row.id, amount }];
			}
		).slips.get('SH-HEAT')!;
	const july = run('2026-07', 300);
	assert.equal(july.gross, 20_300);
	assert.equal(charge(july, 'IIT')[0], 20_300);
	const may = run('2026-05', 300);
	assert.equal(may.gross, 20_000);
	assert.equal(charge(may, 'IIT')[0], 20_000);
	assert.equal(run('2026-08', 400).gross, 20_400);
	for (const version of settingsVersions(SH))
		rowIn(allowanceCatalogue(SH), version.id, 'HEAT_ALLOWANCE');
});

test('both cities — 丧假: three paid days for a parent, the spouse or a child, on every version (CN-N51)', () => {
	// 国劳总薪字〔1980〕29号 item 1: 一至三天 for 直系亲属（父母、配偶和子女）; the seed grants the maximum, as
	// MARRIAGE_LEAVE does (owner rule 2026-09-28). 工资支付暂行规定 art.11: paid at the contract standard.
	const day = '2026-03-10';
	for (const code of [SH, KM] as const)
		for (const version of settingsVersions(code)) {
			const days = (relationship: string) =>
				leaveGrant(code, version.id, 'FUNERAL_LEAVE', {
					gender: 'MALE',
					births: [],
					asOf: day,
					event: { kind: 'DEATH', relationship, date: day }
				});
			assert.deepEqual(
				[days('PARENT'), days('SPOUSE'), days('CHILD'), days('SIBLING')],
				[3, 3, 3, null],
				`${code} ${version.name}`
			);
			// Shanghai only: 沪劳资发〔87〕130号 (kept to 15 Aug 2031 by 沪人社规〔2026〕12号) gives 一至三天 for a
			// 岳父母或公婆 funeral, the discretionary maximum 3 (register CN-SH17); Yunnan has no such rule.
			assert.equal(days('PARENT_IN_LAW'), code === SH ? 3 : null, `${code} ${version.name}`);
			assert.equal(seeded(leaveCatalogue(code), version.id, 'FUNERAL_LEAVE').is_npl, false);
		}
});

test('Kunming — 停工留薪期: paid work-injury leave, at most 24 months (731 calendar days), certificate required (工伤保险条例 art.33; CN-N21)', () => {
	// Art.33: 原工资福利待遇不变，由所在单位按月支付; 一般不超过12个月, extended at most 12 more on the committee's
	// confirmation — 24 months is at most 731 days. Shanghai measures the pay on the prior 12-month average
	// (CN-SH20), which the leave row cannot state, so it has no row.
	const day = '2026-03-10';
	for (const version of settingsVersions(KM)) {
		assert.equal(
			leaveGrant(KM, version.id, 'WORK_INJURY_LEAVE', {
				gender: 'FEMALE',
				births: [],
				asOf: day,
				event: { kind: 'WORK_INJURY', date: day }
			}),
			731,
			version.name
		);
		const row = seeded(leaveCatalogue(KM), version.id, 'WORK_INJURY_LEAVE');
		assert.deepEqual(
			[row.is_npl, row.evidence, (row.entitlement as { calendar_days?: boolean }).calendar_days],
			[false, 'REQUIRED', true],
			version.name
		);
	}
	// A Shanghai worksite is never granted the row.
	for (const version of settingsVersions(SH))
		assert.equal(
			leaveGrant(SH, version.id, 'WORK_INJURY_LEAVE', {
				gender: 'FEMALE',
				births: [],
				asOf: day,
				event: { kind: 'WORK_INJURY', date: day }
			}),
			null,
			version.name
		);
});

test('Kunming — housing rent and housing-loan interest in one year refuse (国发〔2018〕41号; CN-N54)', () => {
	assert.throws(
		() =>
			assessStatutory({
				code: KM,
				period: '2026-01',
				region: 'CATEGORY_I',
				companyFacts: KM_2026_FACTS,
				people: [
					person('KM-BOTH', 10_000, {
						iit: {
							deduction_claims: ['HOUSING_RENT', 'HOUSING_LOAN_INTEREST'].map((category) => ({
								period: '2026-01',
								category,
								amount: 1_000,
								source: 'EMPLOYEE',
								reference: category
							}))
						}
					})
				]
			}),
		/cannot both be deducted/
	);
});

test('Kunming — a foreign worker without a fund agreement is outside the fund: no base is demanded (CN-KM18.optional-participants)', () => {
	const book = assessStatutory({
		code: KM,
		period: '2026-01',
		region: 'CATEGORY_I',
		companyFacts: KM_2026_FACTS,
		people: [
			person('KM-FOREIGN', 10_000, {
				citizenship: 'FOREIGNER',
				registrations: { HOUSING_FUND: { kind: 'REGISTERED', elections: {} } }
			})
		]
	});
	// Insured like anyone else (CN-N25): pension 8% / 16% of 10,000 = 800 / 1,600; no fund line.
	expectStatutory(book, 'KM-FOREIGN', 'PENSION', 800, 1600);
	expectStatutorySkipped(book, 'KM-FOREIGN', 'HOUSING_FUND');
	// Control: a citizen with no declared base still refuses.
	assert.throws(
		() =>
			assessStatutory({
				code: KM,
				period: '2026-01',
				region: 'CATEGORY_I',
				companyFacts: KM_2026_FACTS,
				people: [
					person('KM-NOBASE', 10_000, {
						registrations: { HOUSING_FUND: { kind: 'REGISTERED', elections: {} } }
					})
				]
			}),
		/contribution base/
	);
});

test('Kunming — elderly support: CNY3,000 a month for an only child, a sibling’s share at most CNY1,500 (国发〔2018〕41号; 2023 No.14; CN-N16)', () => {
	const elderly = (amount: number, onlyChild?: boolean) => ({
		iit: {
			...(onlyChild == null ? {} : { elections: { elderly_support_only_child: onlyChild } }),
			deduction_claims: [
				{
					period: '2026-01',
					category: 'ELDERLY_SUPPORT',
					amount,
					source: 'EMPLOYEE',
					reference: 'ELDER-1'
				}
			]
		}
	});
	const book = assessStatutory({
		code: KM,
		period: '2026-01',
		region: 'CATEGORY_I',
		companyFacts: KM_2026_FACTS,
		people: [
			person('KM-ONLY', 20_000, elderly(3_000, true)),
			person('KM-SIBLING', 20_000, elderly(1_500))
		]
	});
	// Insurance 1,600 + 400 + 60 + fund 2,400 = 4,460.
	// Only child: 20,000 − 4,460 − 5,000 − 3,000 = 7,540 × 3% = 226.20.
	expectStatutory(book, 'KM-ONLY', 'IIT', 226.2, 0);
	// Sibling: 20,000 − 4,460 − 5,000 − 1,500 = 9,040 × 3% = 271.20.
	expectStatutory(book, 'KM-SIBLING', 'IIT', 271.2, 0);
	// A sibling's 1,600 is above the 1,500 share: refused, not deducted.
	assert.throws(
		() =>
			assessStatutory({
				code: KM,
				period: '2026-01',
				region: 'CATEGORY_I',
				companyFacts: KM_2026_FACTS,
				people: [person('KM-SIBLING-1600', 20_000, elderly(1_600))]
			}),
		/Elderly support above the cap/
	);
});

test('Shanghai and Kunming — no one under sixteen is recruited without the art.13 exception (禁止使用童工规定 arts.2, 13; CN-N29)', () => {
	for (const code of [SH, KM])
		for (const version of settingsVersions(code)) {
			const at = 'TERMS_CHANGE' as const;
			const day = String(version.effective_range.start).slice(0, 10);
			const judge = (born: string, facts: Record<string, string> = {}) =>
				checkIssues({
					checks: checksOf(version).filter((check) => check.code === 'CHILD_LABOUR_UNDER_16'),
					at,
					context: checkContext({
						at,
						date: day,
						person: personContext({
							employee: { date_of_birth: born },
							employment: { service_start: day },
							terms: { base_salary: 3_000, currency: 'CNY', pay_frequency: 'MONTHLY', facts },
							asOf: day
						})
					}),
					subject: 'E001'
				}).map((issue) => issue.code);
			const year = Number(day.slice(0, 4));
			// Sixteen on the day of hire: recruited. Fifteen: refused.
			assert.deepEqual(judge(`${year - 16}${day.slice(4)}`), [], `${code} ${day} sixteen`);
			const under = `${year - 15}${day.slice(4)}`;
			assert.deepEqual(judge(under), ['CHILD_LABOUR_UNDER_16'], `${code} ${day} fifteen`);
			// Art.13: an arts or sports unit's hire with the guardian's consent on file.
			assert.deepEqual(
				judge(under, { under_16_exception_reference: 'ART13-CONSENT' }),
				[],
				`${code} ${day} art.13`
			);
		}
});

test('every sealed version of `CN-shanghai` and `CN-kunming` is priced by a golden here', () => {
	assertEveryVersionPriced(SH);
	assertEveryVersionPriced(KM);
});
