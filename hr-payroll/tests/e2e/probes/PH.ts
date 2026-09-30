import {
	officeWeek,
	register,
	type ProbeCase,
	type ProbeInput,
	type Row
} from '../payroll-probe.ts';

/**
 * PH cases: see the case shape at the top of payroll-probe.ts. Every figure is worked by hand from the
 * cited instrument (the arithmetic is in each case's `citation`), never read off a golden or the seed.
 *
 * Shared ground: an NCR/Manila office on a Monday-to-Friday week (Saturday off, Sunday rest, 09:00–18:00
 * with a 60-minute meal break), so the monthly-paid daily rate is the 261-day factor, monthly × 12 ÷ 261,
 * and a whole month is 21.75 days. The company records no holidays unless a case adds them, so July 2026
 * (no national holiday in Proclamation 1006) is the default month. No statutory registration is recorded:
 * a missing registration waives nothing (tracker PH-R46).
 */

const SSS =
	'SSS Circular 2024-006 (19 Dec 2024), Schedule of SSS Contributions, Business Employers and Employees, effective January 2025 (read 30 Sep 2026): compensation below ₱5,250 → MSC ₱5,000, then ₱500 brackets to "34,750 – Over" → MSC ₱35,000; Regular SS on MSC up to ₱20,000 at employer 10% / employee 5%, MPF on the MSC above ₱20,000 at the same rates; EC ₱10 through the 14,250–14,749.99 bracket and ₱30 from 14,750 (https://www.sss.gov.ph/wp-content/uploads/2024/12/CI-2024-006-Publication.pdf); compensation is all actual remuneration for the month (RA 11199 s.8(f))';
const PHIC =
	'PhilHealth: RA 11223 s.10; PhilHealth Circular 2020-0005 Rev.1 §V.A–C and Advisory PA2025-0002 ¶1 — 5% of the monthly basic salary, floor ₱10,000 (₱500) and ceiling ₱100,000 (₱5,000), shared equally; the premium is taken to the centavo and a half-centavo half goes employee-down, employer-up (tracker default PH-SRC01, the circular states no centavo rule); leave without pay does not reduce the monthly basic (PA2025-0002) (https://www.philhealth.gov.ph/circulars/2020/circ2020-0005.pdf)';
const HDMF =
	'Pag-IBIG: RA 9679; HDMF Circular 460 pp.2–3 as annexed to DMW Advisory 37-2025 — fund salary (basic plus other remuneration, commissions included) capped at ₱10,000; employee 1% at ₱1,500 or below and 2% above; employer 2% (https://wcms.dmw.gov.ph/uploads/DMW_ADVISORY_37_2025_01225b9fec.pdf)';
const WTAX =
	'Withholding: BIR RR 11-2018 Annex E, revised table effective 1 January 2023 (read 30 Sep 2026) — MONTHLY: ₱20,833 and below 0.00; 20,833–33,332: 15% over 20,833; 33,333–66,666: 1,875.00 + 20% over 33,333; 66,667–166,666: 8,541.80 + 25% over 66,667; 166,667–666,666: 33,541.80 + 30% over 166,667; SEMI-MONTHLY: 10,417–16,666: 15% over 10,417 (https://bir-cdn.bir.gov.ph/local/pdf/Annex%20E%20RR%2011-2018.pdf); employee SSS (Regular SS and MPF), PhilHealth and Pag-IBIG shares are excluded from taxable compensation (NIRC s.32(B)(7)(f); RR 11-2018 s.6); tax to the centavo';
const DAILY =
	'Daily rate of a monthly-paid five-day worker without paid rest days: monthly × 12 ÷ 261 (DOLE factor, tracker PH-WG59): ₱30,450 → ₱1,400 a day, ₱175 an hour (Labor Code art.83: eight hours)';
const HANDBOOK =
	'DOLE Handbook on Workers’ Statutory Monetary Benefits 2024 (https://nwpc.dole.gov.ph/wp-content/uploads/2024/11/Workers-Statutory-Monetary-Benefits-Handbook-2024-Edition.pdf)';
const NCR26 =
	'Wage Order NCR-26: ₱695 a day, non-agriculture, NCR, through 25 September 2026 (tracker PH-WG10; https://nwpc.dole.gov.ph/wp-content/uploads/2025/06/01.-Wage-Order-No.-NCR-26.pdf); below-floor pay refuses unless the board approved an exemption (RA 6727 s.4(c))';
const DOMESTIC =
	'RA 10361 (Batas Kasambahay) s.24 (regional domestic floor, paid monthly) and s.30 (a kasambahay on ₱5,000 a month or more pays the proportionate SSS, PhilHealth and Pag-IBIG shares); a kasambahay paid the floor is a minimum-wage earner, exempt from withholding (NIRC s.24(A)(2)) (https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/51514)';

const company = (facts: Row = {}, extra: Row = {}): Row => ({
	effective_range: { from: '2010-01-01', to: null },
	// Labor Code art.95(b) / art.302 establishment tests: an ordinary establishment of more than ten.
	facts: { small_establishment: false, retirement_exempt_establishment: false, ...facts },
	...extra
});

type Hire = {
	ref: string;
	name: string;
	born: string;
	gender?: 'MALE' | 'FEMALE';
	from: string;
	to?: string;
	salary: number;
	worksite?: string;
	sector?: string | null;
	type?: string;
	employee?: Row;
	employment?: Row;
	terms?: Row;
};

/** One person, their employment and one terms row, in the shared NCR office unless stated. */
const hire = (h: Hire): ProbeInput[] => [
	{
		collection: 'employees',
		ref: h.ref,
		values: {
			name: h.name,
			date_of_birth: h.born,
			gender: h.gender ?? 'MALE',
			nationality: 'Filipino',
			...h.employee
		}
	},
	{
		collection: 'employments',
		ref: `${h.ref}_job`,
		values: {
			employee_id: `@${h.ref}`,
			company_id: '@company',
			employee_number: `P-PH-${h.ref}`,
			effective_range: { from: h.from, to: h.to ?? null },
			...h.employment
		}
	},
	{
		collection: 'employment_terms',
		ref: `${h.ref}_terms`,
		values: {
			employment_id: `@${h.ref}_job`,
			residency_status: 'CITIZEN',
			tax_residency: 'RESIDENT',
			currency: 'PHP',
			base_salary: h.salary,
			pay_frequency: 'MONTHLY',
			work_classification: 'EA_COVERED',
			statutory_work_category: 'NON_MANUAL',
			employment_type: h.type ?? 'PERMANENT',
			worksite: h.worksite ?? 'NCR/Manila',
			worksite_sector: h.sector === undefined ? 'OTHER_NONAGRI' : h.sector,
			shift_pattern_id: '@week',
			effective_range: { from: h.from, to: h.to ?? null },
			...h.terms
		}
	}
];

type Charges = {
	sss: [number, number];
	mpf?: [number, number];
	ec: number;
	phic: [number, number];
	hdmf: [number, number];
	wtax?: number;
};
/** The statutory line keys of one slip; every scheme that charges is named. */
const charges = (c: Charges) => ({
	'SSS.employee': c.sss[0],
	'SSS.employer': c.sss[1],
	...(c.mpf ? { 'SSS_MPF.employee': c.mpf[0], 'SSS_MPF.employer': c.mpf[1] } : {}),
	'SSS_EC.employer': c.ec,
	'PHIC.employee': c.phic[0],
	'PHIC.employer': c.phic[1],
	'HDMF.employee': c.hdmf[0],
	'HDMF.employer': c.hdmf[1],
	...(c.wtax ? { 'WTAX.employee': c.wtax } : {})
});

const week = officeWeek('2010-01-04');
/**
 * The rows the departure settlement (`leave_encashment_on_exit`) raises for a leaver: each separation class at 0,
 * priced by its catalogue formula, and the unused service incentive leave to commute.
 */
const separation = (
	ref: string,
	exit: string,
	codes: readonly string[],
	leaveDays = 0
): ProbeInput[] => [
	...codes.map((code): ProbeInput => ({
		collection: 'adhoc_requests',
		values: {
			employment_id: `@${ref}_job`,
			catalogue_id: `@law:adhoc_catalogue:${code}@${exit}`,
			amount: 0,
			event_date: exit,
			pay_period: exit.slice(0, 7),
			reason: `${code} on departure`
		}
	})),
	...(leaveDays > 0
		? [
				{
					collection: 'leave_entries',
					values: {
						employment_id: `@${ref}_job`,
						catalogue_id: `@law:leave_catalogue:ANNUAL_LEAVE@${exit}`,
						reference: `exit-${ref}-ANNUAL_LEAVE`,
						from_date: `${exit.slice(0, 4)}-01-01`,
						to_date: `${exit.slice(0, 4)}-12-31`,
						days: leaveDays,
						encash_days: leaveDays,
						effective_on: exit,
						due_on: exit,
						reason: 'Unused service incentive leave on departure (Labor Code art.95)'
					}
				} satisfies ProbeInput
			]
		: [])
];

const at = (day: string, from: string, to: string) => ({
	start: `${day}T${from}:00+08:00`,
	end: `${day}T${to}:00+08:00`
});

/** A monthly salary on the NCR office, one person, full month: the contribution and table seams. */
const seam = (
	id: string,
	description: string,
	salary: number,
	c: Charges,
	net: number,
	employerCost: number,
	arithmetic: string,
	options: { exempt?: boolean; type?: string; terms?: Row; period?: string } = {}
): ProbeCase => ({
	id,
	profile: 'PH',
	description,
	citation: [
		SSS,
		PHIC,
		HDMF,
		WTAX,
		...(options.exempt
			? [
					'Below the NCR floor only because the establishment records a regional-board exemption (company fact minimum_wage_exemption_approved, RA 6727 s.4(c)): the case isolates the contribution seam'
				]
			: []),
		arithmetic
	],
	company: company(options.exempt ? { minimum_wage_exemption_approved: true } : {}),
	inputs: [
		...week,
		...hire({
			ref: 'w',
			name: 'Juan Dela Cruz',
			born: '1990-05-14',
			from: '2020-01-06',
			salary,
			type: options.type,
			terms: options.terms
		})
	],
	period: options.period ?? '2026-07',
	expected: [
		{
			employment: 'w_job',
			lines: { gross: salary, net, employer_cost: employerCost, BASIC: salary, ...charges(c) }
		}
	]
});

/** A kasambahay paid exactly the household worksite's floor for the whole month. */
const domestic = (
	id: string,
	worksite: string,
	salary: number,
	period: string,
	order: string,
	sss: [number, number],
	hdmf: number,
	description: string
): ProbeCase => {
	const phic: [number, number] = [250, 250];
	const net = Math.round((salary - sss[0] - phic[0] - hdmf) * 100) / 100;
	const cost = sss[1] + 10 + phic[1] + hdmf;
	return {
		id,
		profile: 'PH',
		description,
		citation: [
			order,
			DOMESTIC,
			SSS,
			PHIC,
			HDMF,
			`SSS on ₱${salary}: MSC ${sss[0] * 20} → ${sss[0]} / ${sss[1]}, EC 10; PhilHealth on the ₱10,000 floor → 250 / 250; Pag-IBIG 2% of ${salary} → ${hdmf} / ${hdmf}; net ${salary} − ${sss[0]} − 250 − ${hdmf} = ${net}; employer cost ${sss[1]} + 10 + 250 + ${hdmf} = ${cost}`
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'k',
				name: 'Maria Santos',
				gender: 'FEMALE',
				born: '1988-02-11',
				from: '2024-01-08',
				salary,
				worksite,
				sector: null,
				type: 'DOMESTIC'
			})
		],
		period,
		expected: [
			{
				employment: 'k_job',
				lines: {
					gross: salary,
					net,
					employer_cost: cost,
					...charges({ sss, ec: 10, phic, hdmf: [hdmf, hdmf] })
				}
			}
		]
	};
};

/** The worksite and sector sources a regional (non-NCR) private class needs, each evidenced by reference and file. */
const SOURCES = ['wage_worksite_source', 'wage_sector_source'] as const;
const sourced = (ref: string, order: string): ProbeInput[] =>
	SOURCES.map((key): ProbeInput => ({
		collection: 'fact_evidence',
		values: {
			subject: { collection: 'employment_terms', id: `@${ref}_terms` },
			fact_key: key,
			reference: `PROBE-${key}-${ref}`
		},
		files: { file: `${key}.pdf` }
	}));

/**
 * A private worker at a regional worksite paid a monthly salary on the shared five-day week (the order's daily
 * rate × 261 ÷ 12, tracker PH-WG59), the order's municipality and sector recorded as evidenced terms facts.
 */
const regional = (
	worksite: string,
	sector: string,
	salary: number,
	order: string
): ProbeInput[] => [
	...week,
	...hire({
		ref: 'w',
		name: 'Juan Dela Cruz',
		born: '1990-05-14',
		from: '2020-01-06',
		salary,
		worksite,
		sector,
		terms: {
			facts: {
				wage_worksite_source: `${worksite}: ${order}`,
				wage_sector_source: `${sector}: ${order}`
			}
		}
	}),
	...sourced('w', order)
];

/** A regional private worker at exactly the order's daily floor for the whole month. */
const site = (
	id: string,
	description: string,
	worksite: string,
	sector: string,
	salary: number,
	period: string,
	order: string,
	c: Charges,
	net: number,
	employerCost: number,
	arithmetic: string
): ProbeCase => ({
	id,
	profile: 'PH',
	description,
	citation: [order, SSS, PHIC, HDMF, WTAX, arithmetic],
	company: company(),
	inputs: regional(worksite, sector, salary, order),
	period,
	expected: [
		{
			employment: 'w_job',
			lines: { gross: salary, net, employer_cost: employerCost, BASIC: salary, ...charges(c) }
		}
	]
});

/**
 * A contract below the floor in force during the period — a private worker (sector named) or a kasambahay (sector
 * null): no exemption is recorded (RA 6727 s.4(c)) and a domestic floor admits none, so the run is refused.
 */
const below = (
	id: string,
	description: string,
	worksite: string,
	sector: string | null,
	salary: number,
	period: string,
	order: string
): ProbeCase => ({
	id,
	profile: 'PH',
	description,
	citation: [
		order,
		sector === null
			? DOMESTIC
			: `RA 6727 s.4 and the order's coverage section: every private minimum wage earner in the region, whatever the payment method; the daily rate × 261 ÷ 12 on a five-day week (tracker PH-WG59); ₱${salary} a month is below it`
	],
	company: company(),
	inputs:
		sector === null
			? [
					...week,
					...hire({
						ref: 'k',
						name: 'Maria Santos',
						gender: 'FEMALE',
						born: '1988-02-11',
						from: '2024-01-08',
						salary,
						worksite,
						sector: null,
						type: 'DOMESTIC'
					})
				]
			: regional(worksite, sector, salary, order),
	period,
	refused: `MINIMUM_WAGE_BELOW: P-PH-${sector === null ? 'k' : 'w'} is contracted at `,
	expected: []
});

const FULL_30450 = {
	sss: [1000, 2000],
	mpf: [525, 1050],
	ec: 30,
	phic: [761.25, 761.25],
	hdmf: [200, 200],
	wtax: 1069.61
} satisfies Charges;

const O_NCR26A =
	'Wage Order NCR-26: agriculture (plantation and non-plantation), service/retail employing 15 workers or less and manufacturing regularly employing less than 10 workers ₱658 a day, through 25 Sep 2026 (https://nwpc.dole.gov.ph/wp-content/uploads/2025/06/01.-Wage-Order-No.-NCR-26.pdf; NCR-28 states it as the baseline, https://nwpc.dole.gov.ph/ncr/, read 30 Sep 2026)';
const O_NCR28 =
	'Wage Order NCR-28 ss.1–3 (issued 7 Sep, published 11 Sep, effective 26 Sep 2026): NCR-26 baseline + ₱60 — non-agriculture ₱695 → ₱755; agriculture (plantation and non-plantation), service/retail employing 15 workers or less and manufacturing regularly employing less than 10 workers ₱658 → ₱718 (https://nwpc.dole.gov.ph/wp-content/uploads/2026/09/Wage-Order-No.-NCR-28.pdf; https://nwpc.dole.gov.ph/ncr/, read 30 Sep 2026)';
const O_III =
	'Wage Order No. RBIII-26 (effective 30 Oct 2025; second tranche 16 Apr 2026), Bataan, Bulacan, Nueva Ecija, Pampanga, Tarlac, Zambales: non-agriculture ₱570 → ₱600, agriculture ₱540 → ₱570, retail/service ₱560 → ₱590 (https://nwpc.dole.gov.ph/wp-content/uploads/2025/10/Wage-Order-No.-RBIII-26.pdf; https://nwpc.dole.gov.ph/region-iii/, read 30 Sep 2026)';
const O_IX =
	'Wage Order No. RIX-24 (published 16 Dec 2025, effective 1 Jan 2026): non-agriculture (including retail/service of 10 workers or more) ₱414 → ₱439 → ₱464 and agriculture ₱401 → ₱426 → ₱451, second tranche 1 June 2026 (https://nwpc.dole.gov.ph/wp-content/uploads/2025/12/Wage-Order-No.-RIX-24.pdf; https://nwpc.dole.gov.ph/region-ix/, read 30 Sep 2026)';
const O_X =
	'Wage Order No. RX-24 ss.1–4 (published 31 Dec 2025, effective 16 Jan 2026): Category I (Cities of Cagayan de Oro, Iligan and the other named areas) non-agriculture and agriculture ₱461 → ₱486 → ₱500, Category II ₱446 → ₱471 → ₱485, second tranche 1 May 2026 (https://nwpc.dole.gov.ph/wp-content/uploads/2025/12/Wage-Order-No.-RX-24.pdf; https://nwpc.dole.gov.ph/region-x/, read 30 Sep 2026)';
const O_XI =
	'Wage Order No. RB XI-24 (issued 19 Feb, published 25 Feb 2026): non-agriculture ₱510 → ₱525 from 13 Mar 2026 → ₱540 from 1 Sep 2026; agriculture ₱505 → ₱515 → ₱525 (https://nwpc.dole.gov.ph/wp-content/uploads/2026/02/Wage-Order-No.-RB-XI-24.pdf; https://nwpc.dole.gov.ph/region-xi/, read 30 Sep 2026)';
const O_XIII =
	'Wage Order No. RXIII-20 (published 18 Dec 2025, effective 3 Jan 2026): every sector ₱435 → ₱455, ₱475 from 1 May 2026 (https://nwpc.dole.gov.ph/wp-content/uploads/2025/12/Wage-Order-No.-RXIII-20.pdf; https://nwpc.dole.gov.ph/region-xiii/, read 30 Sep 2026)';
const O_IVA =
	"Wage Order No. IVA-22 s.2 table (issued 3 Sep, published 19 Sep, effective 5 Oct 2025): reclassified first-class municipalities (DOF DO 074-2024) non-agriculture ₱450 + ₱60 + ₱40 (1 Apr 2026) = ₱550; second- to fifth-class municipalities non-agriculture ₱450 + ₱60 + ₱15 (1 Apr 2026) = ₱525 and agriculture ₱425 + ₱60 + ₱23 (1 Apr 2026) = ₱508 (https://nwpc.dole.gov.ph/wp-content/uploads/2025/09/Wage-Order-No.-IVA-22_compressed.pdf; https://nwpc.dole.gov.ph/region-iva/, read 30 Sep 2026); Amadeo is a second- to fifth-class and Noveleta a reclassified first-class Cavite municipality as the seed's worksite classes record them";
const O_IVB =
	'Wage Order No. RB-MIMAROPA-13 ss.1–4 (published 16 Dec 2025, effective 1 Jan 2026): ₱455 a day for every establishment size (https://nwpc.dole.gov.ph/wp-content/uploads/2025/12/Wage-Order-No.-MIMAROPA-13.pdf; https://nwpc.dole.gov.ph/region-ivb/, read 30 Sep 2026)';
const O_XII =
	'Wage Order No. RB XII-25 (effective 2 Nov 2025; second tranche 15 Dec 2025): non-agriculture/retail/service ₱450 → ₱460, agriculture ₱433 → ₱443 (https://nwpc.dole.gov.ph/wp-content/uploads/2025/10/Wage-Order-No.-RBXII-25.pdf; https://nwpc.dole.gov.ph/region-xii/, read 30 Sep 2026)';
const O_II =
	'Wage Order No. RTWPB 2-24 (issued 8 Oct, published 20 Oct, effective 5 Nov 2025): non-agriculture ₱480 + ₱20 and agriculture ₱460 + ₱40, each ₱500 a day (https://nwpc.dole.gov.ph/wp-content/uploads/2025/10/Wage-Order-No.-RTWPB-2-24.pdf; https://nwpc.dole.gov.ph/region-ii/, read 30 Sep 2026)';
const O_V =
	'Wage Order No. RBV-23 (issued 3 Mar, published 23 Mar, effective 8 Apr 2026): all sectors ₱435 → ₱455, ₱480 from 1 Dec 2026 (https://nwpc.dole.gov.ph/wp-content/uploads/2026/03/Wage-Order-No.-RBV-23.pdf; https://nwpc.dole.gov.ph/region-v/, read 30 Sep 2026)';
const O_BARMM =
	'Wage Order No. BARMM-05 s.2 (issued 15 Jul, published 21 Jul, effective 6 Aug 2026): Cotabato City/Lamitan City/Marawi City non-agriculture ₱411 → ₱436, a further ₱25 to ₱461 from 1 Dec 2026 (https://nwpc.dole.gov.ph/wp-content/uploads/2026/07/Wage-Order-No.-BARMM-05.pdf; https://nwpc.dole.gov.ph/barmm/, read 30 Sep 2026)';
const O_VIII =
	'Wage Order No. RB VIII-25 ss.1–2, 6 (approved 10 Nov, published 22 Nov, effective 8 Dec 2025): non-agriculture and service/retail of more than 10 workers ₱435 → ₱452 → ₱470, second tranche 1 June 2026 (https://nwpc.dole.gov.ph/wp-content/uploads/2025/11/Wage-Order-No.-RB-VIII-25.pdf; https://nwpc.dole.gov.ph/region-viii/, read 30 Sep 2026)';
