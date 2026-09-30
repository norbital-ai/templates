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

const FULL_30450 = {
	sss: [1000, 2000],
	mpf: [525, 1050],
	ec: 30,
	phic: [761.25, 761.25],
	hdmf: [200, 200],
	wtax: 1069.61
} satisfies Charges;

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
		'Pag-IBIG: 1,500 is "₱1,500 or below" → employee 1% = 15, employer 2% = 30. SSS "Below 5,250" → MSC 5,000: 250 / 500, EC 10. PhilHealth floor 250 / 250. Taxable 1,500 − 515 = 985 → 0. Net 1,500 − 515 = 985; employer cost 500 + 10 + 250 + 30 = 790. A part-timer below the pro-rated floor keeps only a warning (tracker default PH-A3).',
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
			'A joiner on Thursday 16 July 2026 on ₱30,450 is paid the 12 working days worked; SSS reads what was paid, PhilHealth and Pag-IBIG the monthly basic.',
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
				'A ₱20,000 performance bonus in July 2026 on ₱30,450: SSS compensation, not PhilHealth basic or Pag-IBIG fund salary, and wholly inside the ₱90,000 benefits exclusion.',
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
			'SSS IRR Rule 12 s.6(iii): a performance bonus is compensation (tracker PH-SS09); PhilHealth reads the monthly basic salary only; Pag-IBIG fund salary is basic plus allowances and remuneration for services (Circular 460)',
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
					exit_reason: 'REDUNDANCY',
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
					exit_reason: 'RETRENCHMENT',
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
				employment: { exit_reason: 'RETIREMENT' }
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
			'1–2, 5–9, 12–16, 19–20 January = 14 working days: 7,800 × 14 ÷ 21.75 = 5,020.69. SSS "Below 5,250" → MSC 5,000: 250 / 500, EC 10 (the wage is ₱5,000 or more, so the worker shares, s.30). PhilHealth on the ₱10,000 floor 250 / 250. Pag-IBIG on the monthly basic 7,800 × 2% = 156 / 156. Gross 5,020.69 + 5,379.31 = 10,400; net 10,400 − 656 + 418.39 = 10,162.39; employer cost 500 + 10 + 250 + 156 = 916'
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
					exit_reason: 'DISMISSAL',
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
					net: 10_162.39,
					employer_cost: 916,
					KASAMBAHAY_INDEMNITY: 5379.31,
					THIRTEENTH_MONTH_PAY: 418.39,
					...charges({ sss: [250, 500], ec: 10, phic: [250, 250], hdmf: [156, 156] })
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
				}
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
	)
);
