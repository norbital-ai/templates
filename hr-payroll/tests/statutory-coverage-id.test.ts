import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assessStatutory,
	assessStatutoryUnvalidated,
	buildStatutory,
	chargeOf,
	COMPANY_ID,
	createStatutoryWorld,
	leaveCatalogue
} from './fixtures/statutory-world.ts';
import { payrollWorld } from './fixtures/memory-payroll-api.ts';
import { gatherPayrollRun, buildPayrollRun } from '../src/lib/payroll/run/engine.ts';
import { minimumWageIssues } from '../src/lib/payroll/contribution.ts';

const uuid = (n: number) => `d1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('ID: a worker past one year needs a dated company wage-scale grade and basic minimum', () => {
	const world = createStatutoryWorld({
		code: 'ID',
		period: '2026-01',
		region: 'Provinsi DKI Jakarta',
		riskClass: 'I',
		people: [{ key: 'SCALE', wage: 6_000_000, hire_date: '2025-01-01' }]
	});
	const build = () =>
		buildPayrollRun(
			gatherPayrollRun({ world: payrollWorld(world), companyId: COMPANY_ID, period: '2026-01' })
		);
	assert.doesNotThrow(build);
	const facts = world.employment_terms[0]!.facts as Record<string, unknown>;
	facts.wage_scale_basic_minimum = 6_000_000.01;
	assert.throws(build, /basic wage is below the company's wage-scale grade minimum/);
	facts.wage_scale_basic_minimum = 6_000_000;
	// The scale reference counts only with its file (`terms_facts` evidence).
	const [scaleFile] = world.fact_evidence!.splice(0, 1);
	assert.throws(build, /reference counts only once its evidence \(file\) is recorded/);
	world.fact_evidence!.unshift(scaleFile!);
	// PP 36/2021 arts.21(1), 79(1): a missing or future-dated scale record warns, it does not refuse.
	const warned = () =>
		build().warnings.some((line) => /record the dated company wage structure/.test(line));
	assert.equal(warned(), false);
	delete facts.wage_scale_reference;
	assert.equal(warned(), true);
	facts.wage_scale_reference = 'FIXTURE-SCALE';
	facts.wage_scale_effective_on = '2026-02-01';
	assert.equal(warned(), true);
	facts.wage_scale_effective_on = '2025-01-01';
	facts.wage_scale_notice_on = '2026-02-01';
	assert.equal(warned(), true);
	facts.wage_scale_notice_on = '2025-01-01';
	assert.equal(warned(), false);

	const firstYear = createStatutoryWorld({
		code: 'ID',
		period: '2026-01',
		region: 'Provinsi DKI Jakarta',
		riskClass: 'I',
		people: [{ key: 'FIRST', wage: 6_000_000, hire_date: '2026-01-01' }]
	});
	// In the first year no scale is read: the terms record none.
	firstYear.employment_terms[0]!.facts = { worksite_sector_edition: '2020' };
	firstYear.fact_evidence!.splice(0);
	assert.doesNotThrow(() =>
		buildPayrollRun(
			gatherPayrollRun({ world: payrollWorld(firstYear), companyId: COMPANY_ID, period: '2026-01' })
		)
	);
});

test('ID: pure output wages refuse until agreed units and twelve paid months can be valued', () => {
	const world = createStatutoryWorld({
		code: 'ID',
		period: '2026-01',
		region: 'Provinsi DKI Jakarta',
		riskClass: 'I',
		people: [
			{
				key: 'OUTPUT',
				wage: 0,
				hire_date: '2026-01-01',
				statutory_work_category: 'PIECE_RATE'
			}
		]
	});
	assert.throws(
		() =>
			buildPayrollRun(
				gatherPayrollRun({ world: payrollWorld(world), companyId: COMPANY_ID, period: '2026-01' })
			),
		/pure output wages need the agreed result rate, recorded units and twelve months of paid wages/
	);
});

test('ID: hourly pay is part-time only and meets the sector-aware monthly floor divided by 126', () => {
	const hourly = (wage: number, employment_type: string) =>
		assessStatutory({
			code: 'ID',
			period: '2026-01',
			region: 'Provinsi DKI Jakarta',
			riskClass: 'I',
			people: [
				{
					key: 'HOUR',
					wage,
					hire_date: '2026-01-01',
					exit_date: '2026-03-31',
					exit_reason: 'END_OF_CONTRACT',
					citizenship: 'FOREIGNER',
					tax_residency: 'NON_RESIDENT',
					id_foreign_prior_indonesia_work: 'NONE',
					id_foreign_prior_work_reviewed_on: '2026-01-01',
					id_foreign_prior_work_reference: 'FIXTURE-NO-PRIOR-WORK',
					pay_frequency: 'HOURLY',
					employment_type,
					ordinary_hours_per_week: 20
				}
			]
		});
	// DKI 2026 Rp5,729,876 ÷ 126 = Rp45,475.206..., rounded at the comparison cent.
	assert.doesNotThrow(() => hourly(45_475.21, 'PART_TIME'));
	assert.throws(() => hourly(45_475.2, 'PART_TIME'), /MINIMUM_WAGE_BELOW/);
	assert.throws(() => hourly(50_000, 'PERMANENT'), /hourly wage only for part-time work/);
});

test('ID: saved daily and hourly PPU runs refuse an unsealed BPJS Kesehatan monthly wage', () => {
	const build = (payFrequency: 'MONTHLY' | 'DAILY' | 'HOURLY') => {
		const world = createStatutoryWorld({
			code: 'ID',
			period: '2026-01',
			region: 'Provinsi DKI Jakarta',
			riskClass: 'I',
			people: [
				{
					key: 'HEALTH',
					wage:
						payFrequency === 'MONTHLY' ? 6_000_000 : payFrequency === 'DAILY' ? 300_000 : 50_000,
					hire_date: '2026-01-01',
					pay_frequency: payFrequency,
					employment_type: payFrequency === 'HOURLY' ? 'PART_TIME' : 'PERMANENT',
					ordinary_hours_per_week: payFrequency === 'HOURLY' ? 20 : 40
				}
			]
		});
		return () =>
			buildPayrollRun(
				gatherPayrollRun({ world: payrollWorld(world), companyId: COMPANY_ID, period: '2026-01' })
			);
	};
	assert.doesNotThrow(build('MONTHLY'));
	for (const frequency of ['DAILY', 'HOURLY'] as const)
		assert.throws(
			build(frequency),
			/BPJS Kesehatan monthly contribution wage for daily or hourly terms is not sealed/
		);
});

test('ID: a short-contract foreigner needs dated no-prior-work evidence before Kesehatan is skipped', () => {
	const world = createStatutoryWorld({
		code: 'ID',
		period: '2026-01',
		region: 'Provinsi DKI Jakarta',
		riskClass: 'I',
		people: [
			{
				key: 'FOREIGN3M',
				wage: 6_000_000,
				citizenship: 'FOREIGNER',
				tax_residency: 'NON_RESIDENT',
				employment_type: 'CONTRACT',
				hire_date: '2026-01-01',
				exit_date: '2026-03-31'
			}
		]
	});
	const build = () =>
		buildPayrollRun(
			gatherPayrollRun({ world: payrollWorld(world), companyId: COMPANY_ID, period: '2026-01' })
		);
	const terms = world.employment_terms[0]!;
	const facts = terms.facts as Record<string, unknown>;
	assert.throws(build, /verify dated prior work in Indonesia before excluding a foreign worker/i);
	// The review's reference is its `terms_facts` evidence.
	const review = (reference: string) =>
		world.fact_evidence!.push({
			id: uuid(990),
			subject: { collection: 'employment_terms', id: terms.id },
			fact_key: 'foreign_prior_work_reviewed_on',
			reference,
			file: null,
			approval_id: null
		});
	facts.foreign_prior_work = 'ANY';
	facts.foreign_prior_work_reviewed_on = '2026-01-01';
	review('PRIOR-WORK-RECORD');
	assert.throws(build, /verify dated prior work in Indonesia before excluding a foreign worker/i);
	facts.foreign_prior_work = 'NONE';
	facts.foreign_prior_work_reviewed_on = '2026-02-01';
	assert.throws(build, /verify dated prior work in Indonesia before excluding a foreign worker/i);
	facts.foreign_prior_work_reviewed_on = '2026-01-01';
	world.fact_evidence!.pop();
	assert.throws(build, /reviewed on counts only once its evidence \(reference\) is recorded/);
	review('NO-PRIOR-WORK-DECLARATION');
	const built = build();
	assert.equal(
		built.payslip_payroll_run[0]?.statutory.some((row) => row.scheme_code === 'KESEHATAN'),
		false
	);
});

test('ID: micro or small employers never use the ordinary BPJS Kesehatan UMP/UMK floor', () => {
	const options = {
		code: 'ID',
		period: '2026-01',
		region: 'Provinsi DKI Jakarta',
		riskClass: 'I',
		people: [{ key: 'SIZE', wage: 6_000_000 }]
	} as const;
	assert.ok(chargeOf(assessStatutory(options), 'SIZE', 'KESEHATAN').employee > 0);
	for (const period of ['2025-12', '2026-01', '2026-03'])
		assert.throws(
			() =>
				assessStatutory({
					...options,
					period,
					companyFacts: { enterprise_size_class: 'MICRO_OR_SMALL' }
				}),
			/KESEHATAN: Verify the employer's enterprise size/
		);
	const shortForeignContract = assessStatutory({
		...options,
		companyFacts: { enterprise_size_class: 'MICRO_OR_SMALL' },
		people: [
			{
				key: 'FOREIGN3M',
				wage: 6_000_000,
				citizenship: 'FOREIGNER',
				employment_type: 'CONTRACT',
				hire_date: '2026-01-01',
				id_foreign_prior_indonesia_work: 'NONE',
				id_foreign_prior_work_reviewed_on: '2026-01-01',
				id_foreign_prior_work_reference: 'FIXTURE-NO-PRIOR-WORK',
				exit_date: '2026-03-31'
			}
		]
	});
	assert.equal(shortForeignContract.get('FOREIGN3M')?.get('KESEHATAN'), undefined);
	const missing = createStatutoryWorld(options);
	missing.companies[0]!.facts = {};
	assert.throws(
		() =>
			buildPayrollRun(
				gatherPayrollRun({
					world: payrollWorld(missing),
					companyId: COMPANY_ID,
					period: options.period
				})
			),
		/KESEHATAN: Verify the employer's enterprise size/
	);
	assert.throws(
		() =>
			assessStatutory({
				...options,
				people: [{ key: 'SIZE', wage: 5_000_000 }]
			}),
		/MINIMUM_WAGE_BELOW/
	);
});

test('ID: a mid-month enterprise-size change refuses Kesehatan before pricing the month', () => {
	const world = createStatutoryWorld({
		code: 'ID',
		period: '2026-01',
		region: 'Provinsi DKI Jakarta',
		riskClass: 'I',
		companyFacts: { enterprise_size_class: 'MICRO_OR_SMALL' },
		people: [{ key: 'SIZE', wage: 6_000_000 }]
	});
	world.company_facts = [
		{
			id: uuid(990),
			company_id: COMPANY_ID,
			facts: { enterprise_size_class: 'OTHER' },
			effective_range: {
				start: '2026-01-16T00:00:00.000Z',
				end: null
			},
			approval_id: null
		}
	] as never;
	assert.throws(
		() =>
			buildPayrollRun(
				gatherPayrollRun({ world: payrollWorld(world), companyId: COMPANY_ID, period: '2026-01' })
			),
		/enterprise_size_class.*inside.*month/
	);
});

test('ID: an unsealed KBLI in a local sector order cannot take the ordinary floor', () => {
	assert.throws(
		() =>
			assessStatutory({
				code: 'ID',
				period: '2026-01',
				region: 'Provinsi DKI Jakarta',
				riskClass: 'I',
				people: [
					{
						key: 'BUS',
						wage: 5_729_876,
						worksite_sector: '49214'
					}
				]
			}),
		/sector.*49214|49214.*sector/i
	);
});

test('ID: dated KBLI editions convert only a verified one-to-one sector code', () => {
	const options = {
		code: 'ID',
		period: '2026-01',
		region: 'Provinsi DKI Jakarta',
		riskClass: 'I',
		people: [
			{
				key: 'CODE',
				wage: 6_000_000,
				hire_date: '2025-12-18',
				worksite_sector: '62199',
				worksite_sector_edition: '2025'
			}
		]
	} as const;
	assert.ok(assessStatutory(options).has('CODE'));
	assert.ok(
		assessStatutory({
			...options,
			people: [
				{ key: 'CODE', wage: 6_000_000, worksite_sector: '62019', worksite_sector_edition: '2020' }
			]
		}).has('CODE')
	);
	for (const person of [
		{
			key: 'CODE',
			wage: 6_000_000,
			hire_date: '2025-12-18',
			worksite_sector: '62019',
			worksite_sector_edition: '2025'
		},
		{
			key: 'CODE',
			wage: 6_000_000,
			hire_date: '2025-12-18',
			worksite_sector: '10739',
			worksite_sector_edition: '2025'
		}
	])
		assert.throws(
			() => assessStatutory({ ...options, people: [person] }),
			/No verified sector edition/
		);
	assert.throws(
		() =>
			assessStatutory({
				...options,
				people: [
					{ key: 'CODE', wage: 6_000_000, worksite_sector: '62019', worksite_sector_edition: null }
				]
			}),
		/supported worksite sector edition/
	);
	assert.throws(
		() =>
			assessStatutory({
				...options,
				people: [
					{
						key: 'CODE',
						wage: 6_000_000,
						worksite_sector: '62019',
						worksite_sector_edition: '2015'
					}
				]
			}),
		// An edition outside the declared `terms_facts` options is refused when the terms are resolved.
		/Worksite KBLI edition must be one of: 2020, 2025/
	);
	assert.throws(
		() =>
			assessStatutory({
				...options,
				period: '2025-12',
				people: [
					{
						key: 'CODE',
						wage: 6_000_000,
						hire_date: '2025-12-17',
						worksite_sector: '62199',
						worksite_sector_edition: '2025'
					}
				]
			}),
		/Sector edition 2025 cannot classify this worksite/
	);
});

test('ID: a reciprocally unique KBLI 2025 code selects its 2020 locality sector floor on the saved run', () => {
	const world = createStatutoryWorld({
		code: 'ID',
		period: '2026-01',
		region: 'Provinsi Jawa Timur/Kabupaten Banyuwangi',
		riskClass: 'I',
		people: [
			{
				key: 'MINE',
				wage: 3_000_000,
				hire_date: '2026-01-01',
				worksite_sector: '07221',
				worksite_sector_edition: '2025'
			}
		]
	});
	assert.throws(
		() =>
			buildPayrollRun(
				gatherPayrollRun({ world: payrollWorld(world), companyId: COMPANY_ID, period: '2026-01' })
			),
		/MINIMUM_WAGE_BELOW/
	);
});

test('ID: a split KBLI 2025 hotel code with one 2020 source selects the Badung sector floor on the saved run', () => {
	const world = createStatutoryWorld({
		code: 'ID',
		period: '2026-01',
		region: 'Provinsi Bali/Kabupaten Badung',
		riskClass: 'I',
		companyFacts: { umsp_hotel_star: 5 },
		people: [
			{
				key: 'HOTEL',
				wage: 3_800_000,
				hire_date: '2026-01-01',
				worksite_sector: '55101',
				worksite_sector_edition: '2025'
			}
		]
	});
	const build = () =>
		buildPayrollRun(
			gatherPayrollRun({ world: payrollWorld(world), companyId: COMPANY_ID, period: '2026-01' })
		);
	assert.throws(build, /MINIMUM_WAGE_BELOW/);
	world.companies[0]!.facts = { ...world.companies[0]!.facts, umsp_hotel_star: 4 };
	assert.throws(build, /KBLI 2025 hotel star class conflicts/);
	delete world.companies[0]!.facts.umsp_hotel_star;
	assert.throws(build, /Record umsp_hotel_star/);
});

test('ID: a dated one-to-one KBLI edition revision preserves the saved monthly wage class', () => {
	const world = createStatutoryWorld({
		code: 'ID',
		period: '2026-01',
		region: 'Provinsi DKI Jakarta',
		riskClass: 'I',
		people: [
			{
				key: 'CODE',
				wage: 6_000_000,
				hire_date: '2026-01-01',
				worksite_sector: '62019',
				worksite_sector_edition: '2020'
			}
		]
	});
	const prior = world.employment_terms[0]!;
	prior.effective_range = { start: '2026-01-01', end: '2026-01-16T00:00:00.000Z' };
	world.employment_terms.push({
		...prior,
		id: uuid(991),
		worksite_sector: '62199',
		facts: { ...(prior.facts as Record<string, unknown>), worksite_sector_edition: '2025' },
		effective_range: { start: '2026-01-16T00:00:00.000Z', end: null }
	} as never);
	const build = () =>
		buildPayrollRun(
			gatherPayrollRun({ world: payrollWorld(world), companyId: COMPANY_ID, period: '2026-01' })
		);
	assert.doesNotThrow(build);
	world.employment_terms[1]!.worksite_sector = '10437';
	(world.employment_terms[1]!.facts as Record<string, unknown>).worksite_sector_edition = '2020';
	assert.throws(build, /A workplace or wage class change inside one pay window/);
});

test('ID: Banten legacy broad programming codes and their newer descendants refuse without a verified sector selector', () => {
	for (const [sector, edition] of [
		['62010', '2020'],
		['62020', '2020'],
		['62019', '2020'],
		['62199', '2025']
	] as const) {
		const world = createStatutoryWorld({
			code: 'ID',
			period: '2026-01',
			region: 'Provinsi Banten/Kota Tangerang Selatan',
			riskClass: 'I',
			people: [
				{
					key: 'PROGRAMMER',
					wage: 6_000_000,
					hire_date: '2026-01-01',
					worksite_sector: sector,
					worksite_sector_edition: edition
				}
			]
		});
		assert.throws(
			() =>
				buildPayrollRun(
					gatherPayrollRun({ world: payrollWorld(world), companyId: COMPANY_ID, period: '2026-01' })
				),
			/sector wage order.*not verified/
		);
	}
});

test('ID: known but unseeded provincial sector orders refuse ordinary-floor payroll in their dated versions', () => {
	for (const [period, worksite, sector = '62019'] of [
		['2025-12', 'Provinsi Banten/Kota Tangerang Selatan'],
		['2025-12', 'Provinsi Jawa Barat/Kota Bandung'],
		// Kep.782/2024 names 01270, but the amended local UMSK selector is unsealed.
		['2025-12', 'Provinsi Jawa Barat/Kota Bandung', '01270'],
		['2025-12', 'Provinsi Jawa Timur/Kota Surabaya'],
		['2025-12', 'Provinsi Kepulauan Riau/Kota Batam'],
		['2025-12', 'Provinsi Riau/Kota Pekanbaru'],
		['2026-01', 'Provinsi Jawa Barat/Kota Bandung'],
		// Kep.860/2025 names 41011, but the separate local UMSK selector is unsealed.
		['2026-01', 'Provinsi Jawa Barat/Kota Bandung', '41011'],
		['2026-01', 'Provinsi Kepulauan Riau/Kota Batam'],
		['2026-03', 'Provinsi Riau/Kota Pekanbaru']
	] as const) {
		const world = createStatutoryWorld({
			code: 'ID',
			period,
			region: worksite,
			riskClass: 'I',
			people: [
				{
					key: 'UNSEALED',
					wage: 10_000_000,
					worksite_sector: sector,
					worksite_sector_edition: '2020'
				}
			]
		});
		assert.throws(
			() =>
				buildPayrollRun(
					gatherPayrollRun({ world: payrollWorld(world), companyId: COMPANY_ID, period })
				),
			/sector wage order.*not verified/
		);
	}
});

// Governor decrees 561.7/Kep.798-Kesra/2024 and 561.7/Kep.862-Kesra/2025,
// operative tables and commencement clauses; Perpres 82/2018 art.32(2)-(3).
for (const [region, prior, current] of [
	['Kota Bekasi', 5_690_752.95, 5_999_443],
	['Kabupaten Bekasi', 5_558_515.1, 5_938_885],
	['Kota Bandung', 4_482_914.09, 4_737_678],
	['Kabupaten Pangandaran', 2_221_724.19, 2_351_250],
	['Kota Banjar', 2_204_754.48, 2_361_241]
] as const) {
	for (const [period, floor] of [
		['2025-12', prior],
		['2026-01', current],
		['2026-03', current]
	] as const)
		test(`ID ${region}: ${period} Kesehatan uses the workplace UMK`, () => {
			// The Rp2m contract is below the UMK and cannot build; isolate the BPJS floor arithmetic.
			const book = assessStatutoryUnvalidated({
				code: 'ID',
				period,
				region,
				riskClass: 'I',
				people: [{ key: 'UMK', wage: 2_000_000, marital_status: 'SINGLE' }]
			});
			const charge = chargeOf(book, 'UMK', 'KESEHATAN');
			assert.equal(charge.employee, Math.round(floor / 100));
			assert.equal(charge.employer, Math.round((floor * 4) / 100));
		});
}

test('ID: a province name cannot select a lower UMP where every city and regency has a UMK', () => {
	assert.throws(
		() =>
			assessStatutory({
				code: 'ID',
				period: '2026-01',
				region: 'Jawa Barat',
				riskClass: 'I',
				people: [{ key: 'PROVINCE', wage: 2_000_000 }]
			}),
		/No sealed minimum-wage rate covers PERMANENT at "Jawa Barat"/
	);
});

test('ID PP 36/2021 art.17: daily wage meets the monthly floor at 21 or 25 days', () => {
	const floor = 5_729_876; // DKI Jakarta UMP, 2026.
	const build = (workdays: number, dailyWage: number) => {
		const world = createStatutoryWorld({
			code: 'ID',
			period: '2026-04',
			region: 'Provinsi DKI Jakarta',
			riskClass: 'I',
			people: [{ key: 'DAILY', wage: dailyWage, pay_frequency: 'DAILY' }]
		});
		const pattern = world.shift_patterns[0]!.pattern as {
			days: { roster_code_id: string }[];
		};
		const work = pattern.days[0]!;
		const rest = pattern.days[5]!;
		pattern.days = Array.from({ length: 7 }, (_, day) => (day < workdays ? work : rest));
		const prepared = gatherPayrollRun({
			world: payrollWorld(world),
			companyId: COMPANY_ID,
			period: '2026-04'
		});
		return minimumWageIssues({
			configuration: prepared.configuration,
			bundles: prepared.gathered.bundles,
			asOf: '2026-04-30'
		});
	};
	for (const [workdays, divisor] of [
		[5, 21],
		[6, 25]
	] as const) {
		const daily = Math.ceil((floor / divisor) * 100) / 100;
		assert.equal(
			build(workdays, daily).some((issue) => issue.code === 'MINIMUM_WAGE_BELOW'),
			false
		);
		assert.equal(
			build(workdays, daily - 0.01).some((issue) => issue.code === 'MINIMUM_WAGE_BELOW'),
			true
		);
	}
	assert.throws(() => build(4, 300_000), /daily minimum-wage divisor is missing for 4 workdays/);
});

type ExitFacts = Readonly<Record<string, string | number | boolean>>;

function separationAmounts(options: {
	readonly facts: ExitFacts;
	readonly wage?: number;
	readonly payFrequency?: 'MONTHLY' | 'DAILY';
	readonly employmentType?: 'PERMANENT' | 'CONTRACT';
	readonly reason?: string;
}) {
	const { slips } = buildStatutory(
		{
			code: 'ID',
			period: '2026-01',
			region: 'Provinsi DKI Jakarta',
			riskClass: 'I',
			people: [
				{
					key: 'LEAVER',
					employment_type: options.employmentType ?? 'PERMANENT',
					pay_frequency: options.payFrequency ?? 'MONTHLY',
					wage: options.wage ?? 10_000_000,
					hire_date: '2022-01-31',
					exit_date: '2026-01-31',
					exit_reason: options.reason ?? 'DISMISSAL'
				}
			]
		},
		(world) => {
			world.employments[0]!.exit_facts = { thr_holiday_date: HOLIDAY_2026, ...options.facts };
			const version = world.jurisdiction_settings.find((row) =>
				String(row.effective_range.start).startsWith('2026-01')
			)!;
			for (const [offset, code] of [
				'PESANGON',
				'UPMK',
				'UANG_PISAH',
				'PENSION_OFFSET',
				'PKWT_COMPENSATION'
			].entries()) {
				const catalogue = world.adhoc_catalogue!.find(
					(row) => row.settings_id === version.id && row.code === code
				)!;
				world.adhoc_requests!.push({
					id: uuid(200 + offset),
					employment_id: world.employments[0]!.id,
					catalogue_id: catalogue.id,
					amount: 0,
					event_date: '2026-01-31',
					pay_period: '2026-01',
					payslip_id: null,
					reason: code,
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		}
	);
	const adjustments = slips.get('LEAVER')!.adjustments;
	return Object.fromEntries(
		['PESANGON', 'UPMK', 'UANG_PISAH', 'PENSION_OFFSET', 'PKWT_COMPENSATION'].map((code) => {
			const line = adjustments.find((row) => row.component_code === code);
			return [code, { amount: line?.amount ?? 0, bucket: line?.bucket }];
		})
	);
}

/** Idul Fitri 1447 H (SKB 2026): the religious holiday a January 2026 departure's THR is judged against. */
const HOLIDAY_2026 = '2026-03-21';

const standardFacts = (cause: string, extra: ExitFacts = {}): ExitFacts => ({
	thr_holiday_date: HOLIDAY_2026,
	termination_cause: cause,
	separation_wage_basis: 'MONTHLY',
	micro_small_enterprise: false,
	pension_offset_applies: false,
	...extra
});

for (const [cause, pesangonMultiplier, upmk, separationPay] of [
	['MERGER_CONSOLIDATION_SEPARATION', 1, true, false],
	['ACQUISITION', 1, true, false],
	['ACQUISITION_TERMS_CHANGE_REJECTED', 0.5, true, false],
	['EFFICIENCY_ACTUAL_LOSS', 0.5, true, false],
	['EFFICIENCY_PREVENT_LOSS', 1, true, false],
	['CLOSURE_LOSS', 0.5, true, false],
	['CLOSURE_NO_LOSS', 1, true, false],
	['FORCE_MAJEURE_CLOSURE', 0.5, true, false],
	['FORCE_MAJEURE_NO_CLOSURE', 0.75, true, false],
	['DEBT_SUSPENSION_LOSS', 0.5, true, false],
	['DEBT_SUSPENSION_NO_LOSS', 1, true, false],
	['BANKRUPTCY', 0.5, true, false],
	['EMPLOYEE_REQUEST_EMPLOYER_MISCONDUCT', 1, true, false],
	['EMPLOYEE_REQUEST_REJECTED', 0, false, true],
	['VOLUNTARY_RESIGNATION', 0, false, true],
	['UNEXCUSED_ABSENCE', 0, false, true],
	['VIOLATION_AFTER_WARNINGS', 0.5, true, false],
	['URGENT_VIOLATION', 0, false, true],
	['DETENTION_CAUSED_LOSS', 0, false, true],
	['DETENTION_NO_LOSS', 0, true, false],
	['LONG_ILLNESS_OR_WORK_ACCIDENT_DISABILITY', 2, true, false],
	['RETIREMENT', 1.75, true, false],
	['DEATH', 2, true, false]
] as const)
	test(`ID PP 35 cause ${cause} selects its own termination benefits`, () => {
		const amounts = separationAmounts({
			facts: standardFacts(
				cause,
				separationPay
					? { separation_pay_amount: 3_000_000, separation_pay_reference: 'CBA-2026-1' }
					: {}
			)
		});
		assert.equal(amounts.PESANGON!.amount, 50_000_000 * pesangonMultiplier);
		assert.equal(amounts.UPMK!.amount, upmk ? 20_000_000 : 0);
		assert.equal(amounts.UANG_PISAH!.amount, separationPay ? 3_000_000 : 0);
	});

test('ID detailed cause, not the broad exit reason, determines the multiplier', () => {
	const loss = separationAmounts({
		reason: 'REDUNDANCY',
		facts: standardFacts('EFFICIENCY_ACTUAL_LOSS')
	});
	const prevention = separationAmounts({
		reason: 'REDUNDANCY',
		facts: standardFacts('EFFICIENCY_PREVENT_LOSS')
	});
	assert.equal(loss.PESANGON!.amount, 25_000_000);
	assert.equal(prevention.PESANGON!.amount, 50_000_000);
});

test('ID output-paid separation follows article 157 while daily full run refuses its Kesehatan base', () => {
	assert.throws(
		() =>
			separationAmounts({
				wage: 400_000,
				payFrequency: 'DAILY',
				facts: standardFacts('EFFICIENCY_PREVENT_LOSS', {
					separation_wage_basis: 'DAILY',
					separation_daily_wage: 400_000
				})
			}),
		/BPJS Kesehatan monthly contribution wage for daily or hourly terms is not sealed/
	);

	const output = separationAmounts({
		facts: standardFacts('EFFICIENCY_PREVENT_LOSS', {
			separation_wage_basis: 'OUTPUT',
			output_average_12m: 4_000_000
		})
	});
	assert.equal(output.PESANGON!.amount, 28_649_380);
	assert.equal(output.UPMK!.amount, 11_459_752);
});

test('ID pension offset is limited to the statutory and contract-defined obligations', () => {
	const partial = separationAmounts({
		facts: standardFacts('EFFICIENCY_PREVENT_LOSS', {
			pension_offset_applies: true,
			employer_funded_pension_benefit: 15_000_000,
			pension_offset_reference: 'CBA-PENSION-1'
		})
	});
	assert.deepEqual(partial.PENSION_OFFSET, { amount: 15_000_000, bucket: 'DEDUCTION' });

	const capped = separationAmounts({
		facts: standardFacts('EMPLOYEE_REQUEST_REJECTED', {
			separation_pay_amount: 3_000_000,
			separation_pay_reference: 'CBA-2026-1',
			pension_offset_applies: true,
			employer_funded_pension_benefit: 10_000_000,
			pension_offset_reference: 'CBA-PENSION-1'
		})
	});
	assert.equal(capped.PENSION_OFFSET!.amount, 3_000_000);
});

test('ID micro and small enterprise agreement amounts replace statutory schedules', () => {
	const permanent = separationAmounts({
		facts: standardFacts('EFFICIENCY_PREVENT_LOSS', {
			micro_small_enterprise: true,
			micro_small_agreement_reference: 'AGREEMENT-1',
			agreed_pesangon_amount: 12_000_000,
			agreed_upmk_amount: 4_000_000
		})
	});
	assert.equal(permanent.PESANGON!.amount, 12_000_000);
	assert.equal(permanent.UPMK!.amount, 4_000_000);

	const fixed = separationAmounts({
		employmentType: 'CONTRACT',
		reason: 'END_OF_CONTRACT',
		facts: {
			micro_small_enterprise: true,
			micro_small_agreement_reference: 'PKWT-AGREEMENT-1',
			agreed_pkwt_compensation_amount: 7_500_000
		}
	});
	assert.equal(fixed.PKWT_COMPENSATION!.amount, 7_500_000);
});

test('ID fixed-term compensation remains separate from permanent termination benefits', () => {
	const { slips } = buildStatutory(
		{
			code: 'ID',
			period: '2026-01',
			region: 'Provinsi DKI Jakarta',
			riskClass: 'I',
			people: ['PERMANENT', 'CONTRACT'].map((employment_type) => ({
				key: employment_type,
				employment_type,
				wage: 10_000_000,
				hire_date: '2022-01-31',
				exit_date: '2026-01-31',
				exit_reason: employment_type === 'CONTRACT' ? 'END_OF_CONTRACT' : 'REDUNDANCY'
			}))
		},
		(world) => {
			world.employments[0]!.exit_facts = standardFacts('EFFICIENCY_PREVENT_LOSS');
			world.employments[1]!.exit_facts = {
				micro_small_enterprise: false,
				thr_holiday_date: HOLIDAY_2026
			};
			const version = world.jurisdiction_settings.find((row) =>
				String(row.effective_range.start).startsWith('2026-01')
			)!;
			for (const [index, employment] of world.employments.entries())
				for (const [offset, code] of ['PESANGON', 'UPMK', 'PKWT_COMPENSATION'].entries()) {
					const catalogue = world.adhoc_catalogue!.find(
						(row) => row.settings_id === version.id && row.code === code
					)!;
					world.adhoc_requests!.push({
						id: uuid(index * 10 + offset),
						employment_id: employment.id,
						catalogue_id: catalogue.id,
						amount: 0,
						event_date: '2026-01-31',
						pay_period: '2026-01',
						payslip_id: null,
						reason: code,
						evidence_file: null,
						as_adjustment_entry: false,
						approval_id: null
					});
				}
		}
	);
	const amount = (person: string, code: string) =>
		slips.get(person)!.adjustments.find((row) => row.component_code === code)?.amount ?? 0;
	assert.equal(amount('PERMANENT', 'PESANGON'), 50_000_000);
	assert.equal(amount('PERMANENT', 'UPMK'), 20_000_000);
	assert.equal(amount('PERMANENT', 'PKWT_COMPENSATION'), 0);
	assert.equal(amount('CONTRACT', 'PESANGON'), 0);
	assert.equal(amount('CONTRACT', 'UPMK'), 0);
	assert.equal(amount('CONTRACT', 'PKWT_COMPENSATION'), 40_000_000);
});

function contractualCashOut(conversion: string) {
	const world = createStatutoryWorld({
		code: 'ID',
		period: '2026-03',
		region: 'Provinsi DKI Jakarta',
		riskClass: 'I',
		people: [{ key: 'POLICY', wage: 6_000_000 }]
	});
	// Synthetic employer policies, not a claim that either divisor is prescribed by law.
	// Each policy is part of its sealed, dated jurisdiction profile.
	for (const version of world.jurisdiction_settings)
		version.work_rules.encashment = {
			reference: 'EVENT_DATE',
			day_amount: String(version.effective_range.start).startsWith('2026-03')
				? 'terms.monthly_wage / 25.0'
				: 'terms.monthly_wage / 30.0',
			pay_frequencies: ['MONTHLY', 'SEMI_MONTHLY'],
			include_allowances: ['HOUSE_ALLOWANCE', 'CAR_ALLOWANCE'],
			exclude_allowances: ['SPECIAL_ALLOWANCE'],
			preserve_year_end_rate: false,
			authority: `Synthetic collective agreement ${String(version.effective_range.start).slice(0, 10)}`
		};
	world.leave_catalogue.push(...leaveCatalogue('ID').map((row) => ({ ...row, approval_id: null })));
	const version = world.jurisdiction_settings.find(
		(row) =>
			String(row.effective_range.start).slice(0, 10) <= conversion &&
			String(row.effective_range.end).slice(0, 10) > conversion
	)!;
	const catalogue = world.leave_catalogue.find(
		(row) => row.settings_id === version.id && row.code === 'ANNUAL_LEAVE'
	)!;
	world.leave_entries.push({
		id: uuid(100),
		employment_id: world.employments[0]!.id,
		catalogue_id: catalogue.id,
		leave_code: catalogue.code,
		reference: 'CONTRACTUAL-CONVERSION',
		from_date: '2026-01-01',
		to_date: '2026-12-31',
		days: 1.5,
		encash_days: 1.5,
		effective_on: conversion,
		due_on: '2026-03-31',
		charges: [],
		allocations: [],
		approval_id: null,
		payslip_id: null,
		as_adjustment_entry: false
	} as never);
	return world;
}

function cashAmount(world: ReturnType<typeof contractualCashOut>) {
	const prepared = gatherPayrollRun({
		world: payrollWorld(world),
		companyId: world.companies[0]!.id,
		period: '2026-03'
	});
	return buildPayrollRun(prepared).payslip_payroll_run[0]!.adjustments.find(
		(row) => row.component_code === 'ANNUAL_LEAVE_ENCASHMENT'
	)!.amount;
}

test('ID contractual cash-out retains the conversion-date policy across a later policy change', () => {
	assert.equal(cashAmount(contractualCashOut('2026-02-28')), 300_000);
	assert.equal(cashAmount(contractualCashOut('2026-03-01')), 360_000);
});

test('ID contractual cash-out retains conversion-date salary and explicit allowance classifications', () => {
	const world = contractualCashOut('2026-02-28');
	const prior = world.employment_terms[0]!;
	const catalogue = (code: string) => world.allowance_catalogue.find((row) => row.code === code)!;
	prior.base_salary = 9_000_000;
	prior.allowances = [
		{ catalogue_id: catalogue('HOUSE_ALLOWANCE').id, amount: 1_000_000 },
		{ catalogue_id: catalogue('SPECIAL_ALLOWANCE').id, amount: 2_000_000 }
	];
	prior.effective_range = { start: '2015-01-01', end: '2026-02-28T23:59:59.999Z' };
	world.employment_terms.push({
		...prior,
		id: uuid(101),
		effective_range: { start: '2026-03-01', end: null },
		base_salary: 12_000_000,
		currency: 'IDR',
		allowances: []
	} as never);
	assert.equal(cashAmount(world), 500_000);
});

test('ID contractual cash-out refuses unclassified allowances and unsupported wage bases', () => {
	const world = contractualCashOut('2026-02-28');
	world.employment_terms[0]!.pay_frequency = 'DAILY';
	assert.throws(() => cashAmount(world), /no verified DAILY valuation rule/);
	world.employment_terms[0]!.pay_frequency = 'MONTHLY';
	world.employment_terms[0]!.allowances = [{ catalogue_id: uuid(999), amount: 100 }];
	assert.throws(() => cashAmount(world), /wage-base classification/);
});