/** A Monday-to-Saturday office week with Sunday rest (no paid rest day): the 313-day factor (tracker PH-WG59). */
const six: ProbeInput[] = [
	{
		collection: 'shift_patterns',
		ref: 'six',
		values: {
			company_id: '@company',
			code: 'OFFICEx6-REST',
			name: '6 x OFFICE, REST',
			pattern: {
				days: ['@office', '@office', '@office', '@office', '@office', '@office', '@rest'].map(
					(roster_code_id) => ({ roster_code_id })
				)
			},
			effective_range: { from: '2010-01-04', to: null }
		}
	}
];

register(
	// ── Full month and every contribution seam ────────────────────────────────────────────────
	seam(
		'PH-SS01-1',
		'A resident office worker on ₱30,450 a month, the whole of July 2026 worked in NCR: SSS, MPF, EC, PhilHealth, Pag-IBIG and the monthly withholding table, with no registration recorded.',
		30_450,
		FULL_30450,
		26_894.14,
		4041.25,
		'SSS: 30,450 is in 30,250–30,749.99 → MSC 30,500: SS 1,000 / 2,000, MPF 500 × 5% / 10% = 525 / 1,050, EC 30. PhilHealth 30,450 × 5% = 1,522.50 → 761.25 / 761.25. Pag-IBIG capped 200 / 200. Taxable 30,450 − (1,525 + 761.25 + 200) = 27,963.75 → 15% × (27,963.75 − 20,833) = 1,069.6125 → 1,069.61. Net 30,450 − 2,486.25 − 1,069.61 = 26,894.14; employer cost 2,000 + 1,050 + 30 + 761.25 + 200 = 4,041.25.'
	),
	seam(
		'PH-SS01-2',
		'The SSS floor: ₱5,000 insures at the minimum MSC of ₱5,000; PhilHealth charges its ₱10,000 floor; Pag-IBIG 2%.',
		5000,
		{ sss: [250, 500], ec: 10, phic: [250, 250], hdmf: [100, 100] },
		4400,
		860,
		'SSS "Below 5,250" → MSC 5,000: 250 / 500, EC 10. PhilHealth on the ₱10,000 floor: 500 → 250 / 250. Pag-IBIG 2% × 5,000 = 100 / 100. Taxable 5,000 − 600 = 4,400 → 0. Net 4,400; employer cost 500 + 10 + 250 + 100 = 860.',
		{ exempt: true }
	),
	seam(
		'PH-SRC06-1',
		'The EC seam from below: ₱14,749.99 is the last ₱10 EC bracket (MSC 14,500).',
		14_749.99,
		{ sss: [725, 1450], ec: 10, phic: [368.75, 368.75], hdmf: [200, 200] },
		13_456.24,
		2028.75,
		'SSS 14,250–14,749.99 → MSC 14,500: 725 / 1,450, EC 10. PhilHealth 14,749.99 × 5% = 737.4995 → 737.50 → 368.75 / 368.75. Pag-IBIG 200 / 200. Taxable 13,456.24 → 0. Net 14,749.99 − 1,293.75 = 13,456.24; employer cost 1,450 + 10 + 368.75 + 200 = 2,028.75.',
		{ exempt: true }
	),
	seam(
		'PH-SRC06-2',
		'The EC seam from above: ₱14,750 opens MSC 15,000 and the ₱30 EC.',
		14_750,
		{ sss: [750, 1500], ec: 30, phic: [368.75, 368.75], hdmf: [200, 200] },
		13_431.25,
		2098.75,
		'SSS 14,750–15,249.99 → MSC 15,000: 750 / 1,500, EC 30. PhilHealth 14,750 × 5% = 737.50 → 368.75 / 368.75. Pag-IBIG 200 / 200. Taxable 13,431.25 → 0. Net 14,750 − 1,318.75 = 13,431.25; employer cost 1,500 + 30 + 368.75 + 200 = 2,098.75.',
		{ exempt: true }
	),
	seam(
		'PH-SS01-3',
		'The MPF seam from below: ₱20,249.99 insures at MSC 20,000, all Regular SS, no MPF.',
		20_249.99,
		{ sss: [1000, 2000], ec: 30, phic: [506.25, 506.25], hdmf: [200, 200] },
		18_543.74,
		2736.25,
		'SSS 19,750–20,249.99 → MSC 20,000: 1,000 / 2,000, MPF none, EC 30. PhilHealth 20,249.99 × 5% = 1,012.4995 → 1,012.50 → 506.25 / 506.25. Pag-IBIG 200 / 200. Taxable 20,249.99 − 1,706.25 = 18,543.74 → 0 (under 20,833). Net 18,543.74; employer cost 2,000 + 30 + 506.25 + 200 = 2,736.25.'
	),
	seam(
		'PH-SS01-4',
		'The MPF seam from above: ₱20,250 insures at MSC 20,500, the first ₱500 of MPF.',
		20_250,
		{ sss: [1000, 2000], mpf: [25, 50], ec: 30, phic: [506.25, 506.25], hdmf: [200, 200] },
		18_518.75,
		2786.25,
		'SSS 20,250–20,749.99 → MSC 20,500: SS 1,000 / 2,000, MPF 25 / 50, EC 30. PhilHealth 1,012.50 → 506.25 / 506.25. Pag-IBIG 200 / 200. Taxable 20,250 − 1,731.25 = 18,518.75 → 0. Net 18,518.75; employer cost 2,000 + 50 + 30 + 506.25 + 200 = 2,786.25.'
	),
	seam(
		'PH-SS01-5',
		'The SSS ceiling: ₱40,000 insures at the maximum MSC of ₱35,000 (MPF 15,000); the third withholding rung.',
		40_000,
		{
			sss: [1000, 2000],
			mpf: [750, 1500],
			ec: 30,
			phic: [1000, 1000],
			hdmf: [200, 200],
			wtax: 2618.4
		},
		34_431.6,
		4730,
		'SSS "34,750 – Over" → MSC 35,000: SS 1,000 / 2,000, MPF 750 / 1,500, EC 30. PhilHealth 2,000 → 1,000 / 1,000. Pag-IBIG 200 / 200. Taxable 40,000 − 2,950 = 37,050 → 1,875 + 20% × (37,050 − 33,333) = 2,618.40. Net 40,000 − 2,950 − 2,618.40 = 34,431.60; employer cost 2,000 + 1,500 + 30 + 1,000 + 200 = 4,730.'
	),
	seam(
		'PH-HL01-1',
		'The PhilHealth ceiling: ₱120,000 pays the ₱100,000-ceiling premium of ₱5,000; the fourth withholding rung.',
		120_000,
		{
			sss: [1000, 2000],
			mpf: [750, 1500],
			ec: 30,
			phic: [2500, 2500],
			hdmf: [200, 200],
			wtax: 20_762.55
		},
		94_787.45,
		6230,
		'SSS MSC 35,000: 1,000 / 2,000, MPF 750 / 1,500, EC 30. PhilHealth capped at 100,000 × 5% = 5,000 → 2,500 / 2,500. Pag-IBIG 200 / 200. Taxable 120,000 − 4,450 = 115,550 → 8,541.80 + 25% × (115,550 − 66,667) = 20,762.55. Net 120,000 − 4,450 − 20,762.55 = 94,787.45; employer cost 2,000 + 1,500 + 30 + 2,500 + 200 = 6,230.'
	),
	seam(
		'PH-HL01-2',
		'The PhilHealth floor and the Pag-IBIG cap meet at ₱10,000: 500 premium, 200 / 200.',
		10_000,
		{ sss: [500, 1000], ec: 10, phic: [250, 250], hdmf: [200, 200] },
		9050,
		1460,
		'SSS 9,750–10,249.99 → MSC 10,000: 500 / 1,000, EC 10. PhilHealth 10,000 × 5% = 500 → 250 / 250. Pag-IBIG 2% × 10,000 = 200 / 200. Taxable 9,050 → 0. Net 10,000 − 950 = 9,050; employer cost 1,000 + 10 + 250 + 200 = 1,460.',
		{ exempt: true }
	),
	seam(
		'PH-HD01-1',
		'The Pag-IBIG 1% rung: a part-timer on ₱1,500 a month (fund salary ₱1,500 or below) pays 1%, the employer 2%; SSS and PhilHealth still charge their floors.',
		1500,
		{ sss: [250, 500], ec: 10, phic: [250, 250], hdmf: [15, 30] },
		985,
		790,
		'Pag-IBIG: 1,500 is "₱1,500 or below" → employee 1% = 15, employer 2% = 30. SSS "Below 5,250" → MSC 5,000: 250 / 500, EC 10. PhilHealth floor 250 / 250. Taxable 1,500 − 515 = 985 → 0. Net 1,500 − 515 = 985; employer cost 500 + 10 + 250 + 30 = 790. ₱1,500 is below the part-timer’s hour-proportionate floor (695 × 261 ÷ 12 × 20 ÷ 40 = 7,558.13, tracker PH-A3) and pays only because the exemption is recorded.',
		{ exempt: true, type: 'PART_TIME', terms: { ordinary_hours_per_week: 20 } }
	),
	seam(
		'PH-TX01-1',
		'The fifth withholding rung: ₱200,000 a month.',
		200_000,
		{
			sss: [1000, 2000],
			mpf: [750, 1500],
			ec: 30,
			phic: [2500, 2500],
			hdmf: [200, 200],
			wtax: 42_206.7
		},
		153_343.3,
		6230,
		'Charges as at the ceilings: 4,450 employee. Taxable 200,000 − 4,450 = 195,550 → 33,541.80 + 30% × (195,550 − 166,667) = 42,206.70. Net 200,000 − 4,450 − 42,206.70 = 153,343.30; employer cost 6,230.'
	),
	seam(
		'PH-SRC01-1',
		'A half-centavo PhilHealth split: ₱15,819 → premium 790.95 → employee 395.47, employer 395.48.',
		15_819,
		{ sss: [800, 1600], ec: 30, phic: [395.47, 395.48], hdmf: [200, 200] },
		14_423.53,
		2225.48,
		'PhilHealth 15,819 × 5% = 790.95; half 395.475 → employee 395.47, employer 790.95 − 395.47 = 395.48. SSS 15,750–16,249.99 → MSC 16,000: 800 / 1,600, EC 30. Pag-IBIG 200 / 200. Taxable 15,819 − 1,395.47 = 14,423.53 → 0. Net 14,423.53; employer cost 1,600 + 30 + 395.48 + 200 = 2,225.48.'
	),

	// ── Minimum wage ──────────────────────────────────────────────────────────────────────────
	seam(
		'PH-WG10-1',
		'NCR non-agriculture at exactly the NCR-26 floor, July 2026: ₱695 × 261 ÷ 12 = ₱15,116.25 is met, so the run pays; a minimum-wage earner withholds nothing.',
		15_116.25,
		{ sss: [750, 1500], ec: 30, phic: [377.9, 377.91], hdmf: [200, 200] },
		13_788.35,
		2107.91,
		`${NCR26}. SSS 14,750–15,249.99 → MSC 15,000: 750 / 1,500, EC 30. PhilHealth 15,116.25 × 5% = 755.8125 → 755.81 → 377.90 / 377.91. Pag-IBIG 200 / 200. WTAX 0: a minimum-wage earner's statutory minimum wage is exempt (NIRC s.24(A)(2); RR 11-2018 s.6), and 13,788.35 is under 20,833 anyway. Net 15,116.25 − 1,327.90 = 13,788.35; employer cost 1,500 + 30 + 377.91 + 200 = 2,107.91.`
	),
	seam(
		'PH-WG10-2',
		'NCR non-agriculture at exactly the NCR-28 floor, October 2026: ₱755 × 261 ÷ 12 = ₱16,421.25.',
		16_421.25,
		{ sss: [825, 1650], ec: 30, phic: [410.53, 410.53], hdmf: [200, 200] },
		14_985.72,
		2290.53,
		'Wage Order NCR-28 s.1: ₱755 a day non-agriculture from 26 September 2026 (tracker PH-WG10; https://nwpc.dole.gov.ph/wp-content/uploads/2026/09/Wage-Order-No.-NCR-28.pdf); 755 × 261 ÷ 12 = 16,421.25. SSS 16,250–16,749.99 → MSC 16,500: 825 / 1,650, EC 30. PhilHealth 16,421.25 × 5% = 821.0625 → 821.06 → 410.53 / 410.53. Pag-IBIG 200 / 200. WTAX 0 (minimum-wage earner). Net 16,421.25 − 1,435.53 = 14,985.72; employer cost 1,650 + 30 + 410.53 + 200 = 2,290.53.',
		{ period: '2026-10' }
	),
	seam(
		'PH-A3-1',
		'A part-timer on 20 hours a week in NCR, July 2026, with no exemption recorded, paid exactly the hour-proportionate NCR-26 floor: ₱695 × 261 ÷ 12 × 20 ÷ 40 = ₱7,558.13 is met, so the run pays.',
		7558.13,
		{ sss: [375, 750], ec: 10, phic: [250, 250], hdmf: [151.16, 151.16] },
		6781.97,
		1161.16,
		`${NCR26}. Wage Order NCR-28 ss.3–4 (https://nwpc.dole.gov.ph/wp-content/uploads/2026/09/Wage-Order-No.-NCR-28.pdf): the daily rate is for normal working hours of at most eight a day and covers every minimum wage earner regardless of status; ${HANDBOOK} ch.1 §L: less than the normal hours is owed "a proportion thereof". Floor on a five-day week 695 × 261 ÷ 12 = 15,116.25, × 20 of 40 hours (tracker default PH-A3: the full-time week of the person's own factor) = 7,558.125, met by 7,558.13. SSS 7,250–7,749.99 → MSC 7,500: 375 / 750, EC 10. PhilHealth on the ₱10,000 floor 250 / 250. Pag-IBIG 2% × 7,558.13 = 151.1626 → 151.16 / 151.16. WTAX 0 (minimum-wage earner; 6,781.97 is under 20,833 anyway). Net 7,558.13 − (375 + 250 + 151.16) = 6,781.97; employer cost 750 + 10 + 250 + 151.16 = 1,161.16.`,
		{ type: 'PART_TIME', terms: { ordinary_hours_per_week: 20 } }
	),
	{
		...seam(
			'PH-WG24-1',
			'CALABARZON, Cavite/Bacoor (Extended Metropolitan Area) non-agriculture at exactly the IVA-22 floor of ₱600 a day: ₱600 × 261 ÷ 12 = ₱13,050.',
			13_050,
			{ sss: [650, 1300], ec: 10, phic: [326.25, 326.25], hdmf: [200, 200] },
			11_873.75,
			1836.25,
			'Wage Order IVA-22 s.2 table (read 30 Sep 2026): Extended Metropolitan Area, Province of Cavite, City of Bacoor, non-agriculture ₱560 + ₱40 = ₱600 upon effectivity (5 Oct 2025) (https://nwpc.dole.gov.ph/wp-content/uploads/2025/09/Wage-Order-No.-IVA-22_compressed.pdf); 600 × 261 ÷ 12 = 13,050. SSS 12,750–13,249.99 → MSC 13,000: 650 / 1,300, EC 10. PhilHealth 13,050 × 5% = 652.50 → 326.25 / 326.25. Pag-IBIG 200 / 200. WTAX 0 (minimum-wage earner). Net 13,050 − 1,176.25 = 11,873.75; employer cost 1,300 + 10 + 326.25 + 200 = 1,836.25.'
		),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '1990-05-14',
				from: '2020-01-06',
				salary: 13_050,
				worksite: 'Cavite/Bacoor'
			})
		]
	},
	{
		id: 'PH-WH09-1',
		profile: 'PH',
		description:
			'A minimum-wage earner on the NCR-26 floor works two approved overtime hours on Tuesday 7 July 2026: the overtime is SSS compensation but, like the minimum wage, exempt from withholding.',
		citation: [
			NCR26,
			'Labor Code arts.83, 85, 87: eight normal hours; the 60-minute meal period is not hours worked; overtime is the hourly rate plus 25%. 09:00–20:00 less the meal hour is 10 hours: 2 overtime hours × (695 ÷ 8 = 86.875) × 1.25 = 217.1875 → 217.19',
			'NIRC s.24(A)(2); RR 11-2018 s.6 (RR 2-98 s.2.78.1(B)(13)): the statutory minimum wage and the holiday, overtime, night-shift differential and hazard pay of a minimum-wage earner are exempt',
			SSS,
			PHIC,
			HDMF,
			'Gross 15,116.25 + 217.19 = 15,333.44. SSS 15,250–15,749.99 → MSC 15,500: 775 / 1,550, EC 30. PhilHealth on the basic 15,116.25 → 377.90 / 377.91. Pag-IBIG 200 / 200. WTAX 0. Net 15,333.44 − 1,352.90 = 13,980.54; employer cost 1,550 + 30 + 377.91 + 200 = 2,157.91'
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '1990-05-14',
				from: '2020-01-06',
				salary: 15_116.25
			}),
			{
				collection: 'work_days',
				values: {
					employment_id: '@w_job',
					work_date: '2026-07-07',
					shift_definition_id: '@office',
					worked_intervals: [at('2026-07-07', '09:00', '20:00')],
					approved_overtime_hours: 2
				}
			}
		],
		period: '2026-07',
		expected: [
			{
				employment: 'w_job',
				lines: {
					gross: 15_333.44,
					net: 13_980.54,
					employer_cost: 2157.91,
					...charges({ sss: [775, 1550], ec: 30, phic: [377.9, 377.91], hdmf: [200, 200] })
				}
			}
		]
	},

	// ── Part months, unpaid leave, a mid-month raise ──────────────────────────────────────────
	{
		id: 'PH-PR01-1',
		profile: 'PH',
		description:
			'A joiner on Thursday 16 July 2026 on ₱30,450 is paid the 12 working days worked; SSS and Pag-IBIG read what was paid (Pag-IBIG at its ₱10,000 cap either way), PhilHealth the monthly basic.',
		citation: [
			`${HANDBOOK} ch.2 §E: a part month is paid the days worked`,
			DAILY,
			SSS,
			PHIC,
			HDMF,
			WTAX,
			'16–17, 20–24, 27–31 July = 12 working days × 1,400 = 16,800. SSS 16,750–17,249.99 → MSC 17,000: 850 / 1,700, EC 30. PhilHealth on the monthly basic 30,450 → 761.25 / 761.25. Pag-IBIG capped 200 / 200. Taxable 16,800 − 1,811.25 = 14,988.75 → 0. Net 14,988.75; employer cost 1,700 + 30 + 761.25 + 200 = 2,691.25'
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Ana Reyes',
				gender: 'FEMALE',
				born: '1996-09-03',
				from: '2026-07-16',
				salary: 30_450
			})
		],
		period: '2026-07',
		expected: [
			{
				employment: 'w_job',
				lines: {
					gross: 16_800,
					net: 14_988.75,
					employer_cost: 2691.25,
					...charges({ sss: [850, 1700], ec: 30, phic: [761.25, 761.25], hdmf: [200, 200] })
				}
			}
		]
	},
	{
		id: 'PH-PR01-2',
		profile: 'PH',
		description:
			'Two days of leave without pay (Tuesday 14 and Wednesday 15 July 2026) on ₱30,450: the pay and SSS lose 2 × 1,400; PhilHealth keeps the monthly basic.',
		citation: [
			`${HANDBOOK} ch.2 §E (no work, no pay)`,
			DAILY,
			SSS,
			PHIC,
			HDMF,
			WTAX,
			'Gross 30,450 − 2,800 = 27,650. SSS 27,250–27,749.99 → MSC 27,500: SS 1,000 / 2,000, MPF 375 / 750, EC 30. PhilHealth on 30,450 → 761.25 / 761.25. Pag-IBIG 200 / 200. Taxable 27,650 − (1,375 + 761.25 + 200) = 25,313.75 → 15% × 4,480.75 = 672.1125 → 672.11. Net 27,650 − 2,336.25 − 672.11 = 24,641.64; employer cost 2,000 + 750 + 30 + 761.25 + 200 = 3,741.25'
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '1990-05-14',
				from: '2020-01-06',
				salary: 30_450
			}),
			{
				collection: 'leave_entries',
				values: {
					employment_id: '@w_job',
					catalogue_id: '@law:leave_catalogue:UNPAID_LEAVE',
					reference: 'PROBE-PH-NPL',
					from_date: '2026-07-14',
					to_date: '2026-07-15',
					reason: 'Personal matter, unpaid'
				}
			}
		],
		period: '2026-07',
		expected: [
			{
				employment: 'w_job',
				lines: {
					gross: 27_650,
					net: 24_641.64,
					employer_cost: 3741.25,
					...charges({
						sss: [1000, 2000],
						mpf: [375, 750],
						ec: 30,
						phic: [761.25, 761.25],
						hdmf: [200, 200],
						wtax: 672.11
					})
				}
			}
		]
	},
	{
		id: 'PH-PR01-3',
		profile: 'PH',
		description:
			'A raise from ₱110,000 to ₱120,000 on Thursday 16 July 2026 is one month of pay at the day-weighted rate (11 of 23 working days at the old rate, 12 at the new), never more than a month.',
		citation: [
			`${HANDBOOK} ch.2 §E; tracker PH-PR01 (a whole month is one month of pay, so the two rates share the month's own working days)`,
			SSS,
			PHIC,
			HDMF,
			WTAX,
			'July 2026 has 23 weekdays: 1–15 → 11, 16–31 → 12. (110,000 × 11 + 120,000 × 12) ÷ 23 = 2,650,000 ÷ 23 = 115,217.3913 → 115,217.39. SSS, PhilHealth and Pag-IBIG are at their ceilings on either rate: 1,000 / 2,000, 750 / 1,500, EC 30, 2,500 / 2,500, 200 / 200. Taxable 115,217.39 − 4,450 = 110,767.39 → 8,541.80 + 25% × (110,767.39 − 66,667) = 19,566.8975 → 19,566.90. Net 115,217.39 − 4,450 − 19,566.90 = 91,200.49; employer cost 6,230'
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '1990-05-14',
				from: '2020-01-06',
				salary: 110_000,
				terms: { effective_range: { from: '2020-01-06', to: '2026-07-15' } }
			}),
			{
				collection: 'employment_terms',
				values: {
					employment_id: '@w_job',
					residency_status: 'CITIZEN',
					tax_residency: 'RESIDENT',
					currency: 'PHP',
					base_salary: 120_000,
					pay_frequency: 'MONTHLY',
					work_classification: 'EA_COVERED',
					statutory_work_category: 'NON_MANUAL',
					employment_type: 'PERMANENT',
					worksite: 'NCR/Manila',
					worksite_sector: 'OTHER_NONAGRI',
					shift_pattern_id: '@week',
					effective_range: { from: '2026-07-16', to: null }
				}
			}
		],
		period: '2026-07',
		expected: [
			{
				employment: 'w_job',
				lines: {
					gross: 115_217.39,
					net: 91_200.49,
					employer_cost: 6230,
					...charges({
						sss: [1000, 2000],
						mpf: [750, 1500],
						ec: 30,
						phic: [2500, 2500],
						hdmf: [200, 200],
						wtax: 19_566.9
					})
				}
			}
		]
	},
	{
		id: 'PH-PR01-4',
		profile: 'PH',
		description:
			'A joiner on Thursday 16 July 2026 on ₱8,700 is paid the 12 working days worked, ₱4,800: SSS and Pag-IBIG read what was paid, below the Pag-IBIG cap; PhilHealth the monthly basic on its floor.',
		citation: [
			`${HANDBOOK} ch.2 §E: a part month is paid the days worked`,
			'Daily rate 8,700 × 12 ÷ 261 = 400 (tracker PH-WG59)',
			'Below the NCR floor only because the establishment records a regional-board exemption (RA 6727 s.4(c)): the case isolates the part-month base under the Pag-IBIG cap',
			SSS,
			PHIC,
			`${HDMF}; fund salary is the basic salary and other allowances received in the month (Circular 460 p.2)`,
			WTAX,
			'16–17, 20–24, 27–31 July = 12 working days × 400 = 4,800. SSS "Below 5,250" → MSC 5,000: 250 / 500, EC 10. PhilHealth on the monthly basic 8,700, under the ₱10,000 floor → 250 / 250. Pag-IBIG 2% × 4,800 = 96 / 96. Taxable 4,800 − 596 = 4,204 → 0. Net 4,204; employer cost 500 + 10 + 250 + 96 = 856'
		],
		company: company({ minimum_wage_exemption_approved: true }),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Ana Reyes',
				gender: 'FEMALE',
				born: '1996-09-03',
				from: '2026-07-16',
				salary: 8700
			})
		],
		period: '2026-07',
		expected: [
			{
				employment: 'w_job',
				lines: {
					gross: 4800,
					net: 4204,
					employer_cost: 856,
					...charges({ sss: [250, 500], ec: 10, phic: [250, 250], hdmf: [96, 96] })
				}
			}
		]
	},
	{
		id: 'PH-PR01-5',
		profile: 'PH',
		description:
			'Two days of leave without pay (Tuesday 14 and Wednesday 15 July 2026) on ₱8,700: the pay, SSS and Pag-IBIG lose 2 × 400, below the Pag-IBIG cap; PhilHealth keeps the monthly basic.',
		citation: [
			`${HANDBOOK} ch.2 §E (no work, no pay)`,
			'Daily rate 8,700 × 12 ÷ 261 = 400 (tracker PH-WG59)',
			'Below the NCR floor only because the establishment records a regional-board exemption (RA 6727 s.4(c)): the case isolates the reduced base under the Pag-IBIG cap',
			SSS,
			PHIC,
			`${HDMF}; fund salary is the basic salary and other allowances received in the month (Circular 460 p.2)`,
			WTAX,
			'Gross 8,700 − 800 = 7,900. SSS 7,750–8,249.99 → MSC 8,000: 400 / 800, EC 10. PhilHealth on the monthly basic 8,700, under the ₱10,000 floor → 250 / 250. Pag-IBIG 2% × 7,900 = 158 / 158. Taxable 7,900 − 808 = 7,092 → 0. Net 7,092; employer cost 800 + 10 + 250 + 158 = 1,218'
		],
		company: company({ minimum_wage_exemption_approved: true }),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '1990-05-14',
				from: '2020-01-06',
				salary: 8700
			}),
			{
				collection: 'leave_entries',
				values: {
					employment_id: '@w_job',
					catalogue_id: '@law:leave_catalogue:UNPAID_LEAVE',
					reference: 'PROBE-PH-NPL-LOW',
					from_date: '2026-07-14',
					to_date: '2026-07-15',
					reason: 'Personal matter, unpaid'
				}
			}
		],
		period: '2026-07',
		expected: [
			{
				employment: 'w_job',
				lines: {
					gross: 7900,
					net: 7092,
					employer_cost: 1218,
					...charges({ sss: [400, 800], ec: 10, phic: [250, 250], hdmf: [158, 158] })
				}
			}
		]
	},

	// ── Overtime, rest day, holidays ──────────────────────────────────────────────────────────
	{
		id: 'PH-HR06-1',
		profile: 'PH',
		description:
			'On ₱30,450: two approved overtime hours on Monday 6 July 2026 (+25%) and eight hours on the Sunday rest day, 12 July (130% of the day, the rest day being unpaid).',
		citation: [
			'Labor Code arts.83, 85, 87, 93 (DOLE Handbook 2024 chs.2–4): eight normal hours; the 60-minute meal period is not hours worked (09:00–20:00 is 10 hours, 09:00–18:00 is 8); overtime +25% of the hourly rate; rest-day work +30%, 130% of the hourly rate where the rest day is not paid',
			DAILY,
			SSS,
			PHIC,
			HDMF,
			WTAX,
			'Overtime 2 × 175 × 1.25 = 437.50; rest day 8 × 175 × 1.30 = 1,820; gross 30,450 + 2,257.50 = 32,707.50. SSS 32,250–32,749.99 → MSC 32,500: SS 1,000 / 2,000, MPF 625 / 1,250, EC 30. PhilHealth on the basic 761.25 / 761.25. Pag-IBIG 200 / 200. RR 11-2018 s.2.79(B): the bracket is chosen on taxable regular pay 30,450 − 2,586.25 = 27,863.75 (15% rung) and applied to 32,707.50 − 2,586.25 = 30,121.25: 15% × 9,288.25 = 1,393.2375 → 1,393.24. Net 32,707.50 − 2,586.25 − 1,393.24 = 28,728.01; employer cost 2,000 + 1,250 + 30 + 761.25 + 200 = 4,241.25'
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '1990-05-14',
				from: '2020-01-06',
				salary: 30_450
			}),
			{
				collection: 'work_days',
				values: {
					employment_id: '@w_job',
					work_date: '2026-07-06',
					shift_definition_id: '@office',
					worked_intervals: [at('2026-07-06', '09:00', '20:00')],
					approved_overtime_hours: 2
				}
			},
			{
				collection: 'work_days',
				values: {
					employment_id: '@w_job',
					work_date: '2026-07-12',
					worked_intervals: [at('2026-07-12', '09:00', '18:00')],
					approved_overtime_hours: 8
				}
			}
		],
		period: '2026-07',
		expected: [
			{
				employment: 'w_job',
				lines: {
					gross: 32_707.5,
					net: 28_728.01,
					employer_cost: 4241.25,
					...charges({
						sss: [1000, 2000],
						mpf: [625, 1250],
						ec: 30,
						phic: [761.25, 761.25],
						hdmf: [200, 200],
						wtax: 1393.24
					})
				}
			}
		]
	},
	{
		id: 'PH-HR05-1',
		profile: 'PH',
		description:
			'On ₱30,450, eight hours worked on the special non-working day of Friday 21 August 2026 (130%) and on the regular holiday of Monday 31 August 2026 (200%); the monthly salary already pays each day once.',
		citation: [
			'Proclamation 1006 (2026): 21 August (Ninoy Aquino Day) special non-working day, 31 August (National Heroes Day) regular holiday (tracker PH-HR36; https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/7/97992)',
			'Labor Code art.94 and DOLE Handbook 2024 ch.3 §C: a worked regular holiday is 200% of the day; ch.4 §D: a worked special day is 130%. On the 261-day factor the salary pays each day once, so the extra is 100% and 30% of the day',
			DAILY,
			SSS,
			PHIC,
			HDMF,
			WTAX,
			'Special 8 × 175 × 0.30 = 420; regular 8 × 175 × 1.00 = 1,400; gross 30,450 + 1,820 = 32,270. SSS 32,250–32,749.99 → MSC 32,500: 1,000 / 2,000, MPF 625 / 1,250, EC 30. PhilHealth 761.25 / 761.25. Pag-IBIG 200 / 200. Bracket on regular 27,863.75 (15%), applied to 32,270 − 2,586.25 = 29,683.75: 15% × 8,850.75 = 1,327.6125 → 1,327.61. Net 32,270 − 2,586.25 − 1,327.61 = 28,356.14; employer cost 4,241.25'
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '1990-05-14',
				from: '2020-01-06',
				salary: 30_450
			}),
			...(
				[
					['2026-08-21', 'Ninoy Aquino Day', 'SPECIAL_HOLIDAY'],
					['2026-08-31', 'National Heroes Day', 'PUBLIC_HOLIDAY']
				] as const
			).flatMap(([date, name, kind]): ProbeInput[] => [
				{
					collection: 'jurisdiction_holidays',
					values: {
						company_id: '@company',
						date,
						name,
						kind,
						source: 'Proclamation 1006',
						published_at: '2026-01-02T00:00:00.000Z'
					}
				},
				{
					collection: 'work_days',
					values: {
						employment_id: '@w_job',
						work_date: date,
						shift_definition_id: '@office',
						worked_intervals: [at(date, '09:00', '18:00')],
						approved_overtime_hours: 8
					}
				}
			])
		],
		period: '2026-08',
		expected: [
			{
				employment: 'w_job',
				lines: {
					gross: 32_270,
					net: 28_356.14,
					employer_cost: 4241.25,
					...charges({
						sss: [1000, 2000],
						mpf: [625, 1250],
						ec: 30,
						phic: [761.25, 761.25],
						hdmf: [200, 200],
						wtax: 1327.61
					})
				}
			}
		]
	},

	// ── Semi-monthly cadence ──────────────────────────────────────────────────────────────────
	{
		id: 'PH-HR03-1',
		profile: 'PH',
		description:
			'A semi-monthly company (Labor Code art.103: at least twice a month): the first half of July 2026 on ₱30,450 a month pays half the salary, carries the whole month of SSS, PhilHealth and Pag-IBIG, and withholds on the SEMI-MONTHLY column.',
		citation: [
			'Labor Code art.103; Omnibus Rules Book III Rule VIII s.3: wages at least twice a month at intervals of not more than sixteen days (https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/26/25306)',
			'Monthly contributions deducted once, in the first half: the company default semi_monthly_statutory_cutoff FIRST (SSS, PhilHealth and Pag-IBIG are monthly contributions; which half deducts them is the employer’s choice)',
			SSS,
			PHIC,
			HDMF,
			WTAX,
			'Half 30,450 ÷ 2 = 15,225. Month charges on 30,450: SS 1,000 / 2,000, MPF 525 / 1,050, EC 30, PhilHealth 761.25 / 761.25, Pag-IBIG 200 / 200. Semi-monthly taxable 15,225 − 2,486.25 = 12,738.75 → 15% × (12,738.75 − 10,417) = 348.2625 → 348.26. Net 15,225 − 2,486.25 − 348.26 = 12,390.49; employer cost 4,041.25'
		],
		company: company({}, { pay_frequency: 'SEMI_MONTHLY' }),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '1990-05-14',
				from: '2020-01-06',
				salary: 30_450,
				terms: { pay_frequency: 'SEMI_MONTHLY' }
			})
		],
		period: '2026-07-1',
		expected: [
			{
				employment: 'w_job',
				lines: {
					gross: 15_225,
					net: 12_390.49,
					employer_cost: 4041.25,
					...charges({ ...FULL_30450, wtax: 348.26 })
				}
			}
		]
	},

	// ── Bonuses and commissions ───────────────────────────────────────────────────────────────
	...(
		[
			[
				'PH-SS09-1',
				20_000,
				1035.86,
				46_702.89,
				'A ₱20,000 performance bonus in July 2026 on ₱30,450: SSS compensation, not PhilHealth basic, and wholly inside the ₱90,000 benefits exclusion; Pag-IBIG is at its ₱10,000 cap on the salary alone.',
				'Taxable regular 30,450 − (1,750 + 761.25 + 200) = 27,738.75; the bonus is inside the ₱90,000 pool (nothing else paid in 2026) → 15% × 6,905.75 = 1,035.8625 → 1,035.86. Net 50,450 − 2,711.25 − 1,035.86 = 46,702.89'
			],
			[
				'PH-WH08-1',
				100_000,
				2535.86,
				125_202.89,
				'A ₱100,000 bonus in July 2026 on ₱30,450: ₱90,000 is excluded, the ₱10,000 excess is taxed on the regular pay’s bracket.',
				'Taxable regular 27,738.75 selects the 15% rung (RR 11-2018 s.2.79(B)); taxable total 27,738.75 + (100,000 − 90,000) = 37,738.75 → 15% × (37,738.75 − 20,833) = 2,535.8625 → 2,535.86. Net 130,450 − 2,711.25 − 2,535.86 = 125,202.89'
			]
		] as const
	).map(([id, bonus, wtax, net, description, arithmetic]): ProbeCase => ({
		id,
		profile: 'PH',
		description,
		citation: [
			'SSS IRR Rule 12 s.6(iii): a performance bonus is compensation (tracker PH-SS09); PhilHealth reads the monthly basic salary only; Pag-IBIG fund salary is the basic salary and other allowances and remuneration received in the month (Circular 460 p.2), capped at ₱10,000, which the ₱30,450 salary already reaches',
			'NIRC s.32(B)(7)(e); RR 11-2018 s.6: 13th-month pay and other benefits (productivity incentives, bonuses) are excluded up to ₱90,000 a year; the excess is taxable',
			SSS,
			PHIC,
			HDMF,
			WTAX,
			`SSS on 30,450 + ${bonus} → MSC 35,000: SS 1,000 / 2,000, MPF 750 / 1,500, EC 30. PhilHealth on 30,450 → 761.25 / 761.25. Pag-IBIG 200 / 200. ${arithmetic}; employer cost 2,000 + 1,500 + 30 + 761.25 + 200 = 4,491.25`
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '1990-05-14',
				from: '2020-01-06',
				salary: 30_450
			}),
			{
				collection: 'adhoc_requests',
				values: {
					employment_id: '@w_job',
					catalogue_id: '@law:adhoc_catalogue:bonus',
					amount: bonus,
					event_date: '2026-07-15',
					reason: 'Mid-year performance bonus'
				}
			}
		],
		period: '2026-07',
		expected: [
			{
				employment: 'w_job',
				lines: {
					gross: 30_450 + bonus,
					net,
					employer_cost: 4491.25,
					bonus,
					...charges({
						sss: [1000, 2000],
						mpf: [750, 1500],
						ec: 30,
						phic: [761.25, 761.25],
						hdmf: [200, 200],
						wtax
					})
				}
			}
		]
	})),
	{
		id: 'PH-LB05-1',
		profile: 'PH',
		description:
			'A ₱5,000 commission in July 2026 on ₱30,450: SSS compensation and Pag-IBIG fund salary, outside the PhilHealth basic, taxed as compensation.',
		citation: [
			'SSS IRR Rule 12 s.6(ii), (xii): commissions are compensation; DOLE Handbook 2024 ch.13 §F.2 and Boie-Takeda v. De la Serna (G.R. 92174, 10 Dec 1993): commissions are outside the basic salary; HDMF Circular 460 pp.1–2: commissions are fund salary',
			SSS,
			PHIC,
			HDMF,
			WTAX,
			'Gross 35,450. SSS "34,750 – Over" → MSC 35,000: 1,000 / 2,000, MPF 750 / 1,500, EC 30. PhilHealth on 30,450 → 761.25 / 761.25. Pag-IBIG 200 / 200. Taxable 35,450 − 2,711.25 = 32,738.75 (the regular pay alone is already in the 15% rung) → 15% × 11,905.75 = 1,785.8625 → 1,785.86. Net 35,450 − 2,711.25 − 1,785.86 = 30,952.89; employer cost 4,491.25'
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '1990-05-14',
				from: '2020-01-06',
				salary: 30_450
			}),
			{
				collection: 'adhoc_requests',
				values: {
					employment_id: '@w_job',
					catalogue_id: '@law:adhoc_catalogue:COMMISSION',
					amount: 5000,
					event_date: '2026-07-15',
					reason: 'July sales commission'
				}
			}
		],
		period: '2026-07',
		expected: [
			{
				employment: 'w_job',
				lines: {
					gross: 35_450,
					net: 30_952.89,
					employer_cost: 4491.25,
					COMMISSION: 5000,
					...charges({
						sss: [1000, 2000],
						mpf: [750, 1500],
						ec: 30,
						phic: [761.25, 761.25],
						hdmf: [200, 200],
						wtax: 1785.86
					})
				}
			}
		]
	},
	{
		id: 'PH-HD02-1',
		profile: 'PH',
		description:
			'Pag-IBIG fund salary includes commission: ₱5,000 basic plus ₱3,000 commission is a ₱8,000 fund salary (2% = 160 each), while PhilHealth stays on its floor.',
		citation: [
			'HDMF Circular 460 pp.1–2: fund salary is basic salary plus fees, wages, commissions and other remuneration (tracker PH-HD02)',
			'Below the NCR floor only because the establishment records a regional-board exemption (RA 6727 s.4(c)): the case isolates the fund-salary base under the ₱10,000 cap',
			SSS,
			PHIC,
			HDMF,
			'SSS 7,750–8,249.99 → MSC 8,000: 400 / 800, EC 10. PhilHealth on basic 5,000, under the ₱10,000 floor → 250 / 250. Pag-IBIG 2% × 8,000 = 160 / 160. Taxable 8,000 − 810 → 0. Net 8,000 − 810 = 7,190; employer cost 800 + 10 + 250 + 160 = 1,220'
		],
		company: company({ minimum_wage_exemption_approved: true }),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '1990-05-14',
				from: '2020-01-06',
				salary: 5000
			}),
			{
				collection: 'adhoc_requests',
				values: {
					employment_id: '@w_job',
					catalogue_id: '@law:adhoc_catalogue:COMMISSION',
					amount: 3000,
					event_date: '2026-07-15',
					reason: 'July sales commission'
				}
			}
		],
		period: '2026-07',
		expected: [
			{
				employment: 'w_job',
				lines: {
					gross: 8000,
					net: 7190,
					employer_cost: 1220,
					COMMISSION: 3000,
					...charges({ sss: [400, 800], ec: 10, phic: [250, 250], hdmf: [160, 160] })
				}
			}
		]
	},

	// ── Non-resident aliens ───────────────────────────────────────────────────────────────────
	...(
		[
			[
				'PH-WH24-1',
				'NON_RESIDENT_NETB',
				10_000,
				27_050,
				'A non-resident alien not engaged in trade or business, ₱40,000 in July 2026: 25% of the gross compensation, no table and no contribution relief.',
				'NIRC s.25(B); RR 21-2025 s.3: 25% final tax on the gross: 40,000 × 25% = 10,000. Net 40,000 − 2,950 − 10,000 = 27,050'
			],
			[
				'PH-WH24-2',
				'NON_RESIDENT',
				2618.4,
				34_431.6,
				'A non-resident alien engaged in trade or business, ₱40,000 in July 2026: the graduated table, exactly as a resident.',
				'NIRC s.25(A)(1): taxed like a resident on the graduated rates: taxable 40,000 − 2,950 = 37,050 → 1,875 + 20% × 3,717 = 2,618.40. Net 40,000 − 2,950 − 2,618.40 = 34,431.60'
			]
		] as const
	).map(([id, residency, wtax, net, description, arithmetic]): ProbeCase => ({
		id,
		profile: 'PH',
		description,
		citation: [
			'NIRC s.25(A)–(B) (RR 21-2025 s.3, https://bir-cdn.bir.gov.ph/BIR/pdf/RR%20NO.%2021-2025.pdf)',
			'SSS coverage is compulsory for all employees not over sixty (RA 11199 s.9(a)), with no nationality exclusion; PhilHealth and Pag-IBIG carry no nationality branch either (tracker PH-HL01, PH-HD05)',
			SSS,
			PHIC,
			HDMF,
			WTAX,
			`SSS MSC 35,000: 1,000 / 2,000, MPF 750 / 1,500, EC 30. PhilHealth 2,000 → 1,000 / 1,000. Pag-IBIG 200 / 200. ${arithmetic}; employer cost 4,730`
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Kenji Watanabe',
				born: '1985-11-20',
				from: '2026-06-01',
				salary: 40_000,
				employee: { nationality: 'Japanese' },
				terms: { residency_status: 'FOREIGNER', tax_residency: residency }
			})
		],
		period: '2026-07',
		expected: [
			{
				employment: 'w_job',
				lines: {
					gross: 40_000,
					net,
					employer_cost: 4730,
					...charges({
						sss: [1000, 2000],
						mpf: [750, 1500],
						ec: 30,
						phic: [1000, 1000],
						hdmf: [200, 200],
						wtax
					})
				}
			}
		]
	})),

	// ── Leavers ───────────────────────────────────────────────────────────────────────────────
	{
		id: 'PH-HR15-1',
		profile: 'PH',
		description:
			'A redundancy on Friday 13 March 2026 after six years on ₱30,450 (January and February already paid): the part month, a month per year of separation pay, the pro-rata service incentive leave, the pro-rata 13th month and the year-end refund of the tax withheld, all in the final pay.',
		citation: [
			'Labor Code art.298: redundancy pays at least one month’s pay per year of service, a fraction of at least six months a whole year: 2 March 2020 – 13 March 2026 is 6 years → 6 × 30,450 = 182,700; tax-exempt as separation for a cause beyond the employee’s control (NIRC s.32(B)(6)(b))',
			`Labor Code art.95; ${HANDBOOK} ch.7 §D: five days’ service incentive leave a year after a year of service, commuted at separation pro rata at the salary rate: 5 × 2 completed months (January, February) ÷ 12 = 0.8333 day, recorded to the leave quantity’s three decimals as 0.833 × 1,400 = 1,166.20; inside the 12-day monetised-leave de minimis ceiling (RR 29-2025)`,
			'PD 851 Revised Guidelines ¶6 (DOLE Handbook 2024 ch.13 §G): a leaver is owed one twelfth of the basic salary earned in the year: (30,450 + 30,450 + 14,000) ÷ 12 = 6,241.67, inside the ₱90,000 exclusion (NIRC s.32(B)(7)(e))',
			'DOLE Labor Advisory 06-20 §II: final pay within 30 days of separation (13 March + 30 = 12 April; the March run pays 31 March)',
			'RR 11-2018 s.2.79(B)(5) / s.2.83: on termination the employer computes the year’s tax on the year’s compensation and refunds the excess withheld; annual table (NIRC s.24(A)(2)(a)): ₱250,000 and below 0',
			`${HANDBOOK} ch.2 §E; ${DAILY}`,
			SSS,
			PHIC,
			HDMF,
			'January and February: 30,450 each, withheld 1,069.61 each (case PH-SS01-1). March: 2–6 and 9–13 = 10 working days × 1,400 = 14,000. SSS on 14,000 + 1,166.20 = 15,166.20 → MSC 15,000: 750 / 1,500, EC 30. PhilHealth on the monthly basic 761.25 / 761.25. Pag-IBIG 200 / 200. Year taxable 74,900 − (2,486.25 × 2 + 1,711.25) = 68,216.25 → tax 0; WTAX −(1,069.61 × 2) = −2,139.22. Net 14,000 + 182,700 + 1,166.20 − (750 + 761.25 + 200 − 2,139.22) + 6,241.67 = 204,535.84; employer cost 1,500 + 30 + 761.25 + 200 = 2,491.25'
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '1990-05-14',
				from: '2020-03-02',
				to: '2026-03-13',
				salary: 30_450,
				employment: {
					exit_ground: 'REDUNDANCY',
					exit_facts: { termination_cause: 'REDUNDANCY' }
				}
			}),
			{ collection: 'payroll_runs', values: { company_id: '@company', period: '2026-01' } },
			{ collection: 'payroll_runs', values: { company_id: '@company', period: '2026-02' } },
			...separation('w', '2026-03-13', ['SEPARATION_PAY', 'THIRTEENTH_MONTH_PAY'], 0.833)
		],
		period: '2026-03',
		expected: [
			{
				employment: 'w_job',
				lines: {
					net: 204_535.84,
					employer_cost: 2491.25,
					SEPARATION_PAY: 182_700,
					ANNUAL_LEAVE_ENCASHMENT: 1166.2,
					THIRTEENTH_MONTH_PAY: 6241.67,
					...charges({ sss: [750, 1500], ec: 30, phic: [761.25, 761.25], hdmf: [200, 200] }),
					'WTAX.employee': -2139.22
				}
			}
		]
	},
	{
		id: 'PH-HR15-2',
		profile: 'PH',
		description:
			'A retrenchment on Friday 16 January 2026 after five years on ₱30,450: half a month per year of separation pay, the pro-rata 13th month and no tax on the year.',
		citation: [
			'Labor Code art.298: retrenchment pays one month’s pay or half a month per year of service, whichever is higher, six months counting as a year: 4 January 2021 – 16 January 2026 is 5 years → 2.5 × 30,450 = 76,125; exempt (NIRC s.32(B)(6)(b))',
			'PD 851 Revised Guidelines ¶6: 16,800 ÷ 12 = 1,400',
			'Service incentive leave: no month of 2026 completed by 16 January → nothing to commute (Labor Code art.95, pro rata)',
			`${HANDBOOK} ch.2 §E; ${DAILY}`,
			SSS,
			PHIC,
			HDMF,
			'RR 11-2018 s.2.83: the year’s compensation 16,800 − 1,811.25 = 14,988.75 → no tax',
			'1–2, 5–9, 12–16 January = 12 working days × 1,400 = 16,800. SSS 16,750–17,249.99 → MSC 17,000: 850 / 1,700, EC 30. PhilHealth 761.25 / 761.25. Pag-IBIG 200 / 200. Gross 16,800 + 76,125 = 92,925; net 92,925 − 1,811.25 + 1,400 = 92,513.75; employer cost 1,700 + 30 + 761.25 + 200 = 2,691.25'
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '1990-05-14',
				from: '2021-01-04',
				to: '2026-01-16',
				salary: 30_450,
				employment: {
					exit_ground: 'RETRENCHMENT',
					exit_facts: { termination_cause: 'RETRENCHMENT' }
				}
			}),
			...separation('w', '2026-01-16', ['SEPARATION_PAY', 'THIRTEENTH_MONTH_PAY'])
		],
		period: '2026-01',
		expected: [
			{
				employment: 'w_job',
				lines: {
					gross: 92_925,
					net: 92_513.75,
					employer_cost: 2691.25,
					SEPARATION_PAY: 76_125,
					THIRTEENTH_MONTH_PAY: 1400,
					...charges({ sss: [850, 1700], ec: 30, phic: [761.25, 761.25], hdmf: [200, 200] })
				}
			}
		]
	},
	...(
		[
			[
				'PH-HR15-3',
				'2020-06-01',
				91_350,
				'A retrenchment on Friday 16 January 2026 after five years and seven months on ₱30,450: the fraction of at least six months counts as a whole year, so six half-months of separation pay.',
				'1 June 2020 – 16 January 2026 is 5 years 7 months, the fraction of at least six months a whole year → 6 years; half a month per year 6 × 15,225 = 91,350, above the one-month minimum'
			],
			[
				'PH-HR15-4',
				'2025-05-19',
				30_450,
				'A retrenchment on Friday 16 January 2026 after under eight months on ₱30,450: the one-month minimum outweighs half a month for the one counted year.',
				'19 May 2025 – 16 January 2026 is 7 months, a fraction of at least six months → 1 year; half a month 15,225 is below the one-month minimum, so 30,450'
			]
		] as const
	).map(([id, from, severance, description, service]): ProbeCase => {
		const gross = 16_800 + severance;
		const net = Math.round((gross - 1811.25 + 1400) * 100) / 100;
		return {
			id,
			profile: 'PH',
			description,
			citation: [
				`Labor Code art.298: retrenchment pays one month’s pay or at least half a month per year of service, whichever is higher, a fraction of at least six months counting as one whole year: ${service}; exempt (NIRC s.32(B)(6)(b))`,
				'PD 851 Revised Guidelines ¶6: 16,800 ÷ 12 = 1,400',
				'Service incentive leave: no month of 2026 completed by 16 January → nothing to commute (Labor Code art.95, pro rata)',
				`${HANDBOOK} ch.2 §E; ${DAILY}`,
				SSS,
				PHIC,
				HDMF,
				'RR 11-2018 s.2.83: the year’s compensation 16,800 − 1,811.25 = 14,988.75 → no tax',
				`1–2, 5–9, 12–16 January = 12 working days × 1,400 = 16,800. SSS 16,750–17,249.99 → MSC 17,000: 850 / 1,700, EC 30. PhilHealth 761.25 / 761.25. Pag-IBIG 200 / 200. Gross 16,800 + ${severance} = ${gross}; net ${gross} − 1,811.25 + 1,400 = ${net}; employer cost 1,700 + 30 + 761.25 + 200 = 2,691.25`
			],
			company: company(),
			inputs: [
				...week,
				...hire({
					ref: 'w',
					name: 'Juan Dela Cruz',
					born: '1990-05-14',
					from,
					to: '2026-01-16',
					salary: 30_450,
					employment: {
						exit_ground: 'RETRENCHMENT',
						exit_facts: { termination_cause: 'RETRENCHMENT' }
					}
				}),
				...separation('w', '2026-01-16', ['SEPARATION_PAY', 'THIRTEENTH_MONTH_PAY'])
			],
			period: '2026-01',
			expected: [
				{
					employment: 'w_job',
					lines: {
						gross,
						net,
						employer_cost: 2691.25,
						SEPARATION_PAY: severance,
						THIRTEENTH_MONTH_PAY: 1400,
						...charges({ sss: [850, 1700], ec: 30, phic: [761.25, 761.25], hdmf: [200, 200] })
					}
				}
			]
		};
	}),
	{
		id: 'PH-HR16-1',
		profile: 'PH',
		description:
			'A 62-year-old retires on Friday 16 January 2026 after ten years on ₱30,450 with no company plan: 22.5 days per year of service, tax-exempt; SSS still covers a member past sixty.',
		citation: [
			'RA 7641 (Labor Code art.302): at 60–65 with at least five years’ service, half a month’s salary per year (fifteen days plus one twelfth of the 13th month plus five days of SIL = 22.5 days), six months counting as a year: 4 January 2016 – 16 January 2026 is 10 years → 22.5 × 1,400 × 10 = 315,000; exempt (NIRC s.32(B)(6)(a))',
			'RA 11199 s.9(a): compulsory coverage for employees not over sixty when covered; first covered in January 2016 at 52, the member stays covered',
			'PD 851 Revised Guidelines ¶6: 16,800 ÷ 12 = 1,400',
			`${HANDBOOK} ch.2 §E; ${DAILY}`,
			SSS,
			PHIC,
			HDMF,
			'SSS MSC 17,000: 850 / 1,700, EC 30. PhilHealth 761.25 / 761.25. Pag-IBIG 200 / 200. Year taxable 14,988.75 → 0. Gross 16,800 + 315,000 = 331,800; net 331,800 − 1,811.25 + 1,400 = 331,388.75; employer cost 2,691.25'
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Roberto Garcia',
				born: '1963-06-15',
				from: '2016-01-04',
				to: '2026-01-16',
				salary: 30_450,
				employment: { exit_ground: 'RETIREMENT' }
			}),
			{
				collection: 'employment_statutory_facts',
				values: {
					employee_id: '@w',
					employment_id: '@w_job',
					statutory_contribution_id: '@law:statutory_contributions:SSS',
					effective_range: { from: '2016-01-04', to: null },
					status: {
						kind: 'REGISTERED',
						reference_number: 'PROBE-SSS',
						first_contribution_due_on: '2016-02-29',
						elections: {}
					}
				}
			},
			...separation('w', '2026-01-16', ['RETIREMENT_PAY', 'THIRTEENTH_MONTH_PAY'])
		],
		period: '2026-01',
		expected: [
			{
				employment: 'w_job',
				lines: {
					gross: 331_800,
					net: 331_388.75,
					employer_cost: 2691.25,
					RETIREMENT_PAY: 315_000,
					THIRTEENTH_MONTH_PAY: 1400,
					...charges({ sss: [850, 1700], ec: 30, phic: [761.25, 761.25], hdmf: [200, 200] })
				}
			}
		]
	},
	{
		id: 'PH-HR45-1',
		profile: 'PH',
		description:
			'A kasambahay on ₱7,800 dismissed without just cause on Tuesday 20 January 2026: the pay earned plus fifteen days’ indemnity, and the pro-rata 13th month.',
		citation: [
			'RA 10361 s.32: a kasambahay unjustly dismissed is paid the compensation already earned plus fifteen days’ work as indemnity; the law names no divisor, so the day is the monthly-paid 261-day factor (tracker default PH-HR45): 7,800 × 15 × 12 ÷ 261 = 5,379.31; the indemnity is not compensation for services (counts toward no scheme)',
			'RA 10361 s.25: a kasambahay is owed the 13th month (PD 851): 5,020.69 ÷ 12 = 418.39',
			'Wage Order NCR-DW-06: ₱7,000 a month through 6 February 2026 (tracker PH-WG04); ₱7,800 is above it',
			DOMESTIC,
			SSS,
			PHIC,
			HDMF,
			'1–2, 5–9, 12–16, 19–20 January = 14 working days: 7,800 × 14 ÷ 21.75 = 5,020.69. SSS "Below 5,250" → MSC 5,000: 250 / 500, EC 10 (the wage is ₱5,000 or more, so the worker shares, s.30). PhilHealth on the ₱10,000 floor 250 / 250. Pag-IBIG on the fund salary received in the month (Circular 460 p.2; tracker PH-PR01): 5,020.69 × 2% = 100.4138 → 100.41 / 100.41. Gross 5,020.69 + 5,379.31 = 10,400; net 10,400 − (250 + 250 + 100.41) + 418.39 = 10,217.98; employer cost 500 + 10 + 250 + 100.41 = 860.41'
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'k',
				name: 'Maria Santos',
				gender: 'FEMALE',
				born: '1988-02-11',
				from: '2024-01-08',
				to: '2026-01-20',
				salary: 7800,
				sector: null,
				type: 'DOMESTIC',
				employment: {
					exit_ground: 'DISMISSAL',
					exit_facts: { kasambahay_unjust_dismissal: true }
				}
			}),
			...separation('k', '2026-01-20', ['KASAMBAHAY_INDEMNITY', 'THIRTEENTH_MONTH_PAY'])
		],
		period: '2026-01',
		expected: [
			{
				employment: 'k_job',
				lines: {
					gross: 10_400,
					net: 10_217.98,
					employer_cost: 860.41,
					KASAMBAHAY_INDEMNITY: 5379.31,
					THIRTEENTH_MONTH_PAY: 418.39,
					...charges({ sss: [250, 500], ec: 10, phic: [250, 250], hdmf: [100.41, 100.41] })
				}
			}
		]
	},

	// ── Paid statutory leave ──────────────────────────────────────────────────────────────────
	...(
		[
			[
				'PH-HR11-1',
				'SOLO_PARENT_LEAVE',
				'2026-07-14',
				'2026-07-15',
				{ solo_parent: true },
				'Two days of solo-parent leave (14–15 July 2026) are paid: the payslip is the full month of case PH-SS01-1.',
				'RA 11861 s.8 and Revised IRR: seven working days’ paid parental leave a year for a solo parent with six months’ service (https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/96104)'
			],
			[
				'PH-HR12-1',
				'VAWC_LEAVE',
				'2026-07-20',
				'2026-07-22',
				{},
				'Three days of VAWC leave (20–22 July 2026) are paid: the payslip is the full month of case PH-SS01-1.',
				'RA 9262 s.43; DOLE Handbook 2024 ch.11: up to ten days’ paid leave for a woman employee who is a victim'
			]
		] as const
	).map(([id, code, from, to, employee, description, law]): ProbeCase => ({
		id,
		profile: 'PH',
		description,
		citation: [
			law,
			SSS,
			PHIC,
			HDMF,
			WTAX,
			'As PH-SS01-1: SS 1,000 / 2,000, MPF 525 / 1,050, EC 30, PhilHealth 761.25 / 761.25, Pag-IBIG 200 / 200, WTAX 1,069.61, net 26,894.14, employer cost 4,041.25'
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Liza Mendoza',
				gender: 'FEMALE',
				born: '1992-03-08',
				from: '2020-01-06',
				salary: 30_450,
				employee
			}),
			{
				collection: 'leave_entries',
				values: {
					employment_id: '@w_job',
					catalogue_id: `@law:leave_catalogue:${code}`,
					reference: `PROBE-PH-${code}`,
					from_date: from,
					to_date: to,
					reason: 'Statutory leave'
				},
				// The catalogue requires the statutory proof (solo parent ID; barangay/court certification).
				files: { certificate_file: `${code.toLowerCase()}-certificate.pdf` }
			}
		],
		period: '2026-07',
		expected: [
			{
				employment: 'w_job',
				lines: { gross: 30_450, net: 26_894.14, employer_cost: 4041.25, ...charges(FULL_30450) }
			}
		]
	})),
	{
		id: 'PH-HR11-2',
		profile: 'PH',
		description:
			'Solo-parent leave filed without the solo parent ID is refused at input: the leave rests on the statutory proof, so the entry cannot stand without it.',
		citation: [
			'RA 11861 s.8 and Revised IRR: the leave is granted to a solo parent holding the Solo Parent Identification Card (https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/96104)'
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Liza Mendoza',
				gender: 'FEMALE',
				born: '1992-03-08',
				from: '2020-01-06',
				salary: 30_450,
				employee: { solo_parent: true }
			}),
			{
				collection: 'leave_entries',
				values: {
					employment_id: '@w_job',
					catalogue_id: '@law:leave_catalogue:SOLO_PARENT_LEAVE',
					reference: 'PROBE-PH-SOLO_PARENT_LEAVE-NO-ID',
					from_date: '2026-07-14',
					to_date: '2026-07-15',
					reason: 'Statutory leave'
				},
				refused:
					'^refused leave_entries\\.transform A certificate is required for this time off\\.$'
			}
		],
		period: '2026-07',
		expected: []
	},

	// ── Kasambahay floors by region (July 2026 unless stated) ─────────────────────────────────
	domestic(
		'PH-WG04-1',
		'NCR/Manila',
		7800,
		'2026-07',
		'Wage Order NCR-DW-06 ss.1–2, 8: ₱7,800 a month from 7 February 2026; no exemption (https://nwpc.dole.gov.ph/wp-content/uploads/2026/01/Wage-Order-No.-NCR-DW-06.pdf)',
		[400, 800],
		156,
		'An NCR kasambahay at exactly the NCR-DW-06 floor of ₱7,800.'
	),
	domestic(
		'PH-WG09-1',
		'CAR/Baguio',
		6600,
		'2026-07',
		'CAR domestic wage order (tracker PH-WG09): ₱6,600 a month from 30 December 2025',
		[325, 650],
		132,
		'A Baguio kasambahay at exactly the CAR floor of ₱6,600.'
	),
	domestic(
		'PH-WG17-1',
		'XI/Davao',
		6500,
		'2026-07',
		'Wage Order RB XI-DW-04 ss.1, 5–6, 8: ₱6,500 a month in every municipality class from 13 March 2026; no waiver (https://nwpc.dole.gov.ph/wp-content/uploads/2026/02/Wage-Order-No.-RB-XI-DW-04.pdf)',
		[325, 650],
		130,
		'A Davao City kasambahay at exactly the XI-DW-04 floor of ₱6,500.'
	),
	domestic(
		'PH-WG19-1',
		'XIII/Bayugan',
		6500,
		'2026-07',
		'Caraga domestic wage order (tracker PH-WG19): ₱6,500 a month across municipality classes from 3 January 2026',
		[325, 650],
		130,
		'A Bayugan kasambahay at exactly the Caraga floor of ₱6,500.'
	),
	domestic(
		'PH-WG21-1',
		'BARMM/Cotabato City',
		5500,
		'2026-07',
		'Wage Order BARMM-DW-02: ₱5,500 a month outside Sulu from 8 January 2026 (https://nwpc.dole.gov.ph/wp-content/uploads/2026/04/Wage-Order-No.-BARMM-DW-02.pdf); Cotabato City is in BARMM',
		[275, 550],
		110,
		'A Cotabato City (BARMM) kasambahay at exactly the BARMM-DW-02 floor of ₱5,500.'
	),
	domestic(
		'PH-WG22-1',
		'IX/Dapitan',
		6000,
		'2026-10',
		'Wage Order RIX-DW-06 ss.1–2, 5, 8: ₱6,000 a month in chartered cities and first-class municipalities from 20 May 2026; no exemption (https://nwpc.dole.gov.ph/wp-content/uploads/2026/05/Wage-Order-No.-RIX-DW-06.pdf)',
		[300, 600],
		120,
		'A Dapitan City kasambahay at exactly the RIX-DW-06 floor of ₱6,000, October 2026.'
	),
	domestic(
		'PH-WG22-2',
		'IX/Dapitan',
		6000,
		'2026-07',
		'Wage Order RIX-DW-06 ss.1–2, 8: ₱6,000 a month in chartered cities and first-class municipalities from 20 May 2026 (https://nwpc.dole.gov.ph/wp-content/uploads/2026/05/Wage-Order-No.-RIX-DW-06.pdf): the floor is already in force in July',
		[300, 600],
		120,
		'A Dapitan City kasambahay at exactly the RIX-DW-06 floor of ₱6,000, July 2026 — the order took effect on 20 May.'
	),
	domestic(
		'PH-WG41-1',
		'IX/Dapitan',
		6500,
		'2026-10',
		'Wage Order RIX-DW-06: competency-based pay only above the ₱6,000 floor (tracker PH-WG41); ₱6,500 is above it and not a minimum-wage earner’s wage, but under ₱20,833 so withholding is 0',
		[325, 650],
		130,
		'A Dapitan City kasambahay on a competency rate of ₱6,500, above the ₱6,000 floor, October 2026.'
	),
	domestic(
		'PH-WG23-1',
		'X/Cagayan de Oro',
		6500,
		'2026-07',
		'Wage Order RBX-DW-06 ss.1, 5–6: ₱6,500 a month in all areas from 16 January 2026; no waiver (https://nwpc.dole.gov.ph/wp-content/uploads/2025/12/Wage-Order-No.-RBX-DW-06.pdf)',
		[325, 650],
		130,
		'A Cagayan de Oro kasambahay at exactly the RBX-DW-06 floor of ₱6,500.'
	),
	domestic(
		'PH-WG26-1',
		'IV-B/Calapan',
		7000,
		'2026-07',
		'Wage Order MIMAROPA-DW-06 ss.1–2, 8: ₱7,000 a month from 1 January 2026; no exemption (https://nwpc.dole.gov.ph/wp-content/uploads/2025/12/Wage-Order-No.-RB-MIMAROPA-DW-06-1.pdf)',
		[350, 700],
		140,
		'A Calapan kasambahay at exactly the MIMAROPA-DW-06 floor of ₱7,000.'
	),
	domestic(
		'PH-WG48-1',
		'IV-B/Calapan',
		7500,
		'2026-07',
		'Wage Order MIMAROPA-DW-06: competency pay may exceed ₱7,000 but never lower it (tracker PH-WG48); ₱7,500 is under ₱20,833 so withholding is 0',
		[375, 750],
		150,
		'A Calapan kasambahay on a competency rate of ₱7,500, above the ₱7,000 floor.'
	),
	domestic(
		'PH-WG30-1',
		'I/Alaminos',
		6700,
		'2026-07',
		'Ilocos domestic wage order (tracker PH-WG30): ₱6,700 a month from 19 November 2025',
		[325, 650],
		134,
		'An Alaminos kasambahay at exactly the Ilocos floor of ₱6,700.'
	),
	domestic(
		'PH-WG31-1',
		'II/Tuguegarao',
		6500,
		'2026-07',
		'Cagayan Valley domestic wage order (tracker PH-WG31): ₱6,500 a month regardless of municipality class from 5 November 2025',
		[325, 650],
		130,
		'A Tuguegarao kasambahay at exactly the Cagayan Valley floor of ₱6,500.'
	),
	domestic(
		'PH-WG32-1',
		'VI/Iloilo City',
		6500,
		'2026-07',
		'Wage Order RBVI-DW-07: ₱6,500 a month from 19 November 2025 (https://nwpc.dole.gov.ph/wp-content/uploads/2025/11/Wage-Order-No.-RBVI-DW-07.pdf)',
		[325, 650],
		130,
		'An Iloilo City kasambahay at exactly the RBVI-DW-07 floor of ₱6,500.'
	),
	domestic(
		'PH-WG33-1',
		'VII/Cebu',
		7000,
		'2026-07',
		'Wage Order ROVII-DW-05: ₱7,000 a month from 4 October 2025 (https://nwpc.dole.gov.ph/wp-content/uploads/2025/09/Wage-Order-No.-ROVII-DW-05.pdf)',
		[350, 700],
		140,
		'A Cebu kasambahay at exactly the ROVII-DW-05 floor of ₱7,000.'
	),
	domestic(
		'PH-WG34-1',
		'Pampanga/San Fernando',
		6500,
		'2026-07',
		'Central Luzon domestic wage order (tracker PH-WG34): ₱6,500 a month including Aurora from 30 October 2025',
		[325, 650],
		130,
		'A City of San Fernando (Pampanga) kasambahay at exactly the Central Luzon floor of ₱6,500.'
	),
	domestic(
		'PH-WG35-1',
		'V/Legazpi',
		6000,
		'2026-07',
		'Bicol domestic wage order (tracker PH-WG35): ₱6,000 a month in every municipality class from 5 April 2025',
		[300, 600],
		120,
		'A Legazpi kasambahay at exactly the Bicol floor of ₱6,000.'
	),
	domestic(
		'PH-WG36-1',
		'Cavite/Bacoor',
		6750,
		'2026-07',
		'CALABARZON domestic wage order (tracker PH-WG36): ₱6,750 a month across cities and municipalities from 7 March 2025',
		[350, 700],
		135,
		'A Bacoor kasambahay at exactly the CALABARZON floor of ₱6,750 (SSS bracket 6,750–7,249.99 → MSC 7,000).'
	),
	domestic(
		'PH-WG37-1',
		'XII/General Santos',
		6000,
		'2026-07',
		'SOCCSKSARGEN domestic wage order (tracker PH-WG37): ₱6,000 a month in every municipality class outside the 63 BARMM barangays from 2 November 2025',
		[300, 600],
		120,
		'A General Santos kasambahay at exactly the SOCCSKSARGEN floor of ₱6,000.'
	),

	// ── Regional private floors and tranche boundaries (2026-09-30) ───────────────────────────
	site(
		'PH-WG08-1',
		'A Baguio (CAR) office worker at exactly the CAR-24 floor of ₱505 a day, July 2026.',
		'CAR/Baguio',
		'OTHER_NONAGRI',
		10_983.75,
		'2026-07',
		'Wage Order No. CAR-24 (issued 2 Dec, published 14 Dec, effective 30 Dec 2025): ₱470 → ₱505 a day, Abra, Apayao, Benguet, Ifugao, Kalinga, Mountain Province and Baguio City (https://nwpc.dole.gov.ph/wp-content/uploads/2025/12/Wage-Order-No.-CAR-24.pdf; https://nwpc.dole.gov.ph/car/, read 30 Sep 2026)',
		{ sss: [550, 1100], ec: 10, phic: [274.59, 274.6], hdmf: [200, 200] },
		9959.16,
		1584.6,
		'505 × 261 ÷ 12 = 10,983.75. SSS → MSC 11,000: 550.00 / 1,100.00, EC 10. PhilHealth 10,983.75 × 5% = 549.19 → 274.59 / 274.60. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 9,959.16 is under 20,833 anyway). Net 10,983.75 − 1,024.59 = 9,959.16; employer cost 1,584.60.'
	),
	below(
		'PH-WG08-2',
		'A Baguio worker still on the superseded ₱470 rate in December 2025: the version from 30 December states ₱505, so the run is refused.',
		'CAR/Baguio',
		'OTHER_NONAGRI',
		10_222.5,
		'2025-12',
		'Wage Order No. CAR-24 (issued 2 Dec, published 14 Dec, effective 30 Dec 2025): ₱470 → ₱505 a day, Abra, Apayao, Benguet, Ifugao, Kalinga, Mountain Province and Baguio City (https://nwpc.dole.gov.ph/wp-content/uploads/2025/12/Wage-Order-No.-CAR-24.pdf; https://nwpc.dole.gov.ph/car/, read 30 Sep 2026)'
	),
	below(
		'PH-WG09-2',
		'A Baguio kasambahay on ₱6,000 in December 2025: CAR-DW-07 raises the floor to ₱6,600 from 30 December, so the run is refused.',
		'CAR/Baguio',
		null,
		6000,
		'2025-12',
		'Wage Order No. CAR-DW-07 (published 14 Dec, effective 30 Dec 2025): domestic ₱6,000 → ₱6,600 a month (https://nwpc.dole.gov.ph/wp-content/uploads/2025/12/Wage-Order-No.-CAR-DW-07.pdf; https://nwpc.dole.gov.ph/car/, read 30 Sep 2026)'
	),
	site(
		'PH-WG12-1',
		'A City of San Fernando (Pampanga) worker at exactly the RBIII-26 second-tranche floor of ₱600, July 2026.',
		'Pampanga/San Fernando',
		'OTHER_NONAGRI',
		13_050,
		'2026-07',
		'Wage Order No. RBIII-26 (effective 30 Oct 2025; second tranche 16 Apr 2026), Bataan, Bulacan, Nueva Ecija, Pampanga, Tarlac, Zambales: non-agriculture ₱570 → ₱600, agriculture ₱540 → ₱570, retail/service ₱560 → ₱590 (https://nwpc.dole.gov.ph/wp-content/uploads/2025/10/Wage-Order-No.-RBIII-26.pdf; https://nwpc.dole.gov.ph/region-iii/, read 30 Sep 2026)',
		{ sss: [650, 1300], ec: 10, phic: [326.25, 326.25], hdmf: [200, 200] },
		11_873.75,
		1836.25,
		'600 × 261 ÷ 12 = 13,050.00. SSS → MSC 13,000: 650.00 / 1,300.00, EC 10. PhilHealth 13,050.00 × 5% = 652.50 → 326.25 / 326.25. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 11,873.75 is under 20,833 anyway). Net 13,050.00 − 1,176.25 = 11,873.75; employer cost 1,836.25.'
	),
	below(
		'PH-WG12-2',
		'A City of San Fernando worker left on the ₱570 first-tranche rate in May 2026, after the 16 April second tranche: refused.',
		'Pampanga/San Fernando',
		'OTHER_NONAGRI',
		12_397.5,
		'2026-05',
		'Wage Order No. RBIII-26 (effective 30 Oct 2025; second tranche 16 Apr 2026), Bataan, Bulacan, Nueva Ecija, Pampanga, Tarlac, Zambales: non-agriculture ₱570 → ₱600, agriculture ₱540 → ₱570, retail/service ₱560 → ₱590 (https://nwpc.dole.gov.ph/wp-content/uploads/2025/10/Wage-Order-No.-RBIII-26.pdf; https://nwpc.dole.gov.ph/region-iii/, read 30 Sep 2026)'
	),
	site(
		'PH-WG13-1',
		'A Legazpi (Bicol) worker at exactly the RBV-23 floor of ₱455, July 2026.',
		'V/Legazpi',
		'OTHER_NONAGRI',
		9896.25,
		'2026-07',
		'Wage Order No. RBV-23 (issued 3 Mar, published 23 Mar, effective 8 Apr 2026): all sectors ₱435 → ₱455, ₱480 from 1 Dec 2026 (https://nwpc.dole.gov.ph/wp-content/uploads/2026/03/Wage-Order-No.-RBV-23.pdf; https://nwpc.dole.gov.ph/region-v/, read 30 Sep 2026)',
		{ sss: [500, 1000], ec: 10, phic: [250, 250], hdmf: [197.93, 197.93] },
		8948.32,
		1457.93,
		'455 × 261 ÷ 12 = 9,896.25. SSS → MSC 10,000: 500.00 / 1,000.00, EC 10. PhilHealth on the ₱10,000 floor → 250.00 / 250.00. Pag-IBIG 2% of 9,896.25 → 197.93 / 197.93. WTAX 0 (minimum-wage earner; taxable 8,948.32 is under 20,833 anyway). Net 9,896.25 − 947.93 = 8,948.32; employer cost 1,457.93.'
	),
	below(
		'PH-WG13-2',
		'A Legazpi worker left on the RBV-22 rate of ₱435 in May 2026, after the 8 April tranche: refused.',
		'V/Legazpi',
		'OTHER_NONAGRI',
		9461.25,
		'2026-05',
		'Wage Order No. RBV-23 (issued 3 Mar, published 23 Mar, effective 8 Apr 2026): all sectors ₱435 → ₱455, ₱480 from 1 Dec 2026 (https://nwpc.dole.gov.ph/wp-content/uploads/2026/03/Wage-Order-No.-RBV-23.pdf; https://nwpc.dole.gov.ph/region-v/, read 30 Sep 2026)'
	),
	site(
		'PH-WG14-1',
		'A Zamboanga City non-agriculture worker at exactly the RIX-24 second-tranche floor of ₱464, July 2026.',
		'IX/Zamboanga',
		'OTHER_NONAGRI',
		10_092,
		'2026-07',
		'Wage Order No. RIX-24 (published 16 Dec 2025, effective 1 Jan 2026): non-agriculture ₱414 → ₱439 → ₱464 and agriculture ₱401 → ₱426 → ₱451, second tranche 1 June 2026 (https://nwpc.dole.gov.ph/wp-content/uploads/2025/12/Wage-Order-No.-RIX-24.pdf; https://nwpc.dole.gov.ph/region-ix/, read 30 Sep 2026)',
		{ sss: [500, 1000], ec: 10, phic: [252.3, 252.3], hdmf: [200, 200] },
		9139.7,
		1462.3,
		'464 × 261 ÷ 12 = 10,092.00. SSS → MSC 10,000: 500.00 / 1,000.00, EC 10. PhilHealth 10,092.00 × 5% = 504.60 → 252.30 / 252.30. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 9,139.70 is under 20,833 anyway). Net 10,092.00 − 952.30 = 9,139.70; employer cost 1,462.30.'
	),
	site(
		'PH-WG14-2',
		'A Zamboanga City agriculture worker at exactly the RIX-24 second-tranche floor of ₱451, July 2026.',
		'IX/Zamboanga',
		'AGRICULTURE',
		9809.25,
		'2026-07',
		'Wage Order No. RIX-24 (published 16 Dec 2025, effective 1 Jan 2026): non-agriculture ₱414 → ₱439 → ₱464 and agriculture ₱401 → ₱426 → ₱451, second tranche 1 June 2026 (https://nwpc.dole.gov.ph/wp-content/uploads/2025/12/Wage-Order-No.-RIX-24.pdf; https://nwpc.dole.gov.ph/region-ix/, read 30 Sep 2026)',
		{ sss: [500, 1000], ec: 10, phic: [250, 250], hdmf: [196.19, 196.19] },
		8863.06,
		1456.19,
		'451 × 261 ÷ 12 = 9,809.25. SSS → MSC 10,000: 500.00 / 1,000.00, EC 10. PhilHealth on the ₱10,000 floor → 250.00 / 250.00. Pag-IBIG 2% of 9,809.25 → 196.19 / 196.19. WTAX 0 (minimum-wage earner; taxable 8,863.06 is under 20,833 anyway). Net 9,809.25 − 946.19 = 8,863.06; employer cost 1,456.19.'
	),
	site(
		'PH-WG15-1',
		'A Cagayan de Oro (Category I) worker at exactly the RX-24 second-tranche floor of ₱500, July 2026.',
		'X/Cagayan de Oro',
		'OTHER_NONAGRI',
		10_875,
		'2026-07',
		'Wage Order No. RX-24 ss.1–4 (published 31 Dec 2025, effective 16 Jan 2026): Category I (Cagayan de Oro and the other named areas) ₱461 → ₱486 → ₱500, Category II ₱446 → ₱471 → ₱485, second tranche 1 May 2026 (https://nwpc.dole.gov.ph/wp-content/uploads/2025/12/Wage-Order-No.-RX-24.pdf; https://nwpc.dole.gov.ph/region-x/, read 30 Sep 2026)',
		{ sss: [550, 1100], ec: 10, phic: [271.87, 271.88], hdmf: [200, 200] },
		9853.13,
		1581.88,
		'500 × 261 ÷ 12 = 10,875.00. SSS → MSC 11,000: 550.00 / 1,100.00, EC 10. PhilHealth 10,875.00 × 5% = 543.75 → 271.87 / 271.88. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 9,853.13 is under 20,833 anyway). Net 10,875.00 − 1,021.87 = 9,853.13; employer cost 1,581.88.'
	),
	below(
		'PH-WG15-2',
		'A Cagayan de Oro worker left on the ₱486 first-tranche rate in May 2026, after the 1 May second tranche: refused.',
		'X/Cagayan de Oro',
		'OTHER_NONAGRI',
		10_570.5,
		'2026-05',
		'Wage Order No. RX-24 ss.1–4 (published 31 Dec 2025, effective 16 Jan 2026): Category I (Cagayan de Oro and the other named areas) ₱461 → ₱486 → ₱500, Category II ₱446 → ₱471 → ₱485, second tranche 1 May 2026 (https://nwpc.dole.gov.ph/wp-content/uploads/2025/12/Wage-Order-No.-RX-24.pdf; https://nwpc.dole.gov.ph/region-x/, read 30 Sep 2026)'
	),
	site(
		'PH-WG16-1',
		'A Davao City non-agriculture worker at exactly the RB XI-24 second-tranche floor of ₱540, October 2026.',
		'XI/Davao',
		'OTHER_NONAGRI',
		11_745,
		'2026-10',
		'Wage Order No. RB XI-24 (issued 19 Feb, published 25 Feb 2026): non-agriculture ₱510 → ₱525 from 13 Mar 2026 → ₱540 from 1 Sep 2026; agriculture ₱505 → ₱515 → ₱525 (https://nwpc.dole.gov.ph/wp-content/uploads/2026/02/Wage-Order-No.-RB-XI-24.pdf; https://nwpc.dole.gov.ph/region-xi/, read 30 Sep 2026)',
		{ sss: [575, 1150], ec: 10, phic: [293.62, 293.63], hdmf: [200, 200] },
		10_676.38,
		1653.63,
		'540 × 261 ÷ 12 = 11,745.00. SSS → MSC 11,500: 575.00 / 1,150.00, EC 10. PhilHealth 11,745.00 × 5% = 587.25 → 293.62 / 293.63. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 10,676.38 is under 20,833 anyway). Net 11,745.00 − 1,068.62 = 10,676.38; employer cost 1,653.63.'
	),
	site(
		'PH-WG16-2',
		'A Davao City agriculture worker at exactly the RB XI-24 first-tranche floor of ₱515, July 2026.',
		'XI/Davao',
		'AGRICULTURE',
		11_201.25,
		'2026-07',
		'Wage Order No. RB XI-24 (issued 19 Feb, published 25 Feb 2026): non-agriculture ₱510 → ₱525 from 13 Mar 2026 → ₱540 from 1 Sep 2026; agriculture ₱505 → ₱515 → ₱525 (https://nwpc.dole.gov.ph/wp-content/uploads/2026/02/Wage-Order-No.-RB-XI-24.pdf; https://nwpc.dole.gov.ph/region-xi/, read 30 Sep 2026)',
		{ sss: [550, 1100], ec: 10, phic: [280.03, 280.03], hdmf: [200, 200] },
		10_171.22,
		1590.03,
		'515 × 261 ÷ 12 = 11,201.25. SSS → MSC 11,000: 550.00 / 1,100.00, EC 10. PhilHealth 11,201.25 × 5% = 560.06 → 280.03 / 280.03. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 10,171.22 is under 20,833 anyway). Net 11,201.25 − 1,030.03 = 10,171.22; employer cost 1,590.03.'
	),
	below(
		'PH-WG16-3',
		'A Davao City non-agriculture worker left on the ₱525 first-tranche rate in September 2026, after the 1 September second tranche: refused.',
		'XI/Davao',
		'OTHER_NONAGRI',
		11_418.75,
		'2026-09',
		'Wage Order No. RB XI-24 (issued 19 Feb, published 25 Feb 2026): non-agriculture ₱510 → ₱525 from 13 Mar 2026 → ₱540 from 1 Sep 2026; agriculture ₱505 → ₱515 → ₱525 (https://nwpc.dole.gov.ph/wp-content/uploads/2026/02/Wage-Order-No.-RB-XI-24.pdf; https://nwpc.dole.gov.ph/region-xi/, read 30 Sep 2026)'
	),
	site(
		'PH-WG18-1',
		'A Butuan (Caraga) worker at exactly the RXIII-20 second-tranche floor of ₱475, July 2026.',
		'XIII/Butuan',
		'OTHER_NONAGRI',
		10_331.25,
		'2026-07',
		'Wage Order No. RXIII-20 (published 18 Dec 2025, effective 3 Jan 2026): every sector ₱435 → ₱455, ₱475 from 1 May 2026 (https://nwpc.dole.gov.ph/wp-content/uploads/2025/12/Wage-Order-No.-RXIII-20.pdf; https://nwpc.dole.gov.ph/region-xiii/, read 30 Sep 2026)',
		{ sss: [525, 1050], ec: 10, phic: [258.28, 258.28], hdmf: [200, 200] },
		9347.97,
		1518.28,
		'475 × 261 ÷ 12 = 10,331.25. SSS → MSC 10,500: 525.00 / 1,050.00, EC 10. PhilHealth 10,331.25 × 5% = 516.56 → 258.28 / 258.28. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 9,347.97 is under 20,833 anyway). Net 10,331.25 − 983.28 = 9,347.97; employer cost 1,518.28.'
	),
	site(
		'PH-WG25-1',
		'A Calapan (MIMAROPA) worker at exactly the MIMAROPA-13 floor of ₱455, July 2026.',
		'IV-B/Calapan',
		'OTHER_NONAGRI',
		9896.25,
		'2026-07',
		'Wage Order No. RB-MIMAROPA-13 ss.1–4 (published 16 Dec 2025, effective 1 Jan 2026): ₱455 a day for every establishment size (https://nwpc.dole.gov.ph/wp-content/uploads/2025/12/Wage-Order-No.-MIMAROPA-13.pdf; https://nwpc.dole.gov.ph/region-ivb/, read 30 Sep 2026)',
		{ sss: [500, 1000], ec: 10, phic: [250, 250], hdmf: [197.93, 197.93] },
		8948.32,
		1457.93,
		'455 × 261 ÷ 12 = 9,896.25. SSS → MSC 10,000: 500.00 / 1,000.00, EC 10. PhilHealth on the ₱10,000 floor → 250.00 / 250.00. Pag-IBIG 2% of 9,896.25 → 197.93 / 197.93. WTAX 0 (minimum-wage earner; taxable 8,948.32 is under 20,833 anyway). Net 9,896.25 − 947.93 = 8,948.32; employer cost 1,457.93.'
	),
	site(
		'PH-WG27-1',
		'A Tacloban non-agriculture worker at exactly the RB VIII-25 second-tranche floor of ₱470, July 2026 (non-agriculture sits with retail of more than 10 workers).',
		'VIII/Tacloban',
		'OTHER_NONAGRI',
		10_222.5,
		'2026-07',
		'Wage Order No. RB VIII-25 ss.1–2, 6 (approved 10 Nov, published 22 Nov, effective 8 Dec 2025): non-agriculture and service/retail of more than 10 workers ₱435 → ₱452 → ₱470; service/retail of 1–10 workers, cottage/handicraft and agriculture ₱405 → ₱422 → ₱440; second tranche 1 June 2026 (https://nwpc.dole.gov.ph/wp-content/uploads/2025/11/Wage-Order-No.-RB-VIII-25.pdf, read 30 Sep 2026)',
		{ sss: [500, 1000], ec: 10, phic: [255.56, 255.57], hdmf: [200, 200] },
		9266.94,
		1465.57,
		'470 × 261 ÷ 12 = 10,222.50. SSS → MSC 10,000: 500.00 / 1,000.00, EC 10. PhilHealth 10,222.50 × 5% = 511.13 → 255.56 / 255.57. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 9,266.94 is under 20,833 anyway). Net 10,222.50 − 955.56 = 9,266.94; employer cost 1,465.57.'
	),
	site(
		'PH-WG27-2',
		'A Tacloban agriculture worker at exactly the RB VIII-25 second-tranche floor of ₱440, July 2026.',
		'VIII/Tacloban',
		'AGRICULTURE',
		9570,
		'2026-07',
		'Wage Order No. RB VIII-25 ss.1–2, 6 (approved 10 Nov, published 22 Nov, effective 8 Dec 2025): non-agriculture and service/retail of more than 10 workers ₱435 → ₱452 → ₱470; service/retail of 1–10 workers, cottage/handicraft and agriculture ₱405 → ₱422 → ₱440; second tranche 1 June 2026 (https://nwpc.dole.gov.ph/wp-content/uploads/2025/11/Wage-Order-No.-RB-VIII-25.pdf, read 30 Sep 2026)',
		{ sss: [475, 950], ec: 10, phic: [250, 250], hdmf: [191.4, 191.4] },
		8653.6,
		1401.4,
		'440 × 261 ÷ 12 = 9,570.00. SSS → MSC 9,500: 475.00 / 950.00, EC 10. PhilHealth on the ₱10,000 floor → 250.00 / 250.00. Pag-IBIG 2% of 9,570.00 → 191.40 / 191.40. WTAX 0 (minimum-wage earner; taxable 8,653.60 is under 20,833 anyway). Net 9,570.00 − 916.40 = 8,653.60; employer cost 1,401.40.'
	),
	below(
		'PH-WG27-3',
		'A Tacloban non-agriculture worker left on the ₱452 first-tranche rate in July 2026, after the 1 June second tranche: refused.',
		'VIII/Tacloban',
		'OTHER_NONAGRI',
		9831,
		'2026-07',
		'Wage Order No. RB VIII-25 ss.1–2, 6 (approved 10 Nov, published 22 Nov, effective 8 Dec 2025): non-agriculture and service/retail of more than 10 workers ₱435 → ₱452 → ₱470; service/retail of 1–10 workers, cottage/handicraft and agriculture ₱405 → ₱422 → ₱440; second tranche 1 June 2026 (https://nwpc.dole.gov.ph/wp-content/uploads/2025/11/Wage-Order-No.-RB-VIII-25.pdf, read 30 Sep 2026)'
	),
	domestic(
		'PH-WG28-1',
		'VIII/Tacloban',
		6400,
		'2026-07',
		'Wage Order No. RBVIII-DW-06 ss.1, 5, 8 (approved 10 Nov, published 22 Nov, effective 8 Dec 2025): domestic workers in chartered cities and first-class municipalities ₱6,000 → ₱6,400 a month, other municipalities ₱5,500 → ₱5,800; no exemption (https://nwpc.dole.gov.ph/wp-content/uploads/2025/11/Wage-Order-No.-RBVIII-DW-06.pdf, read 30 Sep 2026); Tacloban is a chartered city',
		[325, 650],
		128,
		'A Tacloban kasambahay at exactly the RBVIII-DW-06 chartered-city floor of ₱6,400.'
	),
	below(
		'PH-WG28-2',
		'A Tacloban kasambahay on the superseded ₱6,000 in January 2026: refused.',
		'VIII/Tacloban',
		null,
		6000,
		'2026-01',
		'Wage Order No. RBVIII-DW-06 ss.1, 5, 8 (approved 10 Nov, published 22 Nov, effective 8 Dec 2025): domestic workers in chartered cities and first-class municipalities ₱6,000 → ₱6,400 a month, other municipalities ₱5,500 → ₱5,800; no exemption (https://nwpc.dole.gov.ph/wp-content/uploads/2025/11/Wage-Order-No.-RBVIII-DW-06.pdf, read 30 Sep 2026); Tacloban is a chartered city'
	),
	site(
		'PH-WG29-1',
		'A General Santos non-agriculture worker at exactly the RB XII-25 second-tranche floor of ₱460, July 2026.',
		'XII/General Santos',
		'OTHER_NONAGRI',
		10_005,
		'2026-07',
		'Wage Order No. RB XII-25 (effective 2 Nov 2025; second tranche 15 Dec 2025): non-agriculture/retail/service ₱460, agriculture ₱443 (https://nwpc.dole.gov.ph/wp-content/uploads/2025/10/Wage-Order-No.-RBXII-25.pdf; https://nwpc.dole.gov.ph/region-xii/, read 30 Sep 2026)',
		{ sss: [500, 1000], ec: 10, phic: [250.12, 250.13], hdmf: [200, 200] },
		9054.88,
		1460.13,
		'460 × 261 ÷ 12 = 10,005.00. SSS → MSC 10,000: 500.00 / 1,000.00, EC 10. PhilHealth 10,005.00 × 5% = 500.25 → 250.12 / 250.13. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 9,054.88 is under 20,833 anyway). Net 10,005.00 − 950.12 = 9,054.88; employer cost 1,460.13.'
	),
	site(
		'PH-WG29-2',
		'A General Santos agriculture worker at exactly the RB XII-25 second-tranche floor of ₱443, July 2026.',
		'XII/General Santos',
		'AGRICULTURE',
		9635.25,
		'2026-07',
		'Wage Order No. RB XII-25 (effective 2 Nov 2025; second tranche 15 Dec 2025): non-agriculture/retail/service ₱460, agriculture ₱443 (https://nwpc.dole.gov.ph/wp-content/uploads/2025/10/Wage-Order-No.-RBXII-25.pdf; https://nwpc.dole.gov.ph/region-xii/, read 30 Sep 2026)',
		{ sss: [475, 950], ec: 10, phic: [250, 250], hdmf: [192.71, 192.71] },
		8717.54,
		1402.71,
		'443 × 261 ÷ 12 = 9,635.25. SSS → MSC 9,500: 475.00 / 950.00, EC 10. PhilHealth on the ₱10,000 floor → 250.00 / 250.00. Pag-IBIG 2% of 9,635.25 → 192.71 / 192.71. WTAX 0 (minimum-wage earner; taxable 8,717.54 is under 20,833 anyway). Net 9,635.25 − 917.71 = 8,717.54; employer cost 1,402.71.'
	),
	site(
		'PH-WG30-2',
		'An Alaminos (Ilocos) agriculture worker at exactly the RB I-24 floor of ₱480, July 2026.',
		'I/Alaminos',
		'AGRICULTURE',
		10_440,
		'2026-07',
		'Wage Order No. RB I-24 (effective 19 Nov 2025): agriculture and non-agriculture below 10 workers ₱480 a day (https://nwpc.dole.gov.ph/wp-content/uploads/2025/11/Wage-Order-No.-RB-1-24.pdf)',
		{ sss: [525, 1050], ec: 10, phic: [261, 261], hdmf: [200, 200] },
		9454,
		1521,
		'480 × 261 ÷ 12 = 10,440.00. SSS → MSC 10,500: 525.00 / 1,050.00, EC 10. PhilHealth 10,440.00 × 5% = 522.00 → 261.00 / 261.00. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 9,454.00 is under 20,833 anyway). Net 10,440.00 − 986.00 = 9,454.00; employer cost 1,521.00.'
	),
	site(
		'PH-WG31-2',
		'A Tuguegarao (Cagayan Valley) non-agriculture worker at exactly the RTWPB 2-24 floor of ₱500, July 2026.',
		'II/Tuguegarao',
		'OTHER_NONAGRI',
		10_875,
		'2026-07',
		'Wage Order No. RTWPB 2-24 (effective 5 Nov 2025): non-agriculture and agriculture ₱500 a day (https://nwpc.dole.gov.ph/wp-content/uploads/2025/10/Wage-Order-No.-RTWPB-2-24.pdf)',
		{ sss: [550, 1100], ec: 10, phic: [271.87, 271.88], hdmf: [200, 200] },
		9853.13,
		1581.88,
		'500 × 261 ÷ 12 = 10,875.00. SSS → MSC 11,000: 550.00 / 1,100.00, EC 10. PhilHealth 10,875.00 × 5% = 543.75 → 271.87 / 271.88. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 9,853.13 is under 20,833 anyway). Net 10,875.00 − 1,021.87 = 9,853.13; employer cost 1,581.88.'
	),
	site(
		'PH-WG32-2',
		'An Iloilo City agriculture worker at exactly the RBVI-29 floor of ₱520, July 2026.',
		'VI/Iloilo City',
		'AGRICULTURE',
		11_310,
		'2026-07',
		'Wage Order No. RBVI-29 (effective 19 Nov 2025): agriculture ₱520 a day (https://nwpc.dole.gov.ph/wp-content/uploads/2025/11/Wage-Order-No.-RBVI-29.pdf)',
		{ sss: [575, 1150], ec: 10, phic: [282.75, 282.75], hdmf: [200, 200] },
		10_252.25,
		1642.75,
		'520 × 261 ÷ 12 = 11,310.00. SSS → MSC 11,500: 575.00 / 1,150.00, EC 10. PhilHealth 11,310.00 × 5% = 565.50 → 282.75 / 282.75. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 10,252.25 is under 20,833 anyway). Net 11,310.00 − 1,057.75 = 10,252.25; employer cost 1,642.75.'
	),
	site(
		'PH-WG33-2',
		'A Cebu City (Class A) worker at exactly the ROVII-26 floor of ₱540, July 2026.',
		'VII/Cebu',
		'OTHER_NONAGRI',
		11_745,
		'2026-07',
		'Wage Order No. ROVII-26 (effective 4 Oct 2025): expanded Metro Cebu Class A ₱540 a day (https://nwpc.dole.gov.ph/wp-content/uploads/2025/09/Wage-Order-No.-ROVII-26.pdf); Wage Order No. ROVII-27 (issued 14 Sep, published 28 Sep, effective 14 Oct 2026): Class A (Cities of Carcar, Cebu, Danao, Lapu-Lapu, Mandaue, Naga, Talisay and the named municipalities) ₱540 → ₱582 (https://nwpc.dole.gov.ph/wp-content/uploads/2026/09/Wage-Order-No.-ROVII-27.pdf; https://nwpc.dole.gov.ph/region-vii/, read 30 Sep 2026)',
		{ sss: [575, 1150], ec: 10, phic: [293.62, 293.63], hdmf: [200, 200] },
		10_676.38,
		1653.63,
		'540 × 261 ÷ 12 = 11,745.00. SSS → MSC 11,500: 575.00 / 1,150.00, EC 10. PhilHealth 11,745.00 × 5% = 587.25 → 293.62 / 293.63. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 10,676.38 is under 20,833 anyway). Net 11,745.00 − 1,068.62 = 10,676.38; employer cost 1,653.63.'
	),
	site(
		'PH-WG61-1',
		'A Cebu City (Class A) worker at exactly the ROVII-27 floor of ₱582, November 2026.',
		'VII/Cebu',
		'OTHER_NONAGRI',
		12_658.5,
		'2026-11',
		'Wage Order No. ROVII-26 (effective 4 Oct 2025): expanded Metro Cebu Class A ₱540 a day (https://nwpc.dole.gov.ph/wp-content/uploads/2025/09/Wage-Order-No.-ROVII-26.pdf); Wage Order No. ROVII-27 (issued 14 Sep, published 28 Sep, effective 14 Oct 2026): Class A (Cities of Carcar, Cebu, Danao, Lapu-Lapu, Mandaue, Naga, Talisay and the named municipalities) ₱540 → ₱582 (https://nwpc.dole.gov.ph/wp-content/uploads/2026/09/Wage-Order-No.-ROVII-27.pdf; https://nwpc.dole.gov.ph/region-vii/, read 30 Sep 2026)',
		{ sss: [625, 1250], ec: 10, phic: [316.46, 316.47], hdmf: [200, 200] },
		11_517.04,
		1776.47,
		'582 × 261 ÷ 12 = 12,658.50. SSS → MSC 12,500: 625.00 / 1,250.00, EC 10. PhilHealth 12,658.50 × 5% = 632.93 → 316.46 / 316.47. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 11,517.04 is under 20,833 anyway). Net 12,658.50 − 1,141.46 = 11,517.04; employer cost 1,776.47.'
	),
	below(
		'PH-WG61-2',
		'A Cebu City worker left on the ROVII-26 rate of ₱540 in November 2026, after ROVII-27 took effect on 14 October: refused.',
		'VII/Cebu',
		'OTHER_NONAGRI',
		11_745,
		'2026-11',
		'Wage Order No. ROVII-26 (effective 4 Oct 2025): expanded Metro Cebu Class A ₱540 a day (https://nwpc.dole.gov.ph/wp-content/uploads/2025/09/Wage-Order-No.-ROVII-26.pdf); Wage Order No. ROVII-27 (issued 14 Sep, published 28 Sep, effective 14 Oct 2026): Class A (Cities of Carcar, Cebu, Danao, Lapu-Lapu, Mandaue, Naga, Talisay and the named municipalities) ₱540 → ₱582 (https://nwpc.dole.gov.ph/wp-content/uploads/2026/09/Wage-Order-No.-ROVII-27.pdf; https://nwpc.dole.gov.ph/region-vii/, read 30 Sep 2026)'
	),
	domestic(
		'PH-WG61-3',
		'VII/Cebu',
		7500,
		'2026-11',
		'Wage Order No. ROVII-DW-06 (effective 14 Oct 2026): domestic ₱7,000 → ₱7,500 a month (https://nwpc.dole.gov.ph/wp-content/uploads/2026/09/Wage-Order-No.-ROVII-DW-06.pdf; https://nwpc.dole.gov.ph/region-vii/, read 30 Sep 2026)',
		[375, 750],
		150,
		'A Cebu kasambahay at exactly the ROVII-DW-06 floor of ₱7,500, November 2026.'
	),
	site(
		'PH-WG20-1',
		'A Cotabato City (BARMM) non-agriculture worker at exactly the BARMM-05 floor of ₱436, September 2026.',
		'BARMM/Cotabato City',
		'OTHER_NONAGRI',
		9483,
		'2026-09',
		'Wage Order No. BARMM-05 ss.2, 4, 6 (approved 15 Jul, published 21 Jul, effective 6 Aug 2026): Cotabato City/Lamitan City/Marawi City non-agriculture ₱411 → ₱436, agriculture/retail ₱386 → ₱411, a further ₱25 from 1 Dec 2026 (https://nwpc.dole.gov.ph/wp-content/uploads/2026/07/Wage-Order-No.-BARMM-05.pdf, read 30 Sep 2026)',
		{ sss: [475, 950], ec: 10, phic: [250, 250], hdmf: [189.66, 189.66] },
		8568.34,
		1399.66,
		'436 × 261 ÷ 12 = 9,483.00. SSS → MSC 9,500: 475.00 / 950.00, EC 10. PhilHealth on the ₱10,000 floor → 250.00 / 250.00. Pag-IBIG 2% of 9,483.00 → 189.66 / 189.66. WTAX 0 (minimum-wage earner; taxable 8,568.34 is under 20,833 anyway). Net 9,483.00 − 914.66 = 8,568.34; employer cost 1,399.66.'
	),
	site(
		'PH-WG20-2',
		'A Cotabato City retail/service worker at exactly the BARMM-05 agriculture/retail floor of ₱411, September 2026.',
		'BARMM/Cotabato City',
		'RETAIL_SERVICE',
		8939.25,
		'2026-09',
		'Wage Order No. BARMM-05 ss.2, 4, 6 (approved 15 Jul, published 21 Jul, effective 6 Aug 2026): Cotabato City/Lamitan City/Marawi City non-agriculture ₱411 → ₱436, agriculture/retail ₱386 → ₱411, a further ₱25 from 1 Dec 2026 (https://nwpc.dole.gov.ph/wp-content/uploads/2026/07/Wage-Order-No.-BARMM-05.pdf, read 30 Sep 2026)',
		{ sss: [450, 900], ec: 10, phic: [250, 250], hdmf: [178.79, 178.79] },
		8060.46,
		1338.79,
		'411 × 261 ÷ 12 = 8,939.25. SSS → MSC 9,000: 450.00 / 900.00, EC 10. PhilHealth on the ₱10,000 floor → 250.00 / 250.00. Pag-IBIG 2% of 8,939.25 → 178.79 / 178.79. WTAX 0 (minimum-wage earner; taxable 8,060.46 is under 20,833 anyway). Net 8,939.25 − 878.79 = 8,060.46; employer cost 1,338.79.'
	),
	below(
		'PH-WG20-3',
		'A Cotabato City non-agriculture worker left on the BARMM-04 rate of ₱411 in September 2026: refused.',
		'BARMM/Cotabato City',
		'OTHER_NONAGRI',
		8939.25,
		'2026-09',
		'Wage Order No. BARMM-05 ss.2, 4, 6 (approved 15 Jul, published 21 Jul, effective 6 Aug 2026): Cotabato City/Lamitan City/Marawi City non-agriculture ₱411 → ₱436, agriculture/retail ₱386 → ₱411, a further ₱25 from 1 Dec 2026 (https://nwpc.dole.gov.ph/wp-content/uploads/2026/07/Wage-Order-No.-BARMM-05.pdf, read 30 Sep 2026)'
	),
	domestic(
		'PH-WG17-2',
		'XI/Davao',
		6000,
		'2026-02',
		'Wage Order No. RB XI-DW-04 ss.1, 8 (published 25 Feb, effective 13 Mar 2026): chartered cities and first-class municipalities ₱6,000 → ₱6,500 a month (https://nwpc.dole.gov.ph/wp-content/uploads/2026/02/Wage-Order-No.-RB-XI-DW-04.pdf; https://nwpc.dole.gov.ph/region-xi/, read 30 Sep 2026); Davao is a chartered city',
		[300, 600],
		120,
		'A Davao City kasambahay on ₱6,000 in February 2026, the floor before RB XI-DW-04 took effect on 13 March.'
	),
	below(
		'PH-WG17-3',
		'A Davao City kasambahay left on ₱6,000 in April 2026: refused.',
		'XI/Davao',
		null,
		6000,
		'2026-04',
		'Wage Order No. RB XI-DW-04 ss.1, 8 (published 25 Feb, effective 13 Mar 2026): chartered cities and first-class municipalities ₱6,000 → ₱6,500 a month (https://nwpc.dole.gov.ph/wp-content/uploads/2026/02/Wage-Order-No.-RB-XI-DW-04.pdf; https://nwpc.dole.gov.ph/region-xi/, read 30 Sep 2026); Davao is a chartered city'
	),
	below(
		'PH-WG19-2',
		'A Bayugan kasambahay on the superseded ₱6,000 in February 2026: refused.',
		'XIII/Bayugan',
		null,
		6000,
		'2026-02',
		'Wage Order No. RXIII-DW-06 (published 18 Dec 2025, effective 3 Jan 2026): chartered cities and first-class municipalities ₱6,000 → ₱6,500 a month (https://nwpc.dole.gov.ph/wp-content/uploads/2025/12/Wage-Order-No.-RXIII-DW-06.pdf; https://nwpc.dole.gov.ph/region-xiii/, read 30 Sep 2026)'
	),
	below(
		'PH-WG23-2',
		'A Cagayan de Oro kasambahay on the superseded ₱6,000 in February 2026: refused.',
		'X/Cagayan de Oro',
		null,
		6000,
		'2026-02',
		'Wage Order No. RBX-DW-06 ss.1, 8 (published 31 Dec 2025, effective 16 Jan 2026): ₱6,000 → ₱6,500 a month in all areas (https://nwpc.dole.gov.ph/wp-content/uploads/2025/12/Wage-Order-No.-RBX-DW-06.pdf; https://nwpc.dole.gov.ph/region-x/, read 30 Sep 2026)'
	),
	domestic(
		'PH-WG26-2',
		'IV-B/Calapan',
		6500,
		'2025-12',
		'Wage Order No. RB-MIMAROPA-DW-05: ₱6,500 a month before MIMAROPA-DW-06 took effect on 1 January 2026 (https://nwpc.dole.gov.ph/region-ivb/, read 30 Sep 2026)',
		[325, 650],
		130,
		'A Calapan kasambahay at exactly the MIMAROPA-DW-05 floor of ₱6,500, December 2025.'
	),
	domestic(
		'PH-WG22-3',
		'IX/Dapitan',
		5500,
		'2026-04',
		'Wage Order No. RIX-DW-06 s.1 (effective 20 May 2026): chartered cities and first-class municipalities ₱5,500 → ₱6,000 a month, so RIX-DW-05’s ₱5,500 holds before 20 May (https://nwpc.dole.gov.ph/wp-content/uploads/2026/05/Wage-Order-No.-RIX-DW-06.pdf; https://nwpc.dole.gov.ph/region-ix/, read 30 Sep 2026)',
		[275, 550],
		110,
		'A Dapitan City kasambahay at exactly the RIX-DW-05 floor of ₱5,500, April 2026, before RIX-DW-06.'
	),
	below(
		'PH-WG22-4',
		'A Dapitan City kasambahay left on ₱5,500 in June 2026, after RIX-DW-06 took effect on 20 May: refused.',
		'IX/Dapitan',
		null,
		5500,
		'2026-06',
		'Wage Order No. RIX-DW-06 s.1 (effective 20 May 2026): chartered cities and first-class municipalities ₱5,500 → ₱6,000 a month, so RIX-DW-05’s ₱5,500 holds before 20 May (https://nwpc.dole.gov.ph/wp-content/uploads/2026/05/Wage-Order-No.-RIX-DW-06.pdf; https://nwpc.dole.gov.ph/region-ix/, read 30 Sep 2026)'
	),
	// ── A certified BMBE (RA 9178 s.8) ────────────────────────────────────────────────────────
	{
		...seam(
			'PH-WG42-1',
			'A certified Barangay Micro Business Enterprise in NCR pays ₱12,000 a month, under the NCR-26 floor, July 2026: the establishment is outside the Minimum Wage Law, so the run pays, and SSS, PhilHealth and Pag-IBIG still charge.',
			12_000,
			{ sss: [600, 1200], ec: 10, phic: [300, 300], hdmf: [200, 200] },
			10_900,
			1710,
			'RA 9178 (Barangay Micro Business Enterprises Act of 2002) s.8: "The BMBEs shall be exempt from the coverage of the Minimum Wage Law", its employees keeping social security and healthcare benefits; s.4: the Certificate of Authority is issued by the city or municipal treasurer (https://lawphil.net/statutes/repacts/ra2002/ra_9178_2002.html, read 30 Sep 2026); company fact bmbe_certificate_of_authority. SSS 11,750–12,249.99 → MSC 12,000: 600 / 1,200, EC 10. PhilHealth 12,000 × 5% = 600 → 300 / 300. Pag-IBIG 200 / 200. Taxable 12,000 − 1,100 = 10,900 → 0. Net 10,900; employer cost 1,200 + 10 + 300 + 200 = 1,710.'
		),
		company: company({ bmbe_certificate_of_authority: true })
	},
	{
		...below(
			'PH-WG42-2',
			"A kasambahay of a household whose employer also runs a certified BMBE, paid ₱7,000 in NCR in July 2026: the BMBE exemption is the enterprise's, never the household's, so the NCR-DW-06 floor of ₱7,800 refuses the run.",
			'NCR/Manila',
			null,
			7000,
			'2026-07',
			'Wage Order NCR-DW-06 ss.1–2, 8: ₱7,800 a month from 7 February 2026; no exemption (https://nwpc.dole.gov.ph/wp-content/uploads/2026/01/Wage-Order-No.-NCR-DW-06.pdf); RA 9178 s.8 exempts the BMBE from the Minimum Wage Law, and a kasambahay is a household employee under RA 10361, not a BMBE employee (tracker default PH-WG42)'
		),
		company: company({ bmbe_certificate_of_authority: true })
	}
);

