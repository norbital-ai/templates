import { officeWeek, register, type ProbeInput, type Row } from '../payroll-probe.ts';

/**
 * MY cases: see the case shape at the top of payroll-probe.ts. Every figure is worked by hand from the
 * instrument cited beside it; `docs/inventory/malaysia.csv` names each case in its `probe` column.
 * Since 2026-09-30 the `MY` lineage carries Nihon Pigment's company overtime, rest-day and holiday
 * terms (formerly its own fork); cases whose statute-only figures those terms change were removed.
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
	/** Extra registration fields by scheme code (e.g. `first_contribution_due_on`). */
	status?: { readonly [code: string]: Row };
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
			fact(code, { ...(code === 'EPF' ? (h.epf ?? {}) : {}), ...h.status?.[code] })
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
/** A published company holiday; `replaces` names the holiday date it substitutes. */
const holiday = (date: string, name: string, replaces?: string): ProbeInput => ({
	collection: 'jurisdiction_holidays',
	values: {
		company_id: '@company',
		date,
		name,
		kind: 'PUBLIC_HOLIDAY',
		source: 'probe',
		published_at: '2025-12-01T00:00:00.000Z',
		...(replaces == null ? {} : { replaces })
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
					exit_ground: 'RETRENCHMENT',
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
					exit_ground: 'RESIGNATION',
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
					exit_ground: 'REDUNDANCY',
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
			'An optional registrant that went above its class maximum in March 2026 (its last 1% year is 2026) and is back to eight Malaysian employees in May 2026: s.15(5) keeps the 1% to the end of the year.',
		citation: [
			`${HRD}: s.15(4)–(5): the count exceeded the Part II maximum in March 2026 (declared as hrd_optional_last_high_year 2026) and has decreased to eight; the rate remains 1% × 3,000 = 30.00 until the end of 2026; HRD Corp Employers’ Circular 5/2018 example (https://hrdcorp.gov.my/wp-content/uploads/2021/03/EMP-CIRCULAR-NO-5_2018.pdf)`,
			`${EPF_A}: RM390 / RM330; ${SOCSO}: row 34; ${EIS}: row 34 (May 2026, before SKBBK from the June 2026 contribution month); ${PCB}: May, n = 7, K2 = 330, P = 2,670 × 8 − 9,000 = 12,360, [(12,360 − 5,000) × 1% − 400] ÷ 8 < 0: nil`,
			'Net: 2,649.35; employer cost 447.55 + 30 = 477.55'
		],
		company: hrd('OPTIONAL', 8, { hrd_optional_last_high_year: 2026 }),
		inputs: [...officeWeek('2024-01-01'), ...citizen('crossed', 'Syafiq Crossed', 3000)],
		period: '2026-05',
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
			'P.U.(A) 13/2026 (https://lom.agc.gov.my/ilims/upload/portal/akta/outputp/3268260/PUA%2013%20(2026).pdf) under Act 612 s.19: registered employers in the scheduled education classes are exempt from the ss.14–15 levy from 15 January to 31 December 2026 (para 1(2)). The Order is silent on a contribution month that straddles 15 January; recorded default (MY-HRD11): the levy is one monthly charge on the month’s wages (s.14(1)), so the whole January 2026 contribution month is exempt — the reading HRD Corp Employers’ Circular 1/2026 applies to the January–December 2026 contribution months (https://hrdcorp.gov.my/wp-content/uploads/2026/01/Employers-Circular-No-01-2026.pdf)',
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
			'HRD: HRD Corp Employers’ Circular 19/2010 (https://hrdcorp.gov.my/wp-content/uploads/2021/03/19-EMP-CIRCULAR-NO-19_2010.pdf): from 1 October 2010 part-time workers’ wages are exempt from the levy. SOURCE-BLOCKED (MY-HRD12): Act 612 s.2 "employee" (any citizen employed for wages under a contract of service, not a domestic servant) and s.14(1) carry no part-time exclusion, and the s.19 Gazette order the circular implies has not been located (https://lom.agc.gov.my/ilims/upload/portal/akta/LOM/EN/Act%20612%20-%20Reprint%202017.pdf); this nil levy has no primary source yet',
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
					exit_ground: 'END_OF_CONTRACT',
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
			`${ITA_SCH6} para 21: the income of a non-resident from an employment exercised in Malaysia for a period or periods not exceeding sixty days in a calendar year is exempt; the stay is recorded as employment exercised here, clipped to the contract 1 February–13 March 2026: 41 days (28 through the February run's 28 February). Para 22(b) does not apply: not a public entertainer. ${PCB}, E(9): exempt income is excluded from remuneration for MTD: nil`,
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
					exit_ground: 'END_OF_CONTRACT',
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
					employment_exercised: true,
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

// ── Round 2026-09-30: branches the cases above leave unproven ─────────────────────────────────────
const ACT4 =
	'Employees’ Social Security Act 1969 (Act 4), AGC online text 2026 (https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/3226981_BI/Act%204%20(Online%202026).pdf)';
const ACT800 =
	'Employment Insurance System Act 2017 (Act 800), AGC text (https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/1742141_BI/Act%20800%20FINAL.pdf)';
const EPF_C =
	'EPF Act 1991 (Act 452) Third Schedule Part C (employees who have attained sixty: (b) permanent residents, (c) non-citizens who elected before 1 August 1998), same AGC text as at 1 July 2022 (https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/1736246_BI/Act%20452%20(Online%202022).pdf); Part C is untouched by Act A1760 s.10';
/** A recorded non-registration for one scheme of `ref`'s employment. */
const unregistered = (ref: string, code: string, from: string): ProbeInput => ({
	collection: 'employment_statutory_facts',
	values: {
		employee_id: `@${ref}`,
		employment_id: `@${ref}_job`,
		statutory_contribution_id: `@law:statutory_contributions:${code}`,
		effective_range: { from, to: null },
		status: { kind: 'NOT_REGISTERED', reason: 'The employer has not registered the employee' }
	}
});
/** A citizen on RM3,000 in January 2026 under EPF, SOCSO and EIS: 330/390, 14.75/51.65, 5.90 each, no MTD. */
const PLAIN_3000 = {
	gross: 3000,
	net: 2649.35,
	'EPF.employee': 330,
	'EPF.employer': 390,
	'SOCSO.employee': 14.75,
	'SOCSO.employer': 51.65,
	'EIS.employee': 5.9,
	'EIS.employer': 5.9
};
const PLAIN_3000_CITED = [
	`${EPF_A}: "2,980.01 to 3,000.00" employer RM390, employee RM330`,
	`${SOCSO}: row 34 (exceeding RM2,900, not RM3,000) employer RM51.65, employee RM14.75`,
	`${EIS}: row 34 RM5.90 each`,
	`${PCB}: K2 = 330; P = 2,670 × 12 − 9,000 = 23,040; 3,040 × 3% − 250 < 0, no MTD`
];
/** A retrenchment departure on `last`, notice served from `noticeOn`. */
const retrenched = (noticeOn: string) => ({
	exit_ground: 'RETRENCHMENT',
	exit_facts: {
		leaving_malaysia: false,
		wages_12m: 36000,
		notice_termination_party: 'EMPLOYER',
		notice_approved_apprenticeship: false,
		notice_exception: 'NONE',
		notice_given: true,
		notice_given_on: noticeOn,
		notice_waived_days: 0,
		notice_structural_ground: 'REDUCED_WORK',
		notice_exception_reference: `PROBE retrenchment notice ${noticeOn}`
	}
});
const exitLeave = (job: string, days: number, last: string): ProbeInput => ({
	collection: 'leave_entries',
	values: {
		employment_id: `@${job}`,
		catalogue_id: '@law:leave_catalogue:ANNUAL_LEAVE',
		reference: `PROBE-EXIT-ANNUAL_LEAVE-${job}`,
		from_date: `${last.slice(0, 4)}-01-01`,
		to_date: `${last.slice(0, 4)}-12-31`,
		days,
		encash_days: days,
		effective_on: last,
		due_on: last,
		reason: `Unused leave on departure ${last}`
	}
});

register(
	// ── EPF above RM20,000: the percentage method ─────────────────────────────────────────────────
	{
		id: 'MY-EPF-01-6',
		profile: 'MY',
		description:
			'A citizen on RM25,000 in January 2026: above the last Part A row EPF is 11% and 12% of the wages, rounded up to the ringgit; SOCSO and EIS at the ceiling; MTD in the 25% band with the RM4,000 EPF relief spread by K2.',
		citation: [
			`${EPF_A}: "for the months where the wages exceed RM20,000.00, the contribution by the employee shall be calculated at the rate of 11% … the employer … 12% … rounded to the next ringgit": 25,000 × 11% = 2,750.00, × 12% = 3,000.00`,
			`${SOCSO}: row 65 (exceeding RM6,000) employer RM104.15, employee RM29.75`,
			`${EIS}: row 65 (exceeding RM6,000) RM11.90 each`,
			`${PCB}. January, n = 11. K1 = 2,750; K2 = lower of 2,750 and (4,000 − 2,750)/11 = 113.636 → 113.63. P = 22,250 + (25,000 − 113.63) × 11 − 9,000 = 22,250 + 273,750.07 − 9,000 = 287,000.07; row 100,001–400,000 (M 100,000, R 25%, B 9,400): 187,000.07 × 25% = 46,750.0175 → 46,750.01; + 9,400 = 56,150.01; / 12 = 4,679.1675 → 4,679.16 → 4,679.20`,
			'Net: 25,000 − 2,750 − 29.75 − 11.90 − 4,679.20 = 17,529.15; employer cost 3,000 + 104.15 + 11.90 = 3,116.05'
		],
		company: NO_HRD,
		inputs: [...officeWeek('2024-01-01'), ...citizen('director', 'Datin Farida', 25000)],
		period: '2026-01',
		expected: [
			{
				employment: 'director_job',
				lines: {
					gross: 25000,
					net: 17529.15,
					employer_cost: 3116.05,
					'EPF.employee': 2750,
					'EPF.employer': 3000,
					'SOCSO.employee': 29.75,
					'SOCSO.employer': 104.15,
					'EIS.employee': 11.9,
					'EIS.employer': 11.9,
					'PCB.employee': 4679.2
				}
			}
		]
	},

	// ── Part C: a permanent resident at sixty-one ──────────────────────────────────────────────────
	{
		id: 'MY-EPF-01-7',
		profile: 'MY',
		description:
			'A permanent resident aged 61 on RM3,000 in January 2026, contributing since 2015: EPF Third Schedule Part C, SOCSO Second Category (employment injury only after sixty), no EIS, resident MTD nil.',
		citation: [
			`${EPF_C}: "2,980.01 to 3,000.00" employer RM195, employee RM165`,
			`${ACT4} First Schedule para 12(ii): an employee who has attained sixty is outside the Invalidity Scheme; ${SOCSO}: row 34 Second Category employer RM36.90, no employee share before SKBBK`,
			`${ACT800} First Schedule para 8: an employee who has attained sixty is outside the Act: no EIS`,
			`${PCB}: K1 = 165; K2 = lower of 165 and 3,835/11 = 348.63 → 165; P = 2,835 × 12 − 9,000 = 25,020; 5,020 × 3% = 150.60 − 250 < 0, no MTD`,
			'Net: 3,000 − 165 = 2,835; employer cost 195 + 36.90 = 231.90'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2015-01-05'),
			...hire({
				ref: 'pr_senior',
				name: 'Wang Li PR',
				born: '1964-03-10',
				nationality: 'Chinese',
				standing: 'PERMANENT_RESIDENT',
				tax: 'RESIDENT',
				salary: 3000,
				from: '2015-01-05',
				schemes: ['EPF_PR', 'SOCSO', 'EIS']
			})
		],
		period: '2026-01',
		expected: [
			{
				employment: 'pr_senior_job',
				lines: {
					gross: 3000,
					net: 2835,
					employer_cost: 231.9,
					'EPF_PR.employee': 165,
					'EPF_PR.employer': 195,
					'SOCSO.employee': 0,
					'SOCSO.employer': 36.9
				}
			}
		]
	},

	// ── First contribution at fifty-seven: SOCSO Second Category, no EIS ────────────────────────────
	{
		id: 'MY-SOCSO-01-1',
		profile: 'MY',
		description:
			'A citizen born 15 June 1968 first employed (and first contributable) on 1 December 2025, aged 57, on RM3,000; January 2026: SOCSO Second Category only, no EIS, EPF Part A.',
		citation: [
			`${ACT4} First Schedule para 12(i): an employee who has attained fifty-five and in respect of whom no contributions were payable before fifty-five is outside the Invalidity Scheme; ${SOCSO}: row 34 Second Category employer RM36.90`,
			`${ACT800} First Schedule para 9: an employee who has attained fifty-seven and in respect of whom no contributions were payable before fifty-seven is outside the Act: no EIS`,
			`${EPF_A}: "2,980.01 to 3,000.00" employer RM390, employee RM330`,
			`${PCB}: K2 = 330; P = 23,040; no MTD`,
			'Net: 3,000 − 330 = 2,670; employer cost 390 + 36.90 = 426.90'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2025-12-01'),
			...citizen('late_joiner', 'Rahmah Late', 3000, {
				born: '1968-06-15',
				gender: 'FEMALE',
				from: '2025-12-01',
				status: {
					SOCSO: { first_contribution_due_on: '2025-12-01' },
					EIS: { first_contribution_due_on: '2025-12-01' }
				}
			})
		],
		period: '2026-01',
		expected: [
			{
				employment: 'late_joiner_job',
				lines: {
					gross: 3000,
					net: 2670,
					employer_cost: 426.9,
					'EPF.employee': 330,
					'EPF.employer': 390,
					'SOCSO.employee': 0,
					'SOCSO.employer': 36.9,
					'EIS.employee': 0,
					'EIS.employer': 0
				}
			}
		]
	},

	// ── HRD: the ten-employee threshold, unregistered ────────────────────────────────────────────
	{
		id: 'MY-HRD-01-2',
		profile: 'MY',
		description:
			'A Part I employer with exactly ten Malaysian employees, not registered with HRD Corp: the compulsory threshold is met, so the 1% levy is owed on its citizen on RM3,000.',
		citation: [
			`${HRD}; First Schedule Part I as substituted by P.U.(A) 84/2021 (https://lom.agc.gov.my/ilims/upload/portal/akta/outputp/pua_20210226_PUA84.pdf): an employer with ten or more Malaysian employees; s.14(1): 1% × 3,000 = 30.00; registration (s.13) is not a condition of the levy`,
			...PLAIN_3000_CITED,
			'Net: 2,649.35; employer cost 447.55 + 30 = 477.55'
		],
		company: hrd('NOT_REGISTERED', 10),
		inputs: [...officeWeek('2024-01-01'), ...citizen('tenth', 'Ten Threshold', 3000)],
		period: '2026-01',
		expected: [
			{
				employment: 'tenth_job',
				lines: { ...PLAIN_3000, employer_cost: 477.55, 'HRDF.employer': 30 }
			}
		]
	},

	// ── HRD: nine employees, never registered ────────────────────────────────────────────────────
	{
		id: 'MY-HRD-01-3',
		profile: 'MY',
		description:
			'A Part I employer with nine Malaysian employees that has not opted to register: below the compulsory ten, the levy applies only on registration (s.15(1)), so none.',
		citation: [
			`${HRD}; First Schedule Parts I–II as substituted by P.U.(A) 84/2021 (https://lom.agc.gov.my/ilims/upload/portal/akta/outputp/pua_20210226_PUA84.pdf): five to nine Malaysian employees is the optional class; s.15(1)–(2): the 0.5% levy is paid "upon registration" only`,
			...PLAIN_3000_CITED,
			'Net: 2,649.35; employer cost 447.55'
		],
		company: hrd('NOT_REGISTERED', 9),
		inputs: [...officeWeek('2024-01-01'), ...citizen('ninth', 'Nine Optional', 3000)],
		period: '2026-01',
		expected: [{ employment: 'ninth_job', lines: { ...PLAIN_3000, employer_cost: 447.55 } }]
	},

	// ── HRD s.15(6): back to 0.5% the year after ─────────────────────────────────────────────────
	{
		id: 'MY-HRDA06-2',
		profile: 'MY',
		description:
			'An optional registrant whose count went above its class maximum in 2025 and stayed at eight Malaysian employees after 2025: s.15(6) returns it to 0.5% in January 2026.',
		citation: [
			`${HRD}: s.15(6): "If the number of employees … remains below the maximum number for his class … after the current year, the rate of levy shall be 0.5 per centum": 0.5% × 3,000 = 15.00 (the 2025 high-rate year declared as hrd_optional_last_high_year 2025)`,
			...PLAIN_3000_CITED,
			'Net: 2,649.35; employer cost 447.55 + 15 = 462.55'
		],
		company: hrd('OPTIONAL', 8, { hrd_optional_last_high_year: 2025 }),
		inputs: [...officeWeek('2024-01-01'), ...citizen('returned', 'Aina Returned', 3000)],
		period: '2026-01',
		expected: [
			{
				employment: 'returned_job',
				lines: { ...PLAIN_3000, employer_cost: 462.55, 'HRDF.employer': 15 }
			}
		]
	},

	// ── HRD s.15(7): immediately back to 1% ──────────────────────────────────────────────────────
	{
		id: 'MY-HRDA06-3',
		profile: 'MY',
		description:
			'The same kind of registrant, back at 0.5% for 2026, has eleven Malaysian employees in February 2026: s.15(7) raises the levy to 1% immediately.',
		citation: [
			`${HRD}: s.15(7): if the number of employees of an employer referred to in s.15(6) increases to more than the maximum for his class, the rate "shall immediately increase to one per centum": 1% × 3,000 = 30.00; the Part II maximum is nine (P.U.(A) 84/2021)`,
			...PLAIN_3000_CITED.slice(0, 3),
			`${PCB}: February, n = 10: K2 = 330, P = 2,670 × 12 − 9,000 = 23,040 (the January month as paid on the same terms); no MTD`,
			'Net: 2,649.35; employer cost 447.55 + 30 = 477.55'
		],
		company: hrd('OPTIONAL', 11, { hrd_optional_last_high_year: 2025 }),
		inputs: [...officeWeek('2024-01-01'), ...citizen('grew', 'Grew Again', 3000)],
		period: '2026-02',
		expected: [
			{
				employment: 'grew_job',
				lines: { ...PLAIN_3000, employer_cost: 477.55, 'HRDF.employer': 30 }
			}
		]
	},

	// ── HRD wages: a fixed allowance in, the bonus out ────────────────────────────────────────
	{
		id: 'MY-HRDA02-1',
		profile: 'MY',
		description:
			'A citizen on RM2,800 with a fixed RM200 scale-up allowance and a RM500 bonus in January 2026 at a compulsory HRD employer: HRD levy on salary and allowance, not the bonus; SOCSO and EIS likewise; EPF on all three.',
		citation: [
			`${HRD}: s.2 "wages" is "the basic salary and fixed allowances" and "does not include … (e) any bonus or commission": 1% × (2,800 + 200) = 30.00`,
			`${EPF_WAGES}: base 3,500, "3,480.01 to 3,500.00" employee RM385 (11% of 3,500), employer RM455 (13%)`,
			`${SOCSO}; Act 4 s.2(24) includes allowances and excludes (e) any annual bonus: base 3,000, row 34 RM51.65 / RM14.75`,
			`${EIS}; Act 800 s.2 "wages" likewise: row 34 RM5.90 each`,
			`${PCB}, D(b)(2): Y1 = 3,000, K1 = EPF on 3,000 = 330, Yt = 500, Kt = 385 − 330 = 55. Step 2: K2 = (4,000 − 330 − 55)/11 = 328.636 → 328.63; P = 2,670 + 2,671.37 × 11 + 445 − 9,000 = 23,500.07; 3,500.07 × 3% = 105.00 − 250 < 0, so the year's tax and each step are nil`,
			'Net: 3,500 − 385 − 14.75 − 5.90 = 3,094.35; employer cost 455 + 51.65 + 5.90 + 30 = 542.55'
		],
		company: hrd('COMPULSORY', 12),
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('scaled', 'Suraya Scaled', 2800, {
				gender: 'FEMALE',
				terms: {
					allowances: [{ catalogue_id: '@law:allowance_catalogue:SUA', amount: 200 }]
				}
			}),
			adhoc('scaled_job', 'BONUS', 500, '2026-01-20', '2026-01')
		],
		period: '2026-01',
		expected: [
			{
				employment: 'scaled_job',
				lines: {
					gross: 3500,
					net: 3094.35,
					employer_cost: 542.55,
					BASIC: 2800,
					SUA: 200,
					BONUS: 500,
					'EPF.employee': 385,
					'EPF.employer': 455,
					'SOCSO.employee': 14.75,
					'SOCSO.employer': 51.65,
					'EIS.employee': 5.9,
					'EIS.employer': 5.9,
					'HRDF.employer': 30,
					'PCB.employee': 0
				}
			}
		]
	},

	// ── Termination benefit tiers of ten and twenty days, with the 8- and 16-day leave ladder ──────────
	{
		id: 'MY-SR10-2',
		profile: 'MY',
		description:
			'Two citizens on RM3,000 retrenched with the last day 31 March 2026 after notice served in full: one employed from 1 April 2020 (six years: 20 days a year, 16 days’ annual leave), one from 1 January 2025 (fifteen months: 10 days a year, 8 days’ leave); each is paid March, the terminating year’s leave pro rata to three completed months, and the reg.6 benefit.',
		citation: [
			`${TLB}: six years × 20 days × 36,000/365 = 4,320,000/365 = 11,835.6164 → 11,835.62; 15 months = 1.25 years × 10 days × 36,000/365 = 450,000/365 = 1,232.8767 → 1,232.88 (the twelve months’ wages stated as the exit fact wages_12m)`,
			`${EA} s.12(2)(a), (c): four weeks under two years (notice 20 February 2026, 40 days) and eight weeks at five years or more (notice 15 January 2026, 76 days): both served, no indemnity. s.60E(1)(a), (c) and proviso: 8 and 16 days a year, the terminating year in direct proportion to completed months, January–March = 3: 8 × 3/12 = 2 and 16 × 3/12 = 4 days (the 2025 leave taken in 2025). s.60E(3A) with s.60I(1A): 4 × 3,000/26 = 461.5385 → 461.54; 2 × 3,000/26 = 230.7692 → 230.77`,
			`${EPF_WAGES}; KWSP Employer FAQ 8 and 11 (leave payment is wages, termination benefit is not): 3,461.54 on "3,460.01 to 3,480.00" RM383 / RM453; 3,230.77 on "3,220.01 to 3,240.00" RM357 / RM422`,
			`${SOCSO}; the reg.6 benefit is outside the base as MY-SR10-1 records: 3,461.54 row 39 (RM3,400–3,500) RM60.35 / RM17.25; 3,230.77 row 37 (RM3,200–3,300) RM56.85 / RM16.25`,
			`${EIS}: row 39 RM6.90 each; row 37 RM6.50 each`,
			`${ITA_SCH6} para 15(1)(b): RM10,000 for each completed year exempts both benefits (60,000 ≥ 11,835.62; 10,000 ≥ 1,232.88). ${PCB}: at RM3,000 a month the year’s chargeable income stays under RM28,333 and the tax is nil`,
			'Net: 3,000 + 461.54 + 11,835.62 = 15,297.16 − 383 − 17.25 − 6.90 = 14,890.01 (employer 453 + 60.35 + 6.90 = 520.25); 3,000 + 230.77 + 1,232.88 = 4,463.65 − 357 − 16.25 − 6.50 = 4,083.90 (employer 422 + 56.85 + 6.50 = 485.35)'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2020-03-30'),
			...citizen('veteran', 'Veteran Retrench', 3000, {
				from: '2020-04-01',
				to: '2026-03-31',
				employment: retrenched('2026-01-15')
			}),
			...citizen('newer', 'Newer Retrench', 3000, {
				from: '2025-01-01',
				to: '2026-03-31',
				employment: retrenched('2026-02-20')
			}),
			exitLeave('veteran_job', 4, '2026-03-31'),
			exitLeave('newer_job', 2, '2026-03-31'),
			adhoc('veteran_job', 'TERMINATION_BENEFIT', 0, '2026-03-31', '2026-03'),
			adhoc('newer_job', 'TERMINATION_BENEFIT', 0, '2026-03-31', '2026-03')
		],
		period: '2026-03',
		expected: [
			{
				employment: 'veteran_job',
				lines: {
					gross: 15297.16,
					net: 14890.01,
					employer_cost: 520.25,
					BASIC: 3000,
					ANNUAL_LEAVE_ENCASHMENT: 461.54,
					TERMINATION_BENEFIT: 11835.62,
					'EPF.employee': 383,
					'EPF.employer': 453,
					'SOCSO.employee': 17.25,
					'SOCSO.employer': 60.35,
					'EIS.employee': 6.9,
					'EIS.employer': 6.9,
					'PCB.employee': 0
				}
			},
			{
				employment: 'newer_job',
				lines: {
					gross: 4463.65,
					net: 4083.9,
					employer_cost: 485.35,
					BASIC: 3000,
					ANNUAL_LEAVE_ENCASHMENT: 230.77,
					TERMINATION_BENEFIT: 1232.88,
					'EPF.employee': 357,
					'EPF.employer': 422,
					'SOCSO.employee': 16.25,
					'SOCSO.employer': 56.85,
					'EIS.employee': 6.5,
					'EIS.employer': 6.5,
					'PCB.employee': 0
				}
			}
		]
	},

	// ── A missing EPF registration is refused, not treated as an exemption ─────────────────────────
	{
		id: 'MY-REG-01-2',
		profile: 'MY',
		description:
			'A citizen on RM3,000 whose EPF registration is recorded NOT_REGISTERED: the run is refused, because non-registration is not a statutory EPF exemption.',
		citation: [
			'EPF Act 1991 (Act 452) s.43(1): every employee and employer shall contribute at the Third Schedule rate; the First Schedule lists the only excluded persons, and registration is a separate employer duty — a missing registration exempts no one (https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/1736246_BI/Act%20452%20(Online%202022).pdf)'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('no_epf', 'Norman NoEPF', 3000, { schemes: ['SOCSO', 'EIS'] }),
			unregistered('no_epf', 'EPF', '2024-01-02')
		],
		period: '2026-01',
		refused: 'NOT_REGISTERED does not prove a statutory EPF exemption',
		expected: []
	},

	// ── SOCSO and EIS: likewise refused ──────────────────────────────────────────────────────────
	{
		id: 'MY-REG-01-3',
		profile: 'MY',
		description:
			'A citizen on RM3,000 whose SOCSO registration is recorded NOT_REGISTERED: the run is refused rather than paying the month without the Act 4 contribution.',
		citation: [
			`${ACT4} s.6: contributions are payable in respect of every employee to whom the Act applies; s.5 and the First Schedule are the only exclusions; the employer’s registration duty does not condition liability`
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('no_socso', 'Nora NoSOCSO', 3000, { schemes: ['EPF', 'EIS'], gender: 'FEMALE' }),
			unregistered('no_socso', 'SOCSO', '2024-01-02')
		],
		period: '2026-01',
		refused: 'SOCSO: the recorded not-registered status cannot establish an exemption',
		expected: []
	},

	// ── A 181-day contract is non-resident MTD ────────────────────────────────────────────────────
	{
		id: 'MY-PCB-06-2',
		profile: 'MY',
		description:
			'A foreign worker on a 181-day contract (1 January–30 June 2026) on RM6,000, with no other presence recorded: one day short of 182, so MTD is the flat 30% non-resident rate.',
		citation: [
			`${PCB}, D(a): a non-resident employee is deducted 30% of remuneration; the resident-MTD note reaches only a foreign employee with a contract of 182 days or more: 1 January–30 June 2026 is 181 days, so 6,000 × 30% = 1,800.00. ${ITA_SCH6.replace('Schedule 6', 's.7(1)')}: no 182-day, linked, 90-day or four-year period is recorded`,
			`${EPF_F}: 120 + 120; ${SOCSO}: row 64 (RM5,900–6,000) RM104.15 / RM29.75; EIS: none for a foreign employee (Act 800 First Schedule para 10)`,
			'Net: 6,000 − 120 − 29.75 − 1,800 = 4,050.25; employer cost 120 + 104.15 = 224.15'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2025-12-29'),
			...hire({
				ref: 'contract181',
				name: 'Nguyen Contract',
				born: '1990-08-08',
				nationality: 'Vietnamese',
				standing: 'FOREIGNER',
				salary: 6000,
				from: '2026-01-01',
				to: '2026-06-30',
				type: 'CONTRACT',
				employment: {
					exit_ground: 'END_OF_CONTRACT',
					exit_facts: { notice_termination_party: 'NEITHER' }
				}
			})
		],
		period: '2026-01',
		expected: [
			{
				employment: 'contract181_job',
				lines: {
					gross: 6000,
					net: 4050.25,
					employer_cost: 224.15,
					'EPF_NON_CITIZEN.employee': 120,
					'EPF_NON_CITIZEN.employer': 120,
					'SOCSO.employee': 29.75,
					'SOCSO.employer': 104.15,
					'PCB.employee': 1800
				}
			}
		]
	},

	// ── A contract below the monthly minimum wage is refused ──────────────────────────────────────
	{
		id: 'MY-NAT-01-2',
		profile: 'MY',
		description:
			'A citizen contracted at RM1,650 a month in January 2026: below the RM1,700 floor, the run is refused rather than paying the shortfall silently.',
		citation: [
			'Minimum Wages Order 2024, P.U.(A) 376/2024 para 3(1) (https://gajiminimum.mohr.gov.my/wp-content/uploads/PUA%20376.pdf): RM1,700 a month; National Wages Consultative Council Act 2011 s.43: an employer shall pay not less than the minimum wage — the run blocks a contract below it (work_rules.wages.block_below_when)'
		],
		company: NO_HRD,
		inputs: [...officeWeek('2024-01-01'), ...citizen('underpaid', 'Umar Underpaid', 1650)],
		period: '2026-01',
		refused: 'MINIMUM_WAGE_BELOW',
		expected: []
	},

	// ── HRD education exemption: another class, the last month ────────────────────────────────────
	{
		id: 'MY-HRD11-2',
		profile: 'MY',
		description:
			'A registered employer in MSIC class 8541 (Schedule item 6, 8541/8542/8549 “Other education”) with twelve Malaysian employees: no levy for December 2026, the last exempt contribution month; SKBBK is due from June 2026.',
		citation: [
			'P.U.(A) 13/2026 (https://lom.agc.gov.my/ilims/upload/portal/akta/outputp/3268260/PUA%2013%20(2026).pdf) under Act 612 s.19: registered employers in the scheduled education classes are exempt (Schedule item 6: 8541/8542/8549 Other education) from the ss.14–15 levy to 31 December 2026 (para 1(2))',
			...PLAIN_3000_CITED.slice(0, 3),
			`${SOCSO}: SKBBK column row 34 RM22.15 (employee only)`,
			`${PCB}: December, n = 0; at RM3,000 a month the year’s P = 23,040: no MTD`,
			'Net: 3,000 − 330 − 14.75 − 22.15 − 5.90 = 2,627.20; employer cost 447.55'
		],
		company: hrd('COMPULSORY', 12, { hrd_education_schedule_code: '8541' }),
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('lecturer', 'Pensyarah Latif', 3000, {
				schemes: ['EPF', 'SOCSO', 'SKBBK', 'EIS']
			})
		],
		period: '2026-12',
		expected: [
			{
				employment: 'lecturer_job',
				lines: {
					...PLAIN_3000,
					net: 2627.2,
					employer_cost: 447.55,
					'SKBBK.employee': 22.15,
					'SKBBK.employer': 0
				}
			}
		]
	},

	// ── Form TP3: previous-employer zakat ─────────────────────────────────────────────────────────
	{
		id: 'MY-PCB-03-2',
		profile: 'MY',
		description:
			'A citizen joins on 1 April 2026 on RM5,000 and declares on Form TP3 the previous employer’s January–March: RM15,000 remuneration, RM1,650 EPF, RM330 MTD and RM150 zakat.',
		citation: [
			`${PCB}; para 10: the TP3 amounts are treated in the formula as (Y − K), X and Z; Z is the accumulated zakat paid in the current year other than the current month. As MY-PCB-03-1, P = 47,000.00, n = 8: [(12,000 × 6% = 720 + 600) − (150 + 330)] / 9 = 840 / 9 = 93.333 → 93.33 → 93.35`,
			`${EPF_A}: RM650 / RM550; ${SOCSO}: row 54 RM86.65 / RM24.75; ${EIS}: row 54 RM9.90 each`,
			'Net: 5,000 − 550 − 24.75 − 9.90 − 93.35 = 4,322.00; employer cost 746.55'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2026-03-30'),
			...citizen('tp3z', 'Zulkifli TP3', 5000, {
				from: '2026-04-01',
				pcb: {
					opening: [
						{
							year: '2026',
							base: 15000,
							employee: 330,
							employer: 0,
							rebate: 150,
							months: 3,
							reference: 'TP3'
						}
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
				employment: 'tp3z_job',
				lines: {
					gross: 5000,
					net: 4322,
					employer_cost: 746.55,
					'EPF.employee': 550,
					'EPF.employer': 650,
					'SOCSO.employee': 24.75,
					'SOCSO.employer': 86.65,
					'EIS.employee': 9.9,
					'EIS.employer': 9.9,
					'PCB.employee': 93.35
				}
			}
		]
	}
);

// ── Round 2026-09-30 (batch 9): leave with pay, Schedule 6 para 22, the aged non-citizen, SKBBK release ──
/** A time-off entry; a per-event leave names its event. */
const leave = (
	job: string,
	code: string,
	from: string,
	to: string,
	event?: string,
	/** `ref` names this entry; `episode` is the ref of the entry that opened the continuing absence. */
	link: { ref?: string; episode?: string } = {}
): ProbeInput => ({
	collection: 'leave_entries',
	...(link.ref == null ? {} : { ref: link.ref }),
	values: {
		...(link.episode == null ? {} : { episode_id: `@${link.episode}` }),
		employment_id: `@${job}`,
		catalogue_id: `@law:leave_catalogue:${code}`,
		reference: `PROBE-${code}-${from}`,
		from_date: from,
		to_date: to,
		half_day_start: false,
		half_day_end: false,
		...(event == null ? {} : { facts: { event_kind: 'BIRTH', event_date: event } }),
		reason: `probe ${code}`
	},
	files: { certificate_file: `${code.toLowerCase()}-certificate.pdf` }
});
const PLAIN_3000_EMPLOYER = 447.55;
const RELEASE =
	'PERKESO: on 8 July 2026 SKBBK (LINDUNG 24 Jam) became voluntary for Malaysian citizens and permanent residents by a signed Notis Perakuan Pelepasan Liabiliti, and stays mandatory for non-citizens (PERKESO media statement 10 July 2026, https://www.perkeso.gov.my/images/kenyataan_media/2026/100726%20-%20OPSYEN%20OPT-OUT%20LINDUNG%2024%20JAM%20DISEDIAKAN%20ISNIN%20DEPAN.pdf; LINDUNG 24 Jam FAQ 13 July 2026 Q4, Q6–8, https://www.perkeso.gov.my/images/lindung/lindung-24-jam/130726-FAQ_LINDUNG_24_JAM.pdf). The accepted release is recorded as an SKBBK fact from its effective date (docs/inventory/malaysia.csv MY-SKBBK-04 recorded default)';

register(
	// ── s.37(2): a qualifying mother on a monthly rate keeps her wages ─────────────────────────────
	{
		id: 'MY-EA22-1',
		profile: 'MY',
		description:
			'A married citizen employed since January 2024 on RM3,000 is confined on Monday 12 January 2026 and takes 98 consecutive days of maternity leave (12 January – 19 April), recorded as one episode of four per-period entries: she qualifies for the allowance and, paid monthly, keeps January’s wages unabated.',
		citation: [
			`${EA} s.37(1)(a): maternity leave of not less than ninety-eight consecutive days (12 January – 19 April 2026: 20 + 28 + 31 + 19 = 98); s.37(2)(a)(i)–(ii): employed not less than ninety days in the nine months and at some time in the four months immediately before the confinement (every day since 2 January 2024); s.37(1)(c): no surviving children recorded; s.37(2)(c): a monthly-rated employee is deemed paid the allowance when her monthly wages continue without abatement: January gross 3,000`,
			...PLAIN_3000_CITED,
			'Recording (docs/inventory/malaysia.csv MY-EA21 recorded default): s.37(1)(a) fixes one continuous period; the product records it one entry per payroll period, each later entry naming the first as its episode (leave_entries.episode_id), so each period settles its own days and the 98 days are one event',
			`Net: 2,649.35; employer cost ${PLAIN_3000_EMPLOYER}`
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('mother', 'Nurul Ibu', 3000, {
				gender: 'FEMALE',
				person: { marital_status: 'MARRIED', spouse_status: 'WITH_INCOME' }
			}),
			// One continuing absence, one entry per payroll period (a time-off entry settles whole in the period
			// holding all of its days); the later entries continue the first as its episode.
			leave('mother_job', 'MATERNITY_LEAVE', '2026-01-12', '2026-01-31', '2026-01-12', {
				ref: 'mother_maternity'
			}),
			leave('mother_job', 'MATERNITY_LEAVE', '2026-02-01', '2026-02-28', '2026-01-12', {
				episode: 'mother_maternity'
			}),
			leave('mother_job', 'MATERNITY_LEAVE', '2026-03-01', '2026-03-31', '2026-01-12', {
				episode: 'mother_maternity'
			}),
			leave('mother_job', 'MATERNITY_LEAVE', '2026-04-01', '2026-04-19', '2026-01-12', {
				episode: 'mother_maternity'
			})
		],
		period: '2026-01',
		expected: [
			{
				employment: 'mother_job',
				lines: { ...PLAIN_3000, employer_cost: PLAIN_3000_EMPLOYER, BASIC: 3000 }
			}
		]
	},

	// ── s.37(2)(a)(i): under ninety days of service, the leave is without allowance ────────────────
	{
		id: 'MY-EA22-2',
		profile: 'MY',
		description:
			'A citizen hired on 1 December 2025 on RM3,000 is confined on Tuesday 20 January 2026 after 50 days of service: she has her 98 days of maternity leave (20 January – 27 April, one episode of four per-period entries) but no allowance, so January pays s.18A(c) for the 19 days before the leave.',
		citation: [
			`${EA} s.37(1)(a): 98 consecutive days of leave (20 January – 27 April 2026: 12 + 28 + 31 + 27); s.37(2)(a)(i): employed 1 December 2025 – 19 January 2026 = 50 days, under ninety in the nine months before the confinement: no maternity allowance`,
			'Recording (docs/inventory/malaysia.csv MY-EA21 recorded default): s.37(1)(a) fixes one continuous period; the product records it one entry per payroll period, each later entry naming the first as its episode (leave_entries.episode_id), so each period settles its own days and the 98 days are one event',
			`${EA} s.18A(c): leave without pay for 12 of January’s 31 days: 3,000 × 19/31 = 1,838.7097 → 1,838.71`,
			`${EPF_A}: "1,820.01 to 1,840.00" employer RM240, employee RM203`,
			`${SOCSO}: row 23 (exceeding RM1,800, not RM1,900) employer RM32.35, employee RM9.25`,
			`${EIS}: row 23 RM3.70 each`,
			`${PCB}: K1 = K2 = 203; P = (1,838.71 − 203) × 12 − 9,000 = 10,628.52; row 5,001–20,000: 5,628.52 × 1% − 400 < 0, no MTD`,
			'Net: 1,838.71 − 203 − 9.25 − 3.70 = 1,622.76; employer cost 240 + 32.35 + 3.70 = 276.05'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2025-12-01'),
			...citizen('new_mother', 'Aina Baharu', 3000, {
				gender: 'FEMALE',
				from: '2025-12-01',
				person: { marital_status: 'MARRIED', spouse_status: 'WITH_INCOME' }
			}),
			leave('new_mother_job', 'MATERNITY_LEAVE', '2026-01-20', '2026-01-31', '2026-01-20', {
				ref: 'new_mother_maternity'
			}),
			leave('new_mother_job', 'MATERNITY_LEAVE', '2026-02-01', '2026-02-28', '2026-01-20', {
				episode: 'new_mother_maternity'
			}),
			leave('new_mother_job', 'MATERNITY_LEAVE', '2026-03-01', '2026-03-31', '2026-01-20', {
				episode: 'new_mother_maternity'
			}),
			leave('new_mother_job', 'MATERNITY_LEAVE', '2026-04-01', '2026-04-27', '2026-01-20', {
				episode: 'new_mother_maternity'
			})
		],
		period: '2026-01',
		expected: [
			{
				employment: 'new_mother_job',
				lines: {
					gross: 1838.71,
					net: 1622.76,
					employer_cost: 276.05,
					'EPF.employee': 203,
					'EPF.employer': 240,
					'SOCSO.employee': 9.25,
					'SOCSO.employer': 32.35,
					'EIS.employee': 3.7,
					'EIS.employer': 3.7
				}
			}
		]
	},

	// ── s.60F: certified sick leave is paid ────────────────────────────────────────────────────────
	{
		id: 'MY-EA34-1',
		profile: 'MY',
		description:
			'A citizen on RM3,000 with two years’ service has two days of certified sick leave, Tuesday 13 and Wednesday 14 January 2026: paid sick leave leaves January’s wages whole.',
		citation: [
			`${EA} s.60F(1)(a)(ii): eighteen days of paid sick leave a year for two to under five years’ service, on a registered medical practitioner’s certificate; two taken, no abatement of the monthly wage`,
			...PLAIN_3000_CITED,
			`Net: 2,649.35; employer cost ${PLAIN_3000_EMPLOYER}`
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('sick', 'Hafiz Sakit', 3000),
			leave('sick_job', 'MEDICAL_LEAVE', '2026-01-13', '2026-01-14')
		],
		period: '2026-01',
		expected: [
			{
				employment: 'sick_job',
				lines: { ...PLAIN_3000, employer_cost: PLAIN_3000_EMPLOYER, BASIC: 3000 }
			}
		]
	},

	// ── s.60FA: paternity leave is paid ────────────────────────────────────────────────────────────
	{
		id: 'MY-EA35-1',
		profile: 'MY',
		description:
			'A married citizen father with two years’ service takes seven consecutive days of paternity leave for his child born on Monday 12 January 2026 (12–18 January): paid leave, January’s wages whole.',
		citation: [
			`${EA} s.60FA(1)–(3): a married male employee employed by the same employer at least twelve months immediately before the leave is entitled to paid paternity leave at his ordinary rate of pay for seven consecutive days for each confinement, restricted to five confinements; no abatement of the monthly wage`,
			...PLAIN_3000_CITED,
			`Net: 2,649.35; employer cost ${PLAIN_3000_EMPLOYER}`
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('father', 'Faizal Bapa', 3000, {
				person: { marital_status: 'MARRIED', spouse_status: 'WITH_INCOME' }
			}),
			leave('father_job', 'PATERNITY_LEAVE', '2026-01-12', '2026-01-18', '2026-01-12')
		],
		period: '2026-01',
		expected: [
			{
				employment: 'father_job',
				lines: { ...PLAIN_3000, employer_cost: PLAIN_3000_EMPLOYER, BASIC: 3000 }
			}
		]
	},

	// ── Schedule 6 para 22(a): past sixty employment days the para 21 claim fails ─────────────────
	{
		id: 'MY-PCB-07-2',
		profile: 'MY',
		description:
			'A non-resident foreign specialist on a contract 1 January – 31 March 2026 on RM6,000, employment exercised in Malaysia throughout and a para 21 claim declared: by the March payroll date he has 90 employment days, over sixty, so the exemption is gone and March’s MTD is the 30% non-resident rate.',
		citation: [
			`${ITA_SCH6} para 21: exemption only for employment exercised in Malaysia for periods not exceeding sixty days; para 22(a): it does not apply where that employment exceeds sixty days — 31 + 28 + 31 = 90 recorded employment days by 31 March 2026`,
			`Income Tax Act 1967 Schedule 1 para 1A (same AGC text) and ${PCB}, D(a): a non-resident is deducted 30% of remuneration: 6,000 × 30% = 1,800 (no earlier slip in this case to recover)`,
			`${EPF_F}: 120 + 120; ${SOCSO}: row 64 RM104.15 / RM29.75; EIS: none (Act 800 First Schedule para 10)`,
			'Net: 6,000 − 120 − 29.75 − 1,800 = 4,050.25; employer cost 224.15'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2025-12-29'),
			...hire({
				ref: 'long_stay',
				name: 'Anders Longstay',
				born: '1981-04-04',
				nationality: 'Swedish',
				standing: 'FOREIGNER',
				salary: 6000,
				from: '2026-01-01',
				to: '2026-03-31',
				type: 'CONTRACT',
				employment: {
					exit_ground: 'END_OF_CONTRACT',
					exit_facts: { notice_termination_party: 'NEITHER' }
				},
				pcb: { elections: { pcb_sch6_para21: true } }
			}),
			{
				collection: 'presence_periods',
				values: {
					employee_id: '@long_stay',
					jurisdiction_code: 'MY',
					period: { from: '2026-01-01', to: '2026-03-31' },
					employment_exercised: true,
					reference: 'Passport stamps 1 January and 31 March 2026'
				}
			}
		],
		period: '2026-03',
		expected: [
			{
				employment: 'long_stay_job',
				lines: {
					gross: 6000,
					net: 4050.25,
					employer_cost: 224.15,
					'EPF_NON_CITIZEN.employee': 120,
					'EPF_NON_CITIZEN.employer': 120,
					'SOCSO.employee': 29.75,
					'SOCSO.employer': 104.15,
					'PCB.employee': 1800
				}
			}
		]
	},

	// ── A non-citizen aged 76: no EPF, SOCSO employment injury only ───────────────────────────────
	{
		id: 'MY-EPF-03-3',
		profile: 'MY',
		description:
			'A non-resident Indonesian worker aged 76 on RM2,900 in January 2026: no EPF at 75 or over (Part F included), SOCSO Second Category, no EIS, MTD at 30%.',
		citation: [
			'EPF: KWSP, Employer mandatory contribution: employees aged 14 to under 75 contribute, Malaysian or not (https://web.archive.org/web/20260810072920/https://www.kwsp.gov.my/en/employer/responsibilities/mandatory-contribution); EPF Act 1991 First Schedule para 13 (AGC text as at 1 July 2022) excludes a person who has attained seventy-five, untouched by Act A1760 s.9 (which deletes paras 6–7 only): no EPF',
			`${SOCSO}: row 33 (RM2,800–2,900) Second Category employer RM35.60, no employee share (${ACT4} First Schedule para 12: an employee who has attained sixty is insured for employment injury only)`,
			`${ACT800} First Schedule para 10 (foreign employee) and the sixty-year limit: no EIS`,
			`${PCB}, D(a): 2,900 × 30% = 870`,
			'Net: 2,900 − 870 = 2,030; employer cost 35.60'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...hire({
				ref: 'aged_foreign',
				name: 'Suparman Tua',
				born: '1949-11-20',
				standing: 'FOREIGNER',
				salary: 2900,
				from: '2024-01-02'
			})
		],
		period: '2026-01',
		expected: [
			{
				employment: 'aged_foreign_job',
				lines: {
					gross: 2900,
					net: 2030,
					employer_cost: 35.6,
					'SOCSO.employee': 0,
					'SOCSO.employer': 35.6,
					'PCB.employee': 870
				}
			}
		]
	},

	// ── SKBBK: a local’s accepted release ends the charge; a non-citizen’s does not ─────────────────
	{
		id: 'MY-SKBBK-04-1',
		profile: 'MY',
		description:
			'September 2026, two workers on RM3,000 whose SKBBK facts from 1 September record an accepted release of liability: the citizen owes no SKBBK; the non-citizen’s release is of no effect and SKBBK is still deducted.',
		citation: [
			RELEASE,
			...PLAIN_3000_CITED,
			`Non-citizen: ${EPF_F}: 60 + 60; ${SOCSO}: row 34 First Category RM51.65 / RM14.75 and SKBBK RM22.15; EIS none (Act 800 First Schedule para 10); ${PCB}, D(a): 30% × 3,000 = 900`,
			`Net: citizen 2,649.35 (employer ${PLAIN_3000_EMPLOYER}); non-citizen 3,000 − 60 − 14.75 − 22.15 − 900 = 2,003.10 (employer 111.65)`
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('released', 'Zulkifli Lepas', 3000),
			...hire({
				ref: 'foreign_release',
				name: 'Rahim Mandatory',
				born: '1994-03-14',
				nationality: 'Bangladeshi',
				standing: 'FOREIGNER',
				salary: 3000,
				from: '2024-01-02'
			}),
			...['released', 'foreign_release'].map((ref): ProbeInput => ({
				collection: 'employment_statutory_facts',
				values: {
					employee_id: `@${ref}`,
					employment_id: `@${ref}_job`,
					statutory_contribution_id: '@law:statutory_contributions:SKBBK',
					effective_range: { from: '2026-09-01', to: null },
					status: {
						kind: 'REGISTERED',
						reference_number: `PROBE-SKBBK-RELEASE-${ref}`,
						elections: { skbbk_liability_released: true }
					}
				}
			}))
		],
		period: '2026-09',
		expected: [
			{
				employment: 'released_job',
				lines: { ...PLAIN_3000, employer_cost: PLAIN_3000_EMPLOYER, 'SKBBK.employee': 0 }
			},
			{
				employment: 'foreign_release_job',
				lines: {
					gross: 3000,
					net: 2003.1,
					employer_cost: 111.65,
					'EPF_NON_CITIZEN.employee': 60,
					'EPF_NON_CITIZEN.employer': 60,
					'SOCSO.employee': 14.75,
					'SOCSO.employer': 51.65,
					'SKBBK.employee': 22.15,
					'PCB.employee': 900
				}
			}
		]
	}
);

// ── Round 2026-09-30 (batch 10): notice tiers, national service, young worker, reliefs, ORP allowance ──
/** A no-notice retrenchment on the last day of January 2026; `wages12m` states the twelve months before it (reg.6(2)). */
const retrenchedWithoutNotice = (wages12m: number) => ({
	exit_ground: 'RETRENCHMENT',
	exit_facts: {
		leaving_malaysia: false,
		wages_12m: wages12m,
		notice_termination_party: 'EMPLOYER',
		notice_approved_apprenticeship: false,
		notice_exception: 'NONE',
		notice_given: false,
		notice_waived_days: 0,
		notice_structural_ground: 'REDUCED_WORK',
		notice_exception_reference: 'PROBE retrenchment without notice'
	}
});
/** A national service call-up: s.18A(d) leave of absence, unpaid by the s.18A formula. */
const nationalService = (job: string, from: string, to: string): ProbeInput => ({
	collection: 'leave_entries',
	values: {
		employment_id: `@${job}`,
		catalogue_id: '@law:leave_catalogue:NATIONAL_SERVICE_LEAVE',
		reference: `PROBE-NS-${job}-${from}`,
		from_date: from,
		to_date: to,
		half_day_start: false,
		half_day_end: false,
		reason: 'Called up for national service training (National Service Training Act 2003)'
	}
});

register(
	// ── s.12(2)(b)–(c): the six- and eight-week indemnity tiers ────────────────────────────────────
	{
		id: 'MY-EA05-2',
		profile: 'MY',
		description:
			'Two citizens retrenched with the last day 31 January 2026 and no notice: one employed from 1 January 2023 on RM3,000 (three years one month: six weeks’ indemnity, 15-day benefit tier), one from 1 January 2020 on RM2,600 (six years one month: eight weeks, 20-day tier).',
		citation: [
			`${EA} s.12(2)(b)–(c): six weeks at two to under five years’ service, eight weeks at five or more, on the date the notice would have been given (here the last day, none given); s.12(3): not less for a retrenchment; s.13(1): the terminating party pays the wages that would have accrued during the notice term. Six weeks = 1 February – 14 March 2026: the whole of February and 14 of March’s 31 days: 3,000 + 3,000 × 14/31 = 3,000 + 1,354.8387 = 4,354.84. Eight weeks = 1 February – 28 March: 2,600 + 2,600 × 28/31 = 2,600 + 2,348.3871 = 4,948.39 (each notice day at the wage that would have accrued, apportioned by the month’s own days as s.18A does)`,
			`${TLB}: 1 January 2023 – 31 January 2026 = 37 months: 15 × 37/12 × 36,000/365 = 19,980,000/4,380 = 4,561.6438 → 4,561.64; 1 January 2020 – 31 January 2026 = 73 months: 20 × 73/12 × 31,200/365 = 45,552,000/4,380 = 10,400.00 (the twelve months’ wages stated as the exit fact wages_12m)`,
			`${EPF_WAGES}; KWSP Employer FAQ 11 lists payment in lieu of notice and termination benefits among non-wages: bases 3,000 ("2,980.01 to 3,000.00" RM330 / RM390) and 2,600 ("2,580.01 to 2,600.00" RM286 / RM338)`,
			`${SOCSO}: neither payment is Act 4 s.2(24) wages (as MY-EA05-1 and MY-SR10-1 record): row 34 RM51.65 / RM14.75; row 30 (exceeding RM2,500, not RM2,600) RM44.65 / RM12.75`,
			`${EIS}: row 34 RM5.90 each; row 30 RM5.10 each`,
			`${ITA_SCH6} para 15(1)(b): RM10,000 a completed year exempts each benefit (30,000 ≥ 4,561.64; 60,000 ≥ 10,400). ${PCB}, D(b)(2), the indemnity as additional remuneration: RM3,000: P = 2,670 × 12 + 4,354.84 − 9,000 = 27,394.84; 7,394.84 × 3% = 221.84 − 250 < 0, nil. RM2,600: K2 = 286; P = 2,314 × 12 + 4,948.39 − 9,000 = 23,716.39; 3,716.39 × 3% = 111.49 − 250 < 0, nil`,
			'Net: 3,000 + 4,354.84 + 4,561.64 = 11,916.48 − 330 − 14.75 − 5.90 = 11,565.83 (employer 447.55); 2,600 + 4,948.39 + 10,400 = 17,948.39 − 286 − 12.75 − 5.10 = 17,644.54 (employer 338 + 44.65 + 5.10 = 387.75)'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2019-12-30'),
			...citizen('six_weeks', 'Six Weeks', 3000, {
				from: '2023-01-01',
				to: '2026-01-31',
				employment: retrenchedWithoutNotice(36000)
			}),
			...citizen('eight_weeks', 'Eight Weeks', 2600, {
				from: '2020-01-01',
				to: '2026-01-31',
				employment: retrenchedWithoutNotice(31200)
			}),
			...['six_weeks_job', 'eight_weeks_job'].flatMap((job) => [
				adhoc(job, 'NOTICE_IN_LIEU', 0, '2026-01-31', '2026-01'),
				adhoc(job, 'TERMINATION_BENEFIT', 0, '2026-01-31', '2026-01')
			])
		],
		period: '2026-01',
		expected: [
			{
				employment: 'six_weeks_job',
				lines: {
					gross: 11916.48,
					net: 11565.83,
					employer_cost: 447.55,
					BASIC: 3000,
					NOTICE_IN_LIEU: 4354.84,
					TERMINATION_BENEFIT: 4561.64,
					'EPF.employee': 330,
					'EPF.employer': 390,
					'SOCSO.employee': 14.75,
					'SOCSO.employer': 51.65,
					'EIS.employee': 5.9,
					'EIS.employer': 5.9,
					'PCB.employee': 0
				}
			},
			{
				employment: 'eight_weeks_job',
				lines: {
					gross: 17948.39,
					net: 17644.54,
					employer_cost: 387.75,
					BASIC: 2600,
					NOTICE_IN_LIEU: 4948.39,
					TERMINATION_BENEFIT: 10400,
					'EPF.employee': 286,
					'EPF.employer': 338,
					'SOCSO.employee': 12.75,
					'SOCSO.employer': 44.65,
					'EIS.employee': 5.1,
					'EIS.employer': 5.1,
					'PCB.employee': 0
				}
			}
		]
	},

	// ── s.18A(d): national service, alone and with a joiner’s s.18A(a) in the same month ─────────────
	{
		id: 'MY-EA11-4',
		profile: 'MY',
		description:
			'Two citizens on RM3,000 called up for five days of national service training in January 2026: one employed throughout (Monday 12 – Friday 16 January), one who joined on Monday 5 January (Monday 19 – Friday 23 January): s.18A(d), and s.18A(a) with (d) in one month.',
		citation: [
			`${EA} s.18A(a), (d): monthly wages × days eligible in the wage period / days of the wage period. Employed throughout: 31 − 5 = 26 days, 3,000 × 26/31 = 2,516.1290 → 2,516.13. Joined 5 January: 1–4 January not employed and 5 days of national service, 31 − 4 − 5 = 22 days, 3,000 × 22/31 = 2,129.0323 → 2,129.03`,
			`${EPF_A}: "2,500.01 to 2,520.00" employer RM328, employee RM278; "2,120.01 to 2,140.00" employer RM279, employee RM236`,
			`${SOCSO}: row 30 (exceeding RM2,500, not RM2,600) RM44.65 / RM12.75; row 26 (exceeding RM2,100, not RM2,200) RM37.65 / RM10.75`,
			`${EIS}: row 30 RM5.10 each; row 26 RM4.30 each`,
			`${PCB}: K2 = 278, P = 2,238.13 × 12 − 9,000 = 17,857.56; 12,857.56 × 1% − 400 < 0, nil; the joiner is lower still`,
			'Net: 2,516.13 − 278 − 12.75 − 5.10 = 2,220.28 (employer 328 + 44.65 + 5.10 = 377.75); 2,129.03 − 236 − 10.75 − 4.30 = 1,877.98 (employer 279 + 37.65 + 4.30 = 320.95)'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('ns_serving', 'Hakim Khidmat', 3000),
			...citizen('ns_joiner', 'Amir Baharu', 3000, { from: '2026-01-05' }),
			nationalService('ns_serving_job', '2026-01-12', '2026-01-16'),
			nationalService('ns_joiner_job', '2026-01-19', '2026-01-23')
		],
		period: '2026-01',
		expected: [
			{
				employment: 'ns_serving_job',
				lines: {
					gross: 2516.13,
					net: 2220.28,
					employer_cost: 377.75,
					'EPF.employee': 278,
					'EPF.employer': 328,
					'SOCSO.employee': 12.75,
					'SOCSO.employer': 44.65,
					'EIS.employee': 5.1,
					'EIS.employer': 5.1
				}
			},
			{
				employment: 'ns_joiner_job',
				lines: {
					gross: 2129.03,
					net: 1877.98,
					employer_cost: 320.95,
					'EPF.employee': 236,
					'EPF.employer': 279,
					'SOCSO.employee': 10.75,
					'SOCSO.employer': 37.65,
					'EIS.employee': 4.3,
					'EIS.employer': 4.3
				}
			}
		]
	},

	// ── Act 800 First Schedule para 8: no EIS below eighteen ──────────────────────────────────────
	{
		id: 'MY-EIS-01-1',
		profile: 'MY',
		description:
			'A citizen aged 17 (born 15 September 2008) employed since 1 October 2025 on RM1,700 in January 2026: EPF and SOCSO First Category as for anyone, no EIS below eighteen.',
		citation: [
			`${ACT800} First Schedule para 8: "Any employee who has not attained the age of eighteen years or who has attained the age of sixty years" is outside the Act: no EIS`,
			`${ACT4} First Schedule para 12 excludes from the Invalidity Scheme only from fifty-five (first liable) or sixty; no lower age: ${SOCSO}: row 21 (RM1,600–1,700) First Category RM28.85 / RM8.25`,
			`${EPF_A}: "1,680.01 to 1,700.00" employer RM221, employee RM187 (EPF liability from age 14: KWSP, Employer mandatory contribution, https://www.kwsp.gov.my/en/employer/responsibilities/mandatory-contribution)`,
			'Minimum Wages Order 2024, P.U.(A) 376/2024 para 3(1): RM1,700 a month, paid in full',
			`${PCB}: P = (1,700 − 187) × 12 − 9,000 = 9,156; 4,156 × 1% − 400 < 0, nil`,
			'Net: 1,700 − 187 − 8.25 = 1,504.75; employer cost 221 + 28.85 = 249.85'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2025-09-29'),
			...citizen('young', 'Irfan Muda', 1700, { born: '2008-09-15', from: '2025-10-01' })
		],
		period: '2026-01',
		expected: [
			{
				employment: 'young_job',
				lines: {
					gross: 1700,
					net: 1504.75,
					employer_cost: 249.85,
					BASIC: 1700,
					'EPF.employee': 187,
					'EPF.employer': 221,
					'SOCSO.employee': 8.25,
					'SOCSO.employer': 28.85,
					'EIS.employee': 0,
					'EIS.employer': 0
				}
			}
		]
	},

	// ── A missing EIS registration is refused ─────────────────────────────────────────────────────
	{
		id: 'MY-REG-01-4',
		profile: 'MY',
		description:
			'A citizen on RM3,000 whose EIS registration is recorded NOT_REGISTERED: the run is refused rather than paying the month without the Act 800 contribution.',
		citation: [
			`${ACT800} s.18(1)–(2): the contributions in respect of an employee comprise an employer and an employee contribution at the Second Schedule rates on the monthly wages; the First Schedule lists the only excluded employees, and a citizen aged 35 is none of them — registration is a separate employer duty and exempts no one`
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('no_eis', 'Emir NoEIS', 3000, { schemes: ['EPF', 'SOCSO'] }),
			unregistered('no_eis', 'EIS', '2024-01-02')
		],
		period: '2026-01',
		refused: 'EIS: the recorded not-registered status cannot establish an exemption',
		expected: []
	},

	// ── HRD: the optional class at its lower edge ─────────────────────────────────────────────────
	{
		id: 'MY-HRD-01-4',
		profile: 'MY',
		description:
			'A Part I employer with exactly five Malaysian employees that opted to register: the lower edge of the optional class, 0.5% on its citizen on RM3,000.',
		citation: [
			`${HRD}; First Schedule Part II as substituted by P.U.(A) 84/2021 (https://lom.agc.gov.my/ilims/upload/portal/akta/outputp/pua_20210226_PUA84.pdf): an employer with five to nine Malaysian employees may register; s.15(2): 0.5% × 3,000 = 15.00`,
			...PLAIN_3000_CITED,
			'Net: 2,649.35; employer cost 447.55 + 15 = 462.55'
		],
		company: hrd('OPTIONAL', 5, { hrd_optional_last_high_year: 0 }),
		inputs: [...officeWeek('2024-01-01'), ...citizen('fifth', 'Lima Optional', 3000)],
		period: '2026-01',
		expected: [
			{
				employment: 'fifth_job',
				lines: { ...PLAIN_3000, employer_cost: 462.55, 'HRDF.employer': 15 }
			}
		]
	},

	// ── MTD reliefs: disabled spouse, disabled self, tertiary and disabled children ──────────────────
	{
		id: 'MY-PCB-02-2',
		profile: 'MY',
		description:
			'Three citizens on RM8,000 in January 2026: married to a disabled spouse without income, with one child of 20 at university in Malaysia (category 2); single and certified disabled (category 1); married to a working spouse with one disabled child under 18 and one disabled child of 19 at diploma level in Malaysia (category 3).',
		citation: [
			`${PCB}. D.2 para 14(i): (b) spouse RM4,000; (c) a child over 18 in full-time diploma-level study in Malaysia counts as four children (RM8,000), a disabled child as four (RM8,000), a disabled child studying at diploma level as eight (RM16,000); (e) disabled individual RM7,000; (f) disabled husband/wife a further RM6,000. Base as MY-EPF-01-2: K1 = 880, K2 = 283.63, P before family reliefs 83,000.07`,
			'Disabled spouse and tertiary child (category 2): P = 83,000.07 − 4,000 − 6,000 − 8,000 = 65,000.07; row 50,001–70,000: 15,000.07 × 11% = 1,650.0077 → 1,650.00 + 1,500 = 3,150.00 / 12 = 262.50',
			'Disabled individual (category 1): P = 76,000.07; row 70,001–100,000: 6,000.07 × 19% = 1,140.0133 → 1,140.01 + 3,700 = 4,840.01 / 12 = 403.3341 → 403.33 → 403.35',
			'Two disabled children (category 3): P = 83,000.07 − 8,000 − 16,000 = 59,000.07; 9,000.07 × 11% = 990.0077 → 990.00 + 1,500 = 2,490.00 / 12 = 207.50',
			`${EPF_A}: RM880 / RM960; ${SOCSO}: row 65 RM104.15 / RM29.75; ${EIS}: row 65 RM11.90 each`,
			'Net: 8,000 − 880 − 29.75 − 11.90 = 7,078.35, less 262.50 = 6,815.85, less 403.35 = 6,675.00, less 207.50 = 6,870.85; employer cost 1,076.05 each'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('carer', 'Rosli Penjaga', 8000, {
				person: {
					marital_status: 'MARRIED',
					spouse_status: 'WITHOUT_INCOME',
					children: [{ child_birthdate: '2005-03-01', relationship: 'CHILD' }]
				},
				pcb: {
					elections: { pcb_spouse_disabled: true },
					child_claims: [
						{
							year: '2026',
							relief_class: 'TERTIARY',
							full_count: 1,
							half_count: 0,
							reference: 'TP1 2026 child at university'
						}
					]
				}
			}),
			...citizen('oku', 'Salmah OKU', 8000, {
				gender: 'FEMALE',
				pcb: { elections: { pcb_disabled: true } }
			}),
			...citizen('oku_parent', 'Lim OKU Parent', 8000, {
				person: {
					marital_status: 'MARRIED',
					spouse_status: 'WITH_INCOME',
					children: [
						{ child_birthdate: '2014-06-01', relationship: 'CHILD' },
						{ child_birthdate: '2006-08-01', relationship: 'CHILD' }
					]
				},
				pcb: {
					child_claims: [
						{
							year: '2026',
							relief_class: 'DISABLED',
							full_count: 1,
							half_count: 0,
							reference: 'TP1 2026 disabled child'
						},
						{
							year: '2026',
							relief_class: 'DISABLED_TERTIARY',
							full_count: 1,
							half_count: 0,
							reference: 'TP1 2026 disabled child at diploma level'
						}
					]
				}
			})
		],
		period: '2026-01',
		expected: (
			[
				['carer_job', 262.5],
				['oku_job', 403.35],
				['oku_parent_job', 207.5]
			] as const
		).map(([employment, pcb]) => ({
			employment,
			lines: {
				gross: 8000,
				net: Math.round((7078.35 - pcb) * 100) / 100,
				employer_cost: 1076.05,
				'EPF.employee': 880,
				'EPF.employer': 960,
				'SOCSO.employee': 29.75,
				'SOCSO.employer': 104.15,
				'EIS.employee': 11.9,
				'EIS.employer': 11.9,
				'PCB.employee': pcb
			}
		}))
	},

	// ── s.60I: a fixed allowance is in the ordinary rate that prices overtime ──────────────────────
	{
		id: 'MY-EA36-1',
		profile: 'MY',
		description:
			'A citizen on RM2,340 basic plus a fixed RM260 scale-up allowance works 10 hours on Monday 5 January 2026: the s.60I ordinary rate is the RM2,600 of s.2 wages ÷ 26, so the two overtime hours are 1.5 × RM12.50.',
		citation: [
			`${EA} s.2 "wages": basic wages and all other payments in cash payable for work done, excluding only (a)–(f) (accommodation, employer fund contributions, travelling allowance, special expenses, gratuity, annual bonus): the fixed allowance is wages; s.60I(1)(a), (1A), (1)(b): ORP = 2,600 / 26 = 100.00, hourly 100 / 8 = 12.50; s.60A(3)(a): 09:00–13:00, 14:00–18:00, 18:30–20:30 = 10 h, 2 over: 2 × 1.5 × 12.50 = 37.50`,
			`${EPF_WAGES}: base 2,340 + 260 = 2,600, "2,580.01 to 2,600.00" RM338 / RM286`,
			`${SOCSO}; Act 4 and Act 800 wages include overtime: base 2,637.50, row 31 (RM2,600–2,700) RM46.35 / RM13.25`,
			`${EIS}: row 31 RM5.30 each`,
			`${PCB}: K2 = 286; P = 2,314 × 12 + 37.50 − 9,000 < 20,000 and 13,805.50 × 1% − 400 < 0: nil`,
			'Net: 2,637.50 − 286 − 13.25 − 5.30 = 2,332.95; employer cost 338 + 46.35 + 5.30 = 389.65'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('allowanced', 'Aminah Elaun', 2340, {
				gender: 'FEMALE',
				terms: { allowances: [{ catalogue_id: '@law:allowance_catalogue:SUA', amount: 260 }] }
			}),
			worked(
				'allowanced_job',
				'2026-01-05',
				[
					['09:00', '13:00'],
					['14:00', '18:00'],
					['18:30', '20:30']
				],
				2
			)
		],
		period: '2026-01',
		expected: [
			{
				employment: 'allowanced_job',
				lines: {
					gross: 2637.5,
					net: 2332.95,
					employer_cost: 389.65,
					BASIC: 2340,
					SUA: 260,
					'EPF.employee': 286,
					'EPF.employer': 338,
					'SOCSO.employee': 13.25,
					'SOCSO.employer': 46.35,
					'EIS.employee': 5.3,
					'EIS.employer': 5.3,
					'PCB.employee': 0
				}
			}
		]
	}
);

// ── Phase 2 (2026-10-01): the company terms on the MY lineage, each floored at the Act ─────────────
/**
 * The customer hour of `work_rules.ordinary_divisor_days`: basic × 12 ÷ (52 × 45) for every payroll
 * group but 5D, × 12 ÷ (52 × 42.5) for 5D, rounded to the sen by each band (owner-approved company
 * terms, 2026-09-23). Each band pays the greater of its column and the Act (EA s.7, s.60I(2)).
 */
const COMPANY =
	'MY company terms (owner-approved 2026-09-23, work_rules.authority): the hour is basic × 12 ÷ (52 × 45) — ÷ 195 — or, for payroll group 5D, ÷ (52 × 42.5 ÷ 12) = ÷ 184.17, rounded to the sen; columns 1.5 on a working or off day, 2.0 on every coded rest day, 2.0 then 3.0 on a holiday. Each band pays the greater of its column and the statutory award (EA s.60I(2): another method "shall not result in a rate which is less"; s.7 voids a less favourable term)';

/** Monday–Friday OFFICE with Saturday and Sunday both coded REST: the 5D group's week. */
const restRestWeek = (from: string): ProbeInput[] => [
	...officeWeek(from),
	{
		collection: 'shift_patterns',
		ref: 'week_5d',
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

register(
	// ── Rest-day work at the company column, age 75 and over ──────────────────────────────────────
	{
		id: 'MY-EPF-01-5',
		profile: 'MY',
		description:
			'A citizen aged 76 on RM2,600 works three Sundays in January 2026 (4, 8 and 10 hours): no EPF at 75 or over, SOCSO Second Category on the rest-day pay too, and every rest-day hour at the company 2.0 column on the customer hour 13.33, above the s.60(3) awards it is floored at.',
		citation: [
			'EPF: KWSP, Employer mandatory contribution: employees aged 14 to under 75 contribute (https://web.archive.org/web/20260810072920/https://www.kwsp.gov.my/en/employer/responsibilities/mandatory-contribution); EPF Act 1991 First Schedule para 13 (AGC text as at 1 July 2022) excludes a person who has attained seventy-five: no EPF, although the EPF Act s.2 wage would be 2,600 + 533.20 rest-day pay = 3,133.20 (only the 53.32 overtime payment is excluded)',
			`${COMPANY}: 2,600 ÷ 195 = 13.333 → 13.33`,
			`${EA} s.59(1): of the Saturday OFF and the Sunday REST, Sunday is the rest day; s.60I(1)(a), (1A), (1)(b): ORP 2,600 ÷ 26 = 100.00, hourly 100 ÷ 8 = 12.50. 11 Jan, 4 h: column 4 × 13.33 × 2 = 106.64 ≥ s.60(3)(b)(i) half a day 50.00. 18 Jan, 8 h: 8 × 13.33 × 2 = 213.28 ≥ s.60(3)(b)(ii) one day 100.00. 25 Jan, 10 h: the normal 8 at 213.28 ≥ 100.00, the 2 beyond at 2 × 13.33 × 2 = 53.32 ≥ s.60(3)(c) 2 × 12.50 × 2 = 50.00: 266.60. Total 586.52. s.60A(3): only the hours beyond the normal hours are overtime, so 106.64 + 213.28 + 213.28 = 533.20 is s.60(3)(a)/(b) rest-day pay on REST_DAY_WORK and 53.32 is OVERTIME`,
			`${SOCSO}: Act 4 wages include rest-day pay: 3,186.52 is the row exceeding RM3,100, not RM3,200: Second Category employer RM39.40`,
			'EIS: none from sixty (Act 800 First Schedule)',
			`${PCB}: at most P = 3,186.52 × 12 − 9,000 = 29,238.24; 9,238.24 × 3% − 250 = 27.15 ÷ 12 = 2.26, under RM10 (E(3)): nil`,
			'Net: 3,186.52; employer cost 39.40'
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
					gross: 3186.52,
					net: 3186.52,
					employer_cost: 39.4,
					BASIC: 2600,
					'SOCSO.employee': 0,
					'SOCSO.employer': 39.4
				}
			}
		]
	},

	// ── Ordinary-day overtime at the company hour, and HRD’s wage base ─────────────────────────────
	{
		id: 'MY-EA31-1',
		profile: 'MY',
		description:
			'A citizen on RM2,600 at an HRD-liable company works 10 hours on Monday 5 and 11 hours on Tuesday 6 January 2026: five overtime hours at the company 1.5 × 13.33, above s.60A(3) 1.5 × 12.50; EPF and HRD on the salary, SOCSO and EIS on the overtime too.',
		citation: [
			`${COMPANY}: 2,600 ÷ 195 = 13.33`,
			`${EA} s.60A(3)(a)–(c): the hours beyond the contract's normal eight at not less than 1.5 × the hourly rate, s.60I(1A), (1)(b) 2,600 ÷ 26 ÷ 8 = 12.50. Monday 2 h: 2 × 13.33 × 1.5 = 39.99 (Act 37.50); Tuesday 3 h: 3 × 13.33 × 1.5 = 59.985 → 59.99 (Act 56.25): 99.98. First Schedule para 1A: the wages are within RM4,000`,
			`${EPF_WAGES}: base 2,600, "2,580.01 to 2,600.00" RM338 / RM286`,
			`${SOCSO}; Act 4 wages include overtime: base 2,699.98, row 31 (RM2,600–2,700) RM46.35 / RM13.25`,
			`${EIS}: row 31 RM5.30 each`,
			`${HRD}: citizen at a compulsory (count 12) Part I employer, 1% × 2,600 = 26.00`,
			`${PCB}: at most P = 2,413.98 × 12 − 9,000 = 19,967.76, below the RM20,000 row after the RM400 rebate: nil`,
			'Net: 2,699.98 − 286 − 13.25 − 5.30 = 2,395.43; employer cost 338 + 46.35 + 5.30 + 26 = 415.65'
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
					gross: 2699.98,
					net: 2395.43,
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
			'Two non-resident foreign workers on RM5,200 each work 10 hours on Monday 5 January 2026: the non-manual one is over RM4,000 and owed no overtime; the manual labourer is owed it whatever the wage, at the company 1.5 × 26.67.',
		citation: [
			`${EA} First Schedule para 1A: for an employee earning over RM4,000 a month, s.60A(3) does not apply; para 2(1): an employee engaged in manual labour is covered irrespective of wages`,
			`${COMPANY}: 5,200 ÷ 195 = 26.667 → 26.67; 2 h × 26.67 × 1.5 = 80.01 ≥ s.60A(3)(a) 2 × 1.5 × 5,200 ÷ 26 ÷ 8 = 75.00`,
			`${EPF_F}; overtime is not EPF wages: 2% × 5,200 = 104 each`,
			`${SOCSO}: non-manual base 5,200, row 56 (RM5,100–5,200) RM90.15 / RM25.75; manual base 5,280.01, row 57 (RM5,200–5,300) RM91.85 / RM26.25`,
			'EIS: Act 800 First Schedule para 10: no foreign employee',
			`${PCB}, D(a): 30% of remuneration: 5,200 × 30% = 1,560.00; 5,280.01 × 30% = 1,584.003 → 1,584.00`,
			'Net: 5,200 − 104 − 25.75 − 1,560 = 3,510.25 (employer 194.15); 5,280.01 − 104 − 26.25 − 1,584 = 3,565.76 (employer 104 + 91.85 = 195.85)'
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
					gross: 5280.01,
					net: 3565.76,
					employer_cost: 195.85,
					'EPF_NON_CITIZEN.employee': 104,
					'EPF_NON_CITIZEN.employer': 104,
					'SOCSO.employee': 26.25,
					'SOCSO.employer': 91.85,
					'PCB.employee': 1584
				}
			}
		]
	},

	// ── A holiday on the rest day, its published replacement worked ───────────────────────────────
	{
		id: 'MY-EA32-1',
		profile: 'MY',
		description:
			'Federal Territory Day falls on Sunday 1 February 2026, the rest day of a Kuala Lumpur citizen on RM2,600; the company publishes Monday 2 February as its replacement, and working it eight hours pays the company holiday column 8 × 13.33 × 2 = 213.28, above the Act’s two days’ wages. Holiday work within the normal hours is EPF wages.',
		citation: [
			`${EA} s.60D(1)(a)(iii) (Federal Territory Day for an employee wholly or mainly working in the Federal Territory) and its proviso: a holiday on a rest day is replaced by the next working day; s.60D(3)(a)(i): working the holiday earns two days' wages in addition to the holiday pay, 2 × 2,600 ÷ 26 = 200.00; s.60D(2A): the month's salary is the holiday pay`,
			`${COMPANY}; holiday_rest_precedence PUBLIC_HOLIDAY: the company publishes its own replacement day (jurisdiction_holidays.replaces), which prices as the holiday: 8 × 13.33 × 2 = 213.28 ≥ 200.00`,
			`${EPF_WAGES}; KWSP Employer FAQ 21: wages for work during public holidays are subject to EPF unless the work is overtime (https://web.archive.org/web/20260810072920/https://www.kwsp.gov.my/en/employer/responsibilities/mandatory-contribution); the award within the normal hours settles on HOLIDAY_WORK: base 2,813.28, "2,800.01 to 2,820.00" RM367 / RM311`,
			`${SOCSO}; Act 800 s.2 wages include extra work on holidays: row 33 (RM2,800–2,900) RM49.85 / RM14.25`,
			`${EIS}: row 33 RM5.70 each`,
			`${PCB}: K2 = 311; at most P = 2,502.28 × 12 − 9,000 = 21,027.36; 1,027.36 × 3% − 250 < 0: nil`,
			'Net: 2,813.28 − 311 − 14.25 − 5.70 = 2,482.33; employer cost 367 + 49.85 + 5.70 = 422.55'
		],
		company: NO_HRD,
		inputs: [
			...officeWeek('2024-01-01'),
			...citizen('ftday', 'Farhan Wilayah', 2600, { state: 'KUALA_LUMPUR' }),
			holiday('2026-02-01', 'Federal Territory Day'),
			holiday('2026-02-02', 'Federal Territory Day (replacement)', '2026-02-01'),
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
					gross: 2813.28,
					net: 2482.33,
					employer_cost: 422.55,
					BASIC: 2600,
					'EPF.employee': 311,
					'EPF.employer': 367,
					'SOCSO.employee': 14.25,
					'SOCSO.employer': 49.85,
					'EIS.employee': 5.7,
					'EIS.employer': 5.7
				}
			}
		]
	},

	// ── The 2026 additional Peninsular holiday, worked ────────────────────────────────────────────
	{
		id: 'MY-PEN-HOL-01-1',
		profile: 'MY',
		description:
			'Hari Raya Puasa fell on Saturday 21 March 2026, so Friday 20 March was an additional Peninsular public holiday under Holidays Act s.8; a Selangor citizen on RM2,600 who works it eight hours is paid the company holiday column 213.28, above the Act’s two days’ wages.',
		citation: [
			'P.U.(B) 111/2026, Holidays Act 1951 s.8 (https://www.kabinet.gov.my/storage/2026/03/PUB-111_2026.pdf): 20 March 2026 is a public holiday in Peninsular Malaysia if Hari Raya Puasa falls on 21 March 2026; the Keeper of the Rulers’ Seal declared 21 March 2026 (reported: https://www.buletintv3.my/nasional/terkini-umat-islam-malaysia-sambut-aidilfitri-pada-21-mac-2026/)',
			`${EA} s.60D(1)(b): a day appointed under Holidays Act s.8 is a paid holiday; s.60D(3)(a)(i): 2 × 2,600 ÷ 26 = 200.00`,
			`${COMPANY}: 8 × 13.33 × 2 = 213.28 ≥ 200.00`,
			`${EPF_WAGES}; KWSP Employer FAQ 21 (holiday work is EPF wages unless overtime): base 2,813.28, RM367 / RM311`,
			`${SOCSO}: row 33 RM49.85 / RM14.25; ${EIS}: row 33 RM5.70 each; ${PCB}: nil`,
			'Net: 2,813.28 − 311 − 14.25 − 5.70 = 2,482.33; employer cost 422.55'
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
					gross: 2813.28,
					net: 2482.33,
					employer_cost: 422.55,
					'EPF.employee': 311,
					'EPF.employer': 367,
					'SOCSO.employee': 14.25,
					'SOCSO.employer': 49.85,
					'EIS.employee': 5.7,
					'EIS.employer': 5.7
				}
			}
		]
	},

	// ── Part-time extra hours: the Regulations’ hourly rate is the floor ───────────────────────────
	{
		id: 'MY-SR17-1',
		profile: 'MY',
		description:
			'A part-time citizen on RM1,040 for four hours a day, five days a week, beside an eight-hour full-timer, works 9.5 hours on Monday 5 January 2026: the four hours up to the full-timer’s day at 1.0 × RM10.00 and the 1.5 beyond at 1.5 × — the Regulations’ hourly rate, whatever the company divisor.',
		citation: [
			'Employment (Part-Time Employees) Regulations 2010 (JTKSM copy: https://jtksm.mohr.gov.my/sites/default/files/2023-03/10.%20Employment%20-%20Part-time%20Employees%20-%20Regulations%202010%20%20%281%29.pdf) reg.2: normal hours of work are those agreed in the contract; reg.5(1)(a): extra work beyond them up to the normal hours of a full-time employee in a similar capacity at not less than the hourly rate of pay, (b) beyond at not less than 1.5 ×; the hourly rate is EA s.60I(1)(b) the ordinary rate of pay ÷ normal hours, a monthly rate ÷ 26 under s.60I(1A)',
			`${COMPANY}; part-timers take the 26-day divisor and every part-time band pays the greater of the customer hour and the Regulations’ hourly rate: 1,040 ÷ 26 = 40.00 a day, ÷ 4 normal hours = 10.00 an hour. Monday 08:45–13:00, 13:15–17:15, 17:30–18:45 = 9.5 h, 5.5 beyond the 4: 4 h (to the full-timer’s 8) × 10.00 × 1.0 = 40.00; 1.5 h × 10.00 × 1.5 = 22.50; 62.50`,
			`${EPF_WAGES}: base 1,040, "1,020.01 to 1,040.00" RM136 / RM115`,
			`${SOCSO}: base 1,102.50, row 16 (RM1,100–1,200) RM20.15 / RM5.75; ${EIS}: row 16 RM2.30 each; ${PCB}: nil`,
			'Minimum wage: P.U.(A) 376/2024 para 5(1) RM8.72 an hour; RM1,040 for 20 hours a week (86.67 a month) is RM12.00 an hour',
			'Net: 1,102.50 − 115 − 5.75 − 2.30 = 979.45; employer cost 136 + 20.15 + 2.30 = 158.45'
		],
		company: NO_HRD,
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
			...citizen('part_extra', 'Mei Ling Separuh', 1040, {
				gender: 'FEMALE',
				type: 'PART_TIME',
				pattern: '@part_week',
				terms: {
					comparable_full_time_daily_hours: 8,
					comparable_full_time_weekly_hours: 40,
					comparable_full_time_presence: 'PRESENT'
				}
			}),
			worked(
				'part_extra_job',
				'2026-01-05',
				[
					['08:45', '13:00'],
					['13:15', '17:15'],
					['17:30', '18:45']
				],
				5.5
			)
		],
		period: '2026-01',
		expected: [
			{
				employment: 'part_extra_job',
				lines: {
					gross: 1102.5,
					net: 979.45,
					employer_cost: 158.45,
					BASIC: 1040,
					'EPF.employee': 115,
					'EPF.employer': 136,
					'SOCSO.employee': 5.75,
					'SOCSO.employer': 20.15,
					'EIS.employee': 2.3,
					'EIS.employer': 2.3
				}
			}
		]
	},

	// ── s.59(1): the earlier of two rest days is priced, not refused ──────────────────────────────
	{
		id: 'MY-EA30N-1',
		profile: 'MY',
		description:
			'A 5D-group citizen on RM2,600 whose week codes Saturday and Sunday REST works four hours on each of Saturday 10 and Sunday 11 January 2026: Sunday is the s.59(1) rest day; Saturday resolves as an off day whose hours are s.60A(3) overtime toward the 104-hour month, still paid the company rest-day column 4 × 14.12 × 2.',
		citation: [
			`${EA} s.59(1): where more than one rest day is allowed in a week, the last is the rest day for Part XII; the earlier day's work is s.60A(3) overtime at not less than 1.5 × the s.60I hour (2,600 ÷ 26 ÷ 8 = 12.50) and counts toward the Employment (Limitation of Overtime Work) Regulations 1980 reg.2 104 hours (s.60A(4)(a) proviso excludes only rest-day and holiday work)`,
			`${COMPANY}: 5D: 2,600 × 12 ÷ (52 × 42.5) = 14.1176 → 14.12. Saturday (EARLIER-REST-2.0X): 4 × 14.12 × 2 = 112.96 ≥ 4 × 12.50 × 1.5 = 75.00. Sunday (RESTDAY-2.0X): 4 × 14.12 × 2 = 112.96 ≥ s.60(3)(b)(i) half a day 50.00`,
			`${EA} s.60A(3): Sunday's 4 h are within the normal 8, so they are s.60(3)(b) rest-day pay (REST_DAY_WORK), not overtime; Saturday's off-day hours are overtime`,
			`${EPF_WAGES}: s.2 excludes only the overtime payment: base 2,600 + 112.96 (Sunday) = 2,712.96, row "2,700.01 to 2,720.00": 13% × 2,720 = 353.60 → RM354 / 11% × 2,720 = 299.20 → RM300`,
			`${SOCSO}: base 2,825.92, row 33 (RM2,800–2,900) RM49.85 / RM14.25; ${EIS}: row 33 RM5.70 each`,
			`${PCB}: K2 = 300; at most P = 2,525.92 × 12 − 9,000 = 21,311.04; 1,311.04 × 3% − 250 < 0: nil`,
			'Net: 2,825.92 − 300 − 14.25 − 5.70 = 2,505.97; employer cost 354 + 49.85 + 5.70 = 409.55'
		],
		company: NO_HRD,
		inputs: [
			...restRestWeek('2024-01-01'),
			...citizen('weekender', 'Hafiz Hujung', 2600, {
				pattern: '@week_5d',
				terms: {
					payroll_group: '5D',
					facts: { worksite_state: 'SELANGOR', contract_hours_per_week: 42.5 }
				}
			}),
			worked('weekender_job', '2026-01-10', [['09:00', '13:00']], 4),
			worked('weekender_job', '2026-01-11', [['09:00', '13:00']], 4)
		],
		period: '2026-01',
		expected: [
			{
				employment: 'weekender_job',
				lines: {
					gross: 2825.92,
					net: 2505.97,
					employer_cost: 409.55,
					BASIC: 2600,
					'EPF.employee': 300,
					'EPF.employer': 354,
					'SOCSO.employee': 14.25,
					'SOCSO.employer': 49.85,
					'EIS.employee': 5.7,
					'EIS.employer': 5.7
				}
			}
		]
	}
);

