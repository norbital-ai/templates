import { register, type ProbeCase, type ProbeInput, type Row } from '../payroll-probe.ts';

/**
 * ID cases: see the case shape at the top of payroll-probe.ts. Every figure is worked by hand from the instrument
 * cited beside it (PP 58/2023 TER tables read from the signed PDF; decree floors from the tracker row's source).
 *
 * Every worker has under one year of service on the rule date: from one year PP 36/2021 art.24 / PP 49/2025 art.21
 * demand the company wage-scale grade, whose `wage_scale_reference` evidence is a FILE, and the probe harness has
 * no upload. Rupiah charges round half-up to the whole rupiah (tracker ID-127 owner default, 2026-09-28); annual
 * PKP rounds down to the thousand (UU PPh art.17(4), PMK 168/2023 art.8(4)).
 */

const SRC = {
	JHT: 'JHT 2% employee + 3.7% employer of Upah sebulan (upah pokok + tunjangan tetap), no ceiling: PP 46/2015 arts.16–17 (https://jdih.kemnaker.go.id/asset/data_puu/PP_NOMOR_46_TAHUN2015OK.PDF)',
	JP: 'JP 1% employee + 2% employer of the wage paid in the month, capped at Rp10,547,400 (Jan–Feb 2026) and Rp11,086,300 from 1 March 2026; pension age 59 in 2025–2027: PP 45/2015 arts.15, 28–29 (https://www.bpjsketenagakerjaan.go.id/assets/uploads/peraturan/15122015_104556_PP%2045%20Tahun%202015.pdf); 2026 ceiling per SE BPJS Ketenagakerjaan B/1226/022026 (tracker ID-162)',
	JKK: 'JKK employer only, risk group I 0.24%, II 0.54%, III 0.89%, IV 1.27%, V 1.74% of Upah sebulan; JKM 0.30%: PP 44/2015 arts.16, 18–19 and Lampiran I (https://www.bpjsketenagakerjaan.go.id/assets/uploads/peraturan/15122015_104557_PP%2044%20Tahun%202015.pdf); the 0.14% JKP recomposition stays inside the JKK bill (Permenaker 3/2025 art.14(3)–(4), https://jdih.kemnaker.go.id/asset/data_puu/2025pmnaker003.pdf), so JKP charges nothing on the slip (PP 6/2025)',
	KES: 'BPJS Kesehatan 1% participant + 4% employer of the monthly wage, floored at the workplace UMK/UMP and capped at Rp12,000,000: Perpres 82/2018 arts.30, 32 as amended by Perpres 64/2020 and 59/2024 (https://jdih.kemenkeu.go.id/api/download/FullText/2018/82TAHUN2018PERPRES.pdf)',
	TER: 'PPh 21 TER on the month’s gross, which includes the employer-paid JKK, JKM and Kesehatan premiums: PP 58/2023 art.2(3)–(4) and Lampiran A–C (signed PDF https://peraturan.bpk.go.id/Download/332609/PP%20Nomor%2058%20Tahun%202023.pdf); PMK 168/2023 arts.5, 15 (https://jdih.kemenkeu.go.id/api/download/e60a82e0-b218-40f5-9d18-b924aa1e11ce/2023pmkeuangan168.pdf)',
	LAST: 'Last tax period (December or the exit month): year gross − biaya jabatan 5% capped Rp500,000 a month employed − employee JHT and JP − zakat through the employer − PTKP (Rp54,000,000 + Rp4,500,000 married + Rp4,500,000 per dependant, max 3), PKP down to the thousand, UU PPh art.17(1)(a) rates 5% to Rp60m, 15% to Rp250m, 25% to Rp500m: PMK 168/2023 arts.8(4), 10 (https://jdih.kemenkeu.go.id/api/download/e60a82e0-b218-40f5-9d18-b924aa1e11ce/2023pmkeuangan168.pdf); UU 36/2008 as amended by UU 7/2021 arts.7, 17 (https://jdih.kemenkeu.go.id/dok/uu-36-tahun-2008)',
	PRORATE:
		'Part month on calendar days (monthly ÷ the month’s calendar days): tracker ID-106 owner default 2026-09-28, law silent (PP 36/2021 arts.14–19, https://jdih.kemnaker.go.id/asset/data_puu/PP362021.pdf); JHT/JKK/JKM on the contract’s monthly rate, JP on the wage paid, Kesehatan on the wage paid lifted to the whole UMK/UMP when under it: tracker ID-161 (PP 44/2015 art.19, PP 46/2015 art.17, PP 45/2015 art.29(1), Perpres 82/2018 arts.30(1), 32(2))',
	PESANGON:
		'Pesangon under one year of service is one month’s wage (basic + fixed allowances): PP 35/2021 art.40(2)(a) and art.43 (efficiency to prevent loss 1×, because of loss 0.5×), art.50 (resignation: UPH + uang pisah per PK/PP/PKB) (https://jdih.kemnaker.go.id/asset/data_puu/PP352021.pdf); UU 13/2003 art.157 as amended by UU 6/2023',
	PP68: 'Severance of a resident is final PPh 21: 0% to Rp50m, 5% to Rp100m, 15% to Rp500m, 25% above: PP 68/2009 arts.1, 4 (https://jdih.kemnaker.go.id/asset/data_puu/PP_No_68_2009.pdf)'
};

/** The company's week: Monday–Friday 09:00–18:00 less an hour's break (8 h × 5, PP 35/2021 art.21(2)(b)), Saturday and Sunday rest days. */
const week = (from: string): ProbeInput[] => [
	{
		collection: 'shift_definitions',
		ref: 'office',
		values: {
			company_id: '@company',
			code: 'OFFICE',
			name: 'Office day (0900 to 1800)',
			variant: { kind: 'WORK', start_time: '09:00', end_time: '18:00', break_minutes: 60 },
			effective_range: { from, to: null }
		}
	},
	{
		collection: 'shift_definitions',
		ref: 'rest',
		values: {
			company_id: '@company',
			code: 'REST',
			name: 'Rest day',
			variant: { kind: 'REST' },
			effective_range: { from, to: null }
		}
	},
	{
		collection: 'shift_patterns',
		ref: 'week',
		values: {
			company_id: '@company',
			code: 'OFFICEx5-REST-REST',
			name: '5 x OFFICE, REST, REST',
			pattern: {
				days: ['@office', '@office', '@office', '@office', '@office', '@rest', '@rest'].map(
					(roster_code_id) => ({ roster_code_id })
				)
			},
			effective_range: { from, to: null }
		}
	}
];

type Worker = {
	ref: string;
	wage: number;
	hire?: string;
	exit?: string;
	exit_ground?: string;
	exit_facts?: Row;
	/** Dated contract rates, for a mid-month change; defaults to one row at `wage` for the whole stint. */
	rates?: readonly { wage: number; from: string; to: string | null }[];
	dob?: string;
	gender?: 'MALE' | 'FEMALE';
	marital?: 'SINGLE' | 'MARRIED';
	dependants?: number;
	religion?: string;
	citizenship?: 'CITIZEN' | 'FOREIGNER';
	tax?: 'RESIDENT' | 'NON_RESIDENT';
	type?: string;
	worksite?: string;
	sector?: string;
	edition?: '2020' | '2025';
	category?: string;
	classification?: string;
	terms_facts?: Row;
	/** Standing contract allowances (`employment_terms.allowances`), fixed allowances of PP 36/2021 art.7. */
	allowances?: readonly Row[];
	/** PPH21 elections beyond the PTKP declaration. */
	elections?: Row;
	/** Extra fields of the PPH21 registration status (deduction claims). */
	pph21?: Row;
};

/** One worker: the person, the stint, the dated terms and the year-start PTKP declaration (PMK 168/2023 art.9(4)). */
const worker = (w: Worker): ProbeInput[] => {
	const hire = w.hire ?? '2025-06-02';
	const rates = w.rates ?? [{ wage: w.wage, from: hire, to: w.exit ?? null }];
	const citizen = (w.citizenship ?? 'CITIZEN') === 'CITIZEN';
	const tax = w.tax ?? 'RESIDENT';
	return [
		{
			collection: 'employees',
			ref: w.ref,
			values: {
				name: `Probe ${w.ref}`,
				date_of_birth: w.dob ?? '1995-05-10',
				gender: w.gender ?? 'MALE',
				marital_status: w.marital ?? 'SINGLE',
				// a husband's income is irrelevant to a wife's withholding unless she elects to combine it (PMK 168/2023 art.9)
				spouse_status:
					(w.marital ?? 'SINGLE') !== 'MARRIED'
						? 'NONE'
						: w.gender === 'FEMALE'
							? 'WITH_INCOME'
							: 'WITHOUT_INCOME',
				dependents_count: w.dependants ?? 0,
				nationality: citizen ? 'Indonesian' : 'Malaysian',
				...(w.religion == null ? {} : { religion: w.religion })
			}
		},
		{
			collection: 'employments',
			ref: `${w.ref}_job`,
			values: {
				employee_id: `@${w.ref}`,
				company_id: '@company',
				employee_number: `P-ID-${w.ref}`,
				effective_range: { from: hire, to: w.exit ?? null },
				...(w.exit_ground == null ? {} : { exit_ground: w.exit_ground }),
				...(w.exit_facts == null ? {} : { exit_facts: w.exit_facts })
			}
		},
		...rates.map((rate, n): ProbeInput => ({
			collection: 'employment_terms',
			ref: `${w.ref}_terms${n === 0 ? '' : n}`,
			values: {
				employment_id: `@${w.ref}_job`,
				residency_status: w.citizenship ?? 'CITIZEN',
				tax_residency: tax,
				currency: 'IDR',
				base_salary: rate.wage,
				pay_frequency: 'MONTHLY',
				work_classification: w.classification ?? 'EA_COVERED',
				statutory_work_category: w.category ?? 'NON_MANUAL',
				employment_type: w.type ?? 'PERMANENT',
				worksite: w.worksite ?? 'Provinsi DKI Jakarta',
				worksite_sector: w.sector ?? '62019',
				facts: { worksite_sector_edition: w.edition ?? '2020', ...w.terms_facts },
				...(w.allowances == null ? {} : { allowances: w.allowances }),
				shift_pattern_id: '@week',
				effective_range: { from: rate.from, to: rate.to }
			}
		})),
		...(tax === 'RESIDENT'
			? [
					{
						collection: 'employment_statutory_facts',
						values: {
							employee_id: `@${w.ref}`,
							statutory_contribution_id: '@law:statutory_contributions:PPH21',
							effective_range: { from: hire, to: null },
							status: {
								kind: 'REGISTERED',
								reference_number: `PROBE-NPWP-${w.ref}`,
								elections: {
									recipient_class: 'REGULAR_EMPLOYEE',
									ptkp_marital_status: w.marital ?? 'SINGLE',
									ptkp_dependants: w.dependants ?? 0,
									no_tax_id: false,
									...w.elections
								},
								...w.pph21
							}
						}
					} satisfies ProbeInput
				]
			: [])
	];
};

/** A statutory registration on file (JP for a foreign worker, the JP pension-age choice). */
const registered = (
	ref: string,
	code: string,
	elections: Row = {},
	employment = false,
	from = '2025-06-02'
): ProbeInput => ({
	collection: 'employment_statutory_facts',
	values: {
		employee_id: `@${ref}`,
		...(employment ? { employment_id: `@${ref}_job` } : {}),
		statutory_contribution_id: `@law:statutory_contributions:${code}`,
		effective_range: { from, to: null },
		status: { kind: 'REGISTERED', reference_number: `PROBE-${code}-${ref}`, elections }
	}
});

/** A separation or ad hoc payment, priced by its catalogue row's own band where `amount` is 0. */
const adhoc = (ref: string, code: string, event_date: string, amount = 0): ProbeInput => ({
	collection: 'adhoc_requests',
	values: {
		employment_id: `@${ref}_job`,
		catalogue_id: `@law:adhoc_catalogue:${code}`,
		amount,
		event_date,
		pay_period: event_date.slice(0, 7),
		reason: `${code} (probe)`
	}
});

/** A punch in Asia/Jakarta (UTC+7): `09:00` local is 02:00Z. */
const at = (date: string, hhmm: string) => {
	const [h, m] = hhmm.split(':').map(Number);
	return new Date(
		Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h! - 7, m!)
	).toISOString();
};
const punch = (ref: string, date: string, ...spans: [string, string][]): ProbeInput => ({
	collection: 'work_days',
	values: {
		employment_id: `@${ref}_job`,
		work_date: date,
		worked_intervals: spans.map(([from, to]) => ({ start: at(date, from), end: at(date, to) }))
	}
});

/** A punched day whose overtime, rest-day or holiday hours the employer ordered (PP 35/2021 art.29): the run pays only those. */
const ordered = (day: ProbeInput, hours: number): ProbeInput => ({
	...day,
	values: { ...day.values, approved_overtime_hours: hours }
});

const leave = (
	ref: string,
	code: string,
	from: string,
	to: string,
	extra: Row = {}
): ProbeInput => ({
	collection: 'leave_entries',
	values: {
		employment_id: `@${ref}_job`,
		catalogue_id: `@law:leave_catalogue:${code}`,
		reference: `${code}-${ref}-${from}`,
		from_date: from,
		to_date: to,
		reason: `${code} (probe)`,
		...extra
	}
});

/** The company: DKI Jakarta, JKK risk group I, a verified medium/large enterprise for BPJS Kesehatan. */
const company = (over: { region?: string; risk_class?: string; facts?: Row } = {}): Row => ({
	region: over.region ?? 'Provinsi DKI Jakarta',
	risk_class: over.risk_class ?? 'I',
	facts: { enterprise_size_class: 'OTHER', ...over.facts }
});

/** A leaver's departure record (PP 35/2021 cause, not the broad exit reason). */
const departure = (cause: string | null, extra: Row = {}): Row => ({
	micro_small_enterprise: false,
	pension_offset_applies: false,
	thr_holiday_date: '2026-03-21',
	...(cause == null ? {} : { termination_cause: cause }),
	...extra
});

type Lines = { readonly [key: string]: number };

/**
 * From one year of service PP 36/2021 arts.20, 24 and PP 49/2025 art.21 hold the worker to the company wage scale:
 * the terms record the grade, its basic-wage minimum, the scale's effective date and the grade notice, and the
 * scale reference's evidence is a file (fact_evidence). A veteran is hired 6 January 2025.
 */
const VETERAN_HIRE = '2025-01-06';
const scale = (basicMinimum: number): Row => ({
	wage_scale_grade: 'G3',
	wage_scale_basic_minimum: basicMinimum,
	wage_scale_effective_on: '2025-01-01',
	wage_scale_notice_on: VETERAN_HIRE,
	wage_scale_reference: 'PROBE-SCALE-2025-G3'
});
const scaleEvidence = (ref: string): ProbeInput => ({
	collection: 'fact_evidence',
	values: {
		subject: { collection: 'employment_terms', id: `@${ref}_terms` },
		fact_key: 'wage_scale_reference',
		reference: 'PROBE-SCALE-2025-G3'
	},
	files: { file: 'wage-scale-and-grade-notice.pdf' }
});
/** The ID-14-1 slip: Rp10,000,000, February 2026, DKI Jakarta, JKK group I, TER A. */
const TEN_MILLION: Lines = {
	gross: 10_000_000,
	net: 9_338_650,
	'JHT.employee': 200_000,
	'JHT.employer': 370_000,
	'JP.employee': 100_000,
	'JP.employer': 200_000,
	'JKK.employer': 24_000,
	'JKM.employer': 30_000,
	'KESEHATAN.employee': 100_000,
	'KESEHATAN.employer': 400_000,
	'PPH21.employee': 261_350
};