register(
	// ── Tranches, sectors and monthly factors not yet probed (2026-09-30) ─────────────────────
	site(
		'PH-WG10-3',
		'A Manila agricultural worker at exactly the NCR-26 agriculture floor of ₱658, July 2026: the agriculture class needs its evidenced worksite and sector sources and pays at 658 × 261 ÷ 12.',
		'NCR/Manila',
		'AGRICULTURE',
		14311.5,
		'2026-07',
		O_NCR26A,
		{ sss: [725, 1450], ec: 10, phic: [357.79, 357.79], hdmf: [200, 200] },
		13028.71,
		2017.79,
		'658 × 261 ÷ 12 = 14,311.50. SSS 14,250–14,749.99 → MSC 14,500: 725.00 / 1,450.00, EC 10. PhilHealth 14,311.50 × 5% = 715.58 → 357.79 / 357.79. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 13,028.71 is under 20,833 anyway). Net 14,311.50 − 1,282.79 = 13,028.71; employer cost 2,017.79.'
	),
	site(
		'PH-WG10-4',
		'A Manila agricultural worker at exactly the NCR-28 agriculture floor of ₱718, November 2026.',
		'NCR/Manila',
		'AGRICULTURE',
		15616.5,
		'2026-11',
		O_NCR28,
		{ sss: [775, 1550], ec: 30, phic: [390.41, 390.42], hdmf: [200, 200] },
		14251.09,
		2170.42,
		'718 × 261 ÷ 12 = 15,616.50. SSS 15,250–15,749.99 → MSC 15,500: 775.00 / 1,550.00, EC 30. PhilHealth 15,616.50 × 5% = 780.83 → 390.41 / 390.42. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 14,251.09 is under 20,833 anyway). Net 15,616.50 − 1,365.41 = 14,251.09; employer cost 2,170.42.'
	),
	below(
		'PH-WG10-5',
		'A Manila agricultural worker left on the NCR-26 ₱658 rate in November 2026, after NCR-28 took effect on 26 September: refused.',
		'NCR/Manila',
		'AGRICULTURE',
		14311.5,
		'2026-11',
		O_NCR28
	),
	site(
		'PH-WG12-3',
		'A City of San Fernando (Pampanga) agricultural worker at exactly the RBIII-26 second-tranche agriculture floor of ₱570, July 2026.',
		'Pampanga/San Fernando',
		'AGRICULTURE',
		12397.5,
		'2026-07',
		O_III,
		{ sss: [625, 1250], ec: 10, phic: [309.94, 309.94], hdmf: [200, 200] },
		11262.56,
		1769.94,
		'570 × 261 ÷ 12 = 12,397.50. SSS 12,250–12,749.99 → MSC 12,500: 625.00 / 1,250.00, EC 10. PhilHealth 12,397.50 × 5% = 619.88 → 309.94 / 309.94. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 11,262.56 is under 20,833 anyway). Net 12,397.50 − 1,134.94 = 11,262.56; employer cost 1,769.94.'
	),
	site(
		'PH-WG12-4',
		'A City of San Fernando (Pampanga) retail/service worker at exactly the RBIII-26 second-tranche retail/service floor of ₱590, July 2026.',
		'Pampanga/San Fernando',
		'RETAIL_SERVICE',
		12832.5,
		'2026-07',
		O_III,
		{ sss: [650, 1300], ec: 10, phic: [320.81, 320.82], hdmf: [200, 200] },
		11661.69,
		1830.82,
		'590 × 261 ÷ 12 = 12,832.50. SSS 12,750–13,249.99 → MSC 13,000: 650.00 / 1,300.00, EC 10. PhilHealth 12,832.50 × 5% = 641.63 → 320.81 / 320.82. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 11,661.69 is under 20,833 anyway). Net 12,832.50 − 1,170.81 = 11,661.69; employer cost 1,830.82.'
	),
	site(
		'PH-WG14-3',
		'A Zamboanga City office worker at exactly the RIX-24 first-tranche non-agriculture floor of ₱439, February 2026 (before the 1 June tranche).',
		'IX/Zamboanga',
		'OTHER_NONAGRI',
		9548.25,
		'2026-02',
		O_IX,
		{ sss: [475, 950], ec: 10, phic: [250, 250], hdmf: [190.97, 190.97] },
		8632.28,
		1400.97,
		'439 × 261 ÷ 12 = 9,548.25. SSS 9,250–9,749.99 → MSC 9,500: 475.00 / 950.00, EC 10. PhilHealth on the ₱10,000 floor → 250.00 / 250.00. Pag-IBIG 2% of 9,548.25 → 190.97 / 190.97. WTAX 0 (minimum-wage earner; taxable 8,632.28 is under 20,833 anyway). Net 9,548.25 − 915.97 = 8,632.28; employer cost 1,400.97.'
	),
	below(
		'PH-WG14-4',
		'A Zamboanga City office worker left on the ₱439 first-tranche rate in July 2026, after the 1 June tranche to ₱464: refused.',
		'IX/Zamboanga',
		'OTHER_NONAGRI',
		9548.25,
		'2026-07',
		O_IX
	),
	site(
		'PH-WG15-3',
		'An Iligan (Category I) office worker at exactly the RX-24 first-tranche floor of ₱486, February 2026 (before the 1 May tranche).',
		'X/Iligan',
		'OTHER_NONAGRI',
		10570.5,
		'2026-02',
		O_X,
		{ sss: [525, 1050], ec: 10, phic: [264.26, 264.27], hdmf: [200, 200] },
		9581.24,
		1524.27,
		'486 × 261 ÷ 12 = 10,570.50. SSS 10,250–10,749.99 → MSC 10,500: 525.00 / 1,050.00, EC 10. PhilHealth 10,570.50 × 5% = 528.53 → 264.26 / 264.27. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 9,581.24 is under 20,833 anyway). Net 10,570.50 − 989.26 = 9,581.24; employer cost 1,524.27.'
	),
	site(
		'PH-WG16-4',
		'A Davao City office worker at exactly the RB XI-24 first-tranche non-agriculture floor of ₱525, April 2026 (after 13 March, before 1 September).',
		'XI/Davao',
		'OTHER_NONAGRI',
		11418.75,
		'2026-04',
		O_XI,
		{ sss: [575, 1150], ec: 10, phic: [285.47, 285.47], hdmf: [200, 200] },
		10358.28,
		1645.47,
		'525 × 261 ÷ 12 = 11,418.75. SSS 11,250–11,749.99 → MSC 11,500: 575.00 / 1,150.00, EC 10. PhilHealth 11,418.75 × 5% = 570.94 → 285.47 / 285.47. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 10,358.28 is under 20,833 anyway). Net 11,418.75 − 1,060.47 = 10,358.28; employer cost 1,645.47.'
	),
	site(
		'PH-WG18-2',
		'A Butuan office worker at exactly the RXIII-20 first-tranche floor of ₱455, February 2026 (before the 1 May tranche).',
		'XIII/Butuan',
		'OTHER_NONAGRI',
		9896.25,
		'2026-02',
		O_XIII,
		{ sss: [500, 1000], ec: 10, phic: [250, 250], hdmf: [197.93, 197.93] },
		8948.32,
		1457.93,
		'455 × 261 ÷ 12 = 9,896.25. SSS 9,750–10,249.99 → MSC 10,000: 500.00 / 1,000.00, EC 10. PhilHealth on the ₱10,000 floor → 250.00 / 250.00. Pag-IBIG 2% of 9,896.25 → 197.93 / 197.93. WTAX 0 (minimum-wage earner; taxable 8,948.32 is under 20,833 anyway). Net 9,896.25 − 947.93 = 8,948.32; employer cost 1,457.93.'
	),
	below(
		'PH-WG18-3',
		'A Butuan office worker left on the ₱455 first-tranche rate in July 2026, after the 1 May tranche to ₱475: refused.',
		'XIII/Butuan',
		'OTHER_NONAGRI',
		9896.25,
		'2026-07',
		O_XIII
	),
	site(
		'PH-WG24-2',
		'An Amadeo (Cavite, second- to fifth-class municipality) office worker at exactly the IVA-22 second-tranche non-agriculture floor of ₱525, July 2026.',
		'Cavite/Amadeo',
		'OTHER_NONAGRI',
		11418.75,
		'2026-07',
		O_IVA,
		{ sss: [575, 1150], ec: 10, phic: [285.47, 285.47], hdmf: [200, 200] },
		10358.28,
		1645.47,
		'525 × 261 ÷ 12 = 11,418.75. SSS 11,250–11,749.99 → MSC 11,500: 575.00 / 1,150.00, EC 10. PhilHealth 11,418.75 × 5% = 570.94 → 285.47 / 285.47. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 10,358.28 is under 20,833 anyway). Net 11,418.75 − 1,060.47 = 10,358.28; employer cost 1,645.47.'
	),
	site(
		'PH-WG24-3',
		'A Noveleta (Cavite, reclassified first-class municipality) office worker at exactly the IVA-22 second-tranche non-agriculture floor of ₱550, July 2026.',
		'Cavite/Noveleta',
		'OTHER_NONAGRI',
		11962.5,
		'2026-07',
		O_IVA,
		{ sss: [600, 1200], ec: 10, phic: [299.06, 299.07], hdmf: [200, 200] },
		10863.44,
		1709.07,
		'550 × 261 ÷ 12 = 11,962.50. SSS 11,750–12,249.99 → MSC 12,000: 600.00 / 1,200.00, EC 10. PhilHealth 11,962.50 × 5% = 598.13 → 299.06 / 299.07. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 10,863.44 is under 20,833 anyway). Net 11,962.50 − 1,099.06 = 10,863.44; employer cost 1,709.07.'
	),
	site(
		'PH-WG24-4',
		'An Amadeo (Cavite) agricultural worker at exactly the IVA-22 second-tranche agriculture floor of ₱508, July 2026.',
		'Cavite/Amadeo',
		'AGRICULTURE',
		11049,
		'2026-07',
		O_IVA,
		{ sss: [550, 1100], ec: 10, phic: [276.22, 276.23], hdmf: [200, 200] },
		10022.78,
		1586.23,
		'508 × 261 ÷ 12 = 11,049.00. SSS 10,750–11,249.99 → MSC 11,000: 550.00 / 1,100.00, EC 10. PhilHealth 11,049.00 × 5% = 552.45 → 276.22 / 276.23. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 10,022.78 is under 20,833 anyway). Net 11,049.00 − 1,026.22 = 10,022.78; employer cost 1,586.23.'
	),
	below(
		'PH-WG24-5',
		'An Amadeo office worker left on the IVA-22 first-tranche ₱510 in July 2026, after the 1 April 2026 tranche to ₱525: refused.',
		'Cavite/Amadeo',
		'OTHER_NONAGRI',
		11092.5,
		'2026-07',
		O_IVA
	),
	below(
		'PH-WG25-2',
		'A Puerto Princesa office worker left on the superseded ₱430 in July 2026: MIMAROPA-13 states ₱455 from 1 January 2026, so the run is refused.',
		'IV-B/Puerto Princesa',
		'OTHER_NONAGRI',
		9352.5,
		'2026-07',
		O_IVB
	),
	below(
		'PH-WG29-3',
		'A General Santos office worker left on the RB XII-25 first-tranche ₱450 in July 2026, after the 15 December 2025 tranche to ₱460: refused.',
		'XII/General Santos',
		'OTHER_NONAGRI',
		9787.5,
		'2026-07',
		O_XII
	),
	site(
		'PH-WG31-3',
		'A Tuguegarao agricultural worker at exactly the RTWPB 2-24 agriculture floor of ₱500, July 2026.',
		'II/Tuguegarao',
		'AGRICULTURE',
		10875,
		'2026-07',
		O_II,
		{ sss: [550, 1100], ec: 10, phic: [271.87, 271.88], hdmf: [200, 200] },
		9853.13,
		1581.88,
		'500 × 261 ÷ 12 = 10,875.00. SSS 10,750–11,249.99 → MSC 11,000: 550.00 / 1,100.00, EC 10. PhilHealth 10,875.00 × 5% = 543.75 → 271.87 / 271.88. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 9,853.13 is under 20,833 anyway). Net 10,875.00 − 1,021.87 = 9,853.13; employer cost 1,581.88.'
	),
	site(
		'PH-WG13-3',
		'A Naga (Bicol) office worker at exactly the RBV-23 second-tranche floor of ₱480, December 2026.',
		'V/Naga',
		'OTHER_NONAGRI',
		10440,
		'2026-12',
		O_V,
		{ sss: [525, 1050], ec: 10, phic: [261, 261], hdmf: [200, 200] },
		9454,
		1521,
		'480 × 261 ÷ 12 = 10,440.00. SSS 10,250–10,749.99 → MSC 10,500: 525.00 / 1,050.00, EC 10. PhilHealth 10,440.00 × 5% = 522.00 → 261.00 / 261.00. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 9,454.00 is under 20,833 anyway). Net 10,440.00 − 986.00 = 9,454.00; employer cost 1,521.00.'
	),
	below(
		'PH-WG13-4',
		'A Naga office worker left on the ₱455 first-tranche rate in December 2026, after the 1 December tranche to ₱480: refused.',
		'V/Naga',
		'OTHER_NONAGRI',
		9896.25,
		'2026-12',
		O_V
	),
	site(
		'PH-WG20-4',
		'A Cotabato City office worker at exactly the BARMM-05 second-tranche non-agriculture floor of ₱461, December 2026.',
		'BARMM/Cotabato City',
		'OTHER_NONAGRI',
		10026.75,
		'2026-12',
		O_BARMM,
		{ sss: [500, 1000], ec: 10, phic: [250.67, 250.67], hdmf: [200, 200] },
		9076.08,
		1460.67,
		'461 × 261 ÷ 12 = 10,026.75. SSS 9,750–10,249.99 → MSC 10,000: 500.00 / 1,000.00, EC 10. PhilHealth 10,026.75 × 5% = 501.34 → 250.67 / 250.67. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 9,076.08 is under 20,833 anyway). Net 10,026.75 − 950.67 = 9,076.08; employer cost 1,460.67.'
	),
	below(
		'PH-WG20-5',
		'A Cotabato City office worker left on the ₱436 first-tranche rate in December 2026, after the 1 December tranche to ₱461: refused.',
		'BARMM/Cotabato City',
		'OTHER_NONAGRI',
		9483,
		'2026-12',
		O_BARMM
	),
	site(
		'PH-WG27-4',
		'A Tacloban office worker at exactly the RB VIII-25 first-tranche non-agriculture floor of ₱452, February 2026 (after 8 December 2025, before the 1 June tranche).',
		'VIII/Tacloban',
		'OTHER_NONAGRI',
		9831,
		'2026-02',
		O_VIII,
		{ sss: [500, 1000], ec: 10, phic: [250, 250], hdmf: [196.62, 196.62] },
		8884.38,
		1456.62,
		'452 × 261 ÷ 12 = 9,831.00. SSS 9,750–10,249.99 → MSC 10,000: 500.00 / 1,000.00, EC 10. PhilHealth on the ₱10,000 floor → 250.00 / 250.00. Pag-IBIG 2% of 9,831.00 → 196.62 / 196.62. WTAX 0 (minimum-wage earner; taxable 8,884.38 is under 20,833 anyway). Net 9,831.00 − 946.62 = 8,884.38; employer cost 1,456.62.'
	),
	seam(
		'PH-WG59-1',
		'An NCR office worker whose contract pays the rest days (terms.paid_rest_days) is compared with the NCR-26 floor on the 365-day factor: ₱695 × 365 ÷ 12 = ₱21,139.58(3), met by ₱21,139.59 in July 2026.',
		21_139.59,
		{ sss: [1000, 2000], mpf: [50, 100], ec: 30, phic: [528.49, 528.49], hdmf: [200, 200] },
		19361.1,
		2858.49,
		`${NCR26}. ` +
			'NWPC equivalent-monthly-rate FAQ (https://nwpc.dole.gov.ph/faqs/, read 30 Sep 2026): the monthly equivalent of a worker paid for every day of the year, rest days included, is the daily rate × 365 ÷ 12 — 695 × 365 ÷ 12 = 21,139.583, met by 21,139.59 (the floor is money, in cents). SSS 20,750–21,249.99 → MSC 21,000: 1,000.00 / 2,000.00, MPF 1,000 × 5% / 10% = 50.00 / 100.00, EC 30. PhilHealth 21,139.59 × 5% = 1,056.98 → 528.49 / 528.49. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 19,361.10 is under 20,833 anyway). Net 21,139.59 − 1,778.49 = 19,361.10; employer cost 2,858.49.',
		{ terms: { paid_rest_days: true } }
	),
	{
		id: 'PH-WG59-2',
		profile: 'PH',
		description:
			'The same paid-rest-day contract at the five-day monthly equivalent ₱15,116.25 in July 2026: on the 365-day factor the NCR-26 floor is ₱21,139.58, so the run is refused.',
		citation: [
			NCR26,
			'NWPC equivalent-monthly-rate FAQ (https://nwpc.dole.gov.ph/faqs/, read 30 Sep 2026): a worker paid for every day including rest days is judged on daily rate × 365 ÷ 12 = 695 × 365 ÷ 12 = 21,139.58; ₱15,116.25 (the 261-day figure) is below it'
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '1990-05-14',
				from: '2020-01-06',
				salary: 15_116.25,
				terms: { paid_rest_days: true }
			})
		],
		period: '2026-07',
		refused: 'MINIMUM_WAGE_BELOW: P-PH-w is contracted at ',
		expected: []
	},
	{
		...seam(
			'PH-WG59-3',
			'An NCR worker rostered six days a week (Monday to Saturday, Sunday rest, no paid rest day) is compared with the NCR-26 floor on the 313-day factor: ₱695 × 313 ÷ 12 = ₱18,127.92, paid exactly in July 2026.',
			18_127.92,
			{ sss: [900, 1800], ec: 30, phic: [453.2, 453.2], hdmf: [200, 200] },
			16574.72,
			2483.2,
			`${NCR26}. ` +
				'NWPC equivalent-monthly-rate FAQ (https://nwpc.dole.gov.ph/faqs/, read 30 Sep 2026): a six-day worker without paid rest days is judged on daily rate × 313 ÷ 12 — 695 × 313 ÷ 12 = 18,127.92 (18,127.9167 to the cent). SSS 17,750–18,249.99 → MSC 18,000: 900.00 / 1,800.00, EC 30. PhilHealth 18,127.92 × 5% = 906.40 → 453.20 / 453.20. Pag-IBIG 2% of the ₱10,000 cap → 200.00 / 200.00. WTAX 0 (minimum-wage earner; taxable 16,574.72 is under 20,833 anyway). Net 18,127.92 − 1,553.20 = 16,574.72; employer cost 2,483.20.',
			{ terms: { shift_pattern_id: '@six' } }
		),
		inputs: [
			...week,
			...six,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '1990-05-14',
				from: '2020-01-06',
				salary: 18_127.92,
				terms: { shift_pattern_id: '@six' }
			})
		]
	},
	{
		id: 'PH-WG59-4',
		profile: 'PH',
		description:
			'A six-day NCR worker on the five-day monthly equivalent ₱15,116.25 in July 2026: the 313-day floor ₱18,127.92 applies, so the run is refused.',
		citation: [
			NCR26,
			'NWPC equivalent-monthly-rate FAQ (https://nwpc.dole.gov.ph/faqs/, read 30 Sep 2026): a six-day worker without paid rest days is judged on daily rate × 313 ÷ 12 = 18,127.92; ₱15,116.25 is below it'
		],
		company: company(),
		inputs: [
			...week,
			...six,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '1990-05-14',
				from: '2020-01-06',
				salary: 15_116.25,
				terms: { shift_pattern_id: '@six' }
			})
		],
		period: '2026-07',
		refused: 'MINIMUM_WAGE_BELOW: P-PH-w is contracted at ',
		expected: []
	},
	{
		id: 'PH-EBET05-1',
		profile: 'PH',
		description:
			'An NCR apprentice on a five-day week paid ₱11,000 in July 2026: the training allowance floor is 75% of the NCR-26 minimum, 695 × 0.75 × 261 ÷ 12 = ₱11,337.19, so the run is refused.',
		citation: [
			NCR26,
			'RA 12063 (Enterprise-Based Education and Training Framework Act) s.13(b): an apprenticeship trainee receives a training allowance not lower than 75% of the applicable minimum wage rate (https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/98026, read 30 Sep 2026); 695 × 0.75 = 521.25 a day × 261 ÷ 12 = 11,337.1875; ₱11,000 is below it'
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '2005-05-14',
				from: '2026-01-05',
				salary: 11_000,
				type: 'APPRENTICE'
			})
		],
		period: '2026-07',
		refused: 'MINIMUM_WAGE_BELOW: P-PH-w is contracted at ',
		expected: []
	}
);

