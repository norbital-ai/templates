/**
 * Compliance closure probes — Philippines (2026-09-29 pass).
 *
 * - PH-SS01 (docs/inventory/philippines.md): "SSS Circular 2024-007 ... contains a separate
 *   household-employer table from January 2025. Below PHP5,000 monthly compensation it has nine
 *   brackets, not the business table's single PHP5,000 minimum MSC." The probe prices the
 *   register's three source-derived examples through the saved run: PHP3,000 household
 *   compensation → PHP450 employer regular SS, PHP0 employee regular SS, plus PHP10 employer EC;
 *   PHP4,800 → PHP750/PHP0 plus PHP10 EC; PHP5,000 → PHP500/PHP250 plus PHP10 EC.
 * - PH-WG30/31/29/16/17/15/23/14/22/32/33/34–37 (seed-only, untested): the exact worksites each
 *   signed order names select the sealed class at the daily rate the register records, one
 *   centavo below refuses, and an interval that straddles a tranche with no complete private rate
 *   refuses the site rather than guessing.
 *
 * Figures are the orders' own; they are not read off the engine.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assessStatutoryUnvalidated,
	buildStatutory,
	expectStatutory
} from './fixtures/statutory-world.ts';

test('PH-SS01 — the household SSS table prices nine brackets below PHP5,000, employer-only', () => {
	const companyFacts = { minimum_wage_exemption_approved: true };
	// The domestic minimum-wage floor refuses a low synthetic run before settlement, so the probe
	// reads the assessed scheme book the run builds (no settlement) rather than a payslip.
	const run = (wage: number) =>
		assessStatutoryUnvalidated({
			code: 'PH',
			period: '2026-10',
			region: 'NCR',
			companyFacts,
			people: [{ key: 'DW', wage, employment_type: 'DOMESTIC' }]
		});
	// Circular 2024-007 pp.1–3: PHP3,000 → PHP450 employer / PHP0 employee; PHP4,800 → PHP750/PHP0;
	// PHP5,000 is the boundary where the business shares begin: PHP500 employer / PHP250 employee.
	expectStatutory(run(3_000), 'DW', 'SSS', 0, 450);
	expectStatutory(run(3_000), 'DW', 'SSS_EC', 0, 10);
	expectStatutory(run(4_800), 'DW', 'SSS', 0, 750);
	expectStatutory(run(4_800), 'DW', 'SSS_EC', 0, 10);
	expectStatutory(run(5_000), 'DW', 'SSS', 250, 500);
	expectStatutory(run(5_000), 'DW', 'SSS_EC', 0, 10);
});

test('PH-HD03 — the kasambahay fund-salary boundaries: employer-paid below PHP5,000, split shares from it, capped at PHP10,000', () => {
	const run = (wage: number) =>
		assessStatutoryUnvalidated({
			code: 'PH',
			period: '2026-10',
			region: 'NCR',
			people: [{ key: 'DW', wage, employment_type: 'DOMESTIC' }]
		});
	// Circular 460 pp.2–3: at or below PHP1,500 the employer pays 2% + the 1% employee share and the
	// employee pays nothing (PHP1,500 → PHP45); above it the employer pays 4% (PHP1,501 → PHP60.04;
	// PHP4,999 → PHP199.96); from a PHP5,000 fund salary the shares split 2%/2% (PHP100 each); a fund
	// salary above the PHP10,000 cap splits the capped PHP200 each (PHP10,001 → PHP200/PHP200).
	expectStatutory(run(1_500), 'DW', 'HDMF', 0, 45);
	expectStatutory(run(1_501), 'DW', 'HDMF', 0, 60.04);
	expectStatutory(run(4_999), 'DW', 'HDMF', 0, 199.96);
	expectStatutory(run(5_000), 'DW', 'HDMF', 100, 100);
	expectStatutory(run(10_001), 'DW', 'HDMF', 200, 200);
});

const facts = (count = 20) => ({
	minimum_wage_exemption_approved: false,
	ph_wage_one_establishment: true,
	ph_wage_worker_count: count
});

const site = (period: string, worksite: string, sector: string, wage: number, count = 20) =>
	buildStatutory({
		code: 'PH',
		period,
		region: worksite.split('/')[0]!,
		companyFacts: facts(count),
		people: [
			{
				key: 'W',
				wage,
				pay_frequency: 'DAILY',
				worksite,
				worksite_sector: sector
			}
		]
	});

/** The site pays the order's daily floor and refuses one centavo below it. */
const floor = (period: string, worksite: string, sector: string, daily: number, count = 20) => {
	assert.ok(
		site(period, worksite, sector, daily, count).slips.has('W'),
		`${worksite} ${sector} pays ${daily}`
	);
	assert.throws(
		() => site(period, worksite, sector, daily - 0.01, count),
		/MINIMUM_WAGE_BELOW/,
		`${worksite} ${sector} blocks ${daily - 0.01}`
	);
};