const cases: ProbeCase[] = [
	// ─── Full month and every BPJS scheme ───────────────────────────────────────────────────────
	{
		id: 'ID-14-1',
		profile: 'ID',
		description:
			'A citizen TK/0 on Rp10,000,000, the whole of February 2026, DKI Jakarta, JKK group I, with NO BPJS registration on file: every BPJS scheme is still assessed (UU 24/2011 arts.15, 19), PPh 21 at TER A.',
		citation: [
			SRC.JHT,
			SRC.JP,
			SRC.JKK,
			SRC.KES,
			SRC.TER,
			'Missing registration never waives the contribution: UU 24/2011 arts.15(1), 19(1)–(2); PP 45/2015 arts.4(1)–(2), 5(5) (tracker ID-45)',
			'JHT 200,000 / 370,000; JP 100,000 / 200,000 (under 10,547,400); JKK 0.24% 24,000; JKM 30,000; Kesehatan 100,000 / 400,000',
			'TER gross 10,000,000 + 24,000 + 30,000 + 400,000 = 10,454,000, TER A 10,350,001–10,700,000 at 2.5% = 261,350',
			'Net 10,000,000 − 200,000 − 100,000 − 100,000 − 261,350 = 9,338,650; employer cost 370,000 + 200,000 + 24,000 + 30,000 + 400,000 = 1,024,000'
		],
		company: company(),
		inputs: [...week('2025-06-02'), ...worker({ ref: 'adi', wage: 10_000_000 })],
		period: '2026-02',
		expected: [
			{
				employment: 'adi_job',
				lines: {
					gross: 10_000_000,
					net: 9_338_650,
					employer_cost: 1_024_000,
					BASIC: 10_000_000,
					'JHT.employee': 200_000,
					'JHT.employer': 370_000,
					'JP.employee': 100_000,
					'JP.employer': 200_000,
					'JKK.employer': 24_000,
					'JKM.employer': 30_000,
					'KESEHATAN.employee': 100_000,
					'KESEHATAN.employer': 400_000,
					'PPH21.employee': 261_350
				}
			}
		]
	},
	...(
		[
			['ID-16-1', 'II', 54_000, 262_100, 9_337_900],
			['ID-16-2', 'III', 89_000, 262_975, 9_337_025],
			['ID-16-3', 'IV', 127_000, 263_925, 9_336_075],
			['ID-16-4', 'V', 174_000, 265_100, 9_334_900]
		] as const
	).map(([id, risk, jkk, pph21, net]): ProbeCase => ({
		id,
		profile: 'ID',
		description: `JKK risk group ${risk} on Rp10,000,000, February 2026: the group rate on the whole wage${risk === 'II' ? ', and on Rp25,000,000 the whole group rate with no Rp5m cap (tracker ID-70)' : ''}.`,
		citation: [
			SRC.JKK,
			SRC.JHT,
			SRC.JP,
			SRC.KES,
			SRC.TER,
			`JKK ${risk}: ${jkk} on 10,000,000; TER gross 10,000,000 + ${jkk} + 30,000 + 400,000, TER A 2.5% = ${pph21}`,
			...(risk === 'II'
				? [
						'Rp25,000,000, group II: JKK 0.54% = 135,000 (Permenaker 3/2025 art.14(3)–(4) caps only the recomposed 0.14%); JHT 500,000 / 925,000; JP at the ceiling 105,474 / 210,948; JKM 75,000; Kesehatan capped 120,000 / 480,000; TER gross 25,000,000 + 135,000 + 75,000 + 480,000 = 25,690,000, TER A 24,150,001–26,450,000 at 10% = 2,569,000; net 25,000,000 − 500,000 − 105,474 − 120,000 − 2,569,000 = 21,705,526'
					]
				: [])
		],
		company: company({ risk_class: risk }),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'budi', wage: 10_000_000 }),
			...(risk === 'II' ? worker({ ref: 'citra', wage: 25_000_000 }) : [])
		],
		period: '2026-02',
		expected: [
			{
				employment: 'budi_job',
				lines: {
					net,
					'JHT.employee': 200_000,
					'JHT.employer': 370_000,
					'JP.employee': 100_000,
					'JP.employer': 200_000,
					'JKK.employer': jkk,
					'JKM.employer': 30_000,
					'KESEHATAN.employee': 100_000,
					'KESEHATAN.employer': 400_000,
					'PPH21.employee': pph21
				}
			},
			...(risk === 'II'
				? [
						{
							employment: 'citra_job',
							lines: {
								net: 21_705_526,
								'JHT.employee': 500_000,
								'JHT.employer': 925_000,
								'JP.employee': 105_474,
								'JP.employer': 210_948,
								'JKK.employer': 135_000,
								'JKM.employer': 75_000,
								'KESEHATAN.employee': 120_000,
								'KESEHATAN.employer': 480_000,
								'PPH21.employee': 2_569_000
							}
						}
					]
				: [])
		]
	})),
	{
		id: 'ID-19-1',
		profile: 'ID',
		description:
			'BPJS Kesehatan at its floor, its ceiling and a hundred rupiah above the ceiling (February 2026, DKI Jakarta UMP Rp5,729,876): 5% on the wage, capped at Rp12,000,000.',
		citation: [
			SRC.KES,
			SRC.JHT,
			SRC.JP,
			SRC.JKK,
			SRC.TER,
			'DKI UMP 2026 Rp5,729,876: Kep. Gubernur DKI 1142/2025 (tracker ID-94, https://jdih.jakarta.go.id/)',
			'At 5,729,876: JHT 114,597.52 → 114,598 / 212,005.41 → 212,005; JP 57,298.76 → 57,299 / 114,597.52 → 114,598; JKK 13,751.70 → 13,752; JKM 17,189.63 → 17,190; Kesehatan 57,298.76 → 57,299 / 229,195.04 → 229,195; TER gross 5,990,013, TER A 5,950,001–6,300,000 at 0.75% = 44,925',
			'At 12,000,000: Kesehatan 120,000 / 480,000; JHT 240,000 / 444,000; JP capped 105,474 / 210,948; JKK 28,800; JKM 36,000; TER gross 12,544,800 at 5% (12,500,001–13,750,000) = 627,240',
			'At 12,000,100: Kesehatan stays 120,000 / 480,000 (uncapped would be 120,001 / 480,004); JHT 240,002 / 444,004; JKK 28,800.24 → 28,800; JKM 36,000.30 → 36,000; TER gross 12,544,900 at 5% = 627,245'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'dewi', wage: 5_729_876 }),
			...worker({ ref: 'eko', wage: 12_000_000 }),
			...worker({ ref: 'fajar', wage: 12_000_100 })
		],
		period: '2026-02',
		expected: [
			{
				employment: 'dewi_job',
				lines: {
					net: 5_455_755,
					'JHT.employee': 114_598,
					'JHT.employer': 212_005,
					'JP.employee': 57_299,
					'JP.employer': 114_598,
					'JKK.employer': 13_752,
					'JKM.employer': 17_190,
					'KESEHATAN.employee': 57_299,
					'KESEHATAN.employer': 229_195,
					'PPH21.employee': 44_925
				}
			},
			{
				employment: 'eko_job',
				lines: {
					net: 10_907_286,
					'JHT.employee': 240_000,
					'JHT.employer': 444_000,
					'JP.employee': 105_474,
					'JP.employer': 210_948,
					'JKK.employer': 28_800,
					'JKM.employer': 36_000,
					'KESEHATAN.employee': 120_000,
					'KESEHATAN.employer': 480_000,
					'PPH21.employee': 627_240
				}
			},
			{
				employment: 'fajar_job',
				lines: {
					net: 10_907_379,
					'JHT.employee': 240_002,
					'JHT.employer': 444_004,
					'JP.employee': 105_474,
					'JP.employer': 210_948,
					'JKK.employer': 28_800,
					'JKM.employer': 36_000,
					'KESEHATAN.employee': 120_000,
					'KESEHATAN.employer': 480_000,
					'PPH21.employee': 627_245
				}
			}
		]
	},
	{
		id: 'ID-15-1',
		profile: 'ID',
		description:
			'JP at its ceiling seam and its age branches, February 2026: Rp10,547,400 and Rp10,547,500 both pay on the ceiling; age 59 pays no JP, 58 does, 60 does on a recorded art.15(4) choice.',
		citation: [
			SRC.JP,
			SRC.JHT,
			SRC.JKK,
			SRC.KES,
			SRC.TER,
			'10,547,400: JP 105,474 / 210,948; JHT 210,948 / 390,253.80 → 390,254; JKK 25,313.76 → 25,314; JKM 31,642.20 → 31,642; Kesehatan 105,474 / 421,896; TER gross 11,026,252 at TER A 3% (10,700,001–11,050,000) = 330,787.56 → 330,788',
			'10,547,500: JP stays 105,474 / 210,948 (uncapped 105,475 / 210,950); JHT 210,950 / 390,257.50 → 390,258; JKK 25,314; JKM 31,642.50 → 31,643; Kesehatan 105,475 / 421,900; TER gross 11,026,357 at 3% = 330,790.71 → 330,791',
			'Age 59 (born 15 June 1966): JP stops at pension age 59 (PP 45/2015 art.15(1)–(3)); age 58 pays 100,000 / 200,000; age 60 with the art.15(4) choice to continue pays 100,000 / 200,000. JHT has no age limit (PP 46/2015 art.16).'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'gita', wage: 10_547_400 }),
			...worker({ ref: 'hadi', wage: 10_547_500 }),
			...worker({ ref: 'imam', wage: 10_000_000, dob: '1966-06-15' }),
			...worker({ ref: 'joko', wage: 10_000_000, dob: '1967-06-15' }),
			...worker({ ref: 'kurni', wage: 10_000_000, dob: '1965-06-15' }),
			registered('kurni', 'JP', { continue_after_pension_age: true }, true)
		],
		period: '2026-02',
		expected: [
			{
				employment: 'gita_job',
				lines: {
					'JHT.employee': 210_948,
					'JHT.employer': 390_254,
					'JP.employee': 105_474,
					'JP.employer': 210_948,
					'JKK.employer': 25_314,
					'JKM.employer': 31_642,
					'KESEHATAN.employee': 105_474,
					'KESEHATAN.employer': 421_896,
					'PPH21.employee': 330_788
				}
			},
			{
				employment: 'hadi_job',
				lines: {
					'JHT.employee': 210_950,
					'JHT.employer': 390_258,
					'JP.employee': 105_474,
					'JP.employer': 210_948,
					'JKK.employer': 25_314,
					'JKM.employer': 31_643,
					'KESEHATAN.employee': 105_475,
					'KESEHATAN.employer': 421_900,
					'PPH21.employee': 330_791
				}
			},
			{
				employment: 'imam_job',
				lines: {
					net: 9_438_650,
					'JHT.employee': 200_000,
					'JHT.employer': 370_000,
					'JKK.employer': 24_000,
					'JKM.employer': 30_000,
					'KESEHATAN.employee': 100_000,
					'KESEHATAN.employer': 400_000,
					'PPH21.employee': 261_350
				}
			},
			...['joko_job', 'kurni_job'].map((employment) => ({
				employment,
				lines: {
					net: 9_338_650,
					'JHT.employee': 200_000,
					'JHT.employer': 370_000,
					'JP.employee': 100_000,
					'JP.employer': 200_000,
					'JKK.employer': 24_000,
					'JKM.employer': 30_000,
					'KESEHATAN.employee': 100_000,
					'KESEHATAN.employer': 400_000,
					'PPH21.employee': 261_350
				}
			}))
		]
	},
	{
		id: 'ID-15-2',
		profile: 'ID',
		description:
			'Two foreign workers on 18-month PKWTs (UU 13/2003 art.42(4): a foreigner is employed for a fixed term) at Rp20,000,000, tax resident, February 2026: BPJS TK and Kesehatan from six months of work; JP only on a recorded registration.',
		citation: [
			SRC.JP,
			'JP reaches a foreign worker only once registered: PP 45/2015 art.3(1); BPJS Ketenagakerjaan does not register foreigners by default (tracker ID-15)',
			'Foreign worker coverage from six months of work: PP 44/2015 art.1 angka 4; PP 46/2015 art.2(2); Perpres 82/2018 art.1 angka 2 (tracker ID-175)',
			SRC.JHT,
			SRC.JKK,
			SRC.KES,
			SRC.TER,
			'JHT 400,000 / 740,000; JKK 48,000; JKM 60,000; Kesehatan capped 120,000 / 480,000; registered JP at the ceiling 105,474 / 210,948',
			'TER gross 20,000,000 + 48,000 + 60,000 + 480,000 = 20,588,000, TER A 19,750,001–24,150,000 at 9% = 1,852,920',
			'Net unregistered 20,000,000 − 400,000 − 120,000 − 1,852,920 = 17,627,080; registered 17,521,606'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({
				ref: 'lee',
				wage: 20_000_000,
				citizenship: 'FOREIGNER',
				type: 'CONTRACT',
				hire: '2025-07-01',
				exit: '2026-12-31'
			}),
			...worker({
				ref: 'tan',
				wage: 20_000_000,
				citizenship: 'FOREIGNER',
				type: 'CONTRACT',
				hire: '2025-07-01',
				exit: '2026-12-31'
			}),
			registered('tan', 'JP', {}, false, '2025-07-01')
		],
		period: '2026-02',
		expected: [
			{
				employment: 'lee_job',
				lines: {
					net: 17_627_080,
					'JHT.employee': 400_000,
					'JHT.employer': 740_000,
					'JKK.employer': 48_000,
					'JKM.employer': 60_000,
					'KESEHATAN.employee': 120_000,
					'KESEHATAN.employer': 480_000,
					'PPH21.employee': 1_852_920
				}
			},
			{
				employment: 'tan_job',
				lines: {
					net: 17_521_606,
					'JHT.employee': 400_000,
					'JHT.employer': 740_000,
					'JP.employee': 105_474,
					'JP.employer': 210_948,
					'JKK.employer': 48_000,
					'JKM.employer': 60_000,
					'KESEHATAN.employee': 120_000,
					'KESEHATAN.employer': 480_000,
					'PPH21.employee': 1_852_920
				}
			}
		]
	},
	{
		id: 'ID-15-3',
		profile: 'ID',
		description:
			'The JP ceiling after it moves on 1 March 2026: Rp12,000,000 in March pays JP on Rp11,086,300.',
		citation: [
			SRC.JP,
			SRC.JHT,
			SRC.JKK,
			SRC.KES,
			SRC.TER,
			'JP 1% / 2% of 11,086,300 = 110,863 / 221,726; JHT 240,000 / 444,000; JKK 28,800; JKM 36,000; Kesehatan 120,000 / 480,000; TER gross 12,544,800 at 5% = 627,240; net 12,000,000 − 240,000 − 110,863 − 120,000 − 627,240 = 10,901,897'
		],
		company: company(),
		inputs: [...week('2025-06-02'), ...worker({ ref: 'lina', wage: 12_000_000 })],
		period: '2026-03',
		expected: [
			{
				employment: 'lina_job',
				lines: {
					net: 10_901_897,
					'JHT.employee': 240_000,
					'JHT.employer': 444_000,
					'JP.employee': 110_863,
					'JP.employer': 221_726,
					'JKK.employer': 28_800,
					'JKM.employer': 36_000,
					'KESEHATAN.employee': 120_000,
					'KESEHATAN.employer': 480_000,
					'PPH21.employee': 627_240
				}
			}
		]
	},
	{
		id: 'ID-52-1',
		profile: 'ID',
		description:
			'A BPJS-verified labour-intensive employer (PP 7/2025) in January 2026, group I: JKK halved to 0.12%.',
		citation: [
			'PP 7/2025 arts.3(3)–(4), 4(1), 10 as amended by PP 36/2025 art.10A: JKK I 0.120% for contribution months February 2025 to January 2026 (https://jdih.kemnaker.go.id/peraturan/detail/2641/peraturan-pemerintah-nomor-7-tahun-2025; https://jdih.kemnaker.go.id/download.php?id=2720)',
			SRC.JHT,
			SRC.JP,
			SRC.KES,
			SRC.TER,
			'JKK 0.12% × 10,000,000 = 12,000; TER gross 10,000,000 + 12,000 + 30,000 + 400,000 = 10,442,000 at 2.5% = 261,050; net 9,338,950'
		],
		company: company({ facts: { jkk_padat_karya: true } }),
		inputs: [...week('2025-06-02'), ...worker({ ref: 'mira', wage: 10_000_000 })],
		period: '2026-01',
		expected: [
			{
				employment: 'mira_job',
				lines: {
					net: 9_338_950,
					'JHT.employee': 200_000,
					'JHT.employer': 370_000,
					'JP.employee': 100_000,
					'JP.employer': 200_000,
					'JKK.employer': 12_000,
					'JKM.employer': 30_000,
					'KESEHATAN.employee': 100_000,
					'KESEHATAN.employer': 400_000,
					'PPH21.employee': 261_050
				}
			}
		]
	},
	...(
		[
			['ID-52-3', 'II', '0.270%', 32_400, 627_420, 10_907_106],
			['ID-52-4', 'III', '0.445%', 53_400, 628_470, 10_906_056],
			['ID-52-5', 'IV', '0.635%', 76_200, 629_610, 10_904_916],
			['ID-52-6', 'V', '0.870%', 104_400, 631_020, 10_903_506]
		] as const
	).map(([id, risk, rate, jkk, pph21, net]): ProbeCase => ({
		id,
		profile: 'ID',
		description: `A BPJS-verified labour-intensive employer (PP 7/2025) in January 2026, group ${risk}, Rp12,000,000: JKK halved to ${rate}.`,
		citation: [
			`PP 7/2025 art.4(1) as extended by PP 36/2025 art.10A: JKK ${risk} ${rate} for contribution months February 2025 to January 2026 (https://jdih.kemnaker.go.id/peraturan/detail/2641/peraturan-pemerintah-nomor-7-tahun-2025; https://jdih.kemnaker.go.id/download.php?id=2720; tracker ID-52)`,
			SRC.JHT,
			SRC.JP,
			SRC.KES,
			SRC.TER,
			`JKK ${rate} × 12,000,000 = ${jkk}; JHT 240,000 / 444,000; JP at the January ceiling 10,547,400: 105,474 / 210,948; JKM 36,000; Kesehatan capped 120,000 / 480,000`,
			`TER gross 12,000,000 + ${jkk} + 36,000 + 480,000, TER A 12,500,001–13,750,000 at 5% = ${pph21}; net 12,000,000 − 240,000 − 105,474 − 120,000 − ${pph21} = ${net}`
		],
		company: company({ risk_class: risk, facts: { jkk_padat_karya: true } }),
		inputs: [...week('2025-06-02'), ...worker({ ref: 'padat', wage: 12_000_000 })],
		period: '2026-01',
		expected: [
			{
				employment: 'padat_job',
				lines: {
					net,
					'JHT.employee': 240_000,
					'JHT.employer': 444_000,
					'JP.employee': 105_474,
					'JP.employer': 210_948,
					'JKK.employer': jkk,
					'JKM.employer': 36_000,
					'KESEHATAN.employee': 120_000,
					'KESEHATAN.employer': 480_000,
					'PPH21.employee': pph21
				}
			}
		]
	})),
	{
		id: 'ID-52-2',
		profile: 'ID',
		description:
			'The same labour-intensive employer in February 2026: the relief has ended, JKK is the ordinary group I 0.24%.',
		citation: [
			'PP 36/2025 art.10A extends the PP 7/2025 relief through the January 2026 contribution month only (https://jdih.kemnaker.go.id/download.php?id=2720)',
			SRC.JKK,
			'JKK 24,000; TER gross 10,454,000 at 2.5% = 261,350; net 9,338,650'
		],
		company: company({ facts: { jkk_padat_karya: true } }),
		inputs: [...week('2025-06-02'), ...worker({ ref: 'nanda', wage: 10_000_000 })],
		period: '2026-02',
		expected: [
			{
				employment: 'nanda_job',
				lines: {
					net: 9_338_650,
					'JHT.employee': 200_000,
					'JHT.employer': 370_000,
					'JP.employee': 100_000,
					'JP.employer': 200_000,
					'JKK.employer': 24_000,
					'JKM.employer': 30_000,
					'KESEHATAN.employee': 100_000,
					'KESEHATAN.employer': 400_000,
					'PPH21.employee': 261_350
				}
			}
		]
	},
	{
		id: 'ID-124-1',
		profile: 'ID',
		description:
			'A construction-services employer (Permenaker 5/2021 BAB IV), risk group II, February 2026: its PKWT worker pays JKK at 1.74%, its PKWTT worker the group II 0.54%. Both are regular employees for PPh 21 (PMK 168/2023 art.1(10)).',
		citation: [
			'Permenaker 5/2021 arts.65, 71(1)–(2): JKK 1.74% and JKM 0.30% of the known monthly wage of harian lepas, borongan and PKWT construction workers (https://www.bpjsketenagakerjaan.go.id/assets/uploads/peraturan/Permenaker_Nomor_5_Tahun_2021_Tata_Cara_Penyelenggaraan_Program_JKK,_JKM,_dan_JHT.pdf)',
			'A full-time PKWT worker on regular pay is a pegawai tetap for PPh 21: PMK 168/2023 art.1 angka 10–11 (tracker ID-72)',
			SRC.JKK,
			SRC.TER,
			'PKWT: JKK 174,000; TER gross 10,000,000 + 174,000 + 30,000 + 400,000 = 10,604,000 at 2.5% = 265,100; net 9,334,900',
			'PKWTT: JKK 54,000; TER gross 10,484,000 at 2.5% = 262,100; net 9,337,900'
		],
		company: company({ risk_class: 'II', facts: { jkk_jasa_konstruksi: true } }),
		inputs: [
			...week('2025-06-02'),
			...worker({
				ref: 'oka',
				wage: 10_000_000,
				type: 'CONTRACT',
				hire: '2025-07-01',
				exit: '2026-06-30'
			}),
			...worker({ ref: 'putu', wage: 10_000_000 })
		],
		period: '2026-02',
		expected: [
			{
				employment: 'oka_job',
				lines: {
					net: 9_334_900,
					'JHT.employee': 200_000,
					'JHT.employer': 370_000,
					'JP.employee': 100_000,
					'JP.employer': 200_000,
					'JKK.employer': 174_000,
					'JKM.employer': 30_000,
					'KESEHATAN.employee': 100_000,
					'KESEHATAN.employer': 400_000,
					'PPH21.employee': 265_100
				}
			},
			{
				employment: 'putu_job',
				lines: {
					net: 9_337_900,
					'JHT.employee': 200_000,
					'JHT.employer': 370_000,
					'JP.employee': 100_000,
					'JP.employer': 200_000,
					'JKK.employer': 54_000,
					'JKM.employer': 30_000,
					'KESEHATAN.employee': 100_000,
					'KESEHATAN.employer': 400_000,
					'PPH21.employee': 262_100
				}
			}
		]
	},
	{
		id: 'ID-124-2',
		profile: 'ID',
		description:
			'A construction-services employer (Permenaker 5/2021 BAB IV), risk group II, February 2026: a piece-rate (borongan) worker in the first month of the employment, Rp6,000,000, pays JKK at 1.74%.',
		citation: [
			'PP 44/2015 art.54(1): JKK 1.74% of Upah sebulan for harian lepas, borongan and PKWT workers of a non-state employer in construction services where the wage is known (https://jdih.kemnaker.go.id/asset/data_puu/PP_NOMOR_44_TAHUN2015OK.PDF, read 2026-09-30); Permenaker 5/2021 arts.65, 71(1)–(2) (tracker ID-124)',
			'PP 44/2015 art.19(4) and PP 46/2015 art.17(4): borongan wages average the last three months; tracker ID-62 owner default 2026-09-28: with no earlier month, the first month on its own wage',
			SRC.JHT,
			SRC.JP,
			SRC.KES,
			SRC.TER,
			'JKK 1.74% × 6,000,000 = 104,400; JHT 120,000 / 222,000; JP 60,000 / 120,000; JKM 18,000; Kesehatan 60,000 / 240,000 (6,000,000 is above the DKI UMP 5,729,876)',
			'TER gross 6,000,000 + 104,400 + 18,000 + 240,000 = 6,362,400, TER A 6,300,001–6,750,000 at 1% = 63,624; net 6,000,000 − 120,000 − 60,000 − 60,000 − 63,624 = 5,696,376'
		],
		company: company({ risk_class: 'II', facts: { jkk_jasa_konstruksi: true } }),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'wayan', wage: 6_000_000, hire: '2026-02-01', category: 'PIECE_RATE' })
		],
		period: '2026-02',
		expected: [
			{
				employment: 'wayan_job',
				lines: {
					net: 5_696_376,
					'JHT.employee': 120_000,
					'JHT.employer': 222_000,
					'JP.employee': 60_000,
					'JP.employer': 120_000,
					'JKK.employer': 104_400,
					'JKM.employer': 18_000,
					'KESEHATAN.employee': 60_000,
					'KESEHATAN.employer': 240_000,
					'PPH21.employee': 63_624
				}
			}
		]
	},
	{
		id: 'ID-62-1',
		profile: 'ID',
		description:
			'A piece-rate worker in the first month of the employment (hired 1 February 2026, Rp6,000,000): with no earlier month the BPJS base is the month’s own wage.',
		citation: [
			'PP 44/2015 art.19(4) and PP 46/2015 art.17(4): borongan wages average the last three months (https://jdih.kemnaker.go.id/asset/data_puu/PP_NOMOR_44_TAHUN2015OK.PDF); tracker ID-62 owner default 2026-09-28: with no earlier month, the first month on its own wage',
			SRC.JP,
			SRC.KES,
			SRC.TER,
			'JHT 120,000 / 222,000; JP 60,000 / 120,000; JKK 14,400; JKM 18,000; Kesehatan 60,000 / 240,000; TER gross 6,272,400 at TER A 0.75% = 47,043; net 6,000,000 − 120,000 − 60,000 − 60,000 − 47,043 = 5,712,957'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'rudi', wage: 6_000_000, hire: '2026-02-01', category: 'PIECE_RATE' })
		],
		period: '2026-02',
		expected: [
			{
				employment: 'rudi_job',
				lines: {
					net: 5_712_957,
					'JHT.employee': 120_000,
					'JHT.employer': 222_000,
					'JP.employee': 60_000,
					'JP.employer': 120_000,
					'JKK.employer': 14_400,
					'JKM.employer': 18_000,
					'KESEHATAN.employee': 60_000,
					'KESEHATAN.employer': 240_000,
					'PPH21.employee': 47_043
				}
			}
		]
	},
	{
		id: 'ID-175-1',
		profile: 'ID',
		description:
			'A foreign worker on a five-month PKWT from 1 February 2026 with no earlier work in Indonesia (reviewed and referenced), non-resident, Rp20,000,000: no BPJS before six months of work, PPh 26 at 20%.',
		citation: [
			'A foreign worker joins BPJS Kesehatan after six months of work in Indonesia: Perpres 82/2018 art.1 angka 2 as restated by Perpres 59/2024 (https://peraturan.bpk.go.id/Download/344279/Perpres%20Nomor%2059%20Tahun%202024.pdf); JKK/JKM/JHT likewise: PP 44/2015 art.1 angka 4, PP 46/2015 art.2(2) (https://jdih.kemnaker.go.id/asset/data_puu/PP_NOMOR_46_TAHUN2015OK.PDF)',
			'PPh 26: 20% of the gross amount paid to a non-resident: UU 36/2008 art.26(1) (https://jdih.kemenkeu.go.id/dok/uu-36-tahun-2008)',
			'PPh 26 = 20% × 20,000,000 = 4,000,000 (no employer premium is income here, none being charged); net 16,000,000'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({
				ref: 'wong',
				wage: 20_000_000,
				citizenship: 'FOREIGNER',
				tax: 'NON_RESIDENT',
				type: 'CONTRACT',
				hire: '2026-02-01',
				exit: '2026-06-30',
				terms_facts: { foreign_prior_work: 'NONE', foreign_prior_work_reviewed_on: '2026-02-01' }
			}),
			{
				collection: 'fact_evidence',
				values: {
					subject: { collection: 'employment_terms', id: '@wong_terms' },
					fact_key: 'foreign_prior_work_reviewed_on',
					reference: 'PROBE-IMIGRASI-CHECK-2026-02-01'
				}
			}
		],
		period: '2026-02',
		expected: [{ employment: 'wong_job', lines: { net: 16_000_000, 'PPH26.employee': 4_000_000 } }]
	},

	// ─── Tax ────────────────────────────────────────────────────────────────────────────────────
	{
		id: 'ID-21-1',
		profile: 'ID',
		description:
			'The TER category is the year-start PTKP status (PP 58/2023 art.2(4)): K/0 is A, K/1 is B, K/3 is C, a married woman without the combined-income election is A, and no NPWP withholds 120%. Rp9,000,000, February 2026.',
		citation: [
			SRC.TER,
			'PP 58/2023 art.2(4): A = TK/0, TK/1, K/0; B = TK/2, TK/3, K/1, K/2; C = K/3',
			'A married woman is TK/0 unless her income is combined with her husband’s: PMK 168/2023 art.9 (tracker ID-21)',
			'No NPWP (or NIK usable as one): 20% higher, UU PPh art.21(5a)',
			'Each: JHT 180,000 / 333,000; JP 90,000 / 180,000; JKK 21,600; JKM 27,000; Kesehatan 90,000 / 360,000; TER gross 9,408,600',
			'A 8,550,001–9,650,000 1.75% = 164,650.50 → 164,651; B 9,200,001–10,750,000 1.5% = 141,129; C 8,850,001–9,800,000 1.25% = 117,607.50 → 117,608; no NPWP 164,650.50 × 1.2 = 197,580.60 → 197,581'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'agus', wage: 9_000_000, marital: 'MARRIED' }),
			...worker({ ref: 'bayu', wage: 9_000_000, marital: 'MARRIED', dependants: 1 }),
			...worker({ ref: 'candra', wage: 9_000_000, marital: 'MARRIED', dependants: 3 }),
			...worker({
				ref: 'dian',
				wage: 9_000_000,
				marital: 'MARRIED',
				dependants: 3,
				gender: 'FEMALE'
			}),
			...worker({ ref: 'edi', wage: 9_000_000, elections: { no_tax_id: true } })
		],
		period: '2026-02',
		expected: (
			[
				['agus_job', 164_651],
				['bayu_job', 141_129],
				['candra_job', 117_608],
				['dian_job', 164_651],
				['edi_job', 197_581]
			] as const
		).map(([employment, pph21]) => ({
			employment,
			lines: {
				net: 9_000_000 - 180_000 - 90_000 - 90_000 - pph21,
				'JHT.employee': 180_000,
				'JHT.employer': 333_000,
				'JP.employee': 90_000,
				'JP.employer': 180_000,
				'JKK.employer': 21_600,
				'JKM.employer': 27_000,
				'KESEHATAN.employee': 90_000,
				'KESEHATAN.employer': 360_000,
				'PPH21.employee': pph21
			}
		}))
	},
	{
		id: 'ID-21-2',
		profile: 'ID',
		description:
			'The TER A 5%/6% seam at Rp13,750,000 of monthly gross: one rupiah of wage moves the whole month to the next rate.',
		citation: [
			SRC.TER,
			SRC.JKK,
			'13,198,727: JKK 31,676.94 → 31,677; JKM 39,596.18 → 39,596; Kesehatan capped 480,000; TER gross exactly 13,750,000 at 5% = 687,500',
			'13,198,728: JKK 31,677; JKM 39,596; TER gross 13,750,001 at 6% = 825,000.06 → 825,000',
			'Both: JHT 263,974.54/.56 → 263,975 and 488,352.90/.94 → 488,353; JP capped 105,474 / 210,948; Kesehatan 120,000 / 480,000'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'fina', wage: 13_198_727 }),
			...worker({ ref: 'gani', wage: 13_198_728 })
		],
		period: '2026-02',
		expected: (
			[
				['fina_job', 687_500, 12_021_778],
				['gani_job', 825_000, 11_884_279]
			] as const
		).map(([employment, pph21, net]) => ({
			employment,
			lines: {
				net,
				'JHT.employee': 263_975,
				'JHT.employer': 488_353,
				'JP.employee': 105_474,
				'JP.employer': 210_948,
				'JKK.employer': 31_677,
				'JKM.employer': 39_596,
				'KESEHATAN.employee': 120_000,
				'KESEHATAN.employer': 480_000,
				'PPH21.employee': pph21
			}
		}))
	},
	{
		id: 'ID-122-1',
		profile: 'ID',
		description:
			'December 2026 is the last tax period: two TK/0 joiners on 1 December at Rp60,000,000, one with Rp1,500,000 of zakat paid through the employer to BAZNAS. The year is December alone, so the reckoning is the whole annual tax.',
		citation: [
			SRC.LAST,
			'Zakat paid through the employer to a government-formed or approved amil zakat body is deducted: PMK 168/2023 art.10(1)(c) (tracker ID-122)',
			SRC.JHT,
			SRC.JP,
			SRC.JKK,
			SRC.KES,
			'BPJS: JHT 1,200,000 / 2,220,000; JP on 11,086,300 = 110,863 / 221,726; JKK 144,000; JKM 180,000; Kesehatan 120,000 / 480,000',
			'Year gross 60,000,000 + 144,000 + 180,000 + 480,000 = 60,804,000; biaya jabatan 5% = 3,040,200 capped at 1 month × 500,000 = 500,000; − JHT 1,200,000 − JP 110,863 = 58,993,137; − PTKP TK/0 54,000,000 = 4,993,137 → 4,993,000; 5% = 249,650',
			'With zakat: 58,993,137 − 1,500,000 − 54,000,000 = 3,493,137 → 3,493,000; 5% = 174,650',
			'Net without zakat 60,000,000 − 1,200,000 − 110,863 − 120,000 − 249,650 = 58,319,487'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'hana', wage: 60_000_000, hire: '2026-12-01' }),
			...worker({
				ref: 'irfan',
				wage: 60_000_000,
				hire: '2026-12-01',
				pph21: {
					deduction_claims: [
						{
							period: '2026-12',
							category: 'ZAKAT',
							amount: 1_500_000,
							source: 'EMPLOYEE',
							reference: 'BAZNAS-PROBE-2026-12'
						}
					]
				}
			})
		],
		period: '2026-12',
		expected: (
			[
				['hana_job', 249_650],
				['irfan_job', 174_650]
			] as const
		).map(([employment, pph21]) => ({
			employment,
			lines: {
				...(employment === 'hana_job' ? { net: 58_319_487 } : {}),
				'JHT.employee': 1_200_000,
				'JHT.employer': 2_220_000,
				'JP.employee': 110_863,
				'JP.employer': 221_726,
				'JKK.employer': 144_000,
				'JKM.employer': 180_000,
				'KESEHATAN.employee': 120_000,
				'KESEHATAN.employer': 480_000,
				'PPH21.employee': pph21
			}
		}))
	},
	{
		id: 'ID-84-1',
		profile: 'ID',
		description:
			'PPh 21 borne by the government in 2026 (PMK 105/2025): an eligible-sector employer, a permanent employee whose January 2026 fixed gross was Rp9,000,000 withholds nothing; one whose reference gross was Rp11,000,000 is outside the incentive.',
		citation: [
			'PMK 105/2025 arts.2–4 and annex: DTP for a permanent employee whose fixed regular gross is at most Rp10,000,000 in the reference month, at an employer in an annexed KLU, January–December 2026 (https://jdih.kemenkeu.go.id/api/download/cb203b0c-bdc8-409d-bf9c-a71264d96f60/2025pmkeuangan105.pdf)',
			SRC.TER,
			'9,000,000: BPJS as ID-21-1; PPh 21 0 (DTP); net 9,000,000 − 180,000 − 90,000 − 90,000 = 8,640,000',
			'11,000,000: JHT 220,000 / 407,000; JP capped 105,474 / 210,948; JKK 26,400; JKM 33,000; Kesehatan 110,000 / 440,000; TER gross 11,499,400 at 3.5% = 402,479; net 10,162,047'
		],
		company: company({ facts: { pph21_dtp_sector: true } }),
		inputs: [
			...week('2025-06-02'),
			...worker({
				ref: 'lestari',
				wage: 9_000_000,
				elections: {
					dtp_reference_gross: 9_000_000,
					dtp_reference_year: '2026',
					other_pph21_incentive: false
				}
			}),
			...worker({
				ref: 'made',
				wage: 11_000_000,
				elections: {
					dtp_reference_gross: 11_000_000,
					dtp_reference_year: '2026',
					other_pph21_incentive: false
				}
			})
		],
		period: '2026-02',
		expected: [
			{
				employment: 'lestari_job',
				lines: {
					net: 8_640_000,
					'JHT.employee': 180_000,
					'JHT.employer': 333_000,
					'JP.employee': 90_000,
					'JP.employer': 180_000,
					'JKK.employer': 21_600,
					'JKM.employer': 27_000,
					'KESEHATAN.employee': 90_000,
					'KESEHATAN.employer': 360_000
				}
			},
			{
				employment: 'made_job',
				lines: {
					net: 10_162_047,
					'JHT.employee': 220_000,
					'JHT.employer': 407_000,
					'JP.employee': 105_474,
					'JP.employer': 210_948,
					'JKK.employer': 26_400,
					'JKM.employer': 33_000,
					'KESEHATAN.employee': 110_000,
					'KESEHATAN.employer': 440_000,
					'PPH21.employee': 402_479
				}
			}
		]
	},
	{
		id: 'ID-22-1',
		profile: 'ID',
		description:
			'A monthly-paid non-permanent employee (pegawai tidak tetap, penghasilan bulanan) on Rp10,000,000, February 2026: BPJS as any worker, PPh 21 at the monthly TER on gross.',
		citation: [
			'PMK 168/2023 art.12(2): a non-permanent employee paid monthly is withheld at the monthly TER on gross (https://jdih.kemenkeu.go.id/api/download/e60a82e0-b218-40f5-9d18-b924aa1e11ce/2023pmkeuangan168.pdf)',
			SRC.TER,
			'Same figures as ID-14-1: TER gross 10,454,000 at 2.5% = 261,350; net 9,338,650'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({
				ref: 'nur',
				wage: 10_000_000,
				elections: { recipient_class: 'NON_PERMANENT_MONTHLY' }
			})
		],
		period: '2026-02',
		expected: [
			{
				employment: 'nur_job',
				lines: {
					net: 9_338_650,
					'JHT.employee': 200_000,
					'JHT.employer': 370_000,
					'JP.employee': 100_000,
					'JP.employer': 200_000,
					'JKK.employer': 24_000,
					'JKM.employer': 30_000,
					'KESEHATAN.employee': 100_000,
					'KESEHATAN.employer': 400_000,
					'PPH21.employee': 261_350
				}
			}
		]
	},
	{
		id: 'ID-74-1',
		profile: 'ID',
		description:
			'A non-employee (bukan pegawai) paid Rp20,000,000 for services in February 2026: PPh 21 on 50% of gross at art.17 rates, and no BPJS premium of any programme — JP included — outside an employment relationship.',
		citation: [
			'PMK 168/2023 art.12(3)–(4): a bukan pegawai is withheld at art.17(1)(a) rates on 50% of gross: 5% × 10,000,000 = 500,000 (https://jdih.kemenkeu.go.id/api/download/e60a82e0-b218-40f5-9d18-b924aa1e11ce/2023pmkeuangan168.pdf)',
			'Outside an employment relationship no employer BPJS premium: PP 44/2015 art.5(2)–(3), PP 46/2015 art.4(2)–(3); JP covers only the pekerja of a pemberi kerja: PP 45/2015 arts.1 angka 7, 2 (https://www.bpjsketenagakerjaan.go.id/assets/uploads/peraturan/15122015_104556_PP%2045%20Tahun%202015.pdf); Perpres 82/2018 art.13(1) binds the employer for its Pekerja only',
			'Net 20,000,000 − 500,000 = 19,500,000'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({
				ref: 'oscar',
				wage: 20_000_000,
				type: 'CONSULTANT',
				classification: 'NON_EA',
				elections: { recipient_class: 'NON_EMPLOYEE', service_kind: 'OTHER' }
			})
		],
		period: '2026-02',
		expected: [{ employment: 'oscar_job', lines: { net: 19_500_000, 'PPH21.employee': 500_000 } }]
	},

	// ─── Part months ────────────────────────────────────────────────────────────────────────────
	{
		id: 'ID-106-1',
		profile: 'ID',
		description:
			'A joiner on 16 February 2026 at Rp12,000,000: 13 of February’s 28 days paid; JHT/JKK/JKM on the monthly rate, JP on the wage paid, Kesehatan on the wage paid lifted to the DKI UMP.',
		citation: [
			SRC.PRORATE,
			SRC.TER,
			'Paid 12,000,000 × 13 ÷ 28 = 5,571,428.57; JHT 240,000 / 444,000; JKK 28,800; JKM 36,000; JP 55,714.29 → 55,714 / 111,428.57 → 111,429',
			'Kesehatan: the wage paid 5,571,428.57 is under the DKI UMP 5,729,876, the lowest “Gaji atau Upah per bulan” (Perpres 82/2018 arts.30(1), 32(2)), so it is lifted to the whole UMP (tracker ID-161 default 2026-09-30, law silent on a part month): 1% 57,298.76 → 57,299, 4% 229,195.04 → 229,195; DKI UMP 2026 Kep. Gubernur DKI 1142/2025 (tracker ID-94)',
			'TER gross 5,571,428.57 + 28,800 + 36,000 + 229,195 = 5,865,423.57, TER A 5,650,001–5,950,000 at 0.5% = 29,327.12 → 29,327; net 5,571,428.57 − 240,000 − 55,714 − 57,299 − 29,327 = 5,189,088.57'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'purnama', wage: 12_000_000, hire: '2026-02-16' })
		],
		period: '2026-02',
		expected: [
			{
				employment: 'purnama_job',
				lines: {
					gross: 5_571_428.57,
					net: 5_189_088.57,
					BASIC: 5_571_428.57,
					'JHT.employee': 240_000,
					'JHT.employer': 444_000,
					'JP.employee': 55_714,
					'JP.employer': 111_429,
					'JKK.employer': 28_800,
					'JKM.employer': 36_000,
					'KESEHATAN.employee': 57_299,
					'KESEHATAN.employer': 229_195,
					'PPH21.employee': 29_327
				}
			}
		]
	},
	{
		id: 'ID-106-2',
		profile: 'ID',
		description:
			'Two unpaid days (Monday 9 and Tuesday 10 February 2026) on Rp10,000,000: each day is 1/28 of the month; JHT/JKK/JKM stay on the monthly rate.',
		citation: [
			SRC.PRORATE,
			'No work, no pay: PP 36/2021 art.40(1) (https://jdih.kemnaker.go.id/asset/data_puu/PP362021.pdf)',
			SRC.TER,
			'Off 10,000,000 ÷ 28 × 2 = 714,285.71; paid 9,285,714.29; JHT 200,000 / 370,000; JKK 24,000; JKM 30,000; JP 92,857.14 → 92,857 / 185,714.29 → 185,714; Kesehatan 92,857 / 371,428.57 → 371,429',
			'TER gross 9,285,714.29 + 24,000 + 30,000 + 371,429 = 9,711,143.29 at TER A 2% = 194,222.87 → 194,223; net 9,285,714.29 − 200,000 − 92,857 − 92,857 − 194,223 = 8,705,777.29'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'rina', wage: 10_000_000 }),
			leave('rina', 'UNPAID_LEAVE', '2026-02-09', '2026-02-10')
		],
		period: '2026-02',
		expected: [
			{
				employment: 'rina_job',
				lines: {
					net: 8_705_777.29,
					'JHT.employee': 200_000,
					'JHT.employer': 370_000,
					'JP.employee': 92_857,
					'JP.employer': 185_714,
					'JKK.employer': 24_000,
					'JKM.employer': 30_000,
					'KESEHATAN.employee': 92_857,
					'KESEHATAN.employer': 371_429,
					'PPH21.employee': 194_223
				}
			}
		]
	},
	{
		id: 'ID-161-1',
		profile: 'ID',
		description:
			'A raise from Rp10,000,000 to Rp13,000,000 on 15 February 2026: 14 days at each rate; JHT/JKK/JKM on the rate of the month’s last day, JP on the wage paid (above its ceiling).',
		citation: [
			SRC.PRORATE,
			'Tracker ID-161 owner default 2026-09-28 (law silent on a mid-month change): the monthly rate in force on the month’s last employed day',
			SRC.TER,
			'Paid 10,000,000 × 14/28 + 13,000,000 × 14/28 = 5,000,000 + 6,500,000 = 11,500,000; JHT 260,000 / 481,000; JKK 31,200; JKM 39,000; JP capped 105,474 / 210,948; Kesehatan 115,000 / 460,000',
			'TER gross 11,500,000 + 31,200 + 39,000 + 460,000 = 12,030,200 at TER A 4% = 481,208; net 11,500,000 − 260,000 − 105,474 − 115,000 − 481,208 = 10,538,318'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({
				ref: 'sari',
				wage: 10_000_000,
				rates: [
					{ wage: 10_000_000, from: '2025-06-02', to: '2026-02-14' },
					{ wage: 13_000_000, from: '2026-02-15', to: null }
				]
			})
		],
		period: '2026-02',
		expected: [
			{
				employment: 'sari_job',
				lines: {
					gross: 11_500_000,
					net: 10_538_318,
					BASIC: 11_500_000,
					'JHT.employee': 260_000,
					'JHT.employer': 481_000,
					'JP.employee': 105_474,
					'JP.employer': 210_948,
					'JKK.employer': 31_200,
					'JKM.employer': 39_000,
					'KESEHATAN.employee': 115_000,
					'KESEHATAN.employer': 460_000,
					'PPH21.employee': 481_208
				}
			}
		]
	},

	// ─── Leavers and severance ──────────────────────────────────────────────────────────────────
	{
		id: 'ID-28-1',
		profile: 'ID',
		description:
			'Three PKWTT workers hired 5 January 2026 on Rp10,000,000 who leave on 23 January (19 of 31 days): efficiency to prevent loss (pesangon 1×), efficiency because of loss (0.5×), and resignation with a Rp2,000,000 uang pisah. January is the leaver’s last tax period.',
		citation: [
			SRC.PESANGON,
			SRC.PRORATE,
			SRC.PP68,
			SRC.LAST,
			'Paid 10,000,000 × 19/31 = 6,129,032.26; JHT 200,000 / 370,000; JKK 24,000; JKM 30,000; JP 61,290.32 → 61,290 / 122,580.65 → 122,581; Kesehatan 61,290 / 245,161.29 → 245,161',
			'Pesangon: prevent loss 10,000,000; loss 5,000,000; resignation none, uang pisah 2,000,000 as agreed; PP 68/2009 on each ≤ Rp50m: 0',
			'Last period: gross 6,129,032.26 + 24,000 + 30,000 + 245,161 = 6,428,193.26; biaya jabatan 5% = 321,409.66; − 200,000 − 61,290 − PTKP 54,000,000 < 0 → PPh 21 0 (the monthly TER would have withheld 1%)',
			'Net: 6,129,032.26 + 10,000,000 − 200,000 − 61,290 − 61,290 = 15,806,452.26; + 5,000,000 → 10,806,452.26; + 2,000,000 uang pisah → 7,806,452.26'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...(
				[
					['tono', 'REDUNDANCY', 'EFFICIENCY_PREVENT_LOSS'],
					['umar', 'REDUNDANCY', 'EFFICIENCY_ACTUAL_LOSS']
				] as const
			).flatMap(([ref, reason, cause]) => [
				...worker({
					ref,
					wage: 10_000_000,
					hire: '2026-01-05',
					exit: '2026-01-23',
					exit_ground: reason,
					exit_facts: departure(cause, { separation_wage_basis: 'MONTHLY' })
				}),
				adhoc(ref, 'PESANGON', '2026-01-23')
			]),
			...worker({
				ref: 'vina',
				wage: 10_000_000,
				hire: '2026-01-05',
				exit: '2026-01-23',
				exit_ground: 'RESIGNATION',
				exit_facts: departure('VOLUNTARY_RESIGNATION', {
					separation_pay_amount: 2_000_000,
					separation_pay_reference: 'PKB-PROBE-UANG-PISAH'
				})
			}),
			adhoc('vina', 'UANG_PISAH', '2026-01-23')
		],
		period: '2026-01',
		expected: (
			[
				['tono_job', { PESANGON: 10_000_000 }, 15_806_452.26],
				['umar_job', { PESANGON: 5_000_000 }, 10_806_452.26],
				['vina_job', { UANG_PISAH: 2_000_000 }, 7_806_452.26]
			] as const
		).map(([employment, pay, net]) => ({
			employment,
			lines: {
				...(pay as Lines),
				net,
				BASIC: 6_129_032.26,
				'JHT.employee': 200_000,
				'JHT.employer': 370_000,
				'JP.employee': 61_290,
				'JP.employer': 122_581,
				'JKK.employer': 24_000,
				'JKM.employer': 30_000,
				'KESEHATAN.employee': 61_290,
				'KESEHATAN.employer': 245_161
			}
		}))
	},
	{
		id: 'ID-25-1',
		profile: 'ID',
		description:
			'Severance above the PP 68/2009 0% band: PKWTT workers hired 5 January 2026 at Rp80,000,000 and Rp150,000,000 who leave on 23 January for efficiency to prevent loss (one month’s pesangon each).',
		citation: [
			SRC.PP68,
			SRC.PESANGON,
			SRC.LAST,
			SRC.PRORATE,
			'80,000,000: PP 68 5% × (80,000,000 − 50,000,000) = 1,500,000; paid 49,032,258.06; JHT 1,600,000 / 2,960,000; JP capped 105,474 / 210,948; JKK 192,000; JKM 240,000; Kesehatan capped 120,000 / 480,000; last period 49,944,258.06 − 500,000 − 1,600,000 − 105,474 − 54,000,000 < 0 → 0; net 49,032,258.06 + 80,000,000 − 1,600,000 − 105,474 − 120,000 − 1,500,000 = 125,706,784.06',
			'150,000,000: PP 68 5% × 50,000,000 + 15% × 50,000,000 = 10,000,000; paid 91,935,483.87; JHT 3,000,000 / 5,550,000; JKK 360,000; JKM 450,000; last period 93,225,483.87 − 500,000 − 3,000,000 − 105,474 − 54,000,000 = 35,620,009.87 → 35,620,000 × 5% = 1,781,000; net 91,935,483.87 + 150,000,000 − 3,000,000 − 105,474 − 120,000 − 1,781,000 − 10,000,000 = 226,929,009.87'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...(
				[
					['wawan', 80_000_000],
					['yusuf', 150_000_000]
				] as const
			).flatMap(([ref, wage]) => [
				...worker({
					ref,
					wage,
					hire: '2026-01-05',
					exit: '2026-01-23',
					exit_ground: 'REDUNDANCY',
					exit_facts: departure('EFFICIENCY_PREVENT_LOSS', { separation_wage_basis: 'MONTHLY' })
				}),
				adhoc(ref, 'PESANGON', '2026-01-23')
			])
		],
		period: '2026-01',
		expected: [
			{
				employment: 'wawan_job',
				lines: {
					PESANGON: 80_000_000,
					net: 125_706_784.06,
					'JHT.employee': 1_600_000,
					'JHT.employer': 2_960_000,
					'JP.employee': 105_474,
					'JP.employer': 210_948,
					'JKK.employer': 192_000,
					'JKM.employer': 240_000,
					'KESEHATAN.employee': 120_000,
					'KESEHATAN.employer': 480_000,
					'PPH21_FINAL_SEVERANCE.employee': 1_500_000
				}
			},
			{
				employment: 'yusuf_job',
				lines: {
					PESANGON: 150_000_000,
					net: 226_929_009.87,
					'JHT.employee': 3_000_000,
					'JHT.employer': 5_550_000,
					'JP.employee': 105_474,
					'JP.employer': 210_948,
					'JKK.employer': 360_000,
					'JKM.employer': 450_000,
					'KESEHATAN.employee': 120_000,
					'KESEHATAN.employer': 480_000,
					'PPH21.employee': 1_781_000,
					'PPH21_FINAL_SEVERANCE.employee': 10_000_000
				}
			}
		]
	},
	{
		id: 'ID-25-2',
		profile: 'ID',
		description:
			'Severance in the PP 68/2009 25% band: a PKWTT worker hired 5 January 2026 at Rp600,000,000 who leaves on 23 January for efficiency to prevent loss (one month’s pesangon).',
		citation: [
			SRC.PP68,
			SRC.PESANGON,
			SRC.LAST,
			SRC.PRORATE,
			SRC.JP,
			SRC.KES,
			'PP 68: 0% × 50,000,000 + 5% × 50,000,000 + 15% × 400,000,000 + 25% × 100,000,000 = 0 + 2,500,000 + 60,000,000 + 25,000,000 = 87,500,000',
			'Paid 600,000,000 × 19/31 = 367,741,935.48; JHT 12,000,000 / 22,200,000; JP at the January ceiling 10,547,400: 105,474 / 210,948; JKK 0.24% 1,440,000; JKM 1,800,000; Kesehatan capped 120,000 / 480,000',
			'Last period: 367,741,935.48 + 1,440,000 + 1,800,000 + 480,000 = 371,461,935.48; − biaya jabatan 500,000 (one month) − JHT 12,000,000 − JP 105,474 − PTKP 54,000,000 = 304,856,461.48 → 304,856,000; 5% × 60,000,000 + 15% × 190,000,000 + 25% × 54,856,000 = 3,000,000 + 28,500,000 + 13,714,000 = 45,214,000',
			'Net 367,741,935.48 + 600,000,000 − 12,000,000 − 105,474 − 120,000 − 45,214,000 − 87,500,000 = 822,802,461.48'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({
				ref: 'zainal',
				wage: 600_000_000,
				hire: '2026-01-05',
				exit: '2026-01-23',
				exit_ground: 'REDUNDANCY',
				exit_facts: departure('EFFICIENCY_PREVENT_LOSS', { separation_wage_basis: 'MONTHLY' })
			}),
			adhoc('zainal', 'PESANGON', '2026-01-23')
		],
		period: '2026-01',
		expected: [
			{
				employment: 'zainal_job',
				lines: {
					PESANGON: 600_000_000,
					net: 822_802_461.48,
					'JHT.employee': 12_000_000,
					'JHT.employer': 22_200_000,
					'JP.employee': 105_474,
					'JP.employer': 210_948,
					'JKK.employer': 1_440_000,
					'JKM.employer': 1_800_000,
					'KESEHATAN.employee': 120_000,
					'KESEHATAN.employer': 480_000,
					'PPH21.employee': 45_214_000,
					'PPH21_FINAL_SEVERANCE.employee': 87_500_000
				}
			}
		]
	},
	{
		id: 'ID-168-1',
		profile: 'ID',
		description:
			'A citizen who lives abroad and is not tax resident — present in Indonesia only for this 19-day engagement, with no residence or intention to reside there (UU PPh art.2(3)(a), (4)(a)) — hired 5 January 2026 on Rp10,000,000 and let go on 23 January for efficiency to prevent loss: the pesangon is PPh 26 at 20% with the wage, not PP 68/2009 final tax.',
		citation: [
			'PP 68/2009 art.1 angka 3: its Pegawai is a resident individual (https://jdih.kemnaker.go.id/asset/data_puu/PP_No_68_2009.pdf); UU 36/2008 art.26(1): 20% of the gross paid to a non-resident',
			SRC.PESANGON,
			SRC.PRORATE,
			'Gross 6,129,032.26 + JKK 24,000 + JKM 30,000 + Kesehatan 245,161 + pesangon 10,000,000 = 16,428,193.26 × 20% = 3,285,638.65 → 3,285,639; a citizen still pays JP (61,290 / 122,581)',
			'Net 6,129,032.26 + 10,000,000 − 200,000 − 61,290 − 61,290 − 3,285,639 = 12,520,813.26'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({
				ref: 'zaki',
				wage: 10_000_000,
				tax: 'NON_RESIDENT',
				hire: '2026-01-05',
				exit: '2026-01-23',
				exit_ground: 'REDUNDANCY',
				exit_facts: departure('EFFICIENCY_PREVENT_LOSS', { separation_wage_basis: 'MONTHLY' })
			}),
			adhoc('zaki', 'PESANGON', '2026-01-23')
		],
		period: '2026-01',
		expected: [
			{
				employment: 'zaki_job',
				lines: {
					PESANGON: 10_000_000,
					net: 12_520_813.26,
					'JHT.employee': 200_000,
					'JHT.employer': 370_000,
					'JP.employee': 61_290,
					'JP.employer': 122_581,
					'JKK.employer': 24_000,
					'JKM.employer': 30_000,
					'KESEHATAN.employee': 61_290,
					'KESEHATAN.employer': 245_161,
					'PPH26.employee': 3_285_639
				}
			}
		]
	},
	{
		id: 'ID-109-1',
		profile: 'ID',
		description:
			'A citizen PKWT of 1 August 2025 to 31 January 2026 at Rp8,000,000 ends by its term: six months’ compensation, 6/12 of a month’s wage; January is the last tax period.',
		citation: [
			'PP 35/2021 arts.15(1)–(4), 16(1)(b): PKWT compensation = service months ÷ 12 × one month’s wage for service under twelve months (https://jdih.kemnaker.go.id/asset/data_puu/PP352021.pdf)',
			SRC.PP68,
			SRC.LAST,
			'Compensation 8,000,000 × 6/12 = 4,000,000 (0% band); full January: JHT 160,000 / 296,000; JP 80,000 / 160,000; JKK 19,200; JKM 24,000; Kesehatan 80,000 / 320,000',
			'Last period: 8,363,200 − 418,160 − 160,000 − 80,000 − 54,000,000 < 0 → PPh 21 0; net 8,000,000 + 4,000,000 − 160,000 − 80,000 − 80,000 = 11,680,000'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({
				ref: 'arif',
				wage: 8_000_000,
				type: 'CONTRACT',
				hire: '2025-08-01',
				exit: '2026-01-31',
				exit_ground: 'END_OF_CONTRACT',
				exit_facts: departure(null)
			}),
			adhoc('arif', 'PKWT_COMPENSATION', '2026-01-31')
		],
		period: '2026-01',
		expected: [
			{
				employment: 'arif_job',
				lines: {
					PKWT_COMPENSATION: 4_000_000,
					net: 11_680_000,
					'JHT.employee': 160_000,
					'JHT.employer': 296_000,
					'JP.employee': 80_000,
					'JP.employer': 160_000,
					'JKK.employer': 19_200,
					'JKM.employer': 24_000,
					'KESEHATAN.employee': 80_000,
					'KESEHATAN.employer': 320_000
				}
			}
		]
	},

	// ─── THR, bonus, deductions ─────────────────────────────────────────────────────────────────
	{
		id: 'ID-13-1',
		profile: 'ID',
		description:
			'March 2026 (Idul Fitri 21 March): a Muslim worker hired 1 September 2025 on Rp12,000,000 is owed a six-twelfths THR, paid whole; a colleague’s Rp20,000,000 annual bonus. TER on the whole month’s gross, no BPJS on either.',
		citation: [
			'Permenaker 6/2016 arts.2–3, 5(1): THR after one continuous month; under twelve months, service months ÷ 12 × one month’s wage (basic + fixed allowances) (https://jdih.kemnaker.go.id/asset/data_puu/permenaker_6_2016.pdf); SE M/3/HK.04.00/III/2026 item 7: paid in full, no instalments (https://jdih.kemnaker.go.id/asset/data_puu/2026senaker003.pdf)',
			'THR and bonus are non-wage income, outside the BPJS wage: PP 36/2021 art.8 (https://jdih.kemnaker.go.id/asset/data_puu/PP362021.pdf)',
			SRC.TER,
			SRC.JP,
			'THR 12,000,000 × 6/12 = 6,000,000; BPJS on 12,000,000: JHT 240,000 / 444,000; JP on 11,086,300 110,863 / 221,726; JKK 28,800; JKM 36,000; Kesehatan 120,000 / 480,000',
			'THR worker: TER gross 12,000,000 + 6,000,000 + 28,800 + 36,000 + 480,000 = 18,544,800 at TER A 8% = 1,483,584; net 18,000,000 − 240,000 − 110,863 − 120,000 − 1,483,584 = 16,045,553',
			'Bonus worker: TER gross 32,544,800 at 14% (32,400,001–35,400,000) = 4,556,272; net 32,000,000 − 470,863 − 4,556,272 = 26,972,865'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'bagus', wage: 12_000_000, hire: '2025-09-01', religion: 'ISLAM' }),
			adhoc('bagus', 'THR', '2026-03-10'),
			...worker({ ref: 'cici', wage: 12_000_000 }),
			adhoc('cici', 'BONUS_THR', '2026-03-10', 20_000_000)
		],
		period: '2026-03',
		expected: (
			[
				['bagus_job', { THR: 6_000_000 }, 1_483_584, 16_045_553],
				['cici_job', { BONUS_THR: 20_000_000 }, 4_556_272, 26_972_865]
			] as const
		).map(([employment, pay, pph21, net]) => ({
			employment,
			lines: {
				...(pay as Lines),
				net,
				'JHT.employee': 240_000,
				'JHT.employer': 444_000,
				'JP.employee': 110_863,
				'JP.employer': 221_726,
				'JKK.employer': 28_800,
				'JKM.employer': 36_000,
				'KESEHATAN.employee': 120_000,
				'KESEHATAN.employer': 480_000,
				'PPH21.employee': pph21
			}
		}))
	},
	{
		id: 'ID-06-1',
		profile: 'ID',
		description:
			'A Rp1,000,000 art.63 deduction (a wage advance), well inside half of the wage payment, February 2026: statutory charges are untouched.',
		citation: [
			'PP 36/2021 arts.63–65: art.63(1) deductions at most 50% of each wage payment; state and social-security contributions are outside the cap (https://jdih.kemnaker.go.id/asset/data_puu/PP362021.pdf)',
			'ID-14-1 figures; net 9,338,650 − 1,000,000 = 8,338,650'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'dodi', wage: 10_000_000 }),
			adhoc('dodi', 'DEDUCTION', '2026-02-20', 1_000_000)
		],
		period: '2026-02',
		expected: [
			{
				employment: 'dodi_job',
				lines: {
					net: 8_338_650,
					DEDUCTION: 1_000_000,
					'JHT.employee': 200_000,
					'JHT.employer': 370_000,
					'JP.employee': 100_000,
					'JP.employer': 200_000,
					'JKK.employer': 24_000,
					'JKM.employer': 30_000,
					'KESEHATAN.employee': 100_000,
					'KESEHATAN.employer': 400_000,
					'PPH21.employee': 261_350
				}
			}
		]
	},

	// ─── Overtime, rest, holidays ───────────────────────────────────────────────────────────────
	{
		id: 'ID-09-1',
		profile: 'ID',
		description:
			'Overtime on Rp8,650,000 (Rp50,000 an hour), February 2026, five-day week: two hours past an ordinary Monday, three hours on a Saturday rest day, ten on a Sunday rest day, and a whole shift on the 17 February national holiday.',
		citation: [
			'PP 35/2021 art.31(1): ordinary day, first hour 1.5×, further hours 2×; art.31(3) five-day week: rest day or holiday, first 8 hours 2×, 9th 3×, 10th–12th 4×; art.32(2): the hour is 1/173 of the monthly wage — 8,650,000 ÷ 173 = 50,000; art.26(2): rest-day and holiday work outside the 4 h/18 h ceilings (https://jdih.kemnaker.go.id/peraturan/detail/1723/peraturan-pemerintah-nomor-35-tahun-2021)',
			'17 February 2026 (Tahun Baru Imlek) is a national holiday: SKB 2026 (tracker ID-120, https://jdih.kemnaker.go.id/asset/data_puu/2025kb002.pdf)',
			'Mon 2 Feb 09:00–12:00 + 13:00–20:00 = 10 h, 2 over: 75,000 + 100,000; Sat 7 Feb 09:00–12:00 = 3 h × 2 = 300,000; Sun 8 Feb 09:00–13:00 + 13:30–19:30 = 10 h: 8 × 2 + 3 + 4 = 23 hours’ pay = 1,150,000; Tue 17 Feb 09:00–12:00 + 13:00–18:00 = 8 h × 2 = 800,000; total 2,425,000',
			SRC.TER,
			'BPJS on the wage only: JHT 173,000 / 320,050; JP 86,500 / 173,000; JKK 20,760; JKM 25,950; Kesehatan 86,500 / 346,000; TER gross 8,650,000 + 2,425,000 + 20,760 + 25,950 + 346,000 = 11,467,710 at TER A 3.5% = 401,369.85 → 401,370',
			'Gross 11,075,000; net 11,075,000 − 173,000 − 86,500 − 86,500 − 401,370 = 10,327,630'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			{
				collection: 'jurisdiction_holidays',
				values: {
					company_id: '@company',
					date: '2026-02-17',
					name: 'Tahun Baru Imlek 2577 Kongzili',
					kind: 'PUBLIC_HOLIDAY',
					given_to: 'EVERYONE',
					source: 'SKB 2026 (probe)',
					published_at: '2026-01-02T00:00:00.000Z'
				}
			},
			...worker({ ref: 'eka', wage: 8_650_000 }),
			ordered(punch('eka', '2026-02-02', ['09:00', '12:00'], ['13:00', '20:00']), 2),
			ordered(punch('eka', '2026-02-07', ['09:00', '12:00']), 3),
			ordered(punch('eka', '2026-02-08', ['09:00', '13:00'], ['13:30', '19:30']), 10),
			ordered(punch('eka', '2026-02-17', ['09:00', '12:00'], ['13:00', '18:00']), 8)
		],
		period: '2026-02',
		expected: [
			{
				employment: 'eka_job',
				lines: {
					gross: 11_075_000,
					net: 10_327_630,
					'JHT.employee': 173_000,
					'JHT.employer': 320_050,
					'JP.employee': 86_500,
					'JP.employer': 173_000,
					'JKK.employer': 20_760,
					'JKM.employer': 25_950,
					'KESEHATAN.employee': 86_500,
					'KESEHATAN.employer': 346_000,
					'PPH21.employee': 401_370
				}
			}
		]
	},
	{
		id: 'ID-10-1',
		profile: 'ID',
		description:
			'Five continuous hours on a Saturday rest day with no break taken, Rp8,650,000: under the tracker’s owner default the minutes worked through the owed break are worked time and paid.',
		citation: [
			'UU 13/2003 art.79(2)(a): a break of at least half an hour after four continuous hours, not counted as working time when taken (https://jdih.kemnaker.go.id/peraturan/detail/27/undang-undang-nomor-13-tahun-2003); tracker ID-10 owner default 2026-09-28: a break owed and not taken is worked time, paid, and nothing is deducted',
			'PP 35/2021 art.31(3): rest-day hours within the first eight at 2×: 5 × 2 × 50,000 = 500,000',
			'TER gross 8,650,000 + 500,000 + 20,760 + 25,950 + 346,000 = 9,542,710 at TER A 1.75% = 166,997.43 → 166,997; net 9,150,000 − 173,000 − 86,500 − 86,500 − 166,997 = 8,637,003'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'fitri', wage: 8_650_000 }),
			ordered(punch('fitri', '2026-02-14', ['09:00', '14:00']), 5)
		],
		period: '2026-02',
		expected: [
			{
				employment: 'fitri_job',
				lines: {
					gross: 9_150_000,
					net: 8_637_003,
					'JHT.employee': 173_000,
					'JHT.employer': 320_050,
					'JP.employee': 86_500,
					'JP.employer': 173_000,
					'JKK.employer': 20_760,
					'JKM.employer': 25_950,
					'KESEHATAN.employee': 86_500,
					'KESEHATAN.employer': 346_000,
					'PPH21.employee': 166_997
				}
			}
		]
	},

	// ─── Paid leave heads: the month is paid whole ──────────────────────────────────────────────
	...(
		[
			[
				'ID-11-1',
				'Two days of menstrual leave (3–4 February 2026), paid.',
				'UU 13/2003 arts.81(1), 93(2)(b): a woman in pain on the first two days of menstruation is not obliged to work and is paid (https://jdih.kemnaker.go.id/peraturan/detail/27/undang-undang-nomor-13-tahun-2003)',
				'FEMALE',
				leave('x', 'MENSTRUAL_LEAVE', '2026-02-03', '2026-02-04'),
				'2026-02'
			],
			[
				'ID-12-1',
				'Three days of marriage leave for the worker’s own marriage (9–11 February 2026), paid.',
				'UU 13/2003 art.93(4)(a) as amended: marriage, three days paid (https://jdih.kemnaker.go.id/peraturan/detail/27/undang-undang-nomor-13-tahun-2003)',
				'MALE',
				leave('x', 'MARRIAGE_LEAVE', '2026-02-09', '2026-02-11', {
					facts: {
						event_kind: 'MARRIAGE',
						event_relationship: 'SELF',
						event_date: '2026-02-09'
					}
				}),
				'2026-02'
			],
			[
				'ID-11-2',
				'Two days of medical leave (3–4 February 2026), the first month of illness, paid.',
				'UU 13/2003 arts.93(2)(a), 93(3)(a): a sick worker is paid 100% of the wage for the first four months (https://jdih.kemnaker.go.id/asset/data_puu/peraturan_file_13.pdf, read 2026-09-30)',
				'MALE',
				// The catalogue asks for the doctor's letter from day one (art.153(1)(a): sick "menurut
				// keterangan dokter").
				{
					...leave('x', 'MEDICAL_LEAVE', '2026-02-03', '2026-02-04'),
					files: { certificate_file: 'medical-certificate.pdf' }
				},
				'2026-02'
			],
			[
				'ID-11-3',
				'Five days of religious-duty leave (2–6 February 2026), paid.',
				'UU 13/2003 art.93(2)(e): the wage is paid while the worker performs a duty the religion commands (https://jdih.kemnaker.go.id/asset/data_puu/peraturan_file_13.pdf, read 2026-09-30)',
				'MALE',
				leave('x', 'RELIGIOUS_DUTY_LEAVE', '2026-02-02', '2026-02-06', {
					facts: {
						event_kind: 'RELIGIOUS_DUTY',
						event_date: '2026-02-02'
					}
				}),
				'2026-02'
			],
			[
				'ID-12-2',
				'Two days of leave when the worker’s wife gives birth (18–19 February 2026), paid.',
				'UU 13/2003 arts.93(2)(c), 93(4)(e): the wife gives birth or miscarries, two days paid (https://jdih.kemnaker.go.id/asset/data_puu/peraturan_file_13.pdf, read 2026-09-30)',
				'MALE',
				leave('x', 'PATERNITY_LEAVE', '2026-02-18', '2026-02-19', {
					facts: {
						event_kind: 'BIRTH',
						event_relationship: 'CHILD',
						event_date: '2026-02-18'
					}
				}),
				'2026-02'
			],
			[
				'ID-12-3',
				'Two days of leave for the marriage of the worker’s child (23–24 February 2026), paid.',
				'UU 13/2003 arts.93(2)(c), 93(4)(b): the worker marries off a child, two days paid (https://jdih.kemnaker.go.id/asset/data_puu/peraturan_file_13.pdf, read 2026-09-30)',
				'MALE',
				leave('x', 'CHILD_MARRIAGE_LEAVE', '2026-02-23', '2026-02-24', {
					facts: {
						event_kind: 'MARRIAGE',
						event_relationship: 'CHILD',
						event_date: '2026-02-23'
					}
				}),
				'2026-02'
			],
			[
				'ID-12-4',
				'Two days of leave for the circumcision of the worker’s child (25–26 February 2026), paid.',
				'UU 13/2003 arts.93(2)(c), 93(4)(c): the worker has a child circumcised, two days paid (https://jdih.kemnaker.go.id/asset/data_puu/peraturan_file_13.pdf, read 2026-09-30)',
				'MALE',
				leave('x', 'CHILD_CIRCUMCISION_LEAVE', '2026-02-25', '2026-02-26', {
					facts: {
						event_kind: 'CIRCUMCISION',
						event_relationship: 'CHILD',
						event_date: '2026-02-25'
					}
				}),
				'2026-02'
			],
			[
				'ID-12-5',
				'Two days of leave for the baptism of the worker’s child (12–13 February 2026), paid.',
				'UU 13/2003 arts.93(2)(c), 93(4)(d): the worker has a child baptised, two days paid (https://jdih.kemnaker.go.id/asset/data_puu/peraturan_file_13.pdf, read 2026-09-30)',
				'MALE',
				leave('x', 'CHILD_BAPTISM_LEAVE', '2026-02-12', '2026-02-13', {
					facts: {
						event_kind: 'BAPTISM',
						event_relationship: 'CHILD',
						event_date: '2026-02-12'
					}
				}),
				'2026-02'
			],
			[
				'ID-12-6',
				'Two days of bereavement leave on the death of the worker’s parent (5–6 February 2026), paid.',
				'UU 13/2003 arts.93(2)(c), 93(4)(f): a spouse, parent, parent-in-law, child or child-in-law dies, two days paid (https://jdih.kemnaker.go.id/asset/data_puu/peraturan_file_13.pdf, read 2026-09-30)',
				'MALE',
				leave('x', 'BEREAVEMENT_LEAVE', '2026-02-05', '2026-02-06', {
					facts: {
						event_kind: 'DEATH',
						event_relationship: 'PARENT',
						event_date: '2026-02-05'
					}
				}),
				'2026-02'
			],
			[
				'ID-12-7',
				'One day of leave on the death of a member of the worker’s household (20 February 2026), paid.',
				'UU 13/2003 arts.93(2)(c), 93(4)(g): another member of the household dies, one day paid (https://jdih.kemnaker.go.id/asset/data_puu/peraturan_file_13.pdf, read 2026-09-30)',
				'MALE',
				leave('x', 'BEREAVEMENT_HOUSEHOLD_LEAVE', '2026-02-20', '2026-02-20', {
					facts: {
						event_kind: 'DEATH',
						event_relationship: 'HOUSEHOLD',
						event_date: '2026-02-20'
					}
				}),
				'2026-02'
			],
			[
				'ID-12-8',
				'Miscarriage rest of one and a half months from 2 February 2026 (to 18 March; the February part), paid in full.',
				'UU 13/2003 arts.82(2), 84: a worker who miscarries rests 1.5 months and is paid the full wage (https://jdih.kemnaker.go.id/asset/data_puu/peraturan_file_13.pdf, read 2026-09-30); UU 4/2024 art.4(3)(b)',
				'FEMALE',
				// art.82(2): the rest is "sesuai dengan surat keterangan dokter kandungan atau bidan".
				// An entry settles whole in the period holding all its days, so the February part is
				// its own entry (as ID-126-1).
				{
					...leave('x', 'MISCARRIAGE_LEAVE', '2026-02-02', '2026-02-28', {
						facts: {
							event_kind: 'MISCARRIAGE',
							event_date: '2026-02-02'
						}
					}),
					files: { certificate_file: 'miscarriage-certificate.pdf' }
				},
				'2026-02'
			],
			[
				'ID-126-1',
				'Maternity leave from a birth on 2 February 2026 (the February part of the leave), paid in full in its first months.',
				'UU 4/2024 arts.4(3)(a), 5(2): maternity leave at least three months, full wage for the first four months (https://jdih.kemnaker.go.id/asset/data_puu/2024uu004.pdf)',
				'FEMALE',
				leave('x', 'MATERNITY_LEAVE', '2026-02-02', '2026-02-28', {
					facts: {
						event_kind: 'BIRTH',
						event_date: '2026-02-02'
					}
				}),
				'2026-02'
			],
			[
				'ID-77-1',
				'One work-from-home day (Wednesday 8 April 2026) under the April 2026 circular: wages continue and no leave is taken.',
				'SE Menaker M/6/HK.04/III/2026: where one WFH day a week is adopted, wages and rights continue (tracker ID-77)',
				'MALE',
				leave('x', 'WORK_FROM_HOME', '2026-04-08', '2026-04-08'),
				'2026-04'
			]
		] as const
	).map(([id, what, law, gender, entry, period]): ProbeCase => ({
		id,
		profile: 'ID',
		description: `${what} Rp10,000,000, DKI Jakarta, group I: nothing is deducted.`,
		citation: [
			law,
			SRC.TER,
			'ID-14-1 figures (JP under either ceiling): TER gross 10,454,000 at 2.5% = 261,350; net 9,338,650'
		],
		company: company(),
		inputs: [...week('2025-06-02'), ...worker({ ref: 'x', wage: 10_000_000, gender }), entry],
		period,
		expected: [
			{
				employment: 'x_job',
				lines: {
					gross: 10_000_000,
					net: 9_338_650,
					BASIC: 10_000_000,
					'JHT.employee': 200_000,
					'JHT.employer': 370_000,
					'JP.employee': 100_000,
					'JP.employer': 200_000,
					'JKK.employer': 24_000,
					'JKM.employer': 30_000,
					'KESEHATAN.employee': 100_000,
					'KESEHATAN.employer': 400_000,
					'PPH21.employee': 261_350
				}
			}
		]
	})),

	// ─── Round 9 (2026-09-30): composition, deduction ceiling, one year of service, causes ─────
	{
		id: 'ID-02-1',
		profile: 'ID',
		description:
			'DKI Jakarta, basic Rp5,000,000 plus a fixed house allowance of Rp2,000,000, February 2026: the whole (7,000,000) is above the UMP but basic is 71.4% of basic plus fixed allowances, under 75% — refused.',
		citation: [
			'PP 36/2021 art.7(2): where the wage is basic plus fixed allowances, basic is at least 75% of the sum (https://jdih.kemnaker.go.id/asset/data_puu/PP362021.pdf; signed copy https://peraturan.bpk.go.id/Download/154587/PP%20Nomor%2036%20Tahun%202021.pdf)',
			'5,000,000 ÷ 7,000,000 = 71.43% < 75%'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({
				ref: 'comp',
				wage: 5_000_000,
				allowances: [
					{ catalogue_id: '@law:allowance_catalogue:HOUSE_ALLOWANCE', amount: 2_000_000 }
				]
			})
		],
		period: '2026-02',
		refused: "WAGE_TERMS_RULE: P-ID-comp's contract does not satisfy the version's wage rule",
		expected: []
	},
	{
		id: 'ID-02-2',
		profile: 'ID',
		description:
			'DKI Jakarta, basic Rp6,000,000 plus a fixed house allowance of Rp2,000,000, February 2026: basic is exactly 75% of the whole, lawful; every BPJS scheme and PPh 21 on the 8,000,000.',
		citation: [
			'PP 36/2021 art.7(2): basic at least 75% of basic plus fixed allowances — 6,000,000 ÷ 8,000,000 = 75% (https://jdih.kemnaker.go.id/asset/data_puu/PP362021.pdf)',
			'The BPJS wage is basic plus fixed allowances: PP 44/2015 art.19, PP 46/2015 art.17, Perpres 82/2018 art.30 (tracker ID-14, ID-19)',
			SRC.JHT,
			SRC.JP,
			SRC.JKK,
			SRC.KES,
			SRC.TER,
			'On 8,000,000: JHT 160,000 / 296,000; JP 80,000 / 160,000; JKK 19,200; JKM 24,000; Kesehatan 80,000 / 320,000; TER gross 8,000,000 + 19,200 + 24,000 + 320,000 = 8,363,200, TER A 7,500,001–8,550,000 at 1.5% = 125,448; net 8,000,000 − 160,000 − 80,000 − 80,000 − 125,448 = 7,554,552'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({
				ref: 'comp2',
				wage: 6_000_000,
				allowances: [
					{ catalogue_id: '@law:allowance_catalogue:HOUSE_ALLOWANCE', amount: 2_000_000 }
				]
			})
		],
		period: '2026-02',
		expected: [
			{
				employment: 'comp2_job',
				lines: {
					gross: 8_000_000,
					net: 7_554_552,
					BASIC: 6_000_000,
					'JHT.employee': 160_000,
					'JHT.employer': 296_000,
					'JP.employee': 80_000,
					'JP.employer': 160_000,
					'JKK.employer': 19_200,
					'JKM.employer': 24_000,
					'KESEHATAN.employee': 80_000,
					'KESEHATAN.employer': 320_000,
					'PPH21.employee': 125_448
				}
			}
		]
	},
	{
		id: 'ID-06-2',
		profile: 'ID',
		description:
			'A Rp5,000,001 art.63 deduction (a wage advance) on a Rp10,000,000 wage payment, February 2026: a rupiah over half of the payment — refused, not shortened.',
		citation: [
			'PP 36/2021 art.65: the art.63(1) deductions total at most 50% of each wage payment; contributions to the state and social security are outside art.63 (art.64) (https://jdih.kemnaker.go.id/asset/data_puu/PP362021.pdf)',
			'50% × 10,000,000 = 5,000,000; 5,000,001 exceeds it by 1'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'dedi', wage: 10_000_000 }),
			adhoc('dedi', 'DEDUCTION', '2026-02-20', 5_000_001)
		],
		period: '2026-02',
		refused: 'DEDUCTION_CEILING_EXCEEDED: P-ID-dedi: deductions exceed the lawful ceiling by 1 IDR',
		expected: []
	},
	{
		id: 'ID-06-3',
		profile: 'ID',
		description:
			'A Rp5,000,000 art.63 deduction on a Rp10,000,000 wage payment, February 2026: exactly half, lawful; the employee’s BPJS shares and PPh 21 sit outside the cap.',
		citation: [
			'PP 36/2021 arts.63–65: at most 50% of each wage payment; state and social-security contributions are not counted (https://jdih.kemnaker.go.id/asset/data_puu/PP362021.pdf)',
			'ID-14-1 figures; net 9,338,650 − 5,000,000 = 4,338,650'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'dedo', wage: 10_000_000 }),
			adhoc('dedo', 'DEDUCTION', '2026-02-20', 5_000_000)
		],
		period: '2026-02',
		expected: [
			{ employment: 'dedo_job', lines: { ...TEN_MILLION, net: 4_338_650, DEDUCTION: 5_000_000 } }
		]
	},
	{
		id: 'ID-07-1',
		profile: 'ID',
		description:
			'A worker hired 6 January 2025 (over one year of service) on Rp10,000,000 with no wage-scale grade on the terms, February 2026: paid (the ID-14-1 slip) with a warning to record the company scale, grade notice and basic minimum.',
		citation: [
			'PP 36/2021 arts.20–21, 24 as amended by PP 49/2025 art.21: from one year of service the wage follows the company wage structure and scale, notified to each worker (https://jdih.kemnaker.go.id/asset/data_puu/2025pp0049.pdf; https://jdih.kemnaker.go.id/asset/data_puu/PP362021.pdf)',
			'PP 36/2021 art.79(1): breach of art.21(1)–(2) draws administrative sanctions, not a bar on paying wages (tracker ID-07 lawful default: warn)',
			'ID-14-1 figures: TER gross 10,454,000 at 2.5% = 261,350; net 9,338,650'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'vet0', wage: 10_000_000, hire: VETERAN_HIRE })
		],
		period: '2026-02',
		warnings: [
			'WAGE_CONTRACT_RULE: P-ID-vet0: record the dated company wage structure.*paid without the grade check'
		],
		expected: [{ employment: 'vet0_job', lines: { ...TEN_MILLION, BASIC: 10_000_000 } }]
	},
	{
		id: 'ID-07-2',
		profile: 'ID',
		description:
			'A worker over one year of service on basic Rp10,000,000 whose recorded grade minimum is Rp10,500,000, February 2026: basic below the company scale — refused.',
		citation: [
			'PP 36/2021 arts.20–21, 24 as amended by PP 49/2025 art.21: the basic wage is at least the basic-wage minimum of the worker’s grade (https://jdih.kemnaker.go.id/asset/data_puu/2025pp0049.pdf)'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({
				ref: 'vet1',
				wage: 10_000_000,
				hire: VETERAN_HIRE,
				terms_facts: scale(10_500_000)
			}),
			scaleEvidence('vet1')
		],
		period: '2026-02',
		refused:
			"WAGE_CONTRACT_RULE: P-ID-vet1: basic wage is below the company's wage-scale grade minimum",
		expected: []
	},
	{
		id: 'ID-11-4',
		profile: 'ID',
		description:
			'Two days of annual leave (3–4 February 2026) for a worker past twelve months of service (hired 6 January 2025, grade recorded), Rp10,000,000: paid, nothing deducted.',
		citation: [
			'UU 13/2003 art.79(3) as amended by UU 6/2023: at least 12 working days of annual leave after 12 continuous months; art.84: the leave is paid (https://jdih.kemnaker.go.id/asset/data_puu/peraturan_file_13.pdf)',
			'PP 36/2021 arts.20, 24 / PP 49/2025 art.21: the grade and its evidence on the terms (ID-07)',
			SRC.TER,
			'ID-14-1 figures: TER gross 10,454,000 at 2.5% = 261,350; net 9,338,650'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({
				ref: 'vet2',
				wage: 10_000_000,
				hire: VETERAN_HIRE,
				terms_facts: scale(10_000_000)
			}),
			scaleEvidence('vet2'),
			leave('vet2', 'ANNUAL_LEAVE', '2026-02-03', '2026-02-04')
		],
		period: '2026-02',
		expected: [{ employment: 'vet2_job', lines: { ...TEN_MILLION, BASIC: 10_000_000 } }]
	},
	{
		id: 'ID-54-4',
		profile: 'ID',
		description:
			'DKI Jakarta KBLI 10437, a worker past one year of service (hired 6 January 2025, grade recorded) paid the UMP Rp5,729,876, February 2026: the 2026 UMSP binds only workers under one year, so the run commits.',
		citation: [
			'DKI Kep.33/2026 dictum KETIGA: the UMSP applies to workers with under one year of service (https://jdih.jakarta.go.id/dokumenPeraturanDirectory/0031/2026KEPGUB003133.pdf); from one year the company wage scale applies: PP 36/2021 art.24, PP 49/2025 art.21',
			SRC.JHT,
			SRC.JP,
			SRC.JKK,
			SRC.KES,
			SRC.TER,
			'ID-94-1 figures at 5,729,876: JHT 114,598 / 212,005; JP 57,299 / 114,598; JKK 13,752; JKM 17,190; Kesehatan 57,299 / 229,195; TER gross 5,990,013 at 0.75% = 44,925; net 5,455,755'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({
				ref: 'vet3',
				wage: 5_729_876,
				hire: VETERAN_HIRE,
				sector: '10437',
				terms_facts: scale(5_729_876)
			}),
			scaleEvidence('vet3')
		],
		period: '2026-02',
		expected: [
			{
				employment: 'vet3_job',
				lines: {
					net: 5_455_755,
					'JHT.employee': 114_598,
					'JHT.employer': 212_005,
					'JP.employee': 57_299,
					'JP.employer': 114_598,
					'JKK.employer': 13_752,
					'JKM.employer': 17_190,
					'KESEHATAN.employee': 57_299,
					'KESEHATAN.employer': 229_195,
					'PPH21.employee': 44_925
				}
			}
		]
	},
	{
		id: 'ID-13-2',
		profile: 'ID',
		description:
			'March 2026 (Idul Fitri 21 March): a Muslim worker hired 6 January 2025 (fourteen months, grade recorded) on Rp12,000,000 is owed one whole month’s wage as THR.',
		citation: [
			'Permenaker 6/2016 art.3(1)(a): twelve months of continuous service or more, one month’s wage (https://jdih.kemnaker.go.id/asset/data_puu/permenaker_6_2016.pdf)',
			'THR is non-wage income, outside the BPJS wage: PP 36/2021 art.8',
			SRC.TER,
			SRC.JP,
			'BPJS on 12,000,000 (ID-13-1): JHT 240,000 / 444,000; JP on 11,086,300 110,863 / 221,726; JKK 28,800; JKM 36,000; Kesehatan 120,000 / 480,000',
			'TER gross 12,000,000 + 12,000,000 + 28,800 + 36,000 + 480,000 = 24,544,800, TER A 24,150,001–26,450,000 at 10% = 2,454,480; net 24,000,000 − 240,000 − 110,863 − 120,000 − 2,454,480 = 21,074,657'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({
				ref: 'vet4',
				wage: 12_000_000,
				hire: VETERAN_HIRE,
				religion: 'ISLAM',
				terms_facts: scale(12_000_000)
			}),
			scaleEvidence('vet4'),
			adhoc('vet4', 'THR', '2026-03-10')
		],
		period: '2026-03',
		expected: [
			{
				employment: 'vet4_job',
				lines: {
					THR: 12_000_000,
					net: 21_074_657,
					'JHT.employee': 240_000,
					'JHT.employer': 444_000,
					'JP.employee': 110_863,
					'JP.employer': 221_726,
					'JKK.employer': 28_800,
					'JKM.employer': 36_000,
					'KESEHATAN.employee': 120_000,
					'KESEHATAN.employer': 480_000,
					'PPH21.employee': 2_454_480
				}
			}
		]
	},
	{
		id: 'ID-28-2',
		profile: 'ID',
		description:
			'Seven PKWTT workers hired 5 January 2026 on Rp10,000,000 who leave on 23 January (19 of 31 days), each on another PP 35/2021 cause: closure because of loss (0.5×), closure not because of loss (1×), force majeure without closure (0.75×), bankruptcy (0.5×), the worker’s request for the employer’s misconduct (1×), retirement (1.75×) and death (2×).',
		citation: [
			'PP 35/2021 art.40(2)(a): under one year, one month’s wage; art.44(1) 0.5× and (2) 1×; art.45(2) 0.75×; art.47 0.5×; art.48 1×; art.56 1.75×; art.57 2× (signed text read 2026-09-30, https://jdih.kemnaker.go.id/asset/data_puu/PP352021.pdf)',
			SRC.PRORATE,
			SRC.PP68,
			SRC.LAST,
			'ID-28-1 month: paid 6,129,032.26; JHT 200,000 / 370,000; JKK 24,000; JKM 30,000; JP 61,290 / 122,581; Kesehatan 61,290 / 245,161; last-period PPh 21 0; net before severance 6,129,032.26 − 200,000 − 61,290 − 61,290 = 5,806,452.26',
			'Pesangon ≤ Rp50m, PP 68/2009 0%: 5,000,000 → net 10,806,452.26; 10,000,000 → 15,806,452.26; 7,500,000 → 13,306,452.26; 17,500,000 → 23,306,452.26; 20,000,000 → 25,806,452.26'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...(
				[
					['cl', 'REDUNDANCY', 'CLOSURE_LOSS'],
					['cn', 'REDUNDANCY', 'CLOSURE_NO_LOSS'],
					['fm', 'REDUNDANCY', 'FORCE_MAJEURE_NO_CLOSURE'],
					['bk', 'REDUNDANCY', 'BANKRUPTCY'],
					['em', 'UNILATERAL', 'EMPLOYEE_REQUEST_EMPLOYER_MISCONDUCT'],
					['rt', 'RETIREMENT', 'RETIREMENT'],
					['dt', 'DEATH', 'DEATH']
				] as const
			).flatMap(([ref, reason, cause]) => [
				...worker({
					ref,
					wage: 10_000_000,
					hire: '2026-01-05',
					exit: '2026-01-23',
					exit_ground: reason,
					exit_facts: departure(cause, { separation_wage_basis: 'MONTHLY' })
				}),
				adhoc(ref, 'PESANGON', '2026-01-23')
			])
		],
		period: '2026-01',
		expected: (
			[
				['cl_job', 5_000_000],
				['cn_job', 10_000_000],
				['fm_job', 7_500_000],
				['bk_job', 5_000_000],
				['em_job', 10_000_000],
				['rt_job', 17_500_000],
				['dt_job', 20_000_000]
			] as const
		).map(([employment, pesangon]) => ({
			employment,
			lines: {
				PESANGON: pesangon,
				net: Math.round((5_806_452.26 + pesangon) * 100) / 100,
				BASIC: 6_129_032.26,
				'JHT.employee': 200_000,
				'JHT.employer': 370_000,
				'JP.employee': 61_290,
				'JP.employer': 122_581,
				'JKK.employer': 24_000,
				'JKM.employer': 30_000,
				'KESEHATAN.employee': 61_290,
				'KESEHATAN.employer': 245_161
			}
		}))
	},

	// ─── Minimum wage: a worker paid exactly the binding floor is lawful and priced ─────────────
	...floorCases()
];