const RR29 =
	'RR 2-98 s.2.78.1(A)(3) as amended by RR 29-2025 (issued 22 Dec 2025, in force 6 Jan 2026) (digest, https://bir-cdn.bir.gov.ph/BIR/pdf/RR%20No.%2029-2025%20digest%20FINAL.pdf, read 30 Sep 2026): uniform and clothing allowance to ₱8,000 a year (e); actual medical assistance to ₱12,000 a year (f); achievement awards to ₱12,000 a year under a written plan (h); Christmas and major anniversary gifts to ₱6,000 a year (i); RR 11-2018 s.2.78.1(A)(3) closing paragraph: de minimis paid above its ceiling is an ‘other benefit’ inside the ₱90,000 exclusion of NIRC s.32(B)(7)(e)';
const AT_40000 = {
	sss: [1000, 2000],
	mpf: [750, 1500],
	ec: 30,
	phic: [1000, 1000],
	hdmf: [200, 200]
} satisfies Omit<Charges, 'wtax'>;
const adhoc = (code: string, amount: number, day: string, reason: string): ProbeInput => ({
	collection: 'adhoc_requests',
	values: {
		employment_id: '@w_job',
		catalogue_id: `@law:adhoc_catalogue:${code}@${day}`,
		amount,
		event_date: day,
		reason
	}
});
const monthsBefore = (year: number, last: number): ProbeInput[] =>
	Array.from({ length: last }, (_, i) => ({
		collection: 'payroll_runs',
		values: { company_id: '@company', period: `${year}-${String(i + 1).padStart(2, '0')}` }
	}));

