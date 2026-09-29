import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatutory, settingsVersions } from './fixtures/statutory-world.ts';

const facts = (count: number, one = true) => ({
	minimum_wage_exemption_approved: false,
	ph_wage_one_establishment: one,
	ph_wage_worker_count: count
});

const ncr = (sector: string | null, count: number, region = 'NCR') =>
	buildStatutory({
		code: 'PH',
		period: '2026-10',
		region,
		companyFacts: facts(count),
		people: [{ key: 'W', wage: 16_000, worksite: 'NCR/Manila', worksite_sector: sector }]
	});

test('PH wage order: NCR sector and establishment thresholds select the lower or ordinary rate', () => {
	// NCR-28: ₱718 × 261/12 = ₱15,616.50; ₱755 × 261/12 = ₱16,421.25.
	for (const [sector, count] of [
		['AGRICULTURE', 20],
		['RETAIL_SERVICE', 15],
		['MANUFACTURING', 9]
	] as const)
		assert.ok(ncr(sector, count).slips.has('W'));
	for (const [sector, count] of [
		['RETAIL_SERVICE', 16],
		['MANUFACTURING', 10],
		['OTHER_NONAGRI', 20]
	] as const)
		assert.throws(() => ncr(sector, count), /MINIMUM_WAGE_BELOW: W/);
	// A manually entered legacy pseudo-region cannot turn an ordinary establishment agricultural.
	assert.throws(() => ncr('OTHER_NONAGRI', 20, 'NCR-AGRI-SMALL'), /MINIMUM_WAGE_BELOW: W/);
});

const iva = (period: string, worksite: string, sector: string, wage: number, count = 20) =>
	buildStatutory({
		code: 'PH',
		period,
		region: 'IV-A',
		companyFacts: facts(count),
		people: [{ key: 'W', wage, worksite, worksite_sector: sector }]
	});

test('PH wage order: Cavite Rosario keeps its ₱600 exception; Batangas Rosario is first class', () => {
	// The names coincide; the province distinguishes the ₱600 and ₱550 non-agriculture floors.
	assert.throws(
		() => iva('2026-10', 'Cavite/Rosario', 'OTHER_NONAGRI', 12_500),
		/MINIMUM_WAGE_BELOW: W/
	);
	assert.ok(iva('2026-10', 'Batangas/Rosario', 'OTHER_NONAGRI', 12_500).slips.has('W'));
	assert.ok(iva('2026-10', 'Cavite/Rosario', 'AGRICULTURE', 12_500).slips.has('W'));
});

test('PH wage order: IV-A reclassified and small-retail tranches follow the dated version', () => {
	// Noveleta: non-agriculture ₱510 upon effectivity, ₱550 from 1 April 2026.
	assert.ok(iva('2025-12', 'Cavite/Noveleta', 'OTHER_NONAGRI', 11_500).slips.has('W'));
	assert.throws(
		() => iva('2026-10', 'Cavite/Noveleta', 'OTHER_NONAGRI', 11_500),
		/MINIMUM_WAGE_BELOW: W/
	);
	// Retail/service of ten or fewer: ₱485, then ₱508, regardless of the municipality's class.
	assert.ok(iva('2025-12', 'Cavite/Rosario', 'RETAIL_SERVICE', 10_800, 10).slips.has('W'));
	assert.throws(
		() => iva('2026-10', 'Cavite/Rosario', 'RETAIL_SERVICE', 10_800, 10),
		/MINIMUM_WAGE_BELOW: W/
	);
});

test('PH wage order: missing, ambiguous or multi-establishment class inputs refuse', () => {
	assert.throws(() => ncr(null, 20), /exact worksite and wage-order sector/);
	assert.throws(
		() => iva('2026-10', 'Batangas/Malvar', 'OTHER_NONAGRI', 20_000),
		/No sealed wage-order class/
	);
	assert.throws(
		() =>
			buildStatutory({
				code: 'PH',
				period: '2026-10',
				region: 'NCR',
				companyFacts: facts(15, false),
				people: [
					{ key: 'W', wage: 16_000, worksite: 'NCR/Manila', worksite_sector: 'RETAIL_SERVICE' }
				]
			}),
		/verified single-establishment/
	);
});