/**
 * A worker paid exactly the floor that binds the workplace and sector: the run commits (a rupiah less refuses,
 * UU 13/2003 art.88E(2)) and every charge is on that wage. Each figure is the decree's, read from the tracker row's
 * cited source (or the signed PDF named). Figures per worker: [ref, worksite, KBLI, edition, floor, lines].
 */
function floorCases(): ProbeCase[] {
	type Floor = {
		ref: string;
		worksite: string;
		sector: string;
		edition?: '2020' | '2025';
		wage: number;
		/** JHT e/r, JP e/r, JKK, JKM, Kesehatan e/r, PPh 21. */
		c: readonly [number, number, number, number, number, number, number, number, number];
	};
	const lines = ({ c, wage }: Floor): Lines => ({
		net: Math.round((wage - c[0] - c[2] - c[6] - c[8]) * 100) / 100,
		'JHT.employee': c[0],
		'JHT.employer': c[1],
		'JP.employee': c[2],
		'JP.employer': c[3],
		'JKK.employer': c[4],
		'JKM.employer': c[5],
		'KESEHATAN.employee': c[6],
		'KESEHATAN.employer': c[7],
		...(c[8] > 0 ? { 'PPH21.employee': c[8] } : {})
	});
	const floorCase = (
		id: string,
		description: string,
		source: readonly string[],
		period: string,
		region: string,
		floors: readonly Floor[],
		facts: Row = {}
	): ProbeCase => ({
		id,
		profile: 'ID',
		description,
		citation: [
			...source,
			'Floor comparison on basic + fixed allowances, below it refused: PP 36/2021 arts.7(2), 23–24 (https://jdih.kemnaker.go.id/asset/data_puu/PP362021.pdf); UU 13/2003 art.88E(2) as inserted by UU 6/2023; sector floors bind workers under one year: PP 49/2025 arts.35A–35J',
			SRC.JHT,
			SRC.JP,
			SRC.JKK,
			SRC.KES,
			SRC.TER,
			...floors.map(
				(f) =>
					`${f.ref} at ${f.wage.toLocaleString('en-US')} (${f.worksite}, KBLI ${f.edition ?? '2020'} ${f.sector}): JHT ${f.c[0]} / ${f.c[1]}, JP ${f.c[2]} / ${f.c[3]}, JKK 0.24% ${f.c[4]}, JKM ${f.c[5]}, Kesehatan ${f.c[6]} / ${f.c[7]}, PPh 21 ${f.c[8]} (TER A on wage + JKK + JKM + Kesehatan employer${period === '2025-12' ? '; a 1 December joiner’s December reckoning, PKP below PTKP' : ''})`
			)
		],
		company: company({ region, facts }),
		inputs: [
			...week('2025-06-02'),
			...floors.flatMap((f) =>
				worker({
					ref: f.ref,
					wage: f.wage,
					worksite: f.worksite,
					sector: f.sector,
					edition: f.edition ?? '2020',
					...(period === '2025-12' ? { hire: '2025-12-01' } : {}),
					// A KBLI 2025 code classifies only from its sealed applicability (sector_edition_from 2025-12-18).
					...(f.edition === '2025' ? { hire: '2026-01-05' } : {})
				})
			)
		],
		period,
		expected: floors.map((f) => ({ employment: `${f.ref}_job`, lines: lines(f) }))
	});
	const DKI = 'Provinsi DKI Jakarta';
	/**
	 * One worker contracted just under the floor that binds the workplace and sector (a rupiah, or a sen where the
	 * decree states sen): the run is refused, not paid (UU 13/2003 art.88E(2); PP 36/2021 art.23(3)). ID-127: the
	 * comparison is in sen, so a sen below a fractional floor refuses too.
	 */
	const below = (
		id: string,
		description: string,
		source: readonly string[],
		period: string,
		f: {
			ref: string;
			worksite: string;
			sector: string;
			wage: number;
			edition?: '2020' | '2025';
			type?: string;
		},
		facts: Row = {}
	): ProbeCase => ({
		id,
		profile: 'ID',
		description,
		citation: [
			...source,
			'UU 13/2003 art.88E(2) as inserted by UU 6/2023: employers are prohibited from paying wages below the minimum wage; PP 36/2021 arts.7(2), 23–24 (https://jdih.kemnaker.go.id/asset/data_puu/PP362021.pdf); PP 49/2025 arts.35A–35J: a sector floor binds workers under one year (https://jdih.kemnaker.go.id/asset/data_puu/2025pp0049.pdf)'
		],
		company: company({ region: f.worksite, facts }),
		inputs: [
			...week('2025-06-02'),
			...worker({
				ref: f.ref,
				wage: f.wage,
				worksite: f.worksite,
				sector: f.sector,
				edition: f.edition ?? '2020',
				...(f.type == null ? {} : { type: f.type }),
				...(period === '2025-12' ? { hire: '2025-12-01' } : {})
			})
		],
		period,
		refused: `MINIMUM_WAGE_BELOW: P-ID-${f.ref} is contracted at `,
		expected: []
	});
	return [
		floorCase(
			'ID-94-1',
			'DKI Jakarta UMP 2026 Rp5,729,876, February 2026 (the only standalone province-only workplace; KBLI 62019 a verified ordinary sector).',
			[
				'DKI UMP 2026 Rp5,729,876: Kep. Gubernur DKI 1142/2025 (tracker ID-94, https://jdih.jakarta.go.id/)'
			],
			'2026-02',
			DKI,
			[
				{
					ref: 'ump',
					worksite: DKI,
					sector: '62019',
					wage: 5_729_876,
					c: [114_598, 212_005, 57_299, 114_598, 13_752, 17_190, 57_299, 229_195, 44_925]
				}
			]
		),
		{
			id: 'ID-94-3',
			profile: 'ID',
			description:
				'A DKI Jakarta worker contracted a rupiah under the 2026 UMP (Rp5,729,875), February 2026: the run is refused, not paid.',
			citation: [
				'DKI UMP 2026 Rp5,729,876: Kep. Gubernur DKI 1142/2025 (tracker ID-94, https://jdih.jakarta.go.id/dokumenPeraturanDirectory/0031/2025KEPGUB00311142.pdf)',
				'UU 13/2003 art.88E(2) as inserted by UU 6/2023: employers are prohibited from paying wages below the minimum wage; PP 36/2021 arts.7(2), 23–24 (https://jdih.kemnaker.go.id/asset/data_puu/PP362021.pdf)'
			],
			company: company({ region: DKI }),
			inputs: [
				...week('2025-06-02'),
				...worker({ ref: 'under', wage: 5_729_875, worksite: DKI, sector: '62019' })
			],
			period: '2026-02',
			refused: 'MINIMUM_WAGE_BELOW: P-ID-under is contracted at ',
			expected: []
		},
		floorCase(
			'ID-94-2',
			'DKI Jakarta UMP 2025 Rp5,396,761 in December 2025, a 1 December joiner.',
			[
				'DKI UMP 2025 Rp5,396,761: Kep. Gubernur DKI 829/2024 (https://jdih.jakarta.go.id/dokumenPeraturanDirectory/0031/2024KEPGUB0031829.pdf)'
			],
			'2025-12',
			DKI,
			[
				{
					ref: 'ump25',
					worksite: DKI,
					sector: '62019',
					wage: 5_396_761,
					c: [107_935, 199_680, 53_968, 107_935, 12_952, 16_190, 53_968, 215_870, 0]
				}
			]
		),
		floorCase(
			'ID-54-1',
			'DKI Jakarta 2026 UMSP (Kep.33/2026, from 1 January 2026, under one year’s service): KBLI 10437 at Rp5,741,201 and 10734 at Rp5,743,449, February 2026.',
			[
				'DKI Kep.33/2026 dicta KEDUA–KETUJUH and annex (https://jdih.jakarta.go.id/dokumenPeraturanDirectory/0031/2026KEPGUB003133.pdf; tracker ID-54)'
			],
			'2026-02',
			DKI,
			[
				{
					ref: 'umsp1',
					worksite: DKI,
					sector: '10437',
					wage: 5_741_201,
					c: [114_824, 212_424, 57_412, 114_824, 13_779, 17_224, 57_412, 229_648, 45_014]
				},
				{
					ref: 'umsp2',
					worksite: DKI,
					sector: '10734',
					wage: 5_743_449,
					c: [114_869, 212_508, 57_434, 114_869, 13_784, 17_230, 57_434, 229_738, 45_032]
				}
			]
		),
		floorCase(
			'ID-172-1',
			'A KBLI 2025 code with one verified KBLI 2020 source: 62199 (2025) → 62019 (2020), a verified ordinary DKI sector, at the DKI UMP, February 2026.',
			[
				'PerBPS 7/2025 arts.5–7 and the BPS KBLI 2020–2025 conversion table (https://www.bps.go.id/id/publication/2026/04/22/909d503355d2b7664e43dea8/tabel-konversi-kbli-2020-kbli-2025.html); OSS confirms 62199 → 62019 (https://oss.go.id/id/kbli/detail/5e8659f8-01e8-48d9-bceb-4af4015caa73; tracker ID-172)'
			],
			'2026-02',
			DKI,
			[
				{
					ref: 'kbli25',
					worksite: DKI,
					sector: '62199',
					edition: '2025',
					wage: 5_729_876,
					c: [114_598, 212_005, 57_299, 114_598, 13_752, 17_190, 57_299, 229_195, 44_925]
				}
			]
		),
		floorCase(
			'ID-172-2',
			'A KBLI 2025 code 07221 whose one KBLI 2020 source is 07301 (Pertambangan …): the Banyuwangi 2026 UMSK Rp3,145,131 binds, February 2026.',
			[
				'BPS KBLI 2020–2025 conversion 07221 ↔ 07301 (tracker ID-172)',
				'East Java Kep.100.3.3.1/938/013/2025, UMSK Kabupaten Banyuwangi 2026: KBLI 07301 Rp3,145,131 (signed PDF https://files.jdih.jatimprov.go.id/jdih-prod/uploads/topics/2025kg00350938.pdf, read 2026-09-30)'
			],
			'2026-02',
			'Provinsi Jawa Timur/Kabupaten Banyuwangi',
			[
				{
					ref: 'bwi',
					worksite: 'Provinsi Jawa Timur/Kabupaten Banyuwangi',
					sector: '07221',
					edition: '2025',
					wage: 3_145_131,
					c: [62_903, 116_370, 31_451, 62_903, 7_548, 9_435, 31_451, 125_805, 0]
				}
			]
		),
		floorCase(
			'ID-79-1',
			'Kota Surabaya UMK 2026 Rp5,288,796, February 2026.',
			[
				'East Java Kep.100.3.3.1/937/013/2025 Lampiran: Kota Surabaya Rp5,288,796 (signed PDF https://files.jdih.jatimprov.go.id/jdih-prod/uploads/topics/2025kg00350937.pdf, read 2026-09-30)'
			],
			'2026-02',
			'Provinsi Jawa Timur/Kota Surabaya',
			[
				{
					ref: 'sby',
					worksite: 'Provinsi Jawa Timur/Kota Surabaya',
					sector: '62019',
					wage: 5_288_796,
					c: [105_776, 195_685, 52_888, 105_776, 12_693, 15_866, 52_888, 211_552, 13_822]
				}
			]
		),
		floorCase(
			'ID-80-1',
			'Kota Surabaya UMSK 2026 for KBLI 10412 (margarine) Rp5,444,909, above the UMK, February 2026.',
			[
				'East Java Kep.100.3.3.1/938/013/2025, UMSK Kota Surabaya: KBLI 10412 Rp5,444,909 (signed PDF https://files.jdih.jatimprov.go.id/jdih-prod/uploads/topics/2025kg00350938.pdf, read 2026-09-30)'
			],
			'2026-02',
			'Provinsi Jawa Timur/Kota Surabaya',
			[
				{
					ref: 'sby2',
					worksite: 'Provinsi Jawa Timur/Kota Surabaya',
					sector: '10412',
					wage: 5_444_909,
					c: [108_898, 201_462, 54_449, 108_898, 13_068, 16_335, 54_449, 217_796, 28_461]
				}
			]
		),
		floorCase(
			'ID-83-1',
			'Kota Semarang UMK 2026 Rp3,701,709 and its UMSK for KBLI 42930 Rp3,721,126, February 2026.',
			[
				'Central Java Kep.100.3.3.1/505/2025 Lampiran I no.33 and Lampiran II no.4 (signed PDF https://jdih.jatengprov.go.id/produk_hukum/kepgub/sk_100.3.3.1-505_th_2025_auten.pdf, read 2026-09-30)'
			],
			'2026-02',
			'Provinsi Jawa Tengah/Kota Semarang',
			[
				{
					ref: 'smg',
					worksite: 'Provinsi Jawa Tengah/Kota Semarang',
					sector: '62019',
					wage: 3_701_709,
					c: [74_034, 136_963, 37_017, 74_034, 8_884, 11_105, 37_017, 148_068, 0]
				},
				{
					ref: 'smg2',
					worksite: 'Provinsi Jawa Tengah/Kota Semarang',
					sector: '42930',
					wage: 3_721_126,
					c: [74_423, 137_682, 37_211, 74_423, 8_931, 11_163, 37_211, 148_845, 0]
				}
			]
		),
		floorCase(
			'ID-102-1',
			'Kabupaten Badung UMK 2026 Rp3,791,002.57, February 2026.',
			[
				'Bali Kep.1021/2025: Badung Rp3,791,002.57 (tracker ID-102; https://cloud-ng.baliprov.go.id/disnakeresdm/2025/12/PENGUMUMAN-DAN-SK-UMP-UMSP-2026.pdf)'
			],
			'2026-02',
			'Provinsi Bali/Kabupaten Badung',
			[
				{
					ref: 'bdg',
					worksite: 'Provinsi Bali/Kabupaten Badung',
					sector: '62019',
					wage: 3_791_002.57,
					c: [75_820, 140_267, 37_910, 75_820, 9_098, 11_373, 37_910, 151_640, 0]
				}
			]
		),
		floorCase(
			'ID-103-1',
			'Kabupaten Badung UMSK 2026 Rp3,828,912.60 for a four-star hotel (KBLI 2020 55110), February 2026.',
			[
				'Bali Kep.1021/2025: Badung UMSK Rp3,828,912.60 for KBLI letter I with four- or five-star hotel classification (tracker ID-103; https://cloud-ng.baliprov.go.id/disnakeresdm/2025/12/PENGUMUMAN-DAN-SK-UMP-UMSP-2026.pdf)'
			],
			'2026-02',
			'Provinsi Bali/Kabupaten Badung',
			[
				{
					ref: 'hotel4',
					worksite: 'Provinsi Bali/Kabupaten Badung',
					sector: '55110',
					wage: 3_828_912.6,
					c: [76_578, 141_670, 38_289, 76_578, 9_189, 11_487, 38_289, 153_157, 0]
				}
			],
			{ umsp_hotel_star: 4 }
		),
		floorCase(
			'ID-101-1',
			'Bali from 1 January 2026: Kabupaten Bangli is on the UMP Rp3,207,459, and a star hotel there on the provincial tourism UMSP Rp3,267,693, February 2026.',
			[
				'Bali Kep.1011/2025: UMP Rp3,207,459.00 and provincial tourism UMSP Rp3,267,693.00 for the star-hotel subgroup of KBLI letter I; Bangli is expressly on the UMP (Kep.1021/2025) (tracker ID-101, ID-102; https://cloud-ng.baliprov.go.id/disnakeresdm/2025/12/PENGUMUMAN-DAN-SK-UMP-UMSP-2026.pdf)'
			],
			'2026-02',
			'Provinsi Bali/Kabupaten Bangli',
			[
				{
					ref: 'bgl',
					worksite: 'Provinsi Bali/Kabupaten Bangli',
					sector: '62019',
					wage: 3_207_459,
					c: [64_149, 118_676, 32_075, 64_149, 7_698, 9_622, 32_075, 128_298, 0]
				},
				{
					ref: 'bgl2',
					worksite: 'Provinsi Bali/Kabupaten Bangli',
					sector: '55110',
					wage: 3_267_693,
					c: [65_354, 120_905, 32_677, 65_354, 7_842, 9_803, 32_677, 130_708, 0]
				}
			],
			{ umsp_hotel_star: 3 }
		),
		floorCase(
			'ID-99-1',
			'Kota Denpasar UMK 2025 Rp3,298,116.50 in December 2025, a 1 December joiner.',
			['Bali Kep.946/2024: Denpasar Rp3,298,116.50 (tracker ID-99)'],
			'2025-12',
			'Provinsi Bali/Kota Denpasar',
			[
				{
					ref: 'dps',
					worksite: 'Provinsi Bali/Kota Denpasar',
					sector: '62019',
					wage: 3_298_116.5,
					c: [65_962, 122_030, 32_981, 65_962, 7_915, 9_894, 32_981, 131_925, 0]
				}
			]
		),
		floorCase(
			'ID-100-1',
			'Kabupaten Badung UMSK 2025 Rp3,569,682.27 for a five-star hotel (KBLI 55110), December 2025, a 1 December joiner.',
			[
				'Bali Kep.946/2024: Badung UMSK Rp3,569,682.27 for five-star accommodation (tracker ID-100)'
			],
			'2025-12',
			'Provinsi Bali/Kabupaten Badung',
			[
				{
					ref: 'hotel5',
					worksite: 'Provinsi Bali/Kabupaten Badung',
					sector: '55110',
					wage: 3_569_682.27,
					c: [71_394, 132_078, 35_697, 71_394, 8_567, 10_709, 35_697, 142_787, 0]
				}
			],
			{ umsp_hotel_star: 5 }
		),
		floorCase(
			'ID-98-1',
			'Bali provincial UMSP 2025 Rp3,052,834 for food service (KBLI 56101) in Kabupaten Bangli, December 2025, a 1 December joiner.',
			[
				'Bali Kep.939/2024: UMSP Rp3,052,834.00 for tourism accommodation and food service under KBLI 2020 letter I (https://cloud-ng.baliprov.go.id/disnakeresdm/2024/12/PENGUMUMAN-UMP-dan-UMSP-Tahun-2025.pdf; tracker ID-98)'
			],
			'2025-12',
			'Provinsi Bali/Kabupaten Bangli',
			[
				{
					ref: 'resto',
					worksite: 'Provinsi Bali/Kabupaten Bangli',
					sector: '56101',
					wage: 3_052_834,
					c: [61_057, 112_955, 30_528, 61_057, 7_327, 9_159, 30_528, 122_113, 0]
				}
			]
		),
		floorCase(
			'ID-137-1',
			'Lampung 2026: Kota Bandar Lampung UMK Rp3,491,889; in Kota Metro (UMK Rp3,050,498) KBLI 10434 is raised to the UMSP Rp3,108,689, February 2026.',
			[
				'Lampung Kep. G/865/V.08/HK/2025 (UMP and UMSP KBLI 10434 Rp3,108,689) and the 2026 UMK decrees (Bandar Lampung Rp3,491,889, Metro Rp3,050,498) (tracker ID-137; https://disnaker.lampungprov.go.id/download/ketenagakerjaan)'
			],
			'2026-02',
			'Provinsi Lampung/Kota Bandar Lampung',
			[
				{
					ref: 'bdl',
					worksite: 'Provinsi Lampung/Kota Bandar Lampung',
					sector: '62019',
					wage: 3_491_889,
					c: [69_838, 129_200, 34_919, 69_838, 8_381, 10_476, 34_919, 139_676, 0]
				},
				{
					ref: 'metro',
					worksite: 'Provinsi Lampung/Kota Metro',
					sector: '10434',
					wage: 3_108_689,
					c: [62_174, 115_021, 31_087, 62_174, 7_461, 9_326, 31_087, 124_348, 0]
				}
			]
		),
		floorCase(
			'ID-139-1',
			'DI Yogyakarta 2026 UMKs: Kota Yogyakarta Rp2,827,593 and Kabupaten Gunungkidul Rp2,468,378, February 2026.',
			[
				'Kep. Gubernur DIY 443/2025 (tracker ID-139; https://gunungkidulkab.go.id/umk-gunungkidul-tahun-2026-ditetapkan-rp-246-juta-naik-dibanding-tahun-sebelumnya/)'
			],
			'2026-02',
			'Provinsi DI Yogyakarta/Kota Yogyakarta',
			[
				{
					ref: 'yk',
					worksite: 'Provinsi DI Yogyakarta/Kota Yogyakarta',
					sector: '62019',
					wage: 2_827_593,
					c: [56_552, 104_621, 28_276, 56_552, 6_786, 8_483, 28_276, 113_104, 0]
				},
				{
					ref: 'gk',
					worksite: 'Provinsi DI Yogyakarta/Kabupaten Gunungkidul',
					sector: '62019',
					wage: 2_468_378,
					c: [49_368, 91_330, 24_684, 49_368, 5_924, 7_405, 24_684, 98_735, 0]
				}
			]
		),
		floorCase(
			'ID-142-1',
			'West Kalimantan 2026: Kubu Raya UMSK Rp3,108,000 for KBLI 01262, and Sekadau on the UMP Rp3,054,552, February 2026.',
			[
				'West Kalimantan Kep.1350/NAKERTRAN/2025 (UMP), Kep.1356/NAKERTRAN/2025 (UMSK Kubu Raya 01262/10431 Rp3,108,000), Sekadau on the UMP per the governor’s letter of 24 Dec 2025 (tracker ID-142)'
			],
			'2026-02',
			'Provinsi Kalimantan Barat/Kabupaten Kubu Raya',
			[
				{
					ref: 'kubu',
					worksite: 'Provinsi Kalimantan Barat/Kabupaten Kubu Raya',
					sector: '01262',
					wage: 3_108_000,
					c: [62_160, 114_996, 31_080, 62_160, 7_459, 9_324, 31_080, 124_320, 0]
				},
				{
					ref: 'skd',
					worksite: 'Provinsi Kalimantan Barat/Kabupaten Sekadau',
					sector: '62019',
					wage: 3_054_552,
					c: [61_091, 113_018, 30_546, 61_091, 7_331, 9_164, 30_546, 122_182, 0]
				}
			]
		),
		floorCase(
			'ID-138-1',
			'Kota Cilegon UMSK 2026 Sektor I Rp5,606,670.54 for KBLI 20111, February 2026.',
			[
				'Banten Kep.704/2025 dictum and Lampiran VI, Kota Cilegon Sektor 1 Rp5.606.670,54, KBLI 20111 (signed PDF https://ppid.bantenprov.go.id/informasi-publik/download/kepgub-banten-upah-minimum-sektoral-kabupaten-dan-kota-tahun-2026-202512241555.pdf, read 2026-09-30)'
			],
			'2026-02',
			'Provinsi Banten/Kota Cilegon',
			[
				{
					ref: 'clg',
					worksite: 'Provinsi Banten/Kota Cilegon',
					sector: '20111',
					wage: 5_606_670.54,
					c: [112_133, 207_447, 56_067, 112_133, 13_456, 16_820, 56_067, 224_267, 29_306]
				}
			]
		),
		floorCase(
			'ID-36-1',
			'An INTERN in an employment relationship at the DKI Jakarta UMP, February 2026: the label exempts nothing.',
			[
				'UU 13/2003 arts.22(1)–(3), 88E as amended: a participant without a written apprenticeship agreement is the company’s worker (https://jdih.kemnaker.go.id/asset/data_puu/peraturan_file_13.pdf); DKI UMP Kep.1142/2025'
			],
			'2026-02',
			DKI,
			[
				{
					ref: 'intern',
					worksite: DKI,
					sector: '62019',
					wage: 5_729_876,
					c: [114_598, 212_005, 57_299, 114_598, 13_752, 17_190, 57_299, 229_195, 44_925]
				}
			]
		),

		// ─── Round 9 (2026-09-30): the floor that binds, one step under it, and the fallbacks ─────
		below(
			'ID-54-2',
			'DKI Jakarta 2026 UMSP KBLI 10437 (Rp5,741,201) contracted at Rp5,741,200, February 2026: above the UMP, a rupiah under the sector floor — refused.',
			[
				'DKI Kep.33/2026 annex, KBLI 10437 Rp5,741,201 (https://jdih.jakarta.go.id/dokumenPeraturanDirectory/0031/2026KEPGUB003133.pdf; tracker ID-54, ID-03)'
			],
			'2026-02',
			{ ref: 'umspb', worksite: DKI, sector: '10437', wage: 5_741_200 }
		),
		below(
			'ID-36-2',
			'An INTERN in an employment relationship contracted a rupiah under the DKI Jakarta 2026 UMP (Rp5,729,875), February 2026: the label exempts nothing — refused.',
			[
				'UU 13/2003 arts.22(1)–(3), 88E as amended: a participant without a written apprenticeship agreement is the company’s worker (https://jdih.kemnaker.go.id/asset/data_puu/peraturan_file_13.pdf); DKI UMP 2026 Rp5,729,876: Kep.1142/2025 (https://jdih.jakarta.go.id/dokumenPeraturanDirectory/0031/2025KEPGUB00311142.pdf)'
			],
			'2026-02',
			{ ref: 'internb', worksite: DKI, sector: '62019', wage: 5_729_875, type: 'INTERN' }
		),
		below(
			'ID-79-2',
			'Kota Surabaya UMK 2026 Rp5,288,796 contracted at Rp5,288,795, February 2026 — refused.',
			[
				'East Java Kep.100.3.3.1/937/013/2025 Lampiran: Kota Surabaya Rp5,288,796 (https://files.jdih.jatimprov.go.id/jdih-prod/uploads/topics/2025kg00350937.pdf)'
			],
			'2026-02',
			{
				ref: 'sbyb',
				worksite: 'Provinsi Jawa Timur/Kota Surabaya',
				sector: '62019',
				wage: 5_288_795
			}
		),
		below(
			'ID-80-2',
			'Kota Surabaya UMSK 2026 KBLI 10412 Rp5,444,909 contracted at Rp5,444,908 (above the UMK), February 2026 — refused.',
			[
				'East Java Kep.100.3.3.1/938/013/2025, UMSK Kota Surabaya: KBLI 10412 Rp5,444,909 (https://files.jdih.jatimprov.go.id/jdih-prod/uploads/topics/2025kg00350938.pdf)'
			],
			'2026-02',
			{
				ref: 'sbyb2',
				worksite: 'Provinsi Jawa Timur/Kota Surabaya',
				sector: '10412',
				wage: 5_444_908
			}
		),
		below(
			'ID-83-2',
			'Kota Semarang UMK 2026 Rp3,701,709 contracted at Rp3,701,708, February 2026 — refused.',
			[
				'Central Java Kep.100.3.3.1/505/2025 Lampiran I no.33 (https://jdih.jatengprov.go.id/produk_hukum/kepgub/sk_100.3.3.1-505_th_2025_auten.pdf)'
			],
			'2026-02',
			{
				ref: 'smgb',
				worksite: 'Provinsi Jawa Tengah/Kota Semarang',
				sector: '62019',
				wage: 3_701_708
			}
		),
		below(
			'ID-98-2',
			'Bali provincial UMSP 2025 Rp3,052,834 for food service (KBLI 56101) in Kabupaten Bangli contracted at Rp3,052,833, December 2025, a 1 December joiner — refused.',
			[
				'Bali Kep.939/2024 (announcement B.21.500.15/17565/IV/DISNAKER.ESDM, read 2026-09-30): UMSP Rp3.052.834,00 for KBLI 2020 letter I (https://cloud-ng.baliprov.go.id/disnakeresdm/2024/12/PENGUMUMAN-UMP-dan-UMSP-Tahun-2025.pdf)'
			],
			'2025-12',
			{
				ref: 'restob',
				worksite: 'Provinsi Bali/Kabupaten Bangli',
				sector: '56101',
				wage: 3_052_833
			}
		),
		below(
			'ID-99-2',
			'Kota Denpasar UMK 2025 Rp3,298,116.50 contracted a sen under (Rp3,298,116.49), December 2025, a 1 December joiner — refused: the comparison is in sen.',
			[
				'Bali Kep.946/2024 (announcement B.21.500.15/18055/IV/DISNAKER.ESDM, read 2026-09-30): Denpasar Rp3.298.116,50 (https://cloud-ng.baliprov.go.id/disnakeresdm/2024/12/Pengumuman-UMK-dan-UMSK-Tahun-2025.pdf)'
			],
			'2025-12',
			{ ref: 'dpsb', worksite: 'Provinsi Bali/Kota Denpasar', sector: '62019', wage: 3_298_116.49 }
		),
		below(
			'ID-100-2',
			'Kabupaten Badung UMSK 2025 Rp3,569,682.27 for a five-star hotel (KBLI 55110) contracted a sen under, December 2025, a 1 December joiner — refused.',
			[
				'Bali Kep.946/2024 (read 2026-09-30): Badung UMSK Rp3.569.682,27, letter I "Khususnya Hotel Bintang 5" (https://cloud-ng.baliprov.go.id/disnakeresdm/2024/12/Pengumuman-UMK-dan-UMSK-Tahun-2025.pdf)'
			],
			'2025-12',
			{
				ref: 'hotel5b',
				worksite: 'Provinsi Bali/Kabupaten Badung',
				sector: '55110',
				wage: 3_569_682.26
			},
			{ umsp_hotel_star: 5 }
		),
		below(
			'ID-101-2',
			'Bali provincial tourism UMSP 2026 Rp3,267,693 for a star hotel (KBLI 55110) in Kabupaten Bangli contracted at Rp3,267,692, February 2026 — refused.',
			[
				'Bali Kep.1011/2025 (announcement B.21.500.15/17588/IV/DISNAKER.ESDM, read 2026-09-30): UMSP Rp3.267.693,00 for letter I "dengan Turunan Hotel Bintang" (https://cloud-ng.baliprov.go.id/disnakeresdm/2025/12/PENGUMUMAN-DAN-SK-UMP-UMSP-2026.pdf)'
			],
			'2026-02',
			{ ref: 'bglb', worksite: 'Provinsi Bali/Kabupaten Bangli', sector: '55110', wage: 3_267_692 },
			{ umsp_hotel_star: 3 }
		),
		below(
			'ID-102-2',
			'Kabupaten Badung UMK 2026 Rp3,791,002.57 contracted a sen under (Rp3,791,002.56), February 2026 — refused: the comparison is in sen.',
			[
				'Bali Kep.1021/2025 (announcement B.21.500.15/17641/IV/DISNAKER.ESDM, read 2026-09-30): Badung Rp3.791.002,57 (https://cloud-ng.baliprov.go.id/disnakeresdm/2025/12/PENGUMUMAN-DAN-SK-UMK-UMSK-TAHUN-2026.pdf)'
			],
			'2026-02',
			{
				ref: 'bdgb',
				worksite: 'Provinsi Bali/Kabupaten Badung',
				sector: '62019',
				wage: 3_791_002.56
			}
		),
		below(
			'ID-103-2',
			'Kabupaten Badung UMSK 2026 Rp3,828,912.60 for a four-star hotel (KBLI 55110) contracted a sen under, February 2026 — refused.',
			[
				'Bali Kep.1021/2025 (read 2026-09-30): Badung UMSK Rp3.828.912,60 for letter I "Hotel Bintang 5 (lima) dan 4 (empat)" (https://cloud-ng.baliprov.go.id/disnakeresdm/2025/12/PENGUMUMAN-DAN-SK-UMK-UMSK-TAHUN-2026.pdf)'
			],
			'2026-02',
			{
				ref: 'hotel4b',
				worksite: 'Provinsi Bali/Kabupaten Badung',
				sector: '55110',
				wage: 3_828_912.59
			},
			{ umsp_hotel_star: 4 }
		),
		below(
			'ID-137-2',
			'Kota Bandar Lampung UMK 2026 Rp3,491,889 contracted at Rp3,491,888, February 2026 — refused.',
			[
				'Lampung 2026 UMK decree: Bandar Lampung Rp3,491,889 (tracker ID-137; https://disnaker.lampungprov.go.id/download/ketenagakerjaan)'
			],
			'2026-02',
			{
				ref: 'bdlb',
				worksite: 'Provinsi Lampung/Kota Bandar Lampung',
				sector: '62019',
				wage: 3_491_888
			}
		),
		below(
			'ID-138-2',
			'Kota Cilegon UMSK 2026 Sektor I Rp5,606,670.54 for KBLI 20111 contracted a sen under, February 2026 — refused.',
			[
				'Banten Kep.704/2025 Lampiran VI, Kota Cilegon Sektor 1 Rp5.606.670,54, KBLI 20111 (https://ppid.bantenprov.go.id/informasi-publik/download/kepgub-banten-upah-minimum-sektoral-kabupaten-dan-kota-tahun-2026-202512241555.pdf)'
			],
			'2026-02',
			{ ref: 'clgb', worksite: 'Provinsi Banten/Kota Cilegon', sector: '20111', wage: 5_606_670.53 }
		),
		below(
			'ID-139-2',
			'Kota Yogyakarta UMK 2026 Rp2,827,593 contracted at Rp2,827,592, February 2026 — refused.',
			[
				'Kep. Gubernur DIY 443/2025: Kota Yogyakarta Rp2,827,593 (tracker ID-139; https://nakertrans.jogjaprov.go.id/)'
			],
			'2026-02',
			{
				ref: 'ykb',
				worksite: 'Provinsi DI Yogyakarta/Kota Yogyakarta',
				sector: '62019',
				wage: 2_827_592
			}
		),
		below(
			'ID-142-2',
			'Kabupaten Kubu Raya UMSK 2026 Rp3,108,000 for KBLI 01262 contracted at Rp3,107,999 (above the UMK Rp3,100,000), February 2026 — refused.',
			[
				'West Kalimantan Kep.1356/NAKERTRAN/2025, UMSK Kubu Raya KBLI 01262 Rp3,108,000 (tracker ID-142; https://disnakertrans.kalbarprov.go.id/peraturan/sk-ump-dan-umk-tahun-2026/)'
			],
			'2026-02',
			{
				ref: 'kubub',
				worksite: 'Provinsi Kalimantan Barat/Kabupaten Kubu Raya',
				sector: '01262',
				wage: 3_107_999
			}
		),
		floorCase(
			'ID-99-3',
			'Bali December 2025 UMKs at their floors, 1 December joiners: Badung Rp3,534,338.88, Gianyar Rp3,119,080, Tabanan Rp3,102,520.45, and Buleleng (no UMK of its own) on the UMP Rp2,996,561.',
			[
				'Bali Kep.946/2024 (announcement B.21.500.15/18055/IV/DISNAKER.ESDM, read 2026-09-30): Badung 3.534.338,88, Denpasar 3.298.116,50, Gianyar 3.119.080,00, Tabanan 3.102.520,45; point 4: a regency not listed uses the UMP (https://cloud-ng.baliprov.go.id/disnakeresdm/2024/12/Pengumuman-UMK-dan-UMSK-Tahun-2025.pdf)',
				'Bali Kep.939/2024: UMP 2025 Rp2.996.561,00 (https://cloud-ng.baliprov.go.id/disnakeresdm/2024/12/PENGUMUMAN-UMP-dan-UMSP-Tahun-2025.pdf)'
			],
			'2025-12',
			'Provinsi Bali/Kabupaten Badung',
			[
				{
					ref: 'bdg25',
					worksite: 'Provinsi Bali/Kabupaten Badung',
					sector: '62019',
					wage: 3_534_338.88,
					c: [70_687, 130_771, 35_343, 70_687, 8_482, 10_603, 35_343, 141_374, 0]
				},
				{
					ref: 'gnr25',
					worksite: 'Provinsi Bali/Kabupaten Gianyar',
					sector: '62019',
					wage: 3_119_080,
					c: [62_382, 115_406, 31_191, 62_382, 7_486, 9_357, 31_191, 124_763, 0]
				},
				{
					ref: 'tbn25',
					worksite: 'Provinsi Bali/Kabupaten Tabanan',
					sector: '62019',
					wage: 3_102_520.45,
					c: [62_050, 114_793, 31_025, 62_050, 7_446, 9_308, 31_025, 124_101, 0]
				},
				{
					ref: 'bll25',
					worksite: 'Provinsi Bali/Kabupaten Buleleng',
					sector: '62019',
					wage: 2_996_561,
					c: [59_931, 110_873, 29_966, 59_931, 7_192, 8_990, 29_966, 119_862, 0]
				}
			]
		),
		floorCase(
			'ID-100-3',
			'A four-star hotel (KBLI 55110) in Kabupaten Badung, December 2025, a 1 December joiner: the 2025 UMSK is for five-star hotels only, so the UMK Rp3,534,338.88 binds (above the provincial letter-I UMSP Rp3,052,834).',
			[
				'Bali Kep.946/2024 (read 2026-09-30): Badung UMSK "Khususnya Hotel Bintang 5 (lima)"; point 3: otherwise the UMK (https://cloud-ng.baliprov.go.id/disnakeresdm/2024/12/Pengumuman-UMK-dan-UMSK-Tahun-2025.pdf)',
				'Binding floor = the higher of the ordinary floor and every matching sector floor: PP 49/2025 art.35D (tracker ID-03)'
			],
			'2025-12',
			'Provinsi Bali/Kabupaten Badung',
			[
				{
					ref: 'hotel4y',
					worksite: 'Provinsi Bali/Kabupaten Badung',
					sector: '55110',
					wage: 3_534_338.88,
					c: [70_687, 130_771, 35_343, 70_687, 8_482, 10_603, 35_343, 141_374, 0]
				}
			],
			{ umsp_hotel_star: 4 }
		),
		{
			id: 'ID-100-4',
			profile: 'ID',
			description:
				'A hotel (KBLI 55110) in Kabupaten Badung with no recorded star class, December 2025: the UMSK turns on the class, so the run is refused until it is recorded.',
			citation: [
				'Bali Kep.946/2024 (read 2026-09-30): Badung UMSK for letter I five-star hotels only (https://cloud-ng.baliprov.go.id/disnakeresdm/2024/12/Pengumuman-UMK-dan-UMSK-Tahun-2025.pdf); an unverified class cannot select the lower UMK (tracker ID-100)'
			],
			company: company({ region: 'Provinsi Bali/Kabupaten Badung' }),
			inputs: [
				...week('2025-06-02'),
				...worker({
					ref: 'hotelx',
					wage: 3_600_000,
					hire: '2025-12-01',
					worksite: 'Provinsi Bali/Kabupaten Badung',
					sector: '55110'
				})
			],
			period: '2025-12',
			refused: 'Record umsp_hotel_star for Provinsi Bali/Kabupaten Badung sector 55110',
			expected: []
		},
		floorCase(
			'ID-103-3',
			'A three-star hotel (KBLI 55110) in Kabupaten Badung, February 2026: the 2026 UMSK covers four- and five-star hotels only, so the UMK Rp3,791,002.57 binds (above the provincial star-hotel UMSP Rp3,267,693).',
			[
				'Bali Kep.1021/2025 (read 2026-09-30): Badung UMSK for "Hotel Bintang 5 (lima) dan 4 (empat)" (https://cloud-ng.baliprov.go.id/disnakeresdm/2025/12/PENGUMUMAN-DAN-SK-UMK-UMSK-TAHUN-2026.pdf); Kep.1011/2025 UMSP Rp3,267,693',
				'Binding floor = the higher of the ordinary floor and every matching sector floor: PP 49/2025 art.35D (tracker ID-03)'
			],
			'2026-02',
			'Provinsi Bali/Kabupaten Badung',
			[
				{
					ref: 'hotel3',
					worksite: 'Provinsi Bali/Kabupaten Badung',
					sector: '55110',
					wage: 3_791_002.57,
					c: [75_820, 140_267, 37_910, 75_820, 9_098, 11_373, 37_910, 151_640, 0]
				}
			],
			{ umsp_hotel_star: 3 }
		),
		floorCase(
			'ID-101-3',
			'A restaurant (KBLI 56101, letter I but not a star hotel) in Kabupaten Bangli, February 2026: the 2026 provincial UMSP is for star hotels only, so it is paid the UMP Rp3,207,459.',
			[
				'Bali Kep.1011/2025 (read 2026-09-30): UMSP 2026 for letter I "dengan Turunan Hotel Bintang" (narrower than 2025’s whole letter I); UMP Rp3.207.459,00 (https://cloud-ng.baliprov.go.id/disnakeresdm/2025/12/PENGUMUMAN-DAN-SK-UMP-UMSP-2026.pdf); Kep.1021/2025 point 4: Bangli uses the UMP'
			],
			'2026-02',
			'Provinsi Bali/Kabupaten Bangli',
			[
				{
					ref: 'resto26',
					worksite: 'Provinsi Bali/Kabupaten Bangli',
					sector: '56101',
					wage: 3_207_459,
					c: [64_149, 118_676, 32_075, 64_149, 7_698, 9_622, 32_075, 128_298, 0]
				}
			]
		),
		floorCase(
			'ID-102-3',
			'Bali 2026 UMKs at their floors, February 2026: Denpasar Rp3,499,878.78, Gianyar Rp3,316,798.48, Tabanan Rp3,287,678.87, and Buleleng, Jembrana, Karangasem and Klungkung on the UMP Rp3,207,459.',
			[
				'Bali Kep.1021/2025 (announcement B.21.500.15/17641/IV/DISNAKER.ESDM, read 2026-09-30): Denpasar 3.499.878,78, Gianyar 3.316.798,48, Tabanan 3.287.678,87; point 4: Bangli, Buleleng, Jembrana, Karangasem and Klungkung use the UMP (https://cloud-ng.baliprov.go.id/disnakeresdm/2025/12/PENGUMUMAN-DAN-SK-UMK-UMSK-TAHUN-2026.pdf)',
				'Bali Kep.1011/2025: UMP 2026 Rp3.207.459,00 (https://cloud-ng.baliprov.go.id/disnakeresdm/2025/12/PENGUMUMAN-DAN-SK-UMP-UMSP-2026.pdf)'
			],
			'2026-02',
			'Provinsi Bali/Kota Denpasar',
			[
				{
					ref: 'dps26',
					worksite: 'Provinsi Bali/Kota Denpasar',
					sector: '62019',
					wage: 3_499_878.78,
					c: [69_998, 129_496, 34_999, 69_998, 8_400, 10_500, 34_999, 139_995, 0]
				},
				{
					ref: 'gnr26',
					worksite: 'Provinsi Bali/Kabupaten Gianyar',
					sector: '62019',
					wage: 3_316_798.48,
					c: [66_336, 122_722, 33_168, 66_336, 7_960, 9_950, 33_168, 132_672, 0]
				},
				{
					ref: 'tbn26',
					worksite: 'Provinsi Bali/Kabupaten Tabanan',
					sector: '62019',
					wage: 3_287_678.87,
					c: [65_754, 121_644, 32_877, 65_754, 7_890, 9_863, 32_877, 131_507, 0]
				},
				...['Buleleng', 'Jembrana', 'Karangasem', 'Klungkung'].map((regency) => ({
					ref: `ump26${regency.toLowerCase()}`,
					worksite: `Provinsi Bali/Kabupaten ${regency}`,
					sector: '62019',
					wage: 3_207_459,
					c: [64_149, 118_676, 32_075, 64_149, 7_698, 9_622, 32_075, 128_298, 0] as const
				}))
			]
		),
		{
			id: 'ID-54-3',
			profile: 'ID',
			description:
				'DKI Jakarta, KBLI 47111 (a minimarket, in no row of the 2026 UMSP annex and not a verified ordinary sector), Rp10,000,000, February 2026: DKI is a strict sector place, so the unmatched code cannot fall back to the UMP — refused.',
			citation: [
				'DKI Kep.33/2026 annex (https://jdih.jakarta.go.id/dokumenPeraturanDirectory/0031/2026KEPGUB003133.pdf): KBLI 47111 is not listed; rows 58–59 and 61 select by job type the terms do not carry, so an unmatched code is unresolved (tracker ID-54, ID-173 strict-sector gate)'
			],
			company: company(),
			inputs: [
				...week('2025-06-02'),
				...worker({ ref: 'mart', wage: 10_000_000, sector: '47111' })
			],
			period: '2026-02',
			refused:
				'The sector wage order for Provinsi DKI Jakarta sector 47111 is not verified; no ordinary-floor fallback is allowed',
			expected: []
		},
		{
			id: 'ID-176-1',
			profile: 'ID',
			description:
				'Kota Tangerang Selatan, KBLI 2020 62010 (printed in the 2026 UMSK annex VII under a garbled title), Rp10,000,000, February 2026: the order’s intended class is unauthenticated, so the run is refused rather than paid the UMK.',
			citation: [
				'Banten Kep.704/2025 annex VII, Kota Tangerang Selatan: 62010 "Aktivitas Pemrograman Computer" and 62020 as printed (https://ppid.bantenprov.go.id/informasi-publik/download/kepgub-banten-upah-minimum-sektoral-kabupaten-dan-kota-tahun-2026-202512241555.pdf; tracker ID-176)'
			],
			company: company({ region: 'Provinsi Banten/Kota Tangerang Selatan' }),
			inputs: [
				...week('2025-06-02'),
				...worker({
					ref: 'tangsel',
					wage: 10_000_000,
					worksite: 'Provinsi Banten/Kota Tangerang Selatan',
					sector: '62010'
				})
			],
			period: '2026-02',
			refused:
				'The sector wage order for Provinsi Banten/Kota Tangerang Selatan sector 62010 is not verified; no ordinary-floor fallback is allowed',
			expected: []
		},
		// ─── Round 10 (2026-09-30): every seeded locality floor of the reworked provinces ─────────
		floorCase(
			'ID-79-3',
			'East Java 2026: every one of the 38 city/regency UMKs other than Surabaya, each worker paid exactly its floor at KBLI 62019 (no sector row), February 2026.',
			[
				'East Java Kep. Gubernur 100.3.3.1/937/013/2025 (signed 24 Dec 2025, from 1 Jan 2026), all 38 UMKs re-read 2026-09-30 from the signed PDF (https://files.jdih.jatimprov.go.id/jdih-prod/uploads/topics/2025kg00350937.pdf)',
				'Every figure: JHT 2% / 3.7%, JP 1% / 2%, JKK group I 0.24%, JKM 0.30%, Kesehatan 1% / 4% of the floor wage, each half-up to the rupiah; PPh 21 TER A on wage + JKK + JKM + Kesehatan employer (0% to Rp5,400,000; 0.25% to 5,650,000; 0.5% to 5,950,000; 0.75% to 6,300,000)'
			],
			'2026-02',
			'Provinsi Jawa Timur/Kabupaten Gresik',
			[
				{
					ref: 'jt1',
					worksite: 'Provinsi Jawa Timur/Kabupaten Gresik',
					sector: '62019',
					wage: 5_195_401,
					c: [103_908, 192_230, 51_954, 103_908, 12_469, 15_586, 51_954, 207_816, 13_578]
				},
				{
					ref: 'jt2',
					worksite: 'Provinsi Jawa Timur/Kabupaten Sidoarjo',
					sector: '62019',
					wage: 5_191_541,
					c: [103_831, 192_087, 51_915, 103_831, 12_460, 15_575, 51_915, 207_662, 13_568]
				},
				{
					ref: 'jt3',
					worksite: 'Provinsi Jawa Timur/Kabupaten Pasuruan',
					sector: '62019',
					wage: 5_187_681,
					c: [103_754, 191_944, 51_877, 103_754, 12_450, 15_563, 51_877, 207_507, 13_558]
				},
				{
					ref: 'jt4',
					worksite: 'Provinsi Jawa Timur/Kabupaten Mojokerto',
					sector: '62019',
					wage: 5_176_101,
					c: [103_522, 191_516, 51_761, 103_522, 12_423, 15_528, 51_761, 207_044, 13_528]
				},
				{
					ref: 'jt5',
					worksite: 'Provinsi Jawa Timur/Kabupaten Malang',
					sector: '62019',
					wage: 3_802_862,
					c: [76_057, 140_706, 38_029, 76_057, 9_127, 11_409, 38_029, 152_114, 0]
				},
				{
					ref: 'jt6',
					worksite: 'Provinsi Jawa Timur/Kota Malang',
					sector: '62019',
					wage: 3_736_101,
					c: [74_722, 138_236, 37_361, 74_722, 8_967, 11_208, 37_361, 149_444, 0]
				},
				{
					ref: 'jt7',
					worksite: 'Provinsi Jawa Timur/Kota Batu',
					sector: '62019',
					wage: 3_562_484,
					c: [71_250, 131_812, 35_625, 71_250, 8_550, 10_687, 35_625, 142_499, 0]
				},
				{
					ref: 'jt8',
					worksite: 'Provinsi Jawa Timur/Kota Pasuruan',
					sector: '62019',
					wage: 3_555_301,
					c: [71_106, 131_546, 35_553, 71_106, 8_533, 10_666, 35_553, 142_212, 0]
				},
				{
					ref: 'jt9',
					worksite: 'Provinsi Jawa Timur/Kabupaten Jombang',
					sector: '62019',
					wage: 3_320_770,
					c: [66_415, 122_868, 33_208, 66_415, 7_970, 9_962, 33_208, 132_831, 0]
				},
				{
					ref: 'jt10',
					worksite: 'Provinsi Jawa Timur/Kabupaten Tuban',
					sector: '62019',
					wage: 3_229_092,
					c: [64_582, 119_476, 32_291, 64_582, 7_750, 9_687, 32_291, 129_164, 0]
				},
				{
					ref: 'jt11',
					worksite: 'Provinsi Jawa Timur/Kota Mojokerto',
					sector: '62019',
					wage: 3_208_556,
					c: [64_171, 118_717, 32_086, 64_171, 7_701, 9_626, 32_086, 128_342, 0]
				},
				{
					ref: 'jt12',
					worksite: 'Provinsi Jawa Timur/Kabupaten Lamongan',
					sector: '62019',
					wage: 3_196_328,
					c: [63_927, 118_264, 31_963, 63_927, 7_671, 9_589, 31_963, 127_853, 0]
				},
				{
					ref: 'jt13',
					worksite: 'Provinsi Jawa Timur/Kabupaten Probolinggo',
					sector: '62019',
					wage: 3_164_526,
					c: [63_291, 117_087, 31_645, 63_291, 7_595, 9_494, 31_645, 126_581, 0]
				},
				{
					ref: 'jt14',
					worksite: 'Provinsi Jawa Timur/Kota Probolinggo',
					sector: '62019',
					wage: 3_045_172,
					c: [60_903, 112_671, 30_452, 60_903, 7_308, 9_136, 30_452, 121_807, 0]
				},
				{
					ref: 'jt15',
					worksite: 'Provinsi Jawa Timur/Kabupaten Jember',
					sector: '62019',
					wage: 3_012_197,
					c: [60_244, 111_451, 30_122, 60_244, 7_229, 9_037, 30_122, 120_488, 0]
				},
				{
					ref: 'jt16',
					worksite: 'Provinsi Jawa Timur/Kabupaten Banyuwangi',
					sector: '62019',
					wage: 2_989_145,
					c: [59_783, 110_598, 29_891, 59_783, 7_174, 8_967, 29_891, 119_566, 0]
				},
				{
					ref: 'jt17',
					worksite: 'Provinsi Jawa Timur/Kota Kediri',
					sector: '62019',
					wage: 2_742_806,
					c: [54_856, 101_484, 27_428, 54_856, 6_583, 8_228, 27_428, 109_712, 0]
				},
				{
					ref: 'jt18',
					worksite: 'Provinsi Jawa Timur/Kabupaten Bojonegoro',
					sector: '62019',
					wage: 2_685_983,
					c: [53_720, 99_381, 26_860, 53_720, 6_446, 8_058, 26_860, 107_439, 0]
				},
				{
					ref: 'jt19',
					worksite: 'Provinsi Jawa Timur/Kabupaten Kediri',
					sector: '62019',
					wage: 2_651_603,
					c: [53_032, 98_109, 26_516, 53_032, 6_364, 7_955, 26_516, 106_064, 0]
				},
				{
					ref: 'jt20',
					worksite: 'Provinsi Jawa Timur/Kota Blitar',
					sector: '62019',
					wage: 2_639_518,
					c: [52_790, 97_662, 26_395, 52_790, 6_335, 7_919, 26_395, 105_581, 0]
				},
				{
					ref: 'jt21',
					worksite: 'Provinsi Jawa Timur/Kabupaten Tulungagung',
					sector: '62019',
					wage: 2_628_190,
					c: [52_564, 97_243, 26_282, 52_564, 6_308, 7_885, 26_282, 105_128, 0]
				},
				{
					ref: 'jt22',
					worksite: 'Provinsi Jawa Timur/Kota Madiun',
					sector: '62019',
					wage: 2_588_794,
					c: [51_776, 95_785, 25_888, 51_776, 6_213, 7_766, 25_888, 103_552, 0]
				},
				{
					ref: 'jt23',
					worksite: 'Provinsi Jawa Timur/Kabupaten Lumajang',
					sector: '62019',
					wage: 2_578_320,
					c: [51_566, 95_398, 25_783, 51_566, 6_188, 7_735, 25_783, 103_133, 0]
				},
				{
					ref: 'jt24',
					worksite: 'Provinsi Jawa Timur/Kabupaten Blitar',
					sector: '62019',
					wage: 2_567_744,
					c: [51_355, 95_007, 25_677, 51_355, 6_163, 7_703, 25_677, 102_710, 0]
				},
				{
					ref: 'jt25',
					worksite: 'Provinsi Jawa Timur/Kabupaten Nganjuk',
					sector: '62019',
					wage: 2_564_627,
					c: [51_293, 94_891, 25_646, 51_293, 6_155, 7_694, 25_646, 102_585, 0]
				},
				{
					ref: 'jt26',
					worksite: 'Provinsi Jawa Timur/Kabupaten Ngawi',
					sector: '62019',
					wage: 2_556_815,
					c: [51_136, 94_602, 25_568, 51_136, 6_136, 7_670, 25_568, 102_273, 0]
				},
				{
					ref: 'jt27',
					worksite: 'Provinsi Jawa Timur/Kabupaten Magetan',
					sector: '62019',
					wage: 2_553_866,
					c: [51_077, 94_493, 25_539, 51_077, 6_129, 7_662, 25_539, 102_155, 0]
				},
				{
					ref: 'jt28',
					worksite: 'Provinsi Jawa Timur/Kabupaten Sumenep',
					sector: '62019',
					wage: 2_553_688,
					c: [51_074, 94_486, 25_537, 51_074, 6_129, 7_661, 25_537, 102_148, 0]
				},
				{
					ref: 'jt29',
					worksite: 'Provinsi Jawa Timur/Kabupaten Madiun',
					sector: '62019',
					wage: 2_553_221,
					c: [51_064, 94_469, 25_532, 51_064, 6_128, 7_660, 25_532, 102_129, 0]
				},
				{
					ref: 'jt30',
					worksite: 'Provinsi Jawa Timur/Kabupaten Bangkalan',
					sector: '62019',
					wage: 2_550_274,
					c: [51_005, 94_360, 25_503, 51_005, 6_121, 7_651, 25_503, 102_011, 0]
				},
				{
					ref: 'jt31',
					worksite: 'Provinsi Jawa Timur/Kabupaten Ponorogo',
					sector: '62019',
					wage: 2_549_876,
					c: [50_998, 94_345, 25_499, 50_998, 6_120, 7_650, 25_499, 101_995, 0]
				},
				{
					ref: 'jt32',
					worksite: 'Provinsi Jawa Timur/Kabupaten Trenggalek',
					sector: '62019',
					wage: 2_530_313,
					c: [50_606, 93_622, 25_303, 50_606, 6_073, 7_591, 25_303, 101_213, 0]
				},
				{
					ref: 'jt33',
					worksite: 'Provinsi Jawa Timur/Kabupaten Pamekasan',
					sector: '62019',
					wage: 2_528_004,
					c: [50_560, 93_536, 25_280, 50_560, 6_067, 7_584, 25_280, 101_120, 0]
				},
				{
					ref: 'jt34',
					worksite: 'Provinsi Jawa Timur/Kabupaten Pacitan',
					sector: '62019',
					wage: 2_514_892,
					c: [50_298, 93_051, 25_149, 50_298, 6_036, 7_545, 25_149, 100_596, 0]
				},
				{
					ref: 'jt35',
					worksite: 'Provinsi Jawa Timur/Kabupaten Bondowoso',
					sector: '62019',
					wage: 2_496_886,
					c: [49_938, 92_385, 24_969, 49_938, 5_993, 7_491, 24_969, 99_875, 0]
				},
				{
					ref: 'jt36',
					worksite: 'Provinsi Jawa Timur/Kabupaten Sampang',
					sector: '62019',
					wage: 2_484_443,
					c: [49_689, 91_924, 24_844, 49_689, 5_963, 7_453, 24_844, 99_378, 0]
				},
				{
					ref: 'jt37',
					worksite: 'Provinsi Jawa Timur/Kabupaten Situbondo',
					sector: '62019',
					wage: 2_483_962,
					c: [49_679, 91_907, 24_840, 49_679, 5_962, 7_452, 24_840, 99_358, 0]
				}
			]
		),
		floorCase(
			'ID-83-3',
			'Central Java 2026: the 34 UMKs other than Kota Semarang, each worker paid exactly its floor at KBLI 62019 (in no UMSK row), February 2026.',
			[
				'Central Java Kep. Gubernur 100.3.3.1/505/2025 (signed 24 Dec 2025, from 1 Jan 2026), all 35 UMKs re-read 2026-09-30 from the authenticated PDF (https://jdih.jatengprov.go.id/produk_hukum/kepgub/sk_100.3.3.1-505_th_2025_auten.pdf)',
				'Every figure: JHT 2% / 3.7%, JP 1% / 2%, JKK group I 0.24%, JKM 0.30%, Kesehatan 1% / 4% of the floor wage, each half-up to the rupiah; PPh 21 TER A on wage + JKK + JKM + Kesehatan employer (0% to Rp5,400,000; 0.25% to 5,650,000; 0.5% to 5,950,000; 0.75% to 6,300,000)'
			],
			'2026-02',
			'Provinsi Jawa Tengah/Kabupaten Cilacap',
			[
				{
					ref: 'jg0',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Cilacap',
					sector: '62019',
					wage: 2_773_184,
					c: [55_464, 102_608, 27_732, 55_464, 6_656, 8_320, 27_732, 110_927, 0]
				},
				{
					ref: 'jg1',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Banyumas',
					sector: '62019',
					wage: 2_474_598.99,
					c: [49_492, 91_560, 24_746, 49_492, 5_939, 7_424, 24_746, 98_984, 0]
				},
				{
					ref: 'jg2',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Purbalingga',
					sector: '62019',
					wage: 2_474_721.94,
					c: [49_494, 91_565, 24_747, 49_494, 5_939, 7_424, 24_747, 98_989, 0]
				},
				{
					ref: 'jg3',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Banjarnegara',
					sector: '62019',
					wage: 2_327_813.08,
					c: [46_556, 86_129, 23_278, 46_556, 5_587, 6_983, 23_278, 93_113, 0]
				},
				{
					ref: 'jg4',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Kebumen',
					sector: '62019',
					wage: 2_400_000,
					c: [48_000, 88_800, 24_000, 48_000, 5_760, 7_200, 24_000, 96_000, 0]
				},
				{
					ref: 'jg5',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Purworejo',
					sector: '62019',
					wage: 2_401_961.91,
					c: [48_039, 88_873, 24_020, 48_039, 5_765, 7_206, 24_020, 96_078, 0]
				},
				{
					ref: 'jg6',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Wonosobo',
					sector: '62019',
					wage: 2_455_038.01,
					c: [49_101, 90_836, 24_550, 49_101, 5_892, 7_365, 24_550, 98_202, 0]
				},
				{
					ref: 'jg7',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Magelang',
					sector: '62019',
					wage: 2_607_790,
					c: [52_156, 96_488, 26_078, 52_156, 6_259, 7_823, 26_078, 104_312, 0]
				},
				{
					ref: 'jg8',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Boyolali',
					sector: '62019',
					wage: 2_537_949,
					c: [50_759, 93_904, 25_379, 50_759, 6_091, 7_614, 25_379, 101_518, 0]
				},
				{
					ref: 'jg9',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Klaten',
					sector: '62019',
					wage: 2_538_691,
					c: [50_774, 93_932, 25_387, 50_774, 6_093, 7_616, 25_387, 101_548, 0]
				},
				{
					ref: 'jg10',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Sukoharjo',
					sector: '62019',
					wage: 2_500_000,
					c: [50_000, 92_500, 25_000, 50_000, 6_000, 7_500, 25_000, 100_000, 0]
				},
				{
					ref: 'jg11',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Wonogiri',
					sector: '62019',
					wage: 2_335_126,
					c: [46_703, 86_400, 23_351, 46_703, 5_604, 7_005, 23_351, 93_405, 0]
				},
				{
					ref: 'jg12',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Karanganyar',
					sector: '62019',
					wage: 2_592_154.06,
					c: [51_843, 95_910, 25_922, 51_843, 6_221, 7_776, 25_922, 103_686, 0]
				},
				{
					ref: 'jg13',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Sragen',
					sector: '62019',
					wage: 2_337_700,
					c: [46_754, 86_495, 23_377, 46_754, 5_610, 7_013, 23_377, 93_508, 0]
				},
				{
					ref: 'jg14',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Grobogan',
					sector: '62019',
					wage: 2_399_186,
					c: [47_984, 88_770, 23_992, 47_984, 5_758, 7_198, 23_992, 95_967, 0]
				},
				{
					ref: 'jg15',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Blora',
					sector: '62019',
					wage: 2_345_695,
					c: [46_914, 86_791, 23_457, 46_914, 5_630, 7_037, 23_457, 93_828, 0]
				},
				{
					ref: 'jg16',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Rembang',
					sector: '62019',
					wage: 2_386_305,
					c: [47_726, 88_293, 23_863, 47_726, 5_727, 7_159, 23_863, 95_452, 0]
				},
				{
					ref: 'jg17',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Pati',
					sector: '62019',
					wage: 2_485_000,
					c: [49_700, 91_945, 24_850, 49_700, 5_964, 7_455, 24_850, 99_400, 0]
				},
				{
					ref: 'jg18',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Kudus',
					sector: '62019',
					wage: 2_818_585,
					c: [56_372, 104_288, 28_186, 56_372, 6_765, 8_456, 28_186, 112_743, 0]
				},
				{
					ref: 'jg19',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Jepara',
					sector: '62019',
					wage: 2_756_501,
					c: [55_130, 101_991, 27_565, 55_130, 6_616, 8_270, 27_565, 110_260, 0]
				},
				{
					ref: 'jg20',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Demak',
					sector: '62019',
					wage: 3_122_805,
					c: [62_456, 115_544, 31_228, 62_456, 7_495, 9_368, 31_228, 124_912, 0]
				},
				{
					ref: 'jg21',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Semarang',
					sector: '62019',
					wage: 2_940_088,
					c: [58_802, 108_783, 29_401, 58_802, 7_056, 8_820, 29_401, 117_604, 0]
				},
				{
					ref: 'jg22',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Temanggung',
					sector: '62019',
					wage: 2_397_000,
					c: [47_940, 88_689, 23_970, 47_940, 5_753, 7_191, 23_970, 95_880, 0]
				},
				{
					ref: 'jg23',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Kendal',
					sector: '62019',
					wage: 2_992_994,
					c: [59_860, 110_741, 29_930, 59_860, 7_183, 8_979, 29_930, 119_720, 0]
				},
				{
					ref: 'jg24',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Batang',
					sector: '62019',
					wage: 2_708_520,
					c: [54_170, 100_215, 27_085, 54_170, 6_500, 8_126, 27_085, 108_341, 0]
				},
				{
					ref: 'jg25',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Pekalongan',
					sector: '62019',
					wage: 2_633_700,
					c: [52_674, 97_447, 26_337, 52_674, 6_321, 7_901, 26_337, 105_348, 0]
				},
				{
					ref: 'jg26',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Pemalang',
					sector: '62019',
					wage: 2_433_254,
					c: [48_665, 90_030, 24_333, 48_665, 5_840, 7_300, 24_333, 97_330, 0]
				},
				{
					ref: 'jg27',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Tegal',
					sector: '62019',
					wage: 2_484_162,
					c: [49_683, 91_914, 24_842, 49_683, 5_962, 7_452, 24_842, 99_366, 0]
				},
				{
					ref: 'jg28',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Brebes',
					sector: '62019',
					wage: 2_400_350.47,
					c: [48_007, 88_813, 24_004, 48_007, 5_761, 7_201, 24_004, 96_014, 0]
				},
				{
					ref: 'jg29',
					worksite: 'Provinsi Jawa Tengah/Kota Magelang',
					sector: '62019',
					wage: 2_429_285,
					c: [48_586, 89_884, 24_293, 48_586, 5_830, 7_288, 24_293, 97_171, 0]
				},
				{
					ref: 'jg30',
					worksite: 'Provinsi Jawa Tengah/Kota Surakarta',
					sector: '62019',
					wage: 2_570_000,
					c: [51_400, 95_090, 25_700, 51_400, 6_168, 7_710, 25_700, 102_800, 0]
				},
				{
					ref: 'jg31',
					worksite: 'Provinsi Jawa Tengah/Kota Salatiga',
					sector: '62019',
					wage: 2_698_273.24,
					c: [53_965, 99_836, 26_983, 53_965, 6_476, 8_095, 26_983, 107_931, 0]
				},
				{
					ref: 'jg33',
					worksite: 'Provinsi Jawa Tengah/Kota Pekalongan',
					sector: '62019',
					wage: 2_700_926,
					c: [54_019, 99_934, 27_009, 54_019, 6_482, 8_103, 27_009, 108_037, 0]
				},
				{
					ref: 'jg34',
					worksite: 'Provinsi Jawa Tengah/Kota Tegal',
					sector: '62019',
					wage: 2_526_510,
					c: [50_530, 93_481, 25_265, 50_530, 6_064, 7_580, 25_265, 101_060, 0]
				}
			]
		),
		floorCase(
			'ID-81-1',
			'Central Java December 2025: all 35 UMKs of 2025, each 1 December joiner paid exactly its floor at KBLI 62019 (outside the Semarang and Jepara UMSK rows).',
			[
				'Central Java Kep. Gubernur 561/45 Tahun 2024 (UMK 2025, from 1 Jan 2025), all 35 UMKs re-read 2026-09-30 from the signed PDF (https://jdih.jatengprov.go.id/produk_hukum/kepgub/sk_561-45_th_2024.pdf)',
				'Every figure: JHT 2% / 3.7%, JP 1% / 2%, JKK group I 0.24%, JKM 0.30%, Kesehatan 1% / 4% of the floor wage, each half-up to the rupiah; PPh 21 TER A on wage + JKK + JKM + Kesehatan employer (0% to Rp5,400,000; 0.25% to 5,650,000; 0.5% to 5,950,000; 0.75% to 6,300,000)'
			],
			'2025-12',
			'Provinsi Jawa Tengah/Kabupaten Cilacap',
			[
				{
					ref: 'jg0',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Cilacap',
					sector: '62019',
					wage: 2_640_248,
					c: [52_805, 97_689, 26_402, 52_805, 6_337, 7_921, 26_402, 105_610, 0]
				},
				{
					ref: 'jg1',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Banyumas',
					sector: '62019',
					wage: 2_338_410,
					c: [46_768, 86_521, 23_384, 46_768, 5_612, 7_015, 23_384, 93_536, 0]
				},
				{
					ref: 'jg2',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Purbalingga',
					sector: '62019',
					wage: 2_338_283.12,
					c: [46_766, 86_516, 23_383, 46_766, 5_612, 7_015, 23_383, 93_531, 0]
				},
				{
					ref: 'jg3',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Banjarnegara',
					sector: '62019',
					wage: 2_170_475.32,
					c: [43_410, 80_308, 21_705, 43_410, 5_209, 6_511, 21_705, 86_819, 0]
				},
				{
					ref: 'jg4',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Kebumen',
					sector: '62019',
					wage: 2_259_873.55,
					c: [45_197, 83_615, 22_599, 45_197, 5_424, 6_780, 22_599, 90_395, 0]
				},
				{
					ref: 'jg5',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Purworejo',
					sector: '62019',
					wage: 2_265_937.67,
					c: [45_319, 83_840, 22_659, 45_319, 5_438, 6_798, 22_659, 90_638, 0]
				},
				{
					ref: 'jg6',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Wonosobo',
					sector: '62019',
					wage: 2_299_521.38,
					c: [45_990, 85_082, 22_995, 45_990, 5_519, 6_899, 22_995, 91_981, 0]
				},
				{
					ref: 'jg7',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Magelang',
					sector: '62019',
					wage: 2_467_488,
					c: [49_350, 91_297, 24_675, 49_350, 5_922, 7_402, 24_675, 98_700, 0]
				},
				{
					ref: 'jg8',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Boyolali',
					sector: '62019',
					wage: 2_396_598,
					c: [47_932, 88_674, 23_966, 47_932, 5_752, 7_190, 23_966, 95_864, 0]
				},
				{
					ref: 'jg9',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Klaten',
					sector: '62019',
					wage: 2_389_872.78,
					c: [47_797, 88_425, 23_899, 47_797, 5_736, 7_170, 23_899, 95_595, 0]
				},
				{
					ref: 'jg10',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Sukoharjo',
					sector: '62019',
					wage: 2_359_488,
					c: [47_190, 87_301, 23_595, 47_190, 5_663, 7_078, 23_595, 94_380, 0]
				},
				{
					ref: 'jg11',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Wonogiri',
					sector: '62019',
					wage: 2_180_587.5,
					c: [43_612, 80_682, 21_806, 43_612, 5_233, 6_542, 21_806, 87_224, 0]
				},
				{
					ref: 'jg12',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Karanganyar',
					sector: '62019',
					wage: 2_437_110,
					c: [48_742, 90_173, 24_371, 48_742, 5_849, 7_311, 24_371, 97_484, 0]
				},
				{
					ref: 'jg13',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Sragen',
					sector: '62019',
					wage: 2_182_200,
					c: [43_644, 80_741, 21_822, 43_644, 5_237, 6_547, 21_822, 87_288, 0]
				},
				{
					ref: 'jg14',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Grobogan',
					sector: '62019',
					wage: 2_254_090,
					c: [45_082, 83_401, 22_541, 45_082, 5_410, 6_762, 22_541, 90_164, 0]
				},
				{
					ref: 'jg15',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Blora',
					sector: '62019',
					wage: 2_238_430.85,
					c: [44_769, 82_822, 22_384, 44_769, 5_372, 6_715, 22_384, 89_537, 0]
				},
				{
					ref: 'jg16',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Rembang',
					sector: '62019',
					wage: 2_236_168.78,
					c: [44_723, 82_738, 22_362, 44_723, 5_367, 6_709, 22_362, 89_447, 0]
				},
				{
					ref: 'jg17',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Pati',
					sector: '62019',
					wage: 2_332_350,
					c: [46_647, 86_297, 23_324, 46_647, 5_598, 6_997, 23_324, 93_294, 0]
				},
				{
					ref: 'jg18',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Kudus',
					sector: '62019',
					wage: 2_680_485.72,
					c: [53_610, 99_178, 26_805, 53_610, 6_433, 8_041, 26_805, 107_219, 0]
				},
				{
					ref: 'jg19',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Jepara',
					sector: '62019',
					wage: 2_610_224,
					c: [52_204, 96_578, 26_102, 52_204, 6_265, 7_831, 26_102, 104_409, 0]
				},
				{
					ref: 'jg20',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Demak',
					sector: '62019',
					wage: 2_940_716,
					c: [58_814, 108_806, 29_407, 58_814, 7_058, 8_822, 29_407, 117_629, 0]
				},
				{
					ref: 'jg21',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Semarang',
					sector: '62019',
					wage: 2_750_136,
					c: [55_003, 101_755, 27_501, 55_003, 6_600, 8_250, 27_501, 110_005, 0]
				},
				{
					ref: 'jg22',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Temanggung',
					sector: '62019',
					wage: 2_246_850,
					c: [44_937, 83_133, 22_469, 44_937, 5_392, 6_741, 22_469, 89_874, 0]
				},
				{
					ref: 'jg23',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Kendal',
					sector: '62019',
					wage: 2_783_455.25,
					c: [55_669, 102_988, 27_835, 55_669, 6_680, 8_350, 27_835, 111_338, 0]
				},
				{
					ref: 'jg24',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Batang',
					sector: '62019',
					wage: 2_534_383,
					c: [50_688, 93_772, 25_344, 50_688, 6_083, 7_603, 25_344, 101_375, 0]
				},
				{
					ref: 'jg25',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Pekalongan',
					sector: '62019',
					wage: 2_486_653.59,
					c: [49_733, 92_006, 24_867, 49_733, 5_968, 7_460, 24_867, 99_466, 0]
				},
				{
					ref: 'jg26',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Pemalang',
					sector: '62019',
					wage: 2_296_140,
					c: [45_923, 84_957, 22_961, 45_923, 5_511, 6_888, 22_961, 91_846, 0]
				},
				{
					ref: 'jg27',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Tegal',
					sector: '62019',
					wage: 2_333_586.46,
					c: [46_672, 86_343, 23_336, 46_672, 5_601, 7_001, 23_336, 93_343, 0]
				},
				{
					ref: 'jg28',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Brebes',
					sector: '62019',
					wage: 2_239_801.5,
					c: [44_796, 82_873, 22_398, 44_796, 5_376, 6_719, 22_398, 89_592, 0]
				},
				{
					ref: 'jg29',
					worksite: 'Provinsi Jawa Tengah/Kota Magelang',
					sector: '62019',
					wage: 2_281_230,
					c: [45_625, 84_406, 22_812, 45_625, 5_475, 6_844, 22_812, 91_249, 0]
				},
				{
					ref: 'jg30',
					worksite: 'Provinsi Jawa Tengah/Kota Surakarta',
					sector: '62019',
					wage: 2_416_560,
					c: [48_331, 89_413, 24_166, 48_331, 5_800, 7_250, 24_166, 96_662, 0]
				},
				{
					ref: 'jg31',
					worksite: 'Provinsi Jawa Tengah/Kota Salatiga',
					sector: '62019',
					wage: 2_533_583,
					c: [50_672, 93_743, 25_336, 50_672, 6_081, 7_601, 25_336, 101_343, 0]
				},
				{
					ref: 'jg32',
					worksite: 'Provinsi Jawa Tengah/Kota Semarang',
					sector: '62019',
					wage: 3_454_827,
					c: [69_097, 127_829, 34_548, 69_097, 8_292, 10_364, 34_548, 138_193, 0]
				},
				{
					ref: 'jg33',
					worksite: 'Provinsi Jawa Tengah/Kota Pekalongan',
					sector: '62019',
					wage: 2_545_138,
					c: [50_903, 94_170, 25_451, 50_903, 6_108, 7_635, 25_451, 101_806, 0]
				},
				{
					ref: 'jg34',
					worksite: 'Provinsi Jawa Tengah/Kota Tegal',
					sector: '62019',
					wage: 2_376_683.82,
					c: [47_534, 87_937, 23_767, 47_534, 5_704, 7_130, 23_767, 95_067, 0]
				}
			]
		),
		floorCase(
			'ID-138-3',
			'Banten 2026: seven UMKs at their floors at KBLI 62019 — Pandeglang and Kota Serang (no UMSK) and the five UMSK localities where 62019 is an attested ordinary sector; Tangerang Selatan stays strict (ID-176-1).',
			[
				'Banten Kep. Gubernur 703/2025 (UMK 2026, from 1 Jan 2026) with its 2025 comparison column, re-read 2026-09-30 from the signed PDF (https://ppid.bantenprov.go.id/informasi-publik/download/kepgub-banten-upah-minimum-kabupaten-dan-kota-tahun-2026-202512241557.pdf); KBLI 62019 is the attested ordinary sector at the six UMSK localities (tracker ID-138, ID-173)',
				'Every figure: JHT 2% / 3.7%, JP 1% / 2%, JKK group I 0.24%, JKM 0.30%, Kesehatan 1% / 4% of the floor wage, each half-up to the rupiah; PPh 21 TER A on wage + JKK + JKM + Kesehatan employer (0% to Rp5,400,000; 0.25% to 5,650,000; 0.5% to 5,950,000; 0.75% to 6,300,000)'
			],
			'2026-02',
			'Provinsi Banten/Kabupaten Pandeglang',
			[
				{
					ref: 'bt0',
					worksite: 'Provinsi Banten/Kabupaten Pandeglang',
					sector: '62019',
					wage: 3_360_078.06,
					c: [67_202, 124_323, 33_601, 67_202, 8_064, 10_080, 33_601, 134_403, 0]
				},
				{
					ref: 'bt1',
					worksite: 'Provinsi Banten/Kabupaten Lebak',
					sector: '62019',
					wage: 3_330_010.62,
					c: [66_600, 123_210, 33_300, 66_600, 7_992, 9_990, 33_300, 133_200, 0]
				},
				{
					ref: 'bt2',
					worksite: 'Provinsi Banten/Kabupaten Tangerang',
					sector: '62019',
					wage: 5_210_377,
					c: [104_208, 192_784, 52_104, 104_208, 12_505, 15_631, 52_104, 208_415, 13_617]
				},
				{
					ref: 'bt3',
					worksite: 'Provinsi Banten/Kabupaten Serang',
					sector: '62019',
					wage: 5_178_521.19,
					c: [103_570, 191_605, 51_785, 103_570, 12_428, 15_536, 51_785, 207_141, 13_534]
				},
				{
					ref: 'bt4',
					worksite: 'Provinsi Banten/Kota Tangerang',
					sector: '62019',
					wage: 5_399_405.69,
					c: [107_988, 199_778, 53_994, 107_988, 12_959, 16_198, 53_994, 215_976, 14_111]
				},
				{
					ref: 'bt5',
					worksite: 'Provinsi Banten/Kota Cilegon',
					sector: '62019',
					wage: 5_469_922.59,
					c: [109_398, 202_387, 54_699, 109_398, 13_128, 16_410, 54_699, 218_797, 28_591]
				},
				{
					ref: 'bt6',
					worksite: 'Provinsi Banten/Kota Serang',
					sector: '62019',
					wage: 4_665_927.94,
					c: [93_319, 172_639, 46_659, 93_319, 11_198, 13_998, 46_659, 186_637, 0]
				}
			]
		),
		floorCase(
			'ID-137-3',
			'Lampung 2026: Metro, Lampung Selatan, Way Kanan and Mesuji UMKs at their floors at KBLI 62019, February 2026.',
			[
				'Lampung 2026 UMKs as seeded from the signed decisions (JDIH Lampung 11562–11566; tracker ID-137, not re-read in this round)',
				'Every figure: JHT 2% / 3.7%, JP 1% / 2%, JKK group I 0.24%, JKM 0.30%, Kesehatan 1% / 4% of the floor wage, each half-up to the rupiah; PPh 21 TER A on wage + JKK + JKM + Kesehatan employer (0% to Rp5,400,000; 0.25% to 5,650,000; 0.5% to 5,950,000; 0.75% to 6,300,000)'
			],
			'2026-02',
			'Provinsi Lampung/Kota Metro',
			[
				{
					ref: 'lp1',
					worksite: 'Provinsi Lampung/Kota Metro',
					sector: '62019',
					wage: 3_050_498,
					c: [61_010, 112_868, 30_505, 61_010, 7_321, 9_151, 30_505, 122_020, 0]
				},
				{
					ref: 'lp2',
					worksite: 'Provinsi Lampung/Kabupaten Lampung Selatan',
					sector: '62019',
					wage: 3_219_609,
					c: [64_392, 119_126, 32_196, 64_392, 7_727, 9_659, 32_196, 128_784, 0]
				},
				{
					ref: 'lp3',
					worksite: 'Provinsi Lampung/Kabupaten Way Kanan',
					sector: '62019',
					wage: 3_215_764,
					c: [64_315, 118_983, 32_158, 64_315, 7_718, 9_647, 32_158, 128_631, 0]
				},
				{
					ref: 'lp4',
					worksite: 'Provinsi Lampung/Kabupaten Mesuji',
					sector: '62019',
					wage: 3_227_333,
					c: [64_547, 119_411, 32_273, 64_547, 7_746, 9_682, 32_273, 129_093, 0]
				}
			]
		),
		floorCase(
			'ID-137-4',
			'Lampung December 2025: the five 2025 UMKs and the ten UMP-valued regencies, each 1 December joiner at its floor at KBLI 62019.',
			[
				'Lampung 2025: UMP Rp2,893,070 (Kep.G/835/2024), five UMKs and ten expressly UMP-valued regencies as seeded (tracker ID-137, not re-read in this round)',
				'Every figure: JHT 2% / 3.7%, JP 1% / 2%, JKK group I 0.24%, JKM 0.30%, Kesehatan 1% / 4% of the floor wage, each half-up to the rupiah; PPh 21 TER A on wage + JKK + JKM + Kesehatan employer (0% to Rp5,400,000; 0.25% to 5,650,000; 0.5% to 5,950,000; 0.75% to 6,300,000)'
			],
			'2025-12',
			'Provinsi Lampung/Kota Bandar Lampung',
			[
				{
					ref: 'lp0',
					worksite: 'Provinsi Lampung/Kota Bandar Lampung',
					sector: '62019',
					wage: 3_305_367,
					c: [66_107, 122_299, 33_054, 66_107, 7_933, 9_916, 33_054, 132_215, 0]
				},
				{
					ref: 'lp1',
					worksite: 'Provinsi Lampung/Kota Metro',
					sector: '62019',
					wage: 2_903_301,
					c: [58_066, 107_422, 29_033, 58_066, 6_968, 8_710, 29_033, 116_132, 0]
				},
				{
					ref: 'lp2',
					worksite: 'Provinsi Lampung/Kabupaten Lampung Selatan',
					sector: '62019',
					wage: 3_076_990,
					c: [61_540, 113_849, 30_770, 61_540, 7_385, 9_231, 30_770, 123_080, 0]
				},
				{
					ref: 'lp3',
					worksite: 'Provinsi Lampung/Kabupaten Way Kanan',
					sector: '62019',
					wage: 3_072_655,
					c: [61_453, 113_688, 30_727, 61_453, 7_374, 9_218, 30_727, 122_906, 0]
				},
				{
					ref: 'lp4',
					worksite: 'Provinsi Lampung/Kabupaten Mesuji',
					sector: '62019',
					wage: 3_092_026,
					c: [61_841, 114_405, 30_920, 61_841, 7_421, 9_276, 30_920, 123_681, 0]
				},
				{
					ref: 'lp5',
					worksite: 'Provinsi Lampung/Kabupaten Pesawaran',
					sector: '62019',
					wage: 2_893_070,
					c: [57_861, 107_044, 28_931, 57_861, 6_943, 8_679, 28_931, 115_723, 0]
				},
				{
					ref: 'lp6',
					worksite: 'Provinsi Lampung/Kabupaten Pringsewu',
					sector: '62019',
					wage: 2_893_070,
					c: [57_861, 107_044, 28_931, 57_861, 6_943, 8_679, 28_931, 115_723, 0]
				},
				{
					ref: 'lp7',
					worksite: 'Provinsi Lampung/Kabupaten Tulang Bawang',
					sector: '62019',
					wage: 2_893_070,
					c: [57_861, 107_044, 28_931, 57_861, 6_943, 8_679, 28_931, 115_723, 0]
				},
				{
					ref: 'lp8',
					worksite: 'Provinsi Lampung/Kabupaten Tulang Bawang Barat',
					sector: '62019',
					wage: 2_893_070,
					c: [57_861, 107_044, 28_931, 57_861, 6_943, 8_679, 28_931, 115_723, 0]
				},
				{
					ref: 'lp9',
					worksite: 'Provinsi Lampung/Kabupaten Pesisir Barat',
					sector: '62019',
					wage: 2_893_070,
					c: [57_861, 107_044, 28_931, 57_861, 6_943, 8_679, 28_931, 115_723, 0]
				},
				{
					ref: 'lp10',
					worksite: 'Provinsi Lampung/Kabupaten Lampung Tengah',
					sector: '62019',
					wage: 2_893_070,
					c: [57_861, 107_044, 28_931, 57_861, 6_943, 8_679, 28_931, 115_723, 0]
				},
				{
					ref: 'lp11',
					worksite: 'Provinsi Lampung/Kabupaten Lampung Timur',
					sector: '62019',
					wage: 2_893_070,
					c: [57_861, 107_044, 28_931, 57_861, 6_943, 8_679, 28_931, 115_723, 0]
				},
				{
					ref: 'lp12',
					worksite: 'Provinsi Lampung/Kabupaten Lampung Utara',
					sector: '62019',
					wage: 2_893_070,
					c: [57_861, 107_044, 28_931, 57_861, 6_943, 8_679, 28_931, 115_723, 0]
				},
				{
					ref: 'lp13',
					worksite: 'Provinsi Lampung/Kabupaten Tanggamus',
					sector: '62019',
					wage: 2_893_070,
					c: [57_861, 107_044, 28_931, 57_861, 6_943, 8_679, 28_931, 115_723, 0]
				},
				{
					ref: 'lp14',
					worksite: 'Provinsi Lampung/Kabupaten Lampung Barat',
					sector: '62019',
					wage: 2_893_070,
					c: [57_861, 107_044, 28_931, 57_861, 6_943, 8_679, 28_931, 115_723, 0]
				}
			]
		),
		floorCase(
			'ID-139-3',
			'DI Yogyakarta 2026: Kulon Progo, Bantul and Sleman UMKs at their floors at KBLI 62019, February 2026.',
			[
				'DI Yogyakarta UMKs as seeded (Kep. Gubernur DIY 443/2025 for 2026 per the Disnakertrans announcement, https://nakertrans.jogjaprov.go.id/berita/detail/ump-dan-umk-diy-tahun-2026-resmi-ditetapkan-berlaku-mulai-1-januari-2026; 2025 figures per tracker ID-139, not re-read in this round)',
				'Every figure: JHT 2% / 3.7%, JP 1% / 2%, JKK group I 0.24%, JKM 0.30%, Kesehatan 1% / 4% of the floor wage, each half-up to the rupiah; PPh 21 TER A on wage + JKK + JKM + Kesehatan employer (0% to Rp5,400,000; 0.25% to 5,650,000; 0.5% to 5,950,000; 0.75% to 6,300,000)'
			],
			'2026-02',
			'Provinsi DI Yogyakarta/Kabupaten Sleman',
			[
				{
					ref: 'dy1',
					worksite: 'Provinsi DI Yogyakarta/Kabupaten Kulon Progo',
					sector: '62019',
					wage: 2_504_520,
					c: [50_090, 92_667, 25_045, 50_090, 6_011, 7_514, 25_045, 100_181, 0]
				},
				{
					ref: 'dy2',
					worksite: 'Provinsi DI Yogyakarta/Kabupaten Bantul',
					sector: '62019',
					wage: 2_509_001,
					c: [50_180, 92_833, 25_090, 50_180, 6_022, 7_527, 25_090, 100_360, 0]
				},
				{
					ref: 'dy3',
					worksite: 'Provinsi DI Yogyakarta/Kabupaten Sleman',
					sector: '62019',
					wage: 2_624_387,
					c: [52_488, 97_102, 26_244, 52_488, 6_299, 7_873, 26_244, 104_975, 0]
				}
			]
		),
		floorCase(
			'ID-139-4',
			'DI Yogyakarta December 2025: all five 2025 UMKs, each 1 December joiner at its floor at KBLI 62019.',
			[
				'DI Yogyakarta UMKs as seeded (Kep. Gubernur DIY 443/2025 for 2026 per the Disnakertrans announcement, https://nakertrans.jogjaprov.go.id/berita/detail/ump-dan-umk-diy-tahun-2026-resmi-ditetapkan-berlaku-mulai-1-januari-2026; 2025 figures per tracker ID-139, not re-read in this round)',
				'Every figure: JHT 2% / 3.7%, JP 1% / 2%, JKK group I 0.24%, JKM 0.30%, Kesehatan 1% / 4% of the floor wage, each half-up to the rupiah; PPh 21 TER A on wage + JKK + JKM + Kesehatan employer (0% to Rp5,400,000; 0.25% to 5,650,000; 0.5% to 5,950,000; 0.75% to 6,300,000)'
			],
			'2025-12',
			'Provinsi DI Yogyakarta/Kota Yogyakarta',
			[
				{
					ref: 'dy0',
					worksite: 'Provinsi DI Yogyakarta/Kabupaten Gunungkidul',
					sector: '62019',
					wage: 2_330_263.67,
					c: [46_605, 86_220, 23_303, 46_605, 5_593, 6_991, 23_303, 93_211, 0]
				},
				{
					ref: 'dy1',
					worksite: 'Provinsi DI Yogyakarta/Kabupaten Kulon Progo',
					sector: '62019',
					wage: 2_351_239.85,
					c: [47_025, 86_996, 23_512, 47_025, 5_643, 7_054, 23_512, 94_050, 0]
				},
				{
					ref: 'dy2',
					worksite: 'Provinsi DI Yogyakarta/Kabupaten Bantul',
					sector: '62019',
					wage: 2_360_533,
					c: [47_211, 87_340, 23_605, 47_211, 5_665, 7_082, 23_605, 94_421, 0]
				},
				{
					ref: 'dy3',
					worksite: 'Provinsi DI Yogyakarta/Kabupaten Sleman',
					sector: '62019',
					wage: 2_466_514.86,
					c: [49_330, 91_261, 24_665, 49_330, 5_920, 7_400, 24_665, 98_661, 0]
				},
				{
					ref: 'dy4',
					worksite: 'Provinsi DI Yogyakarta/Kota Yogyakarta',
					sector: '62019',
					wage: 2_655_041.81,
					c: [53_101, 98_237, 26_550, 53_101, 6_372, 7_965, 26_550, 106_202, 0]
				}
			]
		),
		floorCase(
			'ID-142-3',
			'West Kalimantan 2026: all 14 city/regency floors at KBLI 62019 (Kubu Raya at the UMK, not its UMSK), February 2026.',
			[
				'West Kalimantan 2026: UMKs Kep.1355/NAKERTRAN/2025 and Sekadau on the UMP Rp3,054,552 (Kep.1350/NAKERTRAN/2025) as seeded (https://disnakertrans.kalbarprov.go.id/peraturan/sk-ump-dan-umk-tahun-2026/, HTTP 403 on 2026-09-30, not re-read); KBLI 62019 is the attested ordinary sector at the six UMSK localities (tracker ID-142)',
				'Every figure: JHT 2% / 3.7%, JP 1% / 2%, JKK group I 0.24%, JKM 0.30%, Kesehatan 1% / 4% of the floor wage, each half-up to the rupiah; PPh 21 TER A on wage + JKK + JKM + Kesehatan employer (0% to Rp5,400,000; 0.25% to 5,650,000; 0.5% to 5,950,000; 0.75% to 6,300,000)'
			],
			'2026-02',
			'Provinsi Kalimantan Barat/Kota Pontianak',
			[
				{
					ref: 'kb0',
					worksite: 'Provinsi Kalimantan Barat/Kota Pontianak',
					sector: '62019',
					wage: 3_205_220,
					c: [64_104, 118_593, 32_052, 64_104, 7_693, 9_616, 32_052, 128_209, 0]
				},
				{
					ref: 'kb1',
					worksite: 'Provinsi Kalimantan Barat/Kabupaten Kubu Raya',
					sector: '62019',
					wage: 3_100_000,
					c: [62_000, 114_700, 31_000, 62_000, 7_440, 9_300, 31_000, 124_000, 0]
				},
				{
					ref: 'kb2',
					worksite: 'Provinsi Kalimantan Barat/Kabupaten Mempawah',
					sector: '62019',
					wage: 3_220_801,
					c: [64_416, 119_170, 32_208, 64_416, 7_730, 9_662, 32_208, 128_832, 0]
				},
				{
					ref: 'kb3',
					worksite: 'Provinsi Kalimantan Barat/Kota Singkawang',
					sector: '62019',
					wage: 3_247_387,
					c: [64_948, 120_153, 32_474, 64_948, 7_794, 9_742, 32_474, 129_895, 0]
				},
				{
					ref: 'kb4',
					worksite: 'Provinsi Kalimantan Barat/Kabupaten Sambas',
					sector: '62019',
					wage: 3_202_663,
					c: [64_053, 118_499, 32_027, 64_053, 7_686, 9_608, 32_027, 128_107, 0]
				},
				{
					ref: 'kb5',
					worksite: 'Provinsi Kalimantan Barat/Kabupaten Bengkayang',
					sector: '62019',
					wage: 3_252_580,
					c: [65_052, 120_345, 32_526, 65_052, 7_806, 9_758, 32_526, 130_103, 0]
				},
				{
					ref: 'kb6',
					worksite: 'Provinsi Kalimantan Barat/Kabupaten Landak',
					sector: '62019',
					wage: 3_211_256,
					c: [64_225, 118_816, 32_113, 64_225, 7_707, 9_634, 32_113, 128_450, 0]
				},
				{
					ref: 'kb7',
					worksite: 'Provinsi Kalimantan Barat/Kabupaten Sanggau',
					sector: '62019',
					wage: 3_121_747,
					c: [62_435, 115_505, 31_217, 62_435, 7_492, 9_365, 31_217, 124_870, 0]
				},
				{
					ref: 'kb8',
					worksite: 'Provinsi Kalimantan Barat/Kabupaten Melawi',
					sector: '62019',
					wage: 3_109_431,
					c: [62_189, 115_049, 31_094, 62_189, 7_463, 9_328, 31_094, 124_377, 0]
				},
				{
					ref: 'kb9',
					worksite: 'Provinsi Kalimantan Barat/Kabupaten Sintang',
					sector: '62019',
					wage: 3_187_965,
					c: [63_759, 117_955, 31_880, 63_759, 7_651, 9_564, 31_880, 127_519, 0]
				},
				{
					ref: 'kb10',
					worksite: 'Provinsi Kalimantan Barat/Kabupaten Kapuas Hulu',
					sector: '62019',
					wage: 3_106_259,
					c: [62_125, 114_932, 31_063, 62_125, 7_455, 9_319, 31_063, 124_250, 0]
				},
				{
					ref: 'kb11',
					worksite: 'Provinsi Kalimantan Barat/Kabupaten Ketapang',
					sector: '62019',
					wage: 3_561_801,
					c: [71_236, 131_787, 35_618, 71_236, 8_548, 10_685, 35_618, 142_472, 0]
				},
				{
					ref: 'kb12',
					worksite: 'Provinsi Kalimantan Barat/Kabupaten Kayong Utara',
					sector: '62019',
					wage: 3_370_586,
					c: [67_412, 124_712, 33_706, 67_412, 8_089, 10_112, 33_706, 134_823, 0]
				},
				{
					ref: 'kb13',
					worksite: 'Provinsi Kalimantan Barat/Kabupaten Sekadau',
					sector: '62019',
					wage: 3_054_552,
					c: [61_091, 113_018, 30_546, 61_091, 7_331, 9_164, 30_546, 122_182, 0]
				}
			]
		),
		floorCase(
			'ID-142-4',
			'West Kalimantan provincial UMSP 2026, KBLI 01262 (palm oil): at Sekadau the UMSP Rp3,062,552 binds above the UMP; at Kota Pontianak the higher UMK Rp3,205,220 binds.',
			[
				'West Kalimantan Kep.1350/NAKERTRAN/2025: provincial UMSP KBLI 01262/08101/10431 Rp3,062,552 for service under one year, above the Sekadau floor (the UMP Rp3,054,552); Kota Pontianak UMK Rp3,205,220 is higher than the UMSP (tracker ID-142; https://disnakertrans.kalbarprov.go.id/peraturan/sk-ump-dan-umk-tahun-2026/)',
				'Binding floor = the higher of the ordinary floor and every matching sector floor: PP 49/2025 art.35D (tracker ID-03)',
				'Every figure: JHT 2% / 3.7%, JP 1% / 2%, JKK group I 0.24%, JKM 0.30%, Kesehatan 1% / 4% of the floor wage, each half-up to the rupiah; PPh 21 TER A on wage + JKK + JKM + Kesehatan employer (0% to Rp5,400,000; 0.25% to 5,650,000; 0.5% to 5,950,000; 0.75% to 6,300,000)'
			],
			'2026-02',
			'Provinsi Kalimantan Barat/Kabupaten Sekadau',
			[
				{
					ref: 'umspsek',
					worksite: 'Provinsi Kalimantan Barat/Kabupaten Sekadau',
					sector: '01262',
					wage: 3_062_552,
					c: [61_251, 113_314, 30_626, 61_251, 7_350, 9_188, 30_626, 122_502, 0]
				},
				{
					ref: 'umsppnk',
					worksite: 'Provinsi Kalimantan Barat/Kota Pontianak',
					sector: '01262',
					wage: 3_205_220,
					c: [64_104, 118_593, 32_052, 64_104, 7_693, 9_616, 32_052, 128_209, 0]
				}
			]
		),
		floorCase(
			'ID-80-3',
			'East Java provincial UMSP 2026, KBLI 52107: at Situbondo the UMSP Rp2,571,426.91 binds above the UMK; at Kota Madiun the higher UMK Rp2,588,794 binds.',
			[
				'East Java Kep. Gubernur 935/2025: provincial UMSP 2026 for seven KBLI (incl. 52107) Rp2,571,426.91, service under one year (tracker ID-80); Kabupaten Situbondo UMK 2,483,962 is below it, Kota Madiun UMK 2,588,794 above it (Kep.937/013/2025, https://files.jdih.jatimprov.go.id/jdih-prod/uploads/topics/2025kg00350937.pdf)',
				'Binding floor = the higher of the ordinary floor and every matching sector floor: PP 49/2025 art.35D (tracker ID-03)',
				'Every figure: JHT 2% / 3.7%, JP 1% / 2%, JKK group I 0.24%, JKM 0.30%, Kesehatan 1% / 4% of the floor wage, each half-up to the rupiah; PPh 21 TER A on wage + JKK + JKM + Kesehatan employer (0% to Rp5,400,000; 0.25% to 5,650,000; 0.5% to 5,950,000; 0.75% to 6,300,000)'
			],
			'2026-02',
			'Provinsi Jawa Timur/Kabupaten Situbondo',
			[
				{
					ref: 'umspsit',
					worksite: 'Provinsi Jawa Timur/Kabupaten Situbondo',
					sector: '52107',
					wage: 2_571_426.91,
					c: [51_429, 95_143, 25_714, 51_429, 6_171, 7_714, 25_714, 102_857, 0]
				},
				{
					ref: 'umspmad',
					worksite: 'Provinsi Jawa Timur/Kota Madiun',
					sector: '52107',
					wage: 2_588_794,
					c: [51_776, 95_785, 25_888, 51_776, 6_213, 7_766, 25_888, 103_552, 0]
				}
			]
		),
		floorCase(
			'ID-54-5',
			'DKI Jakarta 2026 UMSP: eight further annex lines without an employer condition, each worker paid exactly its floor, February 2026.',
			[
				'DKI Kep.33/2026 annex (https://jdih.jakarta.go.id/dokumenPeraturanDirectory/0031/2026KEPGUB003133.pdf; tracker ID-54): 24201 Rp5,741,201; 20118 Rp5,844,336; 24101 Rp5,744,066; 27201 Rp5,759,723; 32202 Rp5,759,015; 27111 Rp5,812,808; 33151 Rp5,741,336; 58200 Rp5,754,720',
				'Service under one year (dictum KETIGA); binding floor = higher of the UMP Rp5,729,876 and the matching row',
				'Every figure: JHT 2% / 3.7%, JP 1% / 2%, JKK group I 0.24%, JKM 0.30%, Kesehatan 1% / 4% of the floor wage, each half-up to the rupiah; PPh 21 TER A on wage + JKK + JKM + Kesehatan employer (0% to Rp5,400,000; 0.25% to 5,650,000; 0.5% to 5,950,000; 0.75% to 6,300,000)'
			],
			'2026-02',
			'Provinsi DKI Jakarta',
			[
				{
					ref: 'dk0',
					worksite: 'Provinsi DKI Jakarta',
					sector: '24201',
					wage: 5_741_201,
					c: [114_824, 212_424, 57_412, 114_824, 13_779, 17_224, 57_412, 229_648, 45_014]
				},
				{
					ref: 'dk1',
					worksite: 'Provinsi DKI Jakarta',
					sector: '20118',
					wage: 5_844_336,
					c: [116_887, 216_240, 58_443, 116_887, 14_026, 17_533, 58_443, 233_773, 45_823]
				},
				{
					ref: 'dk2',
					worksite: 'Provinsi DKI Jakarta',
					sector: '24101',
					wage: 5_744_066,
					c: [114_881, 212_530, 57_441, 114_881, 13_786, 17_232, 57_441, 229_763, 45_036]
				},
				{
					ref: 'dk3',
					worksite: 'Provinsi DKI Jakarta',
					sector: '27201',
					wage: 5_759_723,
					c: [115_194, 213_110, 57_597, 115_194, 13_823, 17_279, 57_597, 230_389, 45_159]
				},
				{
					ref: 'dk4',
					worksite: 'Provinsi DKI Jakarta',
					sector: '32202',
					wage: 5_759_015,
					c: [115_180, 213_084, 57_590, 115_180, 13_822, 17_277, 57_590, 230_361, 45_154]
				},
				{
					ref: 'dk5',
					worksite: 'Provinsi DKI Jakarta',
					sector: '27111',
					wage: 5_812_808,
					c: [116_256, 215_074, 58_128, 116_256, 13_951, 17_438, 58_128, 232_512, 45_575]
				},
				{
					ref: 'dk6',
					worksite: 'Provinsi DKI Jakarta',
					sector: '33151',
					wage: 5_741_336,
					c: [114_827, 212_429, 57_413, 114_827, 13_779, 17_224, 57_413, 229_653, 45_015]
				},
				{
					ref: 'dk7',
					worksite: 'Provinsi DKI Jakarta',
					sector: '58200',
					wage: 5_754_720,
					c: [115_094, 212_925, 57_547, 115_094, 13_811, 17_264, 57_547, 230_189, 45_120]
				}
			]
		),
		floorCase(
			'ID-54-6',
			'DKI Jakarta 2026 UMSP conditional lines recorded true: an export-oriented garment maker (KBLI 14111) and a four-star hotel (KBLI 55110), each worker paid exactly its floor, February 2026.',
			[
				'DKI Kep.33/2026 annex (https://jdih.jakarta.go.id/dokumenPeraturanDirectory/0031/2026KEPGUB003133.pdf): 14111 export Rp5,831,497; 55110 four- or five-star hotel Rp5,803,839; tracker ID-54 owner default: the condition reads from the recorded company facts (umsp_export_oriented, umsp_hotel_star)',
				'Every figure: JHT 2% / 3.7%, JP 1% / 2%, JKK group I 0.24%, JKM 0.30%, Kesehatan 1% / 4% of the floor wage, each half-up to the rupiah; PPh 21 TER A on wage + JKK + JKM + Kesehatan employer (0% to Rp5,400,000; 0.25% to 5,650,000; 0.5% to 5,950,000; 0.75% to 6,300,000)'
			],
			'2026-02',
			'Provinsi DKI Jakarta',
			[
				{
					ref: 'dkx',
					worksite: 'Provinsi DKI Jakarta',
					sector: '14111',
					wage: 5_831_497,
					c: [116_630, 215_765, 58_315, 116_630, 13_996, 17_494, 58_315, 233_260, 45_722]
				},
				{
					ref: 'dkh',
					worksite: 'Provinsi DKI Jakarta',
					sector: '55110',
					wage: 5_803_839,
					c: [116_077, 214_742, 58_038, 116_077, 13_929, 17_412, 58_038, 232_154, 45_505]
				}
			],
			{ umsp_export_oriented: true, umsp_hotel_star: 4 }
		),
		floorCase(
			'ID-96-1',
			'West Java 2026: Kabupaten Bekasi UMK Rp5,938,885 at KBLI 62019 (the attested ordinary sector at a strict sector place), February 2026.',
			[
				'West Java Kep. Gubernur 862/2025 (UMK 2026): Kabupaten Bekasi Rp5,938,885 (tracker ID-96, https://jdih.jabarprov.go.id/page/eksekusi_download/32/2025kg00320862.pdf); KBLI 62019 is the attested ordinary sector there (tracker ID-173)',
				'Every figure: JHT 2% / 3.7%, JP 1% / 2%, JKK group I 0.24%, JKM 0.30%, Kesehatan 1% / 4% of the floor wage, each half-up to the rupiah; PPh 21 TER A on wage + JKK + JKM + Kesehatan employer (0% to Rp5,400,000; 0.25% to 5,650,000; 0.5% to 5,950,000; 0.75% to 6,300,000)'
			],
			'2026-02',
			'Provinsi Jawa Barat/Kabupaten Bekasi',
			[
				{
					ref: 'kbks',
					worksite: 'Provinsi Jawa Barat/Kabupaten Bekasi',
					sector: '62019',
					wage: 5_938_885,
					c: [118_778, 219_739, 59_389, 118_778, 14_253, 17_817, 59_389, 237_555, 46_564]
				}
			]
		),
		below(
			'ID-80-4',
			'East Java KBLI 52107 at Kabupaten Situbondo contracted a sen under the provincial UMSP (Rp2,571,426.90), February 2026: the sector floor binds above the UMK, so the run is refused.',
			[
				'East Java Kep. Gubernur 935/2025: provincial UMSP 2026 Rp2,571,426.91 for KBLI 52107, service under one year (tracker ID-80); the comparison is in sen (tracker ID-127)'
			],
			'2026-02',
			{
				ref: 'sitlow',
				worksite: 'Provinsi Jawa Timur/Kabupaten Situbondo',
				sector: '52107',
				wage: 2_571_426.9
			}
		),
		// ─── Round 11 (2026-09-30): further decree lines, conditions and boundaries ───────────────
		floorCase(
			'ID-54-7',
			'DKI Jakarta 2026 UMSP lines whose employer condition is recorded true — assets above Rp1 trillion (21012, 64121), export-oriented footwear (15201) and Astra group (29200, 30911) — each worker paid exactly its floor, February 2026.',
			[
				'DKI Kep.33/2026 annex (https://jdih.jakarta.go.id/dokumenPeraturanDirectory/0031/2026KEPGUB003133.pdf; tracker ID-54, figures as the tracker transcribed them — the signed PDF is a scan with no text layer, re-fetched 2026-09-30): 21012 assets above Rp1 trillion Rp5,741,201; 64121 assets above Rp1 trillion Rp5,872,985; 15201 export Rp5,872,985; 29200 Astra group Rp5,904,114; 30911 Astra group Rp5,943,938',
				'Service under one year (dictum KETIGA); binding floor = the higher of the UMP Rp5,729,876 and every matching row whose condition the employer records (tracker ID-54 owner default)',
				'Every figure: JHT 2% / 3.7%, JP 1% / 2%, JKK group I 0.24%, JKM 0.30%, Kesehatan 1% / 4% of the floor wage (above the workplace UMK, under the Rp12,000,000 cap), each half-up to the rupiah; PPh 21 TER A on wage + JKK + JKM + Kesehatan employer (PP 58/2023 Lampiran A: 0% to Rp5,400,000; 0.25% to 5,650,000; 0.5% to 5,950,000)'
			],
			'2026-02',
			'Provinsi DKI Jakarta',
			[
				{
					ref: 'dk8',
					worksite: 'Provinsi DKI Jakarta',
					sector: '21012',
					wage: 5_741_201,
					c: [114_824, 212_424, 57_412, 114_824, 13_779, 17_224, 57_412, 229_648, 45_014]
				},
				{
					ref: 'dk9',
					worksite: 'Provinsi DKI Jakarta',
					sector: '64121',
					wage: 5_872_985,
					c: [117_460, 217_300, 58_730, 117_460, 14_095, 17_619, 58_730, 234_919, 46_047]
				},
				{
					ref: 'dka',
					worksite: 'Provinsi DKI Jakarta',
					sector: '15201',
					wage: 5_872_985,
					c: [117_460, 217_300, 58_730, 117_460, 14_095, 17_619, 58_730, 234_919, 46_047]
				},
				{
					ref: 'dkb',
					worksite: 'Provinsi DKI Jakarta',
					sector: '29200',
					wage: 5_904_114,
					c: [118_082, 218_452, 59_041, 118_082, 14_170, 17_712, 59_041, 236_165, 46_291]
				},
				{
					ref: 'dkc',
					worksite: 'Provinsi DKI Jakarta',
					sector: '30911',
					wage: 5_943_938,
					c: [118_879, 219_926, 59_439, 118_879, 14_265, 17_832, 59_439, 237_758, 46_603]
				}
			],
			{ umsp_assets_over_1_trillion: true, umsp_export_oriented: true, umsp_astra_group: true }
		),
		floorCase(
			'ID-54-8',
			'The same DKI Jakarta KBLI 21012 and 29200 at an employer that records neither condition (assets not above Rp1 trillion, not Astra group), February 2026: the conditional UMSP rows do not bind, so the UMP Rp5,729,876 does.',
			[
				'DKI Kep.33/2026 annex: the 21012 and 29200 rows bind only “ASET DI ATAS 1 TRILIUN” and Astra-group employers (https://jdih.jakarta.go.id/dokumenPeraturanDirectory/0031/2026KEPGUB003133.pdf; tracker ID-54)',
				'DKI UMP 2026 Rp5,729,876: Kep. Gubernur DKI 1142/2025 (tracker ID-94)',
				'Every figure: JHT 2% / 3.7%, JP 1% / 2%, JKK group I 0.24%, JKM 0.30%, Kesehatan 1% / 4% of the floor wage (above the workplace UMK, under the Rp12,000,000 cap), each half-up to the rupiah; PPh 21 TER A on wage + JKK + JKM + Kesehatan employer (PP 58/2023 Lampiran A: 0% to Rp5,400,000; 0.25% to 5,650,000; 0.5% to 5,950,000; 0.75% to 6,300,000)'
			],
			'2026-02',
			'Provinsi DKI Jakarta',
			[
				{
					ref: 'dkf1',
					worksite: 'Provinsi DKI Jakarta',
					sector: '21012',
					wage: 5_729_876,
					c: [114_598, 212_005, 57_299, 114_598, 13_752, 17_190, 57_299, 229_195, 44_925]
				},
				{
					ref: 'dkf2',
					worksite: 'Provinsi DKI Jakarta',
					sector: '29200',
					wage: 5_729_876,
					c: [114_598, 212_005, 57_299, 114_598, 13_752, 17_190, 57_299, 229_195, 44_925]
				}
			],
			{ umsp_assets_over_1_trillion: false, umsp_export_oriented: false, umsp_astra_group: false }
		),
		floorCase(
			'ID-80-5',
			'East Java 2026 UMSK in the ten regencies beside Surabaya (Kep.938/2025), one listed KBLI each, each worker paid exactly its floor above the regency UMK, February 2026.',
			[
				'East Java Kep. Gubernur 100.3.3.1/938/013/2025 Lampiran (signed PDF https://files.jdih.jatimprov.go.id/jdih-prod/uploads/topics/2025kg00350938.pdf, re-read 2026-09-30): Sidoarjo 46691 Rp5.344.782; Gresik 55112 Rp5.348.757; Pasuruan 10520 Rp5.340.808; Mojokerto 32202 Rp5.328.887; Tuban 23941 Rp3.380.572; Madiun 30200 Rp2.686.460; Malang 21012 Rp3.938.160; Bangkalan 30111 Rp2.670.819; Probolinggo 35111 Rp3.317.559 (Banyuwangi is ID-172-2)',
				'East Java Kep.100.3.3.1/937/013/2025 (signed PDF https://files.jdih.jatimprov.go.id/jdih-prod/uploads/topics/2025kg00350937.pdf, re-read 2026-09-30): UMK Sidoarjo 5.191.541, Gresik 5.195.401, Pasuruan 5.187.681, Mojokerto 5.176.101, Tuban 3.229.092, Kabupaten Madiun 2.553.221, Kabupaten Malang 3.802.862, Bangkalan 2.550.274, Kabupaten Probolinggo 3.164.526 — each UMSK above it',
				'Every figure: JHT 2% / 3.7%, JP 1% / 2%, JKK group I 0.24%, JKM 0.30%, Kesehatan 1% / 4% of the floor wage (above the workplace UMK, under the Rp12,000,000 cap), each half-up to the rupiah; PPh 21 TER A on wage + JKK + JKM + Kesehatan employer (PP 58/2023 Lampiran A: 0% to Rp5,400,000; 0.25% to 5,650,000; 0.5% to 5,950,000)'
			],
			'2026-02',
			'Provinsi Jawa Timur/Kabupaten Sidoarjo',
			[
				{
					ref: 'sda',
					worksite: 'Provinsi Jawa Timur/Kabupaten Sidoarjo',
					sector: '46691',
					wage: 5_344_782,
					c: [106_896, 197_757, 53_448, 106_896, 12_827, 16_034, 53_448, 213_791, 13_969]
				},
				{
					ref: 'grs',
					worksite: 'Provinsi Jawa Timur/Kabupaten Gresik',
					sector: '55112',
					wage: 5_348_757,
					c: [106_975, 197_904, 53_488, 106_975, 12_837, 16_046, 53_488, 213_950, 13_979]
				},
				{
					ref: 'psr',
					worksite: 'Provinsi Jawa Timur/Kabupaten Pasuruan',
					sector: '10520',
					wage: 5_340_808,
					c: [106_816, 197_610, 53_408, 106_816, 12_818, 16_022, 53_408, 213_632, 13_958]
				},
				{
					ref: 'mjk',
					worksite: 'Provinsi Jawa Timur/Kabupaten Mojokerto',
					sector: '32202',
					wage: 5_328_887,
					c: [106_578, 197_169, 53_289, 106_578, 12_789, 15_987, 53_289, 213_155, 13_927]
				},
				{
					ref: 'tbn',
					worksite: 'Provinsi Jawa Timur/Kabupaten Tuban',
					sector: '23941',
					wage: 3_380_572,
					c: [67_611, 125_081, 33_806, 67_611, 8_113, 10_142, 33_806, 135_223, 0]
				},
				{
					ref: 'mdn',
					worksite: 'Provinsi Jawa Timur/Kabupaten Madiun',
					sector: '30200',
					wage: 2_686_460,
					c: [53_729, 99_399, 26_865, 53_729, 6_448, 8_059, 26_865, 107_458, 0]
				},
				{
					ref: 'mlg',
					worksite: 'Provinsi Jawa Timur/Kabupaten Malang',
					sector: '21012',
					wage: 3_938_160,
					c: [78_763, 145_712, 39_382, 78_763, 9_452, 11_814, 39_382, 157_526, 0]
				},
				{
					ref: 'bkl',
					worksite: 'Provinsi Jawa Timur/Kabupaten Bangkalan',
					sector: '30111',
					wage: 2_670_819,
					c: [53_416, 98_820, 26_708, 53_416, 6_410, 8_012, 26_708, 106_833, 0]
				},
				{
					ref: 'pbl',
					worksite: 'Provinsi Jawa Timur/Kabupaten Probolinggo',
					sector: '35111',
					wage: 3_317_559,
					c: [66_351, 122_750, 33_176, 66_351, 7_962, 9_953, 33_176, 132_702, 0]
				}
			]
		),
		floorCase(
			'ID-83-5',
			'Central Java 2026 UMSK of Cilacap, Demak, Kabupaten Semarang and Kabupaten Tegal, and the other two Kota Semarang groups, each worker paid exactly its floor, February 2026.',
			[
				'Central Java Kep. Gubernur 100.3.3.1/505/2025 Lampiran II (authenticated PDF https://jdih.jatengprov.go.id/produk_hukum/kepgub/sk_100.3.3.1-505_th_2025_auten.pdf, re-read 2026-09-30): Cilacap 35111 Rp2.800.916; Demak 25920 Rp3.137.685; Kabupaten Semarang 08109 Rp2.955.088 and 46610 Rp2.950.088; Kota Semarang 15201 Rp3.707.534 and 22220 Rp3.703.651; Tegal 15201 Rp2.495.993 and 31009 Rp2.490.077; each above its Lampiran I UMK (Cilacap 2.773.184, Demak 3.122.805, Kabupaten Semarang 2.940.088, Kota Semarang 3.701.709, Tegal 2.484.162)',
				'Every figure: JHT 2% / 3.7%, JP 1% / 2%, JKK group I 0.24%, JKM 0.30%, Kesehatan 1% / 4% of the floor wage (above the workplace UMK, under the Rp12,000,000 cap), each half-up to the rupiah; PPh 21 TER A on wage + JKK + JKM + Kesehatan employer (PP 58/2023 Lampiran A: 0% to Rp5,400,000; 0.25% to 5,650,000; 0.5% to 5,950,000)'
			],
			'2026-02',
			'Provinsi Jawa Tengah/Kabupaten Demak',
			[
				{
					ref: 'clp',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Cilacap',
					sector: '35111',
					wage: 2_800_916,
					c: [56_018, 103_634, 28_009, 56_018, 6_722, 8_403, 28_009, 112_037, 0]
				},
				{
					ref: 'dmk',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Demak',
					sector: '25920',
					wage: 3_137_685,
					c: [62_754, 116_094, 31_377, 62_754, 7_530, 9_413, 31_377, 125_507, 0]
				},
				{
					ref: 'smgk',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Semarang',
					sector: '08109',
					wage: 2_955_088,
					c: [59_102, 109_338, 29_551, 59_102, 7_092, 8_865, 29_551, 118_204, 0]
				},
				{
					ref: 'smgk2',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Semarang',
					sector: '46610',
					wage: 2_950_088,
					c: [59_002, 109_153, 29_501, 59_002, 7_080, 8_850, 29_501, 118_004, 0]
				},
				{
					ref: 'smg3',
					worksite: 'Provinsi Jawa Tengah/Kota Semarang',
					sector: '15201',
					wage: 3_707_534,
					c: [74_151, 137_179, 37_075, 74_151, 8_898, 11_123, 37_075, 148_301, 0]
				},
				{
					ref: 'smg4',
					worksite: 'Provinsi Jawa Tengah/Kota Semarang',
					sector: '22220',
					wage: 3_703_651,
					c: [74_073, 137_035, 37_037, 74_073, 8_889, 11_111, 37_037, 148_146, 0]
				},
				{
					ref: 'tgl',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Tegal',
					sector: '15201',
					wage: 2_495_993,
					c: [49_920, 92_352, 24_960, 49_920, 5_990, 7_488, 24_960, 99_840, 0]
				},
				{
					ref: 'tgl2',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Tegal',
					sector: '31009',
					wage: 2_490_077,
					c: [49_802, 92_133, 24_901, 49_802, 5_976, 7_470, 24_901, 99_603, 0]
				}
			]
		),
		floorCase(
			'ID-138-4',
			'Banten 2026 UMSK groups beside Cilegon Sektor 1 (Kep.704/2025): Kabupaten Serang Sektor I and II, Kota Cilegon Sektor 2 and 3, Kota Tangerang Selatan Sektor I and II, each worker paid exactly its floor, February 2026.',
			[
				'Banten Kep. Gubernur 704/2025 Lampiran I–II (signed text re-read 2026-09-30): Kabupaten Serang Sektor I Rp5.345.521,19 (20111), Sektor II Rp5.290.521,19 (10130); Kota Cilegon Sektor 2 Rp5.566.663,21 (10415), Sektor 3 Rp5.499.553,85 (68130); Kota Tangerang Selatan Sektor I Rp5.297.813,00 (46631), Sektor II Rp5.272.842,00 (47111) (tracker ID-138)',
				'Every figure: JHT 2% / 3.7%, JP 1% / 2%, JKK group I 0.24%, JKM 0.30%, Kesehatan 1% / 4% of the floor wage (above the workplace UMK, under the Rp12,000,000 cap), each half-up to the rupiah; PPh 21 TER A on wage + JKK + JKM + Kesehatan employer (PP 58/2023 Lampiran A: 0% to Rp5,400,000; 0.25% to 5,650,000; 0.5% to 5,950,000)'
			],
			'2026-02',
			'Provinsi Banten/Kabupaten Serang',
			[
				{
					ref: 'srg1',
					worksite: 'Provinsi Banten/Kabupaten Serang',
					sector: '20111',
					wage: 5_345_521.19,
					c: [106_910, 197_784, 53_455, 106_910, 12_829, 16_037, 53_455, 213_821, 13_971]
				},
				{
					ref: 'srg2',
					worksite: 'Provinsi Banten/Kabupaten Serang',
					sector: '10130',
					wage: 5_290_521.19,
					c: [105_810, 195_749, 52_905, 105_810, 12_697, 15_872, 52_905, 211_621, 13_827]
				},
				{
					ref: 'clg2',
					worksite: 'Provinsi Banten/Kota Cilegon',
					sector: '10415',
					wage: 5_566_663.21,
					c: [111_333, 205_967, 55_667, 111_333, 13_360, 16_700, 55_667, 222_667, 29_097]
				},
				{
					ref: 'clg3',
					worksite: 'Provinsi Banten/Kota Cilegon',
					sector: '68130',
					wage: 5_499_553.85,
					c: [109_991, 203_483, 54_996, 109_991, 13_199, 16_499, 54_996, 219_982, 28_746]
				},
				{
					ref: 'tgs1',
					worksite: 'Provinsi Banten/Kota Tangerang Selatan',
					sector: '46631',
					wage: 5_297_813,
					c: [105_956, 196_019, 52_978, 105_956, 12_715, 15_893, 52_978, 211_913, 13_846]
				},
				{
					ref: 'tgs2',
					worksite: 'Provinsi Banten/Kota Tangerang Selatan',
					sector: '47111',
					wage: 5_272_842,
					c: [105_457, 195_095, 52_728, 105_457, 12_655, 15_819, 52_728, 210_914, 13_781]
				}
			]
		),
		floorCase(
			'ID-99-4',
			'Bali December 2025: Jembrana, Karangasem, Klungkung and Bangli, expressly on the UMP, at Rp2,996,561 for a non-sector KBLI, 1 December joiners.',
			[
				'Bali Kep.946/2024 (announcement B.21.500.15/18055/IV/DISNAKER.ESDM): a regency not given a UMK uses the UMP (https://cloud-ng.baliprov.go.id/disnakeresdm/2024/12/Pengumuman-UMK-dan-UMSK-Tahun-2025.pdf); Kep.939/2024: UMP 2025 Rp2.996.561,00 (https://cloud-ng.baliprov.go.id/disnakeresdm/2024/12/PENGUMUMAN-UMP-dan-UMSP-Tahun-2025.pdf) (tracker ID-99)',
				'Every figure: JHT 2% / 3.7%, JP 1% / 2%, JKK group I 0.24%, JKM 0.30%, Kesehatan 1% / 4% of the floor wage, each half-up to the rupiah; a 1 December joiner’s December is the last tax period, and a year’s income of one month at this wage is below the PTKP Rp54,000,000, so PPh 21 is 0 (PMK 168/2023 art.10)'
			],
			'2025-12',
			'Provinsi Bali/Kabupaten Jembrana',
			[
				{
					ref: 'jbr',
					worksite: 'Provinsi Bali/Kabupaten Jembrana',
					sector: '62019',
					wage: 2_996_561,
					c: [59_931, 110_873, 29_966, 59_931, 7_192, 8_990, 29_966, 119_862, 0]
				},
				{
					ref: 'kas',
					worksite: 'Provinsi Bali/Kabupaten Karangasem',
					sector: '62019',
					wage: 2_996_561,
					c: [59_931, 110_873, 29_966, 59_931, 7_192, 8_990, 29_966, 119_862, 0]
				},
				{
					ref: 'klk',
					worksite: 'Provinsi Bali/Kabupaten Klungkung',
					sector: '62019',
					wage: 2_996_561,
					c: [59_931, 110_873, 29_966, 59_931, 7_192, 8_990, 29_966, 119_862, 0]
				},
				{
					ref: 'bgl25',
					worksite: 'Provinsi Bali/Kabupaten Bangli',
					sector: '62019',
					wage: 2_996_561,
					c: [59_931, 110_873, 29_966, 59_931, 7_192, 8_990, 29_966, 119_862, 0]
				}
			]
		),
		floorCase(
			'ID-98-3',
			'Bali December 2025 provincial UMSP Rp3,052,834 for other KBLI 2020 letter-I lines (55130, 55900, 56301) at UMP-valued regencies, and for a Denpasar restaurant (56101) the higher Denpasar UMK Rp3,298,116.50, 1 December joiners.',
			[
				'Bali Kep.939/2024: UMSP Rp3,052,834.00 for tourism accommodation and food service under KBLI 2020 letter I (https://cloud-ng.baliprov.go.id/disnakeresdm/2024/12/PENGUMUMAN-UMP-dan-UMSP-Tahun-2025.pdf; tracker ID-98); Kep.946/2024: Denpasar Rp3,298,116.50 (tracker ID-99)',
				'Binding floor = the higher of the ordinary floor and every matching sector floor: PP 49/2025 art.35D (tracker ID-03)',
				'Every figure: JHT 2% / 3.7%, JP 1% / 2%, JKK group I 0.24%, JKM 0.30%, Kesehatan 1% / 4% of the floor wage, each half-up to the rupiah; a 1 December joiner’s December is the last tax period, and a year’s income of one month at this wage is below the PTKP Rp54,000,000, so PPh 21 is 0 (PMK 168/2023 art.10)'
			],
			'2025-12',
			'Provinsi Bali/Kabupaten Klungkung',
			[
				{
					ref: 'klk2',
					worksite: 'Provinsi Bali/Kabupaten Klungkung',
					sector: '55130',
					wage: 3_052_834,
					c: [61_057, 112_955, 30_528, 61_057, 7_327, 9_159, 30_528, 122_113, 0]
				},
				{
					ref: 'kas2',
					worksite: 'Provinsi Bali/Kabupaten Karangasem',
					sector: '55900',
					wage: 3_052_834,
					c: [61_057, 112_955, 30_528, 61_057, 7_327, 9_159, 30_528, 122_113, 0]
				},
				{
					ref: 'jbr2',
					worksite: 'Provinsi Bali/Kabupaten Jembrana',
					sector: '56301',
					wage: 3_052_834,
					c: [61_057, 112_955, 30_528, 61_057, 7_327, 9_159, 30_528, 122_113, 0]
				},
				{
					ref: 'dps2',
					worksite: 'Provinsi Bali/Kota Denpasar',
					sector: '56101',
					wage: 3_298_116.5,
					c: [65_962, 122_030, 32_981, 65_962, 7_915, 9_894, 32_981, 131_925, 0]
				}
			]
		),
		floorCase(
			'ID-103-4',
			'The January 2026 boundary in Bali: from 1 January the Badung UMSK Rp3,828,912.60 covers a four-star hotel (in December 2025 it fell to the UMK, ID-100-3), and a Bangli star hotel is on the 2026 provincial tourism UMSP Rp3,267,693, January 2026.',
			[
				'Bali Kep.1021/2025: Badung UMSK Rp3,828,912.60 for KBLI letter I with four- or five-star hotel classification, from 1 January 2026 (tracker ID-103); Kep.1011/2025: provincial tourism UMSP Rp3,267,693.00 for the star-hotel subgroup (tracker ID-101) (https://cloud-ng.baliprov.go.id/disnakeresdm/2025/12/PENGUMUMAN-DAN-SK-UMP-UMSP-2026.pdf)',
				'JP on the January 2026 ceiling Rp10,547,400 (not reached)',
				'Every figure: JHT 2% / 3.7%, JP 1% / 2%, JKK group I 0.24%, JKM 0.30%, Kesehatan 1% / 4% of the floor wage (above the workplace UMK, under the Rp12,000,000 cap), each half-up to the rupiah; PPh 21 TER A on wage + JKK + JKM + Kesehatan employer (PP 58/2023 Lampiran A: 0% to Rp5,400,000; 0.25% to 5,650,000; 0.5% to 5,950,000)'
			],
			'2026-01',
			'Provinsi Bali/Kabupaten Badung',
			[
				{
					ref: 'bdg4j',
					worksite: 'Provinsi Bali/Kabupaten Badung',
					sector: '55110',
					wage: 3_828_912.6,
					c: [76_578, 141_670, 38_289, 76_578, 9_189, 11_487, 38_289, 153_157, 0]
				},
				{
					ref: 'bgl4j',
					worksite: 'Provinsi Bali/Kabupaten Bangli',
					sector: '55110',
					wage: 3_267_693,
					c: [65_354, 120_905, 32_677, 65_354, 7_842, 9_803, 32_677, 130_708, 0]
				}
			],
			{ umsp_hotel_star: 4 }
		),
		floorCase(
			'ID-81-2',
			'Kabupaten Jepara December 2025, a large business: KBLI 29300 is on the amended UMSK Rp2,701,582 above the Jepara UMK, a 1 December joiner.',
			[
				'Central Java Kep.561/45/2024 as amended by Kep.100.3.3.1/45/2025 (effective 10 February 2025): Jepara annex II item 1, large businesses only, KBLI 29300 Rp2,701,582 (https://jdih.jatengprov.go.id/inventarisasi-hukum/file/kepgub_100-3-3-1-45_th_2025/sk_100.3.3.1-45_th_2025.pdf; tracker ID-81)',
				'Every figure: JHT 2% / 3.7%, JP 1% / 2%, JKK group I 0.24%, JKM 0.30%, Kesehatan 1% / 4% of the floor wage, each half-up to the rupiah; a 1 December joiner’s December is the last tax period, and a year’s income of one month at this wage is below the PTKP Rp54,000,000, so PPh 21 is 0 (PMK 168/2023 art.10)'
			],
			'2025-12',
			'Provinsi Jawa Tengah/Kabupaten Jepara',
			[
				{
					ref: 'jpr',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Jepara',
					sector: '29300',
					wage: 2_701_582,
					c: [54_032, 99_959, 27_016, 54_032, 6_484, 8_105, 27_016, 108_063, 0]
				}
			],
			{ umsp_large_business: true }
		),
		floorCase(
			'ID-81-3',
			'The same Jepara KBLI 29300 at an employer recorded as not a large business, December 2025: the UMSK does not bind, so the 2025 Jepara UMK Rp2,610,224 does, a 1 December joiner.',
			[
				'Central Java Kep.561/45/2024 Lampiran I: Kabupaten Jepara UMK 2025 Rp2,610,224; the amended annex II item 1 binds large businesses only (Kep.100.3.3.1/45/2025; tracker ID-81, https://jdih.jatengprov.go.id/produk_hukum/kepgub/sk_561-45_th_2024.pdf)',
				'Every figure: JHT 2% / 3.7%, JP 1% / 2%, JKK group I 0.24%, JKM 0.30%, Kesehatan 1% / 4% of the floor wage, each half-up to the rupiah; a 1 December joiner’s December is the last tax period, and a year’s income of one month at this wage is below the PTKP Rp54,000,000, so PPh 21 is 0 (PMK 168/2023 art.10)'
			],
			'2025-12',
			'Provinsi Jawa Tengah/Kabupaten Jepara',
			[
				{
					ref: 'jpr2',
					worksite: 'Provinsi Jawa Tengah/Kabupaten Jepara',
					sector: '29300',
					wage: 2_610_224,
					c: [52_204, 96_578, 26_102, 52_204, 6_265, 7_831, 26_102, 104_409, 0]
				}
			],
			{ umsp_large_business: false }
		)
	].map((probe) =>
		probe.id === 'ID-36-1'
			? {
					...probe,
					inputs: probe.inputs.map((input) =>
						input.collection === 'employment_terms'
							? { ...input, values: { ...input.values, employment_type: 'INTERN' } }
							: input
					)
				}
			: probe
	);
}

