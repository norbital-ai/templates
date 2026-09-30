import { register, type ProbeCase, type ProbeInput, type Row } from '../payroll-probe.ts';

/**
 * TH cases: see the case shape at the top of payroll-probe.ts. Every expected figure is worked by hand from the
 * instrument each case cites; a premise the law leaves open follows the owner rule of 2026-09-28 recorded on the
 * register row named (docs/inventory/thailand.csv) and is said so in the case.
 *
 * Law used throughout (register TH-SS-01, -11, -13; TH-PIT-01–03, -20):
 * - Social Security Act B.E.2533 (Council of State consolidation,
 *   https://searchlaw.ocs.go.th/council-of-state/#/public/doc/alJWY29wVXFRUUo0WkF2MTEwSndpQT09) s.33 insured aged 15–60,
 *   s.46 each side at the ministerial rate on the wage between floor and ceiling, a fraction of 50 satang or more a
 *   baht and less dropped; s.5 the wage is pay for normal working time and for holidays and leave not worked, overtime
 *   and holiday-work pay outside. Rate 5% (Ministerial Regulation B.E.2565 Schedule B,
 *   https://infocenter.oic.go.th/FILEWEB/CABINFOCENTER2/DRAWER056/GENERAL/DATA0000/00000773.PDF); base THB1,650–17,500
 *   from 1 January 2026 (Ministerial Regulation B.E.2568 cl.3, https://www.sso.go.th/wpr/download/download_by_pool_file/47755).
 * - Revenue Code (https://www.rd.go.th/5937.html) s.50(1) and Order P.96/2543 (https://www.rd.go.th/3558.html) cl.1:
 *   each payment × the payments due in the year (12; the remaining ones in the year of hire; 24 semi-monthly, 52
 *   weekly), the s.48(1) tax on it ÷ that number (truncated to the satang, the remainder on the year's last payment),
 *   an occasional payment withheld whole as the annual tax with it less the annual tax without it (cl.1(5)). s.42 bis
 *   50% expense, at most 100,000; s.47(1)(ก) 60,000 personal; s.47(1)(ฌ) social-security contributions (this
 *   employment's month × payments). s.48(1) table (Act No.44 s.12, https://www.rd.go.th/59670.html): 0–150,000 nil,
 *   5% to 300,000, 10% to 500,000, 15% to 750,000, 20% to 1,000,000, 25% to 2,000,000, 30% to 5,000,000, 35% above.
 * - Labour Protection Act B.E.2541 (Council of State consolidation through No.9,
 *   https://searchlaw.ocs.go.th/council-of-state/#/public/doc/ZGN3NXk0eENvNjBSdjRnT2NsdjFTQT09).
 * - Owner rule 2026-09-28 (register TH-WORK-05): a part month and an unpaid day are priced on calendar days; the day of
 *   a monthly wage for s.67 leave pay, s.17/1 and s.118 severance is monthly ÷ 30.
 *
 * Recurring figure: THB30,000 a month, insured, full year: SSO 17,500 × 5% = 875 each side; PIT 360,000 − 100,000 −
 * 60,000 − 10,500 = 189,500 → 39,500 × 5% = 1,975 ÷ 12 = 164.5833 → 164.58; net 30,000 − 875 − 164.58 = 28,960.42.
 * THB60,000: 720,000 − 170,500 = 549,500 → 27,500 + 49,500 × 15% = 34,925 ÷ 12 = 2,910.4166 → 2,910.41.
 */

const SSA =
	'Social Security Act ss.5, 33, 46 (https://searchlaw.ocs.go.th/council-of-state/#/public/doc/alJWY29wVXFRUUo0WkF2MTEwSndpQT09); 5% (MR B.E.2565 Schedule B); base THB1,650–17,500 (MR B.E.2568 cl.3, https://www.sso.go.th/wpr/download/download_by_pool_file/47755)';
const P96 =
	'Revenue Code s.50(1), ss.42 bis, 47(1)(ก)(ฌ), 48(1) (https://www.rd.go.th/5937.html, https://www.rd.go.th/59670.html); Order P.96/2543 cl.1(1)–(5) (https://www.rd.go.th/3558.html)';
const LPA =
	'https://searchlaw.ocs.go.th/council-of-state/#/public/doc/ZGN3NXk0eENvNjBSdjRnT2NsdjFTQT09';
const N14 =
	'https://www.mol.go.th/wp-content/uploads/sites/2/2025/07/%E0%B8%9B%E0%B8%A3%E0%B8%B0%E0%B8%81%E0%B8%B2%E0%B8%A8-%E0%B8%84%E0%B8%88.%E0%B8%82%E0%B8%B1%E0%B9%89%E0%B8%99%E0%B8%95%E0%B9%88%E0%B8%B3-%E0%B8%8914-%E0%B8%A3%E0%B8%A7%E0%B8%A1.pdf';
const SEVERANCE_TAX_LAW =
	'Revenue Code s.50(1) para.3, s.48(5) (https://www.rd.go.th/5937.html); DG Notification No.45 cls.1(ค)(ง), 2(ก) (https://www.rd.go.th/3213.html); MR No.126 cl.2(51) as amended by No.394 (https://www.rd.go.th/2502.html): LPA severance exempt to the last 400 days’ wage, at most 600,000, not on retirement or contract expiry; under five years no s.48(5) route, the taxable rest withheld with salary by P.96 cl.1(5) (owner rule 2026-09-28, register TH-PIT-05)';

/** 1 January 1990 is a Monday: every pattern anchors there, before any case's hire. */
const EPOCH = '1990-01-01';
type Variant = Row;
const OFFICE: Variant = {
	kind: 'WORK',
	start_time: '09:00',
	end_time: '18:00',
	break_minutes: 60,
	break_start_time: '13:00'
};

/** Mon–Fri on the given work shift, Saturday and Sunday weekly holidays (LPA s.28). */
const week = (work: Variant = OFFICE): ProbeInput[] => [
	{
		collection: 'shift_definitions',
		ref: 'work',
		values: {
			company_id: '@company',
			code: 'TH-WORK',
			name: 'Normal day',
			variant: work,
			effective_range: { from: EPOCH, to: null }
		}
	},
	{
		collection: 'shift_definitions',
		ref: 'rest',
		values: {
			company_id: '@company',
			code: 'TH-REST',
			name: 'Weekly holiday',
			variant: { kind: 'REST' },
			effective_range: { from: EPOCH, to: null }
		}
	},
	{
		collection: 'shift_patterns',
		ref: 'week',
		values: {
			company_id: '@company',
			code: 'TH-MON-FRI',
			name: '5 x work, 2 x weekly holiday',
			pattern: {
				days: ['@work', '@work', '@work', '@work', '@work', '@rest', '@rest'].map(
					(roster_code_id) => ({ roster_code_id })
				)
			},
			effective_range: { from: EPOCH, to: null }
		}
	}
];

type Person = {
	ref: string;
	wage: number;
	hire?: string;
	exit?: string;
	exit_reason?: string;
	exit_facts?: Row;
	dob?: string;
	gender?: 'MALE' | 'FEMALE';
	nationality?: string;
	terms?: Row;
	/** Later terms rows, each `{ from, to, ...fields }` over the first's fields. */
	changes?: readonly Row[];
};

const dayBefore = (date: string) =>
	new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** One employee, contract and terms: a Thai citizen, tax resident, monthly, office work in Bangkok unless stated. */
const person = (p: Person): ProbeInput[] => {
	const hire = p.hire ?? '2020-01-01';
	const job = `${p.ref}_job`;
	const terms = (from: string, to: string | null, over: Row = {}): ProbeInput => ({
		collection: 'employment_terms',
		values: {
			employment_id: `@${job}`,
			residency_status: 'CITIZEN',
			tax_residency: 'RESIDENT',
			currency: 'THB',
			base_salary: p.wage,
			pay_frequency: 'MONTHLY',
			work_classification: 'EA_COVERED',
			statutory_work_category: 'NON_MANUAL',
			employment_type: 'PERMANENT',
			worksite: 'Bangkok',
			facts: { hazardous_work: false, pregnancy_status: 'NOT_PREGNANT' },
			shift_pattern_id: '@week',
			...p.terms,
			...over,
			effective_range: { from, to }
		}
	});
	const changes = p.changes ?? [];
	return [
		{
			collection: 'employees',
			ref: p.ref,
			values: {
				name: `Probe ${p.ref}`,
				date_of_birth: p.dob ?? '1990-05-10',
				gender: p.gender ?? 'MALE',
				nationality: p.nationality ?? 'Thai'
			}
		},
		{
			collection: 'employments',
			ref: job,
			values: {
				employee_id: `@${p.ref}`,
				company_id: '@company',
				employee_number: `P-TH-${p.ref}`,
				effective_range: { from: hire, to: p.exit ?? null },
				...(p.exit_reason == null ? {} : { exit_reason: p.exit_reason }),
				...(p.exit_facts == null ? {} : { exit_facts: p.exit_facts })
			}
		},
		terms(hire, changes.length > 0 ? dayBefore(String(changes[0]!.from)) : (p.exit ?? null)),
		...changes.map((change, index) => {
			const { from, ...over } = change;
			const next = changes[index + 1];
			return terms(
				String(from),
				next == null ? (p.exit ?? null) : dayBefore(String(next.from)),
				over
			);
		})
	];
};

/** A day's attendance in Bangkok time and the overtime or holiday-work hours planned on it (consented that day). */
const workDay = (
	ref: string,
	date: string,
	intervals: readonly (readonly [string, string])[],
	approved: number
): ProbeInput => ({
	collection: 'work_days',
	values: {
		employment_id: `@${ref}_job`,
		work_date: date,
		worked_intervals: intervals.map(([start, end]) => ({
			start: `${date}T${start}:00+07:00`,
			end: `${date}T${end}:00+07:00`
		})),
		approved_overtime_hours: approved,
		overtime_consented_at: `${date}T00:00:00+07:00`
	}
});
/** 09:00–21:20 with the hour's rest at 13:00 and s.27's 20 minutes before two hours or more of overtime. */
const LONG_DAY = [
	['09:00', '13:00'],
	['14:00', '18:00'],
	['18:20', '21:20']
] as const;
const NINE_HOURS = [
	['09:00', '13:00'],
	['14:00', '19:00']
] as const;
const NORMAL_DAY = [
	['09:00', '13:00'],
	['14:00', '18:00']
] as const;

const holiday = (date: string, name: string): ProbeInput => ({
	collection: 'jurisdiction_holidays',
	values: {
		company_id: '@company',
		date,
		name,
		kind: 'PUBLIC_HOLIDAY',
		published_at: '2025-12-01T00:00:00+07:00'
	}
});

const timeOff = (
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
		reason: `Probe ${code}`,
		...extra
	}
});

/** The s.67 annual-leave payment a departure raises (leave_encashment_on_exit's row), `days` of it. */
const encashOnExit = (ref: string, exit: string, days: number): ProbeInput => ({
	collection: 'leave_entries',
	values: {
		employment_id: `@${ref}_job`,
		catalogue_id: '@law:leave_catalogue:ANNUAL_LEAVE',
		reference: `exit-${ref}-ANNUAL_LEAVE`,
		from_date: `${exit.slice(0, 4)}-01-01`,
		to_date: `${exit.slice(0, 4)}-12-31`,
		days,
		encash_days: days,
		effective_on: exit,
		due_on: exit,
		reason: 'Unused leave on departure (s.67)'
	}
});

/** An ad hoc line; a separation class at 0 is priced by its catalogue formula, as the exit settlement raises it. */
const adhoc = (ref: string, code: string, amount: number, date: string): ProbeInput => ({
	collection: 'adhoc_requests',
	values: {
		employment_id: `@${ref}_job`,
		catalogue_id: `@law:adhoc_catalogue:${code}`,
		amount,
		event_date: date,
		pay_period: date.slice(0, 7),
		reason: `${code} (probe)`
	}
});

const statutory = (ref: string, code: string, elections: Row, from: string): ProbeInput => ({
	collection: 'employment_statutory_facts',
	values: {
		employee_id: `@${ref}`,
		employment_id: `@${ref}_job`,
		statutory_contribution_id: `@law:statutory_contributions:${code}`,
		effective_range: { from, to: null },
		status: { kind: 'REGISTERED', reference_number: `PROBE-${code}-${ref}`, elections }
	}
});

/** A case on a Bangkok-time monthly company existing since 1990, the Mon–Fri week given. */
const th = (
	probe: Omit<ProbeCase, 'profile' | 'inputs'> & {
		inputs: readonly ProbeInput[];
		work?: Variant;
	}
): ProbeCase => {
	const { work, ...rest } = probe;
	return {
		...rest,
		profile: 'TH',
		company: { effective_range: { from: EPOCH, to: null }, ...probe.company },
		inputs: [...week(work), ...probe.inputs]
	};
};

/** A full-year insured THB30,000 slip with nothing else on it. */
const plain30k = {
	gross: 30_000,
	net: 28_960.42,
	employer_cost: 875,
	BASIC: 30_000,
	'SSO.employee': 875,
	'SSO.employer': 875,
	'PIT.employee': 164.58
};
/** A daily-paid slip for February 2026's 20 weekdays (2–27 February; no holiday recorded). */
const daily = (rate: number) => {
	const gross = rate * 20;
	const sso = Math.floor((gross * 5) / 100 + 0.5);
	return { gross, net: gross - sso, employer_cost: sso, 'SSO.employee': sso, 'SSO.employer': sso };
};
const dailyTerms = (worksite: string, sector?: string): Row => ({
	pay_frequency: 'DAILY',
	worksite,
	...(sector == null ? {} : { worksite_sector: sector })
});
const EXIT = '2026-03-31';
/** Notice given on payday 28 February takes effect on payday 31 March (s.17 para.2): nothing is owed in lieu. */
const SERVED = { notice_given_on: '2026-02-28' };