test('PH wage orders — the exact worksites of the I/II/CAR/IV-B/V/XIII extension pay their sealed floors', () => {
	// RB I-24 (19 November 2025): agriculture and non-agriculture <10 PHP480; non-agriculture 10+
	// PHP505. RTWPB 2-24: PHP500 private. CAR-24: PHP505 from 30 December 2025. MIMAROPA-13:
	// PHP455 from 1 January 2026. RBV-22: PHP435 before the 8 April 2026 tranche. RXIII-19/20:
	// PHP455 after the 3 January 2026 tranche.
	floor('2026-02', 'I/Alaminos', 'AGRICULTURE', 480);
	floor('2026-02', 'I/Alaminos', 'OTHER_NONAGRI', 505, 10);
	floor('2026-02', 'II/Tuguegarao', 'OTHER_NONAGRI', 500);
	floor('2026-02', 'CAR/Baguio', 'OTHER_NONAGRI', 505);
	floor('2026-02', 'IV-B/Calapan', 'OTHER_NONAGRI', 455);
	floor('2026-02', 'V/Iriga', 'AGRICULTURE', 435);
	floor('2026-02', 'XIII/Bayugan', 'AGRICULTURE', 455);
	// The 1 April–25 September 2026 version spans the 8 April V tranche: it has no V private key, so
	// the site refuses instead of pricing the superseded rate.
	assert.throws(() => site('2026-04', 'V/Iriga', 'AGRICULTURE', 435), /No sealed/);
});

test('PH wage orders — the exact worksites of the VIII/IX/X/XI/XII/VI/VII/III extension pay their sealed floors', () => {
	// RBVIII-25: agriculture/retail 1–10 PHP422; 11+ PHP452. RIX-24: low PHP426 / high PHP439.
	// RX-24: Category I PHP486 / II PHP471 from 7 February 2026. RB XI-24: agriculture PHP505 /
	// non-agriculture PHP510 in the pre-13 March 2026 intervals. RB XII-25: agriculture PHP443 /
	// non-agriculture PHP460 from 15 December 2025. RBVI-29: agriculture PHP520, non-agriculture
	// 11+ PHP550. ROVII-26: Class A PHP540 before 26 September 2026. RBIII-26: agriculture PHP540,
	// other non-agriculture PHP570 before the 16 April 2026 tranche.
	floor('2026-02', 'VIII/Tacloban', 'AGRICULTURE', 422);
	floor('2026-02', 'VIII/Tacloban', 'RETAIL_SERVICE', 452, 11);
	floor('2026-02', 'IX/Zamboanga', 'AGRICULTURE', 426);
	floor('2026-02', 'IX/Zamboanga', 'OTHER_NONAGRI', 439);
	floor('2026-03', 'X/Manolo Fortich', 'OTHER_NONAGRI', 486);
	floor('2026-03', 'X/Manolo Fortich', 'RETAIL_SERVICE', 471, 10);
	floor('2026-01', 'XI/Davao', 'AGRICULTURE', 505);
	floor('2026-01', 'XI/Davao', 'OTHER_NONAGRI', 510);
	floor('2026-02', 'XII/Koronadal', 'AGRICULTURE', 443);
	floor('2026-02', 'XII/Koronadal', 'OTHER_NONAGRI', 460);
	floor('2026-02', 'VI/Iloilo City', 'AGRICULTURE', 520);
	floor('2026-02', 'VI/Iloilo City', 'OTHER_NONAGRI', 550, 11);
	floor('2026-02', 'VII/Cebu', 'OTHER_NONAGRI', 540);
	floor('2026-02', 'Pampanga/San Fernando', 'AGRICULTURE', 540);
	floor('2026-02', 'Pampanga/San Fernando', 'OTHER_NONAGRI', 570);
	// The 7 February–31 March version spans the 13 March XI tranche; the 26 September version holds
	// the announced but not-yet-effective ROVII-27; both refuse the site.
	assert.throws(() => site('2026-02', 'XI/Davao', 'AGRICULTURE', 505), /No sealed/);
	assert.throws(() => site('2026-10', 'VII/Cebu', 'OTHER_NONAGRI', 540), /No sealed/);
});