// ─── Round 10 (2026-09-30): refusals, classes and elections not yet on a saved run ─────────────
const WM_REF =
	'UU 13/2003 art.88E(2) as inserted by UU 6/2023; PP 36/2021 arts.23–24 (https://jdih.kemnaker.go.id/asset/data_puu/PP362021.pdf); only DKI Jakarta is a standalone province-only workplace and an unmatched workplace never inherits a floor (tracker ID-02, ID-94)';
const STRICT_REF =
	'Strict sector place: an issued sector order whose annex selectors are unsealed refuses an unmatched KBLI rather than falling back to the UMK/UMP (tracker ID-173 owner default; PP 49/2025 arts.35A–35J, https://jdih.kemnaker.go.id/asset/data_puu/2025pp0049.pdf)';
/** One worker at a workplace whose floor cannot be resolved: the run is refused. */
const unresolved = (
	id: string,
	description: string,
	source: string,
	period: string,
	worksite: string,
	refused: string
): ProbeCase => ({
	id,
	profile: 'ID',
	description,
	citation: [source, WM_REF],
	company: company({ region: worksite }),
	inputs: [
		...week('2025-06-02'),
		...worker({ ref: 'place', wage: 10_000_000, worksite, sector: '62019' })
	],
	period,
	refused,
	expected: []
});
const bare = (province: string) =>
	`No sealed minimum-wage rate covers PERMANENT at "${province}" in ID`;