test('PH reduced classes refuse unsupported municipality, sector and size claims', () => {
	const reducedNcr = {
		code: 'PH' as const,
		period: '2026-10',
		region: 'NCR',
		companyFacts: facts(15),
		people: [{ key: 'W', wage: 16_000, worksite: 'NCR/Manila', worksite_sector: 'RETAIL_SERVICE' }]
	};
	assert.throws(
		() =>
			buildStatutory(reducedNcr, (world) => {
				world.employment_terms[0]!.ph_worksite_source_file = null;
			}),
		/municipality and sector source documents/
	);
	assert.throws(
		() =>
			buildStatutory(reducedNcr, (world) => {
				world.employment_terms[0]!.ph_sector_source_reference = null;
			}),
		/municipality and sector source documents/
	);
	assert.throws(
		() =>
			buildStatutory(reducedNcr, (world) => {
				world.company_facts![0]!.ph_wage_class_source_file = null;
			}),
		/dated establishment and worker-count source document/
	);
	assert.throws(
		() =>
			buildStatutory(reducedNcr, (world) => {
				world.company_facts!.splice(0);
			}),
		/dated establishment and worker-count source document/
	);
	assert.throws(
		() =>
			buildStatutory(
				{
					code: 'PH',
					period: '2026-10',
					region: 'IV-A',
					companyFacts: facts(20),
					people: [
						{ key: 'W', wage: 12_500, worksite: 'Cavite/Rosario', worksite_sector: 'AGRICULTURE' }
					]
				},
				(world) => {
					world.employment_terms[0]!.ph_worksite_source_reference = null;
				}
			),
		/municipality and sector source documents/
	);
});

test('PH wage order: a dated establishment count change inside the pay window refuses', () => {
	assert.throws(
		() =>
			buildStatutory(
				{
					code: 'PH',
					period: '2026-10',
					region: 'NCR',
					companyFacts: facts(16),
					people: [
						{ key: 'W', wage: 17_000, worksite: 'NCR/Manila', worksite_sector: 'RETAIL_SERVICE' }
					]
				},
				(world) => {
					const recorded = world.companies[0]!.facts as Record<string, unknown>;
					Object.assign(world, {
						company_facts: [
							{
								company_id: world.companies[0]!.id,
								facts: { ...recorded, ...facts(15) },
								effective_range: { start: '2026-09-01', end: '2026-10-04' },
								ph_wage_class_source_reference: 'FIXTURE-COUNT-15',
								ph_wage_class_source_file: 'fixture-count-15.pdf',
								approval_id: null
							},
							{
								company_id: world.companies[0]!.id,
								facts: { ...recorded, ...facts(16) },
								effective_range: { start: '2026-10-05', end: null },
								ph_wage_class_source_reference: 'FIXTURE-COUNT-16',
								ph_wage_class_source_file: 'fixture-count-16.pdf',
								approval_id: null
							}
						]
					});
				}
			),
		/establishment wage classification changes inside this pay window/
	);
});

test('PH wage order: a dated sector change inside the pay window refuses', () => {
	assert.throws(
		() =>
			buildStatutory(
				{
					code: 'PH',
					period: '2026-10',
					region: 'NCR',
					companyFacts: facts(20),
					people: [
						{ key: 'W', wage: 17_000, worksite: 'NCR/Manila', worksite_sector: 'AGRICULTURE' }
					]
				},
				(world) => {
					const old = world.employment_terms[0]!;
					old.effective_range = { start: old.effective_range.start, end: '2026-10-04' };
					world.employment_terms.push({
						...old,
						id: 'ph-sector-change',
						worksite_sector: 'OTHER_NONAGRI',
						effective_range: { start: '2026-10-05', end: null }
					});
				}
			),
		/a workplace or wage class change inside one pay window/i
	);
});

test('PH wage order: every active version has sourced IV-A agriculture rates and exact classes', () => {
	for (const version of settingsVersions('PH')) {
		const wages = version.work_rules.wages;
		const afterApril = String(version.effective_range.start) >= '2026-04-01';
		assert.equal(wages.by_region['IV-A-AGRI-COMPONENT-1ST'], 13_693.75);
		assert.equal(wages.by_region['IV-A-AGRI-RECLASSIFIED-1ST'], afterApril ? 13_693.75 : 12_650.42);
		assert.equal(wages.by_region['IV-A-AGRI-2ND-5TH'], afterApril ? 13_250.33 : 12_650.42);
		assert.equal(wages.classified_by_worksite?.rows.length, 542);
		assert.equal(
			version.facts.find((fact) => fact.key === 'ph_wage_one_establishment')?.default_value,
			undefined
		);
		assert.equal(version.facts.find((fact) => fact.key === 'ph_wage_worker_count')?.integer, true);
	}
});