register(
	// ─── Notice 14 minimum wage (TH-WAGE-01, -02, -03, -04, -07) ───────────────────────────────
	th({
		id: 'TH-WAGE-01-1',
		description:
			'A monthly wage exactly at Bangkok’s THB400 × 30 = 12,000, the whole of February 2026: the run pays it (no shortfall), SSO 5% of 12,000 = 600 each side, no tax.',
		citation: [
			`Notice 14 (${N14}) and the Ministry table: Bangkok THB400 a day; cl.20 no less may be paid. Owner rule 2026-09-28 (register TH-WAGE-01): a monthly wage is held to the rate × 30 (LPA s.68’s ÷ 30): 12,000 ÷ 30 = 400 meets it.`,
			`${SSA}: 12,000 × 5% = 600.`,
			`${P96}: 144,000 − 72,000 − 60,000 − 7,200 = 4,800 → nil.`,
			'Net 12,000 − 600 = 11,400; employer cost 600.'
		],
		inputs: person({ ref: 'somchai', wage: 12_000 }),
		period: '2026-02',
		expected: [
			{
				employment: 'somchai_job',
				lines: {
					gross: 12_000,
					net: 11_400,
					employer_cost: 600,
					BASIC: 12_000,
					'SSO.employee': 600,
					'SSO.employer': 600
				}
			}
		]
	}),
	th({
		id: 'TH-WAGE-01-2',
		description:
			'A daily-paid worker at exactly Bangkok’s THB400, February 2026: paid for the 20 normal working days (the weekly holiday unpaid to the daily-paid, LPA s.56(1)): 8,000; SSO 400 each side.',
		citation: [
			`Notice 14 (${N14}): Bangkok THB400; cl.20.`,
			`LPA ss.56(1), 70 (${LPA}): a daily wage is earned for each working day; the weekly holiday is not paid to the daily-paid.`,
			`${SSA}: 8,000 × 5% = 400. ${P96}: 96,000 annualised is inside the exempt band.`,
			'Net 8,000 − 400 = 7,600.'
		],
		inputs: person({ ref: 'daeng', wage: 400, terms: dailyTerms('Bangkok') }),
		period: '2026-02',
		expected: [{ employment: 'daeng_job', lines: daily(400) }]
	}),
	th({
		id: 'TH-WAGE-02-1',
		description:
			'The three district overrides at their own floors, daily-paid, February 2026: Hat Yai THB380 and Mueang Chiang Mai THB380 (not Songkhla’s or Chiang Mai’s remainder) and Ko Samui THB400 (not Surat Thani’s 352), each paid exactly the floor.',
		citation: [
			`Notice 14 (${N14}) cls.2(3), 3 and the Ministry table: Ko Samui 400, Mueang Chiang Mai 380, Hat Yai 380.`,
			`${SSA}: 7,600 × 5% = 380; 8,000 × 5% = 400. ${P96}: nil.`
		],
		inputs: [
			...person({ ref: 'hatyai', wage: 380, terms: dailyTerms('Songkhla/Hat Yai') }),
			...person({ ref: 'mueangcm', wage: 380, terms: dailyTerms('Chiang Mai/Mueang Chiang Mai') }),
			...person({ ref: 'samui', wage: 400, terms: dailyTerms('Surat Thani/Ko Samui') })
		],
		period: '2026-02',
		expected: [
			{ employment: 'hatyai_job', lines: daily(380) },
			{ employment: 'mueangcm_job', lines: daily(380) },
			{ employment: 'samui_job', lines: daily(400) }
		]
	}),
	th({
		id: 'TH-WAGE-02-2',
		description:
			'The rest of each overridden province keeps its own floor, daily-paid, February 2026: Chiang Mai/Mae Rim THB357, Surat Thani/Mueang Surat Thani THB352 and Songkhla/Mueang Songkhla THB352, each paid exactly that.',
		citation: [
			`Notice 14 (${N14}) and the Ministry table: Chiang Mai 357, Surat Thani 352, Songkhla 352 outside the Mueang Chiang Mai, Ko Samui and Hat Yai districts; cl.20.`,
			`${SSA}: 7,140 × 5% = 357; 7,040 × 5% = 352. ${P96}: nil.`
		],
		inputs: [
			...person({ ref: 'maerim', wage: 357, terms: dailyTerms('Chiang Mai/Mae Rim') }),
			...person({ ref: 'surat', wage: 352, terms: dailyTerms('Surat Thani/Mueang Surat Thani') }),
			...person({ ref: 'songkhla', wage: 352, terms: dailyTerms('Songkhla/Mueang Songkhla') })
		],
		period: '2026-02',
		expected: [
			{ employment: 'maerim_job', lines: daily(357) },
			{ employment: 'surat_job', lines: daily(352) },
			{ employment: 'songkhla_job', lines: daily(352) }
		]
	}),
	th({
		id: 'TH-WAGE-01-3',
		description:
			'One daily-paid worker in a province of each of the 16 Notice 14 base-rate groups, February 2026, each paid exactly the group’s rate for the 20 working days.',
		citation: [
			`Notice 14 (${N14}) and the Ministry’s printed provincial table: 400 Rayong; 372 Nonthaburi; 359 Nakhon Ratchasima; 358 Samut Songkhram; 357 Khon Kaen; 356 Lop Buri; 355 Nakhon Nayok; 354 Krabi; 352 Kanchanaburi; 351 Chumphon; 350 Lamphun; 349 Roi Et; 348 Ang Thong; 347 Loei; 345 Nan; 337 Pattani; cl.20 no less may be paid.`,
			`LPA ss.56(1), 70 (${LPA}): a daily wage for each working day. ${SSA}: rate × 20 × 5%, a fraction of 50 satang or more a baht. ${P96}: at most 96,000 annualised, nil.`
		],
		inputs: (
			[
				['g400', 'Rayong', 400],
				['g372', 'Nonthaburi', 372],
				['g359', 'Nakhon Ratchasima', 359],
				['g358', 'Samut Songkhram', 358],
				['g357', 'Khon Kaen', 357],
				['g356', 'Lop Buri', 356],
				['g355', 'Nakhon Nayok', 355],
				['g354', 'Krabi', 354],
				['g352', 'Kanchanaburi', 352],
				['g351', 'Chumphon', 351],
				['g350', 'Lamphun', 350],
				['g349', 'Roi Et', 349],
				['g348', 'Ang Thong', 348],
				['g347', 'Loei', 347],
				['g345', 'Nan', 345],
				['g337', 'Pattani', 337]
			] as const
		).flatMap(([ref, site, rate]) => person({ ref, wage: rate, terms: dailyTerms(site) })),
		period: '2026-02',
		expected: (
			[400, 372, 359, 358, 357, 356, 355, 354, 352, 351, 350, 349, 348, 347, 345, 337] as const
		).map((rate) => ({ employment: `g${rate}_job`, lines: daily(rate) }))
	}),
	th({
		id: 'TH-WAGE-03-1',
		description:
			'A type-2 hotel in Mae Rim (Chiang Mai remainder 357) owes the nationwide THB400; paid exactly 400 a day, February 2026.',
		citation: [
			`Notice 14 (${N14}) cl.2(1) and explanation items 7, 12: hotels of type 2–4 THB400 nationwide; the higher rate binds.`,
			`${SSA}: 8,000 × 5% = 400.`
		],
		inputs: person({
			ref: 'hotel',
			wage: 400,
			terms: dailyTerms('Chiang Mai/Mae Rim', 'HOTEL_TYPE_2')
		}),
		period: '2026-02',
		expected: [{ employment: 'hotel_job', lines: daily(400) }]
	}),
	th({
		id: 'TH-WAGE-03-2',
		description:
			'Hotels in Yala (geographic 337), February 2026, daily-paid: type 3 and type 4 owe the nationwide THB400 and are paid it; a type 1 hotel (rooms only, at most 50) records no sector and is paid Yala’s 337.',
		citation: [
			`Notice 14 (${N14}) cl.2(1) and explanation items 7, 12: hotels of type 2–4 THB400 nationwide; a type 1 hotel keeps the geographic rate (Yala 337).`,
			`${SSA}: 8,000 × 5% = 400; 6,740 × 5% = 337. ${P96}: nil.`
		],
		inputs: [
			...person({ ref: 'type3', wage: 400, terms: dailyTerms('Yala', 'HOTEL_TYPE_3') }),
			...person({ ref: 'type4', wage: 400, terms: dailyTerms('Yala', 'HOTEL_TYPE_4') }),
			...person({ ref: 'type1', wage: 337, terms: dailyTerms('Yala') })
		],
		period: '2026-02',
		expected: [
			{ employment: 'type3_job', lines: daily(400) },
			{ employment: 'type4_job', lines: daily(400) },
			{ employment: 'type1_job', lines: daily(337) }
		]
	}),
	th({
		id: 'TH-WAGE-04-1',
		description:
			'A four-hour normal day in Mueang Chiang Mai, daily-paid at the whole THB380 (cl.19: the rate is for the normal day however short), February 2026: 20 × 380 = 7,600.',
		citation: [
			`Notice 14 (${N14}) cl.19 and explanation: the daily rate is the wage for the normal working day, not pro rata to hours.`,
			`${SSA}: 7,600 × 5% = 380.`
		],
		work: { kind: 'WORK', start_time: '09:00', end_time: '13:00', break_minutes: 0 },
		inputs: person({ ref: 'short', wage: 380, terms: dailyTerms('Chiang Mai/Mueang Chiang Mai') }),
		period: '2026-02',
		expected: [{ employment: 'short_job', lines: daily(380) }]
	}),
	th({
		id: 'TH-WAGE-04-2',
		description:
			'The same four-hour normal day in Mueang Chiang Mai, hourly-paid at THB95: 95 × 4 = 380 meets the whole day’s floor; February 2026’s 20 days: 7,600.',
		citation: [
			`Notice 14 (${N14}) cl.19: the daily rate is for the normal working day however short; cl.20: an hourly rate is held to it over the day’s paid hours: 95 × 4 = 380.`,
			`${SSA}: 7,600 × 5% = 380. ${P96}: nil.`
		],
		work: { kind: 'WORK', start_time: '09:00', end_time: '13:00', break_minutes: 0 },
		inputs: person({
			ref: 'hourly',
			wage: 95,
			terms: { pay_frequency: 'HOURLY', worksite: 'Chiang Mai/Mueang Chiang Mai' }
		}),
		period: '2026-02',
		expected: [{ employment: 'hourly_job', lines: daily(380) }]
	}),
	th({
		id: 'TH-WAGE-07-1',
		description:
			'A venue licensed under the Service Establishment Act (explanation item 13: a dance, food-and-liquor, night-club, pub, bar, massage or karaoke venue) in Yala (geographic 337) owes THB400; paid exactly 400 a day, February 2026.',
		citation: [
			`Notice 14 (${N14}) cl.2(2) and explanation items 7, 13: a service establishment under the Service Establishment Act THB400 nationwide.`,
			`${SSA}: 8,000 × 5% = 400.`
		],
		inputs: person({ ref: 'venue', wage: 400, terms: dailyTerms('Yala', 'SERVICE_ESTABLISHMENT') }),
		period: '2026-02',
		expected: [{ employment: 'venue_job', lines: daily(400) }]
	}),

	// ─── Hours, overtime and holidays (TH-WORK-02, -03, -05, -06, -07, -08) ─────────────────────
	th({
		id: 'TH-WORK-02-1',
		description:
			'A daily-paid worker (THB400, 8-hour day, hourly 50) works New Year’s Day 2026, a traditional holiday: the holiday’s own pay (s.56(2)) is kept and the work earns one more hourly rate per hour (s.62(1)); the holiday-work pay is outside the SSO wage.',
		citation: [
			`LPA ss.56(2), 62(1), 68 (${LPA}): traditional holidays are paid to every employee; work on one by an employee entitled to holiday pay earns at least 1× the hourly rate per hour; the hourly rate of a daily wage is the day ÷ normal hours = 400 ÷ 8 = 50.`,
			'January 2026 has 22 weekdays (1–2, 5–9, 12–16, 19–23, 26–30): 22 × 400 = 8,800 including the paid holiday; holiday work 8 × 50 = 400; gross 9,200.',
			`${SSA}: s.5 wage 8,800 (holiday pay in, holiday-work pay out) × 5% = 440. ${P96}: nil.`,
			'Net 9,200 − 440 = 8,760.'
		],
		inputs: [
			holiday('2026-01-01', 'New Year’s Day'),
			...person({ ref: 'noi', wage: 400, terms: dailyTerms('Bangkok') }),
			workDay('noi', '2026-01-01', NORMAL_DAY, 8)
		],
		period: '2026-01',
		expected: [
			{
				employment: 'noi_job',
				lines: {
					gross: 9_200,
					net: 8_760,
					employer_cost: 440,
					'SSO.employee': 440,
					'SSO.employer': 440
				}
			}
		]
	}),
	th({
		id: 'TH-WORK-03-1',
		description:
			'A monthly guard (THB24,000, hourly 100) in April 2026 across the 24 April cutover: 18 April weekly holiday 9 hours and 23 April 3 overtime hours under the 2009 regulation (1× per overtime hour); 24 April 3 hours at 1.25× and 25 April holiday overtime at 2.5× under the 2025 regulation; the holiday’s normal hours at s.62(1)’s 1×.',
		citation: [
			'2009 guard regulation (MoL copy, https://www.mol.go.th/wp-content/uploads/sites/2/2018/07/181.pdf): overtime and holiday overtime at one hourly rate each; 2025 regulation in force 24 April 2026 (https://ratchakitcha.soc.go.th/documents/68372.pdf): working-day overtime ≥ 1.25×, holiday overtime ≥ 2.5×.',
			`LPA ss.62(1), 68 (${LPA}): hourly 24,000 ÷ (30 × 8) = 100; holiday work 8 × 100 = 800 on each weekly holiday worked.`,
			'18 Apr 800 + 1 × 100; 23 Apr 3 × 100 = 300; 24 Apr 3 × 125 = 375; 25 Apr 800 + 1 × 250: 2,625; gross 26,625.',
			`${SSA}: s.5 wage 24,000 → ceiling 875. ${P96}: 288,000 and 290,625 annualised both under the exempt band after deductions.`,
			'Net 26,625 − 875 = 25,750.'
		],
		inputs: [
			...person({ ref: 'guard', wage: 24_000, terms: { statutory_work_category: 'GUARD_DUTY' } }),
			workDay('guard', '2026-04-18', NINE_HOURS, 9),
			workDay('guard', '2026-04-23', LONG_DAY, 3),
			workDay('guard', '2026-04-24', LONG_DAY, 3),
			workDay('guard', '2026-04-25', NINE_HOURS, 9)
		],
		period: '2026-04',
		expected: [
			{
				employment: 'guard_job',
				lines: {
					gross: 26_625,
					net: 25_750,
					employer_cost: 875,
					BASIC: 24_000,
					'SSO.employee': 875,
					'SSO.employer': 875
				}
			}
		]
	}),
	th({
		id: 'TH-WORK-05-1',
		description:
			'THB18,000 a month is THB75 an hour (monthly ÷ (30 × 8)); one overtime hour on Monday 5 January 2026 is 1.5 × 75 = 112.50.',
		citation: [
			`LPA ss.61, 68 (${LPA}): hourly rate of a monthly wage = monthly ÷ (30 × normal daily hours); working-day overtime ≥ 1.5×.`,
			`${SSA}: 18,000 → ceiling 875 (overtime outside s.5). ${P96}: 216,000 → 45,500 net → nil.`,
			'Gross 18,112.50; net 18,112.50 − 875 = 17,237.50.'
		],
		inputs: [...person({ ref: 'lek', wage: 18_000 }), workDay('lek', '2026-01-05', NINE_HOURS, 1)],
		period: '2026-01',
		expected: [
			{
				employment: 'lek_job',
				lines: {
					gross: 18_112.5,
					net: 17_237.5,
					employer_cost: 875,
					BASIC: 18_000,
					'SSO.employee': 875,
					'SSO.employer': 875
				}
			}
		]
	}),
	th({
		id: 'TH-WORK-06-1',
		description:
			'THB24,000 monthly (hourly 100), January 2026: New Year’s Day worked 8 hours (s.62(1) +1×), Monday 5 January 3 overtime hours (s.61 1.5×), Saturday 10 January weekly holiday worked 9 hours (8 at s.62(1) 1×, the ninth s.63 3×).',
		citation: [
			`LPA ss.56, 61, 62(1), 63, 68 (${LPA}): 800 + 450 + 800 + 300 = 2,350; gross 26,350.`,
			`${SSA}: 24,000 → 875. ${P96}: 288,000 and 290,350 annualised both nil after 170,500 of deductions.`,
			'Net 26,350 − 875 = 25,475.'
		],
		inputs: [
			holiday('2026-01-01', 'New Year’s Day'),
			...person({ ref: 'kanya', wage: 24_000 }),
			workDay('kanya', '2026-01-01', NORMAL_DAY, 8),
			workDay('kanya', '2026-01-05', LONG_DAY, 3),
			workDay('kanya', '2026-01-10', NINE_HOURS, 9)
		],
		period: '2026-01',
		expected: [
			{
				employment: 'kanya_job',
				lines: {
					gross: 26_350,
					net: 25_475,
					employer_cost: 875,
					BASIC: 24_000,
					'SSO.employee': 875,
					'SSO.employer': 875
				}
			}
		]
	}),
	th({
		id: 'TH-WORK-06-2',
		description:
			'A s.65(1) manager (authority to hire, reward or dismiss) on THB24,000 works the same long Monday and weekly holiday: no overtime, holiday or holiday-overtime pay (s.66).',
		citation: [
			`LPA ss.65(1), 66 (${LPA}).`,
			`${SSA}: 875. ${P96}: nil.`,
			'Net 24,000 − 875 = 23,125.'
		],
		inputs: [
			...person({ ref: 'boss', wage: 24_000, terms: { work_classification: 'MANAGERIAL' } }),
			workDay('boss', '2026-01-05', LONG_DAY, 3),
			workDay('boss', '2026-01-10', NORMAL_DAY, 8)
		],
		period: '2026-01',
		expected: [
			{
				employment: 'boss_job',
				lines: {
					gross: 24_000,
					net: 23_125,
					employer_cost: 875,
					BASIC: 24_000,
					'SSO.employee': 875,
					'SSO.employer': 875
				}
			}
		]
	}),
	th({
		id: 'TH-WORK-05-2',
		description:
			'A seven-hour normal day that is not hazardous work (09:00–17:00, an hour’s rest): THB21,000 is THB100 an hour (÷ 30 × 7) and the eighth hour is overtime; four hours on Monday 5 January 2026 at 1.5× = 600.',
		citation: [
			`LPA ss.5, 61, 68 (${LPA}): the hourly rate of a monthly wage is monthly ÷ (30 × the normal hours a day); overtime is work beyond the normal hours: 21,000 ÷ (30 × 7) = 100; 4 × 1.5 × 100 = 600.`,
			`LPA s.27 para.4: 20 minutes’ rest (17:00–17:20) before two or more hours of overtime.`,
			`${SSA}: 875. ${P96}: 252,000 → 81,500 net → nil, and 252,600 with the overtime still nil.`,
			'Gross 21,600; net 21,600 − 875 = 20,725.'
		],
		work: {
			kind: 'WORK',
			start_time: '09:00',
			end_time: '17:00',
			break_minutes: 60,
			break_start_time: '13:00'
		},
		inputs: [
			...person({ ref: 'seven', wage: 21_000 }),
			workDay(
				'seven',
				'2026-01-05',
				[
					['09:00', '13:00'],
					['14:00', '17:00'],
					['17:20', '21:20']
				],
				4
			)
		],
		period: '2026-01',
		expected: [
			{
				employment: 'seven_job',
				lines: {
					gross: 21_600,
					net: 20_725,
					employer_cost: 875,
					BASIC: 21_000,
					'SSO.employee': 875,
					'SSO.employer': 875
				}
			}
		]
	}),
	th({
		id: 'TH-WORK-07-1',
		description:
			'Hazardous work (the dated terms fact) on a seven-hour normal day (09:00–17:00, an hour’s rest), January 2026, with no overtime or holiday work, which s.31 forbids in hazardous work: the s.23 seven-hour day passes and THB21,000 is paid whole.',
		citation: [
			`LPA ss.23 para.1, 31 (${LPA}, read 30 Sep 2026): hazardous normal work at most 7 hours a day and 42 a week; no overtime or holiday work in it.`,
			`${SSA}: 875. ${P96}: 252,000 − 100,000 − 60,000 − 10,500 = 81,500 → nil.`,
			'Net 21,000 − 875 = 20,125.'
		],
		work: {
			kind: 'WORK',
			start_time: '09:00',
			end_time: '17:00',
			break_minutes: 60,
			break_start_time: '13:00'
		},
		inputs: person({
			ref: 'weld',
			wage: 21_000,
			terms: { facts: { hazardous_work: true, pregnancy_status: 'NOT_PREGNANT' } }
		}),
		period: '2026-01',
		expected: [
			{
				employment: 'weld_job',
				lines: {
					gross: 21_000,
					net: 20_125,
					employer_cost: 875,
					BASIC: 21_000,
					'SSO.employee': 875,
					'SSO.employer': 875
				}
			}
		]
	}),
	th({
		id: 'TH-WORK-08-1',
		description:
			'A daily-paid worker (THB400, hourly 50) works Saturday 10 January 2026, a weekly holiday that is unpaid to the daily-paid, and rests Sunday (six days apart): 8 hours at 2× = 800.',
		citation: [
			`LPA ss.28, 56(1), 62(2), 68 (${LPA}): a weekly holiday not more than six days apart; the daily-paid are not paid for it, so work on it earns at least 2× the hourly rate.`,
			'22 weekdays × 400 = 8,800 + 8 × 50 × 2 = 800: gross 9,600.',
			`${SSA}: 8,800 × 5% = 440. ${P96}: nil.`,
			'Net 9,600 − 440 = 9,160.'
		],
		inputs: [
			...person({ ref: 'dao', wage: 400, terms: dailyTerms('Bangkok') }),
			workDay('dao', '2026-01-10', NORMAL_DAY, 8)
		],
		period: '2026-01',
		expected: [
			{
				employment: 'dao_job',
				lines: {
					gross: 9_600,
					net: 9_160,
					employer_cost: 440,
					'SSO.employee': 440,
					'SSO.employer': 440
				}
			}
		]
	}),

	// ─── Leave (TH-LEAVE-01, -03, -05, -06, -07) ────────────────────────────────────────────────
	th({
		id: 'TH-LEAVE-01-1',
		description:
			'Maternity leave 1 January – 30 April 2026 (120 days, holidays counted) on THB31,000: the first 60 days (to 1 March) paid, March’s 2–31 unpaid at the calendar-day 1,000: March gross 1,000, below the s.33 floor so SSO on 1,650.',
		citation: [
			`LPA s.41 para.1, 3 and s.59 as amended by No.9 (in force 7 December 2025; https://ratchakitcha.soc.go.th/documents/89818.pdf, consolidation ${LPA}): up to 120 days for one pregnancy, holidays counted, wages for not more than 60 of them. 31 + 28 = 59 days to 28 February; 1 March is day 60; 2–31 March (30 days) unpaid.`,
			'Owner rule 2026-09-28 (register TH-WORK-05): an unpaid day of a monthly wage is monthly ÷ the month’s days: 31,000 ÷ 31 = 1,000; 31,000 − 30,000 = 1,000.',
			`${SSA}: a wage under 1,650 counts as 1,650: 82.50 → 83 each side. ${P96}: 12,000 annualised, nil.`,
			'Net 1,000 − 83 = 917.'
		],
		inputs: [
			...person({
				ref: 'malee',
				wage: 31_000,
				gender: 'FEMALE',
				terms: { facts: { hazardous_work: false, pregnancy_status: 'PREGNANT' } }
			}),
			...(
				[
					['2026-01-01', '2026-01-31'],
					['2026-02-01', '2026-02-28'],
					['2026-03-01', '2026-03-31'],
					['2026-04-01', '2026-04-30']
				] as const
			).map(([from, to]) =>
				timeOff('malee', 'MATERNITY_LEAVE', from, to, {
					event_kind: 'BIRTH',
					event_date: '2026-01-15'
				})
			)
		],
		period: '2026-03',
		expected: [
			{
				employment: 'malee_job',
				lines: { gross: 1_000, net: 917, employer_cost: 83, 'SSO.employee': 83, 'SSO.employer': 83 }
			}
		]
	}),
	th({
		id: 'TH-LEAVE-03-1',
		description:
			'Five days’ spouse-birth leave (9–13 February 2026) within 90 days of a 6 February birth: fully paid, the month’s pay unchanged.',
		citation: [
			`LPA ss.41/1, 59/2 as added by No.9 ss.6, 8 (https://ratchakitcha.soc.go.th/documents/89818.pdf): up to 15 days within 90 days counted from the birth, paid at the working-day wage.`,
			`${SSA}; ${P96}: the THB30,000 figures above.`
		],
		inputs: [
			...person({ ref: 'arthit', wage: 30_000 }),
			timeOff('arthit', 'CHILD_BIRTH_LEAVE', '2026-02-09', '2026-02-13', {
				event_kind: 'BIRTH',
				event_relationship: 'SPOUSE',
				event_date: '2026-02-06'
			})
		],
		period: '2026-02',
		expected: [{ employment: 'arthit_job', lines: plain30k }]
	}),
	th({
		id: 'TH-LEAVE-05-1',
		description:
			'Three days of annual leave (10–12 February 2026) after six years’ service: paid, the month’s pay unchanged.',
		citation: [
			`LPA ss.30, 56 (${LPA}): at least six working days after a year’s service, paid as a working day.`,
			`${SSA}; ${P96}: the THB30,000 figures above.`
		],
		inputs: [
			...person({ ref: 'ploy', wage: 30_000 }),
			timeOff('ploy', 'ANNUAL_LEAVE', '2026-02-10', '2026-02-12')
		],
		period: '2026-02',
		expected: [{ employment: 'ploy_job', lines: plain30k }]
	}),
	th({
		id: 'TH-LEAVE-06-1',
		description:
			'Two days of sick leave (10–11 February 2026), no certificate needed below three: paid in full.',
		citation: [
			`LPA ss.32, 57 (${LPA}): sick leave as actually ill, paid up to 30 working days a year; a certificate may be asked for from three working days.`,
			`${SSA}; ${P96}: the THB30,000 figures above.`
		],
		inputs: [
			...person({ ref: 'nok', wage: 30_000 }),
			timeOff('nok', 'SICK_LEAVE', '2026-02-10', '2026-02-11')
		],
		period: '2026-02',
		expected: [{ employment: 'nok_job', lines: plain30k }]
	}),
	th({
		id: 'TH-LEAVE-07-1',
		description:
			'Three days of personal-business leave (10–12 February 2026): paid, the most s.57/1 pays.',
		citation: [
			`LPA ss.34, 57/1 (${LPA}): at least three working days a year, wages for not more than three.`,
			`${SSA}; ${P96}: the THB30,000 figures above.`
		],
		inputs: [
			...person({ ref: 'fon', wage: 30_000 }),
			timeOff('fon', 'PERSONAL_BUSINESS_LEAVE', '2026-02-10', '2026-02-12')
		],
		period: '2026-02',
		expected: [{ employment: 'fon_job', lines: plain30k }]
	}),

	// ─── Social security (TH-SS-01, -02, -11, -12, -13) ────────────────────────────────────────
	th({
		id: 'TH-SS-01-1',
		description: 'THB15,000, the whole of February 2026: 5% each side, 750.',
		citation: [
			`${SSA}: 15,000 × 5% = 750.`,
			`${P96}: 180,000 − 90,000 − 60,000 − 9,000 = 21,000 → nil.`,
			'Net 15,000 − 750 = 14,250.'
		],
		inputs: person({ ref: 'suda', wage: 15_000 }),
		period: '2026-02',
		expected: [
			{
				employment: 'suda_job',
				lines: {
					gross: 15_000,
					net: 14_250,
					employer_cost: 750,
					BASIC: 15_000,
					'SSO.employee': 750,
					'SSO.employer': 750
				}
			}
		]
	}),
	th({
		id: 'TH-SS-01-2',
		description:
			'A joiner on Friday 27 February 2026 at THB12,000: two of February’s 28 days = 857.14, under the THB1,650 base floor, so SSO on 1,650.',
		citation: [
			'Owner rule 2026-09-28 (register TH-WORK-05): part month on calendar days: 12,000 × 2 ÷ 28 = 857.142… → 857.14.',
			`${SSA}: 1,650 × 5% = 82.50 → 83 each side (50 satang counts as a baht).`,
			`${P96}: 11 payments due from February; 857.14 × 11 annualised is nil.`,
			'Net 857.14 − 83 = 774.14.'
		],
		inputs: person({ ref: 'mint', wage: 12_000, hire: '2026-02-27' }),
		period: '2026-02',
		expected: [
			{
				employment: 'mint_job',
				lines: {
					gross: 857.14,
					net: 774.14,
					employer_cost: 83,
					BASIC: 857.14,
					'SSO.employee': 83,
					'SSO.employer': 83
				}
			}
		]
	}),
	th({
		id: 'TH-SS-02-1',
		description:
			'A registered employer in Songkhla (flood-relief area), February 2026: 3% each side instead of 5%; 12,250 → 367.50 → 368, and 60,000 at the 17,500 ceiling → 525.',
		citation: [
			'Ministry of Labour notice under SSA s.46/1, Gazette vol.143 special part 6 Ngor p.7, 8 January 2026 (https://ratchakitcha.soc.go.th/documents/100888.pdf) cl.1: employers registered in the nine southern provinces (Songkhla among them) and their s.33 insured contribute 3% each for wage months December 2025–May 2026.',
			`${SSA}: 12,250 × 3% = 367.50 → 368; 17,500 × 3% = 525.`,
			`${P96}: 12,250: nil. 60,000: 720,000 − 100,000 − 60,000 − 525 × 12 = 553,700 → 27,500 + 53,700 × 15% = 35,555 ÷ 12 = 2,962.9166 → 2,962.91.`,
			'Nets 12,250 − 368 = 11,882; 60,000 − 525 − 2,962.91 = 56,512.09.'
		],
		company: { facts: { sso_flood_relief_area: true } },
		inputs: [
			...person({ ref: 'south', wage: 12_250, terms: { worksite: 'Songkhla/Hat Yai' } }),
			...person({ ref: 'southcap', wage: 60_000, terms: { worksite: 'Songkhla/Hat Yai' } })
		],
		period: '2026-02',
		expected: [
			{
				employment: 'south_job',
				lines: {
					gross: 12_250,
					net: 11_882,
					employer_cost: 368,
					'SSO.employee': 368,
					'SSO.employer': 368
				}
			},
			{
				employment: 'southcap_job',
				lines: {
					gross: 60_000,
					net: 56_512.09,
					employer_cost: 525,
					'SSO.employee': 525,
					'SSO.employer': 525,
					'PIT.employee': 2_962.91
				}
			}
		]
	}),
	th({
		id: 'TH-SS-02-2',
		description:
			'The same Songkhla employer in June 2026, after the relief window (wage months to May 2026): back to 5%, 12,250 → 612.50 → 613.',
		citation: [
			'Flood-relief notice cl.1 (https://ratchakitcha.soc.go.th/documents/100888.pdf): the 3% applies to wage months December 2025–May 2026 only.',
			`${SSA}: 12,250 × 5% = 612.50 → 613. ${P96}: nil.`,
			'Net 12,250 − 613 = 11,637.'
		],
		company: { facts: { sso_flood_relief_area: true } },
		inputs: person({ ref: 'june', wage: 12_250, terms: { worksite: 'Songkhla/Hat Yai' } }),
		period: '2026-06',
		expected: [
			{
				employment: 'june_job',
				lines: {
					gross: 12_250,
					net: 11_637,
					employer_cost: 613,
					'SSO.employee': 613,
					'SSO.employer': 613
				}
			}
		]
	}),
	th({
		id: 'TH-SS-11-1',
		description:
			's.46 rounding at every seam, February 2026: 12,345 → 617.25 → 617; 13,999 → 699.95 → 700; 17,489 → 874.45 → 874; 17,490 → 874.50 → 875; 17,500.01 capped → 875; Yala 10,209 → 510.45 → 510 and 10,210 → 510.50 → 511.',
		citation: [
			`${SSA}: a fraction of 50 satang or more counts as one baht, less is dropped, each person’s share rounded on its own.`,
			`Notice 14 (${N14}): Yala THB337 × 30 = 10,110 ≤ 10,209, Bangkok 12,000 ≤ the rest.`,
			`${P96}: every wage here is nil after deductions (17,500.01 × 12 = 210,000.12 → 39,500 net).`
		],
		inputs: [
			...person({ ref: 'r12345', wage: 12_345 }),
			...person({ ref: 'r13999', wage: 13_999 }),
			...person({ ref: 'r17489', wage: 17_489 }),
			...person({ ref: 'r17490', wage: 17_490 }),
			...person({ ref: 'r17500', wage: 17_500.01 }),
			...person({ ref: 'y10209', wage: 10_209, terms: { worksite: 'Yala' } }),
			...person({ ref: 'y10210', wage: 10_210, terms: { worksite: 'Yala' } })
		],
		period: '2026-02',
		expected: (
			[
				['r12345', 12_345, 617],
				['r13999', 13_999, 700],
				['r17489', 17_489, 874],
				['r17490', 17_490, 875],
				['r17500', 17_500.01, 875],
				['y10209', 10_209, 510],
				['y10210', 10_210, 511]
			] as const
		).map(([ref, wage, share]) => ({
			employment: `${ref}_job`,
			lines: {
				gross: wage,
				net: Math.round((wage - share) * 100) / 100,
				employer_cost: share,
				'SSO.employee': share,
				'SSO.employer': share
			}
		}))
	}),
	th({
		id: 'TH-SS-12-1',
		description:
			'Age under s.33, February 2026, THB30,000: a 62-year-old insured since 2019 stays insured; a hire on 1 February 2026 aged 60 (born 2 February 1965) enters; one aged 61 (born 1 February 1965) does not, and has no contribution to relieve.',
		citation: [
			`Social Security Act s.33 para.1, s.38 (https://searchlaw.ocs.go.th/council-of-state/#/public/doc/alJWY29wVXFRUUo0WkF2MTEwSndpQT09): an employee not under 15 and not over 60 full years is insured; insurance ends on death or leaving employment.`,
			`${P96}: 62-year-old 164.58 (full year). Hires in February: 11 payments. Aged 60: 330,000 − 100,000 − 60,000 − 875 × 11 = 160,375 → 10,375 × 5% = 518.75 ÷ 11 = 47.159 → 47.15. Aged 61: no SSO relief: 170,000 → 1,000 ÷ 11 = 90.909 → 90.90.`,
			'Nets: 28,960.42; 30,000 − 875 − 47.15 = 29,077.85; 30,000 − 90.90 = 29,909.10.'
		],
		inputs: [
			...person({ ref: 'old62', wage: 30_000, dob: '1963-08-20', hire: '2019-02-01' }),
			...person({ ref: 'new60', wage: 30_000, dob: '1965-02-02', hire: '2026-02-01' }),
			...person({ ref: 'new61', wage: 30_000, dob: '1965-02-01', hire: '2026-02-01' })
		],
		period: '2026-02',
		expected: [
			{ employment: 'old62_job', lines: plain30k },
			{
				employment: 'new60_job',
				lines: {
					gross: 30_000,
					net: 29_077.85,
					employer_cost: 875,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 47.15
				}
			},
			{
				employment: 'new61_job',
				lines: { gross: 30_000, net: 29_909.1, employer_cost: 0, 'PIT.employee': 90.9 }
			}
		]
	}),
	th({
		id: 'TH-SS-13-1',
		description:
			'THB15,000 and three overtime hours on Monday 5 January 2026 (hourly 62.50, 3 × 1.5 × 62.50 = 281.25): SSO on the 15,000 salary alone.',
		citation: [
			`Social Security Act s.5 (ค่าจ้าง): pay for normal working time; overtime outside. ${SSA}: 750.`,
			`LPA ss.61, 68 (${LPA}): 15,000 ÷ 240 = 62.50. ${P96}: nil.`,
			'Gross 15,281.25; net 15,281.25 − 750 = 14,531.25.'
		],
		inputs: [...person({ ref: 'wan', wage: 15_000 }), workDay('wan', '2026-01-05', LONG_DAY, 3)],
		period: '2026-01',
		expected: [
			{
				employment: 'wan_job',
				lines: {
					gross: 15_281.25,
					net: 14_531.25,
					employer_cost: 750,
					BASIC: 15_000,
					'SSO.employee': 750,
					'SSO.employer': 750
				}
			}
		]
	}),
	th({
		id: 'TH-SS-13-2',
		description:
			'Two days of unpaid leave (Wednesday 14 and Thursday 15 January 2026) on THB15,500: 500 a calendar day off, 14,500 paid, and SSO on the 14,500 actually paid.',
		citation: [
			'Owner rule 2026-09-28 (register TH-WORK-05): an unpaid day is monthly ÷ the month’s days: 15,500 ÷ 31 = 500; 2 × 500 = 1,000.',
			`Social Security Act s.5: the wage is what is paid for normal working time. ${SSA}: 14,500 × 5% = 725.`,
			`${P96}: 174,000 − 87,000 − 60,000 − 8,700 = 18,300 → nil.`,
			'Net 14,500 − 725 = 13,775.'
		],
		inputs: [
			...person({ ref: 'pim', wage: 15_500 }),
			timeOff('pim', 'UNPAID_LEAVE', '2026-01-14', '2026-01-15')
		],
		period: '2026-01',
		expected: [
			{
				employment: 'pim_job',
				lines: {
					gross: 14_500,
					net: 13_775,
					employer_cost: 725,
					'SSO.employee': 725,
					'SSO.employer': 725
				}
			}
		]
	}),

	th({
		id: 'TH-SS-13-3',
		description:
			'THB15,000 a month (hourly 62.50), January 2026: two days’ annual leave (14–15 January) paid in the month’s salary, and Saturday 10 January, a weekly holiday, worked 9 hours (8 at s.62(1) 1× = 500, the ninth at s.63 3× = 187.50): SSO on the 15,000 alone.',
		citation: [
			`Social Security Act s.5 (ค่าจ้าง): pay for normal working time and for holidays and leave not worked is wage; holiday-work and holiday-overtime pay are not. ${SSA}: 15,000 × 5% = 750.`,
			`LPA ss.30, 56, 62(1), 63, 68 (${LPA}): 15,000 ÷ 240 = 62.50; 8 × 62.50 = 500; 1 × 3 × 62.50 = 187.50.`,
			`${P96}: 180,000 − 90,000 − 60,000 − 9,000 = 21,000, and with the 687.50 still inside the exempt band: nil.`,
			'Gross 15,687.50; net 15,687.50 − 750 = 14,937.50.'
		],
		inputs: [
			...person({ ref: 'rin', wage: 15_000 }),
			timeOff('rin', 'ANNUAL_LEAVE', '2026-01-14', '2026-01-15'),
			workDay('rin', '2026-01-10', NINE_HOURS, 9)
		],
		period: '2026-01',
		expected: [
			{
				employment: 'rin_job',
				lines: {
					gross: 15_687.5,
					net: 14_937.5,
					employer_cost: 750,
					BASIC: 15_000,
					'SSO.employee': 750,
					'SSO.employer': 750
				}
			}
		]
	}),

	// ─── Employee Welfare Fund (TH-EWF-01, -02) ─────────────────────────────────────────────────
	th({
		id: 'TH-EWF-01-1',
		description:
			'Ten employees on THB20,000 in October 2026: the fund covers them at 0.25% each side (50); the one in the employer’s registered provident fund is outside it.',
		citation: [
			`LPA s.130 para.1 (${LPA}): employees of a business with ten or more employees are members; para.2 takes out a business whose employer provides a provident fund or exit/death welfare under the Ministerial Regulation, and the per-member exclusion of a member of the employer’s registered provident fund follows the 2024 alternative-arrangement regulation (https://www.ocs.go.th/searchlaw/law-index/item/13230). Commencement decree (https://ratchakitcha.soc.go.th/documents/84794.pdf): from 1 October 2026. Rate regulation B.E.2568 cl.3(1) (Gazette vol.142 part 60 Kor pp.3–4): 0.25% each side; 20,000 × 0.25% = 50.`,
			`${SSA}: 875. ${P96}: 240,000 − 170,500 = 69,500 → nil.`,
			'Nets 20,000 − 875 − 50 = 19,075 (employer 925); the provident-fund member 19,125 (employer 875).'
		],
		inputs: [
			...Array.from({ length: 10 }, (_, index) =>
				person({ ref: `ewf${index}`, wage: 20_000 })
			).flat(),
			statutory(
				'ewf9',
				'EWF',
				{
					provident_fund_member: true,
					provident_fund_registration_reference: 'PVD-plan-7',
					provident_fund_membership_reference: 'PVD-member-9'
				},
				'2026-10-01'
			)
		],
		period: '2026-10',
		expected: [
			{
				employment: 'ewf0_job',
				lines: {
					gross: 20_000,
					net: 19_075,
					employer_cost: 925,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'EWF.employee': 50,
					'EWF.employer': 50
				}
			},
			{
				employment: 'ewf9_job',
				lines: {
					gross: 20_000,
					net: 19_125,
					employer_cost: 875,
					'SSO.employee': 875,
					'SSO.employer': 875
				}
			}
		]
	}),
	th({
		id: 'TH-EWF-01-2',
		description:
			'Nine employees on THB20,000 in October 2026, none a voluntary member: the business is under ten, so no fund contribution.',
		citation: [
			`LPA s.130 paras 1, 3 (${LPA}): membership is for a business of ten or more employees; a smaller business only by Royal Decree (none issued) or voluntary membership (para.4).`,
			`${SSA}: 875. ${P96}: 240,000 − 170,500 = 69,500 → nil.`,
			'Net 20,000 − 875 = 19,125.'
		],
		inputs: Array.from({ length: 9 }, (_, index) =>
			person({ ref: `small${index}`, wage: 20_000 })
		).flat(),
		period: '2026-10',
		expected: Array.from({ length: 9 }, (_, index) => ({
			employment: `small${index}_job`,
			lines: {
				gross: 20_000,
				net: 19_125,
				employer_cost: 875,
				'SSO.employee': 875,
				'SSO.employer': 875
			}
		}))
	}),
	th({
		id: 'TH-EWF-02-1',
		description:
			'A voluntary fund member of a business under ten, THB60,000 in October 2026: 0.25% each side on the whole wage, no ceiling: 150.',
		citation: [
			`LPA s.130 para.4 (${LPA}): voluntary membership at the worker’s request with employer consent; rate regulation B.E.2568 cl.3(1): 0.25% each side, no wage ceiling stated: 60,000 × 0.25% = 150.`,
			`${SSA}: 875. ${P96}: 2,910.41 (the fund contribution is no s.47 allowance).`,
			'Net 60,000 − 875 − 150 − 2,910.41 = 56,064.59; employer 1,025.'
		],
		inputs: [
			...person({ ref: 'vol', wage: 60_000 }),
			statutory(
				'vol',
				'EWF',
				{
					voluntary_ewf_member: true,
					voluntary_ewf_consent_reference: 'worker-and-employer-consent-7',
					voluntary_ewf_certificate_reference: 'DLPW-certificate-9'
				},
				'2026-10-01'
			)
		],
		period: '2026-10',
		expected: [
			{
				employment: 'vol_job',
				lines: {
					gross: 60_000,
					net: 56_064.59,
					employer_cost: 1_025,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'EWF.employee': 150,
					'EWF.employer': 150,
					'PIT.employee': 2_910.41
				}
			}
		]
	}),
	th({
		id: 'TH-EWF-02-2',
		description: 'September 2026, the month before the fund starts: no contribution.',
		citation: [
			'Commencement decree (https://ratchakitcha.soc.go.th/documents/84794.pdf): collection from 1 October 2026.',
			`${SSA}: 875. ${P96}: nil. Net 20,000 − 875 = 19,125.`
		],
		inputs: person({ ref: 'sept', wage: 20_000 }),
		period: '2026-09',
		expected: [
			{
				employment: 'sept_job',
				lines: {
					gross: 20_000,
					net: 19_125,
					employer_cost: 875,
					'SSO.employee': 875,
					'SSO.employer': 875
				}
			}
		]
	}),

	th({
		id: 'TH-EWF-02-3',
		description:
			'The same voluntary member on THB60,000 in October 2031, the first month of the 0.50% step: 300 each side; SSO at the 2029–2031 THB20,000 ceiling, 1,000.',
		citation: [
			'EWF rate regulation B.E.2568 cl.3(2) (Gazette vol.142 part 60 Kor pp.3–4, https://ratchakitcha.soc.go.th/documents/86102.pdf; Council of State copy https://www.ocs.go.th/searchlaw/law-index/item/13221): 0.50% each side from 1 October 2031, no wage ceiling: 60,000 × 0.5% = 300.',
			'Social Security Act ss.33, 46 (https://searchlaw.ocs.go.th/council-of-state/#/public/doc/alJWY29wVXFRUUo0WkF2MTEwSndpQT09); 5% (MR B.E.2565 Schedule B); base THB1,650–20,000 1 January 2029–31 December 2031 (MR B.E.2568 cl.3(2), https://www.sso.go.th/wpr/download/download_by_pool_file/47755): 1,000.',
			`${P96}: 720,000 − 100,000 − 60,000 − 12,000 = 548,000 → 27,500 + 48,000 × 15% = 34,700 ÷ 12 = 2,891.666 → 2,891.66.`,
			'Net 60,000 − 1,000 − 300 − 2,891.66 = 55,808.34; employer 1,300.'
		],
		inputs: [
			...person({ ref: 'vol31', wage: 60_000 }),
			statutory(
				'vol31',
				'EWF',
				{
					voluntary_ewf_member: true,
					voluntary_ewf_consent_reference: 'worker-and-employer-consent-31',
					voluntary_ewf_certificate_reference: 'DLPW-certificate-31'
				},
				'2026-10-01'
			)
		],
		period: '2031-10',
		expected: [
			{
				employment: 'vol31_job',
				lines: {
					gross: 60_000,
					net: 55_808.34,
					employer_cost: 1_300,
					'SSO.employee': 1_000,
					'SSO.employer': 1_000,
					'EWF.employee': 300,
					'EWF.employer': 300,
					'PIT.employee': 2_891.66
				}
			}
		]
	}),

	// ─── Income tax withholding (TH-PIT-01, -02, -03, -05, -06, -19, -20) ───────────────────────
	th({
		id: 'TH-PIT-01-1',
		description: 'January 2026, three residents: THB60,000, 200,000 and 20,000 a month.',
		citation: [
			`${P96}: 60,000 → 2,910.41. 200,000: 2,400,000 − 100,000 − 60,000 − 10,500 = 2,229,500 → 365,000 + 229,500 × 30% = 433,850 ÷ 12 = 36,154.1666 → 36,154.16. 20,000: 69,500 net → nil.`,
			`${SSA}: 875 each.`,
			'Nets 56,214.59; 162,970.84; 19,125.'
		],
		inputs: [
			...person({ ref: 'p60', wage: 60_000 }),
			...person({ ref: 'p200', wage: 200_000 }),
			...person({ ref: 'p20', wage: 20_000 })
		],
		period: '2026-01',
		expected: [
			{
				employment: 'p60_job',
				lines: {
					gross: 60_000,
					net: 56_214.59,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 2_910.41
				}
			},
			{
				employment: 'p200_job',
				lines: {
					gross: 200_000,
					net: 162_970.84,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 36_154.16
				}
			},
			{
				employment: 'p20_job',
				lines: { gross: 20_000, net: 19_125, 'SSO.employee': 875, 'SSO.employer': 875 }
			}
		]
	}),
	th({
		id: 'TH-PIT-01-2',
		description:
			'December 2026, THB60,000: the year’s last payment carries s.50(1)’s remainder: 34,925 − 12 × 2,910.41 = 0.08.',
		citation: [
			`${P96}: the remainder of the division is added to the year’s last withholding: 2,910.41 + 0.08 = 2,910.49.`,
			'Net 60,000 − 875 − 2,910.49 = 56,214.51.'
		],
		inputs: person({ ref: 'dec', wage: 60_000 }),
		period: '2026-12',
		expected: [
			{
				employment: 'dec_job',
				lines: {
					gross: 60_000,
					net: 56_214.51,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 2_910.49
				}
			}
		]
	}),
	th({
		id: 'TH-PIT-01-3',
		description:
			'The 5%/10% seam at 300,000 of net income, February 2026: 39,208.33 a month is 299,999.96 net (624.99), 39,208.34 is 300,000.08 (625.00).',
		citation: [
			`${P96}: 39,208.33 × 12 = 470,499.96 − 100,000 − 60,000 − 10,500 = 299,999.96 → 149,999.96 × 5% = 7,499.998 ÷ 12 = 624.9998 → 624.99; 39,208.34 → 300,000.08 → 7,500 + 0.08 × 10% = 7,500.008 ÷ 12 = 625.0006 → 625.00.`,
			'Nets 39,208.33 − 875 − 624.99 = 37,708.34; 39,208.34 − 875 − 625 = 37,708.34.'
		],
		inputs: [
			...person({ ref: 'seamlo', wage: 39_208.33 }),
			...person({ ref: 'seamhi', wage: 39_208.34 })
		],
		period: '2026-02',
		expected: [
			{
				employment: 'seamlo_job',
				lines: {
					gross: 39_208.33,
					net: 37_708.34,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 624.99
				}
			},
			{
				employment: 'seamhi_job',
				lines: {
					gross: 39_208.34,
					net: 37_708.34,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 625
				}
			}
		]
	}),
	th({
		id: 'TH-PIT-02-1',
		description:
			'Hired Thursday 16 April 2026 at THB60,000: April pays 15 of 30 days = 30,000; nine payments are due in the year of hire, and the April payment annualised is under the exempt band.',
		citation: [
			'Owner rule 2026-09-28 (register TH-WORK-05): 60,000 × 15 ÷ 30 = 30,000.',
			`${P96}: cl.1(1) the payments actually due (hired in April: 9): 270,000 − 100,000 − 60,000 − 875 × 9 = 102,125 → nil.`,
			`${SSA}: 30,000 → 875.`,
			'Net 30,000 − 875 = 29,125.'
		],
		inputs: person({ ref: 'april', wage: 60_000, hire: '2026-04-16' }),
		period: '2026-04',
		expected: [
			{
				employment: 'april_job',
				lines: {
					gross: 30_000,
					net: 29_125,
					BASIC: 30_000,
					'SSO.employee': 875,
					'SSO.employer': 875
				}
			}
		]
	}),
	th({
		id: 'TH-PIT-02-2',
		description: 'The same April joiner’s first full month, May 2026: 60,000 × 9 annualised.',
		citation: [
			`${P96}: 540,000 − 100,000 − 60,000 − 7,875 = 372,125 → 7,500 + 72,125 × 10% = 14,712.50 ÷ 9 = 1,634.7222 → 1,634.72.`,
			'Net 60,000 − 875 − 1,634.72 = 57,490.28.'
		],
		inputs: person({ ref: 'may', wage: 60_000, hire: '2026-04-16' }),
		period: '2026-05',
		expected: [
			{
				employment: 'may_job',
				lines: {
					gross: 60_000,
					net: 57_490.28,
					BASIC: 60_000,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 1_634.72
				}
			}
		]
	}),
	th({
		id: 'TH-PIT-02-3',
		description:
			'A semi-monthly payee on THB60,000 a month, first half of June 2026 (15 of 30 days = 30,000): withheld at × 24; SSO for the month deducted from the first payment, which already reaches the ceiling.',
		citation: [
			`${P96}: cl.1(1)(ข) 24 payments: 720,000 − 170,500 = 549,500 → 34,925 ÷ 24 = 1,455.2083 → 1,455.20.`,
			`Social Security Act s.47 (deducted at every wage payment) with s.46’s month: 30,000 ≥ 17,500 → 875.`,
			'Net 30,000 − 875 − 1,455.20 = 27,669.80.'
		],
		company: { pay_frequency: 'SEMI_MONTHLY' },
		inputs: person({ ref: 'half', wage: 60_000, terms: { pay_frequency: 'SEMI_MONTHLY' } }),
		period: '2026-06-1',
		expected: [
			{
				employment: 'half_job',
				lines: {
					gross: 30_000,
					net: 27_669.8,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 1_455.2
				}
			}
		]
	}),
	th({
		id: 'TH-PIT-02-4',
		description:
			'A weekly payee on THB20,000 a week, the first July 2026 payday (Sunday 5 July): withheld at × 52; the month’s SSO taken on the first payment.',
		citation: [
			`${P96}: cl.1(1)(ค) 52 payments: 1,040,000 − 100,000 − 60,000 − 10,500 = 869,500 → 65,000 + 119,500 × 20% = 88,900 ÷ 52 = 1,709.615 → 1,709.61.`,
			'Social Security Act ss.46–47: 20,000 ≥ 17,500 → 875 on the first payday of the month.',
			'Net 20,000 − 875 − 1,709.61 = 17,415.39.'
		],
		company: { pay_frequency: 'WEEKLY' },
		inputs: person({ ref: 'weekly', wage: 20_000, terms: { pay_frequency: 'WEEKLY' } }),
		period: '2026-07-1',
		expected: [
			{
				employment: 'weekly_job',
				lines: {
					gross: 20_000,
					net: 17_415.39,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 1_709.61
				}
			}
		]
	}),
	th({
		id: 'TH-PIT-02-5',
		description:
			'A raise inside January 2026: 62,000 to Thursday 15 January, 93,000 from the 16th: 30,000 + 48,000 = 78,000, withheld on the payment × 12.',
		citation: [
			'Owner rule 2026-09-28 (register TH-WORK-05): 62,000 × 15/31 = 30,000; 93,000 × 16/31 = 48,000.',
			`${P96}: cl.1(1), (4): 936,000 − 100,000 − 60,000 − 10,500 = 765,500 → 65,000 + 15,500 × 20% = 68,100 ÷ 12 = 5,675.`,
			'Net 78,000 − 875 − 5,675 = 71,450.'
		],
		inputs: person({
			ref: 'raise',
			wage: 62_000,
			changes: [{ from: '2026-01-16', base_salary: 93_000 }]
		}),
		period: '2026-01',
		expected: [
			{
				employment: 'raise_job',
				lines: {
					gross: 78_000,
					net: 71_450,
					BASIC: 78_000,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 5_675
				}
			}
		]
	}),
	th({
		id: 'TH-PIT-03-1',
		description:
			'A THB120,000 bonus on 60,000 in March 2026: withheld whole in its month as the annual-tax difference; outside the SSO wage.',
		citation: [
			`${P96}: cl.1(5): 840,000 − 170,500 = 669,500 → 27,500 + 169,500 × 15% = 52,925; less 34,925 = 18,000; 2,910.41 + 18,000 = 20,910.41.`,
			'Social Security Act s.5: a bonus is not pay for normal working time: 875.',
			'Net 180,000 − 875 − 20,910.41 = 158,214.59.'
		],
		inputs: [
			...person({ ref: 'bonus', wage: 60_000 }),
			adhoc('bonus', 'BONUS', 120_000, '2026-03-15')
		],
		period: '2026-03',
		expected: [
			{
				employment: 'bonus_job',
				lines: {
					gross: 180_000,
					net: 158_214.59,
					BASIC: 60_000,
					BONUS: 120_000,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 20_910.41
				}
			}
		]
	}),
	th({
		id: 'TH-PIT-03-2',
		description:
			'A 13th month (60,000) in December 2026: the bonus’s annual-tax difference plus the regular quotient and the year’s remainder.',
		citation: [
			`${P96}: with it 780,000 − 170,500 = 609,500 → 27,500 + 109,500 × 15% = 43,925; less 34,925 = 9,000; 2,910.41 + 0.08 + 9,000 = 11,910.49.`,
			'Net 120,000 − 875 − 11,910.49 = 107,214.51.'
		],
		inputs: [
			...person({ ref: 'thirteen', wage: 60_000 }),
			adhoc('thirteen', 'BONUS', 60_000, '2026-12-15')
		],
		period: '2026-12',
		expected: [
			{
				employment: 'thirteen_job',
				lines: {
					gross: 120_000,
					net: 107_214.51,
					BONUS: 60_000,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 11_910.49
				}
			}
		]
	}),
	th({
		id: 'TH-PIT-03-3',
		description:
			'Overtime is an occasional payment: 60,000 (hourly 250) and three hours on Monday 5 January 2026 = 1,125.',
		citation: [
			`LPA ss.61, 68 (${LPA}): 3 × 1.5 × 250 = 1,125.`,
			`${P96}: cl.1(5): 721,125 − 170,500 = 550,625 → 35,093.75; less 34,925 = 168.75; 2,910.41 + 168.75 = 3,079.16.`,
			'Net 61,125 − 875 − 3,079.16 = 57,170.84.'
		],
		inputs: [
			...person({ ref: 'otpit', wage: 60_000 }),
			workDay('otpit', '2026-01-05', LONG_DAY, 3)
		],
		period: '2026-01',
		expected: [
			{
				employment: 'otpit_job',
				lines: {
					gross: 61_125,
					net: 57_170.84,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 3_079.16
				}
			}
		]
	}),
	th({
		id: 'TH-PIT-05-1',
		description:
			'Retrenched on 31 March 2026 after twenty years on THB150,000, notice served: 400 days’ severance 2,000,000, 600,000 exempt, the rest withheld under s.48(5).',
		citation: [
			`LPA s.118(6) (${LPA}): 400 × 150,000 ÷ 30 = 2,000,000.`,
			`${SEVERANCE_TAX_LAW}: 2,000,000 − 600,000 = 1,400,000 − 7,000 × 20 = 1,260,000 × 50% = 630,000 → 27,500 + 130,000 × 15% = 47,000.`,
			`${P96}: salary alone: 1,800,000 − 100,000 − 60,000 − 10,500 = 1,629,500 → 115,000 + 629,500 × 25% = 272,375 ÷ 12 = 22,697.9166 → 22,697.91.`,
			'Net 2,150,000 − 875 − 22,697.91 − 47,000 = 2,079,427.09.'
		],
		inputs: [
			...person({
				ref: 'sev20',
				wage: 150_000,
				hire: '2006-04-01',
				exit: EXIT,
				exit_reason: 'RETRENCHMENT',
				exit_facts: SERVED
			}),
			adhoc('sev20', 'SEVERANCE_PAY', 0, EXIT)
		],
		period: '2026-03',
		expected: [
			{
				employment: 'sev20_job',
				lines: {
					gross: 2_150_000,
					net: 2_079_427.09,
					SEVERANCE_PAY: 2_000_000,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 22_697.91,
					'SEVERANCE_TAX.employee': 47_000
				}
			}
		]
	}),
	th({
		id: 'TH-PIT-05-2',
		description:
			'Retired on 31 March 2026 at 60 after three years on THB30,000: 180 days’ severance 180,000, not exempt (retirement) and with no s.48(5) route under five years, so withheld with salary as a one-time payment.',
		citation: [
			`LPA ss.118(3), 118/1 (${LPA}): retirement is termination; 180 × 1,000 = 180,000.`,
			`${SEVERANCE_TAX_LAW}. ${P96}: 164.58 + (540,000 − 170,500 = 369,500 → 14,450; less 1,975 = 12,475) = 12,639.58.`,
			'Net 210,000 − 875 − 12,639.58 = 196,485.42.'
		],
		inputs: [
			...person({
				ref: 'retire',
				wage: 30_000,
				dob: '1966-01-10',
				hire: '2023-04-01',
				exit: EXIT,
				exit_reason: 'RETIREMENT'
			}),
			adhoc('retire', 'SEVERANCE_PAY', 0, EXIT)
		],
		period: '2026-03',
		expected: [
			{
				employment: 'retire_job',
				lines: {
					gross: 210_000,
					net: 196_485.42,
					SEVERANCE_PAY: 180_000,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 12_639.58
				}
			}
		]
	}),
	th({
		id: 'TH-PIT-06-1',
		description:
			'A spouse allowance of 60,000 declared on ล.ย.01 reduces the annualised tax from January 2026: 60,000 a month.',
		citation: [
			`${P96}: cl.1(2) allowances as declared; s.47(1)(ข) spouse 60,000: 720,000 − 100,000 − 60,000 − 60,000 − 10,500 = 489,500 → 7,500 + 189,500 × 10% = 26,450 ÷ 12 = 2,204.1666 → 2,204.16.`,
			'Net 60,000 − 875 − 2,204.16 = 56,920.84.'
		],
		inputs: [
			...person({ ref: 'ly01', wage: 60_000 }),
			statutory('ly01', 'PIT', { ly01_deductions: 60_000 }, '2026-01-01')
		],
		period: '2026-01',
		expected: [
			{
				employment: 'ly01_job',
				lines: {
					gross: 60_000,
					net: 56_920.84,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 2_204.16
				}
			}
		]
	}),
	th({
		id: 'TH-PIT-19-1',
		description:
			'A foreign non-resident on THB60,000 in January 2026: withheld like a resident (s.50(1) does not turn on residence; s.47(3) keeps the personal allowance) and insured (s.33 sets no nationality test).',
		citation: [
			`Revenue Code ss.41, 47(3), 50(1) (https://www.rd.go.th/5937.html); ${P96}: 2,910.41.`,
			`${SSA}: 875.`,
			'Net 60,000 − 875 − 2,910.41 = 56,214.59.'
		],
		inputs: person({
			ref: 'expat',
			wage: 60_000,
			nationality: 'Japanese',
			terms: { residency_status: 'FOREIGNER', tax_residency: 'NON_RESIDENT' }
		}),
		period: '2026-01',
		expected: [
			{
				employment: 'expat_job',
				lines: {
					gross: 60_000,
					net: 56_214.59,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 2_910.41
				}
			}
		]
	}),
	th({
		id: 'TH-PIT-20-1',
		description:
			'The social-security relief is only the contribution actually paid: two 1 February 2026 hires on THB30,000, one insured (aged 35) and one not (aged 61 on entry).',
		citation: [
			`Revenue Code s.47(1)(ฌ) (https://www.rd.go.th/5937.html); ${P96}: 11 payments: insured 330,000 − 100,000 − 60,000 − 9,625 = 160,375 → 518.75 ÷ 11 = 47.15; uninsured 170,000 → 1,000 ÷ 11 = 90.90.`,
			'Social Security Act s.33: a hire over 60 is not insured.',
			'Nets 29,077.85 and 29,909.10.'
		],
		inputs: [
			...person({ ref: 'ins', wage: 30_000, hire: '2026-02-01' }),
			...person({ ref: 'unins', wage: 30_000, dob: '1964-11-30', hire: '2026-02-01' })
		],
		period: '2026-02',
		expected: [
			{
				employment: 'ins_job',
				lines: {
					gross: 30_000,
					net: 29_077.85,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 47.15
				}
			},
			{
				employment: 'unins_job',
				lines: { gross: 30_000, net: 29_909.1, employer_cost: 0, 'PIT.employee': 90.9 }
			}
		]
	}),

	// ─── Exit (TH-EXIT-01 to -07) ───────────────────────────────────────────────────────────────
	th({
		id: 'TH-EXIT-01-1',
		description:
			'Retrenched without notice on Sunday 15 March 2026 after eleven years on THB60,000: 15 of 31 days’ salary, one day’s s.67 leave pay, 300 days’ severance, and s.17/1 pay in lieu to 30 April.',
		citation: [
			'Owner rule 2026-09-28 (register TH-WORK-05): salary 60,000 × 15/31 = 29,032.26; day 60,000 ÷ 30 = 2,000.',
			`LPA s.67 (${LPA}): an employer termination not for s.119 cause pays the year’s leave pro rata; the probe encashes one day (within 6 × 74/365 = 1.22): 2,000.`,
			'LPA s.118(5): 10–<20 years, 300 × 2,000 = 600,000.',
			'LPA ss.17 para.2, 17/1: notice given on 15 March would meet payday 31 March and take effect on payday 30 April; pay in lieu 60,000 × 16/31 + 60,000 = 90,967.74, due on removal.',
			`${SEVERANCE_TAX_LAW}: 600,000 + 90,967.74 − 600,000 exempt − 7,000 × 11 = 13,967.74 × 50% = 6,983.87 → nil.`,
			`${P96}: 29,032.26 × 12 = 348,387.12 − 170,500 = 177,887.12 → 1,394.356 ÷ 12 = 116.19; the leave pay (cl.1(5)) 1,494.356 − 1,394.356 = 100: 216.19.`,
			`${SSA}: salary alone, 875.`,
			'Gross 29,032.26 + 2,000 + 600,000 + 90,967.74 = 722,000; net 722,000 − 875 − 216.19 = 720,908.81.'
		],
		inputs: [
			...person({
				ref: 'leaver',
				wage: 60_000,
				hire: '2015-01-01',
				exit: '2026-03-15',
				exit_reason: 'RETRENCHMENT'
			}),
			encashOnExit('leaver', '2026-03-15', 1),
			adhoc('leaver', 'SEVERANCE_PAY', 0, '2026-03-15'),
			adhoc('leaver', 'NOTICE_IN_LIEU', 0, '2026-03-15')
		],
		period: '2026-03',
		expected: [
			{
				employment: 'leaver_job',
				lines: {
					gross: 722_000,
					net: 720_908.81,
					BASIC: 29_032.26,
					ANNUAL_LEAVE_ENCASHMENT: 2_000,
					SEVERANCE_PAY: 600_000,
					NOTICE_IN_LIEU: 90_967.74,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 216.19
				}
			}
		]
	}),
	th({
		id: 'TH-EXIT-02-1',
		description:
			'Retrenched on 31 March 2026 after three years on THB30,000 with notice served: one day’s s.67 leave pay (1,000) and 180 days’ severance, all exempt.',
		citation: [
			`LPA ss.67, 118(3) (${LPA}): 1 × 1,000; 180 × 1,000 = 180,000.`,
			`${SEVERANCE_TAX_LAW}: 180,000 is inside the 400-day wage and 600,000.`,
			`${P96}: 164.58 + (361,000 − 170,500 = 190,500 → 2,025; less 1,975 = 50) = 214.58.`,
			'Net 211,000 − 875 − 214.58 = 209,910.42.'
		],
		inputs: [
			...person({
				ref: 'encash',
				wage: 30_000,
				hire: '2023-04-01',
				exit: EXIT,
				exit_reason: 'RETRENCHMENT',
				exit_facts: SERVED
			}),
			encashOnExit('encash', EXIT, 1),
			adhoc('encash', 'SEVERANCE_PAY', 0, EXIT)
		],
		period: '2026-03',
		expected: [
			{
				employment: 'encash_job',
				lines: {
					gross: 211_000,
					net: 209_910.42,
					ANNUAL_LEAVE_ENCASHMENT: 1_000,
					SEVERANCE_PAY: 180_000,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 214.58
				}
			}
		]
	}),
	th({
		id: 'TH-EXIT-03-1',
		description:
			'Severance by service band, retrenched on 31 March 2026 with notice served, THB30,000 (day 1,000): 120 days → 30, one year → 90, three → 180, six → 240, ten → 300, twenty → 400 days; all inside the exemption.',
		citation: [
			`LPA s.118 as amended by No.7 (${LPA}).`,
			`${SEVERANCE_TAX_LAW}: each is at most the 400-day wage (400,000): exempt; no withholding.`,
			`${P96}: 164.58 each. ${SSA}: 875 each.`
		],
		inputs: (
			[
				['sev120d', '2025-12-02'],
				['sev1y', '2025-04-01'],
				['sev3y', '2023-04-01'],
				['sev6y', '2020-04-01'],
				['sev10y', '2016-04-01'],
				['sev20y', '2006-04-01']
			] as const
		).flatMap(([ref, hire]) => [
			...person({
				ref,
				wage: 30_000,
				hire,
				exit: EXIT,
				exit_reason: 'RETRENCHMENT',
				exit_facts: SERVED
			}),
			adhoc(ref, 'SEVERANCE_PAY', 0, EXIT)
		]),
		period: '2026-03',
		expected: (
			[
				['sev120d', 30_000],
				['sev1y', 90_000],
				['sev3y', 180_000],
				['sev6y', 240_000],
				['sev10y', 300_000],
				['sev20y', 400_000]
			] as const
		).map(([ref, severance]) => ({
			employment: `${ref}_job`,
			lines: {
				gross: 30_000 + severance,
				net: Math.round((30_000 + severance - 875 - 164.58) * 100) / 100,
				SEVERANCE_PAY: severance,
				'SSO.employee': 875,
				'SSO.employer': 875,
				'PIT.employee': 164.58
			}
		}))
	}),
	th({
		id: 'TH-EXIT-03-2',
		description:
			'A written fixed term that is not a s.118 para.3 project ends on 31 March 2026 after six years on THB30,000: expiry is termination, 240 days’ severance, not tax-exempt, s.48(5) inside the exempt band.',
		citation: [
			`LPA s.118 paras 2–4 (${LPA}): 240 × 1,000 = 240,000.`,
			`${SEVERANCE_TAX_LAW}: contract expiry is not exempt; 240,000 − 7,000 × 6 = 198,000 × 50% = 99,000 → nil.`,
			`${P96}: 164.58.`,
			'Net 270,000 − 875 − 164.58 = 268,960.42.'
		],
		inputs: [
			...person({
				ref: 'expiry',
				wage: 30_000,
				hire: '2020-04-01',
				exit: EXIT,
				exit_reason: 'END_OF_CONTRACT',
				exit_facts: { fixed_term_project_exempt: false }
			}),
			adhoc('expiry', 'SEVERANCE_PAY', 0, EXIT)
		],
		period: '2026-03',
		expected: [
			{
				employment: 'expiry_job',
				lines: {
					gross: 270_000,
					net: 268_960.42,
					SEVERANCE_PAY: 240_000,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 164.58
				}
			}
		]
	}),
	th({
		id: 'TH-EXIT-03-3',
		description:
			'No severance, 31 March 2026, THB30,000: a retrenchment after 119 days (hired 3 December 2025, notice served), and a written two-year special-project fixed term (1 April 2024–31 March 2026) that s.118 paras 3–4 exempt.',
		citation: [
			`LPA s.118 paras 1, 3–4 (${LPA}): severance from 120 days’ continuous service (3 December 2025 – 31 March 2026 counted inclusively is 119 days); none at the end of a written fixed term for a special project outside the normal business finished within two years.`,
			`${SSA}: 875. ${P96}: 164.58.`,
			'Nets 28,960.42.'
		],
		inputs: [
			...person({
				ref: 'd119',
				wage: 30_000,
				hire: '2025-12-03',
				exit: EXIT,
				exit_reason: 'RETRENCHMENT',
				exit_facts: SERVED
			}),
			...person({
				ref: 'project',
				wage: 30_000,
				hire: '2024-04-01',
				exit: EXIT,
				exit_reason: 'END_OF_CONTRACT',
				exit_facts: { fixed_term_project_exempt: true }
			})
		],
		period: '2026-03',
		expected: [
			{ employment: 'd119_job', lines: plain30k },
			{ employment: 'project_job', lines: plain30k }
		]
	}),
	th({
		id: 'TH-EXIT-04-1',
		description:
			'Retrenched without notice on payday 31 March 2026 after three years on THB30,000: notice given that day would take effect on 30 April, so April’s 30,000 is owed in lieu; 180 days’ severance, exempt.',
		citation: [
			`LPA ss.17 para.2, 17/1, 118(3) (${LPA}).`,
			`${SEVERANCE_TAX_LAW}: the 30,000 pay in lieu is outside the severance exemption and, under five years, withheld with salary: ${P96}: 164.58 + (390,000 − 170,500 = 219,500 → 3,475; less 1,975 = 1,500) = 1,664.58.`,
			'Net 240,000 − 875 − 1,664.58 = 237,460.42.'
		],
		inputs: [
			...person({
				ref: 'lieu',
				wage: 30_000,
				hire: '2023-04-01',
				exit: EXIT,
				exit_reason: 'RETRENCHMENT'
			}),
			adhoc('lieu', 'SEVERANCE_PAY', 0, EXIT),
			adhoc('lieu', 'NOTICE_IN_LIEU', 0, EXIT)
		],
		period: '2026-03',
		expected: [
			{
				employment: 'lieu_job',
				lines: {
					gross: 240_000,
					net: 237_460.42,
					NOTICE_IN_LIEU: 30_000,
					SEVERANCE_PAY: 180_000,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 1_664.58
				}
			}
		]
	}),
	th({
		id: 'TH-EXIT-05-1',
		description:
			'Two dismissals on 31 March 2026 after three years on THB30,000, notice served: one for a s.119 cause stated in the notice (no severance raised: the class is not owed), one without cause (180 days).',
		citation: [
			`LPA ss.118(3), 119 (${LPA}): no severance for a s.119 cause stated in the notice.`,
			`${P96}: 164.58 each (the 180,000 exempt). ${SSA}: 875.`,
			'Nets 28,960.42 and 210,000 − 1,039.58 = 208,960.42.'
		],
		inputs: [
			...person({
				ref: 'cause',
				wage: 30_000,
				hire: '2023-04-01',
				exit: EXIT,
				exit_reason: 'DISMISSAL',
				exit_facts: { ...SERVED, dismissed_for_cause: true }
			}),
			...person({
				ref: 'nocause',
				wage: 30_000,
				hire: '2023-04-01',
				exit: EXIT,
				exit_reason: 'DISMISSAL',
				exit_facts: { ...SERVED, dismissed_for_cause: false }
			}),
			adhoc('nocause', 'SEVERANCE_PAY', 0, EXIT)
		],
		period: '2026-03',
		expected: [
			{ employment: 'cause_job', lines: plain30k },
			{
				employment: 'nocause_job',
				lines: {
					gross: 210_000,
					net: 208_960.42,
					SEVERANCE_PAY: 180_000,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 164.58
				}
			}
		]
	}),
	th({
		id: 'TH-EXIT-06-1',
		description:
			'Two employees of three years on THB30,000 object to a workplace relocation and leave on 31 March 2026: s.120 para.3 special severance at the s.118 rate (180 days) on SEVERANCE_PAY, and s.120 para.2’s 30 days in lieu of notice on NOTICE_IN_LIEU where the notice was not posted 30 days ahead.',
		citation: [
			`LPA s.120 paras 1–3 (${LPA}, read 30 Sep 2026): 180,000 each; 30 × 1,000 = 30,000 in lieu where the notice was not posted.`,
			`${SEVERANCE_TAX_LAW} (s.120 para.3 special severance read as severance under the Act): the 180,000 is inside the exemption. Owner rule 2026-09-30 (register TH-EXIT-06): the s.120 para.2 payment in lieu of notice is taxed like s.17/1 pay, outside the exemption, and under five years withheld with salary: ${P96}: 164.58 + (390,000 − 170,500 = 219,500 → 3,475; less 1,975 = 1,500) = 1,664.58; posted: 164.58.`,
			'Nets 240,000 − 875 − 1,664.58 = 237,460.42 and 210,000 − 1,039.58 = 208,960.42.'
		],
		inputs: [
			...person({
				ref: 'reloc',
				wage: 30_000,
				hire: '2023-04-01',
				exit: EXIT,
				exit_reason: 'RESIGNATION',
				exit_facts: { relocation_objection: true }
			}),
			...person({
				ref: 'posted',
				wage: 30_000,
				hire: '2023-04-01',
				exit: EXIT,
				exit_reason: 'RESIGNATION',
				exit_facts: { relocation_objection: true, relocation_notice_posted: true }
			}),
			adhoc('reloc', 'SEVERANCE_PAY', 0, EXIT),
			adhoc('reloc', 'NOTICE_IN_LIEU', 0, EXIT),
			adhoc('posted', 'SEVERANCE_PAY', 0, EXIT)
		],
		period: '2026-03',
		expected: [
			{
				employment: 'reloc_job',
				lines: {
					gross: 240_000,
					net: 237_460.42,
					SEVERANCE_PAY: 180_000,
					NOTICE_IN_LIEU: 30_000,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 1_664.58
				}
			},
			{
				employment: 'posted_job',
				lines: {
					gross: 210_000,
					net: 208_960.42,
					SEVERANCE_PAY: 180_000,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 164.58
				}
			}
		]
	}),
	th({
		id: 'TH-EXIT-07-1',
		description:
			'Technology restructuring without 60 days’ notice, 31 March 2026, THB30,000: ten years → SEVERANCE_PAY 300 + 15 × 10 = 450 days; thirty years → 400 + 360 (15 × 30 capped) = 760 days; each with s.121 para.2’s 60 days in lieu of notice on NOTICE_IN_LIEU.',
		citation: [
			`LPA ss.118, 121, 122 (${LPA}, read 30 Sep 2026): s.121 para.2 60 days in lieu of notice (deemed the Civil and Commercial Code pay in lieu by para.3); s.122 15 days per full year over six years, at most 360.`,
			`${SEVERANCE_TAX_LAW}; owner rule 2026-09-30 (register TH-EXIT-07): the 60 days in lieu join the base outside the exemption: 450,000 + 60,000 − 400,000 = 110,000 − 70,000 = 40,000 × 50% → nil; 760,000 + 60,000 − 400,000 = 420,000 − 210,000 = 210,000 × 50% = 105,000 → nil.`,
			`${P96}: 164.58.`,
			'Nets 540,000 − 1,039.58 = 538,960.42 and 850,000 − 1,039.58 = 848,960.42.'
		],
		inputs: [
			...person({
				ref: 'tech10',
				wage: 30_000,
				hire: '2016-04-01',
				exit: EXIT,
				exit_reason: 'RETRENCHMENT',
				exit_facts: { technology_restructuring: true }
			}),
			...person({
				ref: 'tech30',
				wage: 30_000,
				dob: '1970-03-01',
				hire: '1996-04-01',
				exit: EXIT,
				exit_reason: 'RETRENCHMENT',
				exit_facts: { technology_restructuring: true }
			}),
			adhoc('tech10', 'SEVERANCE_PAY', 0, EXIT),
			adhoc('tech10', 'NOTICE_IN_LIEU', 0, EXIT),
			adhoc('tech30', 'SEVERANCE_PAY', 0, EXIT),
			adhoc('tech30', 'NOTICE_IN_LIEU', 0, EXIT)
		],
		period: '2026-03',
		expected: [
			{
				employment: 'tech10_job',
				lines: {
					gross: 540_000,
					net: 538_960.42,
					SEVERANCE_PAY: 450_000,
					NOTICE_IN_LIEU: 60_000,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 164.58
				}
			},
			{
				employment: 'tech30_job',
				lines: {
					gross: 850_000,
					net: 848_960.42,
					SEVERANCE_PAY: 760_000,
					NOTICE_IN_LIEU: 60_000,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 164.58
				}
			}
		]
	}),

	// ─── Protected workers and payment (TH-HR-07, TH-HR-30) ─────────────────────────────────────
	th({
		id: 'TH-HR-07-1',
		description:
			'A 17-year-old on the Bangkok floor (12,000) with the hour’s rest after four hours, and a pregnant employee on 30,000, February 2026, neither working overtime: ordinary pay, insured.',
		citation: [
			`LPA ss.39/1, 44, 46 (${LPA}): minimum age 15; an under-18 rests at least an hour after four hours; a pregnant employee does no overtime or holiday work.`,
			`${SSA}: 600 and 875 (s.33 insures from 15). ${P96}: nil and 164.58.`,
			'Nets 11,400 and 28,960.42.'
		],
		inputs: [
			...person({ ref: 'teen', wage: 12_000, dob: '2008-06-15', hire: '2025-12-01' }),
			// ss.46–48 are judged on the timed day: each February weekday clocked, the hour's rest at 13:00.
			...Array.from({ length: 27 }, (_, i) => `2026-02-${String(i + 2).padStart(2, '0')}`)
				.filter((date) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()))
				.map((date) =>
					workDay(
						'teen',
						date,
						[
							['09:00', '13:00'],
							['14:00', '18:00']
						],
						0
					)
				),
			...person({
				ref: 'preg',
				wage: 30_000,
				gender: 'FEMALE',
				terms: { facts: { hazardous_work: false, pregnancy_status: 'PREGNANT' } }
			})
		],
		period: '2026-02',
		expected: [
			{
				employment: 'teen_job',
				lines: {
					gross: 12_000,
					net: 11_400,
					employer_cost: 600,
					'SSO.employee': 600,
					'SSO.employer': 600
				}
			},
			{ employment: 'preg_job', lines: plain30k }
		]
	}),
	th({
		id: 'TH-HR-30-1',
		description:
			'A resignation on Tuesday 10 March 2026 on THB30,000, paid in baht on the agreed payday: 10 of 31 days; no severance and no current-year leave pay.',
		citation: [
			`LPA ss.54, 67, 70 para.1, 118 para.2 (${LPA}): wages in Thai currency; a resignation is paid on the agreed payday; no severance and only carried-forward leave (none here) on a resignation.`,
			'Owner rule 2026-09-28 (register TH-WORK-05): 30,000 × 10/31 = 9,677.42.',
			`${SSA}: 9,677.42 × 5% = 483.87 → 484. ${P96}: nil.`,
			'Net 9,677.42 − 484 = 9,193.42.'
		],
		inputs: person({ ref: 'resign', wage: 30_000, exit: '2026-03-10', exit_reason: 'RESIGNATION' }),
		period: '2026-03',
		expected: [
			{
				employment: 'resign_job',
				lines: {
					gross: 9_677.42,
					net: 9_193.42,
					employer_cost: 484,
					BASIC: 9_677.42,
					'SSO.employee': 484,
					'SSO.employer': 484
				}
			}
		]
	})
);