const strict = (place: string) =>
	`The sector wage order for ${place} sector 62019 is not verified; no ordinary-floor fallback is allowed`;
/** The ID-14-1 slip less JP (no JP line): 10,000,000 − 200,000 − 100,000 − 261,350. */
const TEN_MILLION_NO_JP: Lines = Object.fromEntries(
	Object.entries({ ...TEN_MILLION, net: 9_438_650 }).filter(([key]) => !key.startsWith('JP.'))
);
/** A resident recipient outside an employment relationship (PMK 168/2023 art.1): no BPJS programme applies. */
const outsider = (ref: string, wage: number, elections: Row): ProbeInput[] =>
	worker({ ref, wage, type: 'CONSULTANT', classification: 'NON_EA', elections });

const round10: ProbeCase[] = [
	unresolved(
		'ID-83-4',
		'A bare "Provinsi Jawa Tengah" workplace, February 2026: every one of the 35 localities has its own UMK (Kep.505/2025) and the province has no standalone floor, so the run is refused rather than paid the UMP.',
		'Central Java Kep. Gubernur 100.3.3.1/505/2025 (35 UMKs, https://jdih.jatengprov.go.id/produk_hukum/kepgub/sk_100.3.3.1-505_th_2025_auten.pdf)',
		'2026-02',
		'Provinsi Jawa Tengah',
		bare('Provinsi Jawa Tengah')
	),
	unresolved(
		'ID-139-5',
		'A bare "Provinsi DI Yogyakarta" workplace, February 2026: all five localities have a UMK above the UMP, so the province cannot select the lower UMP — refused.',
		'DI Yogyakarta Kep. Gubernur 442/2025 (UMP) and 443/2025 (five UMKs) (https://nakertrans.jogjaprov.go.id/berita/detail/ump-dan-umk-diy-tahun-2026-resmi-ditetapkan-berlaku-mulai-1-januari-2026)',
		'2026-02',
		'Provinsi DI Yogyakarta',
		bare('Provinsi DI Yogyakarta')
	),
	unresolved(
		'ID-95-1',
		'A bare "Provinsi Jawa Barat" workplace, February 2026: every city and regency has a UMK above the UMP Rp2,317,601, so the province cannot select the UMP — refused.',
		'West Java Kep. Gubernur 859/2025 (UMP) and 862/2025 (27 UMKs) (https://jdih.jabarprov.go.id/page/eksekusi_download/32/2025kg00320859.pdf; tracker ID-95)',
		'2026-02',
		'Provinsi Jawa Barat',
		bare('Provinsi Jawa Barat')
	),
	unresolved(
		'ID-96-2',
		'Kota Bekasi, KBLI 62019, February 2026: West Java is a strict sector place and 62019 is attested ordinary only at Kabupaten Bekasi, so the run is refused rather than paid the Kota Bekasi UMK.',
		`West Java Kep. Gubernur 862/2025 (UMK) and the unresolved 2026 UMSK selectors (tracker ID-96, ID-173); ${STRICT_REF}`,
		'2026-02',
		'Provinsi Jawa Barat/Kota Bekasi',
		strict('Provinsi Jawa Barat/Kota Bekasi')
	),
	unresolved(
		'ID-131-1',
		'Kota Pekanbaru, KBLI 62019, February 2026: Riau’s 2026 sector wages (oil and gas, plantation, pulp and paper) are announced without a complete KBLI annex, so the run is refused rather than paid the UMK.',
		`Riau 2026 UMK and sector-wage announcement (https://mediacenter.riau.go.id/arsip/94797; tracker ID-131); ${STRICT_REF}`,
		'2026-02',
		'Provinsi Riau/Kota Pekanbaru',
		strict('Provinsi Riau/Kota Pekanbaru')
	),
	unresolved(
		'ID-132-1',
		'Kota Batam, KBLI 62019, February 2026: the Riau Islands 2026 UMSP/UMSK decisions are named without selectors, so the run is refused rather than paid the Batam UMK.',
		`Riau Islands 2026 wage announcements (https://kepriprov.go.id/berita/pemprov-kepri/ump-kepri-2026-naik-706-persen-ditetapkan-sebesar-rp3879520; tracker ID-132); ${STRICT_REF}`,
		'2026-02',
		'Provinsi Kepulauan Riau/Kota Batam',
		strict('Provinsi Kepulauan Riau/Kota Batam')
	),
	unresolved(
		'ID-173-1',
		'Kota Surabaya, KBLI 62019, December 2025: the 2025 East Java UMSK (Kep.776/2024 as amended by Kep.804/2024 and Kep.65/2025) is not sealed, so the December 2025 version refuses rather than paying the 2025 UMK.',
		`East Java 2025 UMSK and amendments (tracker ID-89, ID-173); ${STRICT_REF}`,
		'2025-12',
		'Provinsi Jawa Timur/Kota Surabaya',
		strict('Provinsi Jawa Timur/Kota Surabaya')
	),
	unresolved(
		'ID-173-2',
		'Kabupaten Pandeglang, KBLI 62019, December 2025: the 2025 Banten UMSP/UMSK are not sealed, so the December 2025 version refuses at every Banten workplace.',
		`Banten 2025 UMSP/UMSK records (tracker ID-138, ID-173); ${STRICT_REF}`,
		'2025-12',
		'Provinsi Banten/Kabupaten Pandeglang',
		strict('Provinsi Banten/Kabupaten Pandeglang')
	),
	{
		id: 'ID-15-4',
		profile: 'ID',
		description:
			'A worker aged 62 (born 15 June 1963) with the recorded art.15(4) choice to continue, Rp10,000,000, February 2026: the deferral runs at most three years past pension age 59, so no JP is charged.',
		citation: [
			SRC.JP,
			'PP 45/2015 art.15(4): a participant still employed at pension age may take the pension when work stops, at most 3 years after pension age — 59 + 3 = 62 (https://www.bpjsketenagakerjaan.go.id/assets/uploads/peraturan/15122015_104556_PP%2045%20Tahun%202015.pdf, read 2026-09-30)',
			'ID-14-1 figures without JP: net 10,000,000 − 200,000 − 100,000 − 261,350 = 9,438,650'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'lanjut', wage: 10_000_000, dob: '1963-06-15' }),
			registered('lanjut', 'JP', { continue_after_pension_age: true }, true)
		],
		period: '2026-02',
		expected: [{ employment: 'lanjut_job', lines: TEN_MILLION_NO_JP }]
	},
	...(
		[
			['ID-69-1', '1995-05-10', true],
			['ID-69-2', '1970-06-15', false]
		] as const
	).map(([id, dob, refusedRun]): ProbeCase => ({
		id,
		profile: 'ID',
		description: refusedRun
			? 'A citizen aged 30 recorded NOT_REGISTERED for JKP, February 2026: JKP participation is required for an Indonesian worker under 54, so the run is refused rather than treating the worker as exempt.'
			: 'A citizen aged 55 (born 15 June 1970) recorded NOT_REGISTERED for JKP, February 2026: a worker already 54 at first registration is outside JKP, so the run commits on the ID-14-1 figures.',
		citation: [
			'PP 37/2021 art.4 as amended by PP 6/2025 art.I(1): JKP covers an Indonesian worker under 54 at registration (https://jdih.kemnaker.go.id/asset/data_puu/2025pp006.pdf)',
			'JKP has no payslip charge beyond the full JKK bill: PP 6/2025 art.I(2) (tracker ID-18)',
			...(refusedRun ? [] : [SRC.TER, 'ID-14-1 figures: net 9,338,650'])
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'jkp', wage: 10_000_000, dob }),
			{
				collection: 'employment_statutory_facts',
				values: {
					employee_id: '@jkp',
					statutory_contribution_id: '@law:statutory_contributions:JKP',
					effective_range: { from: '2025-06-02', to: null },
					status: {
						kind: 'NOT_REGISTERED',
						reason: 'The employer has not registered the worker for JKP'
					}
				}
			}
		],
		period: '2026-02',
		...(refusedRun
			? {
					refused: 'JKP cannot be marked not registered for an Indonesian worker under 54',
					expected: []
				}
			: { expected: [{ employment: 'jkp_job', lines: TEN_MILLION }] })
	})),
	{
		id: 'ID-16-5',
		profile: 'ID',
		description:
			'A company with no JKK risk group recorded, Rp10,000,000, February 2026: the employer rate turns on the group and there is no default, so the run stops.',
		citation: [
			'PP 44/2015 art.16(1)–(2) and Lampiran I: the JKK rate is set by the business’s risk group I–V (https://jdih.kemnaker.go.id/asset/data_puu/PP_NOMOR_44_TAHUN2015OK.PDF)'
		],
		company: { region: 'Provinsi DKI Jakarta', facts: { enterprise_size_class: 'OTHER' } },
		inputs: [...week('2025-06-02'), ...worker({ ref: 'norisk', wage: 10_000_000 })],
		period: '2026-02',
		refused: 'Record the entity.s JKK risk group \\(I–V\\) before calculating',
		expected: []
	},
	{
		id: 'ID-19-2',
		profile: 'ID',
		description:
			'Two further family members enrolled beyond the household of five, Rp10,000,000, February 2026: the worker pays 1% more for each, the employer share is unchanged.',
		citation: [
			SRC.KES,
			'Perpres 82/2018 arts.5(3)–(4), 36(1)–(2): a further family member (a fourth child onward, a parent, a parent-in-law) is 1% of the PPU wage per person a month, paid by the worker (https://jdih.kemenkeu.go.id/api/download/FullText/2018/82TAHUN2018PERPRES.pdf, read 2026-09-30)',
			'Kesehatan employee 100,000 + 2 × 100,000 = 300,000; employer 400,000; the worker’s premium is not a PPh 21 deduction, so TER stays 261,350; net 10,000,000 − 200,000 − 100,000 − 300,000 − 261,350 = 9,138,650'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'keluarga', wage: 10_000_000 }),
			registered('keluarga', 'KESEHATAN', { extra_members: 2 })
		],
		period: '2026-02',
		expected: [
			{
				employment: 'keluarga_job',
				lines: { ...TEN_MILLION, net: 9_138_650, 'KESEHATAN.employee': 300_000 }
			}
		]
	},
	{
		id: 'ID-13-3',
		profile: 'ID',
		description:
			'A Muslim worker hired 16 February 2026 asks for THR on 10 March 2026 (Idul Fitri 21 March): under one month of continuous service no THR is owed, so the request is refused; March pays the wage alone.',
		citation: [
			'Permenaker 6/2016 art.2(1): THR is owed after one month of continuous service (https://jdih.kemnaker.go.id/asset/data_puu/permenaker_6_2016.pdf)',
			SRC.TER,
			'ID-14-1 figures in March (JP under the 11,086,300 ceiling): net 9,338,650'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'baru', wage: 10_000_000, hire: '2026-02-16', religion: 'ISLAM' }),
			{
				...adhoc('baru', 'THR', '2026-03-10'),
				refused: 'THR is not offered to .*: its eligibility rule does not hold'
			}
		],
		period: '2026-03',
		expected: [{ employment: 'baru_job', lines: TEN_MILLION }]
	},
	{
		id: 'ID-119-1',
		profile: 'ID',
		description:
			'The ID-13-1 worker (hired 1 September 2025, Rp12,000,000, Muslim) asks for a second THR for the same Idul Fitri in March 2026: THR is paid once per holiday, so the second request is refused; the first is paid whole.',
		citation: [
			'Permenaker 6/2016 art.5(1): THR is given once a year per religious holiday; SE M/3/HK.04.00/III/2026 item 7: paid in full, not in instalments (https://jdih.kemnaker.go.id/asset/data_puu/2026senaker003.pdf)',
			'Six-twelfths of 12,000,000 = 6,000,000 allowed; a second 6,000,000 makes 12,000,000 requested',
			'ID-13-1 figures: THR 6,000,000; PPh 21 1,483,584; net 16,045,553'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'dua', wage: 12_000_000, hire: '2025-09-01', religion: 'ISLAM' }),
			adhoc('dua', 'THR', '2026-03-10'),
			{
				...adhoc('dua', 'THR', '2026-03-12'),
				refused:
					'THR entitlement exceeded for .*: 12000000(\\.00)? requested against 6000000(\\.00)? allowed'
			}
		],
		period: '2026-03',
		expected: [
			{
				employment: 'dua_job',
				lines: {
					THR: 6_000_000,
					net: 16_045_553,
					'JHT.employee': 240_000,
					'JHT.employer': 444_000,
					'JP.employee': 110_863,
					'JP.employer': 221_726,
					'JKK.employer': 28_800,
					'JKM.employer': 36_000,
					'KESEHATAN.employee': 120_000,
					'KESEHATAN.employer': 480_000,
					'PPH21.employee': 1_483_584
				}
			}
		]
	},
	{
		id: 'ID-109-2',
		profile: 'ID',
		description:
			'A foreign worker on an 18-month PKWT (the ID-15-2 worker) is offered PKWT compensation in February 2026: art.15(5) excludes foreign workers, so the request is refused; the month pays as ID-15-2.',
		citation: [
			'PP 35/2021 art.15(5): the compensation does not apply to foreign workers employed under a PKWT (https://jdih.kemnaker.go.id/asset/data_puu/PP352021.pdf, read 2026-09-30)',
			'ID-15-2 unregistered-JP figures: net 17,627,080'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({
				ref: 'asing',
				wage: 20_000_000,
				citizenship: 'FOREIGNER',
				type: 'CONTRACT',
				hire: '2025-07-01',
				exit: '2026-12-31'
			}),
			{
				...adhoc('asing', 'PKWT_COMPENSATION', '2026-02-20'),
				refused: 'PKWT_COMPENSATION is not offered to .*: its eligibility rule does not hold'
			}
		],
		period: '2026-02',
		expected: [
			{
				employment: 'asing_job',
				lines: {
					net: 17_627_080,
					'JHT.employee': 400_000,
					'JHT.employer': 740_000,
					'JKK.employer': 48_000,
					'JKM.employer': 60_000,
					'KESEHATAN.employee': 120_000,
					'KESEHATAN.employer': 480_000,
					'PPH21.employee': 1_852_920
				}
			}
		]
	},
	{
		id: 'ID-114-1',
		profile: 'ID',
		description:
			'A PKWTT worker of a micro/small enterprise (the ID-28-2 stint: hired 5 January 2026, leaves 23 January for efficiency to prevent loss) with a recorded severance agreement of Rp3,000,000: the agreed amount replaces the art.40 × art.43 multiplier.',
		citation: [
			'PP 35/2021 art.59: at a micro or small enterprise severance is set by agreement between employer and worker (https://jdih.kemnaker.go.id/asset/data_puu/PP352021.pdf, read 2026-09-30)',
			SRC.PRORATE,
			SRC.PP68,
			SRC.LAST,
			'ID-28-2 month: paid 6,129,032.26; net before severance 5,806,452.26; PP 68/2009 on 3,000,000: 0%; net 8,806,452.26'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({
				ref: 'umkm',
				wage: 10_000_000,
				hire: '2026-01-05',
				exit: '2026-01-23',
				exit_ground: 'REDUNDANCY',
				exit_facts: departure('EFFICIENCY_PREVENT_LOSS', {
					separation_wage_basis: 'MONTHLY',
					micro_small_enterprise: true,
					micro_small_agreement_reference: 'PROBE-UMK-AGREEMENT',
					agreed_pesangon_amount: 3_000_000
				})
			}),
			adhoc('umkm', 'PESANGON', '2026-01-23')
		],
		period: '2026-01',
		expected: [
			{
				employment: 'umkm_job',
				lines: {
					PESANGON: 3_000_000,
					net: 8_806_452.26,
					BASIC: 6_129_032.26,
					'JHT.employee': 200_000,
					'JHT.employer': 370_000,
					'JP.employee': 61_290,
					'JP.employer': 122_581,
					'JKK.employer': 24_000,
					'JKM.employer': 30_000,
					'KESEHATAN.employee': 61_290,
					'KESEHATAN.employer': 245_161
				}
			}
		]
	},
	{
		id: 'ID-84-2',
		profile: 'ID',
		description:
			'The 2026 DTP boundary at an eligible-sector employer, February 2026: a reference-month fixed gross of exactly Rp10,000,000 is inside the incentive (PPh 21 borne by the government); Rp10,000,001 is outside it.',
		citation: [
			'PMK 105/2025 art.4(2)(b): a permanent employee’s fixed regular gross “tidak lebih dari Rp10.000.000,00” in the reference month (https://jdih.kemenkeu.go.id/api/download/cb203b0c-bdc8-409d-bf9c-a71264d96f60/2025pmkeuangan105.pdf, read 2026-09-30)',
			SRC.TER,
			'10,000,000: ID-14-1 BPJS, PPh 21 0; net 10,000,000 − 200,000 − 100,000 − 100,000 = 9,600,000',
			'10,000,001: every BPJS share rounds to the ID-14-1 figure; TER gross 10,454,001 at 2.5% = 261,350.03 → 261,350; net 9,338,651'
		],
		company: company({ facts: { pph21_dtp_sector: true } }),
		inputs: [
			...week('2025-06-02'),
			...(
				[
					['dtp1', 10_000_000],
					['dtp2', 10_000_001]
				] as const
			).flatMap(([ref, wage]) =>
				worker({
					ref,
					wage,
					elections: {
						dtp_reference_gross: wage,
						dtp_reference_year: '2026',
						other_pph21_incentive: false
					}
				})
			)
		],
		period: '2026-02',
		expected: [
			{
				employment: 'dtp1_job',
				lines: Object.fromEntries(
					Object.entries({ ...TEN_MILLION, net: 9_600_000 }).filter(
						([key]) => key !== 'PPH21.employee'
					)
				)
			},
			{ employment: 'dtp2_job', lines: { ...TEN_MILLION, gross: 10_000_001, net: 9_338_651 } }
		]
	},
	{
		id: 'ID-74-2',
		profile: 'ID',
		description:
			'Non-employee services, Rp20,000,000 each, February 2026: catering is taxed on 50% of the whole receipt; a recipient with neither NPWP nor usable NIK is withheld 20% more.',
		citation: [
			'PMK 168/2023 art.12(4)–(5) and Lampiran A.IV: 50% of gross at art.17 rates; catering on the whole amount received (https://jdih.kemenkeu.go.id/api/download/e60a82e0-b218-40f5-9d18-b924aa1e11ce/2023pmkeuangan168.pdf)',
			'UU PPh art.21(5a): no NPWP, 20% higher (https://jdih.kemenkeu.go.id/dok/uu-36-tahun-2008)',
			'Catering: 5% × 10,000,000 = 500,000, net 19,500,000; no tax ID: 500,000 × 120% = 600,000, net 19,400,000'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...outsider('katering', 20_000_000, {
				recipient_class: 'NON_EMPLOYEE',
				service_kind: 'CATERING'
			}),
			...outsider('tanpanpwp', 20_000_000, {
				recipient_class: 'NON_EMPLOYEE',
				service_kind: 'OTHER',
				no_tax_id: true
			})
		],
		period: '2026-02',
		expected: [
			{ employment: 'katering_job', lines: { net: 19_500_000, 'PPH21.employee': 500_000 } },
			{ employment: 'tanpanpwp_job', lines: { net: 19_400_000, 'PPH21.employee': 600_000 } }
		]
	},
	{
		id: 'ID-45-1',
		profile: 'ID',
		description:
			'Recipients outside an employment relationship, February 2026: an activity participant, a former employee and an active pension withdrawal, Rp20,000,000 each, and an irregular commissioner on Rp8,000,000 — no BPJS programme charges any of them; PPh 21 per class.',
		citation: [
			'No BPJS premium outside an employment relationship: PP 44/2015 art.5(2)–(3), PP 46/2015 art.4(2)–(3), PP 45/2015 art.2, Perpres 82/2018 art.13(1) (tracker ID-45)',
			'PMK 168/2023 art.12: activity participants, former employees and pension withdrawals at art.17(1)(a) rates on gross — 5% × 20,000,000 = 1,000,000, net 19,000,000; an irregular commissioner at the monthly TER on gross — TER A 7,500,001–8,550,000 at 1.5% = 120,000, net 7,880,000 (https://jdih.kemenkeu.go.id/api/download/e60a82e0-b218-40f5-9d18-b924aa1e11ce/2023pmkeuangan168.pdf)'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...outsider('peserta', 20_000_000, { recipient_class: 'ACTIVITY_PARTICIPANT' }),
			...outsider('mantan', 20_000_000, { recipient_class: 'FORMER_EMPLOYEE' }),
			...outsider('pensiun', 20_000_000, { recipient_class: 'ACTIVE_PENSION_WITHDRAWAL' }),
			...outsider('komisaris', 8_000_000, { recipient_class: 'IRREGULAR_COMMISSIONER' })
		],
		period: '2026-02',
		expected: [
			...['peserta_job', 'mantan_job', 'pensiun_job'].map((employment) => ({
				employment,
				lines: { net: 19_000_000, 'PPH21.employee': 1_000_000 }
			})),
			{ employment: 'komisaris_job', lines: { net: 7_880_000, 'PPH21.employee': 120_000 } }
		]
	},
	{
		id: 'ID-21-3',
		profile: 'ID',
		description:
			'A resident employee with no PPh 21 registration or year-start PTKP declaration on file, Rp10,000,000, February 2026: a missing registration never zeroes the withholding, so the run is refused until the status is declared.',
		citation: [
			'PMK 168/2023 art.9(4): the PTKP is the status at the start of the year (https://jdih.kemenkeu.go.id/api/download/e60a82e0-b218-40f5-9d18-b924aa1e11ce/2023pmkeuangan168.pdf); UU PPh art.21(5a): the NPWP status sets the surcharge (tracker ID-21, ID-45)'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'tanpa', wage: 10_000_000 }).filter(
				(input) => input.collection !== 'employment_statutory_facts'
			)
		],
		period: '2026-02',
		refused:
			'Declare the employee.s year-start PTKP marital status and dependants|PPh 21 recipient class is required before calculation',
		expected: []
	}
];

