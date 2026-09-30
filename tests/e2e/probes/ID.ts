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
	exit_reason?: string;
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
				...(w.exit_reason == null ? {} : { exit_reason: w.exit_reason }),
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
					exit_reason: reason,
					exit_facts: departure(cause, { separation_wage_basis: 'MONTHLY' })
				}),
				adhoc(ref, 'PESANGON', '2026-01-23')
			]),
			...worker({
				ref: 'vina',
				wage: 10_000_000,
				hire: '2026-01-05',
				exit: '2026-01-23',
				exit_reason: 'RESIGNATION',
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
					exit_reason: 'REDUNDANCY',
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
				exit_reason: 'REDUNDANCY',
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
				exit_reason: 'REDUNDANCY',
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
				exit_reason: 'END_OF_CONTRACT',
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
					event_kind: 'MARRIAGE',
					event_relationship: 'SELF',
					event_date: '2026-02-09'
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
					event_kind: 'RELIGIOUS_DUTY',
					event_date: '2026-02-02'
				}),
				'2026-02'
			],
			[
				'ID-12-2',
				'Two days of leave when the worker’s wife gives birth (18–19 February 2026), paid.',
				'UU 13/2003 arts.93(2)(c), 93(4)(e): the wife gives birth or miscarries, two days paid (https://jdih.kemnaker.go.id/asset/data_puu/peraturan_file_13.pdf, read 2026-09-30)',
				'MALE',
				leave('x', 'PATERNITY_LEAVE', '2026-02-18', '2026-02-19', {
					event_kind: 'BIRTH',
					event_relationship: 'CHILD',
					event_date: '2026-02-18'
				}),
				'2026-02'
			],
			[
				'ID-12-3',
				'Two days of leave for the marriage of the worker’s child (23–24 February 2026), paid.',
				'UU 13/2003 arts.93(2)(c), 93(4)(b): the worker marries off a child, two days paid (https://jdih.kemnaker.go.id/asset/data_puu/peraturan_file_13.pdf, read 2026-09-30)',
				'MALE',
				leave('x', 'CHILD_MARRIAGE_LEAVE', '2026-02-23', '2026-02-24', {
					event_kind: 'MARRIAGE',
					event_relationship: 'CHILD',
					event_date: '2026-02-23'
				}),
				'2026-02'
			],
			[
				'ID-12-4',
				'Two days of leave for the circumcision of the worker’s child (25–26 February 2026), paid.',
				'UU 13/2003 arts.93(2)(c), 93(4)(c): the worker has a child circumcised, two days paid (https://jdih.kemnaker.go.id/asset/data_puu/peraturan_file_13.pdf, read 2026-09-30)',
				'MALE',
				leave('x', 'CHILD_CIRCUMCISION_LEAVE', '2026-02-25', '2026-02-26', {
					event_kind: 'CIRCUMCISION',
					event_relationship: 'CHILD',
					event_date: '2026-02-25'
				}),
				'2026-02'
			],
			[
				'ID-12-5',
				'Two days of leave for the baptism of the worker’s child (12–13 February 2026), paid.',
				'UU 13/2003 arts.93(2)(c), 93(4)(d): the worker has a child baptised, two days paid (https://jdih.kemnaker.go.id/asset/data_puu/peraturan_file_13.pdf, read 2026-09-30)',
				'MALE',
				leave('x', 'CHILD_BAPTISM_LEAVE', '2026-02-12', '2026-02-13', {
					event_kind: 'BAPTISM',
					event_relationship: 'CHILD',
					event_date: '2026-02-12'
				}),
				'2026-02'
			],
			[
				'ID-12-6',
				'Two days of bereavement leave on the death of the worker’s parent (5–6 February 2026), paid.',
				'UU 13/2003 arts.93(2)(c), 93(4)(f): a spouse, parent, parent-in-law, child or child-in-law dies, two days paid (https://jdih.kemnaker.go.id/asset/data_puu/peraturan_file_13.pdf, read 2026-09-30)',
				'MALE',
				leave('x', 'BEREAVEMENT_LEAVE', '2026-02-05', '2026-02-06', {
					event_kind: 'DEATH',
					event_relationship: 'PARENT',
					event_date: '2026-02-05'
				}),
				'2026-02'
			],
			[
				'ID-12-7',
				'One day of leave on the death of a member of the worker’s household (20 February 2026), paid.',
				'UU 13/2003 arts.93(2)(c), 93(4)(g): another member of the household dies, one day paid (https://jdih.kemnaker.go.id/asset/data_puu/peraturan_file_13.pdf, read 2026-09-30)',
				'MALE',
				leave('x', 'BEREAVEMENT_HOUSEHOLD_LEAVE', '2026-02-20', '2026-02-20', {
					event_kind: 'DEATH',
					event_relationship: 'HOUSEHOLD',
					event_date: '2026-02-20'
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
						event_kind: 'MISCARRIAGE',
						event_date: '2026-02-02'
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
					event_kind: 'BIRTH',
					event_date: '2026-02-02'
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

register(...cases);