// ─── Round 9 (30 Sep 2026): the branches each register row names as unproven ─────────────────
/** Every Monday–Friday of a month (no holiday is recorded unless the case adds one). */
const weekdaysOf = (month: string) =>
	Array.from({ length: 31 }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`).filter(
		(date) =>
			!Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
			new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date &&
			![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())
	);
/** One input with extra values over its own. */
const withValues = (input: ProbeInput, values: Row): ProbeInput => ({
	...input,
	values: { ...input.values, ...values }
});
/** A young worker's month, every weekday clocked (ss.46–48 are judged on the timed day). */
const clockedMonth = (
	ref: string,
	month: string,
	day: readonly (readonly [string, string])[] = NORMAL_DAY
) => weekdaysOf(month).map((date) => workDay(ref, date, day, 0));
const CERT = { certificate_file: 'medical-certificate.pdf' };
/** A twelve-hour guard shift 09:00–22:00, its hour of s.27 rest split into two agreed half hours. */
const guardTwelve: ProbeInput = {
	collection: 'shift_definitions',
	ref: 'guard12',
	values: {
		company_id: '@company',
		code: 'TH-GUARD-TWELVE',
		name: 'Guard 0900 to 2200',
		variant: {
			kind: 'WORK',
			start_time: '09:00',
			end_time: '22:00',
			break_minutes: 60,
			break_start_time: '13:00'
		},
		effective_range: { from: EPOCH, to: null }
	}
};
const guardDay = (ref: string, date: string, agreedAt: string): ProbeInput => ({
	collection: 'work_days',
	values: {
		employment_id: `@${ref}_job`,
		work_date: date,
		shift_definition_id: '@guard12',
		worked_intervals: [
			['09:00', '13:00'],
			['13:30', '17:30'],
			['18:00', '22:00']
		].map(([start, end]) => ({
			start: `${date}T${start}:00+07:00`,
			end: `${date}T${end}:00+07:00`
		})),
		approved_overtime_hours: 0,
		facts: {
			normal_hours_redistribution_agreed_at: agreedAt,
			split_break_agreed_at: '2026-04-20T05:00:00.000Z'
		}
	}
});
const FOUR_HOURS: Variant = {
	kind: 'WORK',
	start_time: '09:00',
	end_time: '13:00',
	break_minutes: 0
};
const SEVEN_HOURS: Variant = {
	kind: 'WORK',
	start_time: '09:00',
	end_time: '17:00',
	break_minutes: 60,
	break_start_time: '13:00'
};
const HAZARDOUS: Row = { facts: { hazardous_work: true, pregnancy_status: 'NOT_PREGNANT' } };
const NOT_OFFERED = (code: string) =>
	`${code} is not offered to .*: its eligibility rule does not hold for them\\.`;

register(
	// ─── Notice 14 blocks, comparators and worksites (TH-WAGE-01, -02, -03, -04, -07) ──────────
	th({
		id: 'TH-WAGE-01-4',
		description:
			'A monthly wage of THB11,999.70 in Bangkok, February 2026: 11,999.70 ÷ 30 = 399.99 a day is below the THB400 floor on each of the 20 normal working days, so the run is refused (cl.20).',
		citation: [
			`Notice 14 (${N14}) and the Ministry table: Bangkok THB400; cl.20 no employer may pay less. Owner rule 2026-09-28 (register TH-WAGE-01): a monthly wage is held to the rate × 30, each normal working day at monthly ÷ 30, the unrounded day compared.`
		],
		inputs: person({ ref: 'low', wage: 11_999.7 }),
		period: '2026-02',
		refused:
			'P-TH-low is paid 399\\.99 a day on 20 normal working day\\(s\\) from 2026-02-02, below the Bangkok daily minimum wage of 400',
		expected: []
	}),
	th({
		id: 'TH-WAGE-01-5',
		description:
			'A daily THB370 worker moved from Mae Rim (357) to Mueang Chiang Mai (380) on Monday 16 February 2026 by a new terms row: the ten Mueang weekdays 16–27 February are below the floor and the run is refused; the Mae Rim days are not.',
		citation: [
			`Notice 14 (${N14}) cls.3, 7, 20: Mueang Chiang Mai THB380, the rest of Chiang Mai THB357, owed per day at the day’s workplace.`
		],
		inputs: person({
			ref: 'moved',
			wage: 370,
			terms: dailyTerms('Chiang Mai/Mae Rim'),
			changes: [{ from: '2026-02-16', worksite: 'Chiang Mai/Mueang Chiang Mai' }]
		}),
		period: '2026-02',
		refused:
			'P-TH-moved is paid 370 a day on 10 normal working day\\(s\\) from 2026-02-16, below the Chiang Mai/Mueang Chiang Mai daily minimum wage of 380',
		expected: []
	}),
	th({
		id: 'TH-WAGE-01-6',
		description:
			'A semi-monthly contract of THB11,999.70 a month in Bangkok, first half of February 2026: its day is 11,999.70 ÷ 30 = 399.99, below THB400, so the run is refused.',
		citation: [
			`Notice 14 (${N14}) cl.20. Owner rule 2026-09-28 (register TH-WAGE-01): a semi-monthly base_salary is its month, held to the rate × 30.`
		],
		company: { pay_frequency: 'SEMI_MONTHLY' },
		inputs: person({ ref: 'semi', wage: 11_999.7, terms: { pay_frequency: 'SEMI_MONTHLY' } }),
		period: '2026-02-1',
		refused: 'P-TH-semi is paid 399\\.99 a day on .* below the Bangkok daily minimum wage of 400',
		expected: []
	}),
	th({
		id: 'TH-WAGE-01-7',
		description:
			'A weekly wage of THB2,769 in Bangkok, the first February 2026 payday: taken to its month (× 52 ÷ 12 = 11,999) its day is 399.9667, below THB400, so the run is refused.',
		citation: [
			`Notice 14 (${N14}) cl.20. Owner rule 2026-09-28 (register TH-WAGE-01): a weekly wage × 52 ÷ 12 is its month, then ÷ 30; 2,769 × 52 ÷ 12 ÷ 30 = 399.9667.`
		],
		company: { pay_frequency: 'WEEKLY' },
		inputs: person({ ref: 'wk', wage: 2_769, terms: { pay_frequency: 'WEEKLY' } }),
		period: '2026-02-1',
		refused: 'P-TH-wk is paid 399\\.9667 a day on .* below the Bangkok daily minimum wage of 400',
		expected: []
	}),
	th({
		id: 'TH-WAGE-02-3',
		description:
			'A daily THB370 worker whose terms record Mae Rim (357) works Monday 2 February 2026 at Mueang Chiang Mai (380), recorded on the work day: that one day is below the floor and the run is refused.',
		citation: [
			`Notice 14 (${N14}) cls.3, 7, 20: the floor is owed at the workplace the day was worked; a day across a district boundary is held to that day’s site.`
		],
		inputs: [
			...person({ ref: 'split', wage: 370, terms: dailyTerms('Chiang Mai/Mae Rim') }),
			withValues(workDay('split', '2026-02-02', NORMAL_DAY, 0), {
				worksite: 'Chiang Mai/Mueang Chiang Mai'
			})
		],
		period: '2026-02',
		refused:
			'P-TH-split is paid 370 a day on 1 normal working day\\(s\\) from 2026-02-02, below the Chiang Mai/Mueang Chiang Mai daily minimum wage of 380',
		expected: []
	}),
	th({
		id: 'TH-WAGE-02-4',
		description:
			'A worksite recorded as the bare province Chiang Mai, whose Mueang district has its own rate, names no floor: the run is refused until the district is recorded.',
		citation: [
			`Notice 14 (${N14}) cls.3, 7: Chiang Mai has two rates (Mueang Chiang Mai 380, the rest 357), so the province alone does not say which is owed.`
		],
		inputs: person({ ref: 'bare', wage: 400, terms: dailyTerms('Chiang Mai') }),
		period: '2026-02',
		refused: 'P-TH-bare: record the worksite on 2026-02-\\d\\d as a province or province/district',
		expected: []
	}),
	th({
		id: 'TH-WAGE-03-3',
		description:
			'A type-2 hotel in Mae Rim paying THB370 a day, February 2026: the nationwide THB400 binds (not Chiang Mai’s 357), so the run is refused.',
		citation: [
			`Notice 14 (${N14}) cl.2(1), cl.20 and explanation items 7, 12: hotels of type 2–4 THB400 nationwide; the higher rate binds.`
		],
		inputs: person({
			ref: 'hotel2',
			wage: 370,
			terms: dailyTerms('Chiang Mai/Mae Rim', 'HOTEL_TYPE_2')
		}),
		period: '2026-02',
		refused:
			'P-TH-hotel2 is paid 370 a day on .* below the Chiang Mai/Mae Rim HOTEL_TYPE_2 daily minimum wage of 400',
		expected: []
	}),
	th({
		id: 'TH-WAGE-03-4',
		description:
			'A worksite sector the version’s table does not name (HOTEL_TYPE_5: the hotel regulation has four types) cannot be priced: the run is refused.',
		citation: [
			`Notice 14 (${N14}) cl.2(1): the THB400 sector rate is for hotels of type 2–4 under the hotel-category regulation, which defines types 1–4 only.`
		],
		inputs: person({ ref: 'type5', wage: 400, terms: dailyTerms('Yala', 'HOTEL_TYPE_5') }),
		period: '2026-02',
		refused: 'P-TH-type5: the worksite sector "HOTEL_TYPE_5" is not in the version',
		expected: []
	}),
	th({
		id: 'TH-WAGE-04-3',
		description:
			'An hourly THB94.99 worker on a four-hour normal day in Mueang Chiang Mai, February 2026: 94.99 × 4 = 379.96 is below the whole day’s THB380, so the run is refused.',
		citation: [
			`Notice 14 (${N14}) cls.19, 20: the daily rate is the wage for the normal working day however short; an hourly rate is held to it over the day’s paid hours.`
		],
		work: FOUR_HOURS,
		inputs: person({
			ref: 'hr9499',
			wage: 94.99,
			terms: { pay_frequency: 'HOURLY', worksite: 'Chiang Mai/Mueang Chiang Mai' }
		}),
		period: '2026-02',
		refused:
			'P-TH-hr9499 is paid 379\\.96 a day on .* below the Chiang Mai/Mueang Chiang Mai daily minimum wage of 380',
		expected: []
	}),
	th({
		id: 'TH-WAGE-04-4',
		description:
			'A daily THB370 worker on a four-hour normal day in Mueang Chiang Mai, February 2026: the floor is the whole 380, not 380 × 4/8, so the run is refused.',
		citation: [`Notice 14 (${N14}) cls.19, 20.`],
		work: FOUR_HOURS,
		inputs: person({
			ref: 'short370',
			wage: 370,
			terms: dailyTerms('Chiang Mai/Mueang Chiang Mai')
		}),
		period: '2026-02',
		refused:
			'P-TH-short370 is paid 370 a day on .* below the Chiang Mai/Mueang Chiang Mai daily minimum wage of 380',
		expected: []
	}),
	th({
		id: 'TH-WAGE-04-5',
		description:
			'Hazardous work on its seven-hour normal day in Bangkok, hourly THB57.15, February 2026: 57.15 × 7 = 400.05 meets the THB400 day; 20 days = 8,001.',
		citation: [
			`Notice 14 (${N14}) cls.19, 20: the normal working day is at most 7 hours in hazardous work; LPA s.23 para.1 (${LPA}).`,
			`${SSA}: 8,001 × 5% = 400.05 → 400. ${P96}: 96,012 annualised, nil.`,
			'Net 8,001 − 400 = 7,601.'
		],
		work: SEVEN_HOURS,
		inputs: person({
			ref: 'haz5715',
			wage: 57.15,
			terms: { pay_frequency: 'HOURLY', worksite: 'Bangkok', ...HAZARDOUS }
		}),
		period: '2026-02',
		expected: [
			{
				employment: 'haz5715_job',
				lines: {
					gross: 8_001,
					net: 7_601,
					employer_cost: 400,
					'SSO.employee': 400,
					'SSO.employer': 400
				}
			}
		]
	}),
	th({
		id: 'TH-WAGE-04-6',
		description:
			'The same seven-hour hazardous day at hourly THB57.14: 57.14 × 7 = 399.98 is below THB400, so the run is refused.',
		citation: [`Notice 14 (${N14}) cls.19, 20; LPA s.23 para.1 (${LPA}).`],
		work: SEVEN_HOURS,
		inputs: person({
			ref: 'haz5714',
			wage: 57.14,
			terms: { pay_frequency: 'HOURLY', worksite: 'Bangkok', ...HAZARDOUS }
		}),
		period: '2026-02',
		refused:
			'P-TH-haz5714 is paid 399\\.98 a day on .* below the Bangkok daily minimum wage of 400',
		expected: []
	}),
	th({
		id: 'TH-WAGE-07-2',
		description:
			'A Service Establishment Act venue in Yala paying THB399 a day, February 2026: the nationwide THB400 binds (not Yala’s 337), so the run is refused.',
		citation: [
			`Notice 14 (${N14}) cl.2(2), cl.20 and explanation items 7, 13: a service establishment under the Service Establishment Act THB400 nationwide.`
		],
		inputs: person({
			ref: 'venue399',
			wage: 399,
			terms: dailyTerms('Yala', 'SERVICE_ESTABLISHMENT')
		}),
		period: '2026-02',
		refused:
			'P-TH-venue399 is paid 399 a day on .* below the Yala SERVICE_ESTABLISHMENT daily minimum wage of 400',
		expected: []
	}),

	// ─── Guards, s.65 classes and hours limits (TH-WORK-03, -06, -07) ───────────────────────────
	th({
		id: 'TH-WORK-03-2',
		description:
			'An hourly guard on THB60, October 2026, works an agreed twelve-hour normal day on Monday 26 October inside a 44-hour week: the four normal hours above eight earn the 2025 regulation’s 1.25× supplement (4 × 60 × 1.25 = 300) on top of 180 paid hours.',
		citation: [
			'Guard regulation in force 24 April 2026 (https://ratchakitcha.soc.go.th/documents/68372.pdf): a guard may agree a normal day above eight hours within 48 a week; a non-monthly guard is paid at least 1.25× the hourly rate for the normal hours above eight.',
			`LPA ss.23, 27 (${LPA}): the day’s hour of rest may be split by prior agreement. 22 weekdays × 8 + 4 = 180 hours × 60 = 10,800; + 300 = 11,100.`,
			`${SSA}: the supplement is pay for normal working time: 11,100 × 5% = 555. ${P96}: 133,200 annualised, nil. EWF: one worker, under ten, not covered.`,
			'Net 11,100 − 555 = 10,545.'
		],
		inputs: [
			guardTwelve,
			...person({
				ref: 'guardh',
				wage: 60,
				terms: { pay_frequency: 'HOURLY', statutory_work_category: 'GUARD_DUTY' }
			}),
			guardDay('guardh', '2026-10-26', '2026-10-25T05:00:00.000Z')
		],
		period: '2026-10',
		expected: [
			{
				employment: 'guardh_job',
				lines: {
					gross: 11_100,
					net: 10_545,
					employer_cost: 555,
					'SSO.employee': 555,
					'SSO.employer': 555
				}
			}
		]
	}),
	th({
		id: 'TH-WORK-03-3',
		description:
			'A monthly guard whose twelve-hour normal day on Monday 27 April 2026 was agreed only at 10:00 that morning, after the shift began: the redistributed day lacks the prior agreement and the run is refused.',
		citation: [
			'Guard regulation in force 24 April 2026 (https://ratchakitcha.soc.go.th/documents/68372.pdf); LPA s.23 (' +
				LPA +
				'): a normal day above eight hours needs the worker’s prior agreement.'
		],
		inputs: [
			guardTwelve,
			...person({ ref: 'gagree', wage: 24_000, terms: { statutory_work_category: 'GUARD_DUTY' } }),
			guardDay('gagree', '2026-04-27', '2026-04-27T03:00:00.000Z')
		],
		period: '2026-04',
		refused:
			'P-TH-gagree needs a prior worker agreement for the redistributed normal day on 2026-04-27',
		expected: []
	}),
	th({
		id: 'TH-WORK-06-3',
		description:
			'A s.65(3)–(9) employee (say, water-gate work) on THB24,000 (hourly 100), January 2026: Monday 5 January three overtime hours at the hourly rate (300, not 1.5×); Saturday 10 January weekly holiday nine hours: eight at s.62(1) 1× (800) and the ninth at the hourly rate (100, not 3×).',
		citation: [
			`LPA s.65 (${LPA}, re-read 30 Sep 2026): the classes of s.65(1)–(9) have no s.61 overtime or s.63 holiday-overtime pay unless the employer agrees, but those of (3)–(9) are paid the working-day hourly rate for each hour worked; s.66 removes only class (1) from s.62, so s.62(1) holiday-work pay stays. s.68: 24,000 ÷ 240 = 100.`,
			'300 + 800 + 100 = 1,200; gross 25,200.',
			`${SSA}: 875. ${P96}: 288,000 and 289,200 annualised both nil after 170,500 of deductions.`,
			'Net 25,200 − 875 = 24,325.'
		],
		inputs: [
			...person({
				ref: 'gate',
				wage: 24_000,
				terms: { work_classification: 'OVERTIME_AT_HOURLY_RATE' }
			}),
			workDay('gate', '2026-01-05', LONG_DAY, 3),
			workDay('gate', '2026-01-10', NINE_HOURS, 9)
		],
		period: '2026-01',
		expected: [
			{
				employment: 'gate_job',
				lines: {
					gross: 25_200,
					net: 24_325,
					employer_cost: 875,
					BASIC: 24_000,
					'SSO.employee': 875,
					'SSO.employer': 875
				}
			}
		]
	}),
	th({
		id: 'TH-WORK-06-4',
		description:
			'A s.65(2) canvassing salesperson paid commission, on THB24,000, works the same long Monday and nine-hour Saturday: no overtime or holiday-overtime pay at all, but s.62(1) holiday-work pay for the eight holiday hours (800).',
		citation: [
			`LPA ss.65(2), 66 (${LPA}, re-read 30 Sep 2026): class (2) has no s.61 or s.63 pay and, unlike (3)–(9), no hourly compensation; s.66 excludes only class (1) from s.62.`,
			`${SSA}: 875. ${P96}: nil.`,
			'Gross 24,800; net 24,800 − 875 = 23,925.'
		],
		inputs: [
			...person({
				ref: 'canvass',
				wage: 24_000,
				terms: { work_classification: 'COMMISSION_SALES' }
			}),
			workDay('canvass', '2026-01-05', LONG_DAY, 3),
			workDay('canvass', '2026-01-10', NINE_HOURS, 9)
		],
		period: '2026-01',
		expected: [
			{
				employment: 'canvass_job',
				lines: {
					gross: 24_800,
					net: 23_925,
					employer_cost: 875,
					BASIC: 24_000,
					'SSO.employee': 875,
					'SSO.employer': 875
				}
			}
		]
	}),
	th({
		id: 'TH-WORK-07-2',
		description:
			'Hazardous work on its seven-hour day with four overtime hours on Monday 5 January 2026: s.31 forbids overtime in hazardous work, so the run is refused.',
		citation: [`LPA ss.23 para.1, 31 (${LPA}, read 30 Sep 2026).`],
		work: SEVEN_HOURS,
		inputs: [
			...person({ ref: 'hazot', wage: 21_000, terms: HAZARDOUS }),
			workDay(
				'hazot',
				'2026-01-05',
				[
					['09:00', '13:00'],
					['14:00', '17:00'],
					['17:20', '21:20']
				],
				4
			)
		],
		period: '2026-01',
		refused: 'P-TH-hazot cannot work overtime or on a holiday in Thai hazardous work on 2026-01-05',
		expected: []
	}),
	th({
		id: 'TH-WORK-07-3',
		description:
			'Hazardous work on the weekly holiday, Saturday 10 January 2026, seven hours: s.31 forbids holiday work in hazardous work, so the run is refused.',
		citation: [`LPA ss.23 para.1, 31 (${LPA}, read 30 Sep 2026).`],
		work: SEVEN_HOURS,
		inputs: [
			...person({ ref: 'hazhol', wage: 21_000, terms: HAZARDOUS }),
			workDay(
				'hazhol',
				'2026-01-10',
				[
					['09:00', '13:00'],
					['14:00', '17:00']
				],
				7
			)
		],
		period: '2026-01',
		refused:
			'P-TH-hazhol cannot work overtime or on a holiday in Thai hazardous work on 2026-01-10',
		expected: []
	}),
	th({
		id: 'TH-WORK-07-4',
		description:
			'Hazardous work rostered on the eight-hour office day, January 2026: above the seven-hour hazardous normal day, so the run is refused.',
		citation: [
			`LPA s.23 para.1 (${LPA}): hazardous work at most 7 normal hours a day and 42 a week.`
		],
		inputs: person({ ref: 'haz8', wage: 21_000, terms: HAZARDOUS }),
		period: '2026-01',
		refused: 'P-TH-haz8 has a hazardous normal shift above the 7-hour limit on 2026-01-\\d\\d',
		expected: []
	}),
	th({
		id: 'TH-WORK-07-5',
		description:
			'Three overtime hours on Monday 5 January 2026 whose consent is recorded at 10:00, after the working day began: the occasion had no prior consent and the run is refused.',
		citation: [
			`LPA s.24 (${LPA}): overtime needs the employee’s prior consent on each occasion, save the s.24 para.2 continuous or emergency work and s.25’s businesses.`
		],
		inputs: [
			...person({ ref: 'noconsent', wage: 24_000 }),
			withValues(workDay('noconsent', '2026-01-05', LONG_DAY, 3), {
				overtime_consented_at: '2026-01-05T10:00:00+07:00'
			})
		],
		period: '2026-01',
		refused:
			'P-TH-noconsent needs the worker.s prior consent for overtime or holiday work on 2026-01-05',
		expected: []
	}),
	th({
		id: 'TH-WORK-07-6',
		description:
			'Four company holidays 5–8 January 2026 each worked nine hours (36 hours of holiday work and holiday overtime) fill the week’s 36-hour ceiling, so three overtime hours on Friday 9 January are refused at entry; the four holidays are paid: 4 × (800 + 300) = 4,400.',
		citation: [
			`LPA s.26 and Ministerial Regulation No.3 B.E.2541 cl.3 (${LPA}): overtime, holiday work and holiday overtime together at most 36 hours a week.`,
			`LPA ss.62(1), 63, 68: 8 × 100 + 1 × 300 a holiday on THB24,000.`,
			`${SSA}: 875. ${P96}: 292,400 annualised, nil.`,
			'Gross 28,400; net 28,400 − 875 = 27,525.'
		],
		inputs: [
			...['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'].map((date, n) =>
				holiday(date, `Company holiday ${n + 1}`)
			),
			...person({ ref: 'capot', wage: 24_000 }),
			...['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'].map((date) =>
				workDay('capot', date, NINE_HOURS, 9)
			),
			{
				...workDay('capot', '2026-01-09', LONG_DAY, 3),
				refused:
					'2026-01-09 would hold 3 h of approved overtime, above the .* h left within the 36-hour limit "combined_overtime_holiday_week"'
			}
		],
		period: '2026-01',
		expected: [
			{
				employment: 'capot_job',
				lines: {
					gross: 28_400,
					net: 27_525,
					employer_cost: 875,
					BASIC: 24_000,
					'SSO.employee': 875,
					'SSO.employer': 875
				}
			}
		]
	}),

	// ─── Young and pregnant workers (TH-HR-07) ──────────────────────────────────────────────────
	th({
		id: 'TH-HR-07-2',
		description:
			'A 17-year-old, every February 2026 weekday clocked, works three overtime hours on Monday 2 February: s.48 forbids overtime under 18, so the run is refused.',
		citation: [`LPA s.48 (${LPA}): no employee under 18 may work overtime or on a holiday.`],
		inputs: [
			...person({ ref: 'teenot', wage: 12_000, dob: '2008-06-15', hire: '2025-12-01' }),
			...clockedMonth('teenot', '2026-02').filter(
				(input) => input.values.work_date !== '2026-02-02'
			),
			workDay('teenot', '2026-02-02', LONG_DAY, 3)
		],
		period: '2026-02',
		refused: 'P-TH-teenot cannot work overtime in Thailand while under 18 on 2026-02-02',
		expected: []
	}),
	th({
		id: 'TH-HR-07-3',
		description:
			'A pregnant employee works three overtime hours on Monday 5 January 2026 with no evidence of a s.39/1 para.2 executive, academic, clerical or financial role: the run is refused.',
		citation: [
			`LPA s.39/1 (${LPA}): no night, overtime or holiday work for a pregnant employee; working-day overtime only in the listed roles and without harm to her health.`
		],
		inputs: [
			...person({
				ref: 'pregot',
				wage: 30_000,
				gender: 'FEMALE',
				terms: { facts: { hazardous_work: false, pregnancy_status: 'PREGNANT' } }
			}),
			workDay('pregot', '2026-01-05', LONG_DAY, 3)
		],
		period: '2026-01',
		refused:
			'P-TH-pregot needs supported Thai s\\.39/1 role and health evidence before pregnant working-day overtime on 2026-01-05',
		expected: []
	}),
	th({
		id: 'TH-HR-07-4',
		description:
			'A 17-year-old on a 15:00–23:00 normal shift (the hour’s rest at 19:00), February 2026, every weekday clocked: the hour after 22:00 is night work with no prior written Director-General permission, so the run is refused.',
		citation: [
			`LPA s.47 (${LPA}): no employee under 18 may work 22:00–06:00 without the Director-General’s prior written permission.`
		],
		work: {
			kind: 'WORK',
			start_time: '15:00',
			end_time: '23:00',
			break_minutes: 60,
			break_start_time: '19:00'
		},
		inputs: [
			...person({ ref: 'teennight', wage: 12_000, dob: '2008-06-15', hire: '2025-12-01' }),
			...clockedMonth('teennight', '2026-02', [
				['15:00', '19:00'],
				['20:00', '23:00']
			])
		],
		period: '2026-02',
		refused:
			'P-TH-teennight needs prior written Thai Director-General permission for under-18 night work on 2026-02-02',
		expected: []
	}),

	// ─── Leave (TH-LEAVE-02, -03, -05, -06, -07) ────────────────────────────────────────────────
	th({
		id: 'TH-LEAVE-02-1',
		description:
			'Five days of child-care leave (9–13 February 2026) for a newborn with a certified condition, on THB30,000: each day paid at 50%, so half of five calendar days comes off: 5 × 0.5 × 30,000 ÷ 28 = 2,678.57.',
		citation: [
			'LPA s.41 para.4 and s.59/1 as added by No.9 B.E.2568 (in force 7 December 2025, https://ratchakitcha.soc.go.th/documents/89818.pdf): after maternity leave, up to 15 days where the child has a certified illness, complication or disability, paid at 50% of the wage.',
			'Owner rule 2026-09-28 (register TH-WORK-05): a day of a monthly wage off pay is monthly ÷ the month’s days. Gross 30,000 − 2,678.57 = 27,321.43.',
			`${SSA}: 875. ${P96}: 327,857.16 − 170,500 = 157,357.16 → 7,357.16 × 5% = 367.858 ÷ 12 = 30.6548 → 30.65.`,
			'Net 27,321.43 − 875 − 30.65 = 26,415.78.'
		],
		inputs: [
			...person({ ref: 'carer', wage: 30_000, gender: 'FEMALE' }),
			{
				...timeOff('carer', 'CHILD_CARE_LEAVE', '2026-02-09', '2026-02-13', {
					event_kind: 'BIRTH',
					event_date: '2025-12-20'
				}),
				files: CERT
			}
		],
		period: '2026-02',
		expected: [
			{
				employment: 'carer_job',
				lines: {
					gross: 27_321.43,
					net: 26_415.78,
					employer_cost: 875,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 30.65
				}
			}
		]
	}),
	th({
		id: 'TH-LEAVE-02-2',
		description:
			'Sixteen working days of child-care leave (2–23 February 2026) for one child: above the 15 days s.41 para.4 grants, so the entry is refused and the month is paid whole.',
		citation: [
			'LPA s.41 para.4 as added by No.9 B.E.2568 (https://ratchakitcha.soc.go.th/documents/89818.pdf): “not more than fifteen days”.',
			`${SSA}; ${P96}: the THB30,000 figures above.`
		],
		inputs: [
			...person({ ref: 'carer16', wage: 30_000, gender: 'FEMALE' }),
			{
				...timeOff('carer16', 'CHILD_CARE_LEAVE', '2026-02-02', '2026-02-23', {
					event_kind: 'BIRTH',
					event_date: '2025-12-20'
				}),
				files: CERT,
				refused:
					'CHILD_CARE_LEAVE grants 15 days for this event; 0 are already taken and this would add 16\\.'
			}
		],
		period: '2026-02',
		expected: [{ employment: 'carer16_job', lines: plain30k }]
	}),
	th({
		id: 'TH-LEAVE-03-2',
		description:
			'Sixteen working days of spouse-birth leave (9 February – 2 March 2026) for one birth: above the 15 days s.41/1 grants, so the entry is refused and February is paid whole.',
		citation: [
			'LPA ss.41/1, 59/2 as added by No.9 ss.6, 8 (https://ratchakitcha.soc.go.th/documents/89818.pdf): up to 15 days for each birth.',
			`${SSA}; ${P96}: the THB30,000 figures above.`
		],
		inputs: [
			...person({ ref: 'arthit16', wage: 30_000 }),
			{
				...timeOff('arthit16', 'CHILD_BIRTH_LEAVE', '2026-02-09', '2026-03-02', {
					event_kind: 'BIRTH',
					event_relationship: 'SPOUSE',
					event_date: '2026-02-06'
				}),
				refused:
					'CHILD_BIRTH_LEAVE grants 15 days for this event; 0 are already taken and this would add 16\\.'
			}
		],
		period: '2026-02',
		expected: [{ employment: 'arthit16_job', lines: plain30k }]
	}),
	th({
		id: 'TH-LEAVE-05-2',
		description:
			'Annual leave on 10 February 2026: refused for an employee hired 12 February 2025 (a day short of a year’s service); granted to one hired 10 February 2025 (a full year served). Both months paid whole.',
		citation: [
			`LPA s.30 (${LPA}): at least six working days of annual leave for an employee who has worked continuously for one full year; pro rata before that is the employer’s option, not modelled.`,
			`${SSA}; ${P96}: the THB30,000 figures above (both hired in 2025, twelve payments in 2026).`
		],
		inputs: [
			...person({ ref: 'young', wage: 30_000, hire: '2025-02-12' }),
			{
				...timeOff('young', 'ANNUAL_LEAVE', '2026-02-10', '2026-02-10'),
				refused: 'Leave on 2026-02-10 cannot be approved: INELIGIBLE\\.'
			},
			...person({ ref: 'anniv', wage: 30_000, hire: '2025-02-10' }),
			timeOff('anniv', 'ANNUAL_LEAVE', '2026-02-10', '2026-02-10')
		],
		period: '2026-02',
		expected: [
			{ employment: 'young_job', lines: plain30k },
			{ employment: 'anniv_job', lines: plain30k }
		]
	}),
	th({
		id: 'TH-LEAVE-06-2',
		description:
			'Sick leave with certificates, 5–30 January (20 working days) and 2–16 February 2026 (11): the 30th working day of the year (13 February) is the last paid; Monday 16 February, the 31st, comes off at 30,000 ÷ 28 = 1,071.43.',
		citation: [
			`LPA ss.32, 57 (${LPA}): sick leave as actually ill, wages for not more than 30 working days a year; a certificate may be asked for from three working days.`,
			'Owner rule 2026-09-28 (register TH-WORK-05): an unpaid day of a monthly wage is monthly ÷ the month’s days. Gross 28,928.57.',
			`${SSA}: 875. ${P96}: 347,142.84 − 170,500 = 176,642.84 → 26,642.84 × 5% = 1,332.142 ÷ 12 = 111.0118 → 111.01.`,
			'Net 28,928.57 − 875 − 111.01 = 27,942.56.'
		],
		inputs: [
			...person({ ref: 'ill', wage: 30_000 }),
			{ ...timeOff('ill', 'SICK_LEAVE', '2026-01-05', '2026-01-30'), files: CERT },
			{ ...timeOff('ill', 'SICK_LEAVE', '2026-02-02', '2026-02-16'), files: CERT }
		],
		period: '2026-02',
		expected: [
			{
				employment: 'ill_job',
				lines: {
					gross: 28_928.57,
					net: 27_942.56,
					employer_cost: 875,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 111.01
				}
			}
		]
	}),
	th({
		id: 'TH-LEAVE-06-3',
		description:
			'Three working days of sick leave (10–12 February 2026) with no medical certificate: the certificate may be required from the third working day, so the entry is refused and the month is paid whole.',
		citation: [
			`LPA s.32 (${LPA}): “ลาป่วยตั้งแต่สามวันทำงานขึ้นไป” — from three working days the employer may require a first-class physician’s certificate.`,
			`${SSA}; ${P96}: the THB30,000 figures above.`
		],
		inputs: [
			...person({ ref: 'nocert', wage: 30_000 }),
			{
				...timeOff('nocert', 'SICK_LEAVE', '2026-02-10', '2026-02-12'),
				refused: 'A certificate is required for this time off\\.'
			}
		],
		period: '2026-02',
		expected: [{ employment: 'nocert_job', lines: plain30k }]
	}),
	th({
		id: 'TH-LEAVE-07-2',
		description:
			'Three days of certified sterilisation leave (10–12 February 2026): paid, the month unchanged.',
		citation: [
			`LPA ss.33, 57 para.2 (${LPA}): leave for sterilisation as a first-class physician prescribes and certifies, with wages.`,
			`${SSA}; ${P96}: the THB30,000 figures above.`
		],
		inputs: [
			...person({ ref: 'steril', wage: 30_000 }),
			{ ...timeOff('steril', 'STERILISATION_LEAVE', '2026-02-10', '2026-02-12'), files: CERT }
		],
		period: '2026-02',
		expected: [{ employment: 'steril_job', lines: plain30k }]
	}),
	th({
		id: 'TH-LEAVE-07-3',
		description:
			'Five days of military leave for a reserve training call (9–13 February 2026): paid, inside the 60 days a year s.58 pays.',
		citation: [
			`LPA ss.35, 58 (${LPA}): leave for military inspection, training or readiness testing, with wages for not more than 60 days a year.`,
			`${SSA}; ${P96}: the THB30,000 figures above.`
		],
		inputs: [
			...person({ ref: 'reserve', wage: 30_000 }),
			timeOff('reserve', 'MILITARY_LEAVE', '2026-02-09', '2026-02-13')
		],
		period: '2026-02',
		expected: [{ employment: 'reserve_job', lines: plain30k }]
	}),
	th({
		id: 'TH-LEAVE-07-4',
		description:
			'Four days of personal-business leave (9–12 February 2026) against the three a year the catalogue grants: the entry is refused and the month is paid whole.',
		citation: [
			`LPA ss.34, 57/1 (${LPA}): at least three working days a year, wages for not more than three. Owner rule 2026-09-28 (register TH-LEAVE-07): the catalogue grants the statutory three; a longer grant is the employer’s, keyed as unpaid leave.`,
			`${SSA}; ${P96}: the THB30,000 figures above.`
		],
		inputs: [
			...person({ ref: 'errand', wage: 30_000 }),
			{
				...timeOff('errand', 'PERSONAL_BUSINESS_LEAVE', '2026-02-09', '2026-02-12'),
				refused: 'Insufficient leave in .*: 1 more days are needed after existing commitments\\.'
			}
		],
		period: '2026-02',
		expected: [{ employment: 'errand_job', lines: plain30k }]
	}),

	// ─── Social security and withholding (TH-SS-01, -02, -12; TH-PIT-02, -20) ──────────────────
	th({
		id: 'TH-SS-01-3',
		description:
			'THB30,000 in December 2025, the last month of the THB15,000 ceiling: 750 each side; withholding for tax year 2025 with its remainder on the year’s last payment.',
		citation: [
			`${SSA}; base THB1,650–15,000 before 1 January 2026 (MR B.E.2568 cl.3 raises it from then): 15,000 × 5% = 750.`,
			`${P96}: 360,000 − 100,000 − 60,000 − 750 × 12 = 191,000 → 41,000 × 5% = 2,050 ÷ 12 = 170.8333 → 170.83; December carries 2,050 − 12 × 170.83 = 0.04: 170.87.`,
			'Net 30,000 − 750 − 170.87 = 29,079.13.'
		],
		inputs: person({ ref: 'dec25', wage: 30_000 }),
		period: '2025-12',
		expected: [
			{
				employment: 'dec25_job',
				lines: {
					gross: 30_000,
					net: 29_079.13,
					employer_cost: 750,
					'SSO.employee': 750,
					'SSO.employer': 750,
					'PIT.employee': 170.87
				}
			}
		]
	}),
	th({
		id: 'TH-SS-02-3',
		description:
			'A registered Songkhla employer, December 2025 (the first flood-relief month, still under the THB15,000 ceiling): 3% × 15,000 = 450 each side, and the 450 is the s.47(1)(ฌ) relief the withholding annualises.',
		citation: [
			'Flood-relief notice cl.1 (https://ratchakitcha.soc.go.th/documents/100888.pdf): 3% each for wage months December 2025–May 2026.',
			`${SSA}: 15,000 × 3% = 450.`,
			`${P96}: 360,000 − 100,000 − 60,000 − 450 × 12 = 194,600 → 44,600 × 5% = 2,230 ÷ 12 = 185.8333 → 185.83; December carries 2,230 − 12 × 185.83 = 0.04: 185.87.`,
			'Net 30,000 − 450 − 185.87 = 29,363.13.'
		],
		company: { facts: { sso_flood_relief_area: true } },
		inputs: person({ ref: 'flooddec', wage: 30_000, terms: { worksite: 'Songkhla/Hat Yai' } }),
		period: '2025-12',
		expected: [
			{
				employment: 'flooddec_job',
				lines: {
					gross: 30_000,
					net: 29_363.13,
					employer_cost: 450,
					'SSO.employee': 450,
					'SSO.employer': 450,
					'PIT.employee': 185.87
				}
			}
		]
	}),
	th({
		id: 'TH-SS-12-2',
		description:
			'A worker hired at 14 (born 10 February 2011) on THB12,000, January 2026: still under 15 at the month’s end, not yet insured: no SSO, no tax.',
		citation: [
			`${SSA} s.33 para.1: an employee aged 15–60 is insured. Owner rule 2026-09-28 (register TH-SS-12): the lower bound is read on the period end.`,
			`${P96}: 144,000 annualised, nil.`
		],
		inputs: [
			...person({ ref: 'young14', wage: 12_000, dob: '2011-02-10', hire: '2025-12-01' }),
			...clockedMonth('young14', '2026-01')
		],
		period: '2026-01',
		expected: [
			{ employment: 'young14_job', lines: { gross: 12_000, net: 12_000, employer_cost: 0 } }
		]
	}),
	th({
		id: 'TH-SS-12-3',
		description:
			'The same worker in February 2026, 15 from 10 February: insured for the month, 12,000 × 5% = 600 each side.',
		citation: [
			`${SSA} s.33 para.1. Owner rule 2026-09-28 (register TH-SS-12): 15 on the period end, the whole month’s wage contributory.`,
			`${P96}: nil. Net 12,000 − 600 = 11,400.`
		],
		inputs: [
			...person({ ref: 'turns15', wage: 12_000, dob: '2011-02-10', hire: '2025-12-01' }),
			...clockedMonth('turns15', '2026-02')
		],
		period: '2026-02',
		expected: [
			{
				employment: 'turns15_job',
				lines: {
					gross: 12_000,
					net: 11_400,
					employer_cost: 600,
					'SSO.employee': 600,
					'SSO.employer': 600
				}
			}
		]
	}),
	th({
		id: 'TH-PIT-02-6',
		description:
			'Hired on 1 December 2026 on THB400,000 a month: the year’s one payment is its own annual income (× 1, not × 12).',
		citation: [
			`${P96} cl.1(1): the payment × the payments due in the tax year, for a December hire one: 400,000 − 100,000 − 60,000 − 875 = 239,125 → 89,125 × 5% = 4,456.25 ÷ 1.`,
			`${SSA}: 875.`,
			'Net 400,000 − 875 − 4,456.25 = 394,668.75.'
		],
		inputs: person({ ref: 'dechire', wage: 400_000, hire: '2026-12-01' }),
		period: '2026-12',
		expected: [
			{
				employment: 'dechire_job',
				lines: {
					gross: 400_000,
					net: 394_668.75,
					employer_cost: 875,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 4_456.25
				}
			}
		]
	}),

	// ─── Exit (TH-EXIT-04, -07) ─────────────────────────────────────────────────────────────────
	th({
		id: 'TH-EXIT-04-2',
		description:
			'Retrenched on 31 March 2026 after three years on THB30,000 with notice given on payday 28 February (effective payday 31 March): notice was served, so pay in lieu is not offered; 180 days’ severance, exempt.',
		citation: [
			`LPA ss.17 para.2, 17/1, 118(3) (${LPA}).`,
			`${SEVERANCE_TAX_LAW}: 180,000 inside the exemption. ${P96}: 164.58. ${SSA}: 875.`,
			'Net 210,000 − 875 − 164.58 = 208,960.42.'
		],
		inputs: [
			...person({
				ref: 'served',
				wage: 30_000,
				hire: '2023-04-01',
				exit: EXIT,
				exit_reason: 'RETRENCHMENT',
				exit_facts: SERVED
			}),
			adhoc('served', 'SEVERANCE_PAY', 0, EXIT),
			{ ...adhoc('served', 'NOTICE_IN_LIEU', 0, EXIT), refused: NOT_OFFERED('NOTICE_IN_LIEU') }
		],
		period: '2026-03',
		expected: [
			{
				employment: 'served_job',
				lines: {
					gross: 210_000,
					net: 208_960.42,
					SEVERANCE_PAY: 180_000,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 164.58
				}
			}
		]
	}),
	th({
		id: 'TH-EXIT-04-3',
		description:
			'The same retrenchment with notice given on Sunday 1 March 2026, the day after the February payday: it takes effect on the payday after 31 March, 30 April, so April’s 30,000 is owed in lieu.',
		citation: [
			`LPA ss.17 para.2, 17/1, 118(3) (${LPA}): notice at or before a payday takes effect on the next payday.`,
			`${SEVERANCE_TAX_LAW}: the 30,000 in lieu is outside the exemption and withheld with salary: ${P96}: 164.58 + 1,500 = 1,664.58.`,
			'Net 240,000 − 875 − 1,664.58 = 237,460.42.'
		],
		inputs: [
			...person({
				ref: 'late',
				wage: 30_000,
				hire: '2023-04-01',
				exit: EXIT,
				exit_reason: 'RETRENCHMENT',
				exit_facts: { notice_given_on: '2026-03-01' }
			}),
			adhoc('late', 'SEVERANCE_PAY', 0, EXIT),
			adhoc('late', 'NOTICE_IN_LIEU', 0, EXIT)
		],
		period: '2026-03',
		expected: [
			{
				employment: 'late_job',
				lines: {
					gross: 240_000,
					net: 237_460.42,
					NOTICE_IN_LIEU: 30_000,
					SEVERANCE_PAY: 180_000,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 1_664.58
				}
			}
		]
	}),
	th({
		id: 'TH-EXIT-04-4',
		description:
			'A resignation effective 31 March 2026: the employer owes no notice, so pay in lieu is not offered; March paid whole.',
		citation: [
			`LPA ss.17, 17/1 (${LPA}): notice and pay in lieu bind the party ending the contract; an employee resigning is owed none.`,
			`${SSA}; ${P96}: the THB30,000 figures above.`
		],
		inputs: [
			...person({ ref: 'quits', wage: 30_000, exit: EXIT, exit_reason: 'RESIGNATION' }),
			{ ...adhoc('quits', 'NOTICE_IN_LIEU', 0, EXIT), refused: NOT_OFFERED('NOTICE_IN_LIEU') }
		],
		period: '2026-03',
		expected: [{ employment: 'quits_job', lines: plain30k }]
	}),
	th({
		id: 'TH-EXIT-07-2',
		description:
			'Technology restructuring on 31 March 2026 after ten years on THB30,000 with the 60 days’ notice given: no s.121 para.2 payment in lieu (not offered); s.118 300 days + s.122 15 × 10 = 450 days’ severance.',
		citation: [
			`LPA ss.118, 121, 122 (${LPA}, read 30 Sep 2026): s.121 para.2 pays 60 days in lieu only where the 60 days’ notice was not given; s.122 is owed either way.`,
			`${SEVERANCE_TAX_LAW}: 450,000 − 400,000 = 50,000 − 70,000 (7,000 × 10 years) → nil. ${P96}: 164.58. ${SSA}: 875.`,
			'Net 480,000 − 875 − 164.58 = 478,960.42.'
		],
		inputs: [
			...person({
				ref: 'tech60',
				wage: 30_000,
				hire: '2016-04-01',
				exit: EXIT,
				exit_reason: 'RETRENCHMENT',
				exit_facts: { technology_restructuring: true, technology_notice_60_days: true }
			}),
			adhoc('tech60', 'SEVERANCE_PAY', 0, EXIT),
			{ ...adhoc('tech60', 'NOTICE_IN_LIEU', 0, EXIT), refused: NOT_OFFERED('NOTICE_IN_LIEU') }
		],
		period: '2026-03',
		expected: [
			{
				employment: 'tech60_job',
				lines: {
					gross: 480_000,
					net: 478_960.42,
					SEVERANCE_PAY: 450_000,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 164.58
				}
			}
		]
	})
);

// ─── Round 9, second pass (30 Sep 2026): later sealed steps, registration, part years ────────
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
const guardWeek = (ref: string, dates: readonly string[]) =>
	dates.map((date) => guardDay(ref, date, `${dayBefore(date)}T05:00:00.000Z`));

register(
	// ─── Social security later steps and registration (TH-SS-01; TH-PIT-01; TH-EWF-01, -02) ─────
	th({
		id: 'TH-SS-01-4',
		description:
			'THB30,000 in January 2029, the first month of the THB20,000 ceiling: 1,000 each side, and 1,000 × 12 the s.47(1)(ฌ) relief.',
		citation: [
			'Social Security Act ss.33, 46 (https://searchlaw.ocs.go.th/council-of-state/#/public/doc/alJWY29wVXFRUUo0WkF2MTEwSndpQT09); 5% (MR B.E.2565 Schedule B); base THB1,650–20,000 1 January 2029–31 December 2031 (MR B.E.2568 cl.3(2), https://www.sso.go.th/wpr/download/download_by_pool_file/47755): 20,000 × 5% = 1,000.',
			`${P96}: 360,000 − 100,000 − 60,000 − 12,000 = 188,000 → 38,000 × 5% = 1,900 ÷ 12 = 158.3333 → 158.33.`,
			'Net 30,000 − 1,000 − 158.33 = 28,841.67. One employee: the Employee Welfare Fund does not cover the business (LPA s.130 para.1).'
		],
		inputs: person({ ref: 'y2029', wage: 30_000 }),
		period: '2029-01',
		expected: [
			{
				employment: 'y2029_job',
				lines: {
					gross: 30_000,
					net: 28_841.67,
					employer_cost: 1_000,
					'SSO.employee': 1_000,
					'SSO.employer': 1_000,
					'PIT.employee': 158.33
				}
			}
		]
	}),
	th({
		id: 'TH-SS-01-5',
		description:
			'THB30,000 in January 2032, the first month of the THB23,000 ceiling: 1,150 each side.',
		citation: [
			'Social Security Act ss.33, 46; 5% (MR B.E.2565 Schedule B); base THB1,650–23,000 from 1 January 2032 (MR B.E.2568 cl.3(3), https://www.sso.go.th/wpr/download/download_by_pool_file/47755): 23,000 × 5% = 1,150.',
			`${P96}: 360,000 − 100,000 − 60,000 − 13,800 = 186,200 → 36,200 × 5% = 1,810 ÷ 12 = 150.8333 → 150.83.`,
			'Net 30,000 − 1,150 − 150.83 = 28,699.17.'
		],
		inputs: person({ ref: 'y2032', wage: 30_000 }),
		period: '2032-01',
		expected: [
			{
				employment: 'y2032_job',
				lines: {
					gross: 30_000,
					net: 28_699.17,
					employer_cost: 1_150,
					'SSO.employee': 1_150,
					'SSO.employer': 1_150,
					'PIT.employee': 150.83
				}
			}
		]
	}),
	th({
		id: 'TH-SS-01-6',
		description:
			'An employee the employer has not registered with the SSO, THB30,000 in February 2026: the s.46 contribution is still assessed (875 each side) and the run warns that registration is incomplete.',
		citation: [
			`${SSA}: s.33 insures by employment, not by the employer’s registration; s.34 registration within 30 days is the employer’s duty and a missing one relieves no one.`,
			`${P96}: the THB30,000 figures above.`
		],
		inputs: [...person({ ref: 'unsso', wage: 30_000 }), unregistered('unsso', 'SSO', '2020-01-01')],
		period: '2026-02',
		warnings: ['SSO: registration incomplete; statutory liability assessed\\.'],
		expected: [{ employment: 'unsso_job', lines: plain30k }]
	}),
	th({
		id: 'TH-PIT-01-4',
		description:
			'An employee recorded as not registered for withholding, THB30,000 in February 2026: s.50(1) tax is still withheld (164.58), with the registration warning.',
		citation: [
			`${P96}: s.50(1) binds every payer of s.40(1) income; no registration condition. 164.58 as above.`,
			`${SSA}: 875.`
		],
		inputs: [...person({ ref: 'unpit', wage: 30_000 }), unregistered('unpit', 'PIT', '2020-01-01')],
		period: '2026-02',
		warnings: ['PIT: registration incomplete; statutory liability assessed\\.'],
		expected: [{ employment: 'unpit_job', lines: plain30k }]
	}),
	th({
		id: 'TH-EWF-01-3',
		description:
			'Ten employees in October 2026, one recorded NOT_REGISTERED for the Employee Welfare Fund: non-registration is no exemption, so the run is refused.',
		citation: [
			`LPA s.130 para.1 (${LPA}): every employee of a business with ten or more employees is a member; the only exclusions are para.2’s provident fund or welfare arrangement (register TH-EWF-01).`
		],
		inputs: [
			...Array.from({ length: 10 }, (_, index) =>
				person({ ref: `ewfu${index}`, wage: 20_000 })
			).flat(),
			unregistered('ewfu9', 'EWF', '2026-10-01')
		],
		period: '2026-10',
		refused: 'EWF: the recorded not-registered status cannot establish an exemption',
		expected: []
	}),
	th({
		id: 'TH-EWF-02-4',
		description:
			'A voluntary fund member on THB30,003 in October 2026: 0.25% is 75.0075, kept to the satang (75.01) each side, not rounded to the baht.',
		citation: [
			'EWF rate regulation B.E.2568 cl.3(1) (https://ratchakitcha.soc.go.th/documents/86102.pdf): 0.25% each side. Owner rule 2026-09-28 (register TH-EWF-02): cl.3 states no rounding, so each share is the satang: 30,003 × 0.25% = 75.0075 → 75.01.',
			`${SSA}: 875. ${P96}: 360,036 − 100,000 − 60,000 − 10,500 = 189,536 → 39,536 × 5% = 1,976.80 ÷ 12 = 164.7333 → 164.73.`,
			'Net 30,003 − 875 − 75.01 − 164.73 = 28,888.26; employer 950.01.'
		],
		inputs: [
			...person({ ref: 'vol3', wage: 30_003 }),
			statutory(
				'vol3',
				'EWF',
				{
					voluntary_ewf_member: true,
					voluntary_ewf_consent_reference: 'worker-and-employer-consent-3',
					voluntary_ewf_certificate_reference: 'DLPW-certificate-3'
				},
				'2026-10-01'
			)
		],
		period: '2026-10',
		expected: [
			{
				employment: 'vol3_job',
				lines: {
					gross: 30_003,
					net: 28_888.26,
					employer_cost: 950.01,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'EWF.employee': 75.01,
					'EWF.employer': 75.01,
					'PIT.employee': 164.73
				}
			}
		]
	}),

	// ─── Exit part years and deadlines (TH-EXIT-04, -05, -07; TH-PIT-05; TH-HR-30) ──────────────
	th({
		id: 'TH-EXIT-07-3',
		description:
			'Technology restructuring with the 60 days’ notice given, 31 March 2026, THB30,000: exactly six years (hired 1 April 2020) is not “over six years”, so s.118’s 240 days only; six years and 182 days (hired 1 October 2019) counts the part year over 180 days: 240 + 15 × 7 = 345 days.',
		citation: [
			`LPA ss.118(4), 121, 122 (${LPA}, read 30 Sep 2026): s.122 adds at least 15 days per full year of service for an employee of more than six years, a part year over 180 days counted as a year, the s.122 amount at most 360 days. 1 October 2025 – 31 March 2026 is 182 days.`,
			`${SEVERANCE_TAX_LAW}: 240,000 and 345,000 are inside the 400-day wage (400,000): exempt. ${P96}: 164.58. ${SSA}: 875.`,
			'Nets 270,000 − 1,039.58 = 268,960.42 and 375,000 − 1,039.58 = 373,960.42.'
		],
		inputs: [
			...(
				[
					['six', '2020-04-01'],
					['sixplus', '2019-10-01']
				] as const
			).flatMap(([ref, hire]) => [
				...person({
					ref,
					wage: 30_000,
					hire,
					exit: EXIT,
					exit_reason: 'RETRENCHMENT',
					exit_facts: { technology_restructuring: true, technology_notice_60_days: true }
				}),
				adhoc(ref, 'SEVERANCE_PAY', 0, EXIT)
			])
		],
		period: '2026-03',
		expected: [
			{
				employment: 'six_job',
				lines: {
					gross: 270_000,
					net: 268_960.42,
					SEVERANCE_PAY: 240_000,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 164.58
				}
			},
			{
				employment: 'sixplus_job',
				lines: {
					gross: 375_000,
					net: 373_960.42,
					SEVERANCE_PAY: 345_000,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 164.58
				}
			}
		]
	}),
	th({
		id: 'TH-PIT-05-3',
		description:
			'Two retirements on 31 March 2026 at 60 on THB90,000 (day 3,000), 300 days’ severance 900,000 each, none exempt (retirement): ten years and 183 days (hired 30 September 2015) is eleven s.48(5) years; ten years and 182 days (hired 1 October 2015) is ten.',
		citation: [
			`LPA ss.118(5), 118/1 (${LPA}): 300 × 3,000 = 900,000.`,
			`${SEVERANCE_TAX_LAW}; Revenue Code s.48(5): 7,000 × years, a part year of 183 days or more a year. 30 September 2025 – 31 March 2026 is 183 days: 900,000 − 77,000 = 823,000 × 50% = 411,500 → 7,500 + 111,500 × 10% = 18,650. 1 October 2025 – 31 March 2026 is 182: 900,000 − 70,000 = 830,000 × 50% = 415,000 → 7,500 + 115,000 × 10% = 19,000.`,
			`${P96}: the salary alone (cl.1 excludes the s.48(5) payment): 1,080,000 − 100,000 − 60,000 − 10,500 = 909,500 → 65,000 + 159,500 × 20% = 96,900 ÷ 12 = 8,075. ${SSA}: 875.`,
			'Nets 990,000 − 875 − 8,075 − 18,650 = 962,400 and 990,000 − 875 − 8,075 − 19,000 = 962,050.'
		],
		inputs: [
			...(
				[
					['r183', '2015-09-30'],
					['r182', '2015-10-01']
				] as const
			).flatMap(([ref, hire]) => [
				...person({
					ref,
					wage: 90_000,
					dob: '1966-01-10',
					hire,
					exit: EXIT,
					exit_reason: 'RETIREMENT'
				}),
				adhoc(ref, 'SEVERANCE_PAY', 0, EXIT)
			])
		],
		period: '2026-03',
		expected: [
			{
				employment: 'r183_job',
				lines: {
					gross: 990_000,
					net: 962_400,
					SEVERANCE_PAY: 900_000,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 8_075,
					'SEVERANCE_TAX.employee': 18_650
				}
			},
			{
				employment: 'r182_job',
				lines: {
					gross: 990_000,
					net: 962_050,
					SEVERANCE_PAY: 900_000,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 8_075,
					'SEVERANCE_TAX.employee': 19_000
				}
			}
		]
	}),
	th({
		id: 'TH-EXIT-04-5',
		description:
			'Dismissed for a s.119 cause on Monday 16 March 2026 after three years on THB30,000, no notice given: neither severance nor pay in lieu is offered; 16 of 31 days’ salary, and the month-end run warns that s.70 para.2’s three days ran out on 19 March.',
		citation: [
			`LPA ss.17 para.2, 70 para.2, 118, 119 (${LPA}): no notice or severance on a s.119 dismissal; where the employer terminates, money owed is paid within three days.`,
			'Owner rule 2026-09-28 (register TH-WORK-05): 30,000 × 16/31 = 15,483.87.',
			`${SSA}: 15,483.87 × 5% = 774.19 → 774. ${P96}: 185,806.44 − 92,903.22 − 60,000 − 9,288 = 23,615.22 → nil.`,
			'Net 15,483.87 − 774 = 14,709.87.'
		],
		inputs: [
			...person({
				ref: 'cause16',
				wage: 30_000,
				hire: '2023-04-01',
				exit: '2026-03-16',
				exit_reason: 'DISMISSAL',
				exit_facts: { dismissed_for_cause: true }
			}),
			{
				...adhoc('cause16', 'SEVERANCE_PAY', 0, '2026-03-16'),
				refused: NOT_OFFERED('SEVERANCE_PAY')
			},
			{
				...adhoc('cause16', 'NOTICE_IN_LIEU', 0, '2026-03-16'),
				refused: NOT_OFFERED('NOTICE_IN_LIEU')
			}
		],
		period: '2026-03',
		warnings: [
			'FINAL_PAY_LATE: P-TH-cause16 left on 2026-03-16.*by 2026-03-19.*pays on 2026-03-31'
		],
		expected: [
			{
				employment: 'cause16_job',
				lines: {
					gross: 15_483.87,
					net: 14_709.87,
					employer_cost: 774,
					BASIC: 15_483.87,
					'SSO.employee': 774,
					'SSO.employer': 774
				}
			}
		]
	}),

	// ─── Leave edges (TH-LEAVE-01, -07) ─────────────────────────────────────────────────────────
	th({
		id: 'TH-LEAVE-07-5',
		description:
			'Military leave on 60 working days, 5 January – 27 March 2026, then Monday 30 March: the 61st day is past s.58’s 60 paid days and comes off at 30,000 ÷ 31 = 967.74.',
		citation: [
			`LPA ss.35, 58 (${LPA}): wages for military leave for not more than 60 days a year. 5–30 January 20, 2–27 February 20, 2–27 March 20 working days.`,
			'Owner rule 2026-09-28 (register TH-WORK-05): gross 30,000 − 967.74 = 29,032.26.',
			`${SSA}: 875. ${P96}: 348,387.12 − 170,500 = 177,887.12 → 1,394.356 ÷ 12 = 116.19.`,
			'Net 29,032.26 − 875 − 116.19 = 28,041.07.'
		],
		inputs: [
			...person({ ref: 'drill', wage: 30_000 }),
			timeOff('drill', 'MILITARY_LEAVE', '2026-01-05', '2026-01-30'),
			timeOff('drill', 'MILITARY_LEAVE', '2026-02-02', '2026-02-27'),
			timeOff('drill', 'MILITARY_LEAVE', '2026-03-02', '2026-03-30')
		],
		period: '2026-03',
		expected: [
			{
				employment: 'drill_job',
				lines: {
					gross: 29_032.26,
					net: 28_041.07,
					employer_cost: 875,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 116.19
				}
			}
		]
	}),
	th({
		id: 'TH-LEAVE-01-2',
		description:
			'Maternity leave 1–10 December 2025 for one birth crosses 7 December 2025 (98/45 days before, 120/60 from): the entry is refused for transition review and December is paid whole.',
		citation: [
			'LPA s.41 as amended by No.9 B.E.2568 (in force 7 December 2025, https://ratchakitcha.soc.go.th/documents/89818.pdf): 120 days, 60 paid, against 98 and 45 before; No.9 states no transitional rule for leave begun before it (register TH-LEAVE-01).',
			'The December 2025 THB30,000 figures of TH-SS-01-3: SSO 750, PIT 170.87, net 29,079.13.'
		],
		inputs: [
			...person({ ref: 'cross', wage: 30_000, gender: 'FEMALE' }),
			{
				...timeOff('cross', 'MATERNITY_LEAVE', '2025-12-01', '2025-12-10', {
					event_kind: 'BIRTH',
					event_date: '2025-12-01'
				}),
				refused: 'MATERNITY_LEAVE across 2025-12-07 requires transition review\\.'
			}
		],
		period: '2025-12',
		expected: [
			{
				employment: 'cross_job',
				lines: {
					gross: 30_000,
					net: 29_079.13,
					employer_cost: 750,
					'SSO.employee': 750,
					'SSO.employer': 750,
					'PIT.employee': 170.87
				}
			}
		]
	}),

	// ─── The 48-hour week (TH-WORK-03, -07) ─────────────────────────────────────────────────────
	th({
		id: 'TH-WORK-03-4',
		description:
			'A monthly guard on THB24,000 works five agreed twelve-hour normal days, Monday 26 – Friday 30 October 2026: 60 normal hours exceed the 48 a week, so the run is refused.',
		citation: [
			'Guard regulation in force 24 April 2026 (https://ratchakitcha.soc.go.th/documents/68372.pdf): a normal day above eight hours only within 48 normal hours a week.',
			`LPA s.23 (${LPA}): normal hours at most 48 a week.`
		],
		inputs: [
			guardTwelve,
			...person({ ref: 'g60', wage: 24_000, terms: { statutory_work_category: 'GUARD_DUTY' } }),
			...guardWeek('g60', ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'])
		],
		period: '2026-10',
		refused:
			'P-TH-g60 has 60\\.00 normal hours in the week of 2026-10-26, above the 48-hour limit "ordinary_normal_week"',
		expected: []
	})
);

// ─── Round 10 (30 Sep 2026): s.23 redistribution, s.27 rest, s.24–25 consent exceptions, ss.39/1, 46–48, s.76
// deductions, s.51 Student Loan Fund, two employers, daily-paid maternity, training leave ──────────────────
const plain24k = {
	gross: 24_000,
	net: 23_125,
	employer_cost: 875,
	BASIC: 24_000,
	'SSO.employee': 875,
	'SSO.employer': 875
};
const PLAIN24K_LAW = `${SSA}: 24,000 → 875 each side. ${P96}: 288,000 − 100,000 − 60,000 − 10,500 = 117,500 → nil.`;
/** A week whose Monday is a nine-hour normal day and whose Tuesday is `tuesday` (LPA s.23 para.1). */
const nineHourWeek = (tuesday: Variant): ProbeInput[] => [
	...(
		[
			['nine', 'TH-NINE', { ...OFFICE, end_time: '19:00' }],
			['tue', 'TH-TUESDAY', tuesday]
		] as const
	).map(([ref, code, variant]) => ({
		collection: 'shift_definitions',
		ref,
		values: {
			company_id: '@company',
			code,
			name: code,
			variant,
			effective_range: { from: EPOCH, to: null }
		}
	})),
	{
		collection: 'shift_patterns',
		ref: 'week9',
		values: {
			company_id: '@company',
			code: 'TH-NINE-WEEK',
			name: 'Nine-hour Monday, then Tuesday, 3 x work, 2 x weekly holiday',
			pattern: {
				days: ['@nine', '@tue', '@work', '@work', '@work', '@rest', '@rest'].map(
					(roster_code_id) => ({ roster_code_id })
				)
			},
			effective_range: { from: EPOCH, to: null }
		}
	}
];
const NINE_DAY = [
	['09:00', '13:00'],
	['14:00', '19:00']
] as const;
/** A work day recorded without the per-occasion consent, under a s.24/s.25 exception and its evidence. */
const excepted = (
	ref: string,
	date: string,
	day: readonly (readonly [string, string])[],
	approved: number,
	facts: Row
): ProbeInput =>
	withValues(workDay(ref, date, day, approved), { overtime_consented_at: null, facts });
const deduction = (ref: string, code: string, amount: number, evidence = true): ProbeInput => ({
	...adhoc(ref, code, amount, '2026-02-16'),
	...(evidence ? { files: { evidence_file: `${code.toLowerCase()}-${ref}.pdf` } } : {})
});
const S76 = `LPA ss.70, 76, 77 (${LPA}; English text of the Department of Labour Protection and Welfare, https://www.mol.go.th/wp-content/uploads/sites/2/1998/01/Labour_Protection_Act_BE2541.pdf, read 30 Sep 2026): deductions under (2) union dues, (3) cooperative debts, (4) deposits or damage, (5) provident fund, each at most 10% and together at most one-fifth of the money due under s.70, unless the employee consents in advance in writing; (1) tax and payments provided by law are outside.`;
/** THB30,000 in February 2026 (the plain30k slip) less `other` baht of non-statutory deductions. */
const less30k = (other: number) => ({
	...plain30k,
	total_deductions: Math.round((875 + 164.58 + other) * 100) / 100,
	net: Math.round((28_960.42 - other) * 100) / 100
});

register(
	// ─── s.23 redistributed normal day (TH-WORK-07) ─────────────────────────────────────────────
	th({
		id: 'TH-WORK-07-7',
		description:
			'A nine-hour normal Monday agreed the day before, offset by a seven-hour Tuesday (40 normal hours in the week), January 2026: the ninth hour on Monday 5 January is ordinary working time, no overtime; THB24,000 paid whole.',
		citation: [
			`LPA s.23 para.1 as amended by No.2 B.E.2551 (${LPA}; MoL English text, https://www.mol.go.th/wp-content/uploads/sites/2/1998/01/Labour_Protection_Act_BE2541.pdf, read 30 Sep 2026): where a day’s normal hours are under eight, the parties may agree to make up the rest on other normal days, at most nine a day and 48 a week; para.2’s 1.5× for the hours above eight binds only daily, hourly and piece-rate pay, not a monthly wage.`,
			PLAIN24K_LAW,
			'Net 24,000 − 875 = 23,125.'
		],
		inputs: [
			...nineHourWeek(SEVEN_HOURS),
			...person({ ref: 'nine', wage: 24_000, terms: { shift_pattern_id: '@week9' } }),
			withValues(workDay('nine', '2026-01-05', NINE_DAY, 0), {
				facts: { normal_hours_redistribution_agreed_at: '2026-01-04T05:00:00.000Z' }
			})
		],
		period: '2026-01',
		expected: [{ employment: 'nine_job', lines: plain24k }]
	}),
	th({
		id: 'TH-WORK-07-8',
		description:
			'The same agreed nine-hour Monday with no shorter day in the week (Tuesday stays eight hours): the extra hour has nothing to offset it, so the run is refused.',
		citation: [
			`LPA s.23 para.1 (${LPA}): a normal day above eight hours only where the week’s other normal days are shortened to keep the total.`
		],
		inputs: [
			...nineHourWeek(OFFICE),
			...person({ ref: 'noshort', wage: 24_000, terms: { shift_pattern_id: '@week9' } }),
			withValues(workDay('noshort', '2026-01-05', NINE_DAY, 0), {
				facts: { normal_hours_redistribution_agreed_at: '2026-01-04T05:00:00.000Z' }
			})
		],
		period: '2026-01',
		refused: 'shorter-day hours to offset',
		expected: []
	}),
	th({
		id: 'TH-WORK-07-9',
		description:
			'A nine-hour Monday with no redistribution agreement, the ninth hour planned as overtime with consent: it is s.61 overtime at 1.5 × 100 = 150 on THB24,000.',
		citation: [
			`LPA ss.23, 61, 68 (${LPA}): without the s.23 agreement the normal day is eight hours; work beyond it is overtime at least 1.5× the hourly rate, 24,000 ÷ (30 × 8) = 100.`,
			`${SSA}: overtime outside the s.5 wage: 875. ${P96}: 288,000 and 288,150 annualised both nil (cl.1(5)).`,
			'Gross 24,150; net 24,150 − 875 = 23,275.'
		],
		inputs: [
			...nineHourWeek(SEVEN_HOURS),
			...person({ ref: 'unagreed', wage: 24_000, terms: { shift_pattern_id: '@week9' } }),
			workDay('unagreed', '2026-01-05', NINE_DAY, 1)
		],
		period: '2026-01',
		expected: [{ employment: 'unagreed_job', lines: { ...plain24k, gross: 24_150, net: 23_275 } }]
	}),

	// ─── s.27 rest (TH-WORK-07) ─────────────────────────────────────────────────────────────────
	th({
		id: 'TH-WORK-07-10',
		description:
			'A 09:00–18:00 normal day whose hour of rest is not timed (no break start on the shift), January 2026: nothing shows a rest within the first five hours, so the run is refused.',
		citation: [
			`LPA s.27 para.1 (${LPA}): a rest of at least one hour a day after no more than five consecutive hours of work.`
		],
		work: { kind: 'WORK', start_time: '09:00', end_time: '18:00', break_minutes: 60 },
		inputs: person({ ref: 'untimed', wage: 24_000 }),
		period: '2026-01',
		refused: 'over five consecutive hours without a timed Thai s\\.27 break',
		expected: []
	}),
	th({
		id: 'TH-WORK-07-11',
		description:
			'Monday 5 January 2026 worked 09:00–11:00 and 14:00–18:00: a three-hour rest, which s.27 para.3 counts as working time beyond two hours; the run is refused for the wage treatment the law requires.',
		citation: [
			`LPA s.27 para.3 (${LPA}; MoL English text, https://www.mol.go.th/wp-content/uploads/sites/2/1998/01/Labour_Protection_Act_BE2541.pdf, read 30 Sep 2026): rest periods together above two hours a day count as normal working time for the excess.`
		],
		inputs: [
			...person({ ref: 'longrest', wage: 24_000 }),
			workDay(
				'longrest',
				'2026-01-05',
				[
					['09:00', '11:00'],
					['14:00', '18:00']
				],
				0
			)
		],
		period: '2026-01',
		refused: 'Thai s\\.27 wage treatment for rest over two hours',
		expected: []
	}),
	th({
		id: 'TH-WORK-07-12',
		description:
			'Monday 5 January 2026 with the hour of rest split into two half hours (09:00–11:00, 11:30–13:30, 14:00–18:00) and no agreement recorded: the run is refused.',
		citation: [
			`LPA s.27 para.1 (${LPA}): the employer and employee may agree to split the rest into periods, each of which together make at least one hour — by prior agreement.`
		],
		inputs: [
			...person({ ref: 'split', wage: 24_000 }),
			workDay(
				'split',
				'2026-01-05',
				[
					['09:00', '11:00'],
					['11:30', '13:30'],
					['14:00', '18:00']
				],
				0
			)
		],
		period: '2026-01',
		refused: 'prior split-break agreement',
		expected: []
	}),
	th({
		id: 'TH-WORK-07-13',
		description:
			'The same split rest on Monday 5 January 2026, agreed on 4 January: lawful, the eight hours are normal time and THB24,000 is paid whole.',
		citation: [`LPA s.27 para.1 (${LPA}).`, PLAIN24K_LAW, 'Net 23,125.'],
		inputs: [
			...person({ ref: 'splitok', wage: 24_000 }),
			withValues(
				workDay(
					'splitok',
					'2026-01-05',
					[
						['09:00', '11:00'],
						['11:30', '13:30'],
						['14:00', '18:00']
					],
					0
				),
				{ facts: { split_break_agreed_at: '2026-01-04T05:00:00.000Z' } }
			)
		],
		period: '2026-01',
		expected: [{ employment: 'splitok_job', lines: plain24k }]
	}),
	th({
		id: 'TH-WORK-07-14',
		description:
			'Three overtime hours on Monday 5 January 2026 after only five minutes’ rest (18:00–18:05): two or more hours of overtime need 20 minutes’ rest first, so the run is refused.',
		citation: [
			`LPA s.27 para.4 (${LPA}): where overtime of two hours or more follows normal work, a rest of at least 20 minutes before it.`
		],
		inputs: [
			...person({ ref: 'norest', wage: 24_000 }),
			workDay(
				'norest',
				'2026-01-05',
				[
					['09:00', '13:00'],
					['14:00', '18:00'],
					['18:05', '21:05']
				],
				3
			)
		],
		period: '2026-01',
		refused: 'timed 20-minute rest before Thai overtime',
		expected: []
	}),

	// ─── s.24–25 consent exceptions (TH-WORK-07) ────────────────────────────────────────────────
	th({
		id: 'TH-WORK-07-15',
		description:
			'Three overtime hours on Monday 5 January 2026 with no consent but under the s.24 para.2 continuous-work exception (work that would damage if stopped), its production log recorded: paid at 1.5 × 100 = 450.',
		citation: [
			`LPA s.24 para.2 (${LPA}): where work must continue lest it be damaged, or is emergency work, the employer may require overtime as necessary without the consent.`,
			`${SSA}: 875. ${P96}: 288,000 and 288,450 both nil.`,
			'Gross 24,450; net 24,450 − 875 = 23,575.'
		],
		inputs: [
			...person({ ref: 'kiln', wage: 24_000 }),
			excepted('kiln', '2026-01-05', LONG_DAY, 3, {
				consent_exception: 'CONTINUOUS_DAMAGE_IF_STOPPED',
				consent_exception_reference: 'production-log-7'
			})
		],
		period: '2026-01',
		expected: [{ employment: 'kiln_job', lines: { ...plain24k, gross: 24_450, net: 23_575 } }]
	}),
	th({
		id: 'TH-WORK-07-16',
		description:
			'A hotel employee works the weekly holiday, Saturday 10 January 2026, eight hours without a recorded consent under the s.25 hotel exception (licence recorded): s.62(1) 8 × 100 = 800.',
		citation: [
			`LPA s.25 paras.1–2 (${LPA}): holiday work without consent where the work must continue, is emergency work (para.1), or is in a hotel, entertainment, transport, food-and-drink, club, association or health-facility business or others the Ministerial Regulation lists.`,
			`LPA ss.62(1), 68: 8 × 24,000 ÷ 240 = 800. ${SSA}: 875. ${P96}: nil.`,
			'Gross 24,800; net 24,800 − 875 = 23,925.'
		],
		inputs: [
			...person({ ref: 'hotelhol', wage: 24_000 }),
			excepted('hotelhol', '2026-01-10', NORMAL_DAY, 8, {
				consent_exception: 'HOLIDAY_HOTEL',
				consent_exception_reference: 'hotel-licence-9'
			})
		],
		period: '2026-01',
		expected: [{ employment: 'hotelhol_job', lines: { ...plain24k, gross: 24_800, net: 23_925 } }]
	}),
	th({
		id: 'TH-WORK-07-17',
		description:
			'The s.25 hotel holiday-work exception claimed for overtime on an ordinary Monday, 5 January 2026: it covers holiday work only, so the run is refused.',
		citation: [
			`LPA ss.24–25 (${LPA}): s.25’s business list lifts consent for holiday work; s.24 para.1 still requires consent for overtime on a working day.`
		],
		inputs: [
			...person({ ref: 'misuse', wage: 24_000 }),
			excepted('misuse', '2026-01-05', LONG_DAY, 3, {
				consent_exception: 'HOLIDAY_HOTEL',
				consent_exception_reference: 'hotel-licence-9'
			})
		],
		period: '2026-01',
		refused: 'holiday-work exception on an ordinary day',
		expected: []
	}),
	th({
		id: 'TH-WORK-07-18',
		description:
			'The continuous-work exception claimed for Monday 5 January 2026 with no evidence reference: the run is refused.',
		citation: [
			`LPA s.24 para.2 (${LPA}). Owner rule 2026-09-28 (register TH-WORK-07): an exception to the consent the Act requires is recorded with its evidence.`
		],
		inputs: [
			...person({ ref: 'noproof', wage: 24_000 }),
			excepted('noproof', '2026-01-05', LONG_DAY, 3, {
				consent_exception: 'CONTINUOUS_DAMAGE_IF_STOPPED'
			})
		],
		period: '2026-01',
		refused: 'needs evidence for the Thai consent exception',
		expected: []
	}),

	// ─── Young and pregnant workers (TH-HR-07) ──────────────────────────────────────────────────
	th({
		id: 'TH-HR-07-5',
		description:
			'A 17-year-old, every February 2026 weekday clocked, works Saturday 7 February, a weekly holiday: s.48 forbids holiday work under 18, so the run is refused.',
		citation: [`LPA s.48 (${LPA}): no employee under 18 may work overtime or on a holiday.`],
		inputs: [
			...person({ ref: 'teenhol', wage: 12_000, dob: '2008-06-15', hire: '2025-12-01' }),
			...clockedMonth('teenhol', '2026-02'),
			workDay('teenhol', '2026-02-07', NORMAL_DAY, 8)
		],
		period: '2026-02',
		refused: 'P-TH-teenhol cannot work on a Thai holiday.*under 18',
		expected: []
	}),
	th({
		id: 'TH-HR-07-6',
		description:
			'A pregnant employee works the weekly holiday, Saturday 10 January 2026: s.39/1 forbids holiday work while pregnant, so the run is refused.',
		citation: [
			`LPA s.39/1 para.1 (${LPA}): no work 22:00–06:00, overtime or holiday work by a pregnant employee.`
		],
		inputs: [
			...person({
				ref: 'preghol',
				wage: 24_000,
				gender: 'FEMALE',
				terms: { facts: { hazardous_work: false, pregnancy_status: 'PREGNANT' } }
			}),
			workDay('preghol', '2026-01-10', NORMAL_DAY, 8)
		],
		period: '2026-01',
		refused: 'P-TH-preghol cannot perform Thai night or holiday work while pregnant',
		expected: []
	}),
	th({
		id: 'TH-HR-07-7',
		description:
			'A pregnant employee rostered 15:00–23:00 (rest at 19:00), January 2026: the hour after 22:00 is night work s.39/1 forbids, so the run is refused.',
		citation: [`LPA s.39/1 para.1 (${LPA}).`],
		work: {
			kind: 'WORK',
			start_time: '15:00',
			end_time: '23:00',
			break_minutes: 60,
			break_start_time: '19:00'
		},
		inputs: person({
			ref: 'pregnight',
			wage: 24_000,
			gender: 'FEMALE',
			terms: { facts: { hazardous_work: false, pregnancy_status: 'PREGNANT' } }
		}),
		period: '2026-01',
		refused: 'P-TH-pregnight cannot perform Thai night or holiday work while pregnant',
		expected: []
	}),
	th({
		id: 'TH-HR-07-8',
		description:
			'A 17-year-old clocked every February 2026 weekday, Monday 2 February worked 09:00–13:01 before the hour’s rest: more than four hours without a continuous hour’s rest, so the run is refused.',
		citation: [
			`LPA s.46 (${LPA}): an employee under 18 has a rest of at least one continuous hour after no more than four hours of work.`
		],
		inputs: [
			...person({ ref: 'teenrun', wage: 12_000, dob: '2008-06-15', hire: '2025-12-01' }),
			...clockedMonth('teenrun', '2026-02').filter(
				(input) => input.values.work_date !== '2026-02-02'
			),
			workDay(
				'teenrun',
				'2026-02-02',
				[
					['09:00', '13:01'],
					['14:01', '18:00']
				],
				0
			)
		],
		period: '2026-02',
		refused: 'continuous 60-minute rest.*four hours',
		expected: []
	}),
	th({
		id: 'TH-HR-07-9',
		description:
			'A 17-year-old with no clocked work days in February 2026: ss.46–48 are judged on the timed day, so the run is refused until the work and rest are recorded.',
		citation: [
			`LPA ss.46–48 (${LPA}). Owner rule 2026-09-28 (register TH-HR-07): an under-18 day is proven by its timed records.`
		],
		inputs: person({ ref: 'teenblank', wage: 12_000, dob: '2008-06-15', hire: '2025-12-01' }),
		period: '2026-02',
		refused: 'timed work and rest records',
		expected: []
	}),

	// ─── Guards across the cutover, non-monthly (TH-WORK-03) ─────────────────────────────────────
	th({
		id: 'TH-WORK-03-5',
		description:
			'An hourly guard on THB100, April 2026: Saturday 18 April nine hours and Thursday 23 April three overtime hours under the 2009 regulation (1× per overtime hour); Friday 24 April three hours at 1.25× and Saturday 25 April’s ninth hour at 2.5× under the 2025 regulation; each weekly holiday’s eight normal hours at s.62(2)’s 2× (the hourly-paid are not paid the weekly holiday).',
		citation: [
			'2009 guard regulation (MoL copy, https://www.mol.go.th/wp-content/uploads/sites/2/2018/07/181.pdf): overtime and holiday overtime at one hourly rate each; 2025 regulation in force 24 April 2026 (https://ratchakitcha.soc.go.th/documents/68372.pdf): working-day overtime ≥ 1.25×, holiday overtime ≥ 2.5×.',
			`LPA ss.56 para.1, 62(2) (${LPA}): an hourly employee is not paid for the weekly holiday, so holiday work earns at least 2× per hour: 8 × 200 = 1,600 each Saturday.`,
			'April 2026 has 22 weekdays: 176 normal hours × 100 = 17,600. 18 Apr 1,600 + 100; 23 Apr 300; 24 Apr 375; 25 Apr 1,600 + 250: 4,225; gross 21,825.',
			`${SSA}: s.5 wage 17,600 → ceiling 17,500 → 875. ${P96}: 211,200 − 100,000 − 60,000 − 10,500 = 40,700 → nil, with the overtime still nil.`,
			'Net 21,825 − 875 = 20,950.'
		],
		inputs: [
			...person({
				ref: 'hguard',
				wage: 100,
				terms: { pay_frequency: 'HOURLY', statutory_work_category: 'GUARD_DUTY' }
			}),
			workDay('hguard', '2026-04-18', NINE_HOURS, 9),
			workDay('hguard', '2026-04-23', LONG_DAY, 3),
			workDay('hguard', '2026-04-24', LONG_DAY, 3),
			workDay('hguard', '2026-04-25', NINE_HOURS, 9)
		],
		period: '2026-04',
		expected: [
			{
				employment: 'hguard_job',
				lines: {
					gross: 21_825,
					net: 20_950,
					employer_cost: 875,
					'SSO.employee': 875,
					'SSO.employer': 875
				}
			}
		]
	}),

	// ─── s.76 deductions and the Student Loan Fund (TH-DEDUCT-01, -02) ──────────────────────────
	th({
		id: 'TH-DEDUCT-01-1',
		description:
			'Union dues of THB3,000 on THB30,000, February 2026: exactly 10% of the money due, so they are taken.',
		citation: [S76, '10% × 30,000 = 3,000.', `${SSA}; ${P96}: the THB30,000 figures above.`],
		inputs: [
			...person({ ref: 'union', wage: 30_000 }),
			deduction('union', 'UNION_DUES', 3_000, false)
		],
		period: '2026-02',
		expected: [{ employment: 'union_job', lines: less30k(3_000) }]
	}),
	th({
		id: 'TH-DEDUCT-01-2',
		description:
			'Union dues of THB3,000.01 on THB30,000 without the employee’s consent to exceed: a satang over s.76’s 10%, so the run is refused.',
		citation: [S76, '10% × 30,000 = 3,000 < 3,000.01.'],
		inputs: [
			...person({ ref: 'unionover', wage: 30_000 }),
			deduction('unionover', 'UNION_DUES', 3_000.01, false)
		],
		period: '2026-02',
		refused:
			'DEDUCTION_CEILING_EXCEEDED.*P-TH-unionover: deductions exceed the lawful ceiling by 0\\.01 THB',
		expected: []
	}),
	th({
		id: 'TH-DEDUCT-01-3',
		description:
			'Union dues THB3,000 and a consented cooperative debt THB3,000 on THB30,000: each at 10%, together exactly one-fifth, so both are taken.',
		citation: [
			S76,
			'20% × 30,000 = 6,000 = 3,000 + 3,000.',
			`${SSA}; ${P96}: the THB30,000 figures above.`
		],
		inputs: [
			...person({ ref: 'fifth', wage: 30_000 }),
			deduction('fifth', 'UNION_DUES', 3_000, false),
			deduction('fifth', 'COOPERATIVE_DEDUCTION', 3_000)
		],
		period: '2026-02',
		expected: [{ employment: 'fifth_job', lines: less30k(6_000) }]
	}),
	th({
		id: 'TH-DEDUCT-01-4',
		description:
			'The same two deductions plus a consented damage compensation of THB0.01: each item within 10% but together a satang over one-fifth, so the run is refused.',
		citation: [S76, '3,000 + 3,000 + 0.01 = 6,000.01 > 6,000.'],
		inputs: [
			...person({ ref: 'fifthover', wage: 30_000 }),
			deduction('fifthover', 'UNION_DUES', 3_000, false),
			deduction('fifthover', 'COOPERATIVE_DEDUCTION', 3_000),
			deduction('fifthover', 'DAMAGE_COMPENSATION', 0.01)
		],
		period: '2026-02',
		refused:
			'DEDUCTION_CEILING_EXCEEDED.*P-TH-fifthover: deductions exceed the lawful ceiling by 0\\.01 THB',
		expected: []
	}),
	th({
		id: 'TH-DEDUCT-01-5',
		description:
			'A THB10,000 cooperative repayment the employee consented in writing to have taken above the s.76 limits, on THB30,000: taken whole.',
		citation: [
			S76,
			's.76 last para.: “except with the prior consent of the Employee”; s.77 the consent in writing (the uploaded evidence).',
			`${SSA}; ${P96}: the THB30,000 figures above.`
		],
		inputs: [
			...person({ ref: 'consented', wage: 30_000 }),
			deduction('consented', 'CONSENTED_DEDUCTION', 10_000)
		],
		period: '2026-02',
		expected: [{ employment: 'consented_job', lines: less30k(10_000) }]
	}),
	th({
		id: 'TH-DEDUCT-02-1',
		description:
			'A Student Loan Fund notification of THB5,000 for February 2026 beside the full one-fifth of s.76 deductions (union 3,000, cooperative 3,000) on THB30,000: the Fund’s amount is a payment the law requires, outside s.76’s limits, taken after tax and social security.',
		citation: [
			'Student Loan Fund Act B.E.2560 s.51 para.1 (as replaced by Act No.2 B.E.2566 s.23, https://www.studentloan.or.th/en/system/files/files/knowledge/140A020N0000000001400.pdf) and para.2 (https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/prbkys.pdf): the payer of s.40(1) income deducts the amount the Fund notifies, first after withholding tax and the social-security and labour-protection deductions.',
			S76,
			`${SSA}; ${P96}: the THB30,000 figures above; the repayment is no income-tax relief.`,
			'Net 28,960.42 − 5,000 − 6,000 = 17,960.42.'
		],
		inputs: [
			...person({ ref: 'slf', wage: 30_000 }),
			deduction('slf', 'UNION_DUES', 3_000, false),
			deduction('slf', 'COOPERATIVE_DEDUCTION', 3_000),
			deduction('slf', 'SLF_DEDUCTION', 5_000)
		],
		period: '2026-02',
		expected: [{ employment: 'slf_job', lines: less30k(11_000) }]
	}),

	// ─── One insured person, two employers (TH-SS-11) ───────────────────────────────────────────
	th({
		id: 'TH-SS-11-2',
		description:
			'An insured person employed at the same time by this company on THB10,000 and by a second company on THB20,000, January 2026: this employer assesses s.33 on its own wage alone, 10,000 × 5% = 500 each side, not on the combined 30,000 (which would reach the 17,500 ceiling).',
		citation: [
			`${SSA}; s.46 para.3–4 and s.48 (same consolidation): contributions on the wages from each employer are computed separately, each employer liable under ss.46–47.`,
			`${P96}: this employer withholds on its own payment: 120,000 − 60,000 − 60,000 − 6,000 → nil.`,
			'Net 10,000 − 500 = 9,500.'
		],
		inputs: [
			...person({ ref: 'dual', wage: 10_000 }),
			{
				collection: 'companies',
				ref: 'co2',
				values: {
					settings_code: 'TH',
					name: 'TH-SS-11-2 second employer',
					pay_cutoff_day: 1,
					pay_frequency: 'MONTHLY',
					effective_range: { from: EPOCH, to: null }
				}
			},
			...week().map((input) =>
				withValues(
					{ ...input, ref: `${input.ref}2` },
					{
						company_id: '@co2',
						code: `${String(input.values.code)}-2`,
						...(input.collection === 'shift_patterns'
							? {
									pattern: {
										days: [
											'@work2',
											'@work2',
											'@work2',
											'@work2',
											'@work2',
											'@rest2',
											'@rest2'
										].map((roster_code_id) => ({ roster_code_id }))
									}
								}
							: {})
					}
				)
			),
			{
				collection: 'employments',
				ref: 'dual2_job',
				values: {
					employee_id: '@dual',
					company_id: '@co2',
					employee_number: 'P-TH-dual-2',
					effective_range: { from: '2020-01-01', to: null }
				}
			},
			{
				collection: 'employment_terms',
				values: {
					employment_id: '@dual2_job',
					residency_status: 'CITIZEN',
					tax_residency: 'RESIDENT',
					currency: 'THB',
					base_salary: 20_000,
					pay_frequency: 'MONTHLY',
					work_classification: 'EA_COVERED',
					statutory_work_category: 'NON_MANUAL',
					employment_type: 'PERMANENT',
					worksite: 'Bangkok',
					facts: { hazardous_work: false, pregnancy_status: 'NOT_PREGNANT' },
					shift_pattern_id: '@week2',
					effective_range: { from: '2020-01-01', to: null }
				}
			}
		],
		period: '2026-01',
		expected: [
			{
				employment: 'dual_job',
				lines: {
					gross: 10_000,
					net: 9_500,
					employer_cost: 500,
					BASIC: 10_000,
					'SSO.employee': 500,
					'SSO.employer': 500
				}
			}
		]
	}),

	// ─── Leave (TH-LEAVE-01, -07) ───────────────────────────────────────────────────────────────
	th({
		id: 'TH-LEAVE-01-3',
		description:
			'A daily-paid worker (THB400, Bangkok) on maternity leave from Monday 2 February 2026 after a 1 February birth: every day of the leave to 28 February (27 days, holidays counted, all within the first 60) is paid at the working-day wage: 10,800.',
		citation: [
			`LPA s.41 paras.1, 3 and s.59 as amended by No.9 (in force 7 December 2025; https://ratchakitcha.soc.go.th/documents/89818.pdf, consolidation ${LPA}): up to 120 days, holidays within the leave counted; the employee is paid a wage equal to the working-day wage throughout the leave, for not more than 60 days: 27 × 400 = 10,800.`,
			`${SSA}: leave pay is wage (s.5): 10,800 × 5% = 540. ${P96}: 129,600 annualised, nil.`,
			'Net 10,800 − 540 = 10,260.'
		],
		inputs: [
			...person({
				ref: 'mdaily',
				wage: 400,
				gender: 'FEMALE',
				terms: {
					...dailyTerms('Bangkok'),
					facts: { hazardous_work: false, pregnancy_status: 'PREGNANT' }
				}
			}),
			timeOff('mdaily', 'MATERNITY_LEAVE', '2026-02-02', '2026-02-28', {
				event_kind: 'BIRTH',
				event_date: '2026-02-01'
			})
		],
		period: '2026-02',
		expected: [
			{
				employment: 'mdaily_job',
				lines: {
					gross: 10_800,
					net: 10_260,
					employer_cost: 540,
					'SSO.employee': 540,
					'SSO.employer': 540
				}
			}
		]
	}),
	th({
		id: 'TH-LEAVE-07-6',
		description:
			'Two days of training leave (10–11 February 2026) with no agreed pay: s.36 grants the leave but no wage, so the two calendar days come off at 30,000 ÷ 28 = 1,071.43 each.',
		citation: [
			`LPA ss.36, 57 (${LPA}): training or skills-development leave per the Ministerial Regulation; no section pays wages for it (s.57 pays sick and sterilisation, s.57/1 personal business, s.58 military). The catalogue pays the agreed fraction, here none.`,
			'Owner rule 2026-09-28 (register TH-WORK-05): 30,000 − 2 × 1,071.43 = 27,857.14.',
			`${SSA}: 875. ${P96}: 334,285.68 − 170,500 = 163,785.68 → 13,785.68 × 5% = 689.284 ÷ 12 = 57.44.`,
			'Net 27,857.14 − 875 − 57.44 = 26,924.70.'
		],
		inputs: [
			...person({ ref: 'course', wage: 30_000 }),
			timeOff('course', 'TRAINING_LEAVE', '2026-02-10', '2026-02-11', { agreed_pay_fraction: 0 })
		],
		period: '2026-02',
		expected: [
			{
				employment: 'course_job',
				lines: {
					gross: 27_857.14,
					net: 26_924.7,
					employer_cost: 875,
					'SSO.employee': 875,
					'SSO.employer': 875,
					'PIT.employee': 57.44
				}
			}
		]
	}),
	th({
		id: 'TH-LEAVE-07-7',
		description:
			'A 17-year-old takes three days’ leave for a training course (10–12 February 2026), the other February weekdays clocked: s.52 pays up to 30 days a year, so THB12,000 is paid whole.',
		citation: [
			`LPA s.52 (${LPA}): an employee under 18 may take leave for meetings, seminars, training or study, paid for not more than 30 days a year.`,
			`${SSA}: 12,000 × 5% = 600. ${P96}: 144,000 − 72,000 − 60,000 − 7,200 = 4,800 → nil.`,
			'Net 12,000 − 600 = 11,400.'
		],
		inputs: [
			...person({ ref: 'teenstudy', wage: 12_000, dob: '2008-06-15', hire: '2025-12-01' }),
			...clockedMonth('teenstudy', '2026-02').filter(
				(input) =>
					!['2026-02-10', '2026-02-11', '2026-02-12'].includes(String(input.values.work_date))
			),
			timeOff('teenstudy', 'YOUNG_WORKER_TRAINING_LEAVE', '2026-02-10', '2026-02-12')
		],
		period: '2026-02',
		expected: [
			{
				employment: 'teenstudy_job',
				lines: {
					gross: 12_000,
					net: 11_400,
					employer_cost: 600,
					BASIC: 12_000,
					'SSO.employee': 600,
					'SSO.employer': 600
				}
			}
		]
	})
);