// ─── Round 11 (2026-09-30): six-day week, the daily overtime ceiling, boundaries and refusals ──
/** A Monday–Saturday week of 7-hour days (08:00–16:00 less an hour's break), Sunday the rest day: 7 h × 6 (PP 35/2021 art.21(2)(a)). */
const sixDayWeek = (from: string): ProbeInput[] => [
	{
		collection: 'shift_definitions',
		ref: 'office7',
		values: {
			company_id: '@company',
			code: 'OFFICE7',
			name: 'Office day (0800 to 1600)',
			variant: { kind: 'WORK', start_time: '08:00', end_time: '16:00', break_minutes: 60 },
			effective_range: { from, to: null }
		}
	},
	{
		collection: 'shift_definitions',
		ref: 'rest',
		values: {
			company_id: '@company',
			code: 'REST',
			name: 'Rest day',
			variant: { kind: 'REST' },
			effective_range: { from, to: null }
		}
	},
	{
		collection: 'shift_patterns',
		ref: 'week',
		values: {
			company_id: '@company',
			code: 'OFFICE7x6-REST',
			name: '6 x OFFICE7, REST',
			pattern: {
				days: ['@office7', '@office7', '@office7', '@office7', '@office7', '@office7', '@rest'].map(
					(roster_code_id) => ({ roster_code_id })
				)
			},
			effective_range: { from, to: null }
		}
	}
];
/** The ID-14-1 BPJS lines at Rp8,650,000 (the Rp50,000 overtime hour). */
const EIGHT_SIX_FIVE: Lines = {
	'JHT.employee': 173_000,
	'JHT.employer': 320_050,
	'JP.employee': 86_500,
	'JP.employer': 173_000,
	'JKK.employer': 20_760,
	'JKM.employer': 25_950,
	'KESEHATAN.employee': 86_500,
	'KESEHATAN.employer': 346_000
};
const OT_REF =
	'PP 35/2021 art.31(1): ordinary day, first overtime hour 1.5×, further hours 2×; art.32(2): the hour is 1/173 of the monthly wage — 8,650,000 ÷ 173 = 50,000 (https://jdih.kemnaker.go.id/asset/data_puu/PP352021.pdf)';