// ── An off-cycle bonus before the regular run: the salary is settled early beside it ─────────────────────
register({
	id: 'MY-OFFCYCLE-01-1',
	profile: 'MY',
	description:
		'MY-WAGEBASE-01-1 paid in two runs: the RM8,000 bonus off-cycle on 10 January 2026, before the regular run. The off-cycle act first settles the January salary early (an EARLY run at the regular pay date), then charges the bonus bill(salary + bonus) − bill(salary); a January unpaid-leave day and an overtime day recorded after it are accepted and saved unconsumed (they settle in February), and the regular run pays the person nothing. The two slips add up to the combined month to the sen.',
	citation: [
		'Owner design 2026-10-01 (off-cycle settles salary first; statutory is a monthly bill; a record made after the early settlement is recorded as usual and settles in the next period).',
		`${EPF_A}: salary month "4,100.01 to 4,200.00" employee RM462, employer 13% RM546; the whole month RM12,200 (MY-WAGEBASE-01-1) RM1,342 / RM1,586, so the bonus slip carries 1,342 − 462 = 880 and 1,586 − 546 = 1,040. ${EPF_WAGES}`,
		`${SOCSO}; Act 4 s.2(24)(e) excludes an annual bonus: row 46 RM72.65 / RM20.75 on the salary slip, nothing on the bonus`,
		`${EIS}; Act 800 s.2 "wages" (e) excludes any annual bonus: row 46 RM8.30 each on the salary slip`,
		`${PCB}, D(b)(1)–(2): the salary month is Step 1 of MY-WAGEBASE-01-1, 62.00; the bonus slip is the month's 542.00 less 62.00 = 480.00 (Steps 2–4: 1,224.00 − 744.00)`,
		'Salary slip net 4,200 − 462 − 20.75 − 8.30 − 62 = 3,646.95, employer cost 546 + 72.65 + 8.30 = 626.95; bonus slip net 8,000 − 880 − 480 = 6,640, employer cost 1,040; together 10,286.95 and 1,666.95, the combined month'
	],
	company: NO_HRD,
	inputs: [
		...officeWeek('2024-01-01'),
		...citizen('bonus', 'Hafiz Bonus', 4200),
		{ ...adhoc('bonus_job', 'BONUS', 8000, '2026-01-10', '2026-01'), ref: 'bonus_pay' }
	],
	history: [
		{
			period: '2026-01',
			kind: 'OFF_CYCLE',
			sources: ['@bonus_pay'],
			expected: [
				{
					employment: 'bonus_job',
					lines: {
						gross: 8000,
						net: 6640,
						total_deductions: 1360,
						employer_cost: 1040,
						BONUS: 8000,
						'EPF.employee': 880,
						'EPF.employer': 1040,
						'PCB.employee': 480
					}
				}
			],
			early: [
				{
					employment: 'bonus_job',
					lines: {
						gross: 4200,
						net: 3646.95,
						employer_cost: 626.95,
						BASIC: 4200,
						'EPF.employee': 462,
						'EPF.employer': 546,
						'SOCSO.employee': 20.75,
						'SOCSO.employer': 72.65,
						'EIS.employee': 8.3,
						'EIS.employer': 8.3,
						'PCB.employee': 62
					}
				}
			]
		}
	],
	event: [
		{
			collection: 'leave_entries',
			values: {
				employment_id: '@bonus_job',
				catalogue_id: '@law:leave_catalogue:UNPAID_LEAVE',
				reference: 'PROBE-NPL-2026-01-15',
				from_date: '2026-01-15',
				to_date: '2026-01-15',
				half_day_start: false,
				half_day_end: false,
				reason: 'Unpaid leave recorded after the early settlement'
			}
		},
		worked(
			'bonus_job',
			'2026-01-14',
			[
				['09:00', '13:00'],
				['14:00', '20:00']
			],
			2
		)
	],
	period: '2026-01',
	expected: [],
	absent: ['bonus_job'],
	// The settled month does not take them: they wait, unconsumed, for February's run.
	saved: [
		{
			collection: 'leave_entries',
			where: { reference: 'PROBE-NPL-2026-01-15' },
			rows: [{ payslip_id: null }]
		},
		{
			collection: 'work_days',
			where: { employment_id: '@bonus_job', work_date: '2026-01-14' },
			rows: [{ payslip_id: null }]
		}
	]
});
