import { officeWeek, register, type ProbeInput, type Row } from '../payroll-probe.ts';

/**
 * MY cases: see the case shape at the top of payroll-probe.ts. Every figure is worked by hand from the
 * instrument cited beside it; `docs/inventory/malaysia.csv` names each case in its `probe` column.
 */

// ── Sources ────────────────────────────────────────────────────────────────────────────────────
const EA =
	'Employment Act 1955 (Act 265), AGC reprint as at 1 August 2023 (https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/1744567_BI/Reprint%20Act%20265%20(Final).pdf)';
const EPF_A =
	'EPF Act 1991 (Act 452) Third Schedule Part A, AGC online text as at 1 July 2022 (https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/1736246_BI/Act%20452%20(Online%202022).pdf); Part A is untouched by Act A1760 s.10, which deletes Parts B and D and inserts Part F (https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/2844030_BI/Act%20A1760-%20EMPLOYEES%20PROVIDED%20FUND%20(AMENDMENT)%20ACT%202025.pdf)';
const EPF_WAGES =
	'EPF Act 1991 s.2 "wages" (same AGC text): includes any bonus, commission or allowance; excludes (b) overtime payment, (e) retrenchment, lay-off or termination benefits and (f) any travelling allowance';
const EPF_F =
	'Act A1760 s.10, Third Schedule Part F: 2% employer and 2% employee of the wages for the month, the total rounded to the next ringgit (https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/2844030_BI/Act%20A1760-%20EMPLOYEES%20PROVIDED%20FUND%20(AMENDMENT)%20ACT%202025.pdf)';
const SOCSO =
	'SOCSO: PERKESO, Employees’ Social Security Act 1969 (Act 4) contribution table including SKBBK (https://www.perkeso.gov.my/images/lindung/lindung-24-jam/NewContributionRateIncludingSKBBK.pdf): First Category employer share and employee Invalidity share, Second Category employer share; the SKBBK non-employment-injury column is levied from the June 2026 contribution month (Act A1788, in operation 1 June 2026 by P.U.(B) 196/2026, https://www.perkeso.gov.my/images/akta/ACT%204/Act_A1788_-_EMPLOYEES_SOCIAL_SECURITY_AMENDMENT_ACT_2026.pdf); RM6,000 wage ceiling from October 2024 (https://www.perkeso.gov.my/en/contribution-rate/)';
const EIS =
	'EIS: Employment Insurance System Act 2017 (Act 800) Second Schedule (https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/1742141_BI/Act%20800%20FINAL.pdf) rows 1–54 to RM5,000, and PERKESO’s Act 800 rate table rows 55–65 for the RM6,000 ceiling from 1 October 2024 (https://www.perkeso.gov.my/images/dokumen/151124-Rate%20Contribution%20ACT%20800.pdf; https://www.perkeso.gov.my/en/contribution-rate/)';
const PCB =
	'PCB: LHDN Specification for Monthly Tax Deduction (MTD) Calculations Using Computerised Calculation for 2026 (https://www.hasil.gov.my/wp-content/uploads/spesifikasi-kaedah-pengiraan-berkomputer-pcb-2026.pdf): D(b)(1) MTD = [(P − M)R + B − (Z + X)] / (n + 1), P = Σ(Y − K) + (Y1 − K1) + (Y2 − K2)n + (Yt − Kt) − (D + S + QC + LP), K2 = lower of K1 and [4,000 − (K + K1 + Kt)] / n; Table 1 (M, R, B); E(1) figures truncated to the sen; E(2) rounded up to the next five sen; E(3) under RM10 is not deducted; E(14)(i) D = RM9,000 personal relief, SOCSO/EIS relief only by Form TP1 claim';
const HRD =
	'HRD: Pembangunan Sumber Manusia Berhad Act 2001 (Act 612), AGC reprint 2017 (https://lom.agc.gov.my/ilims/upload/portal/akta/LOM/EN/Act%20612%20-%20Reprint%202017.pdf): s.2 "employee" is a citizen of Malaysia; s.2 "wages" is basic salary and fixed allowances (not bonus, commission or overtime); s.14(1) levy 1% of monthly wages; s.15(2) 0.5% for an employer who opts to register; s.15(4)–(5) 1% once the count exceeds the class maximum, kept to the end of that year';
const TLB =
	'Employment (Termination and Lay-Off Benefits) Regulations 1980 reg.6(1)–(2) (https://jtksm.mohr.gov.my/sites/default/files/2023-03/8.%20EMPLOYMENT%20%28TERMINATION%20%26%20LAY%20OFF%20BENEFITS%29%20REGULATIONS%201980_0.pdf): 10/15/20 days’ wages per year of service (under 2 / 2 to under 5 / 5 or more years), an incomplete year pro rata to the nearest month, a day’s wages the average true day’s wages over the twelve completed months before the relevant date; JTKSM’s formula divides the twelve months’ wages by 365 (https://jtksm.mohr.gov.my/en/frequently-asked-questions/employees-retrenchment/how-termination-benefit-payment-calculated-and)';
const ITA_SCH6 =
	'Income Tax Act 1967 (Act 53) Schedule 6, AGC online text as at 1 January 2026 (https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/3345910_BI/Act%2053%20(Online%202026).pdf)';

/** A Part I company below every Act 612 threshold: no HRD levy. */
const NO_HRD = {
	facts: {
		hrd_scope: 'PART_I',
		hrd_registration_class: 'NOT_REGISTERED',
		hrd_form2_count: 0,
		hrd_education_schedule_code: 'NONE'
	}
};
const hrd = (registration: string, count: number, extra: Row = {}) => ({
	facts: {
		hrd_scope: 'PART_I',
		hrd_registration_class: registration,
		hrd_form2_count: count,
		hrd_education_schedule_code: 'NONE',
		...extra
	}
});

type Standing = 'CITIZEN' | 'PERMANENT_RESIDENT' | 'FOREIGNER';
type Hire = {
	ref: string;
	name: string;
	born: string;
	standing: Standing;
	salary: number;
	/** First day of service; last day of work when the stint has ended. */
	from: string;
	to?: string;
	gender?: 'MALE' | 'FEMALE';
	nationality?: string;
	tax?: 'RESIDENT' | 'NON_RESIDENT';
	state?: string;
	category?: string;
	type?: string;
	pattern?: string;
	/** Scheme registrations; default EPF, SOCSO and EIS. */
	schemes?: readonly string[];
	/** Extra fields for the PCB registration (TP1/TP3 declarations, zakat). */
	pcb?: Row;
	/** Extra fields for the EPF registration (TP3 opening). */
	epf?: Row;
	person?: Row;
	employment?: Row;
	terms?: Row;
};

/** One person, one contract, its terms and its scheme registrations, each through its own `/act`. */
const hire = (h: Hire): ProbeInput[] => {
	const job = `${h.ref}_job`;
	const until = h.to ?? null;
	const foreign = h.standing === 'FOREIGNER';
	const elections = (code: string): Row =>
		code === 'EPF' && foreign
			? // EPF Act 1991 Third Schedule, as amended by A1760 s.11: a non-citizen stays on Part A only as a pre-1 August 1998 elector
				{ member_before_1998: false }
			: code === 'EIS' && foreign
				? // Act 800 First Schedule para 10: the employer's declaration that this non-citizen holds no MyKAS
					{ mykas_resident: false }
				: {};
	const fact = (code: string, extra: Row = {}): ProbeInput => ({
		collection: 'employment_statutory_facts',
		values: {
			employee_id: `@${h.ref}`,
			employment_id: `@${job}`,
			statutory_contribution_id: `@law:statutory_contributions:${code}`,
			effective_range: { from: h.from, to: until },
			status: {
				kind: 'REGISTERED',
				reference_number: `PROBE-${code}`,
				elections: elections(code),
				...extra
			}
		}
	});
	return [
		{
			collection: 'employees',
			ref: h.ref,
			values: {
				name: h.name,
				date_of_birth: h.born,
				gender: h.gender ?? 'MALE',
				nationality: h.nationality ?? (foreign ? 'Indonesian' : 'Malaysian'),
				marital_status: 'SINGLE',
				spouse_status: 'NONE',
				...h.person
			}
		},
		{
			collection: 'employments',
			ref: job,
			values: {
				employee_id: `@${h.ref}`,
				company_id: '@company',
				employee_number: h.ref.toUpperCase(),
				effective_range: { from: h.from, to: until },
				...h.employment
			}
		},
		{
			collection: 'employment_terms',
			values: {
				employment_id: `@${job}`,
				residency_status: h.standing,
				tax_residency: h.tax ?? (foreign ? 'NON_RESIDENT' : 'RESIDENT'),
				currency: 'MYR',
				base_salary: h.salary,
				pay_frequency: 'MONTHLY',
				work_classification: 'EA_COVERED',
				statutory_work_category: h.category ?? 'NON_MANUAL',
				employment_type: h.type ?? 'PERMANENT',
				facts: { worksite_state: h.state ?? 'SELANGOR' },
				shift_pattern_id: h.pattern ?? '@week',
				effective_range: { from: h.from, to: until },
				...h.terms
			}
		},
		...(h.schemes ?? ['EPF', 'SOCSO', 'EIS']).map((code) =>
			fact(code, code === 'EPF' ? (h.epf ?? {}) : {})
		),
		...(h.pcb == null ? [] : [fact('PCB', h.pcb)])
	];
};

/**
 * A work day's attendance, each `[start, end]` in the +08:00 frame; the gaps are the breaks. `approved` is the
 * overtime, rest-day or holiday hours the employer asked for (s.60A(3), s.60(3), s.60D(3)): the run pays only those.
 */
const worked = (
	job: string,
	date: string,
	spans: readonly (readonly [string, string])[],
	approved = 0
) => ({
	collection: 'work_days',
	values: {
		employment_id: `@${job}`,
		work_date: date,
		worked_intervals: spans.map(([start, end]) => ({
			start: `${date}T${start}:00+08:00`,
			end: `${date}T${end}:00+08:00`
		})),
		...(approved > 0 ? { approved_overtime_hours: approved } : {})
	}
});
/** A published company holiday. */
const holiday = (date: string, name: string): ProbeInput => ({
	collection: 'jurisdiction_holidays',
	values: {
		company_id: '@company',
		date,
		name,
		kind: 'PUBLIC_HOLIDAY',
		source: 'probe',
		published_at: '2025-12-01T00:00:00.000Z'
	}
});
/** A one-off payment by its catalogue code; a SEPARATION class prices itself (`amount` 0, as the exit automation raises it). */
const adhoc = (job: string, code: string, amount: number, date: string, period: string) => ({
	collection: 'adhoc_requests',
	values: {
		employment_id: `@${job}`,
		catalogue_id: `@law:adhoc_catalogue:${code}`,
		amount,
		event_date: date,
		pay_period: period,
		reason: `probe ${code}`
	}
});