/** A foreign worker on a five-month PKWT from 1 February 2026 (the ID-175-1 stint), non-resident, with the given prior-work record. */
const shortForeigner = (ref: string, facts: Row | null, evidence: boolean): ProbeInput[] => [
	...worker({
		ref,
		wage: 20_000_000,
		citizenship: 'FOREIGNER',
		tax: 'NON_RESIDENT',
		type: 'CONTRACT',
		hire: '2026-02-01',
		exit: '2026-06-30',
		...(facts == null ? {} : { terms_facts: facts })
	}),
	...(evidence
		? [
				{
					collection: 'fact_evidence',
					values: {
						subject: { collection: 'employment_terms', id: `@${ref}_terms` },
						fact_key: 'foreign_prior_work_reviewed_on',
						reference: `PROBE-IMIGRASI-CHECK-${ref}`
					}
				} satisfies ProbeInput
			]
		: [])
];
const KES_FOREIGN =
	'A foreign worker joins BPJS Kesehatan after six months of work in Indonesia, measured on cumulative Indonesian work, not the current contract: Perpres 82/2018 art.1 angka 2 as restated by Perpres 59/2024 (https://peraturan.bpk.go.id/Download/344279/Perpres%20Nomor%2059%20Tahun%202024.pdf); tracker ID-175 recorded default: a short contract alone never excludes the worker — the run refuses until a dated prior-work review of NONE inside the service is on file with its reference';