register(
	// ── De minimis ceilings and the ₱90,000 pool (2026-09-30) ─────────────────────────────────
	{
		id: 'PH-AM02-1',
		profile: 'PH',
		description:
			'On ₱40,000 in July 2026, a ₱90,000 bonus fills the benefits pool, so each de minimis class paid over its RR 29-2025 ceiling is taxed on its excess: uniform ₱10,000 (₱2,000 over ₱8,000), award ₱14,000 (₱2,000 over ₱12,000), gift ₱7,000 (₱1,000 over ₱6,000), medical ₱13,000 (₱1,000 over ₱12,000).',
		citation: [
			RR29,
			'NIRC s.32(B)(7)(e); RR 11-2018 s.6: 13th-month pay and other benefits excluded up to ₱90,000 a year — the ₱90,000 bonus uses it whole',
			SSS,
			PHIC,
			HDMF,
			WTAX,
			'SSS at MSC 35,000 on any base above 34,750: 1,000 / 2,000, MPF 750 / 1,500, EC 30. PhilHealth on the basic 40,000 × 5% = 2,000 → 1,000 / 1,000. Pag-IBIG capped 200 / 200. Taxable regular 40,000 − 2,950 = 37,050 (20% rung); excess 2,000 + 2,000 + 1,000 + 1,000 = 6,000; taxable 43,050 → 1,875 + 20% × (43,050 − 33,333) = 3,818.40. Gross 40,000 + 90,000 + 10,000 + 14,000 + 7,000 + 13,000 = 174,000; net 174,000 − 2,950 − 3,818.40 = 167,231.60; employer cost 4,730'
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '1990-05-14',
				from: '2020-01-06',
				salary: 40_000
			}),
			adhoc('bonus', 90_000, '2026-07-15', 'Mid-year performance bonus'),
			adhoc('UNIFORM_ALLOWANCE', 10_000, '2026-07-15', 'Uniform allowance'),
			adhoc('ACHIEVEMENT_AWARD', 14_000, '2026-07-15', 'Ten-year service award (written plan)'),
			adhoc('CHRISTMAS_GIFT', 7000, '2026-07-15', 'Company anniversary gift'),
			adhoc('MEDICAL_ASSISTANCE', 13_000, '2026-07-15', 'Executive check-up')
		],
		period: '2026-07',
		expected: [
			{
				employment: 'w_job',
				lines: {
					gross: 174_000,
					net: 167_231.6,
					employer_cost: 4730,
					bonus: 90_000,
					UNIFORM_ALLOWANCE: 10_000,
					ACHIEVEMENT_AWARD: 14_000,
					CHRISTMAS_GIFT: 7000,
					MEDICAL_ASSISTANCE: 13_000,
					...charges({ ...AT_40000, wtax: 3818.4 })
				}
			}
		]
	},
	{
		id: 'PH-AM02-2',
		profile: 'PH',
		description:
			'On ₱40,000 in July 2026 with nothing else paid in the year, a ₱10,000 uniform allowance is ₱8,000 de minimis and a ₱2,000 excess that the unused ₱90,000 pool absorbs: the withholding is the salary’s alone.',
		citation: [
			RR29,
			SSS,
			PHIC,
			HDMF,
			WTAX,
			'Charges as PH-SS01-5. Taxable 40,000 − 2,950 = 37,050 → 1,875 + 20% × 3,717 = 2,618.40. Gross 50,000; net 50,000 − 2,950 − 2,618.40 = 44,431.60; employer cost 4,730'
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '1990-05-14',
				from: '2020-01-06',
				salary: 40_000
			}),
			adhoc('UNIFORM_ALLOWANCE', 10_000, '2026-07-15', 'Uniform allowance')
		],
		period: '2026-07',
		expected: [
			{
				employment: 'w_job',
				lines: {
					gross: 50_000,
					net: 44_431.6,
					employer_cost: 4730,
					UNIFORM_ALLOWANCE: 10_000,
					...charges({ ...AT_40000, wtax: 2618.4 })
				}
			}
		]
	},
	{
		id: 'PH-AM02-3',
		profile: 'PH',
		description:
			'The uniform ceiling is a year’s: ₱5,000 in June 2026 (with a ₱90,000 bonus that fills the pool) and ₱5,000 in July on ₱40,000 — July’s payment takes the year to ₱10,000, so ₱2,000 of it is taxed.',
		citation: [
			RR29,
			'NIRC s.32(B)(7)(e): the ₱90,000 is a year’s exclusion; June’s ₱90,000 bonus uses it',
			SSS,
			PHIC,
			HDMF,
			WTAX,
			'June (run first): 40,000 + 90,000 bonus + 5,000 uniform, all exempt beyond the salary → 2,618.40. July: year uniform 10,000 − 8,000 = 2,000 excess, pool spent → taxable 37,050 + 2,000 = 39,050 → 1,875 + 20% × 5,717 = 3,018.40. Gross 45,000; net 45,000 − 2,950 − 3,018.40 = 39,031.60; employer cost 4,730'
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '1990-05-14',
				from: '2020-01-06',
				salary: 40_000
			}),
			adhoc('bonus', 90_000, '2026-06-15', 'Mid-year performance bonus'),
			adhoc('UNIFORM_ALLOWANCE', 5000, '2026-06-15', 'Uniform allowance, first half'),
			{ collection: 'payroll_runs', values: { company_id: '@company', period: '2026-06' } },
			adhoc('UNIFORM_ALLOWANCE', 5000, '2026-07-15', 'Uniform allowance, second half')
		],
		period: '2026-07',
		expected: [
			{
				employment: 'w_job',
				lines: {
					gross: 45_000,
					net: 39_031.6,
					employer_cost: 4730,
					UNIFORM_ALLOWANCE: 5000,
					...charges({ ...AT_40000, wtax: 3018.4 })
				}
			}
		]
	},

	// ── Year-end: the 13th month and the annual adjustment ────────────────────────────────────
	{
		id: 'PH-HR14-1',
		profile: 'PH',
		description:
			'A rank-and-file employee on ₱40,000 all of 2026 (January to November already paid): December pays the 13th month of a twelfth of the year’s basic, exempt inside the ₱90,000, and the year-end adjustment withholds the annual tax less what the eleven months withheld.',
		citation: [
			'PD 851 and Revised Guidelines ¶¶1–4 (DOLE Handbook 2024 ch.13 §§A–E, https://nwpc.dole.gov.ph/wp-content/uploads/2024/11/Workers-Statutory-Monetary-Benefits-Handbook-2024-Edition.pdf): one twelfth of the basic salary earned in the calendar year, not later than 24 December: 12 × 40,000 ÷ 12 = 40,000',
			'NIRC s.32(B)(7)(e): 13th-month pay excluded up to ₱90,000',
			'RR 11-2018 s.2.79(B)(5)(b) (RR 2-98 as amended): the employer computes the year’s tax on the year’s taxable compensation before the last payroll of the year and withholds the difference; annual table NIRC s.24(A)(2)(a) as amended by RA 10963 from 1 Jan 2023: 400,000–800,000 → 22,500 + 20% over 400,000 (https://bir-cdn.bir.gov.ph/local/pdf/Annex%20E%20RR%2011-2018.pdf)',
			SSS,
			PHIC,
			HDMF,
			'Each month: charges 2,950 employee, withheld 2,618.40 (case PH-SS01-5). Year taxable 12 × 40,000 − 12 × 2,950 = 444,600 → 22,500 + 20% × 44,600 = 31,420; December WTAX 31,420 − 11 × 2,618.40 = 2,617.60. Net 40,000 − 2,950 − 2,617.60 + 40,000 (13th month, a net addition) = 74,432.40; employer cost 4,730'
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '1990-05-14',
				from: '2020-01-06',
				salary: 40_000
			}),
			...monthsBefore(2026, 11),
			adhoc('THIRTEENTH_MONTH_PAY', 0, '2026-12-15', '13th month pay (PD 851)')
		],
		period: '2026-12',
		expected: [
			{
				employment: 'w_job',
				lines: {
					gross: 40_000,
					net: 74_432.4,
					employer_cost: 4730,
					THIRTEENTH_MONTH_PAY: 40_000,
					...charges({ ...AT_40000, wtax: 2617.6 })
				}
			}
		]
	},

	// ── Holidays not worked; overtime on rest days and at night ───────────────────────────────
	...(
		[
			[
				'PH-HR05-2',
				true,
				'On ₱30,450, leave without pay on Friday 28 August 2026, the workday before the regular holiday of Monday 31 August 2026 (not worked): the holiday is not paid, so the month loses two days.',
				'Gross 30,450 − 2 × 1,400 = 27,650. SSS 27,250–27,749.99 → MSC 27,500: SS 1,000 / 2,000, MPF 375 / 750, EC 30. PhilHealth on 30,450 → 761.25 / 761.25. Pag-IBIG 200 / 200. Taxable 27,650 − 2,336.25 = 25,313.75 → 15% × 4,480.75 = 672.11. Net 27,650 − 2,336.25 − 672.11 = 24,641.64; employer cost 3,741.25'
			],
			[
				'PH-HR05-3',
				false,
				'On ₱30,450, present on Friday 28 August 2026 and not working the regular holiday of Monday 31 August 2026: the holiday is paid, so the month is whole.',
				'As PH-SS01-1: gross 30,450, net 26,894.14, employer cost 4,041.25'
			]
		] as const
	).map(([id, absentBefore, description, arithmetic]): ProbeCase => ({
		id,
		profile: 'PH',
		description,
		citation: [
			'Proclamation 1006 (2026): 31 August (National Heroes Day) regular holiday (https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/7/97992)',
			`Labor Code art.94; Omnibus Rules Book III Rule IV s.6(a); ${HANDBOOK} ch.3 §B: an employee on leave of absence without pay on the day immediately preceding a regular holiday is not paid the unworked holiday; where that day is a non-working or rest day, the workday before it decides (Friday 28 August for Monday 31 August)`,
			DAILY,
			SSS,
			PHIC,
			HDMF,
			WTAX,
			arithmetic
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '1990-05-14',
				from: '2020-01-06',
				salary: 30_450
			}),
			{
				collection: 'jurisdiction_holidays',
				values: {
					company_id: '@company',
					date: '2026-08-31',
					name: 'National Heroes Day',
					kind: 'PUBLIC_HOLIDAY',
					source: 'Proclamation 1006',
					published_at: '2026-01-02T00:00:00.000Z'
				}
			},
			...(absentBefore
				? [
						{
							collection: 'leave_entries',
							values: {
								employment_id: '@w_job',
								catalogue_id: '@law:leave_catalogue:UNPAID_LEAVE',
								reference: 'PROBE-PH-NPL-HOLIDAY',
								from_date: '2026-08-28',
								to_date: '2026-08-28',
								reason: 'Personal matter, unpaid'
							}
						} satisfies ProbeInput
					]
				: [])
		],
		period: '2026-08',
		expected: [
			{
				employment: 'w_job',
				lines: absentBefore
					? {
							gross: 27_650,
							net: 24_641.64,
							employer_cost: 3741.25,
							...charges({
								sss: [1000, 2000],
								mpf: [375, 750],
								ec: 30,
								phic: [761.25, 761.25],
								hdmf: [200, 200],
								wtax: 672.11
							})
						}
					: { gross: 30_450, net: 26_894.14, employer_cost: 4041.25, ...charges(FULL_30450) }
			}
		]
	})),
	{
		id: 'PH-HR06-2',
		profile: 'PH',
		description:
			'On ₱30,450, ten hours on the Sunday rest day of 12 July 2026: the first eight at 130% of the hourly rate, the two beyond at a further 30% of the rest-day hourly rate (169%).',
		citation: [
			`Labor Code arts.87, 93; ${HANDBOOK} ch.4 §§C–D: rest-day work +30% (130% where the rest day is unpaid); work beyond eight hours on a rest day is the rest-day hourly rate plus 30% of it: 175 × 1.30 × 1.30 = 295.75 an hour`,
			DAILY,
			SSS,
			PHIC,
			HDMF,
			WTAX,
			'09:00–20:00 less the meal hour = 10 hours. 8 × 175 × 1.30 = 1,820; 2 × 175 × 1.69 = 591.50; gross 30,450 + 2,411.50 = 32,861.50. SSS 32,750–33,249.99 → MSC 33,000: SS 1,000 / 2,000, MPF 650 / 1,300, EC 30. PhilHealth on the basic 761.25 / 761.25. Pag-IBIG 200 / 200. Bracket on regular 30,450 − 2,611.25 (15% rung), applied to 32,861.50 − 2,611.25 = 30,250.25: 15% × 9,417.25 = 1,412.5875 → 1,412.59. Net 32,861.50 − 2,611.25 − 1,412.59 = 28,837.66; employer cost 2,000 + 1,300 + 30 + 761.25 + 200 = 4,291.25'
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '1990-05-14',
				from: '2020-01-06',
				salary: 30_450
			}),
			{
				collection: 'work_days',
				values: {
					employment_id: '@w_job',
					work_date: '2026-07-12',
					worked_intervals: [at('2026-07-12', '09:00', '20:00')],
					approved_overtime_hours: 10
				}
			}
		],
		period: '2026-07',
		expected: [
			{
				employment: 'w_job',
				lines: {
					gross: 32_861.5,
					net: 28_837.66,
					employer_cost: 4291.25,
					...charges({
						sss: [1000, 2000],
						mpf: [650, 1300],
						ec: 30,
						phic: [761.25, 761.25],
						hdmf: [200, 200],
						wtax: 1412.59
					})
				}
			}
		]
	},
	{
		id: 'PH-HR06-3',
		profile: 'PH',
		description:
			'On ₱30,450, five approved overtime hours on Monday 6 July 2026 running to 23:00: all five at +25%, and the one after 22:00 also earns the night differential of 10% of the overtime hourly rate.',
		citation: [
			`Labor Code arts.86, 87; ${HANDBOOK} ch.5 §C: night-shift differential is 10% of the regular wage for each hour between 10:00 p.m. and 6:00 a.m.; on overtime it is 10% of the overtime hourly rate: 175 × 1.25 × 1.10 = 240.625 for the night overtime hour`,
			DAILY,
			SSS,
			PHIC,
			HDMF,
			WTAX,
			'09:00–23:00 less the meal hour = 13 hours: 8 normal, 5 overtime (18:00–23:00). Overtime 5 × 175 × 1.25 = 1,093.75; night differential 1 × 175 × 1.25 × 0.10 = 21.875 → 21.88; gross 30,450 + 1,115.63 = 31,565.63. SSS 31,250–31,749.99 → MSC 31,500: SS 1,000 / 2,000, MPF 575 / 1,150, EC 30. PhilHealth 761.25 / 761.25. Pag-IBIG 200 / 200. Taxable 31,565.63 − 2,536.25 = 29,029.38 → 15% × 8,196.38 = 1,229.457 → 1,229.46. Net 31,565.63 − 2,536.25 − 1,229.46 = 27,799.92; employer cost 2,000 + 1,150 + 30 + 761.25 + 200 = 4,141.25'
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '1990-05-14',
				from: '2020-01-06',
				salary: 30_450
			}),
			{
				collection: 'work_days',
				values: {
					employment_id: '@w_job',
					work_date: '2026-07-06',
					shift_definition_id: '@office',
					worked_intervals: [at('2026-07-06', '09:00', '23:00')],
					approved_overtime_hours: 5
				}
			}
		],
		period: '2026-07',
		expected: [
			{
				employment: 'w_job',
				lines: {
					gross: 31_565.63,
					net: 27_799.92,
					employer_cost: 4141.25,
					...charges({
						sss: [1000, 2000],
						mpf: [575, 1150],
						ec: 30,
						phic: [761.25, 761.25],
						hdmf: [200, 200],
						wtax: 1229.46
					})
				}
			}
		]
	},

	// ── Below-floor refusals the harness had not pinned ───────────────────────────────────────
	{
		id: 'PH-A3-2',
		profile: 'PH',
		description:
			'An NCR kasambahay on ₱7,000 in July 2026 (NCR-DW-06 floor ₱7,800) is refused even though the establishment records a board exemption: the domestic order admits none.',
		citation: [
			'Wage Order NCR-DW-06 s.1 (₱7,000 + ₱800 = ₱7,800 a month from 7 February 2026), s.5 (“No exemption shall be allowed under this Wage Order.”) (https://nwpc.dole.gov.ph/wp-content/uploads/2026/01/Wage-Order-No.-NCR-DW-06.pdf, read 30 Sep 2026)',
			DOMESTIC
		],
		company: company({ minimum_wage_exemption_approved: true }),
		inputs: [
			...week,
			...hire({
				ref: 'k',
				name: 'Maria Santos',
				gender: 'FEMALE',
				born: '1988-02-11',
				from: '2024-01-08',
				salary: 7000,
				sector: null,
				type: 'DOMESTIC'
			})
		],
		period: '2026-07',
		refused: 'MINIMUM_WAGE_BELOW: P-PH-k is contracted at ',
		expected: []
	},
	{
		id: 'PH-A3-3',
		profile: 'PH',
		description:
			'An NCR part-timer on 20 hours a week paid ₱7,000 in July 2026 with no exemption: below the hour-proportionate NCR-26 floor of ₱7,558.13, so the run is refused.',
		citation: [
			NCR26,
			`Wage Order NCR-28 ss.3–4 and ${HANDBOOK} ch.1 §L: a worker on less than the normal hours is owed a proportion of the daily rate; 695 × 261 ÷ 12 × 20 ÷ 40 = 7,558.13 (tracker default PH-A3); ₱7,000 is below it`
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Juan Dela Cruz',
				born: '1990-05-14',
				from: '2020-01-06',
				salary: 7000,
				type: 'PART_TIME',
				terms: { ordinary_hours_per_week: 20 }
			})
		],
		period: '2026-07',
		refused: 'MINIMUM_WAGE_BELOW: P-PH-w is contracted at ',
		expected: []
	},

	// ── Court-ordered support, kasambahay forfeiture and deductions ───────────────────────────
	{
		id: 'PH-HR52-1',
		profile: 'PH',
		description:
			'A served protection order fixing ₱6,000 of support for July 2026 on ₱30,450: withheld from net pay after every statutory line, leaving SSS, PhilHealth, Pag-IBIG and withholding on the whole compensation.',
		citation: [
			'RA 9262 s.8(g): the court orders a percentage of the respondent’s salary withheld regularly by the employer and remitted to the woman, notwithstanding other laws (https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/22128, read 30 Sep 2026); the Act states no booking, so the recorded default (tracker PH-HR52) is a net deduction of the peso amount the order fixes',
			SSS,
			PHIC,
			HDMF,
			WTAX,
			'Charges and withholding as PH-SS01-1 (net before the order 26,894.14); net 26,894.14 − 6,000 = 20,894.14; employer cost 4,041.25'
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'w',
				name: 'Pedro Ramos',
				born: '1990-05-14',
				from: '2020-01-06',
				salary: 30_450
			}),
			{
				...adhoc(
					'PROTECTION_ORDER_SUPPORT',
					6000,
					'2026-07-15',
					'Permanent protection order, July support'
				),
				files: { evidence_file: 'protection-order.pdf' }
			}
		],
		period: '2026-07',
		expected: [
			{
				employment: 'w_job',
				lines: {
					gross: 30_450,
					net: 20_894.14,
					employer_cost: 4041.25,
					PROTECTION_ORDER_SUPPORT: 6000,
					...charges(FULL_30450)
				}
			}
		]
	},
	{
		id: 'PH-HR45-2',
		profile: 'PH',
		description:
			'An NCR kasambahay on ₱7,800 who leaves without justifiable reason on Tuesday 27 January 2026 forfeits fifteen days’ unpaid salary; the 13th month is not salary for the cap and is still paid.',
		citation: [
			'RA 10361 s.32: a kasambahay who leaves without justifiable reason forfeits unpaid salary of not more than fifteen days (https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/51514); the day on the monthly-paid 261-day factor (tracker default PH-HR45): 15 × 7,800 × 12 ÷ 261 = 5,379.31, below the 6,813.79 unpaid',
			'RA 10361 s.25 / PD 851: 6,813.79 ÷ 12 = 567.82',
			'Wage Order NCR-DW-05 (effective 4 January 2025, NCR-DW-06 recital): ₱7,000 a month through 6 February 2026 (tracker PH-WG04); ₱7,800 is above it',
			DOMESTIC,
			SSS,
			PHIC,
			HDMF,
			'1–2, 5–9, 12–16, 19–23, 26–27 January = 19 working days: 7,800 × 19 ÷ 21.75 = 6,813.79. SSS 6,750–7,249.99 → MSC 7,000: 350 / 700, EC 10. PhilHealth floor 250 / 250. Pag-IBIG 2% × 6,813.79 = 136.28 / 136.28. WTAX 0 (taxable 6,077.51 under 20,833). The forfeiture is a net deduction (it touches no contribution base; tracker default PH-HR45). Net 6,813.79 − 736.28 − 5,379.31 + 567.82 = 1,266.02; employer cost 700 + 10 + 250 + 136.28 = 1,096.28'
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'k',
				name: 'Maria Santos',
				gender: 'FEMALE',
				born: '1988-02-11',
				from: '2024-01-08',
				to: '2026-01-27',
				salary: 7800,
				sector: null,
				type: 'DOMESTIC',
				employment: {
					exit_ground: 'RESIGNATION',
					exit_facts: { kasambahay_unjustified_departure: true }
				}
			}),
			...separation('k', '2026-01-27', ['KASAMBAHAY_FORFEITURE', 'THIRTEENTH_MONTH_PAY'])
		],
		period: '2026-01',
		expected: [
			{
				employment: 'k_job',
				lines: {
					gross: 6813.79,
					net: 1266.02,
					employer_cost: 1096.28,
					KASAMBAHAY_FORFEITURE: 5379.31,
					THIRTEENTH_MONTH_PAY: 567.82,
					...charges({ sss: [350, 700], ec: 10, phic: [250, 250], hdmf: [136.28, 136.28] })
				}
			}
		]
	},
	{
		id: 'PH-WG05-1',
		profile: 'PH',
		description:
			'A company loan to an NCR kasambahay is refused at input: the domestic wage order allows no deduction other than those mandated by law.',
		citation: [
			'Wage Order NCR-DW-06 s.3: the wages of the domestic worker shall be paid in cash at least once a month; no deductions shall be made other than those mandated by law (https://nwpc.dole.gov.ph/wp-content/uploads/2026/01/Wage-Order-No.-NCR-DW-06.pdf, read 30 Sep 2026); the same clause in the Region IX, MIMAROPA, X and XI domestic orders (tracker PH-WG38, PH-WG45, PH-WG52)'
		],
		company: company(),
		inputs: [
			...week,
			...hire({
				ref: 'k',
				name: 'Maria Santos',
				gender: 'FEMALE',
				born: '1988-02-11',
				from: '2024-01-08',
				salary: 7800,
				sector: null,
				type: 'DOMESTIC'
			}),
			{
				collection: 'loans',
				values: {
					employment_id: '@k_job',
					loan_catalogue_id: '@law:loan_catalogue:LOAN_RECOVERY_COMPANY',
					principal: 1000,
					reference: 'PROBE-PH-KASAMBAHAY-LOAN',
					effective_range: { from: '2026-07-01', to: '2026-07-31' },
					loan_repayments: {
						create: [{ due_date: '2026-07-31', amount_due: 1000, sequence: 1 }]
					}
				},
				refused: 'LOAN_RECOVERY_COMPANY is not offered to .*eligibility rule does not hold'
			}
		],
		period: '2026-07',
		expected: []
	}
);