/** A citizen's full January 2026 month on `salary` through the default schemes. */
const citizen = (ref: string, name: string, salary: number, extra: Partial<Hire> = {}) =>
	hire({
		ref,
		name,
		born: '1990-05-01',
		standing: 'CITIZEN',
		salary,
		from: '2024-01-02',
		...extra
	});

register(
	// ── EPF Part F: the harness's first case, unchanged ────────────────────────────────────────
	{
		id: 'MY-EPF-03-1',
		profile: 'MY',
		description:
			'A non-citizen, non-resident office worker on RM3,000 a month, the whole of February 2026 worked: EPF Part F at 2% each, SOCSO First Category (employment injury and invalidity, before SKBBK on 1 June 2026), no EIS, MTD at the flat 30%, no HRD levy on a non-Malaysian.',
		citation: [
			'EPF: Employees Provident Fund (Amendment) Act 2025 (Act A1760) s.10, Third Schedule Part F — employer 2% and employee 2% of the wages for the month, total rounded to the next ringgit: RM3,000 → RM60 + RM60 (https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/2844030_BI/Act%20A1760-%20EMPLOYEES%20PROVIDED%20FUND%20(AMENDMENT)%20ACT%202025.pdf); in force for October 2025 wages (KWSP, EPF Act 1991 Third Schedule page, "Effective 1 October 2025", archived 2026-01-08: https://web.archive.org/web/20260108064119/https://www.kwsp.gov.my/en/epf-act-1991-third-schedule)',
			'SOCSO: Employees Social Security Act 1969 Third Schedule as printed by PERKESO (Jadual Caruman Akta 4, row 34, wages above RM2,900 not above RM3,000): First Category employer RM51.65, employee invalidity share RM14.75; the SKBBK non-work-accident column is not yet due (https://www.perkeso.gov.my/images/lindung/lindung-24-jam/JadualCarumanBaharuTermasukSKBBK.pdf). Foreign workers: employment injury from 1 January 2019, invalidity from 1 July 2024, SKBBK from 1 June 2026, so February 2026 is First Category without SKBBK (https://www.perkeso.gov.my/perkhidmatan-kami/perlindungan/pekerja-asing.html)',
			'EIS: Employment Insurance System Act 2017 (Act 800) First Schedule para 10 — "Any foreign employee" is outside the Act, save a permanent resident or a twelve-month resident holding a para 5(3) identity card: no charge (https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/1742141_BI/Act%20800%20FINAL.pdf)',
			'PCB: LHDN Specification for Monthly Tax Deduction (MTD) 2026, section D(a) — a non-resident employee is deducted 30% of remuneration: RM3,000 × 30% = RM900 (https://www.hasil.gov.my/wp-content/uploads/spesifikasi-kaedah-pengiraan-berkomputer-pcb-2026.pdf)',
			'HRDF: Pembangunan Sumber Manusia Berhad Act 2001 (Act 612) s.2 — "employee" means any citizen of Malaysia employed for wages: no levy on a non-citizen (https://lom.agc.gov.my/ilims/upload/portal/akta/LOM/EN/Act%20612%20-%20Reprint%202017.pdf)',
			'Net: 3,000 − 60 (EPF) − 14.75 (SOCSO) − 900 (PCB) = RM2,025.25; employer cost 60 + 51.65 = RM111.65'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2025-06-02'),
			...hire({
				ref: 'rahim',
				name: 'Rahim Uddin',
				born: '1994-03-14',
				nationality: 'Bangladeshi',
				standing: 'FOREIGNER',
				salary: 3000,
				from: '2025-06-02',
				schemes: ['EPF', 'SOCSO', 'EIS']
			})
		],
		period: '2026-02',
		expected: [
			{
				employment: 'rahim_job',
				lines: {
					gross: 3000,
					net: 2025.25,
					employer_cost: 111.65,
					BASIC: 3000,
					'EPF_NON_CITIZEN.employee': 60,
					'EPF_NON_CITIZEN.employer': 60,
					'SOCSO.employee': 14.75,
					'SOCSO.employer': 51.65,
					'PCB.employee': 900
				}
			}
		]
	},

	// ── Full month, resident MTD, every scheme inside its table ───────────────────────────────────
	{
		id: 'MY-EPF-01-1',
		profile: 'MY',
		description:
			'A citizen aged 35 on RM5,000, the whole of January 2026 worked in Selangor: EPF Part A top table row, SOCSO and EIS rows 54, resident MTD on normal remuneration.',
		citation: [
			`${EPF_A}: row "4,980.01 to 5,000.00" employer RM650, employee RM550`,
			`${SOCSO}: row 54 (exceeding RM4,900, not RM5,000) employer RM86.65, employee RM24.75`,
			`${EIS}: row 54 (exceeding RM4,900, not RM5,000) RM9.90 each`,
			`${PCB}. January, n = 11, single (category 1). K1 = 550; K2 = lower of 550 and (4,000 − 550)/11 = 313.636 → 313.63. P = 4,450 + (5,000 − 313.63) × 11 − 9,000 = 47,000.07; row 35,001–50,000: (12,000.07 × 6% = 720.0042 → 720.00 + 600) / 12 = 110.00`,
			`${EA} s.18 and s.60D(1): a monthly wage period; the Peninsular worksite brings the Act (s.1(2))`,
			'Net: 5,000 − 550 − 24.75 − 9.90 − 110 = 4,305.35; employer cost 650 + 86.65 + 9.90 = 746.55'
		],
		company: NO_HRD,
		inputs: [...officeWeek('2024-01-01'), ...citizen('aisyah', 'Nur Aisyah Ahmad', 5000)],
		period: '2026-01',
		expected: [
			{
				employment: 'aisyah_job',
				lines: {
					gross: 5000,
					net: 4305.35,
					employer_cost: 746.55,
					BASIC: 5000,
					'EPF.employee': 550,
					'EPF.employer': 650,
					'SOCSO.employee': 24.75,
					'SOCSO.employer': 86.65,
					'EIS.employee': 9.9,
					'EIS.employer': 9.9,
					'PCB.employee': 110
				}
			}
		]
	},

	// ── Ceilings: EPF above the RM5,000 rows, SOCSO and EIS at RM6,000, MTD in the 19% band ─────────
	{
		id: 'MY-EPF-01-2',
		profile: 'MY',
		description:
			'A citizen on RM8,000 in January 2026: EPF at 12% employer on the hundred-ringgit rows, SOCSO and EIS capped at the RM6,000 ceiling row 65, MTD in the 19% band.',
		citation: [
			`${EPF_A}: row "7,900.01 to 8,000.00" employer RM960, employee RM880`,
			`${SOCSO}: row 65 (exceeding RM6,000) employer RM104.15, employee RM29.75`,
			`${EIS}: row 65 (exceeding RM6,000) RM11.90 each`,
			`${PCB}. K1 = 880; K2 = lower of 880 and 3,120/11 = 283.636 → 283.63. P = 7,120 + 7,716.37 × 11 − 9,000 = 83,000.07; row 70,001–100,000: 13,000.07 × 19% = 2,470.0133 → 2,470.01; + 3,700 = 6,170.01; / 12 = 514.1675 → 514.16 → 514.20`,
			'Net: 8,000 − 880 − 29.75 − 11.90 − 514.20 = 6,564.15; employer cost 960 + 104.15 + 11.90 = 1,076.05'
		],
		company: NO_HRD,
		inputs: [...officeWeek('2024-01-01'), ...citizen('danial', 'Danial Hakim', 8000)],
		period: '2026-01',
		expected: [
			{
				employment: 'danial_job',
				lines: {
					gross: 8000,
					net: 6564.15,
					employer_cost: 1076.05,
					'EPF.employee': 880,
					'EPF.employer': 960,
					'SOCSO.employee': 29.75,
					'SOCSO.employer': 104.15,
					'EIS.employee': 11.9,
					'EIS.employer': 11.9,
					'PCB.employee': 514.2
				}
			}
		]
	},

	// ── A band seam: one sen either side of RM3,000 ──────────────────────────────────────────────
	{
		id: 'MY-EPF-01-3',
		profile: 'MY',
		description:
			'Two citizens in January 2026, on RM3,000.00 and RM3,000.01: the sen moves EPF, SOCSO and EIS each one row up.',
		citation: [
			`${EPF_A}: "2,980.01 to 3,000.00" employer RM390, employee RM330; "3,000.01 to 3,020.00" employer RM393, employee RM333`,
			`${SOCSO}: row 34 (exceeding RM2,900, not RM3,000) employer RM51.65, employee RM14.75; row 35 (exceeding RM3,000, not RM3,100) employer RM53.35, employee RM15.25`,
			`${EIS}: row 34 RM5.90 each; row 35 RM6.10 each`,
			`${PCB}. RM3,000: K2 = 330; P = 2,670 × 12 − 9,000 = 23,040; row 20,001–35,000: 3,040 × 3% − 250 < 0, no MTD. RM3,000.01: K2 = 333, P = 23,004.12, likewise none`,
			'Net: 3,000 − 330 − 14.75 − 5.90 = 2,649.35 (employer 447.55); 3,000.01 − 333 − 15.25 − 6.10 = 2,645.66 (employer 393 + 53.35 + 6.10 = 452.45)'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('seam_low', 'Siti Low', 3000),
			...citizen('seam_high', 'Siti High', 3000.01)
		],
		period: '2026-01',
		expected: [
			{
				employment: 'seam_low_job',
				lines: {
					gross: 3000,
					net: 2649.35,
					employer_cost: 447.55,
					'EPF.employee': 330,
					'EPF.employer': 390,
					'SOCSO.employee': 14.75,
					'SOCSO.employer': 51.65,
					'EIS.employee': 5.9,
					'EIS.employer': 5.9
				}
			},
			{
				employment: 'seam_high_job',
				lines: {
					gross: 3000.01,
					net: 2645.66,
					employer_cost: 452.45,
					'EPF.employee': 333,
					'EPF.employer': 393,
					'SOCSO.employee': 15.25,
					'SOCSO.employer': 53.35,
					'EIS.employee': 6.1,
					'EIS.employer': 6.1
				}
			}
		]
	},

	// ── MTD rounding and the RM10 floor ──────────────────────────────────────────────────────────
	{
		id: 'MY-PCB-01-1',
		profile: 'MY',
		description:
			'Two citizens in January 2026: RM3,700 computes RM7.70 of MTD, which is under RM10 and not deducted; RM3,900 computes 13.666, truncated to 13.66 and rounded up to 13.70.',
		citation: [
			`${EPF_A}: "3,680.01 to 3,700.00" employee RM407, employer RM481; "3,880.01 to 3,900.00" employee RM429, employer RM507`,
			`${SOCSO}: row 41 (RM3,600–3,700) RM63.85 / RM18.25; row 43 (RM3,800–3,900) RM67.35 / RM19.25`,
			`${EIS}: row 41 RM7.30; row 43 RM7.70`,
			`${PCB}. RM3,700: K2 = lower of 407 and 3,593/11 = 326.63; P = 3,293 + 3,373.37 × 11 − 9,000 = 31,400.07; 11,400.07 × 3% = 342.00 − 250 = 92.00 / 12 = 7.666 → 7.66 → 7.70, under RM10 (E(3)): nil. RM3,900: K2 = 3,571/11 = 324.63; P = 3,471 + 3,575.37 × 11 − 9,000 = 33,800.07; 13,800.07 × 3% = 414.00 − 250 = 164 / 12 = 13.666 → 13.66 → 13.70`,
			'Net: 3,700 − 407 − 18.25 − 7.30 = 3,267.45 (employer 481 + 63.85 + 7.30 = 552.15); 3,900 − 429 − 19.25 − 7.70 − 13.70 = 3,430.35 (employer 507 + 67.35 + 7.70 = 582.05)'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('below_ten', 'Farid Below', 3700),
			...citizen('above_ten', 'Farah Above', 3900)
		],
		period: '2026-01',
		expected: [
			{
				employment: 'below_ten_job',
				lines: {
					gross: 3700,
					net: 3267.45,
					employer_cost: 552.15,
					'EPF.employee': 407,
					'EPF.employer': 481,
					'SOCSO.employee': 18.25,
					'SOCSO.employer': 63.85,
					'EIS.employee': 7.3,
					'EIS.employer': 7.3,
					'PCB.employee': 0
				}
			},
			{
				employment: 'above_ten_job',
				lines: {
					gross: 3900,
					net: 3430.35,
					employer_cost: 582.05,
					'EPF.employee': 429,
					'EPF.employer': 507,
					'SOCSO.employee': 19.25,
					'SOCSO.employer': 67.35,
					'EIS.employee': 7.7,
					'EIS.employer': 7.7,
					'PCB.employee': 13.7
				}
			}
		]
	},

	// ── The minimum wage and the low rows ────────────────────────────────────────────────────────
	{
		id: 'MY-NAT-01-1',
		profile: 'MY',
		description:
			'A citizen on exactly the RM1,700 monthly minimum wage in January 2026: paid in full, EPF, SOCSO and EIS on their low rows, no MTD.',
		citation: [
			'Minimum Wages Order 2024, P.U.(A) 376/2024 para 3(1), in force 1 February 2025 (1 August 2025 for employers with fewer than five employees): RM1,700 a month (https://gajiminimum.mohr.gov.my/wp-content/uploads/PUA%20376.pdf)',
			`${EPF_A}: "1,680.01 to 1,700.00" employer RM221, employee RM187`,
			`${SOCSO}: row 21 (RM1,600–1,700) employer RM28.85, employee RM8.25`,
			`${EIS}: row 21 RM3.30 each`,
			`${PCB}: P = (1,700 − 187) × 12 − 9,000 = 9,156; 4,156 × 1% − 400 < 0, no MTD`,
			'Net: 1,700 − 187 − 8.25 − 3.30 = 1,501.45; employer cost 221 + 28.85 + 3.30 = 253.15'
		],
		company: NO_HRD,
		inputs: [...officeWeek('2024-01-01'), ...citizen('minwage', 'Azman Minimum', 1700)],
		period: '2026-01',
		expected: [
			{
				employment: 'minwage_job',
				lines: {
					gross: 1700,
					net: 1501.45,
					employer_cost: 253.15,
					BASIC: 1700,
					'EPF.employee': 187,
					'EPF.employer': 221,
					'SOCSO.employee': 8.25,
					'SOCSO.employer': 28.85,
					'EIS.employee': 3.3,
					'EIS.employer': 3.3
				}
			}
		]
	},

	// ── Age 60 and above: EPF Part E, SOCSO Second Category, no EIS ───────────────────────────────
	{
		id: 'MY-EPF-01-4',
		profile: 'MY',
		description:
			'A citizen aged 61 on RM4,000 in January 2026: EPF Part E (employer 4%, employee nil), SOCSO Second Category (employment injury, employer only), no EIS from sixty, resident MTD with no EPF relief.',
		citation: [
			`${EPF_A.replace('Part A', 'Part E (Malaysian citizens who have attained sixty)')}: "3,980.01 to 4,000.00" employer RM160, employee nil`,
			`${SOCSO}: row 44 (RM3,900–4,000) Second Category employer RM49.40, no employee share (Act 4 First Schedule para 12: an employee who has attained sixty is insured for employment injury only)`,
			'EIS: Act 800 First Schedule (https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/1742141_BI/Act%20800%20FINAL.pdf): an employee who has attained sixty is outside the Act: no charge',
			`${PCB}: K1 = K2 = 0; P = 4,000 × 12 − 9,000 = 39,000; (4,000 × 6% + 600) / 12 = 70.00`,
			'Net: 4,000 − 70 = 3,930; employer cost 160 + 49.40 = 209.40'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('senior', 'Lim Ah Kow', 4000, { born: '1964-08-10' })
		],
		period: '2026-01',
		expected: [
			{
				employment: 'senior_job',
				lines: {
					gross: 4000,
					net: 3930,
					employer_cost: 209.4,
					'EPF.employee': 0,
					'EPF.employer': 160,
					'SOCSO.employee': 0,
					'SOCSO.employer': 49.4,
					'PCB.employee': 70
				}
			}
		]
	},

	// ── Age 75 and above, and rest-day work ──────────────────────────────────────────────────────
	{
		id: 'MY-EPF-01-5',
		profile: 'MY',
		description:
			'A citizen aged 76 on RM2,600 who works three Sundays in January 2026: no EPF at 75 or over, SOCSO Second Category on the rest-day pay too, and s.60(3)(b) and (c) rest-day pay at the s.60I ordinary rate (RM100 a day, RM12.50 an hour).',
		citation: [
			'EPF: KWSP, Employer mandatory contribution: employees aged 14 to under 75 contribute (https://web.archive.org/web/20260810072920/https://www.kwsp.gov.my/en/employer/responsibilities/mandatory-contribution); EPF Act 1991 First Schedule para 13 (AGC text as at 1 July 2022) excludes a person who has attained seventy-five: no EPF',
			`${EA} s.60I(1)(a), (1A), (1)(b): ordinary rate 2,600 / 26 = 100.00, hourly 100 / 8 = 12.50 (the contract's 09:00–18:00 day less its hour). s.59(1): of the Saturday off and the Sunday rest, the Sunday is the rest day. s.60(3)(b)(i): 11 Jan, 4 hours (not over half the normal hours), half a day's wages = 50.00; s.60(3)(b)(ii): 18 Jan, 8 hours, one day's wages = 100.00; 25 Jan, 10 hours: one day's wages for the first 8 = 100.00 and s.60(3)(c) 2 × 12.50 × 2 = 50.00. Total 300.00`,
			`${SOCSO}: Act 4 wages include payment for work on rest days and overtime; RM2,900 is row 33 (RM2,800–2,900): Second Category employer RM35.60`,
			'EIS: none from sixty (Act 800 First Schedule)',
			`${PCB}: P = 2,900 × 12 − 9,000 = 25,800; 5,800 × 3% − 250 < 0, no MTD`,
			'Net: 2,900; employer cost 35.60'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('elder', 'Tan Boon Huat', 2600, { born: '1949-11-20' }),
			worked('elder_job', '2026-01-11', [['09:00', '13:00']], 4),
			worked(
				'elder_job',
				'2026-01-18',
				[
					['09:00', '13:00'],
					['14:00', '18:00']
				],
				8
			),
			worked(
				'elder_job',
				'2026-01-25',
				[
					['08:00', '12:00'],
					['13:00', '17:00'],
					['17:30', '19:30']
				],
				10
			)
		],
		period: '2026-01',
		expected: [
			{
				employment: 'elder_job',
				lines: {
					gross: 2900,
					net: 2900,
					employer_cost: 35.6,
					BASIC: 2600,
					'SOCSO.employee': 0,
					'SOCSO.employer': 35.6
				}
			}
		]
	},

	// ── A bonus month, resident ──────────────────────────────────────────────────────────────────
	{
		id: 'MY-WAGEBASE-01-1',
		profile: 'MY',
		description:
			'A citizen on RM4,200 paid an RM8,000 annual bonus in January 2026: EPF on the whole RM12,200 with the Part A bonus note (employer 13%), SOCSO and EIS on the salary alone, MTD by the additional-remuneration steps.',
		citation: [
			`${EPF_A}: "12,100.01 to 12,200.00" employee RM1,342; the Part A note: where a bonus takes the wages of an employee on RM5,000 or less above RM5,000, the employer pays 13% of the wages for the month = 1,586.00. ${EPF_WAGES}`,
			`${SOCSO}; Act 4 s.2(24)(e) excludes an annual bonus: base 4,200, row 46 (RM4,100–4,200) RM72.65 / RM20.75`,
			`${EIS}; Act 800 s.2 "wages" (e) excludes any annual bonus: row 46 RM8.30 each`,
			`${PCB}, D(b)(2) additional remuneration. K1 = 462 (EPF on 4,200), Kt = 1,342 − 462 = 880. Step 1: K2 = lower of 462 and 3,538/11 = 321.63; P = 3,738 + 3,878.37 × 11 − 9,000 = 37,400.07; (2,400.07 × 6% = 144.00 + 600) / 12 = 62.00; year 62 × 12 = 744.00. Step 2: K2 = (4,000 − 462 − 880)/11 = 241.63; P = 3,738 + 3,958.37 × 11 + (8,000 − 880) − 9,000 = 45,400.07. Step 3: 10,400.07 × 6% = 624.00 + 600 = 1,224.00. Step 4: 1,224.00 − 744.00 = 480.00. Step 5: 62.00 + 480.00 = 542.00`,
			'HRD: none (company below the Act 612 thresholds); Act 612 s.2 "wages" (e) excludes any bonus in any case',
			'Net: 12,200 − 1,342 − 20.75 − 8.30 − 542 = 10,286.95; employer cost 1,586 + 72.65 + 8.30 = 1,666.95'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('bonus', 'Hafiz Bonus', 4200),
			adhoc('bonus_job', 'BONUS', 8000, '2026-01-20', '2026-01')
		],
		period: '2026-01',
		expected: [
			{
				employment: 'bonus_job',
				lines: {
					gross: 12200,
					net: 10286.95,
					employer_cost: 1666.95,
					BASIC: 4200,
					BONUS: 8000,
					'EPF.employee': 1342,
					'EPF.employer': 1586,
					'SOCSO.employee': 20.75,
					'SOCSO.employer': 72.65,
					'EIS.employee': 8.3,
					'EIS.employer': 8.3,
					'PCB.employee': 542
				}
			}
		]
	},

	// ── A bonus month, non-resident ──────────────────────────────────────────────────────────────
	{
		id: 'MY-EPF-03-2',
		profile: 'MY',
		description:
			'A non-resident non-citizen on RM3,000 paid a RM1,000 bonus in January 2026: Part F on both, SOCSO on the salary alone, MTD 30% of the whole remuneration.',
		citation: [
			`${EPF_F}: 2% × 4,000 = 80 each, total 160 (a whole ringgit). ${EPF_WAGES}`,
			`${SOCSO}: row 34 on the salary (Act 4 s.2(24)(e) excludes an annual bonus): RM51.65 / RM14.75; foreign workers are First Category from 1 July 2024 (https://www.perkeso.gov.my/perkhidmatan-kami/perlindungan/pekerja-asing.html)`,
			'EIS: Act 800 First Schedule para 10: no foreign employee',
			`${PCB}, D(a): 30% of remuneration, bonus included: 4,000 × 30% = 1,200.00`,
			'Net: 4,000 − 80 − 14.75 − 1,200 = 2,705.25; employer cost 80 + 51.65 = 131.65'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...hire({
				ref: 'budi',
				name: 'Budi Santoso',
				born: '1992-07-07',
				standing: 'FOREIGNER',
				salary: 3000,
				from: '2024-01-02'
			}),
			adhoc('budi_job', 'BONUS', 1000, '2026-01-20', '2026-01')
		],
		period: '2026-01',
		expected: [
			{
				employment: 'budi_job',
				lines: {
					gross: 4000,
					net: 2705.25,
					employer_cost: 131.65,
					BONUS: 1000,
					'EPF_NON_CITIZEN.employee': 80,
					'EPF_NON_CITIZEN.employer': 80,
					'SOCSO.employee': 14.75,
					'SOCSO.employer': 51.65,
					'PCB.employee': 1200
				}
			}
		]
	},

	// ── SKBBK from June 2026, citizen and non-citizen ─────────────────────────────────────────────
	{
		id: 'MY-SKBBK-01-1',
		profile: 'MY',
		description:
			'Two joiners on 1 June 2026, the first SKBBK contribution month: a citizen on RM4,000 (resident MTD over the seven months left, nil) and a non-resident foreign worker on RM3,000 (Part F, 30% MTD); each pays the SKBBK employee share, the employer none.',
		citation: [
			`${SOCSO}: row 44 (RM3,900–4,000) employer RM69.15, Invalidity RM19.75, SKBBK RM29.65; row 34 (RM2,900–3,000) employer RM51.65, Invalidity RM14.75, SKBBK RM22.15. SKBBK is mandatory for non-citizens and, before any accepted release, for citizens (PERKESO LINDUNG 24 Jam, https://www.perkeso.gov.my/skim-kemalangan-bukan-bencana-kerja-lindung-24-jam.html)`,
			`${EPF_A}: "3,980.01 to 4,000.00" RM520 / RM440; ${EPF_F}: 60 + 60`,
			`${EIS}: row 44 RM7.90 each for the citizen; none for the foreign worker (Act 800 First Schedule para 10)`,
			`${PCB}. Citizen: joined in June, n = 6: K2 = lower of 440 and 3,560/6; P = 3,560 × 7 − 9,000 = 15,920; 10,920 × 1% − 400 < 0, nil. Foreign worker, D(a): 3,000 × 30% = 900`,
			'Net: 4,000 − 440 − 19.75 − 29.65 − 7.90 = 3,502.70 (employer 520 + 69.15 + 7.90 = 597.05); 3,000 − 60 − 14.75 − 22.15 − 900 = 2,003.10 (employer 60 + 51.65 = 111.65)'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2026-06-01'),
			...hire({
				ref: 'june_local',
				name: 'Mei Ling June',
				born: '1995-02-02',
				gender: 'FEMALE',
				standing: 'CITIZEN',
				salary: 4000,
				from: '2026-06-01',
				schemes: ['EPF', 'SOCSO', 'SKBBK', 'EIS']
			}),
			...hire({
				ref: 'june_foreign',
				name: 'Ram Bahadur',
				born: '1993-09-09',
				nationality: 'Nepali',
				standing: 'FOREIGNER',
				salary: 3000,
				from: '2026-06-01',
				schemes: ['EPF', 'SOCSO', 'SKBBK', 'EIS']
			})
		],
		period: '2026-06',
		expected: [
			{
				employment: 'june_local_job',
				lines: {
					gross: 4000,
					net: 3502.7,
					employer_cost: 597.05,
					'EPF.employee': 440,
					'EPF.employer': 520,
					'SOCSO.employee': 19.75,
					'SOCSO.employer': 69.15,
					'SKBBK.employee': 29.65,
					'SKBBK.employer': 0,
					'EIS.employee': 7.9,
					'EIS.employer': 7.9,
					'PCB.employee': 0
				}
			},
			{
				employment: 'june_foreign_job',
				lines: {
					gross: 3000,
					net: 2003.1,
					employer_cost: 111.65,
					'EPF_NON_CITIZEN.employee': 60,
					'EPF_NON_CITIZEN.employer': 60,
					'SOCSO.employee': 14.75,
					'SOCSO.employer': 51.65,
					'SKBBK.employee': 22.15,
					'SKBBK.employer': 0,
					'PCB.employee': 900
				}
			}
		]
	},

	// ── s.18A(a): a mid-month joiner ─────────────────────────────────────────────────────────────
	{
		id: 'MY-EA11-1',
		profile: 'MY',
		description:
			'A citizen joins on Tuesday 20 January 2026 on RM3,100: s.18A(a) pays 12 of the month’s 31 days, and every scheme is on what was paid.',
		citation: [
			`${EA} s.18A(a): monthly wages / days of the wage period × days eligible = 3,100 / 31 × 12 = 1,200.00`,
			`${EPF_A}: "1,180.01 to 1,200.00" employer RM156, employee RM132`,
			`${SOCSO}: row 16 (RM1,100–1,200) RM20.15 / RM5.75`,
			`${EIS}: row 16 RM2.30 each`,
			`${PCB}: P = (1,200 − 132) × 12 − 9,000 = 3,816, under RM5,000: nil`,
			'Net: 1,200 − 132 − 5.75 − 2.30 = 1,059.95; employer cost 156 + 20.15 + 2.30 = 178.45'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('joiner', 'Joanne Tan', 3100, { from: '2026-01-20' })
		],
		period: '2026-01',
		expected: [
			{
				employment: 'joiner_job',
				lines: {
					gross: 1200,
					net: 1059.95,
					employer_cost: 178.45,
					BASIC: 1200,
					'EPF.employee': 132,
					'EPF.employer': 156,
					'SOCSO.employee': 5.75,
					'SOCSO.employer': 20.15,
					'EIS.employee': 2.3,
					'EIS.employer': 2.3
				}
			}
		]
	},

	// ── s.18A(c): unpaid leave ───────────────────────────────────────────────────────────────────
	{
		id: 'MY-EA11-2',
		profile: 'MY',
		description:
			'A citizen on RM3,500 takes two days of unpaid leave (Thursday 22 and Friday 23 January 2026): s.18A(c) pays 29 of the 31 days.',
		citation: [
			`${EA} s.18A(c): 3,500 / 31 × 29 = 3,274.1935 → 3,274.19`,
			`${EPF_A}: "3,260.01 to 3,280.00" employer RM427, employee RM361`,
			`${SOCSO}: row 37 (RM3,200–3,300) RM56.85 / RM16.25`,
			`${EIS}: row 37 RM6.50 each`,
			`${PCB}: K2 = lower of 361 and 3,639/11 = 330.81; P = 2,913.19 + 2,943.38 × 11 − 9,000 = 26,290.37; 6,290.37 × 3% − 250 < 0, nil`,
			'Net: 3,274.19 − 361 − 16.25 − 6.50 = 2,890.44; employer cost 427 + 56.85 + 6.50 = 490.35'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('unpaid', 'Kumar Unpaid', 3500),
			{
				collection: 'leave_entries',
				values: {
					employment_id: '@unpaid_job',
					catalogue_id: '@law:leave_catalogue:UNPAID_LEAVE',
					reference: 'PROBE-NPL-2026-01',
					from_date: '2026-01-22',
					to_date: '2026-01-23',
					half_day_start: false,
					half_day_end: false,
					reason: 'Unpaid leave at the employee’s request'
				}
			}
		],
		period: '2026-01',
		expected: [
			{
				employment: 'unpaid_job',
				lines: {
					gross: 3274.19,
					net: 2890.44,
					employer_cost: 490.35,
					'EPF.employee': 361,
					'EPF.employer': 427,
					'SOCSO.employee': 16.25,
					'SOCSO.employer': 56.85,
					'EIS.employee': 6.5,
					'EIS.employer': 6.5
				}
			}
		]
	},

	// ── A mid-month rate change ──────────────────────────────────────────────────────────────────
	{
		id: 'MY-EA11-3',
		profile: 'MY',
		description:
			'A citizen’s salary rises from RM2,600 to RM3,100 on 15 January 2026: each rate over its own calendar days, the month rounded once.',
		citation: [
			`${EA} s.18A: no Malaysian instrument prescribes a formula for a rate change inside a month; the tracker's recorded default (docs/inventory/malaysia.csv MY-EA11) applies s.18A's calendar-day method to each rate: 2,600 × 14/31 + 3,100 × 17/31 = 89,100/31 = 2,874.1935 → 2,874.19`,
			`${EPF_A}: "2,860.01 to 2,880.00" employer RM375, employee RM317`,
			`${SOCSO}: row 33 (RM2,800–2,900) RM49.85 / RM14.25`,
			`${EIS}: row 33 RM5.70 each`,
			`${PCB}: P = 21,686.28; 1,686.28 × 3% − 250 < 0, nil`,
			'Net: 2,874.19 − 317 − 14.25 − 5.70 = 2,537.24; employer cost 375 + 49.85 + 5.70 = 430.55'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('raise', 'Wong Raise', 2600, {
				terms: { effective_range: { from: '2024-01-02', to: '2026-01-14' } }
			}),
			{
				collection: 'employment_terms',
				values: {
					employment_id: '@raise_job',
					residency_status: 'CITIZEN',
					tax_residency: 'RESIDENT',
					currency: 'MYR',
					base_salary: 3100,
					pay_frequency: 'MONTHLY',
					work_classification: 'EA_COVERED',
					statutory_work_category: 'NON_MANUAL',
					employment_type: 'PERMANENT',
					facts: { worksite_state: 'SELANGOR' },
					shift_pattern_id: '@week',
					effective_range: { from: '2026-01-15', to: null }
				}
			}
		],
		period: '2026-01',
		expected: [
			{
				employment: 'raise_job',
				lines: {
					gross: 2874.19,
					net: 2537.24,
					employer_cost: 430.55,
					'EPF.employee': 317,
					'EPF.employer': 375,
					'SOCSO.employee': 14.25,
					'SOCSO.employer': 49.85,
					'EIS.employee': 5.7,
					'EIS.employer': 5.7
				}
			}
		]
	},

	// ── A retrenched leaver: final pay, leave encashment, termination benefit ─────────────────────
	{
		id: 'MY-SR10-1',
		profile: 'MY',
		description:
			'A citizen on RM3,000, employed from 1 January 2023, is retrenched with the last day 30 June 2026 after written notice on 4 May: June salary, s.60E(3A) payment for six untaken days, and the reg.6 termination benefit for 3 years 6 months at 15 days a year; SKBBK is due in June.',
		citation: [
			`${EA} s.12(2)(b), (3): notice of six weeks for two to five years’ service, given 4 May 2026 (57 days before the last day), so no indemnity. s.60E(1)(b): 12 days a year for two to under five years; the terminating year is in direct proportion to completed months, January–June = 6, so 12 × 6/12 = 6 days, none taken. s.60E(3A) with s.60I(1A): 6 × 3,000/26 = 692.3077 → 692.31`,
			`${TLB}: 1 January 2023 – 30 June 2026 is 42 months = 3.5 years; 15 days × 3.5 × (12 × 3,000 = 36,000)/365 = 5,178.0822 → 5,178.08 (the twelve months' wages stated as the exit fact wages_12m)`,
			`${EPF_WAGES}; KWSP Employer FAQ 8 (payment for unutilised annual leave is wages) and 11 (retrenchment and termination benefits are not): base 3,692.31, "3,680.01 to 3,700.00" RM481 / RM407 (https://web.archive.org/web/20260810072920/https://www.kwsp.gov.my/en/employer/responsibilities/mandatory-contribution)`,
			`${SOCSO}; Act 4 s.2(24) and Act 800 s.2 "wages" include any payment in respect of leave and exclude (d) any gratuity payable on discharge — which the retrenchment benefit is: base 3,692.31, row 41 (RM3,600–3,700) employer RM63.85, Invalidity RM18.25, SKBBK RM27.35`,
			`${EIS}: row 41 RM7.30 each`,
			`${ITA_SCH6} para 15(1)(b): compensation for loss of employment exempt to RM10,000 × 3 completed years = RM30,000, so the benefit is not taxed. ${PCB}: at RM3,000 a month P < RM35,000 and the tax is nil; the leave payment leaves it nil`,
			'Net: 3,000 + 692.31 + 5,178.08 = 8,870.39 − 407 − 18.25 − 27.35 − 7.30 = 8,410.49; employer cost 481 + 63.85 + 7.30 = 552.15'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2022-12-26'),
			...citizen('retrench', 'Rosli Retrench', 3000, {
				from: '2023-01-01',
				to: '2026-06-30',
				schemes: ['EPF', 'SOCSO', 'SKBBK', 'EIS'],
				employment: {
					exit_reason: 'RETRENCHMENT',
					exit_facts: {
						leaving_malaysia: false,
						wages_12m: 36000,
						notice_termination_party: 'EMPLOYER',
						notice_approved_apprenticeship: false,
						notice_exception: 'NONE',
						notice_given: true,
						notice_given_on: '2026-05-04',
						notice_waived_days: 0,
						notice_structural_ground: 'REDUCED_WORK',
						notice_exception_reference: 'PROBE retrenchment notice 4 May 2026'
					}
				}
			}),
			{
				collection: 'leave_entries',
				values: {
					employment_id: '@retrench_job',
					catalogue_id: '@law:leave_catalogue:ANNUAL_LEAVE',
					reference: 'PROBE-EXIT-ANNUAL_LEAVE',
					from_date: '2026-01-01',
					to_date: '2026-12-31',
					days: 6,
					encash_days: 6,
					effective_on: '2026-06-30',
					due_on: '2026-06-30',
					reason: 'Unused leave on departure 2026-06-30'
				}
			},
			adhoc('retrench_job', 'TERMINATION_BENEFIT', 0, '2026-06-30', '2026-06')
		],
		period: '2026-06',
		expected: [
			{
				employment: 'retrench_job',
				lines: {
					gross: 8870.39,
					net: 8410.49,
					employer_cost: 552.15,
					BASIC: 3000,
					ANNUAL_LEAVE_ENCASHMENT: 692.31,
					TERMINATION_BENEFIT: 5178.08,
					'EPF.employee': 407,
					'EPF.employer': 481,
					'SOCSO.employee': 18.25,
					'SOCSO.employer': 63.85,
					'SKBBK.employee': 27.35,
					'EIS.employee': 7.3,
					'EIS.employer': 7.3,
					'PCB.employee': 0
				}
			}
		]
	},

	// ── s.18A(b) and the leaver's last-month MTD ──────────────────────────────────────────────────
	{
		id: 'MY-PCB-01-2',
		profile: 'MY',
		description:
			'A citizen on RM20,000 resigns with the last day Thursday 15 January 2026, after eight weeks’ written notice: s.18A(b) pays 15 of 31 days; the leaver’s MTD is the ordinary formula on that month (Y2 = Y1, n = 11).',
		citation: [
			`${EA} s.18A(b): 20,000 / 31 × 15 = 9,677.4194 → 9,677.42; s.12(2)(c): eight weeks for five years or more, notice given 1 November 2025, so no indemnity`,
			`${EPF_A}: "9,600.01 to 9,700.00" employer RM1,164, employee RM1,067`,
			`${SOCSO}: row 65 (ceiling) RM104.15 / RM29.75`,
			`${EIS}: row 65 RM11.90 each`,
			`${PCB}: the specification has no separate leaver formula. K1 = 1,067; K2 = lower of 1,067 and 2,933/11 = 266.63; P = 8,610.42 + 9,410.79 × 11 − 9,000 = 103,129.11; row 100,001–400,000: 3,129.11 × 25% = 782.2775 → 782.27 + 9,400 = 10,182.27; / 12 = 848.5225 → 848.52 → 848.55`,
			'Net: 9,677.42 − 1,067 − 29.75 − 11.90 − 848.55 = 7,720.22; employer cost 1,164 + 104.15 + 11.90 = 1,280.05'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2020-01-06'),
			...citizen('resigner', 'Karen Resign', 20000, {
				from: '2020-01-06',
				to: '2026-01-15',
				employment: {
					exit_reason: 'RESIGNATION',
					exit_facts: {
						terminated_without_notice: false,
						leaving_malaysia: false,
						notice_termination_party: 'EMPLOYEE',
						notice_approved_apprenticeship: false,
						notice_exception: 'NONE',
						notice_given: true,
						notice_given_on: '2025-11-01',
						notice_waived_days: 0
					}
				}
			})
		],
		period: '2026-01',
		expected: [
			{
				employment: 'resigner_job',
				lines: {
					gross: 9677.42,
					net: 7720.22,
					employer_cost: 1280.05,
					'EPF.employee': 1067,
					'EPF.employer': 1164,
					'SOCSO.employee': 29.75,
					'SOCSO.employer': 104.15,
					'EIS.employee': 11.9,
					'EIS.employer': 11.9,
					'PCB.employee': 848.55
				}
			}
		]
	},

	// ── Payment in lieu of notice ────────────────────────────────────────────────────────────────
	{
		id: 'MY-EA05-1',
		profile: 'MY',
		description:
			'A citizen on RM6,000, employed from 1 June 2025, is made redundant with the last day 31 January 2026 and no notice: s.13(1) indemnity for the four weeks of s.12(2)(a) — 1–28 February, one whole month’s wages — taxed as additional remuneration; no termination benefit under twelve months.',
		citation: [
			`${EA} s.12(2)(a): four weeks’ notice under two years’ service; s.13(1): the party terminating without notice pays the wages that would have accrued during the notice term — 1 to 28 February 2026, the whole of February = 6,000.00. Employment (Termination and Lay-Off Benefits) Regulations 1980 reg.3(1) pays only after a continuous contract of not less than twelve months: none here`,
			`${EPF_A}: "5,900.01 to 6,000.00" employer RM720, employee RM660; KWSP Employer FAQ 11 lists payment in lieu of notice among non-wages (https://web.archive.org/web/20260810072920/https://www.kwsp.gov.my/en/employer/responsibilities/mandatory-contribution)`,
			`${SOCSO}: row 64 or 65 — RM104.15 / RM29.75 whether or not the indemnity is wages (the RM6,000 ceiling)`,
			`${EIS}: RM11.90 each at the ceiling either way`,
			`${ITA_SCH6} para 15(1)(b): no completed year of service, so nothing is exempt. ${PCB}, D(b)(2): Step 1: K2 = lower of 660 and 3,340/11 = 303.63; P = 5,340 + 5,696.37 × 11 − 9,000 = 59,000.07; (9,000.07 × 11% = 990.00 + 1,500) / 12 = 207.50; year 2,490.00. Step 2 (Yt = 6,000, Kt = 0): P = 65,000.07; Step 3: 15,000.07 × 11% = 1,650.00 + 1,500 = 3,150.00; Step 4: 660.00; Step 5: 867.50`,
			'Net: 12,000 − 660 − 29.75 − 11.90 − 867.50 = 10,430.85; employer cost 720 + 104.15 + 11.90 = 836.05'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2025-05-26'),
			...citizen('redundant', 'Suresh Redundant', 6000, {
				from: '2025-06-01',
				to: '2026-01-31',
				employment: {
					exit_reason: 'REDUNDANCY',
					exit_facts: {
						leaving_malaysia: false,
						notice_termination_party: 'EMPLOYER',
						notice_approved_apprenticeship: false,
						notice_exception: 'NONE',
						notice_given: false,
						notice_waived_days: 0,
						notice_structural_ground: 'REDUCED_WORK',
						notice_exception_reference: 'PROBE redundancy without notice'
					}
				}
			}),
			adhoc('redundant_job', 'NOTICE_IN_LIEU', 0, '2026-01-31', '2026-01')
		],
		period: '2026-01',
		expected: [
			{
				employment: 'redundant_job',
				lines: {
					gross: 12000,
					net: 10430.85,
					employer_cost: 836.05,
					BASIC: 6000,
					NOTICE_IN_LIEU: 6000,
					'EPF.employee': 660,
					'EPF.employer': 720,
					'SOCSO.employee': 29.75,
					'SOCSO.employer': 104.15,
					'EIS.employee': 11.9,
					'EIS.employer': 11.9,
					'PCB.employee': 867.5
				}
			}
		]
	},

	// ── Ordinary-day overtime, and HRD’s wage base ───────────────────────────────────────────────
	{
		id: 'MY-EA31-1',
		profile: 'MY',
		description:
			'A citizen on RM2,600 at an HRD-liable company works 10 hours on Monday 5 and 11 hours on Tuesday 6 January 2026: s.60A(3) overtime at 1.5 × RM12.50; EPF and HRD levy on the salary, SOCSO and EIS on the overtime too.',
		citation: [
			`${EA} s.60A(3)(a)–(c): overtime is the hours in excess of the normal hours (the contract's eight), at not less than 1.5 × the hourly rate; s.60I(1A), (1)(b): 2,600 / 26 / 8 = 12.50. Monday 09:00–13:00, 14:00–18:00, 18:30–20:30 = 10 h, 2 h over; Tuesday to 21:30 = 11 h, 3 h over: 5 × 12.50 × 1.5 = 93.75. First Schedule para 1A–2: the wages are within RM4,000`,
			`${EPF_WAGES}: base 2,600, "2,580.01 to 2,600.00" RM338 / RM286`,
			`${SOCSO}; Act 4 and Act 800 wages include overtime: base 2,693.75, row 31 (RM2,600–2,700) RM46.35 / RM13.25`,
			`${EIS}: row 31 RM5.30 each`,
			`${HRD}: citizen at a compulsory (count 12) Part I employer, 1% × 2,600 = 26.00`,
			`${PCB}: P below RM20,000 after relief, nil`,
			'Net: 2,693.75 − 286 − 13.25 − 5.30 = 2,389.20; employer cost 338 + 46.35 + 5.30 + 26 = 415.65'
		],
		company: hrd('COMPULSORY', 12),
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('overtime', 'Ah Hock Overtime', 2600),
			worked(
				'overtime_job',
				'2026-01-05',
				[
					['09:00', '13:00'],
					['14:00', '18:00'],
					['18:30', '20:30']
				],
				2
			),
			worked(
				'overtime_job',
				'2026-01-06',
				[
					['09:00', '13:00'],
					['14:00', '18:00'],
					['18:30', '21:30']
				],
				3
			)
		],
		period: '2026-01',
		expected: [
			{
				employment: 'overtime_job',
				lines: {
					gross: 2693.75,
					net: 2389.2,
					employer_cost: 415.65,
					BASIC: 2600,
					'EPF.employee': 286,
					'EPF.employer': 338,
					'SOCSO.employee': 13.25,
					'SOCSO.employer': 46.35,
					'EIS.employee': 5.3,
					'EIS.employer': 5.3,
					'HRDF.employer': 26
				}
			}
		]
	},

	// ── First Schedule: who is owed Part XII overtime ─────────────────────────────────────────────
	{
		id: 'MY-EA01-1',
		profile: 'MY',
		description:
			'Two non-resident foreign workers on RM5,200 each work 10 hours on Monday 5 January 2026: the non-manual one is over RM4,000 and owed no statutory overtime; the manual labourer is owed it whatever the wage.',
		citation: [
			`${EA} First Schedule para 1A: for an employee earning over RM4,000 a month, s.60A(3) and the other overtime provisions do not apply; para 2(1): an employee engaged in manual labour is covered irrespective of wages. Manual: 5,200 / 26 / 8 = 25.00 an hour; 2 h × 25 × 1.5 = 75.00`,
			`${EPF_F}; overtime is not EPF wages: 2% × 5,200 = 104 each`,
			`${SOCSO}: non-manual base 5,200, row 56 (RM5,100–5,200) RM90.15 / RM25.75; manual base 5,275, row 57 (RM5,200–5,300) RM91.85 / RM26.25`,
			'EIS: Act 800 First Schedule para 10: no foreign employee',
			`${PCB}, D(a): 30% of remuneration: 5,200 × 30% = 1,560.00; 5,275 × 30% = 1,582.50`,
			'Net: 5,200 − 104 − 25.75 − 1,560 = 3,510.25 (employer 194.15); 5,275 − 104 − 26.25 − 1,582.50 = 3,562.25 (employer 195.85)'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...hire({
				ref: 'engineer',
				name: 'Arjun Engineer',
				born: '1988-03-03',
				nationality: 'Indian',
				standing: 'FOREIGNER',
				salary: 5200,
				from: '2024-01-02'
			}),
			...hire({
				ref: 'rigger',
				name: 'Joko Rigger',
				born: '1989-04-04',
				standing: 'FOREIGNER',
				salary: 5200,
				from: '2024-01-02',
				category: 'MANUAL_LABOUR'
			}),
			...['engineer_job', 'rigger_job'].map((job) =>
				worked(
					job,
					'2026-01-05',
					[
						['09:00', '13:00'],
						['14:00', '18:00'],
						['18:30', '20:30']
					],
					2
				)
			)
		],
		period: '2026-01',
		expected: [
			{
				employment: 'engineer_job',
				lines: {
					gross: 5200,
					net: 3510.25,
					employer_cost: 194.15,
					'EPF_NON_CITIZEN.employee': 104,
					'EPF_NON_CITIZEN.employer': 104,
					'SOCSO.employee': 25.75,
					'SOCSO.employer': 90.15,
					'PCB.employee': 1560
				}
			},
			{
				employment: 'rigger_job',
				lines: {
					gross: 5275,
					net: 3562.25,
					employer_cost: 195.85,
					'EPF_NON_CITIZEN.employee': 104,
					'EPF_NON_CITIZEN.employer': 104,
					'SOCSO.employee': 26.25,
					'SOCSO.employer': 91.85,
					'PCB.employee': 1582.5
				}
			}
		]
	},

	// ── A holiday on the rest day, substituted and worked ─────────────────────────────────────────
	{
		id: 'MY-EA32-1',
		profile: 'MY',
		description:
			'Federal Territory Day falls on Sunday 1 February 2026, the rest day of a Kuala Lumpur citizen on RM2,600: Monday 2 February is the paid substitute, and working it eight hours earns two days’ wages on top of the month. Holiday work within the normal hours is EPF wages.',
		citation: [
			`${EA} s.60D(1)(a)(iii) (Federal Territory Day for an employee wholly or mainly working in the Federal Territory) and its proviso: a holiday on a rest day moves to the next working day; s.60D(3)(a)(i): working it earns two days' wages at the ordinary rate in addition to the holiday pay: 2 × 2,600/26 = 200.00; s.60D(2A): the month's salary is the holiday pay`,
			`${EPF_WAGES}; KWSP Employer FAQ 21: wages for work during public holidays are subject to EPF unless the work is overtime (https://web.archive.org/web/20260810072920/https://www.kwsp.gov.my/en/employer/responsibilities/mandatory-contribution); overtime is only the hours beyond the normal hours (EA s.60A(3)(b)): base 2,800, "2,780.01 to 2,800.00" RM364 / RM308`,
			`${SOCSO}; Act 800 s.2 wages include extra work on holidays: row 32 (RM2,700–2,800) RM48.15 / RM13.75`,
			`${EIS}: row 32 RM5.50 each`,
			`${PCB}: nil at this wage`,
			'Net: 2,800 − 308 − 13.75 − 5.50 = 2,472.75; employer cost 364 + 48.15 + 5.50 = 417.65'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('ftday', 'Farhan Wilayah', 2600, { state: 'KUALA_LUMPUR' }),
			holiday('2026-02-01', 'Federal Territory Day'),
			worked(
				'ftday_job',
				'2026-02-02',
				[
					['09:00', '13:00'],
					['14:00', '18:00']
				],
				8
			)
		],
		period: '2026-02',
		expected: [
			{
				employment: 'ftday_job',
				lines: {
					gross: 2800,
					net: 2472.75,
					employer_cost: 417.65,
					BASIC: 2600,
					'EPF.employee': 308,
					'EPF.employer': 364,
					'SOCSO.employee': 13.75,
					'SOCSO.employer': 48.15,
					'EIS.employee': 5.5,
					'EIS.employer': 5.5
				}
			}
		]
	},

	// ── The 2026 additional Peninsular holiday ────────────────────────────────────────────────────
	{
		id: 'MY-PEN-HOL-01-1',
		profile: 'MY',
		description:
			'Hari Raya Puasa fell on Saturday 21 March 2026, so Friday 20 March was an additional Peninsular public holiday under Holidays Act s.8; a Selangor citizen on RM2,600 who works it eight hours earns two days’ wages.',
		citation: [
			'P.U.(B) 111/2026, Holidays Act 1951 s.8 (https://www.kabinet.gov.my/storage/2026/03/PUB-111_2026.pdf): 20 March 2026 is a public holiday in Peninsular Malaysia if Hari Raya Puasa falls on 21 March 2026; the Keeper of the Rulers’ Seal declared 21 March 2026 (reported: https://www.buletintv3.my/nasional/terkini-umat-islam-malaysia-sambut-aidilfitri-pada-21-mac-2026/)',
			`${EA} s.60D(1)(b): a day appointed under Holidays Act s.8 is a paid holiday; s.60D(3)(a)(i): 2 × 2,600/26 = 200.00`,
			`${EPF_WAGES}; KWSP Employer FAQ 21 (holiday work is EPF wages unless overtime): base 2,800, RM364 / RM308`,
			`${SOCSO}: row 32 RM48.15 / RM13.75; ${EIS}: row 32 RM5.50 each; ${PCB}: nil`,
			'Net: 2,800 − 308 − 13.75 − 5.50 = 2,472.75; employer cost 417.65'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('raya', 'Zainab Raya', 2600, { gender: 'FEMALE' }),
			holiday('2026-03-20', 'Additional Hari Raya Puasa holiday (P.U.(B) 111/2026)'),
			worked(
				'raya_job',
				'2026-03-20',
				[
					['09:00', '13:00'],
					['14:00', '18:00']
				],
				8
			)
		],
		period: '2026-03',
		expected: [
			{
				employment: 'raya_job',
				lines: {
					gross: 2800,
					net: 2472.75,
					employer_cost: 417.65,
					'EPF.employee': 308,
					'EPF.employer': 364,
					'SOCSO.employee': 13.75,
					'SOCSO.employer': 48.15,
					'EIS.employee': 5.5,
					'EIS.employer': 5.5
				}
			}
		]
	},

	// ── HRD: citizens only, at a compulsory employer ──────────────────────────────────────────────
	{
		id: 'MY-HRD-01-1',
		profile: 'MY',
		description:
			'A compulsory Part I HRD employer with twelve Malaysian employees: its citizen on RM3,000 is levied 1%; its permanent resident on RM3,000 is not an Act 612 employee, though EPF Part A and EIS reach him.',
		citation: [
			`${HRD}: 1% × 3,000 = 30.00 for the citizen; none for the permanent resident`,
			`${EPF_A}: Part A covers citizens and permanent residents under sixty: "2,980.01 to 3,000.00" RM390 / RM330 each`,
			`${SOCSO}: row 34 RM51.65 / RM14.75 each; ${EIS}: row 34 RM5.90 each (Act 800 First Schedule para 10 keeps permanent residents in)`,
			`${PCB}: nil at RM3,000`,
			'Net: 3,000 − 330 − 14.75 − 5.90 = 2,649.35 each; employer cost 390 + 51.65 + 5.90 = 447.55, plus 30 for the citizen = 477.55'
		],
		company: hrd('COMPULSORY', 12),
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('hrd_citizen', 'Nadia Citizen', 3000),
			...hire({
				ref: 'hrd_pr',
				name: 'Chen Wei PR',
				born: '1987-12-12',
				nationality: 'Chinese',
				standing: 'PERMANENT_RESIDENT',
				tax: 'RESIDENT',
				salary: 3000,
				from: '2024-01-02'
			})
		],
		period: '2026-01',
		expected: [
			{
				employment: 'hrd_citizen_job',
				lines: {
					gross: 3000,
					net: 2649.35,
					employer_cost: 477.55,
					'EPF.employee': 330,
					'EPF.employer': 390,
					'SOCSO.employee': 14.75,
					'SOCSO.employer': 51.65,
					'EIS.employee': 5.9,
					'EIS.employer': 5.9,
					'HRDF.employer': 30
				}
			},
			{
				employment: 'hrd_pr_job',
				lines: {
					gross: 3000,
					net: 2649.35,
					employer_cost: 447.55,
					'EPF.employee': 330,
					'EPF.employer': 390,
					'SOCSO.employee': 14.75,
					'SOCSO.employer': 51.65,
					'EIS.employee': 5.9,
					'EIS.employer': 5.9
				}
			}
		]
	},

	// ── HRD: the optional 0.5% ───────────────────────────────────────────────────────────────────
	{
		id: 'MY-HRD-02-1',
		profile: 'MY',
		description:
			'An employer with seven Malaysian employees that opted to register, never above its class maximum: 0.5% on its citizen on RM3,000.',
		citation: [
			`${HRD}: s.15(2): 0.5% × 3,000 = 15.00`,
			`${EPF_A}: RM390 / RM330; ${SOCSO}: row 34 RM51.65 / RM14.75; ${EIS}: row 34 RM5.90 each; ${PCB}: nil`,
			'Net: 2,649.35; employer cost 447.55 + 15 = 462.55'
		],
		company: hrd('OPTIONAL', 7, { hrd_optional_last_high_year: 0 }),
		inputs: [...officeWeek('2024-01-01'), ...citizen('optional', 'Irfan Optional', 3000)],
		period: '2026-01',
		expected: [
			{
				employment: 'optional_job',
				lines: {
					gross: 3000,
					net: 2649.35,
					employer_cost: 462.55,
					'EPF.employee': 330,
					'EPF.employer': 390,
					'SOCSO.employee': 14.75,
					'SOCSO.employer': 51.65,
					'EIS.employee': 5.9,
					'EIS.employer': 5.9,
					'HRDF.employer': 15
				}
			}
		]
	},

	// ── HRD: an optional registrant that crossed its maximum this year ────────────────────────────
	{
		id: 'MY-HRDA06-1',
		profile: 'MY',
		description:
			'An optional registrant that went above its class maximum earlier in 2026 and is back to eight Malaysian employees: s.15(5) keeps the 1% to the end of the year.',
		citation: [
			`${HRD}: s.15(4)–(5): 1% × 3,000 = 30.00 through the current year; HRD Corp Employers’ Circular 5/2018 example (https://hrdcorp.gov.my/wp-content/uploads/2021/03/EMP-CIRCULAR-NO-5_2018.pdf)`,
			`${EPF_A}: RM390 / RM330; ${SOCSO}: row 34; ${EIS}: row 34; ${PCB}: nil`,
			'Net: 2,649.35; employer cost 447.55 + 30 = 477.55'
		],
		company: hrd('OPTIONAL', 8, { hrd_optional_last_high_year: 2026 }),
		inputs: [...officeWeek('2024-01-01'), ...citizen('crossed', 'Syafiq Crossed', 3000)],
		period: '2026-01',
		expected: [
			{
				employment: 'crossed_job',
				lines: {
					gross: 3000,
					net: 2649.35,
					employer_cost: 477.55,
					'EPF.employee': 330,
					'EPF.employer': 390,
					'SOCSO.employee': 14.75,
					'SOCSO.employer': 51.65,
					'EIS.employee': 5.9,
					'EIS.employer': 5.9,
					'HRDF.employer': 30
				}
			}
		]
	},

	// ── HRD: the 2026 scheduled-education exemption ───────────────────────────────────────────────
	{
		id: 'MY-HRD11-1',
		profile: 'MY',
		description:
			'A registered employer in a P.U.(A) 13/2026 education class (MSIC 85302) with twelve Malaysian employees: no levy for January 2026.',
		citation: [
			'P.U.(A) 13/2026 (https://lom.agc.gov.my/ilims/upload/portal/akta/outputp/3268260/PUA%2013%20(2026).pdf) under Act 612 s.19: registered employers in the scheduled education classes are exempt from the ss.14–15 levy from 15 January to 31 December 2026; HRD Corp Employers’ Circular 1/2026 applies it to the January–December 2026 contribution months (https://hrdcorp.gov.my/wp-content/uploads/2026/01/Employers-Circular-No-01-2026.pdf)',
			`${EPF_A}: RM390 / RM330; ${SOCSO}: row 34; ${EIS}: row 34; ${PCB}: nil`,
			'Net: 2,649.35; employer cost 447.55'
		],
		company: hrd('COMPULSORY', 12, { hrd_education_schedule_code: '85302' }),
		inputs: [...officeWeek('2024-01-01'), ...citizen('teacher', 'Cikgu Aminah', 3000)],
		period: '2026-01',
		expected: [
			{
				employment: 'teacher_job',
				lines: {
					gross: 3000,
					net: 2649.35,
					employer_cost: 447.55,
					'EPF.employee': 330,
					'EPF.employer': 390,
					'SOCSO.employee': 14.75,
					'SOCSO.employer': 51.65,
					'EIS.employee': 5.9,
					'EIS.employer': 5.9
				}
			}
		]
	},

	// ── A missing registration is no exemption ────────────────────────────────────────────────────
	{
		id: 'MY-REG-01-1',
		profile: 'MY',
		description:
			'A Part I employer with twelve Malaysian employees that never registered with HRD Corp still owes the 1% levy on its citizen on RM3,000.',
		citation: [
			`${HRD}: s.14(1) imposes the levy on every employer to whom the Act applies — a First Schedule employer with ten or more Malaysian employees (P.U.(A) 84/2021, https://lom.agc.gov.my/ilims/upload/portal/akta/outputp/pua_20210226_PUA84.pdf); registration is a separate duty (s.13), not a condition of the levy: 1% × 3,000 = 30.00`,
			`${EPF_A}: RM390 / RM330; ${SOCSO}: row 34; ${EIS}: row 34; ${PCB}: nil`,
			'Net: 2,649.35; employer cost 447.55 + 30 = 477.55'
		],
		company: hrd('NOT_REGISTERED', 12),
		inputs: [...officeWeek('2024-01-01'), ...citizen('unregistered', 'Hakim Unregistered', 3000)],
		period: '2026-01',
		expected: [
			{
				employment: 'unregistered_job',
				lines: {
					gross: 3000,
					net: 2649.35,
					employer_cost: 477.55,
					'EPF.employee': 330,
					'EPF.employer': 390,
					'SOCSO.employee': 14.75,
					'SOCSO.employer': 51.65,
					'EIS.employee': 5.9,
					'EIS.employer': 5.9,
					'HRDF.employer': 30
				}
			}
		]
	},

	// ── HRD: part-time wages are outside the levy ─────────────────────────────────────────────────
	{
		id: 'MY-HRD12-1',
		profile: 'MY',
		description:
			'A part-time citizen (four hours a day, five days a week) on RM1,200 at a compulsory HRD employer: EPF, SOCSO and EIS as for anyone, no HRD levy.',
		citation: [
			'HRD: the part-time exemption recorded as MY-HRD12 (effective 1 October 2010: part-time wages exempt) under Act 612 s.19 (https://lom.agc.gov.my/ilims/upload/portal/akta/LOM/EN/Act%20612%20-%20Reprint%202017.pdf)',
			`${EPF_A}: "1,180.01 to 1,200.00" RM156 / RM132`,
			`${SOCSO}: row 16 RM20.15 / RM5.75; ${EIS}: row 16 RM2.30 each; ${PCB}: nil`,
			'Minimum wage: P.U.(A) 376/2024 para 5(1) RM8.72 an hour; RM1,200 for 20 hours a week (86.67 hours a month) is RM13.85 an hour',
			'Net: 1,200 − 132 − 5.75 − 2.30 = 1,059.95; employer cost 156 + 20.15 + 2.30 = 178.45'
		],
		company: hrd('COMPULSORY', 12),
		inputs: [
			...officeWeek('2024-01-01'),
			{
				collection: 'shift_definitions',
				ref: 'morning',
				values: {
					company_id: '@company',
					code: 'MORNING',
					name: 'Morning (0900 to 1300)',
					variant: { kind: 'WORK', start_time: '09:00', end_time: '13:00', break_minutes: 0 },
					effective_range: { from: '2024-01-01', to: null }
				}
			},
			{
				collection: 'shift_patterns',
				ref: 'part_week',
				values: {
					company_id: '@company',
					code: 'MORNINGx5-OFF-REST',
					name: '5 x MORNING, OFF, REST',
					pattern: {
						days: ['@morning', '@morning', '@morning', '@morning', '@morning', '@off', '@rest'].map(
							(roster_code_id) => ({ roster_code_id })
						)
					},
					effective_range: { from: '2024-01-01', to: null }
				}
			},
			...citizen('parttimer', 'Priya Part-Time', 1200, {
				gender: 'FEMALE',
				type: 'PART_TIME',
				pattern: '@part_week',
				terms: {
					comparable_full_time_daily_hours: 8,
					comparable_full_time_weekly_hours: 40,
					comparable_full_time_presence: 'PRESENT'
				}
			})
		],
		period: '2026-01',
		expected: [
			{
				employment: 'parttimer_job',
				lines: {
					gross: 1200,
					net: 1059.95,
					employer_cost: 178.45,
					'EPF.employee': 132,
					'EPF.employer': 156,
					'SOCSO.employee': 5.75,
					'SOCSO.employer': 20.15,
					'EIS.employee': 2.3,
					'EIS.employer': 2.3
				}
			}
		]
	},

	// ── MTD reliefs: spouse, child, zakat ─────────────────────────────────────────────────────────
	{
		id: 'MY-PCB-02-1',
		profile: 'MY',
		description:
			'Three citizens on RM5,000 in January 2026: married to a spouse without income with one child under 18 claimed (category 2); married to a working spouse with one child claimed (category 3); single, with RM50 zakat paid through the employer.',
		citation: [
			`${PCB}. E(14)(i)(b) spouse relief RM4,000 and Table 1 category 2; E(14)(i)(c) RM2,000 for a child under 18; D(b)(1) net MTD = MTD − zakat for the month. Base as MY-EPF-01-1: K1 = 550, K2 = 313.63, P before family reliefs 47,000.07. Category 2: P = 41,000.07; (6,000.07 × 6% = 360.00 + 600) / 12 = 80.00. Category 3: P = 45,000.07; (10,000.07 × 6% = 600.00 + 600) / 12 = 100.00. Zakat: 110.00 − 50 = 60.00`,
			`${EPF_A}: RM650 / RM550; ${SOCSO}: row 54 RM86.65 / RM24.75; ${EIS}: row 54 RM9.90 each`,
			'Net: 5,000 − 550 − 24.75 − 9.90 − 80 = 4,335.35; − 100 = 4,315.35; employer cost 746.55 each'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...(['nospouse', 'working'] as const).flatMap((ref) =>
				citizen(`${ref}_parent`, `Parent ${ref}`, 5000, {
					person: {
						marital_status: 'MARRIED',
						spouse_status: ref === 'nospouse' ? 'WITHOUT_INCOME' : 'WITH_INCOME',
						children: [{ child_birthdate: '2015-04-01', relationship: 'CHILD' }]
					},
					pcb: {
						child_claims: [
							{
								year: '2026',
								relief_class: 'UNDER_18',
								full_count: 1,
								half_count: 0,
								reference: 'TP1 2026 child relief'
							}
						]
					}
				})
			),
			...citizen('zakat', 'Ustaz Zakat', 5000, { pcb: { elections: { zakat: 50 } } })
		],
		period: '2026-01',
		expected: [
			{
				employment: 'nospouse_parent_job',
				lines: {
					gross: 5000,
					net: 4335.35,
					employer_cost: 746.55,
					'EPF.employee': 550,
					'EPF.employer': 650,
					'SOCSO.employee': 24.75,
					'SOCSO.employer': 86.65,
					'EIS.employee': 9.9,
					'EIS.employer': 9.9,
					'PCB.employee': 80
				}
			},
			{
				employment: 'working_parent_job',
				lines: {
					gross: 5000,
					net: 4315.35,
					employer_cost: 746.55,
					'EPF.employee': 550,
					'EPF.employer': 650,
					'SOCSO.employee': 24.75,
					'SOCSO.employer': 86.65,
					'EIS.employee': 9.9,
					'EIS.employer': 9.9,
					'PCB.employee': 100
				}
			},
			{
				employment: 'zakat_job',
				lines: {
					gross: 5000,
					employer_cost: 746.55,
					'EPF.employee': 550,
					'EPF.employer': 650,
					'SOCSO.employee': 24.75,
					'SOCSO.employer': 86.65,
					'EIS.employee': 9.9,
					'EIS.employer': 9.9,
					'PCB.employee': 60
				}
			}
		]
	},

	// ── Form TP3: a mid-year joiner’s opening ─────────────────────────────────────────────────────
	{
		id: 'MY-PCB-03-1',
		profile: 'MY',
		description:
			'A citizen joins on 1 April 2026 on RM5,000 and declares on Form TP3 the previous employer’s January–March: RM15,000 remuneration, RM1,650 EPF and RM330 MTD.',
		citation: [
			`${PCB}; E(10): the TP3 amounts are Σ(Y − K), K and X. April, n = 8: K2 = lower of 550 and (4,000 − 1,650 − 550)/8 = 225.00; P = (15,000 − 1,650) + 4,450 + 4,775 × 8 − 9,000 = 47,000.00; (12,000 × 6% + 600 − 330) / 9 = 110.00`,
			`${EPF_A}: RM650 / RM550; ${SOCSO}: row 54 RM86.65 / RM24.75; ${EIS}: row 54 RM9.90 each`,
			'Net: 5,000 − 550 − 24.75 − 9.90 − 110 = 4,305.35; employer cost 746.55'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2026-03-30'),
			...citizen('tp3', 'Yusof TP3', 5000, {
				from: '2026-04-01',
				pcb: {
					opening: [
						{ year: '2026', base: 15000, employee: 330, employer: 0, months: 3, reference: 'TP3' }
					]
				},
				epf: {
					opening: [{ year: '2026', base: 15000, employee: 1650, employer: 1950, reference: 'TP3' }]
				}
			})
		],
		period: '2026-04',
		expected: [
			{
				employment: 'tp3_job',
				lines: {
					gross: 5000,
					net: 4305.35,
					employer_cost: 746.55,
					'EPF.employee': 550,
					'EPF.employer': 650,
					'SOCSO.employee': 24.75,
					'SOCSO.employer': 86.65,
					'EIS.employee': 9.9,
					'EIS.employer': 9.9,
					'PCB.employee': 110
				}
			}
		]
	},

	// ── Exempt income: official-duty travel ───────────────────────────────────────────────────────
	{
		id: 'MY-PCB-05-1',
		profile: 'MY',
		description:
			'A citizen on RM5,000 is paid RM500 official-duty travelling allowance in January 2026: tax-exempt within RM6,000 a year, and no EPF, SOCSO or EIS wages.',
		citation: [
			`${PCB}; E(9) item i: travelling allowance for official duties is exempt up to RM6,000 a year, so MTD is as on RM5,000 alone = 110.00`,
			`${EPF_WAGES}: "5,000" row RM650 / RM550`,
			`${SOCSO}; Act 800 s.2 "wages" (b) excludes any travelling allowance: row 54 RM86.65 / RM24.75; ${EIS}: row 54 RM9.90 each`,
			'Net: 5,500 − 550 − 24.75 − 9.90 − 110 = 4,805.35; employer cost 746.55'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('traveller', 'Rizal Traveller', 5000),
			adhoc('traveller_job', 'TRAVEL_OFFICIAL', 500, '2026-01-15', '2026-01')
		],
		period: '2026-01',
		expected: [
			{
				employment: 'traveller_job',
				lines: {
					gross: 5500,
					net: 4805.35,
					employer_cost: 746.55,
					TRAVEL_OFFICIAL: 500,
					'EPF.employee': 550,
					'EPF.employer': 650,
					'SOCSO.employee': 24.75,
					'SOCSO.employer': 86.65,
					'EIS.employee': 9.9,
					'EIS.employer': 9.9,
					'PCB.employee': 110
				}
			}
		]
	},

	// ── Tax residence for a foreign worker ───────────────────────────────────────────────────────
	{
		id: 'MY-PCB-06-1',
		profile: 'MY',
		description:
			'Two foreign workers on RM6,000 in January 2026, each withheld at resident MTD: one on a 182-day contract (1 January–1 July 2026), one in Malaysia continuously since 1 June 2025 (s.7(1)(b) linked period) though recorded non-resident.',
		citation: [
			`${PCB}, D(a) note: from August 2017 resident MTD applies to foreign workers with an employment contract of 182 days or more. ${ITA_SCH6.replace('Schedule 6', 's.7(1)(b)')}: a period under 182 days in the basis year linked to 182 or more consecutive days in the adjoining year is residence — 1 June to 31 December 2025 is 214 days`,
			`${PCB}: K1 = 120 (Part F); K2 = lower of 120 and 3,880/11; P = 5,880 × 12 − 9,000 = 61,560; (11,560 × 11% = 1,271.60 + 1,500) / 12 = 230.9666 → 230.96 → 231.00`,
			`${EPF_F}: 120 + 120; ${SOCSO}: row 64 RM104.15 / RM29.75; EIS: none for a foreign employee`,
			'Net: 6,000 − 120 − 29.75 − 231 = 5,619.25; employer cost 120 + 104.15 = 224.15'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2025-06-02'),
			...hire({
				ref: 'contract182',
				name: 'Hiroshi Contract',
				born: '1985-01-15',
				nationality: 'Japanese',
				standing: 'FOREIGNER',
				salary: 6000,
				from: '2026-01-01',
				to: '2026-07-01',
				type: 'CONTRACT',
				employment: {
					exit_reason: 'END_OF_CONTRACT',
					exit_facts: { notice_termination_party: 'NEITHER' }
				}
			}),
			...hire({
				ref: 'present',
				name: 'Maria Present',
				born: '1986-02-16',
				gender: 'FEMALE',
				nationality: 'Filipino',
				standing: 'FOREIGNER',
				tax: 'NON_RESIDENT',
				salary: 6000,
				from: '2025-06-02'
			}),
			{
				collection: 'presence_periods',
				values: {
					employee_id: '@present',
					jurisdiction_code: 'MY',
					period: { from: '2025-06-01', to: null },
					reference: 'Passport entry stamp 1 June 2025, no exit'
				}
			}
		],
		period: '2026-01',
		expected: ['contract182_job', 'present_job'].map((employment) => ({
			employment,
			lines: {
				gross: 6000,
				net: 5619.25,
				employer_cost: 224.15,
				'EPF_NON_CITIZEN.employee': 120,
				'EPF_NON_CITIZEN.employer': 120,
				'SOCSO.employee': 29.75,
				'SOCSO.employer': 104.15,
				'PCB.employee': 231
			}
		}))
	},

	// ── Schedule 6 para 21: a short assignment ────────────────────────────────────────────────────
	{
		id: 'MY-PCB-07-1',
		profile: 'MY',
		description:
			'A non-resident foreign specialist on a six-week contract (1 February–13 March 2026, in Malaysia 1 February–15 March) on RM6,000: employment exercised in Malaysia for not more than sixty days is exempt, so no MTD.',
		citation: [
			`${ITA_SCH6} para 21: the income of a non-resident from an employment exercised in Malaysia for a period or periods not exceeding sixty days in a calendar year is exempt; 1 February to 15 March 2026 is 43 days. ${PCB}, E(9): exempt income is excluded from remuneration for MTD: nil`,
			`${EPF_F}: 120 + 120; ${SOCSO}: row 64 RM104.15 / RM29.75; EIS: none`,
			'Net: 6,000 − 120 − 29.75 = 5,850.25; employer cost 224.15'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2026-01-26'),
			...hire({
				ref: 'specialist',
				name: 'Klaus Specialist',
				born: '1980-10-10',
				nationality: 'German',
				standing: 'FOREIGNER',
				salary: 6000,
				from: '2026-02-01',
				to: '2026-03-13',
				type: 'CONTRACT',
				employment: {
					exit_reason: 'END_OF_CONTRACT',
					exit_facts: { notice_termination_party: 'NEITHER' }
				},
				pcb: { elections: { pcb_sch6_para21: true } }
			}),
			{
				collection: 'presence_periods',
				values: {
					employee_id: '@specialist',
					jurisdiction_code: 'MY',
					period: { from: '2026-02-01', to: '2026-03-15' },
					reference: 'Passport stamps 1 February and 15 March 2026'
				}
			}
		],
		period: '2026-02',
		expected: [
			{
				employment: 'specialist_job',
				lines: {
					gross: 6000,
					net: 5850.25,
					employer_cost: 224.15,
					'EPF_NON_CITIZEN.employee': 120,
					'EPF_NON_CITIZEN.employer': 120,
					'SOCSO.employee': 29.75,
					'SOCSO.employer': 104.15,
					'PCB.employee': 0
				}
			}
		]
	}
);