const KES_FOREIGN_REFUSAL =
	'Verify dated prior work in Indonesia before excluding a foreign worker on a short contract from BPJS Kesehatan';

const round11: ProbeCase[] = [
	{
		id: 'ID-107-1',
		profile: 'ID',
		description:
			'A six-day week (7 h × 6, Sunday the only rest day) on Rp8,650,000, February 2026: three ordered hours past a 7-hour Monday, and eleven on the Sunday rest day priced on the six-day ladder (1–7 h 2×, 8th 3×, 9th–11th 4×).',
		citation: [
			'PP 35/2021 art.21(2)(a): 7 hours a day, 40 a week, on a six-day week; art.31(2)(a): on a rest day or holiday of a six-day week, the first 7 hours 2×, the 8th 3×, the 9th–11th 4× (https://jdih.kemnaker.go.id/asset/data_puu/PP352021.pdf)',
			OT_REF,
			'UU 13/2003 art.79(2)(b): one rest day after six working days (https://jdih.kemnaker.go.id/asset/data_puu/peraturan_file_13.pdf)',
			'Mon 2 Feb 08:00–12:00 + 13:00–16:00 + 16:30–19:30 = 10 h, 3 past the 7-hour day: 1 × 1.5 × 50,000 + 2 × 2 × 50,000 = 275,000',
			'Sun 8 Feb 08:00–12:00 + 12:30–16:30 + 17:00–20:00 = 11 h: 7 × 2 + 1 × 3 + 3 × 4 = 29 hours’ pay = 1,450,000',
			SRC.TER,
			'BPJS on the wage only (as ID-09-1): JHT 173,000 / 320,050; JP 86,500 / 173,000; JKK 20,760; JKM 25,950; Kesehatan 86,500 / 346,000; gross 8,650,000 + 1,725,000 = 10,375,000; TER gross 10,375,000 + 20,760 + 25,950 + 346,000 = 10,767,710, TER A 10,700,001–11,050,000 at 3% = 323,031.30 → 323,031',
			'Net 10,375,000 − 173,000 − 86,500 − 86,500 − 323,031 = 9,705,969'
		],
		company: company(),
		inputs: [
			...sixDayWeek('2025-06-02'),
			...worker({ ref: 'enam', wage: 8_650_000 }),
			ordered(
				punch('enam', '2026-02-02', ['08:00', '12:00'], ['13:00', '16:00'], ['16:30', '19:30']),
				3
			),
			ordered(
				punch('enam', '2026-02-08', ['08:00', '12:00'], ['12:30', '16:30'], ['17:00', '20:00']),
				11
			)
		],
		period: '2026-02',
		expected: [
			{
				employment: 'enam_job',
				lines: {
					...EIGHT_SIX_FIVE,
					gross: 10_375_000,
					net: 9_705_969,
					'PPH21.employee': 323_031
				}
			}
		]
	},
	{
		id: 'ID-09-2',
		profile: 'ID',
		description:
			'Five overtime hours on an ordinary Monday (2 February 2026, five-day week, Rp8,650,000): four approved and the fifth keyed as incentive (at most 4 a day) are paid at their band, and the run reports the breach.',
		citation: [
			'PP 35/2021 art.26(1): overtime at most 4 hours a day and 18 a week (https://jdih.kemnaker.go.id/asset/data_puu/PP352021.pdf); tracker ID-43 (LIT-07): approved overtime stays within the ceiling and the rest is keyed as incentive hours',
			OT_REF,
			'09:00–12:00 + 12:30–16:30 + 17:00–21:00 + 21:30–23:30 = 13 h, 5 past the 8-hour day, no stint over four hours: 1 × 1.5 × 50,000 + 4 × 2 × 50,000 = 475,000 (the fifth hour, an incentive hour, keeps the 2× of its band)',
			SRC.TER,
			'Gross 9,125,000; TER gross 9,125,000 + 20,760 + 25,950 + 346,000 = 9,517,710, TER A 8,550,001–9,650,000 at 1.75% = 166,559.93 → 166,560; net 9,125,000 − 173,000 − 86,500 − 86,500 − 166,560 = 8,612,440'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'lembur', wage: 8_650_000 }),
			(() => {
				const day = ordered(
					punch(
						'lembur',
						'2026-02-02',
						['09:00', '12:00'],
						['12:30', '16:30'],
						['17:00', '21:00'],
						['21:30', '23:30']
					),
					4
				);
				return { ...day, values: { ...day.values, incentive_hours: 1 } };
			})()
		],
		period: '2026-02',
		warnings: [
			'DAILY_OVERTIME_LIMIT_EXCEEDED: P-ID-lembur worked 5\\.00 overtime hours on 2026-02-02, above the 4-hour daily overtime limit'
		],
		expected: [
			{
				employment: 'lembur_job',
				lines: { ...EIGHT_SIX_FIVE, gross: 9_125_000, net: 8_612_440, 'PPH21.employee': 166_560 }
			}
		]
	},
	{
		id: 'ID-19-3',
		profile: 'ID',
		description:
			'Two joiners at Kabupaten Bekasi on Rp10,000,000, January 2026: one hired 15 January is paid 17/31 = Rp5,483,870.97, under the Rp5,938,885 UMK, so Kesehatan is lifted to the whole UMK; one hired 12 January is paid 20/31 = Rp6,451,612.90, above it, and is charged on the wage paid.',
		citation: [
			SRC.KES,
			'West Java Kep. Gubernur 862/2025: Kabupaten Bekasi UMK 2026 Rp5,938,885 (https://jdih.jabarprov.go.id/page/eksekusi_download/32/2025kg00320862.pdf; tracker ID-96); the Kesehatan floor is the workplace UMK (Perpres 82/2018 art.32(2)–(3) as amended by Perpres 59/2024)',
			SRC.PRORATE,
			SRC.JHT,
			SRC.JP,
			SRC.TER,
			'15 January joiner: JHT 200,000 / 370,000, JKK 24,000, JKM 30,000 on the monthly rate; JP on 5,483,870.97 = 54,838.71 → 54,839 / 109,677.42 → 109,677; Kesehatan on the UMK 59,388.85 → 59,389 / 237,555.40 → 237,555; TER gross 5,483,870.97 + 24,000 + 30,000 + 237,555 = 5,775,425.97, TER A 5,650,001–5,950,000 at 0.5% = 28,877.13 → 28,877; net 5,483,870.97 − 200,000 − 54,839 − 59,389 − 28,877 = 5,140,765.97',
			'12 January joiner: JP on 6,451,612.90 = 64,516 / 129,032; Kesehatan 64,516 / 258,064.52 → 258,065; TER gross 6,763,677.90 at 1.25% (6,750,001–7,500,000) = 84,545.97 → 84,546; net 6,451,612.90 − 200,000 − 64,516 − 64,516 − 84,546 = 6,038,034.90'
		],
		company: company({ region: 'Provinsi Jawa Barat/Kabupaten Bekasi' }),
		inputs: [
			...week('2025-06-02'),
			...(
				[
					['bks1', '2026-01-15'],
					['bks2', '2026-01-12']
				] as const
			).flatMap(([ref, hire]) =>
				worker({ ref, wage: 10_000_000, hire, worksite: 'Provinsi Jawa Barat/Kabupaten Bekasi' })
			)
		],
		period: '2026-01',
		expected: [
			{
				employment: 'bks1_job',
				lines: {
					gross: 5_483_870.97,
					net: 5_140_765.97,
					'JHT.employee': 200_000,
					'JHT.employer': 370_000,
					'JP.employee': 54_839,
					'JP.employer': 109_677,
					'JKK.employer': 24_000,
					'JKM.employer': 30_000,
					'KESEHATAN.employee': 59_389,
					'KESEHATAN.employer': 237_555,
					'PPH21.employee': 28_877
				}
			},
			{
				employment: 'bks2_job',
				lines: {
					gross: 6_451_612.9,
					net: 6_038_034.9,
					'JHT.employee': 200_000,
					'JHT.employer': 370_000,
					'JP.employee': 64_516,
					'JP.employer': 129_032,
					'JKK.employer': 24_000,
					'JKM.employer': 30_000,
					'KESEHATAN.employee': 64_516,
					'KESEHATAN.employer': 258_065,
					'PPH21.employee': 84_546
				}
			}
		]
	},
	{
		id: 'ID-52-7',
		profile: 'ID',
		description:
			'A BPJS-verified labour-intensive employer (PP 7/2025) in December 2025, group I, a 1 December joiner on Rp10,000,000: JKK halved to 0.12% on the December 2025 version.',
		citation: [
			'PP 7/2025 arts.3(3)–(4), 4(1), 10 as extended by PP 36/2025 art.10A: JKK I 0.120% for contribution months February 2025 to January 2026 (https://jdih.kemnaker.go.id/peraturan/detail/2641/peraturan-pemerintah-nomor-7-tahun-2025; https://jdih.kemnaker.go.id/download.php?id=2720; tracker ID-52)',
			SRC.JHT,
			SRC.JP,
			SRC.KES,
			SRC.LAST,
			'JKK 0.12% × 10,000,000 = 12,000; JHT 200,000 / 370,000; JP 100,000 / 200,000 (under the 10,547,400 ceiling); JKM 30,000; Kesehatan 100,000 / 400,000 (above the 2025 DKI UMP 5,396,761)',
			'December is the joiner’s last tax period: 10,000,000 + 12,000 + 30,000 + 400,000 = 10,442,000 − biaya jabatan 500,000 (one month) − JHT 200,000 − JP 100,000 − PTKP 54,000,000 < 0 → PPh 21 0; net 10,000,000 − 200,000 − 100,000 − 100,000 = 9,600,000'
		],
		company: company({ facts: { jkk_padat_karya: true } }),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'padat25', wage: 10_000_000, hire: '2025-12-01' })
		],
		period: '2025-12',
		expected: [
			{
				employment: 'padat25_job',
				lines: {
					net: 9_600_000,
					'JHT.employee': 200_000,
					'JHT.employer': 370_000,
					'JP.employee': 100_000,
					'JP.employer': 200_000,
					'JKK.employer': 12_000,
					'JKM.employer': 30_000,
					'KESEHATAN.employee': 100_000,
					'KESEHATAN.employer': 400_000
				}
			}
		]
	},
	...(
		[
			['ID-69-3', '1971-06-15', false],
			['ID-69-4', '1972-06-15', true]
		] as const
	).map(([id, dob, refusedRun]): ProbeCase => ({
		id,
		profile: 'ID',
		description: refusedRun
			? 'A citizen aged 53 (born 15 June 1972) recorded NOT_REGISTERED for JKP, February 2026: still under 54, so JKP participation is required and the run is refused.'
			: 'A citizen aged exactly 54 (born 15 June 1971) recorded NOT_REGISTERED for JKP, February 2026: a worker who has reached 54 is outside JKP, so the run commits on the ID-14-1 figures.',
		citation: [
			'PP 37/2021 art.4 as amended by PP 6/2025 art.I(1): JKP covers an Indonesian worker “belum mencapai usia 54 (lima puluh empat) tahun” at registration (https://jdih.kemnaker.go.id/asset/data_puu/2025pp006.pdf)',
			'JKP has no payslip charge beyond the full JKK bill: PP 6/2025 art.I(2) (tracker ID-18)',
			...(refusedRun
				? []
				: [SRC.TER, 'ID-14-1 figures (JP applies below pension age 59): net 9,338,650'])
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'jkp54', wage: 10_000_000, dob }),
			{
				collection: 'employment_statutory_facts',
				values: {
					employee_id: '@jkp54',
					statutory_contribution_id: '@law:statutory_contributions:JKP',
					effective_range: { from: '2025-06-02', to: null },
					status: {
						kind: 'NOT_REGISTERED',
						reason: 'The employer has not registered the worker for JKP'
					}
				}
			}
		],
		period: '2026-02',
		...(refusedRun
			? {
					refused: 'JKP cannot be marked not registered for an Indonesian worker under 54',
					expected: []
				}
			: { expected: [{ employment: 'jkp54_job', lines: TEN_MILLION }] })
	})),
	...(
		[
			['ID-175-2', 'with no prior-work review on file', null, false],
			[
				'ID-175-3',
				'whose prior-work review (NONE) is dated 15 January 2026, before the service began, so it does not speak for this stint',
				{ foreign_prior_work: 'NONE', foreign_prior_work_reviewed_on: '2026-01-15' },
				true
			],
			[
				'ID-175-4',
				'whose review found earlier work in Indonesia (ANY), so six months of cumulative work cannot be ruled out',
				{ foreign_prior_work: 'ANY', foreign_prior_work_reviewed_on: '2026-02-01' },
				true
			]
		] as const
	).map(([id, what, facts, evidence]): ProbeCase => ({
		id,
		profile: 'ID',
		description: `The ID-175-1 foreign worker (five-month PKWT from 1 February 2026, non-resident, Rp20,000,000) ${what}: the short contract alone does not exclude Kesehatan, so the run is refused.`,
		citation: [KES_FOREIGN],
		company: company(),
		inputs: [...week('2025-06-02'), ...shortForeigner(`asing${id.slice(-1)}`, facts, evidence)],
		period: '2026-02',
		refused: KES_FOREIGN_REFUSAL,
		expected: []
	})),
	{
		id: 'ID-13-4',
		profile: 'ID',
		description:
			'Tahun Baru Imlek on 17 February 2026: a Konghucu PKWTT worker hired 1 December 2025 on Rp10,000,000 who resigns on 30 January (18 days before the holiday) is owed a one-twelfth THR in the final pay; a PKWT worker whose contract ends the same day before the holiday is not, so that request is refused and the PKWT compensation is paid.',
		citation: [
			'Permenaker 6/2016 art.7(1)–(3): a PKWTT worker whose employment ends within 30 days before the religious holiday is owed THR; a PKWT worker whose contract ends before the holiday is not; arts.2(1), 3(1)(b): after one month of service, months ÷ 12 × one month’s wage (https://jdih.kemnaker.go.id/asset/data_puu/permenaker_6_2016.pdf); Tahun Baru Imlek is a religious holiday (art.1 angka 2) and a 2026 national holiday on 17 February (SKB 2026, tracker ID-120)',
			'PP 35/2021 arts.15–16: PKWT compensation 1 month ÷ 12 × 10,000,000 = 833,333.33 → 833,333 (https://jdih.kemnaker.go.id/asset/data_puu/PP352021.pdf); PP 35/2021 art.50: resignation, UPH and uang pisah per PK/PP/PKB (Rp2,000,000 recorded)',
			SRC.PRORATE,
			SRC.PP68,
			SRC.LAST,
			'Paid 10,000,000 × 30/31 = 9,677,419.35; JHT 200,000 / 370,000; JKK 24,000; JKM 30,000; JP 96,774.19 → 96,774 / 193,548.39 → 193,548; Kesehatan 96,774 / 387,096.77 → 387,097',
			'THR 10,000,000 × 1/12 = 833,333.33 (one completed month, 1 December – 30 January); last period: 9,677,419.35 + 833,333.33 + 24,000 + 30,000 + 387,097 − biaya jabatan 500,000 − JHT 200,000 − JP 96,774 − PTKP 54,000,000 < 0 → PPh 21 0; uang pisah and PKWT compensation under Rp50m at 0% final',
			'Net PKWTT 9,677,419.35 + 833,333.33 + 2,000,000 − 200,000 − 96,774 − 96,774 = 12,117,204.68; PKWT 9,677,419.35 + 833,333 − 393,548 = 10,117,204.35'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({
				ref: 'imlek1',
				wage: 10_000_000,
				hire: '2025-12-01',
				exit: '2026-01-30',
				religion: 'CONFUCIAN',
				exit_ground: 'RESIGNATION',
				exit_facts: departure('VOLUNTARY_RESIGNATION', {
					thr_holiday_date: '2026-02-17',
					separation_pay_amount: 2_000_000,
					separation_pay_reference: 'PKB-PROBE-UANG-PISAH'
				})
			}),
			adhoc('imlek1', 'THR', '2026-01-30'),
			adhoc('imlek1', 'UANG_PISAH', '2026-01-30'),
			...worker({
				ref: 'imlek2',
				wage: 10_000_000,
				type: 'CONTRACT',
				hire: '2025-12-01',
				exit: '2026-01-30',
				religion: 'CONFUCIAN',
				exit_ground: 'END_OF_CONTRACT',
				exit_facts: departure(null, { thr_holiday_date: '2026-02-17' })
			}),
			{
				...adhoc('imlek2', 'THR', '2026-01-30'),
				refused: 'THR is not offered to .*: its eligibility rule does not hold'
			},
			adhoc('imlek2', 'PKWT_COMPENSATION', '2026-01-30')
		],
		period: '2026-01',
		expected: (
			[
				['imlek1_job', { THR: 833_333.33, UANG_PISAH: 2_000_000 }, 12_117_204.68],
				['imlek2_job', { PKWT_COMPENSATION: 833_333 }, 10_117_204.35]
			] as const
		).map(([employment, pay, net]) => ({
			employment,
			lines: {
				...(pay as Lines),
				net,
				BASIC: 9_677_419.35,
				'JHT.employee': 200_000,
				'JHT.employer': 370_000,
				'JP.employee': 96_774,
				'JP.employer': 193_548,
				'JKK.employer': 24_000,
				'JKM.employer': 30_000,
				'KESEHATAN.employee': 96_774,
				'KESEHATAN.employer': 387_097
			}
		}))
	},
	{
		id: 'ID-170-1',
		profile: 'ID',
		description:
			'Idul Fitri twice in the entry’s calendar year (21 March 2026 and a second, synthetic occurrence tagged on 22 December 2026 — no published SKB has one): a Muslim worker hired 1 September 2025 on Rp12,000,000 is paid two six-twelfths THRs in March; a third request is refused.',
		citation: [
			'Permenaker 6/2016 art.5(1)–(2): THR once a year, but where the same religious holiday falls more than once in a year, THR for each occurrence (https://jdih.kemnaker.go.id/asset/data_puu/permenaker_6_2016.pdf; tracker ID-170)',
			'Arts.2–3: six months of service, 6/12 × 12,000,000 = 6,000,000 each; ceiling 2 × 6,000,000 = 12,000,000, so a third 6,000,000 is refused',
			SRC.TER,
			SRC.JP,
			'ID-13-2 figures: BPJS on 12,000,000 (JHT 240,000 / 444,000; JP on 11,086,300 110,863 / 221,726; JKK 28,800; JKM 36,000; Kesehatan 120,000 / 480,000); TER gross 24,544,800 at 10% = 2,454,480; net 24,000,000 − 240,000 − 110,863 − 120,000 − 2,454,480 = 21,074,657'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...(
				[
					['2026-03-21', 'Idul Fitri 1447 H', 'SKB 2026 (probe)'],
					['2026-12-22', 'Idul Fitri (synthetic second occurrence)', 'synthetic (probe)']
				] as const
			).map(([date, name, source]): ProbeInput => ({
				collection: 'jurisdiction_holidays',
				values: {
					company_id: '@company',
					date,
					name,
					kind: 'PUBLIC_HOLIDAY',
					given_to: 'EVERYONE',
					religion: 'ISLAM',
					source,
					published_at: '2026-01-02T00:00:00.000Z'
				}
			})),
			...worker({ ref: 'fitri2', wage: 12_000_000, hire: '2025-09-01', religion: 'ISLAM' }),
			adhoc('fitri2', 'THR', '2026-03-10'),
			adhoc('fitri2', 'THR', '2026-03-11'),
			{ ...adhoc('fitri2', 'THR', '2026-03-12'), refused: 'THR entitlement exceeded' }
		],
		period: '2026-03',
		expected: [
			{
				employment: 'fitri2_job',
				lines: {
					THR: 12_000_000,
					net: 21_074_657,
					'JHT.employee': 240_000,
					'JHT.employer': 444_000,
					'JP.employee': 110_863,
					'JP.employer': 221_726,
					'JKK.employer': 28_800,
					'JKM.employer': 36_000,
					'KESEHATAN.employee': 120_000,
					'KESEHATAN.employer': 480_000,
					'PPH21.employee': 2_454_480
				}
			}
		]
	},
	...(
		[
			['ID-06-4', 9_000_000, true],
			['ID-06-5', 3_000_000, false]
		] as const
	).map(([id, deduction, refusedRun]): ProbeCase => ({
		id,
		profile: 'ID',
		description: refusedRun
			? 'The ID-28-1 leaver (hired 5 January 2026, Rp10,000,000, let go on 23 January for efficiency to prevent loss) with a Rp9,000,000 art.63 deduction from the final pay: above half of the final payment however it is read (half of the whole 16,129,032.26 is 8,064,516.13; half of the wage 3,064,516.13), so the run is refused.'
			: 'The same leaver with a Rp3,000,000 art.63 deduction from the final pay: within half of the final wage payment (3,064,516.13), so it is taken and the pesangon is paid.',
		citation: [
			'PP 36/2021 art.65: the art.63(1) deductions total at most 50% of each wage payment, the final one included (https://jdih.kemnaker.go.id/asset/data_puu/PP362021.pdf; tracker ID-06)',
			...(refusedRun
				? []
				: [
						SRC.PESANGON,
						SRC.PRORATE,
						SRC.LAST,
						'ID-28-1 figures: net 15,806,452.26 − 3,000,000 = 12,806,452.26'
					])
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({
				ref: 'akhir',
				wage: 10_000_000,
				hire: '2026-01-05',
				exit: '2026-01-23',
				exit_ground: 'REDUNDANCY',
				exit_facts: departure('EFFICIENCY_PREVENT_LOSS', { separation_wage_basis: 'MONTHLY' })
			}),
			adhoc('akhir', 'PESANGON', '2026-01-23'),
			adhoc('akhir', 'DEDUCTION', '2026-01-20', deduction)
		],
		period: '2026-01',
		...(refusedRun
			? {
					refused: 'DEDUCTION_CEILING_EXCEEDED: P-ID-akhir: deductions exceed the lawful ceiling',
					expected: []
				}
			: {
					expected: [
						{
							employment: 'akhir_job',
							lines: {
								PESANGON: 10_000_000,
								DEDUCTION: 3_000_000,
								net: 12_806_452.26,
								BASIC: 6_129_032.26,
								'JHT.employee': 200_000,
								'JHT.employer': 370_000,
								'JP.employee': 61_290,
								'JP.employer': 122_581,
								'JKK.employer': 24_000,
								'JKM.employer': 30_000,
								'KESEHATAN.employee': 61_290,
								'KESEHATAN.employer': 245_161
							}
						}
					]
				})
	})),
	unresolved(
		'ID-99-5',
		'A workplace recorded as "Provinsi Bali/Kota Singaraja" (Singaraja is a town in Kabupaten Buleleng, not a city or regency with a wage decision), February 2026: an unrecognised locality never inherits the provincial UMP, so the run is refused.',
		'Bali Kep.1021/2025 names four UMKs and expressly places Bangli, Buleleng, Jembrana, Karangasem and Klungkung on the UMP (https://cloud-ng.baliprov.go.id/disnakeresdm/2025/12/PENGUMUMAN-DAN-SK-UMP-UMSP-2026.pdf; tracker ID-99, ID-102)',
		'2026-02',
		'Provinsi Bali/Kota Singaraja',
		'Kota Singaraja'
	)
];

// ─── Phase 2 (2026-10-01): stored checks and the obligation ledger ──────────────────────────────
const PROBATION_REF =
	'UU 13/2003 art.60(1): a PKWTT may require probation of at most three months (https://jdih.kemnaker.go.id/peraturan/detail/27/undang-undang-nomor-13-tahun-2003); art.58(1)–(2) as amended by UU 6/2023 and PP 35/2021 art.12: a PKWT may not require probation (https://jdih.kemnaker.go.id/asset/data_puu/PP352021.pdf)';
const PKWT_CAP_REF =
	'PP 35/2021 art.8(1)–(2): a PKWT, extensions included, at most five years (https://jdih.kemnaker.go.id/asset/data_puu/PP352021.pdf); UU 13/2003 art.56(3) as amended by UU 6/2023, read with MK 168/PUU-XXI/2023';
/** A worker whose first terms are attempted with `facts` and refused, then written without them. */
const refusedFirstTerms = (inputs: ProbeInput[], facts: Row, refused: string): ProbeInput[] =>
	inputs.flatMap((input) => {
		if (input.collection !== 'employment_terms') return [input];
		const values = { ...input.values, facts: { ...(input.values.facts as Row), ...facts } };
		return [{ collection: input.collection, values, refused }, input];
	});
/**
 * The duty instances of one code raised on a subject. The obligation ledger is raised by the daily
 * `obligation_calendar` sweep (no writer raises inline), so these `saved` oracles need the harness to run that
 * sweep after the event run and before judging `saved`.
 */
const duty = (code: string, subject: string, rows: readonly Row[]) => ({
	collection: 'obligation_instances',
	where: { duty_code: code, subject_id: subject },
	rows
});

const round12: ProbeCase[] = [
	{
		id: 'ID-110-1',
		profile: 'ID',
		description:
			'A PKWTT worker hired Monday 1 December 2025 (the lineage’s first version: a hire before it has no law in force to judge its terms) whose first terms state probation to 1 March 2026 (three months and a day) are refused at the terms write; the same terms with probation to 28 February 2026 are saved, and February 2026 pays the ID-14-1 slip.',
		citation: [
			PROBATION_REF,
			'1 December 2025 + 3 months = 1 March 2026, so the last probation day is 28 February 2026',
			'ID-14-1 figures: net 9,338,650'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...refusedFirstTerms(
				worker({
					ref: 'coba',
					wage: 10_000_000,
					hire: '2025-12-01',
					terms_facts: { probation_end_on: '2026-02-28' }
				}),
				{ probation_end_on: '2026-03-01' },
				'P-ID-coba: A PKWTT probation may last at most three months from the first day of work'
			)
		],
		period: '2026-02',
		expected: [{ employment: 'coba_job', lines: { ...TEN_MILLION, BASIC: 10_000_000 } }]
	},
	{
		id: 'ID-110-2',
		profile: 'ID',
		description:
			'A citizen PKWT of 1 December 2025 (the lineage’s first version) to 31 December 2026 whose first terms state a probation to 28 February 2026 are refused (a PKWT may not require probation); the same terms without it are saved, and February 2026 pays the ID-14-1 slip.',
		citation: [PROBATION_REF, 'ID-14-1 figures: net 9,338,650'],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...refusedFirstTerms(
				worker({
					ref: 'kontrak',
					wage: 10_000_000,
					type: 'CONTRACT',
					hire: '2025-12-01',
					exit: '2026-12-31'
				}),
				{ probation_end_on: '2026-02-28' },
				'P-ID-kontrak: A fixed-term contract \\(PKWT\\) may not require a probation period'
			)
		],
		period: '2026-02',
		expected: [{ employment: 'kontrak_job', lines: { ...TEN_MILLION, BASIC: 10_000_000 } }]
	},
	{
		id: 'ID-108-1',
		profile: 'ID',
		description:
			'A citizen PKWT recorded from 2 June 2025 to 2 June 2030 (five years and a day), February 2026: the run is refused until the contract ends within five years or is recorded as PKWTT.',
		citation: [
			PKWT_CAP_REF,
			'2 June 2025 + 60 months = 2 June 2030, so the last lawful day is 1 June 2030'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'lima', wage: 10_000_000, type: 'CONTRACT', exit: '2030-06-02' })
		],
		period: '2026-02',
		refused: 'PKWT_TERM_OVER_FIVE_YEARS.*may last at most five years',
		expected: []
	},
	{
		id: 'ID-108-2',
		profile: 'ID',
		description:
			'A citizen PKWT of 2 June 2025 to 1 June 2030, exactly five years, February 2026: lawful, the ID-14-1 slip.',
		citation: [PKWT_CAP_REF, 'ID-14-1 figures: net 9,338,650'],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'genap', wage: 10_000_000, type: 'CONTRACT', exit: '2030-06-01' })
		],
		period: '2026-02',
		expected: [{ employment: 'genap_job', lines: { ...TEN_MILLION, BASIC: 10_000_000 } }]
	},
	{
		id: 'ID-47-1',
		profile: 'ID',
		description:
			'A worker born 1 March 2010 (15 in February 2026) on Rp10,000,000: paid the ID-14-1 slip, and the run warns that a child may be employed only under the arts.69–71 exceptions and their conditions.',
		citation: [
			'UU 13/2003 arts.1 angka 26 (a child is under 18), 68 (no employment of children), 69–71 (light work at 13–15 with parental consent, at most 3 hours a day, daytime, outside school hours; curriculum; talent), 74 (worst forms) (https://jdih.kemnaker.go.id/peraturan/detail/27/undang-undang-nomor-13-tahun-2003); tracker ID-47 owner default: the exceptions are lawful, so the run warns',
			'ID-14-1 figures: net 9,338,650'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'muda', wage: 10_000_000, dob: '2010-03-01' })
		],
		period: '2026-02',
		warnings: ['YOUNG_WORKER_CONDITIONS: .*under 18'],
		expected: [{ employment: 'muda_job', lines: { ...TEN_MILLION, BASIC: 10_000_000 } }]
	},
	{
		id: 'ID-20-1',
		profile: 'ID',
		description:
			'The ID-14-1 February 2026 run raises its monthly duties: BPJS Ketenagakerjaan by 15 March, BPJS Kesehatan by 10 February (the wage month’s own 10th), PPh 21 payment by 15 March and the SPT Masa by 20 March (both kept ten years); no BPA1 outside December.',
		citation: [
			'PP 44/2015 art.22(1): BPJS Ketenagakerjaan contributions by the 15th of the month after the contribution month (https://www.bpjsketenagakerjaan.go.id/assets/uploads/peraturan/15122015_104557_PP%2044%20Tahun%202015.pdf)',
			'Perpres 82/2018 art.39(1): BPJS Kesehatan by the 10th of each month (https://jdih.kemenkeu.go.id/api/download/FullText/2018/82TAHUN2018PERPRES.pdf)',
			'PMK 81/2024 art.94(2): PPh 21 paid by the 15th of the following month (https://peraturan.bpk.go.id/Details/306614/pmk-no-81-tahun-2024); UU KUP art.3(3)(a): SPT Masa within 20 days after the period; art.28(11): records kept 10 years',
			'Wage month February 2026: month end 28 February; + 15 = 15 March; + 20 = 20 March; 1 February + 9 = 10 February; 15 March 2026 + 10 years = 15 March 2036, 20 March 2036',
			'ID-14-1 figures: net 9,338,650'
		],
		company: company(),
		inputs: [...week('2025-06-02'), ...worker({ ref: 'wajib', wage: 10_000_000 })],
		period: '2026-02',
		expected: [{ employment: 'wajib_job', lines: { ...TEN_MILLION, BASIC: 10_000_000 } }],
		saved: [
			duty('BPJS_KETENAGAKERJAAN_REMITTANCE', '@run', [
				{ trigger_ref: '2026-02', due_on: '2026-03-15', state: 'OPEN', amount_due: null }
			]),
			duty('BPJS_KESEHATAN_REMITTANCE', '@run', [
				{ trigger_ref: '2026-02', due_on: '2026-02-10', state: 'OPEN' }
			]),
			duty('PPH21_PAYMENT', '@run', [
				{ trigger_ref: '2026-02', due_on: '2026-03-15', retain_until: '2036-03-15' }
			]),
			duty('PPH21_SPT_MASA', '@run', [
				{ trigger_ref: '2026-02', due_on: '2026-03-20', retain_until: '2036-03-20' }
			]),
			duty('PPH21_BPA1_YEAR_END', '@run', [])
		]
	},
	{
		id: 'ID-26-1',
		profile: 'ID',
		description:
			'The ID-122-1 December 2026 run (a 1 December joiner on Rp60,000,000): December is the last tax period, so it raises the year’s BPA1 by 31 January 2027 beside the PPh 21 payment (15 January) and SPT Masa (20 January).',
		citation: [
			'PER-11/PJ/2025 art.7(2): BPA1 within one month after the last tax period ends (https://jdih.kemenkeu.go.id/dok/per-11pj2025); PMK 168/2023: December is the last tax period',
			'PMK 81/2024 art.94(2); UU KUP arts.3(3)(a), 28(11) (as ID-20-1)',
			'December 2026: 1 December + 1 month = 1 January 2027, month end 31 January 2027; 31 December + 15 = 15 January 2027; + 20 = 20 January 2027'
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({ ref: 'akhir', wage: 60_000_000, hire: '2026-12-01' })
		],
		period: '2026-12',
		expected: [],
		saved: [
			duty('PPH21_BPA1_YEAR_END', '@run', [
				{ trigger_ref: '2026-12', due_on: '2027-01-31', retain_until: '2037-01-31' }
			]),
			duty('PPH21_PAYMENT', '@run', [{ trigger_ref: '2026-12', due_on: '2027-01-15' }]),
			duty('PPH21_SPT_MASA', '@run', [{ trigger_ref: '2026-12', due_on: '2027-01-20' }])
		]
	},
	{
		id: 'ID-92-1',
		profile: 'ID',
		description:
			'The ID-28-1 leavers of Friday 23 January 2026: the redundancy (efficiency to prevent loss) raises the JKP PHK notice to BPJS by Tuesday 3 February, the seventh working day; the resignation raises none. Each leaver raises a BPA1 by 28 February (the exit month is the last tax period).',
		citation: [
			'Permenaker 2/2025 art.9: the employer notifies BPJS of a JKP participant’s PHK within seven working days (https://jdih.kemnaker.go.id/asset/data_puu/2025pmnaker002.pdf); PP 37/2021 art.20 as amended by PP 6/2025: resignation is not a JKP termination',
			'Working days after Friday 23 January 2026: 26, 27, 28, 29, 30 January, 2 and 3 February — no national holiday falls in the window (SKB 2026, tracker ID-120)',
			'PER-11/PJ/2025 art.7(2): BPA1 within one month after the last tax period; the exit month January ends 31 January, so by 28 February 2026',
			SRC.PESANGON
		],
		company: company(),
		inputs: [
			...week('2025-06-02'),
			...worker({
				ref: 'tono',
				wage: 10_000_000,
				hire: '2026-01-05',
				exit: '2026-01-23',
				exit_ground: 'REDUNDANCY',
				exit_facts: departure('EFFICIENCY_PREVENT_LOSS', { separation_wage_basis: 'MONTHLY' })
			}),
			adhoc('tono', 'PESANGON', '2026-01-23'),
			...worker({
				ref: 'vina',
				wage: 10_000_000,
				hire: '2026-01-05',
				exit: '2026-01-23',
				exit_ground: 'RESIGNATION',
				exit_facts: departure('VOLUNTARY_RESIGNATION', {
					separation_pay_amount: 2_000_000,
					separation_pay_reference: 'PKB-PROBE-UANG-PISAH'
				})
			}),
			adhoc('vina', 'UANG_PISAH', '2026-01-23')
		],
		period: '2026-01',
		expected: [],
		saved: [
			duty('JKP_PHK_NOTIFICATION', '@tono_job', [
				{ trigger_ref: '2026-01-23', due_on: '2026-02-03', subject_kind: 'EMPLOYMENT' }
			]),
			duty('JKP_PHK_NOTIFICATION', '@vina_job', []),
			duty('PPH21_BPA1_EXIT', '@tono_job', [{ due_on: '2026-02-28', retain_until: '2036-02-28' }]),
			duty('PPH21_BPA1_EXIT', '@vina_job', [{ due_on: '2026-02-28' }])
		]
	}
];

register(...cases, ...round10, ...round11, ...round12);
