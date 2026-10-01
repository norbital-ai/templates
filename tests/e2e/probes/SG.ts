import {
	officeWeek,
	register,
	type ProbeCase,
	type ProbeInput,
	type Row
} from '../payroll-probe.ts';

/**
 * SG cases: see the case shape at the top of payroll-probe.ts. Every figure is computed by hand from the cited
 * source; `pay` only adds those hand figures up (net = gross − employee shares, employer cost = employer shares).
 *
 * Common facts, unless a case says otherwise: the company pays monthly with a cutoff on the 1st, so the run's window
 * is the calendar month; the week is Monday–Friday 09:00–18:00 with an hour's break (8 normal hours), Saturday the
 * off day and Sunday the rest day, anchored on Monday 2 June 2025. September 2026 and October 2026 hold no public
 * holiday (MOM), so each has 22 working days; no holiday is published for a case unless it says so. Nobody is a
 * workman unless stated (NON_MANUAL). Singapore withholds no income tax from pay, resident or not (IRAS: tax is
 * assessed on the employee, the employer only files IR8A/AIS), so no case lists a tax line and the harness fails any
 * statutory charge a case does not list.
 */

const HIRED = '2025-06-02';

const CPF_2026 =
	'CPF Board, CPF Contribution Rate Table from 1 January 2026, Tables 1–5 (steps: total rounded to the nearest dollar, 50 cents up; employee share rounded down to the dollar; employer = total − employee; OW capped at $8,000) (https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf)';
const CPF_2025 =
	'CPF Board, CPF Contribution Rate Table from 1 January 2025, Table 1 (OW capped at $7,400; same rounding steps) (https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPF_contribution_rates_from_1_Jan_2025.pdf)';
const CPF_2027 =
	'CPF Board, CPF contribution changes from 1 January 2027: above 55 to 60 total 35.5% (employer 16.5%, employee 19%); above 60 to 65 total 26% (13% each); other ages unchanged (https://www.cpf.gov.sg/employer/infohub/news/cpf-related-announcements/new-contribution-rates)';
const CPF_AGE =
	'CPF Board, How much CPF contributions to pay: "New contribution rates apply from the first day of the month after the employee’s 55th, 60th, 65th or 70th birthday" (https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay)';
const CPF_SPR =
	'CPF Board, foreign employee who obtains SPR status: first-year rates from the day of SPR status to the last day of the month of the first anniversary, second-year rates to the last day of the month of the second anniversary, full rates after; in the conversion month CPF is on the pro-rated OW from the SPR day (https://www.cpf.gov.sg/service/article/do-i-need-to-pay-cpf-contributions-for-my-foreign-employee-who-has-recently-obtained-singapore-permanent-residence-status)';
const CPF_AW =
	'CPF Board, AW ceiling: $102,000 less the total Ordinary Wages subject to CPF for the year, per employee, per employer, per calendar year (https://www.cpf.gov.sg/service/article/what-is-the-additional-wage-aw-ceiling)';
const CPF_WAGES =
	'CPF Board, What payments attract CPF contributions: bonus and overtime are wages; "Compensation that is not given for services or work done by the employee. For example, retrenchment benefit" is not (https://www.cpf.gov.sg/employer/employer-obligations/what-payments-attract-cpf-contributions)';
const CPF_ACT =
	'CPF Act 1953 s.7 and First Schedule: contributions are payable for citizen and permanent-resident employees only; OW is remuneration due wholly and exclusively for the month, everything else is AW (https://sso.agc.gov.sg/Act/CPFA1953)';
const SHG =
	'CPF Board, Contributions to self-help groups — CDAC (Chinese citizens and SPRs): ≤$2,000 $0.50, >$2,000–3,500 $1, >$3,500–5,000 $1.50, >$5,000–7,500 $2, >$7,500 $3; ECF (Eurasian citizens and SPRs): ≤$1,000 $2, >1,000–1,500 $4, >1,500–2,500 $6, >2,500–4,000 $9, >4,000–7,000 $12, >7,000–10,000 $16, >10,000 $20; MBMF (Muslim citizens, SPRs and foreign employees, by religion): ≤1,000 $3, >1,000–2,000 $4.50, >2,000–3,000 $6.50, >3,000–4,000 $15, >4,000–6,000 $19.50, >6,000–8,000 $22, >8,000–10,000 $24, >10,000 $26; SINDA (Indian citizens, SPRs, EP holders): ≤1,000 $1, >1,000–1,500 $3, >1,500–2,500 $5, >2,500–4,500 $7, >4,500–7,500 $9, >7,500–10,000 $12, >10,000–15,000 $18, >15,000 $30; all on the month’s total wages; MBMF by religion, the others by the (first) NRIC race (https://www.cpf.gov.sg/employer/employer-obligations/contributions-to-self-help-groups)';
const SDL =
	'SDL Act 1979 s.3(1)–(2) and CPF Board, Skills Development Levy: 0.25% of the month’s total wages, minimum $2 (earning under $800), maximum $11.25 (earning over $4,500), for all employees working in Singapore including foreign employees (https://sso.agc.gov.sg/Act/SDLA1979#pr3-; https://www.cpf.gov.sg/employer/employer-obligations/skills-development-levy); per-employee cents rounded half up, the Act being silent (tracker SG-SDL13 owner rule)';
const EA_20A =
	'Employment Act 1968 s.20A(1): an incomplete month (joined after the 1st, terminated before the end, no-pay leave) is paid monthly gross rate × days actually worked ÷ days required to work in the month (https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr20A-)';
const EA_PART4 =
	'Employment Act 1968 s.35 (Part 4 reaches a workman on ≤$4,500 and a non-workman on ≤$2,600), s.38(4) (1.5 × the hourly basic rate beyond normal hours), Fourth Schedule items 1–2 (hourly basic rate = 12 × monthly basic ÷ (52 × 44)), Third Schedule item 2 and s.107A (basic rate for one day = 12 × monthly basic ÷ (52 × days required a week)) (https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr35-,pr38-,pr107A-,Sc3-,Sc4-)';
const EA_88A =
	'Employment Act 1968 s.88A(1)–(3) (7 days for the first 12 months; a part year in proportion to completed months, a fraction of one-half or more is a day), s.88A(8) (dismissed other than for misconduct: the gross rate of pay for every untaken day), s.107A and Third Schedule item 2 (gross rate for one day = 12 × monthly gross ÷ (52 × days a week)) (https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr88A-,pr107A-,Sc3-)';

type Residency = 'CITIZEN' | 'PERMANENT_RESIDENT' | 'FOREIGNER';
type Terms = {
	salary: number;
	from?: string;
	to?: string | null;
	residency?: Residency;
	since?: string;
	pass?: string;
	tax?: 'RESIDENT' | 'NON_RESIDENT';
	category?: 'NON_MANUAL' | 'MANUAL_LABOUR';
	/** EA_COVERED unless stated (MANAGERIAL: a managerial or executive position, EA s.35(b)). */
	classification?: 'EA_COVERED' | 'MANAGERIAL';
	/** The opening attendance declaration: absence decided outside through `through`, `absent` unexcused days. */
	opening?: { through: string; absent: number };
	/** Declared terms inputs (`terms_facts`). */
	facts?: Row;
};
type Hire = {
	name: string;
	born: string;
	race: string;
	religion?: string;
	nationality?: string;
	from?: string;
	to?: string;
	exit?: Row;
	terms: readonly Terms[];
	/** SDL elections replacing the Singapore-service, non-household defaults. */
	sdl?: Row;
};

/** One person `e` with employment `e_job`: the employee, the contract, its dated terms and the SDL declaration. */
function hire(h: Hire): ProbeInput[] {
	const from = h.from ?? HIRED;
	return [
		{
			collection: 'employees',
			ref: 'e',
			values: {
				name: h.name,
				date_of_birth: h.born,
				gender: 'MALE',
				nationality: h.nationality ?? 'Singaporean',
				race: h.race,
				religion: h.religion ?? 'OTHER'
			}
		},
		{
			collection: 'employments',
			ref: 'e_job',
			values: {
				employee_id: '@e',
				company_id: '@company',
				employee_number: 'P-SG-001',
				effective_range: { from, to: h.to ?? null },
				...h.exit
			}
		},
		...h.terms.map((t): ProbeInput => ({
			collection: 'employment_terms',
			values: {
				employment_id: '@e_job',
				residency_status: t.residency ?? 'CITIZEN',
				...(t.since == null ? {} : { residency_since: t.since }),
				...(t.pass == null ? {} : { pass_type: t.pass }),
				tax_residency: t.tax ?? 'RESIDENT',
				currency: 'SGD',
				base_salary: t.salary,
				pay_frequency: 'MONTHLY',
				work_classification: t.classification ?? 'EA_COVERED',
				statutory_work_category: t.category ?? 'NON_MANUAL',
				employment_type: 'PERMANENT',
				shift_pattern_id: '@week',
				...(t.opening == null
					? {}
					: {
							opening_attendance_through: t.opening.through,
							opening_unexcused_absence_days: t.opening.absent,
							opening_attendance_reference: 'PROBE-OPENING-ATTENDANCE'
						}),
				...(t.facts == null ? {} : { facts: t.facts }),
				effective_range: { from: t.from ?? from, to: t.to ?? h.to ?? null }
			}
		})),
		registration('SDL', from, {
			reference_number: 'PROBE-SDL',
			elections: {
				sdl_service_scope: 'SINGAPORE_SERVICE',
				sdl_household_role: 'NONE',
				sdl_wholly_exclusive: false,
				sdl_nonbusiness: false,
				sdl_student_class: 'NONE',
				...h.sdl
			}
		})
	];
}

/** A registration of `e_job` with one scheme, carrying elections or an opening. */
const registration = (scheme: string, from: string, status: Row): ProbeInput => ({
	collection: 'employment_statutory_facts',
	values: {
		employee_id: '@e',
		employment_id: '@e_job',
		statutory_contribution_id: `@law:statutory_contributions:${scheme}`,
		effective_range: { from, to: null },
		status: { kind: 'REGISTERED', ...status }
	}
});

/** A work day at +08:00: `[from, to]` clock pairs, and the planned overtime they confirm. */
const workDay = (
	date: string,
	clock: readonly (readonly [string, string])[],
	extra: Row = {}
): ProbeInput => ({
	collection: 'work_days',
	values: {
		employment_id: '@e_job',
		work_date: date,
		worked_intervals: clock.map(([start, end]) => ({
			start: `${date}T${start}:00+08:00`,
			end: `${date}T${end}:00+08:00`
		})),
		...extra
	}
});

const holiday = (date: string, name: string): ProbeInput => ({
	collection: 'jurisdiction_holidays',
	values: {
		company_id: '@company',
		date,
		name,
		kind: 'PUBLIC_HOLIDAY',
		source: 'MOM public holidays 2026',
		published_at: '2026-01-01T00:00:00.000Z'
	}
});

const bonus = (amount: number, date: string, reason: string, code = 'bonus'): ProbeInput => ({
	collection: 'adhoc_requests',
	values: {
		employment_id: '@e_job',
		catalogue_id: `@law:adhoc_catalogue:${code}`,
		amount,
		event_date: date,
		pay_period: date.slice(0, 7),
		reason,
		as_adjustment_entry: false
	}
});

/** Unused annual leave paid out on departure: `days` from the leave year `window`, valued on the last day. */
const encash = (days: number, window: readonly [string, string], lastDay: string): ProbeInput => ({
	collection: 'leave_entries',
	values: {
		employment_id: '@e_job',
		catalogue_id: '@law:leave_catalogue:ANNUAL_LEAVE',
		reference: 'PROBE-EXIT-ANNUAL',
		encash_days: days,
		from_date: window[0],
		to_date: window[1],
		effective_on: lastDay,
		due_on: lastDay,
		reason: 'Untaken annual leave paid on departure'
	}
});

/**
 * The attendance a final annual balance reads (EA s.88A, tracker SG-EA34: leave is lost for absence without permission or excuse
 * above 20% of the working days): every office weekday from `from` to `to`, 09:00–13:00 and 14:00–18:00.
 */
const attended = (from: string, to: string): ProbeInput[] => {
	const days: ProbeInput[] = [];
	for (
		let t = Date.parse(`${from}T00:00:00Z`);
		t <= Date.parse(`${to}T00:00:00Z`);
		t += 86_400_000
	) {
		const date = new Date(t).toISOString().slice(0, 10);
		const weekday = new Date(t).getUTCDay();
		if (weekday >= 1 && weekday <= 5)
			days.push(
				workDay(date, [
					['09:00', '13:00'],
					['14:00', '18:00']
				])
			);
	}
	return days;
};

const cents = (n: number) => Math.round(n * 100) / 100;
/** The slip's totals from hand-computed charges: `{ CPF: [employee, employer], CDAC: [1.5, 0], SDL: [0, 11.25] }`. */
function pay(gross: number, charges: Record<string, readonly [number, number]>) {
	const lines: Record<string, number> = { gross };
	let employee = 0;
	let employer = 0;
	for (const [code, [ee, er]] of Object.entries(charges)) {
		if (ee !== 0) lines[`${code}.employee`] = ee;
		if (er !== 0) lines[`${code}.employer`] = er;
		employee += ee;
		employer += er;
	}
	return {
		...lines,
		total_deductions: cents(employee),
		net: cents(gross - employee),
		employer_cost: cents(employer)
	};
}

function sg(c: {
	id: string;
	description: string;
	citation: readonly string[];
	period: string;
	inputs: readonly ProbeInput[];
	lines: ReturnType<typeof pay> | Record<string, number>;
	/** The Monday the office week starts, where the service began before `HIRED`. */
	since?: string;
	/** Company facts beyond `sdl_individual_employer: false`. */
	company?: Row;
	/** RegExp source: the run itself is refused (then `lines` is not read). */
	refused?: string;
	/** RegExp sources, one per warning line the run must save (and no other). */
	warnings?: readonly string[];
}): ProbeCase {
	return {
		id: c.id,
		profile: 'SG',
		description: c.description,
		citation: c.citation,
		company: { facts: { sdl_individual_employer: false, ...c.company } },
		inputs: [...officeWeek(c.since ?? HIRED), ...c.inputs],
		period: c.period,
		...(c.warnings === undefined ? {} : { warnings: c.warnings }),
		...(c.refused === undefined
			? { expected: [{ employment: 'e_job', lines: c.lines }] }
			: { expected: [], refused: c.refused })
	};
}

/** A Chinese citizen born 1996 (aged 30 in 2026, CPF "55 & below") on `salary` from 2 June 2025. */
const citizen = (salary: number, more: Partial<Hire> = {}) =>
	hire({ name: 'Tan Wei Ming', born: '1996-04-18', race: 'CHINESE', terms: [{ salary }], ...more });

register(
	// ── CPF Table 1, the whole month ───────────────────────────────────────────────────────────────────────────
	sg({
		id: 'SG-CPF01-1',
		description:
			'A Chinese citizen aged 30 on SGD 5,000, the whole of February 2026: CPF 55-and-below, CDAC >$3,500–5,000, SDL at its $11.25 maximum.',
		citation: [
			`${CPF_2026}: Table 1, 55 & below, TW > $750: total 37% × 5,000 = 1,850; employee 20% = 1,000; employer 850`,
			`${SHG}: CDAC $1.50`,
			`${SDL}: 5,000 > 4,500 → $11.25`
		],
		period: '2026-02',
		inputs: citizen(5000),
		lines: { BASIC: 5000, ...pay(5000, { CPF: [1000, 850], CDAC: [1.5, 0], SDL: [0, 11.25] }) }
	}),
	sg({
		id: 'SG-CPF01-2',
		description:
			'A Chinese Employment Pass holder, tax non-resident, on SGD 6,000 in February 2026: outside CPF and CDAC, inside SDL, no tax withheld.',
		citation: [
			CPF_ACT,
			`${SHG}: CDAC is for citizens and SPRs only`,
			`${SDL}: 6,000 > 4,500 → $11.25, foreign employees included`,
			'IRAS: an employer withholds no income tax from a non-resident’s monthly pay (tax clearance IR21 applies only on cessation)'
		],
		period: '2026-02',
		inputs: hire({
			name: 'Li Hua',
			born: '1990-07-01',
			race: 'CHINESE',
			nationality: 'Chinese',
			terms: [
				{ salary: 6000, residency: 'FOREIGNER', pass: 'EMPLOYMENT_PASS', tax: 'NON_RESIDENT' }
			]
		}),
		lines: pay(6000, { SDL: [0, 11.25] })
	}),
	sg({
		id: 'SG-CPF01-3',
		description:
			'An SPR since 1 June 2022 (third year onwards) on SGD 3,000 in February 2026: full Table 1 rates.',
		citation: [
			`${CPF_SPR}: third year from the month after the second anniversary (June 2024)`,
			`${CPF_2026}: Table 1 applies to SPRs from the 3rd year: 37% × 3,000 = 1,110; employee 600; employer 510`,
			`${SHG}: CDAC $1 (>2,000–3,500)`,
			`${SDL}: 0.25% × 3,000 = 7.50`
		],
		period: '2026-02',
		inputs: citizen(3000, {
			terms: [{ salary: 3000, residency: 'PERMANENT_RESIDENT', since: '2022-06-01' }]
		}),
		lines: pay(3000, { CPF: [600, 510], CDAC: [1, 0], SDL: [0, 7.5] })
	}),

	// ── the ordinary-wage ceiling ──────────────────────────────────────────────────────────────────────────────
	sg({
		id: 'SG-CPF02-1',
		description: 'SGD 10,000 in September 2026: CPF on the $8,000 OW ceiling (the table maxima).',
		citation: [
			`${CPF_2026}: 55 & below, max $2,960 total, $1,600 employee on OW; employer 1,360`,
			`${SHG}: CDAC $3 (>7,500)`,
			`${SDL}: capped at $11.25`
		],
		period: '2026-09',
		inputs: citizen(10000),
		lines: pay(10000, { CPF: [1600, 1360], CDAC: [3, 0], SDL: [0, 11.25] })
	}),
	sg({
		id: 'SG-CPF02-2',
		description: 'SGD 8,000.01 in September 2026: the cent above the OW ceiling attracts no CPF.',
		citation: [`${CPF_2026}: OW capped at $8,000 → 2,960 / 1,600 / 1,360`, `${SHG}: CDAC $3`, SDL],
		period: '2026-09',
		inputs: citizen(8000.01),
		lines: pay(8000.01, { CPF: [1600, 1360], CDAC: [3, 0], SDL: [0, 11.25] })
	}),
	sg({
		id: 'SG-CPF02-3',
		description: 'SGD 8,000 in December 2025: the 2025 OW ceiling is $7,400.',
		citation: [
			`${CPF_2025}: 55 & below, 37% × 7,400 = 2,738 (the stated max), employee 20% = 1,480, employer 1,258`,
			`${SHG}: CDAC $3`,
			SDL
		],
		period: '2025-12',
		inputs: citizen(8000),
		lines: pay(8000, { CPF: [1480, 1258], CDAC: [3, 0], SDL: [0, 11.25] })
	}),

	// ── the low-wage bands and the rounding order ─────────────────────────────────────────────────────────────
	sg({
		id: 'SG-CPF17-1',
		description: 'SGD 50 in February 2026: "$50 or less" is nil CPF; SDL is still its $2 minimum.',
		citation: [`${CPF_2026}: TW $50 or less → nil`, `${SHG}: CDAC $0.50`, `${SDL}: 0.125 < 2 → $2`],
		period: '2026-02',
		inputs: citizen(50),
		lines: pay(50, { CDAC: [0.5, 0], SDL: [0, 2] })
	}),
	sg({
		id: 'SG-CPF17-2',
		description: 'SGD 500 in February 2026: employer-only 17% of TW, no employee share.',
		citation: [
			`${CPF_2026}: > $50 to $500 → total 17% × 500 = 85, employee nil`,
			`${SHG}: CDAC $0.50`,
			`${SDL}: 1.25 → $2`
		],
		period: '2026-02',
		inputs: citizen(500),
		lines: pay(500, { CPF: [0, 85], CDAC: [0.5, 0], SDL: [0, 2] })
	}),
	sg({
		id: 'SG-CPF17-3',
		description: 'SGD 600 in February 2026: the graduated >$500–$750 band.',
		citation: [
			`${CPF_2026}: total 17% × 600 + 0.6 × (600 − 500) = 102 + 60 = 162; employee 0.6 × 100 = 60; employer 102`,
			`${SHG}: CDAC $0.50`,
			`${SDL}: 1.50 → $2`
		],
		period: '2026-02',
		inputs: citizen(600),
		lines: pay(600, { CPF: [60, 102], CDAC: [0.5, 0], SDL: [0, 2] })
	}),
	sg({
		id: 'SG-CPF17-4',
		description: 'SGD 750 in February 2026: the top of the graduated band, total rounded half up.',
		citation: [
			`${CPF_2026}: total 17% × 750 + 0.6 × 250 = 127.50 + 150 = 277.50 → 278; employee 150; employer 128`,
			`${SHG}: CDAC $0.50`,
			`${SDL}: 1.875 → $2`
		],
		period: '2026-02',
		inputs: citizen(750),
		lines: pay(750, { CPF: [150, 128], CDAC: [0.5, 0], SDL: [0, 2] })
	}),
	sg({
		id: 'SG-CPF17-5',
		description:
			'SGD 1,234.50 in February 2026: the total rounds to the dollar, the employee share rounds down, the employer takes the rest.',
		citation: [
			`${CPF_2026}: total 37% × 1,234.50 = 456.765 → 457; employee 20% × 1,234.50 = 246.90 → 246; employer 457 − 246 = 211`,
			`${SHG}: CDAC $0.50`,
			`${SDL}: 0.25% × 1,234.50 = 3.08625 → 3.09`
		],
		period: '2026-02',
		inputs: citizen(1234.5),
		lines: pay(1234.5, { CPF: [246, 211], CDAC: [0.5, 0], SDL: [0, 3.09] })
	}),
	sg({
		id: 'SG-CPF17-6',
		description: 'SGD 4,550 in February 2026: a total of exactly $0.50 over the dollar rounds up.',
		citation: [
			`${CPF_2026}: total 37% × 4,550 = 1,683.50 → 1,684 (50 cents up); employee 20% = 910; employer 774`,
			`${SHG}: CDAC $1.50`,
			`${SDL}: capped at $11.25`
		],
		period: '2026-02',
		inputs: citizen(4550),
		lines: pay(4550, { CPF: [910, 774], CDAC: [1.5, 0], SDL: [0, 11.25] })
	}),
	sg({
		id: 'SG-CPF17-7',
		description:
			'SGD 700 salary and a SGD 100 bonus in September 2026: the band reads total wages, so the month is over $750 and at full rates.',
		citation: [
			`${CPF_2026}: TW = OW 700 + AW 100 = 800 > 750 → [37% OW] + 37% AW = 296; employee 20% × 800 = 160; employer 136`,
			CPF_WAGES,
			`${SHG}: CDAC $0.50 on 800`,
			`${SDL}: 0.25% × 800 = 2.00`
		],
		period: '2026-09',
		inputs: [...citizen(700), bonus(100, '2026-09-15', 'Performance bonus')],
		lines: pay(800, { CPF: [160, 136], CDAC: [0.5, 0], SDL: [0, 2] })
	}),
	sg({
		id: 'SG-CPF17-8',
		description:
			'SGD 1,001.50 salary and a SGD 1,001.50 bonus in September 2026: the OW and AW contributions are summed unrounded, then the total is rounded once.',
		citation: [
			`${CPF_2026}: [37% × 1,001.50 OW] + 37% × 1,001.50 AW = 370.555 + 370.555 = 741.11 → 741 (rounding each part first would give 371 + 371 = 742); employee 20% × 2,003 = 400.60 → 400; employer 741 − 400 = 341`,
			CPF_WAGES,
			`${SHG}: CDAC $1 on 2,003 (> 2,000)`,
			`${SDL}: 0.25% × 2,003 = 5.0075 → 5.01`
		],
		period: '2026-09',
		inputs: [...citizen(1001.5), bonus(1001.5, '2026-09-15', 'Performance bonus')],
		lines: pay(2003, { CPF: [400, 341], CDAC: [1, 0], SDL: [0, 5.01] })
	}),

	// ── the age ladder and its dated rates ────────────────────────────────────────────────────────────────────
	...(
		[
			[
				'SG-CPF18-1',
				'1968-05-10',
				'above 55 to 60: 34% = 1,020; employee 18% = 540; employer 480',
				[540, 480]
			],
			[
				'SG-CPF18-2',
				'1963-05-10',
				'above 60 to 65: 25% = 750; employee 12.5% = 375; employer 375',
				[375, 375]
			],
			[
				'SG-CPF18-3',
				'1958-05-10',
				'above 65 to 70: 16.5% = 495; employee 7.5% = 225; employer 270',
				[225, 270]
			],
			[
				'SG-CPF18-4',
				'1953-05-10',
				'above 70: 12.5% = 375; employee 5% = 150; employer 225',
				[150, 225]
			]
		] as const
	).map(([id, born, rule, cpf]) =>
		sg({
			id,
			description: `A citizen born ${born} on SGD 3,000 in February 2026: CPF ${rule.split(':')[0]}.`,
			citation: [`${CPF_2026}: Table 1, ${rule}`, CPF_AGE, `${SHG}: CDAC $1`, `${SDL}: 7.50`],
			period: '2026-02',
			inputs: citizen(3000, { born }),
			lines: pay(3000, { CPF: cpf, CDAC: [1, 0], SDL: [0, 7.5] })
		})
	),
	sg({
		id: 'SG-CPF18-5',
		description:
			'A citizen whose 55th birthday is 15 February 2026, on SGD 3,000 in February: still 55 & below in the birthday month.',
		citation: [
			CPF_AGE,
			`${CPF_2026}: 55 & below, 1,110 total, 600 / 510`,
			`${SHG}: CDAC $1`,
			`${SDL}: 7.50`
		],
		period: '2026-02',
		inputs: citizen(3000, { born: '1971-02-15' }),
		lines: pay(3000, { CPF: [600, 510], CDAC: [1, 0], SDL: [0, 7.5] })
	}),
	sg({
		id: 'SG-CPF18-6',
		description:
			'The same citizen in March 2026, the month after the 55th birthday: above 55 to 60.',
		citation: [
			CPF_AGE,
			`${CPF_2026}: above 55–60, 34% = 1,020, employee 540, employer 480`,
			`${SHG}: CDAC $1`,
			`${SDL}: 7.50`
		],
		period: '2026-03',
		inputs: citizen(3000, { born: '1971-02-15' }),
		lines: pay(3000, { CPF: [540, 480], CDAC: [1, 0], SDL: [0, 7.5] })
	}),
	sg({
		id: 'SG-CPF18-7',
		description:
			'A citizen aged 57 on SGD 3,000 in December 2025: the 2025 above-55-to-60 rate of 32.5%.',
		citation: [
			`${CPF_2025}: above 55–60, [32.5% OW] total = 975; employee 17% = 510; employer 465`,
			`${SHG}: CDAC $1`,
			`${SDL}: 7.50`
		],
		period: '2025-12',
		inputs: citizen(3000, { born: '1968-05-10' }),
		lines: pay(3000, { CPF: [510, 465], CDAC: [1, 0], SDL: [0, 7.5] })
	}),
	sg({
		id: 'SG-CPF18-8',
		description:
			'A citizen aged 62 on SGD 3,000 in December 2025: the 2025 above-60-to-65 rate of 23.5%.',
		citation: [
			`${CPF_2025}: above 60–65, [23.5% OW] = 705; employee [11.5% OW] = 345; employer 360`,
			`${SHG}: CDAC $1`,
			`${SDL}: 7.50`
		],
		period: '2025-12',
		inputs: citizen(3000, { born: '1963-05-10' }),
		lines: pay(3000, { CPF: [345, 360], CDAC: [1, 0], SDL: [0, 7.5] })
	}),
	...(
		[
			[
				'SG-CPF18-9',
				'1966-02-15',
				60,
				'2026-02',
				'55–60 in the birthday month: 34% = 1,020, employee 540, employer 480',
				[540, 480]
			],
			[
				'SG-CPF18-10',
				'1966-02-15',
				60,
				'2026-03',
				'above 60–65 from the next month: 25% = 750, 375 / 375',
				[375, 375]
			],
			[
				'SG-CPF18-11',
				'1961-02-15',
				65,
				'2026-02',
				'60–65 in the birthday month: 25% = 750, 375 / 375',
				[375, 375]
			],
			[
				'SG-CPF18-12',
				'1961-02-15',
				65,
				'2026-03',
				'above 65–70 from the next month: 16.5% = 495, employee 7.5% = 225, employer 270',
				[225, 270]
			],
			[
				'SG-CPF18-13',
				'1956-02-15',
				70,
				'2026-02',
				'65–70 in the birthday month: 16.5% = 495, 225 / 270',
				[225, 270]
			],
			[
				'SG-CPF18-14',
				'1956-02-15',
				70,
				'2026-03',
				'above 70 from the next month: 12.5% = 375, employee 5% = 150, employer 225',
				[150, 225]
			]
		] as const
	).map(([id, born, age, period, rule, cpf]) =>
		sg({
			id,
			description: `A citizen whose ${age}th birthday is 15 February 2026, on SGD 3,000 in ${period}: Table 1 ${rule.split(':')[0]}.`,
			citation: [CPF_AGE, `${CPF_2026}: Table 1, ${rule}`, `${SHG}: CDAC $1`, `${SDL}: 7.50`],
			period,
			inputs: citizen(3000, { born }),
			lines: pay(3000, { CPF: cpf, CDAC: [1, 0], SDL: [0, 7.5] })
		})
	),
	sg({
		id: 'SG-CPF29-1',
		description:
			'A citizen aged 57 on SGD 3,000 in January 2027: the 2027 above-55-to-60 rate of 35.5%.',
		citation: [
			`${CPF_2027}: 35.5% × 3,000 = 1,065; employee 19% = 570; employer 495`,
			CPF_2026,
			`${SHG}: CDAC $1`,
			`${SDL}: 7.50`
		],
		period: '2027-01',
		inputs: citizen(3000, { born: '1969-05-10' }),
		lines: pay(3000, { CPF: [570, 495], CDAC: [1, 0], SDL: [0, 7.5] })
	}),
	sg({
		id: 'SG-CPF29-2',
		description:
			'A citizen aged 62 on SGD 3,000 in January 2027: the 2027 above-60-to-65 rate of 26%.',
		citation: [
			`${CPF_2027}: 26% × 3,000 = 780; employee 13% = 390; employer 390`,
			CPF_2026,
			`${SHG}: CDAC $1`,
			`${SDL}: 7.50`
		],
		period: '2027-01',
		inputs: citizen(3000, { born: '1964-05-10' }),
		lines: pay(3000, { CPF: [390, 390], CDAC: [1, 0], SDL: [0, 7.5] })
	}),
	...(
		[
			[
				'SG-CPF29-3',
				'1996-04-18',
				30,
				'55 & below unchanged: 37% = 1,110, employee 20% = 600, employer 510',
				[600, 510]
			],
			[
				'SG-CPF29-4',
				'1958-05-10',
				68,
				'above 65–70 unchanged: 16.5% = 495, employee 7.5% = 225, employer 270',
				[225, 270]
			],
			[
				'SG-CPF29-5',
				'1953-05-10',
				73,
				'above 70 unchanged: 12.5% = 375, employee 5% = 150, employer 225',
				[150, 225]
			]
		] as const
	).map(([id, born, age, rule, cpf]) =>
		sg({
			id,
			description: `A citizen aged ${age} on SGD 3,000 in January 2027: ${rule.split(':')[0]}.`,
			citation: [`${CPF_2027}: ${rule}`, CPF_2026, `${SHG}: CDAC $1`, `${SDL}: 7.50`],
			period: '2027-01',
			inputs: citizen(3000, { born }),
			lines: pay(3000, { CPF: cpf, CDAC: [1, 0], SDL: [0, 7.5] })
		})
	),

	// ── SPR stages ────────────────────────────────────────────────────────────────────────────────────────────
	sg({
		id: 'SG-CPF19-1',
		description:
			'An SPR since 10 November 2025 (first year, graduated/graduated) on SGD 3,000 in February 2026: Table 2.',
		citation: [
			CPF_SPR,
			`${CPF_2026}: Table 2, 55 & below, [9% OW] = 270; employee 5% = 150; employer 120`,
			`${SHG}: CDAC $1 (SPR)`,
			`${SDL}: 7.50`
		],
		period: '2026-02',
		inputs: citizen(3000, {
			from: '2025-11-10',
			terms: [{ salary: 3000, residency: 'PERMANENT_RESIDENT', since: '2025-11-10' }]
		}),
		lines: pay(3000, { CPF: [150, 120], CDAC: [1, 0], SDL: [0, 7.5] })
	}),
	sg({
		id: 'SG-CPF19-2',
		description:
			'An SPR since 10 November 2024 (second year from December 2025) on SGD 3,000 in February 2026: Table 3.',
		citation: [
			CPF_SPR,
			`${CPF_2026}: Table 3, 55 & below, [24% OW] = 720; employee 15% = 450; employer 270`,
			`${SHG}: CDAC $1`,
			`${SDL}: 7.50`
		],
		period: '2026-02',
		inputs: citizen(3000, {
			terms: [{ salary: 3000, residency: 'PERMANENT_RESIDENT', since: '2024-11-10' }]
		}),
		lines: pay(3000, { CPF: [450, 270], CDAC: [1, 0], SDL: [0, 7.5] })
	}),
	sg({
		id: 'SG-CPF19-3',
		description:
			'A first-year SPR on SGD 3,000 in February 2026 whose employer has Board approval for full employer / graduated employee rates: Table 4.',
		citation: [
			CPF_SPR,
			`${CPF_2026}: Table 4 (after CPF Board approves the joint application), 55 & below, [22% OW] = 660; employee 5% = 150; employer 510`,
			'CPF Board, contributing more CPF for a new SPR employee: full employer / graduated employee rates need a joint application approved by the Board (https://www.cpf.gov.sg/service/article/how-can-i-contribute-more-cpf-for-my-employee-who-just-obtained-his-singapore-permanent-resident-spr-status)',
			`${SHG}: CDAC $1`,
			`${SDL}: 7.50`
		],
		period: '2026-02',
		inputs: [
			...citizen(3000, {
				from: '2025-11-10',
				terms: [{ salary: 3000, residency: 'PERMANENT_RESIDENT', since: '2025-11-10' }]
			}),
			registration('CPF', '2025-11-10', {
				reference_number: 'PROBE-CPF',
				elections: {
					spr_full_rate: false,
					spr_full_employer_rate: true,
					spr_approval_reference: 'CPF-JOINT-APPROVAL-1'
				}
			})
		],
		lines: pay(3000, { CPF: [150, 510], CDAC: [1, 0], SDL: [0, 7.5] })
	}),
	sg({
		id: 'SG-CPF19-4',
		description:
			'A second-year SPR (since 10 November 2024) on SGD 3,000 in February 2026 whose employer has Board approval for full employer / graduated employee rates: Table 5.',
		citation: [
			CPF_SPR,
			`${CPF_2026}: Table 5, 55 & below, [32% OW] = 960; employee [15% OW] = 450; employer 510`,
			'CPF Board, contributing more CPF for a new SPR employee: full employer / graduated employee rates need a joint application approved by the Board (https://www.cpf.gov.sg/service/article/how-can-i-contribute-more-cpf-for-my-employee-who-just-obtained-his-singapore-permanent-resident-spr-status)',
			`${SHG}: CDAC $1`,
			`${SDL}: 7.50`
		],
		period: '2026-02',
		inputs: [
			...citizen(3000, {
				terms: [{ salary: 3000, residency: 'PERMANENT_RESIDENT', since: '2024-11-10' }]
			}),
			registration('CPF', HIRED, {
				reference_number: 'PROBE-CPF',
				elections: {
					spr_full_rate: false,
					spr_full_employer_rate: true,
					spr_approval_reference: 'CPF-JOINT-APPROVAL-2'
				}
			})
		],
		lines: pay(3000, { CPF: [450, 510], CDAC: [1, 0], SDL: [0, 7.5] })
	}),
	sg({
		id: 'SG-CPF19-5',
		description:
			'A first-year SPR (since 10 November 2025) on SGD 3,000 in February 2026 whose employer has Board approval for full employer / full employee rates: Table 1.',
		citation: [
			CPF_SPR,
			`${CPF_2026}: Table 1 (full/full after CPF Board approves the joint application), 55 & below, 37% = 1,110; employee 20% = 600; employer 510`,
			'CPF Board, contributing more CPF for a new SPR employee: full employer and employee rates need a joint application approved by the Board (https://www.cpf.gov.sg/service/article/how-can-i-contribute-more-cpf-for-my-employee-who-just-obtained-his-singapore-permanent-resident-spr-status)',
			`${SHG}: CDAC $1`,
			`${SDL}: 7.50`
		],
		period: '2026-02',
		inputs: [
			...citizen(3000, {
				from: '2025-11-10',
				terms: [{ salary: 3000, residency: 'PERMANENT_RESIDENT', since: '2025-11-10' }]
			}),
			registration('CPF', '2025-11-10', {
				reference_number: 'PROBE-CPF',
				elections: {
					spr_full_rate: true,
					spr_full_employer_rate: false,
					spr_approval_reference: 'CPF-JOINT-APPROVAL-3'
				}
			})
		],
		lines: pay(3000, { CPF: [600, 510], CDAC: [1, 0], SDL: [0, 7.5] })
	}),
	sg({
		id: 'SG-CPF34-1',
		description:
			'A Chinese Employment Pass holder on SGD 4,400 who becomes an SPR on Wednesday 16 September 2026: CPF only on the SPR days’ pro-rated OW, at first-year rates.',
		citation: [
			`${CPF_SPR}: pro-rated OW from the SPR day`,
			`${EA_20A}: 16–30 September holds 11 of the month’s 22 working days: 4,400 × 11 ÷ 22 = 2,200 (tracker SG-CPF34 owner rule: the s.20A working-day split, the band on the month’s CPF wages)`,
			`${CPF_2026}: Table 2, TW 2,200 > 750: 9% = 198; employee 5% = 110; employer 88`,
			`${SHG}: CDAC on the month’s total wages 4,400 → $1.50 (tracker SG-CPF34: the funds read the month whole)`,
			`${SDL}: 0.25% × 4,400 = 11.00`
		],
		period: '2026-09',
		inputs: hire({
			name: 'Chen Jie',
			born: '1991-03-03',
			race: 'CHINESE',
			nationality: 'Chinese',
			terms: [
				{ salary: 4400, residency: 'FOREIGNER', pass: 'EMPLOYMENT_PASS', to: '2026-09-15' },
				{ salary: 4400, residency: 'PERMANENT_RESIDENT', since: '2026-09-16', from: '2026-09-16' }
			]
		}),
		lines: pay(4400, { CPF: [110, 88], CDAC: [1.5, 0], SDL: [0, 11] })
	}),
	sg({
		id: 'SG-CPF34-2',
		description:
			'A second-year SPR (since 10 November 2024) on SGD 4,400 who becomes a citizen on Wednesday 16 September 2026: Table 3 before, Table 1 from the citizenship day.',
		citation: [
			'CPF Board, SPR who becomes a citizen mid-month: SPR rates before the day of citizenship, citizen rates from it (https://www.cpf.gov.sg/service/article/my-singapore-permanent-resident-employee-obtained-his-singapore-citizenship-in-the-middle-of-the-month-when-will-the-contribution-rates-for-a-singapore-citizen-apply)',
			`${EA_20A}: 1–15 September and 16–30 September are 11 working days each: 2,200 + 2,200 (tracker SG-CPF34 owner rule)`,
			`${CPF_2026}: Table 3 on 2,200: 24% = 528, employee 15% = 330; Table 1 on 2,200: 37% = 814, employee 20% = 440; summed then rounded (step 4): total 1,342, employee 770, employer 572`,
			`${SHG}: CDAC $1.50 on 4,400`,
			`${SDL}: 11.00`
		],
		period: '2026-09',
		inputs: citizen(4400, {
			terms: [
				{ salary: 4400, residency: 'PERMANENT_RESIDENT', since: '2024-11-10', to: '2026-09-15' },
				{ salary: 4400, residency: 'CITIZEN', since: '2026-09-16', from: '2026-09-16' }
			]
		}),
		lines: pay(4400, { CPF: [770, 572], CDAC: [1.5, 0], SDL: [0, 11] })
	}),
	sg({
		id: 'SG-CPF34-3',
		description:
			'A third-year SPR (since 1 January 2020) on SGD 1,200 who becomes a citizen on Sunday 15 March 2026: the wage band is read on the month’s total wages, not on each portion.',
		citation: [
			'CPF Board, SPR who becomes a citizen mid-month: SPR rates before the day of citizenship, citizen rates from it (https://www.cpf.gov.sg/service/article/my-singapore-permanent-resident-employee-obtained-his-singapore-citizenship-in-the-middle-of-the-month-when-will-the-contribution-rates-for-a-singapore-citizen-apply)',
			`${EA_20A}: 2–13 March 10 and 16–31 March 12 of 22 working days (tracker SG-CPF34 owner rule: one band on the month’s CPF wages)`,
			`${CPF_2026}: Table 1 on both portions, TW 1,200 > 750: 37% × 1,200 = 444; employee 240; employer 204 (a band per portion, 545.45 and 654.55 in the >$500–750 band, would give 324 in all)`,
			`${SHG}: CDAC $0.50 on 1,200`,
			`${SDL}: 0.25% × 1,200 = 3.00`
		],
		period: '2026-03',
		inputs: citizen(1200, {
			terms: [
				{ salary: 1200, residency: 'PERMANENT_RESIDENT', since: '2020-01-01', to: '2026-03-14' },
				{ salary: 1200, residency: 'CITIZEN', since: '2026-03-15', from: '2026-03-15' }
			]
		}),
		lines: pay(1200, { CPF: [240, 204], CDAC: [0.5, 0], SDL: [0, 3] })
	}),
	sg({
		id: 'SG-CPF34-4',
		description:
			'A third-year SPR (since 1 January 2020) on SGD 20,000 who becomes a citizen on Wednesday 16 September 2026: one $8,000 OW ceiling for the month.',
		citation: [
			`${CPF_2026}: OW capped at $8,000 for the month (tracker SG-CPF34 owner rule: one monthly ceiling), Table 1 on both portions: 37% × 8,000 = 2,960; employee 1,600; employer 1,360 (a ceiling per portion would charge 10,000 + 10,000 capped at 8,000 each)`,
			`${EA_20A}: 11 + 11 of 22 working days`,
			`${SHG}: CDAC $3 on 20,000`,
			`${SDL}: capped at $11.25`
		],
		period: '2026-09',
		inputs: citizen(20000, {
			terms: [
				{ salary: 20000, residency: 'PERMANENT_RESIDENT', since: '2020-01-01', to: '2026-09-15' },
				{ salary: 20000, residency: 'CITIZEN', since: '2026-09-16', from: '2026-09-16' }
			]
		}),
		lines: pay(20000, { CPF: [1600, 1360], CDAC: [3, 0], SDL: [0, 11.25] })
	}),
	sg({
		id: 'SG-CPF34-5',
		description:
			'The SG-CPF34-1 Employment Pass holder (SPR from Wednesday 16 September 2026, SGD 4,400) is also paid a SGD 1,000 bonus on 25 September: AW paid on or after the SPR day attracts first-year CPF.',
		citation: [
			`${CPF_SPR}: pro-rated OW from the SPR day; AW paid on or after it`,
			`${EA_20A}: OW 4,400 × 11 ÷ 22 = 2,200`,
			`${CPF_2026}: Table 2, TW 2,200 + 1,000 = 3,200 > 750: [9% OW] + 9% AW = 288; employee 5% = 160; employer 128`,
			CPF_WAGES,
			`${SHG}: CDAC on the month’s total wages 5,400 → $2 (tracker SG-CPF34 owner rule: the funds read the month whole)`,
			`${SDL}: 5,400 > 4,500 → $11.25`
		],
		period: '2026-09',
		inputs: [
			...hire({
				name: 'Chen Jie',
				born: '1991-03-03',
				race: 'CHINESE',
				nationality: 'Chinese',
				terms: [
					{ salary: 4400, residency: 'FOREIGNER', pass: 'EMPLOYMENT_PASS', to: '2026-09-15' },
					{ salary: 4400, residency: 'PERMANENT_RESIDENT', since: '2026-09-16', from: '2026-09-16' }
				]
			}),
			bonus(1000, '2026-09-25', 'Performance bonus')
		],
		lines: pay(5400, { CPF: [160, 128], CDAC: [2, 0], SDL: [0, 11.25] })
	}),

	// ── Additional Wages and the AW ceiling ───────────────────────────────────────────────────────────────────
	sg({
		id: 'SG-CPF21-1',
		description:
			'SGD 5,000 salary and a SGD 10,000 bonus in September 2026: the bonus is AW, far inside the AW ceiling.',
		citation: [
			CPF_WAGES,
			`${CPF_AW}: the year’s OW is at most 12 × 5,000 = 60,000, so the ceiling is at least 42,000`,
			`${CPF_2026}: 37% × (5,000 + 10,000) = 5,550; employee 20% × 15,000 = 3,000; employer 2,550`,
			`${SHG}: CDAC $3 on 15,000`,
			`${SDL}: capped at $11.25`
		],
		period: '2026-09',
		inputs: [...citizen(5000), bonus(10000, '2026-09-15', 'Performance bonus')],
		lines: pay(15000, { CPF: [3000, 2550], CDAC: [3, 0], SDL: [0, 11.25] })
	}),
	sg({
		id: 'SG-CPF21-2',
		description:
			'A 13th-month payment of SGD 20,000 in December 2026 on SGD 8,000 a month, January–November already contributed by this employer: only $6,000 of AW is inside the ceiling.',
		citation: [
			`${CPF_AW}: 102,000 − (11 × 8,000 recorded + 8,000 December) = 6,000`,
			`${CPF_2026}: OW 8,000 × 37% = 2,960 + AW 6,000 × 37% = 2,220 → 5,180; employee 1,600 + 1,200 = 2,800; employer 2,380`,
			'Employment Act 1968 s.48: an annual wage supplement is payable as agreed (https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr48-)',
			`${SHG}: CDAC $3 on 28,000`,
			`${SDL}: capped at $11.25`
		],
		period: '2026-12',
		inputs: [
			...citizen(8000),
			registration('CPF', HIRED, {
				reference_number: 'PROBE-CPF',
				opening: [
					{
						year: '2026',
						base: 88000,
						ordinary: 88000,
						employee: 17600,
						employer: 14960,
						origin: 'CURRENT_EMPLOYER',
						reference: 'This employer’s CPF submissions, January–November 2026'
					}
				]
			}),
			bonus(20000, '2026-12-15', '13th-month payment')
		],
		lines: pay(28000, { CPF: [2800, 2380], CDAC: [3, 0], SDL: [0, 11.25] })
	}),
	sg({
		id: 'SG-CPF22-1',
		description:
			'A citizen who joined on 1 December 2026 on SGD 8,000 with SGD 88,000 of OW at another employer earlier in the year, paid a SGD 20,000 bonus: the ceiling is this employer’s own, so the whole bonus is AW.',
		citation: [
			`${CPF_AW}: per employer — 102,000 − 8,000 = 94,000 > 20,000`,
			'CPF Board, AW ceiling for concurrent or transferred employment: each employer applies its own ceiling unless the Board approves a single ceiling for related companies (https://www.cpf.gov.sg/service/article/how-do-i-apply-the-additional-wage-ceiling-for-the-following-scenarios-a-employee-a-is-working-for-two-companies-concurrently-b-employee-b-is-transferred-from-another-entity)',
			`${CPF_2026}: 37% × 28,000 = 10,360; employee 20% = 5,600; employer 4,760`,
			`${SHG}: CDAC $3`,
			`${SDL}: capped at $11.25`
		],
		period: '2026-12',
		inputs: [
			...citizen(8000, { from: '2026-12-01' }),
			registration('CPF', '2026-12-01', {
				reference_number: 'PROBE-CPF',
				opening: [
					{
						year: '2026',
						base: 88000,
						ordinary: 88000,
						employee: 17600,
						employer: 14960,
						origin: 'OTHER_EMPLOYER',
						reference: 'Former employer’s IR8A, January–November 2026'
					}
				]
			}),
			bonus(20000, '2026-12-15', 'Year-end bonus')
		],
		lines: pay(28000, { CPF: [5600, 4760], CDAC: [3, 0], SDL: [0, 11.25] })
	}),
	sg({
		id: 'SG-CPF22-2',
		description:
			'The SG-CPF22-1 joiner, but transferred from a related company with CPF Board approval for a single AW ceiling: the related company’s SGD 88,000 of OW counts, so only $6,000 of the bonus is inside the ceiling.',
		citation: [
			'CPF Board, single AW ceiling for a transfer between related companies: on the Board’s approval (related companies, employee informed, terms unchanged) the ceiling is applied across both (https://www.cpf.gov.sg/service/article/as-an-employer-how-do-i-apply-to-the-board-for-a-single-additional-wage-aw-ceiling-if-my-employees-were-transferred-to-another-related-company-during-the-year)',
			`${CPF_AW}: 102,000 − (88,000 + 8,000) = 6,000`,
			`${CPF_2026}: 37% × (8,000 + 6,000) = 5,180; employee 20% = 2,800; employer 2,380`,
			`${SHG}: CDAC $3 on 28,000`,
			`${SDL}: capped at $11.25`
		],
		period: '2026-12',
		inputs: [
			...citizen(8000, { from: '2026-12-01' }),
			registration('CPF', '2026-12-01', {
				reference_number: 'PROBE-CPF',
				opening: [
					{
						year: '2026',
						base: 88000,
						ordinary: 88000,
						employee: 17600,
						employer: 14960,
						origin: 'APPROVED_RELATED_EMPLOYER',
						board_approval_reference: 'CPF-BOARD-APPROVAL-1',
						employers_related: true,
						employee_informed: true,
						terms_unchanged: true,
						transferred_employee: true,
						reference: 'Related company’s CPF submissions, January–November 2026'
					}
				]
			}),
			bonus(20000, '2026-12-15', 'Year-end bonus')
		],
		lines: pay(28000, { CPF: [2800, 2380], CDAC: [3, 0], SDL: [0, 11.25] })
	}),

	// ── the self-help funds ───────────────────────────────────────────────────────────────────────────────────
	sg({
		id: 'SG-SHG01-1',
		description:
			'A Muslim Indian citizen on SGD 3,000 in February 2026: MBMF by religion and SINDA by race.',
		citation: [
			`${SHG}: MBMF $6.50 (>2,000–3,000), SINDA $7 (>2,500–4,500)`,
			'CPF Board SHG01 guidance: a Muslim Indian employee contributes to both MBMF and SINDA (https://www.cpf.gov.sg/service/article/how-do-i-determine-which-self-help-group-shg-my-employee-should-contribute-to)',
			`${CPF_2026}: 600 / 510`,
			`${SDL}: 7.50`
		],
		period: '2026-02',
		inputs: hire({
			name: 'Mohamed Rafiq',
			born: '1996-04-18',
			race: 'INDIAN',
			religion: 'ISLAM',
			terms: [{ salary: 3000 }]
		}),
		lines: pay(3000, { CPF: [600, 510], MBMF: [6.5, 0], SINDA: [7, 0], SDL: [0, 7.5] })
	}),
	sg({
		id: 'SG-SHG01-2',
		description:
			'An Indian-Chinese citizen (first NRIC race Indian) on SGD 3,000 in February 2026 who elects CDAC as well: SINDA plus CDAC.',
		citation: [
			'CPF Board: "the first race listed determines the applicable SHG"; an Indian-Chinese employee may also choose to contribute to both SINDA and CDAC (https://www.cpf.gov.sg/service/article/how-do-i-determine-which-self-help-group-shg-my-employee-should-contribute-to)',
			`${SHG}: SINDA $7, CDAC $1`,
			`${CPF_2026}: 600 / 510`,
			`${SDL}: 7.50`
		],
		period: '2026-02',
		inputs: [
			...hire({ name: 'Arjun Tan', born: '1996-04-18', race: 'INDIAN', terms: [{ salary: 3000 }] }),
			registration('CDAC', HIRED, {
				reference_number: 'PROBE-CDAC',
				elections: {
					shg_dual_cdac: true,
					shg_secondary_race: 'CHINESE',
					shg_instruction_reference: 'CDAC-INSTRUCTION-1'
				}
			})
		],
		lines: pay(3000, { CPF: [600, 510], SINDA: [7, 0], CDAC: [1, 0], SDL: [0, 7.5] })
	}),
	sg({
		id: 'SG-SHG04-1',
		description:
			'A Chinese-Tamil citizen (first NRIC race Chinese) on SGD 3,000 in February 2026 who elects SINDA as well: CDAC plus SINDA.',
		citation: [
			'CPF Board: "the first race listed determines the applicable SHG"; a mixed-race employee may also choose to contribute to the second fund (https://www.cpf.gov.sg/service/article/how-do-i-determine-which-self-help-group-shg-my-employee-should-contribute-to); SINDA Rules r.2 (Tamils are of the Indian community) and r.3(1) (deduct from each employee who desires to contribute) (https://sso.agc.gov.sg/SL/CPFA1953-R5); tracker SG-SHG04(c) owner rule',
			`${SHG}: CDAC $1, SINDA $7`,
			`${CPF_2026}: 600 / 510`,
			`${SDL}: 7.50`
		],
		period: '2026-02',
		inputs: [
			...hire({
				name: 'Lim Kumar',
				born: '1996-04-18',
				race: 'CHINESE',
				terms: [{ salary: 3000 }]
			}),
			registration('SINDA', HIRED, {
				reference_number: 'PROBE-SINDA',
				elections: {
					shg_dual_sinda: true,
					shg_secondary_race: 'TAMIL',
					shg_instruction_reference: 'SINDA-INSTRUCTION-1'
				}
			})
		],
		lines: pay(3000, { CPF: [600, 510], CDAC: [1, 0], SINDA: [7, 0], SDL: [0, 7.5] })
	}),
	sg({
		id: 'SG-SHG02-1',
		description:
			'A Malay Muslim S Pass holder on SGD 3,500 in February 2026: no CPF, but MBMF reaches foreign Muslim employees.',
		citation: [
			CPF_ACT,
			`${SHG}: MBMF $15 (>3,000–4,000), foreign employees included`,
			'MUIS, MBMF employer information (https://www.muis.gov.sg/give-back/mbmf/employer-information/)',
			`${SDL}: 0.25% × 3,500 = 8.75`
		],
		period: '2026-02',
		inputs: hire({
			name: 'Ahmad Faizal',
			born: '1994-09-09',
			race: 'MALAY',
			religion: 'ISLAM',
			nationality: 'Malaysian',
			terms: [{ salary: 3500, residency: 'FOREIGNER', pass: 'S_PASS' }]
		}),
		lines: pay(3500, { MBMF: [15, 0], SDL: [0, 8.75] })
	}),
	...(
		[
			['SG-SHG03-1', 'EURASIAN', 'OTHER', 4000, 'ECF', 9, [800, 680], 10],
			['SG-SHG03-2', 'EURASIAN', 'OTHER', 4000.01, 'ECF', 12, [800, 680], 10],
			['SG-SHG03-3', 'INDIAN', 'OTHER', 1000, 'SINDA', 1, [200, 170], 2.5],
			['SG-SHG03-4', 'CHINESE', 'OTHER', 2000, 'CDAC', 0.5, [400, 340], 5],
			['SG-SHG03-5', 'CHINESE', 'OTHER', 2000.01, 'CDAC', 1, [400, 340], 5],
			['SG-SHG03-6', 'MALAY', 'ISLAM', 3000, 'MBMF', 6.5, [600, 510], 7.5],
			['SG-SHG03-7', 'MALAY', 'ISLAM', 12000, 'MBMF', 26, [1600, 1360], 11.25],
			['SG-SHG03-8', 'INDIAN', 'OTHER', 16000, 'SINDA', 30, [1600, 1360], 11.25]
		] as const
	).map(([id, race, religion, salary, fund, amount, cpf, sdl]) =>
		sg({
			id,
			description: `A ${race.toLowerCase()} citizen${religion === 'ISLAM' ? ', Muslim,' : ''} on SGD ${salary} in February 2026: ${fund} $${amount}.`,
			citation: [
				`${SHG}: ${fund} on ${salary} → $${amount}`,
				`${CPF_2026}: 37% × min(${salary}, 8,000) rounded to the dollar, employee 20% rounded down → ${cpf[0]} / ${cpf[1]}`,
				`${SDL}: ${sdl}`
			],
			period: '2026-02',
			inputs: hire({
				name: `${fund} probe`,
				born: '1996-04-18',
				race,
				religion,
				terms: [{ salary }]
			}),
			lines: pay(salary, { CPF: cpf, [fund]: [amount, 0], SDL: [0, sdl] })
		})
	),

	// ── SDL seams ─────────────────────────────────────────────────────────────────────────────────────────────
	sg({
		id: 'SG-SDL02-1',
		description: 'SGD 799.99 in February 2026: under $800, the SDL minimum of $2.',
		citation: [
			`${SDL}: 0.25% × 799.99 = 1.999975 < 2 → $2`,
			`${CPF_2026}: 37% × 799.99 = 295.9963 → 296; employee 159.998 → 159; employer 137`,
			`${SHG}: CDAC $0.50`
		],
		period: '2026-02',
		inputs: citizen(799.99),
		lines: pay(799.99, { CPF: [159, 137], CDAC: [0.5, 0], SDL: [0, 2] })
	}),
	sg({
		id: 'SG-SDL-1',
		description: 'SGD 4,500 in February 2026: the SDL wage cap exactly, $11.25.',
		citation: [
			`${SDL}: 0.25% × 4,500 = 11.25`,
			`${CPF_2026}: 37% × 4,500 = 1,665; employee 900; employer 765`,
			`${SHG}: CDAC $1.50`
		],
		period: '2026-02',
		inputs: citizen(4500),
		lines: pay(4500, { CPF: [900, 765], CDAC: [1.5, 0], SDL: [0, 11.25] })
	}),
	sg({
		id: 'SG-SDL13-1',
		description:
			'SGD 1,002 in February 2026: an SDL of exactly half a cent over, 2.505, rounds half up to 2.51 (half-even would give 2.50).',
		citation: [
			`${SDL}: 0.25% × 1,002 = 2.505 → 2.51 (tracker SG-SDL13 owner rule: half up)`,
			`${CPF_2026}: 37% × 1,002 = 370.74 → 371; employee 200.40 → 200; employer 171`,
			`${SHG}: CDAC $0.50`
		],
		period: '2026-02',
		inputs: citizen(1002),
		lines: pay(1002, { CPF: [200, 171], CDAC: [0.5, 0], SDL: [0, 2.51] })
	}),
	...(
		[
			[
				'SG-SDL01-1',
				'leave attributable to earlier Singapore service',
				{ sdl_service_scope: 'SINGAPORE_LEAVE' },
				false,
				5
			],
			[
				'SG-SDL01-2',
				'service wholly outside Singapore',
				{ sdl_service_scope: 'OUTSIDE_SINGAPORE' },
				false,
				0
			],
			[
				'SG-SDL01-3',
				'a domestic servant wholly and exclusively employed by an individual, not in the individual’s business',
				{
					sdl_household_role: 'DOMESTIC_SERVANT',
					sdl_wholly_exclusive: true,
					sdl_nonbusiness: true
				},
				true,
				0
			],
			[
				'SG-SDL01-4',
				'a domestic servant employed by a company',
				{
					sdl_household_role: 'DOMESTIC_SERVANT',
					sdl_wholly_exclusive: true,
					sdl_nonbusiness: true
				},
				false,
				5
			]
		] as const
	).map(([id, scope, sdl, individual, levy]) =>
		sg({
			id,
			description: `A Chinese S Pass holder on SGD 2,000 in February 2026, ${scope}: SDL ${levy === 0 ? 'nil' : '$5.00'}.`,
			citation: [
				'SDL Act 1979 s.2 "employee": a person employed under a contract of service who performs services wholly or partly in Singapore or is on leave attributable to such services, excluding a domestic servant, gardener or chauffeur wholly and exclusively employed by an individual otherwise than in the individual’s trade or business (https://sso.agc.gov.sg/Act/SDLA1979#pr2-)',
				`${SDL}: 0.25% × 2,000 = 5.00 where the worker is an employee`,
				CPF_ACT,
				`${SHG}: CDAC is for citizens and SPRs only`
			],
			company: { sdl_individual_employer: individual },
			period: '2026-02',
			inputs: hire({
				name: 'Wang Fang',
				born: '1990-07-01',
				race: 'CHINESE',
				nationality: 'Chinese',
				terms: [{ salary: 2000, residency: 'FOREIGNER', pass: 'S_PASS' }],
				sdl
			}),
			lines: pay(2000, levy === 0 ? {} : { SDL: [0, levy] })
		})
	),

	// ── incomplete months ─────────────────────────────────────────────────────────────────────────────────────
	sg({
		id: 'SG-EA10-1',
		description:
			'A citizen on SGD 4,400 who joins on Wednesday 16 September 2026: 11 of 22 working days.',
		citation: [
			`${EA_20A}: 4,400 × 11 ÷ 22 = 2,200`,
			`${CPF_2026}: 37% × 2,200 = 814; employee 440; employer 374`,
			`${SHG}: CDAC $1`,
			`${SDL}: 5.50`
		],
		period: '2026-09',
		inputs: citizen(4400, { from: '2026-09-16' }),
		lines: pay(2200, { CPF: [440, 374], CDAC: [1, 0], SDL: [0, 5.5] })
	}),
	sg({
		id: 'SG-EA10-2',
		description:
			'A pay rise from SGD 3,000 to SGD 4,400 on Wednesday 16 September 2026: each salary on its own working days.',
		citation: [
			`${EA_20A}, applied to each rate for its days (the Act has no separate mid-month rule): 3,000 × 11 ÷ 22 + 4,400 × 11 ÷ 22 = 1,500 + 2,200 = 3,700`,
			`${CPF_2026}: 37% × 3,700 = 1,369; employee 740; employer 629`,
			`${SHG}: CDAC $1.50`,
			`${SDL}: 9.25`
		],
		period: '2026-09',
		inputs: citizen(3000, {
			terms: [
				{ salary: 3000, to: '2026-09-15' },
				{ salary: 4400, from: '2026-09-16' }
			]
		}),
		lines: pay(3700, { CPF: [740, 629], CDAC: [1.5, 0], SDL: [0, 9.25] })
	}),
	sg({
		id: 'SG-EA14-1',
		description:
			'Two days of no-pay leave at the employee’s request (Tuesday–Wednesday 8–9 September 2026) on SGD 4,400.',
		citation: [
			`${EA_20A} (c): 4,400 × 20 ÷ 22 = 4,000`,
			`${CPF_2026}: 37% × 4,000 = 1,480; employee 800; employer 680`,
			`${SHG}: CDAC $1.50`,
			`${SDL}: 10.00`
		],
		period: '2026-09',
		inputs: [
			...citizen(4400),
			{
				collection: 'leave_entries',
				values: {
					employment_id: '@e_job',
					catalogue_id: '@law:leave_catalogue:UNPAID_LEAVE',
					reference: 'PROBE-NPL',
					from_date: '2026-09-08',
					to_date: '2026-09-09',
					half_day_start: false,
					half_day_end: false,
					no_pay_origin: 'EMPLOYEE_REQUESTED',
					reason: 'Personal matters'
				}
			}
		],
		lines: pay(4000, { CPF: [800, 680], CDAC: [1.5, 0], SDL: [0, 10] })
	}),

	// ── departures ────────────────────────────────────────────────────────────────────────────────────────────
	sg({
		id: 'SG-EA11-1',
		description:
			'A citizen on SGD 4,400 hired Monday 5 January 2026 and dismissed with notice (not for misconduct), last day Friday 11 September 2026: the s.20A final month and 5 untaken annual-leave days at the gross rate, paid as an Additional Wage.',
		citation: [
			`${EA_20A} (b): 1–11 September holds 9 of 22 working days: 4,400 × 9 ÷ 22 = 1,800`,
			`${EA_88A}: 8 completed months (5 January–4 September) → 7 × 8 ÷ 12 = 4.67 → 5 days; 12 × 4,400 ÷ 260 = 203.0769 a day × 5 = 1,015.38`,
			`${CPF_ACT}: leave pay on termination is not for the month’s employment, so it is AW (tracker SG-CPF04)`,
			`${CPF_2026}: 37% × (1,800 + 1,015.38) = 1,041.69 → 1,042; employee 20% × 2,815.38 = 563.08 → 563; employer 479`,
			`${SHG}: CDAC $1 on 2,815.38`,
			`${SDL}: 0.25% × 2,815.38 = 7.04`,
			'Employment Act 1968 s.22: salary due on dismissal is paid on the day of dismissal (https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr22-)'
		],
		period: '2026-09',
		inputs: [
			...citizen(4400, {
				from: '2026-01-05',
				to: '2026-09-11',
				exit: {
					exit_ground: 'DISMISSAL',
					exit_facts: { misconduct_dismissal: false, final_pay_not_possible: false }
				}
			}),
			...attended('2026-01-05', '2026-09-11'),
			encash(5, ['2026-01-05', '2027-01-04'], '2026-09-11')
		],
		lines: pay(2815.38, { CPF: [563, 479], CDAC: [1, 0], SDL: [0, 7.04] })
	}),
	sg({
		id: 'SG-EA24-R02-1',
		since: '2023-02-27',
		description:
			'A citizen on SGD 9,000 with service since 1 March 2023, retrenched with last day Friday 18 September 2026: s.20A final month, 5 untaken annual-leave days (AW), and a contractual retrenchment benefit of SGD 18,000 that is outside CPF and the funds.',
		citation: [
			'Employment Act 1968 s.45: no statutory retrenchment quantum — the SGD 18,000 is the contract’s (https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr45-)',
			`${EA_20A} (b): 1–18 September holds 14 of 22 working days: 9,000 × 14 ÷ 22 = 5,727.27`,
			`${EA_88A}: s.88A(8) applies (dismissal on redundancy is not misconduct); 12 × 9,000 ÷ 260 = 415.3846 × 5 = 2,076.92`,
			'Employment Act 1968 s.88A(5): forfeiture turns on absence without permission or reasonable excuse above 20% of the accrual year’s working days; the Act is silent on evidence predating the system, so attendance through 28 February 2026 (the prior service year, 1 March 2025–28 February 2026) is the opening declaration — 0 unexcused days, so no forfeiture (tracker SG-EA34 owner rule) (https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr88A-)',
			`${CPF_WAGES}: the retrenchment benefit is not wages`,
			`${CPF_2026}: OW 5,727.27 + AW 2,076.92 = 7,804.19; 37% = 2,887.55 → 2,888; employee 20% = 1,560.84 → 1,560; employer 1,328`,
			`${SHG}: CDAC on total wages 7,804.19 (> 7,500) → $3; the benefit is not wages`,
			`${SDL}: wages above 4,500 whether or not the benefit counts → $11.25`
		],
		period: '2026-09',
		inputs: [
			...citizen(9000, {
				from: '2023-03-01',
				to: '2026-09-18',
				terms: [{ salary: 9000, opening: { through: '2026-02-28', absent: 0 } }],
				exit: { exit_ground: 'RETRENCHMENT', exit_facts: { final_pay_not_possible: false } }
			}),
			...attended('2026-03-01', '2026-09-18'),
			encash(5, ['2026-03-01', '2027-02-28'], '2026-09-18'),
			bonus(18000, '2026-09-18', 'Contractual retrenchment benefit', 'RETRENCHMENT_BENEFIT')
		],
		lines: pay(25804.19, { CPF: [1560, 1328], CDAC: [3, 0], SDL: [0, 11.25] })
	}),

	// ── Part 4: overtime, rest days and holidays (non-workman on 2,288: 12.00 an hour, 105.60 a day) ────────────
	sg({
		id: 'SG-EA22-1',
		description:
			'A non-workman on SGD 2,288 works 09:00–20:00 with the hour’s break on Monday 7 September 2026, two hours of overtime planned.',
		citation: [
			`${EA_PART4}: 12 × 2,288 ÷ 2,288 = 12.00 an hour; 2 h beyond the agreed 8-hour day × 12.00 × 1.5 = 36.00`,
			`${CPF_WAGES}: overtime is wages (OW)`,
			`${CPF_2026}: 37% × 2,324 = 859.88 → 860; employee 464.80 → 464; employer 396`,
			`${SHG}: CDAC $1`,
			`${SDL}: 5.81`
		],
		period: '2026-09',
		inputs: [
			...citizen(2288),
			workDay(
				'2026-09-07',
				[
					['09:00', '13:00'],
					['14:00', '20:00']
				],
				{ approved_overtime_hours: 2 }
			)
		],
		lines: pay(2324, { CPF: [464, 396], CDAC: [1, 0], SDL: [0, 5.81] })
	}),
	sg({
		id: 'SG-EA46-1',
		description:
			'A workman (manual labour) on SGD 2,860 works two planned overtime hours on Monday 7 September 2026.',
		citation: [
			`${EA_PART4}: First Schedule workman; 12 × 2,860 ÷ 2,288 = 15.00 an hour; 2 × 15.00 × 1.5 = 45.00`,
			`${CPF_2026}: 37% × 2,905 = 1,074.85 → 1,075; employee 581; employer 494`,
			`${SHG}: CDAC $1`,
			`${SDL}: 0.25% × 2,905 = 7.2625 → 7.26`
		],
		period: '2026-09',
		inputs: [
			...citizen(2860, { terms: [{ salary: 2860, category: 'MANUAL_LABOUR' }] }),
			workDay(
				'2026-09-07',
				[
					['09:00', '13:00'],
					['14:00', '20:00']
				],
				{ approved_overtime_hours: 2 }
			)
		],
		lines: pay(2905, { CPF: [581, 494], CDAC: [1, 0], SDL: [0, 7.26] })
	}),
	sg({
		id: 'SG-EA21-1',
		description:
			'The SGD 2,288 non-workman works eight hours on rest day Sunday 13 September 2026 at the employer’s request.',
		citation: [
			'Employment Act 1968 s.37(3)(b): more than half but not more than the normal hours at the employer’s request → 2 days at the basic rate (https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr37-)',
			`${EA_PART4}: 12 × 2,288 ÷ 260 = 105.60 a day → 211.20`,
			`${CPF_2026}: 37% × 2,499.20 = 924.70 → 925; employee 499.84 → 499; employer 426`,
			`${SHG}: CDAC $1`,
			`${SDL}: 6.248 → 6.25`
		],
		period: '2026-09',
		inputs: [
			...citizen(2288),
			workDay(
				'2026-09-13',
				[
					['09:00', '13:00'],
					['14:00', '18:00']
				],
				{
					approved_overtime_hours: 8,
					requested_by: 'EMPLOYER'
				}
			)
		],
		lines: pay(2499.2, { CPF: [499, 426], CDAC: [1, 0], SDL: [0, 6.25] })
	}),
	sg({
		id: 'SG-EA21-2',
		description:
			'The SGD 2,288 non-workman works four hours on rest day Sunday 13 September 2026 at his own request.',
		citation: [
			'Employment Act 1968 s.37(2)(a): not more than half the normal hours at the employee’s request → half a day at the basic rate (https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr37-)',
			`${EA_PART4}: 105.60 ÷ 2 = 52.80`,
			`${CPF_2026}: 37% × 2,340.80 = 866.10 → 866; employee 468.16 → 468; employer 398`,
			`${SHG}: CDAC $1`,
			`${SDL}: 5.852 → 5.85`
		],
		period: '2026-09',
		inputs: [
			...citizen(2288),
			workDay('2026-09-13', [['09:00', '13:00']], {
				approved_overtime_hours: 4,
				requested_by: 'EMPLOYEE'
			})
		],
		lines: pay(2340.8, { CPF: [468, 398], CDAC: [1, 0], SDL: [0, 5.85] })
	}),
	sg({
		id: 'SG-EA33-1',
		description:
			'The SGD 2,288 non-workman works his eight hours on Hari Raya Haji, Wednesday 27 May 2026, at the employer’s request (Labour Day 1 May also published, not worked).',
		citation: [
			'Employment Act 1968 s.88(4): work on a public holiday earns an extra day’s salary at the basic rate for one day, on top of the day’s gross pay (https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr88-)',
			'MOM, Public holidays 2026: 1 May (Fri) Labour Day, 27 May (Wed) Hari Raya Haji (https://www.mom.gov.sg/employment-practices/public-holidays)',
			`${EA_PART4}: 12 × 2,288 ÷ 260 = 105.60`,
			`${CPF_2026}: 37% × 2,393.60 = 885.63 → 886; employee 478.72 → 478; employer 408`,
			`${SHG}: CDAC $1`,
			`${SDL}: 5.984 → 5.98`
		],
		period: '2026-05',
		inputs: [
			...citizen(2288),
			holiday('2026-05-01', 'Labour Day'),
			holiday('2026-05-27', 'Hari Raya Haji'),
			workDay(
				'2026-05-27',
				[
					['09:00', '13:00'],
					['14:00', '18:00']
				],
				{ approved_overtime_hours: 8 }
			)
		],
		lines: pay(2393.6, { CPF: [478, 408], CDAC: [1, 0], SDL: [0, 5.98] })
	}),
	sg({
		id: 'SG-HOL01-1',
		description:
			'Hari Raya Puasa falls on Saturday 21 March 2026, the SGD 2,288 employee’s off day: the employer pays the holiday at the gross rate (no day off in substitution recorded).',
		citation: [
			'Employment Act 1968 s.88(1)(c): a public holiday on a day the employee is not required to work — pay for that holiday at the gross rate or give a day off in substitution (https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr88-); the company records no substitution (entity fact public_holiday_compensation default PAY)',
			'MOM, Public holidays 2026: 21 March (Saturday) Hari Raya Puasa (https://www.mom.gov.sg/employment-practices/public-holidays)',
			'Employment Act 1968 s.107A and Third Schedule item 2: gross rate for one day = 12 × 2,288 ÷ (52 × 5) = 105.60 (https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr107A-,Sc3-)',
			`${CPF_2026}: 37% × 2,393.60 = 885.63 → 886; employee 478; employer 408`,
			`${SHG}: CDAC $1`,
			`${SDL}: 5.98`
		],
		period: '2026-03',
		inputs: [...citizen(2288), holiday('2026-03-21', 'Hari Raya Puasa'), workDay('2026-03-21', [])],
		lines: pay(2393.6, { CPF: [478, 408], CDAC: [1, 0], SDL: [0, 5.98] })
	})
);

// ── 2026-09-30 gap-closure round: branches the goldens prove and no probe did ─────────────────────────────────
const CPF_2026_SENIOR =
	'CPF Board, CPF Contribution Rate Table from 1 January 2026, Table 1 (read 2026-09-30): above 55–60 >$50–500 16% (TW), >$500–750 16% (TW) + 0.54 (TW − $500), employee 0.54 (TW − $500), >$750 34%/18%, max $2,720/$1,440; above 60–65 >$50–500 12.5% (TW), >$750 25%/12.5%; above 65–70 >$750 16.5%/7.5%, max $1,320/$600; above 70 >$500–750 7.5% (TW) + 0.15 (TW − $500), employee 0.15 (TW − $500) (https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf)';
const CPF_2026_SPR =
	'CPF Board, CPF Contribution Rate Table from 1 January 2026, Tables 2–5 (read 2026-09-30): Table 2 (1st-year G/G) 55 & below >$500–750 4% (TW) + 0.15 (TW − $500), employee 0.15 (TW − $500), >$750 9%/5% max $720/$400; above 60–65 >$750 8.5%/5%; Table 3 (2nd-year G/G) 55 & below >$50–500 9% (TW), above 55–60 >$750 18.5%/12.5%; Table 4 (1st-year F/G) above 65–70 >$750 14%/5%; Table 5 (2nd-year F/G) above 55–60 >$750 28.5%/12.5% (https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf)';
const CPF_2025_SENIOR =
	'CPF Board, CPF Contribution Rate Table from 1 January 2025, Table 1 (read 2026-09-30): above 65–70 >$750 16.5% (OW) / employee 7.5%; above 70 >$750 12.5% / employee 5% (https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPF_contribution_rates_from_1_Jan_2025.pdf)';
const CPF_2027_TABLE =
	'CPF Board, CPF Contribution Rate Table from 1 January 2027, Table 1 (read 2026-09-30): above 55–60 >$500–750 16.5% (TW) + 0.57 (TW − $500), employee 0.57 (TW − $500), >$750 35.5%/19% max $2,840/$1,520; above 60–65 >$50–500 13% (TW), >$500–750 13% (TW) + 0.39 (TW − $500), employee 0.39 (TW − $500); OW ceiling $8,000 (https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfcontributionrates.pdf)';
const EA_37 =
	'Employment Act 1968 s.37(2)–(3A) (SSO, current as at 30 Sep 2026): at the employee’s request — up to half the normal hours half a day, more than half up to the normal hours one day, beyond the normal hours one day plus 1.5 × the hourly basic rate for each hour or part thereof; at the employer’s request — one day, two days, two days plus the same 1.5×; “normal hours of work” are the agreed usual hours a day (8 on the probes’ week) (https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr37-)';
const EA_88 =
	'Employment Act 1968 s.88(1)–(4A) (SSO, current as at 30 Sep 2026): (1)(c) a holiday on a non-working day is paid at the gross rate or given as a day off in substitution; (2) no holiday pay for a holiday inside no-pay leave granted at the employee’s request; (3) no holiday pay after an absence without consent or excuse on the working day immediately before or after it; (4) holiday work earns an extra day at the basic rate; (4A) an employee outside Part 4 who is not a workman may be given time off in lieu of that extra day (https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr88-)';
const EA_35 =
	'Employment Act 1968 s.35 (SSO, current as at 30 Sep 2026): Part 4 applies to a workman on a salary not exceeding $4,500 a month and to every other employee (not a workman, nor in a managerial or executive position) on a salary not exceeding $2,600 (https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr35-)';
const MOM_PH =
	'MOM, Public holidays (read 2026-09-30): 2025 Christmas Day 25 Dec (Thu); 2026 New Year’s Day 1 Jan (Thu), Labour Day 1 May (Fri), Hari Raya Haji 27 May (Wed), National Day 9 Aug (Sun, Mon 10 Aug a holiday); 2027 Hari Raya Puasa 10 Mar (Wed) (https://www.mom.gov.sg/employment-practices/public-holidays)';

/** Part 4's $2,288 non-workman: 12.00 an hour, 105.60 a day (Fourth and Third Schedules). */
const clerk = (more: Partial<Hire> = {}) => citizen(2288, more);
const restDay = (
	date: string,
	clock: readonly (readonly [string, string])[],
	hours: number,
	by: string
) => workDay(date, clock, { approved_overtime_hours: hours, requested_by: by });
const unpaid = (from: string, to: string): ProbeInput => ({
	collection: 'leave_entries',
	values: {
		employment_id: '@e_job',
		catalogue_id: '@law:leave_catalogue:UNPAID_LEAVE',
		reference: 'PROBE-NPL',
		from_date: from,
		to_date: to,
		half_day_start: false,
		half_day_end: false,
		no_pay_origin: 'EMPLOYEE_REQUESTED',
		reason: 'Personal matters'
	}
});
const resigned = (to: string) => ({
	to,
	exit: { exit_ground: 'RESIGNATION', exit_facts: { notice_served: true } }
});

register(
	// ── s.37 rest-day awards not yet probed (SG-EA21) ──────────────────────────────────────────────────────────
	...(
		[
			[
				'SG-EA21-3',
				'seven hours at his own request',
				[['09:00', '16:00']],
				7,
				'EMPLOYEE',
				's.37(2)(b): more than half, not more than the normal hours → one day = 105.60',
				105.6,
				[478, 408],
				5.98
			],
			[
				'SG-EA21-4',
				'four hours at the employer’s request',
				[['09:00', '13:00']],
				4,
				'EMPLOYER',
				's.37(3)(a): not more than half the normal hours → one day = 105.60',
				105.6,
				[478, 408],
				5.98
			],
			[
				'SG-EA21-5',
				'eleven hours at the employer’s request',
				[['09:00', '20:00']],
				11,
				'EMPLOYER',
				's.37(3)(c): two days 211.20 + 3 h beyond the normal 8 × 12.00 × 1.5 = 54.00 → 265.20',
				265.2,
				[510, 435],
				6.38
			],
			[
				'SG-EA21-6',
				'ten hours at his own request',
				[['09:00', '19:00']],
				10,
				'EMPLOYEE',
				's.37(2)(c): one day 105.60 + 2 h × 12.00 × 1.5 = 36.00 → 141.60',
				141.6,
				[485, 414],
				6.07
			],
			[
				'SG-EA21-7',
				'eight and a half hours at the employer’s request',
				[['09:00', '17:30']],
				8.5,
				'EMPLOYER',
				's.37(3)(c)(ii): two days 211.20 + the half hour beyond the normal 8 is an “hour or part thereof” → 1 × 12.00 × 1.5 = 18.00 → 229.20',
				229.2,
				[503, 428],
				6.29
			]
		] as const
	).map(([id, what, clock, hours, by, rule, award, total, levy]) => {
		const gross = cents(2288 + award);
		return sg({
			id,
			description: `The SGD 2,288 non-workman works ${what} on rest day Sunday 13 September 2026.`,
			citation: [
				`${EA_37}: ${rule}`,
				`${EA_PART4}: 12.00 an hour, 105.60 a day`,
				`${CPF_2026}: 37% × ${gross} rounded to the dollar; employee 20% rounded down → ${total[0]} / ${total[1]}`,
				`${SHG}: CDAC $1`,
				`${SDL}: ${levy}`
			],
			period: '2026-09',
			inputs: [...clerk(), restDay('2026-09-13', clock, hours, by)],
			lines: pay(gross, { CPF: [total[0], total[1]], CDAC: [1, 0], SDL: [0, levy] })
		});
	}),

	// ── the s.35 Part 4 ceilings at the cent (SG-EA19, SG-EA46-R01) ────────────────────────────────────────────
	sg({
		id: 'SG-EA19-1',
		description:
			'A non-workman on exactly SGD 2,600 works two planned overtime hours on Monday 7 September 2026: inside Part 4, the Fourth Schedule hour unrounded.',
		citation: [
			`${EA_35}: $2,600 does not exceed $2,600`,
			`${EA_PART4}: 12 × 2,600 ÷ 2,288 = 13.636… an hour, 2 × 1.5 × 13.636… = 40.909 → 40.91 (tracker SG-EA46-R01 owner rule: the hour unrounded, the amount half up to the cent)`,
			`${CPF_2026}: 37% × 2,640.91 = 977.14 → 977; employee 528.18 → 528; employer 449`,
			`${SHG}: CDAC $1`,
			`${SDL}: 6.602 → 6.60`
		],
		period: '2026-09',
		inputs: [
			...citizen(2600),
			workDay(
				'2026-09-07',
				[
					['09:00', '13:00'],
					['14:00', '20:00']
				],
				{ approved_overtime_hours: 2 }
			)
		],
		lines: pay(2640.91, { CPF: [528, 449], CDAC: [1, 0], SDL: [0, 6.6] })
	}),
	sg({
		id: 'SG-EA19-2',
		description:
			'A non-workman on SGD 2,600.01 works the same two planned hours: one cent over the s.35(b) ceiling, no Part 4 overtime line.',
		citation: [
			`${EA_35}: $2,600.01 exceeds $2,600, so s.38(4) does not apply`,
			`${CPF_2026}: 37% × 2,600.01 = 962.00 → 962; employee 520.00 → 520; employer 442`,
			`${SHG}: CDAC $1`,
			`${SDL}: 6.500025 → 6.50`
		],
		period: '2026-09',
		inputs: [
			...citizen(2600.01),
			workDay(
				'2026-09-07',
				[
					['09:00', '13:00'],
					['14:00', '20:00']
				],
				{ approved_overtime_hours: 2 }
			)
		],
		lines: pay(2600.01, { CPF: [520, 442], CDAC: [1, 0], SDL: [0, 6.5] })
	}),
	sg({
		id: 'SG-EA19-3',
		description:
			'A workman (manual labour) on exactly SGD 4,500 works two planned overtime hours on Monday 7 September 2026: inside Part 4 at his actual basic rate, no $2,600 cap.',
		citation: [
			`${EA_35}: a workman on $4,500 does not exceed $4,500`,
			`${EA_PART4}: 12 × 4,500 ÷ 2,288 = 23.601… an hour, 2 × 1.5 × 23.601… = 70.804 → 70.80`,
			`${CPF_2026}: 37% × 4,570.80 = 1,691.20 → 1,691; employee 914.16 → 914; employer 777`,
			`${SHG}: CDAC $1.50 (>3,500–5,000)`,
			`${SDL}: over 4,500 → $11.25`
		],
		period: '2026-09',
		inputs: [
			...citizen(4500, { terms: [{ salary: 4500, category: 'MANUAL_LABOUR' }] }),
			workDay(
				'2026-09-07',
				[
					['09:00', '13:00'],
					['14:00', '20:00']
				],
				{ approved_overtime_hours: 2 }
			)
		],
		lines: pay(4570.8, { CPF: [914, 777], CDAC: [1.5, 0], SDL: [0, 11.25] })
	}),
	sg({
		id: 'SG-EA19-4',
		description:
			'A workman on SGD 4,500.01 works the same two planned hours: one cent over the s.35(a) ceiling, no Part 4 overtime line.',
		citation: [
			`${EA_35}: $4,500.01 exceeds $4,500`,
			`${CPF_2026}: 37% × 4,500.01 = 1,665.00 → 1,665; employee 900.00 → 900; employer 765`,
			`${SHG}: CDAC $1.50`,
			`${SDL}: over 4,500 → $11.25`
		],
		period: '2026-09',
		inputs: [
			...citizen(4500.01, { terms: [{ salary: 4500.01, category: 'MANUAL_LABOUR' }] }),
			workDay(
				'2026-09-07',
				[
					['09:00', '13:00'],
					['14:00', '20:00']
				],
				{ approved_overtime_hours: 2 }
			)
		],
		lines: pay(4500.01, { CPF: [900, 765], CDAC: [1.5, 0], SDL: [0, 11.25] })
	}),
	sg({
		id: 'SG-EA19-5',
		description:
			'A manager on SGD 2,288 works two planned hours beyond the day on Monday 7 September 2026: s.35(b) excludes a managerial or executive position whatever the salary.',
		citation: [
			`${EA_35}: “other than a workman or a person employed in a managerial or an executive position”`,
			`${CPF_2026}: 37% × 2,288 = 846.56 → 847; employee 457.60 → 457; employer 390`,
			`${SHG}: CDAC $1`,
			`${SDL}: 5.72`
		],
		period: '2026-09',
		inputs: [
			...citizen(2288, { terms: [{ salary: 2288, classification: 'MANAGERIAL' }] }),
			workDay(
				'2026-09-07',
				[
					['09:00', '13:00'],
					['14:00', '20:00']
				],
				{ approved_overtime_hours: 2 }
			)
		],
		lines: pay(2288, { CPF: [457, 390], CDAC: [1, 0], SDL: [0, 5.72] })
	}),

	// ── s.88 holiday branches (SG-EA33, SG-HOL01, SG-HOL02) ────────────────────────────────────────────────────
	sg({
		id: 'SG-EA33-2',
		description:
			'The SGD 2,288 non-workman works ten hours with the hour’s break on Hari Raya Haji, Wednesday 27 May 2026: the extra day plus 1.5× beyond the normal day.',
		citation: [
			`${EA_88}: (4) extra day 105.60`,
			`${EA_PART4}: s.38(4) 2 h beyond the normal 8 × 12.00 × 1.5 = 36.00 (the day’s gross pay is inside the salary)`,
			MOM_PH,
			`${CPF_2026}: 37% × 2,429.60 = 898.95 → 899; employee 485.92 → 485; employer 414`,
			`${SHG}: CDAC $1`,
			`${SDL}: 6.074 → 6.07`
		],
		period: '2026-05',
		inputs: [
			...clerk(),
			holiday('2026-05-01', 'Labour Day'),
			holiday('2026-05-27', 'Hari Raya Haji'),
			workDay(
				'2026-05-27',
				[
					['09:00', '13:00'],
					['14:00', '20:00']
				],
				{ approved_overtime_hours: 10 }
			)
		],
		lines: pay(2429.6, { CPF: [485, 414], CDAC: [1, 0], SDL: [0, 6.07] })
	}),
	...(
		[
			[
				'SG-EA33-3',
				'Friday 7 August (the working day before)',
				['2026-08-07'],
				19,
				2171.43,
				[434, 369],
				5.43
			],
			[
				'SG-EA33-4',
				'both Friday 7 and Tuesday 11 August (the holiday is forfeited once)',
				['2026-08-07', '2026-08-11'],
				18,
				2057.14,
				[411, 350],
				5.14
			],
			[
				'SG-EA33-5',
				'Thursday 6 August (not adjacent: only the day itself)',
				['2026-08-06'],
				20,
				2285.71,
				[457, 389],
				5.71
			]
		] as const
	).map(([id, when, days, paid, gross, cpf, levy]) =>
		sg({
			id,
			description: `A citizen on SGD 2,400 in August 2026 is absent without consent or excuse on ${when}; National Day is observed on Monday 10 August.`,
			citation: [
				`${EA_88}: (3)`,
				MOM_PH,
				`${EA_20A}: August 2026 holds 21 working days, the holiday among them; 2,400 × ${paid} ÷ 21 = ${gross} (adjacent forfeiture cases explicitly record no permission and no reasonable excuse with decision evidence)`,
				`${CPF_2026}: 37% × ${gross}, employee 20% rounded down → ${cpf[0]} / ${cpf[1]}`,
				`${SHG}: CDAC $1`,
				`${SDL}: ${levy}`
			],
			period: '2026-08',
			inputs: [
				...citizen(2400),
				holiday('2026-08-10', 'National Day (observed)'),
				...days.flatMap((d): ProbeInput[] => {
					if (id === 'SG-EA33-5') return [workDay(d, [])];
					const ref = `absence-${d}`;
					const reference = `Synthetic ${id} reviewed absence ${d}`;
					return [
						{
							...workDay(d, [], {
								facts: {
									absence_permission: 'NO',
									absence_reasonable_excuse: 'NO',
									absence_decision: reference
								}
							}),
							ref
						},
						{
							collection: 'fact_evidence',
							values: {
								subject: { collection: 'work_days', id: `@${ref}` },
								fact_key: 'absence_decision',
								reference,
								received_on: d
							}
						}
					];
				})
			],
			lines: pay(gross, { CPF: [cpf[0], cpf[1]], CDAC: [1, 0], SDL: [0, levy] })
		})
	),
	sg({
		id: 'SG-EA33-6',
		description:
			'A citizen on SGD 4,200 takes no-pay leave at his own request Tuesday 26 to Thursday 28 May 2026, across Hari Raya Haji on the Wednesday: the holiday is unpaid too.',
		citation: [
			`${EA_88}: (2)`,
			MOM_PH,
			`${EA_20A}: May 2026 holds 21 working days (1 and 27 May among them); 26, 27 and 28 May come off: 4,200 × 18 ÷ 21 = 3,600`,
			`${CPF_2026}: 37% × 3,600 = 1,332; employee 720; employer 612`,
			`${SHG}: CDAC $1.50`,
			`${SDL}: 9.00`
		],
		period: '2026-05',
		inputs: [
			...citizen(4200),
			holiday('2026-05-01', 'Labour Day'),
			holiday('2026-05-27', 'Hari Raya Haji'),
			unpaid('2026-05-26', '2026-05-28')
		],
		lines: pay(3600, { CPF: [720, 612], CDAC: [1.5, 0], SDL: [0, 9] })
	}),
	sg({
		id: 'SG-EA33-7',
		description:
			'Hari Raya Puasa on Saturday 21 March 2026, the SGD 2,288 employee’s off day, at a company that gives a day off in substitution: no holiday pay line.',
		citation: [
			`${EA_88}: (1)(c) — pay at the gross rate or a day off in substitution; the company records TIME_OFF (entity fact public_holiday_compensation); the day owed is not a payslip line`,
			'MOM, Public holidays 2026: 21 March (Saturday) Hari Raya Puasa (https://www.mom.gov.sg/employment-practices/public-holidays)',
			`${CPF_2026}: 37% × 2,288 = 847; employee 457; employer 390`,
			`${SHG}: CDAC $1`,
			`${SDL}: 5.72`
		],
		company: { public_holiday_compensation: 'TIME_OFF' },
		period: '2026-03',
		inputs: [...clerk(), holiday('2026-03-21', 'Hari Raya Puasa'), workDay('2026-03-21', [])],
		lines: pay(2288, { CPF: [457, 390], CDAC: [1, 0], SDL: [0, 5.72] })
	}),
	sg({
		id: 'SG-EA33-8',
		description:
			'A non-workman on SGD 3,000 (outside Part 4) works eight hours on Hari Raya Haji, Wednesday 27 May 2026, at a company that pays: the s.88(4) extra day at the basic rate.',
		citation: [
			`${EA_88}: (4) reaches every employee; the company records no time-off election (public_holiday_compensation default PAY)`,
			MOM_PH,
			`${EA_PART4}: Third Schedule 12 × 3,000 ÷ 260 = 138.4615 → 138.46`,
			`${CPF_2026}: 37% × 3,138.46 = 1,161.23 → 1,161; employee 627.69 → 627; employer 534`,
			`${SHG}: CDAC $1`,
			`${SDL}: 7.846 → 7.85`
		],
		period: '2026-05',
		inputs: [
			...citizen(3000),
			holiday('2026-05-01', 'Labour Day'),
			holiday('2026-05-27', 'Hari Raya Haji'),
			workDay(
				'2026-05-27',
				[
					['09:00', '13:00'],
					['14:00', '18:00']
				],
				{ approved_overtime_hours: 8 }
			)
		],
		lines: pay(3138.46, { CPF: [627, 534], CDAC: [1, 0], SDL: [0, 7.85] })
	}),
	sg({
		id: 'SG-EA33-9',
		description:
			'The same SGD 3,000 non-workman and holiday at a company that gives time off in lieu: s.88(4A) replaces the extra day, so the month is the salary.',
		citation: [
			`${EA_88}: (4A) — outside Part 4 and not a workman, time off may be given in lieu of the extra day; the company records TIME_OFF`,
			MOM_PH,
			`${CPF_2026}: 600 / 510`,
			`${SHG}: CDAC $1`,
			`${SDL}: 7.50`
		],
		company: { public_holiday_compensation: 'TIME_OFF' },
		period: '2026-05',
		inputs: [
			...citizen(3000),
			holiday('2026-05-01', 'Labour Day'),
			holiday('2026-05-27', 'Hari Raya Haji'),
			workDay(
				'2026-05-27',
				[
					['09:00', '13:00'],
					['14:00', '18:00']
				],
				{ approved_overtime_hours: 8 }
			)
		],
		lines: pay(3000, { CPF: [600, 510], CDAC: [1, 0], SDL: [0, 7.5] })
	}),
	sg({
		id: 'SG-EA33-10',
		description:
			'The SGD 2,288 non-workman (inside Part 4) works eight hours on Hari Raya Haji at a TIME_OFF company: s.88(4A) does not reach him, so the extra day is paid.',
		citation: [
			`${EA_88}: (4A) excludes an employee to whom Part 4 applies by s.35(b); (4) extra day 105.60`,
			MOM_PH,
			`${CPF_2026}: 37% × 2,393.60 = 885.63 → 886; employee 478; employer 408`,
			`${SHG}: CDAC $1`,
			`${SDL}: 5.98`
		],
		company: { public_holiday_compensation: 'TIME_OFF' },
		period: '2026-05',
		inputs: [
			...clerk(),
			holiday('2026-05-01', 'Labour Day'),
			holiday('2026-05-27', 'Hari Raya Haji'),
			workDay(
				'2026-05-27',
				[
					['09:00', '13:00'],
					['14:00', '18:00']
				],
				{ approved_overtime_hours: 8 }
			)
		],
		lines: pay(2393.6, { CPF: [478, 408], CDAC: [1, 0], SDL: [0, 5.98] })
	}),
	sg({
		id: 'SG-HOL01-2',
		description:
			'The SGD 2,288 non-workman works eight hours on Christmas Day, Thursday 25 December 2025: the December 2025 version prices the s.88(4) extra day.',
		citation: [
			`${EA_88}: (4) extra day 105.60`,
			MOM_PH,
			`${CPF_2025}: Table 1, 55 & below, 37% × 2,393.60 = 885.63 → 886; employee 20% = 478; employer 408`,
			`${SHG}: CDAC $1`,
			`${SDL}: 5.98`
		],
		period: '2025-12',
		inputs: [
			...clerk(),
			holiday('2025-12-25', 'Christmas Day'),
			workDay(
				'2025-12-25',
				[
					['09:00', '13:00'],
					['14:00', '18:00']
				],
				{ approved_overtime_hours: 8 }
			)
		],
		lines: pay(2393.6, { CPF: [478, 408], CDAC: [1, 0], SDL: [0, 5.98] })
	}),
	sg({
		id: 'SG-HOL02-1',
		description:
			'The SGD 2,288 non-workman works eight hours on Hari Raya Puasa, Wednesday 10 March 2027: the 2027 version prices the s.88(4) extra day.',
		citation: [
			`${EA_88}: (4) extra day 105.60`,
			MOM_PH,
			`${CPF_2027_TABLE}; 55 & below unchanged: 37% × 2,393.60 → 886; employee 478; employer 408`,
			`${SHG}: CDAC $1`,
			`${SDL}: 5.98`
		],
		period: '2027-03',
		inputs: [
			...clerk(),
			holiday('2027-03-10', 'Hari Raya Puasa'),
			workDay(
				'2027-03-10',
				[
					['09:00', '13:00'],
					['14:00', '18:00']
				],
				{ approved_overtime_hours: 8 }
			)
		],
		lines: pay(2393.6, { CPF: [478, 408], CDAC: [1, 0], SDL: [0, 5.98] })
	}),

	// ── s.20A branches (SG-EA10, SG-EA14) ──────────────────────────────────────────────────────────────────────
	sg({
		id: 'SG-EA10-3',
		description:
			'A citizen on SGD 3,400 who joins on Friday 16 January 2026: New Year’s Day counts among the month’s 22 working days (s.20A counts a holiday on a working day).',
		citation: [
			`${EA_20A}: 3,400 × 11 ÷ 22 = 1,700`,
			'MOM, Salary for an incomplete month of work: working days “include public holidays” (https://www.mom.gov.sg/employment-practices/salary/monthly-and-daily-salary)',
			MOM_PH,
			`${CPF_2026}: 37% × 1,700 = 629; employee 340; employer 289`,
			`${SHG}: CDAC $0.50`,
			`${SDL}: 4.25`
		],
		period: '2026-01',
		inputs: [...citizen(3400, { from: '2026-01-16' }), holiday('2026-01-01', "New Year's Day")],
		lines: pay(1700, { CPF: [340, 289], CDAC: [0.5, 0], SDL: [0, 4.25] })
	}),
	sg({
		id: 'SG-EA10-4',
		description:
			'A citizen on SGD 3,400 who resigns with notice, last day Thursday 15 January 2026: 10 days worked plus New Year’s Day = 11 of 22.',
		citation: [
			`${EA_20A} (b): days actually worked include the holiday: 3,400 × 11 ÷ 22 = 1,700`,
			MOM_PH,
			'Employment Act 1968 s.23(1): salary due on the day a resignation with notice ends the contract (https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr23-)',
			`${CPF_2026}: 629 / 340 / 289`,
			`${SHG}: CDAC $0.50`,
			`${SDL}: 4.25`
		],
		period: '2026-01',
		inputs: [...citizen(3400, resigned('2026-01-15')), holiday('2026-01-01', "New Year's Day")],
		lines: pay(1700, { CPF: [340, 289], CDAC: [0.5, 0], SDL: [0, 4.25] })
	}),
	sg({
		id: 'SG-EA10-5',
		description:
			'A citizen on SGD 3,000 whose last day is Sunday 1 March 2026: no working day in the month, so no wages and no charge.',
		citation: [
			`${EA_20A}: 0 of 22 working days → 0`,
			`${CPF_2026}: TW $50 or less → nil`,
			'CPF Board, self-help groups: contributions are deducted from the month’s wages; no wages, no deduction (https://www.cpf.gov.sg/employer/employer-obligations/contributions-to-self-help-groups)',
			'SDL Act 1979 s.3: the levy is on remuneration paid; none is paid (https://sso.agc.gov.sg/Act/SDLA1979#pr3-)'
		],
		period: '2026-03',
		inputs: citizen(3000, resigned('2026-03-01')),
		lines: pay(0, {})
	}),
	sg({
		id: 'SG-CPF17-9',
		description:
			'A citizen on SGD 3,000 whose last day is Monday 2 March 2026: one working day of 22 falls in the employer-only $50–$500 CPF band.',
		citation: [
			`${EA_20A}: 3,000 × 1 ÷ 22 = 136.36`,
			`${CPF_2026}: Table 1, 55 & below, > $50 to $500: 17% × 136.36 = 23.18 → 23, employee nil`,
			`${SHG}: CDAC $0.50`,
			`${SDL}: under $800 → $2`
		],
		period: '2026-03',
		inputs: citizen(3000, resigned('2026-03-02')),
		lines: pay(136.36, { CPF: [0, 23], CDAC: [0.5, 0], SDL: [0, 2] })
	}),
	sg({
		id: 'SG-EA14-2',
		description:
			'A citizen on SGD 4,400 absent without leave on Tuesday 8 September 2026 (no attendance, no leave row): one working day comes off.',
		citation: [
			'Employment Act 1968 s.28(1)–(2): a deduction for absence may be made only for the time the employee was required to work and was absent, at the rate the month’s salary bears to the days required (https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr28-)',
			`${EA_20A}: 4,400 × 21 ÷ 22 = 4,200`,
			`${CPF_2026}: 37% × 4,200 = 1,554; employee 840; employer 714`,
			`${SHG}: CDAC $1.50`,
			`${SDL}: 10.50`
		],
		period: '2026-09',
		inputs: [...citizen(4400), workDay('2026-09-08', [])],
		lines: pay(4200, { CPF: [840, 714], CDAC: [1.5, 0], SDL: [0, 10.5] })
	}),
	sg({
		id: 'SG-EA05-1',
		description:
			'A citizen on SGD 3,000 dismissed without notice (not for misconduct), last day Friday 27 February 2026, paid one month’s salary in lieu of notice: outside CPF and CDAC, inside SDL.',
		citation: [
			'Employment Act 1968 s.11(1): either party may end the contract without notice by paying the salary for the notice period (https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr11-)',
			`${CPF_WAGES}: compensation in lieu of notice is not wages`,
			`${EA_20A}: February 2026 holds 20 working days, all worked → 3,000`,
			`${CPF_2026}: on the salary 3,000 → 600 / 510`,
			`${SHG}: CDAC on the month’s wages 3,000 → $1 (the payment in lieu is not wages)`,
			`${SDL}: remuneration 6,000 > 4,500 → $11.25 (catalogue SALARY_IN_LIEU_OF_NOTICE counts toward SDL)`
		],
		period: '2026-02',
		inputs: [
			...citizen(3000, {
				to: '2026-02-27',
				exit: {
					exit_ground: 'DISMISSAL',
					exit_facts: { misconduct_dismissal: false, final_pay_not_possible: false }
				}
			}),
			bonus(3000, '2026-02-27', 'One month’s salary in lieu of notice', 'SALARY_IN_LIEU_OF_NOTICE')
		],
		lines: pay(6000, { CPF: [600, 510], CDAC: [1, 0], SDL: [0, 11.25] })
	}),

	// ── CPF: the senior, SPR and 2027 cells no probe read (SG-CPF18, SG-CPF19, SG-CPF29) ───────────────────────
	...(
		[
			[
				'SG-CPF18-15',
				'1958-05-10',
				'2025-12',
				3000,
				CPF_2025_SENIOR,
				'above 65–70: 16.5% = 495; employee 7.5% = 225; employer 270',
				[225, 270],
				1,
				7.5
			],
			[
				'SG-CPF18-16',
				'1953-05-10',
				'2025-12',
				3000,
				CPF_2025_SENIOR,
				'above 70: 12.5% = 375; employee 5% = 150; employer 225',
				[150, 225],
				1,
				7.5
			],
			[
				'SG-CPF18-17',
				'1968-05-10',
				'2026-02',
				600,
				CPF_2026_SENIOR,
				'above 55–60, >$500–750: 16% × 600 + 0.54 × 100 = 150; employee 54; employer 96',
				[54, 96],
				0.5,
				2
			],
			[
				'SG-CPF18-18',
				'1963-05-10',
				'2026-02',
				400,
				CPF_2026_SENIOR,
				'above 60–65, >$50–500: 12.5% × 400 = 50; employee nil',
				[0, 50],
				0.5,
				2
			],
			[
				'SG-CPF18-19',
				'1953-05-10',
				'2026-02',
				700,
				CPF_2026_SENIOR,
				'above 70, >$500–750: 7.5% × 700 + 0.15 × 200 = 82.50 → 83; employee 30; employer 53',
				[30, 53],
				0.5,
				2
			],
			[
				'SG-CPF18-20',
				'1958-05-10',
				'2026-02',
				10000,
				CPF_2026_SENIOR,
				'above 65–70 at the $8,000 OW ceiling: max 1,320; employee max 600; employer 720',
				[600, 720],
				3,
				11.25
			],
			[
				'SG-CPF29-6',
				'1969-05-10',
				'2027-01',
				600,
				CPF_2027_TABLE,
				'above 55–60, >$500–750: 16.5% × 600 + 0.57 × 100 = 156; employee 57; employer 99',
				[57, 99],
				0.5,
				2
			],
			[
				'SG-CPF29-7',
				'1964-05-10',
				'2027-01',
				700,
				CPF_2027_TABLE,
				'above 60–65, >$500–750: 13% × 700 + 0.39 × 200 = 169; employee 78; employer 91',
				[78, 91],
				0.5,
				2
			],
			[
				'SG-CPF29-8',
				'1969-05-10',
				'2027-01',
				10000,
				CPF_2027_TABLE,
				'above 55–60 at the $8,000 OW ceiling: max 2,840; employee max 1,520; employer 1,320',
				[1520, 1320],
				3,
				11.25
			],
			[
				'SG-CPF29-9',
				'1964-05-10',
				'2027-01',
				400,
				CPF_2027_TABLE,
				'above 60–65, >$50–500: 13% × 400 = 52; employee nil',
				[0, 52],
				0.5,
				2
			]
		] as const
	).map(([id, born, period, salary, table, rule, cpf, cdac, levy]) =>
		sg({
			id,
			description: `A citizen born ${born} on SGD ${salary} in ${period}: ${rule.split(':')[0]}.`,
			citation: [`${table}: ${rule}`, CPF_AGE, `${SHG}: CDAC $${cdac}`, `${SDL}: ${levy}`],
			period,
			inputs: citizen(salary, { born }),
			lines: pay(salary, { CPF: [cpf[0], cpf[1]], CDAC: [cdac, 0], SDL: [0, levy] })
		})
	),
	...(
		[
			[
				'SG-CPF19-6',
				'1963-05-10',
				'2025-11-10',
				3000,
				null,
				'Table 2 (1st year G/G), above 60–65: 8.5% × 3,000 = 255; employee 5% = 150; employer 105',
				[150, 105],
				1,
				7.5
			],
			[
				'SG-CPF19-7',
				'1968-05-10',
				'2024-11-10',
				3000,
				null,
				'Table 3 (2nd year G/G), above 55–60: 18.5% × 3,000 = 555; employee 12.5% = 375; employer 180',
				[375, 180],
				1,
				7.5
			],
			[
				'SG-CPF19-8',
				'1996-04-18',
				'2025-11-10',
				600,
				null,
				'Table 2, 55 & below, >$500–750: 4% × 600 + 0.15 × 100 = 39; employee 15; employer 24',
				[15, 24],
				0.5,
				2
			],
			[
				'SG-CPF19-9',
				'1996-04-18',
				'2024-11-10',
				400,
				null,
				'Table 3, 55 & below, >$50–500: 9% × 400 = 36; employee nil',
				[0, 36],
				0.5,
				2
			],
			[
				'SG-CPF19-10',
				'1958-05-10',
				'2025-11-10',
				3000,
				'CPF-JOINT-APPROVAL-4',
				'Table 4 (1st year F/G), above 65–70: 14% × 3,000 = 420; employee 5% = 150; employer 270',
				[150, 270],
				1,
				7.5
			],
			[
				'SG-CPF19-11',
				'1968-05-10',
				'2024-11-10',
				3000,
				'CPF-JOINT-APPROVAL-5',
				'Table 5 (2nd year F/G), above 55–60: 28.5% × 3,000 = 855; employee 12.5% = 375; employer 480',
				[375, 480],
				1,
				7.5
			],
			[
				'SG-CPF19-12',
				'1996-04-18',
				'2025-11-10',
				10000,
				null,
				'Table 2, 55 & below at the $8,000 OW ceiling: max 720; employee max 400; employer 320',
				[400, 320],
				3,
				11.25
			]
		] as const
	).map(([id, born, since, salary, approval, rule, cpf, cdac, levy]) => {
		const from = since < HIRED ? HIRED : since;
		return sg({
			id,
			description: `An SPR since ${since}, born ${born}, on SGD ${salary} in February 2026: ${rule.split(':')[0]}.`,
			citation: [
				CPF_SPR,
				`${CPF_2026_SPR}: ${rule}`,
				...(approval == null
					? []
					: [
							'CPF Board, contributing more CPF for a new SPR employee: full employer / graduated employee rates need a joint application approved by the Board (https://www.cpf.gov.sg/service/article/how-can-i-contribute-more-cpf-for-my-employee-who-just-obtained-his-singapore-permanent-resident-spr-status)'
						]),
				CPF_AGE,
				`${SHG}: CDAC $${cdac} (SPR)`,
				`${SDL}: ${levy}`
			],
			period: '2026-02',
			inputs: [
				...citizen(salary, {
					born,
					from,
					terms: [{ salary, residency: 'PERMANENT_RESIDENT', since }]
				}),
				...(approval == null
					? []
					: [
							registration('CPF', from, {
								reference_number: 'PROBE-CPF',
								elections: {
									spr_full_rate: false,
									spr_full_employer_rate: true,
									spr_approval_reference: approval
								}
							})
						])
			],
			lines: pay(salary, { CPF: [cpf[0], cpf[1]], CDAC: [cdac, 0], SDL: [0, levy] })
		});
	}),

	// ── the AW ceiling on cessation (SG-CPF21, SG-CPF03) ───────────────────────────────────────────────────────
	...(
		[
			[
				'SG-CPF21-3',
				true,
				'resigns with notice, last day 31 March',
				'102,000 − (16,000 + 8,000) actual OW to cessation = 78,000; base 8,000 + 78,000 = 86,000: 37% = 31,820; employee 17,200; employer 14,620',
				[17200, 14620]
			],
			[
				'SG-CPF21-4',
				false,
				'stays on',
				'102,000 − (16,000 + 8,000 × 10) estimated OW = 6,000; base 8,000 + 6,000 = 14,000: 37% = 5,180; employee 2,800; employer 2,380',
				[2800, 2380]
			]
		] as const
	).map(([id, leaves, what, rule, cpf]) =>
		sg({
			id,
			description: `A citizen on SGD 8,000 with January–February 2026 already contributed, paid a SGD 100,000 bonus on 10 March 2026, ${what}.`,
			citation: [
				`${CPF_AW}: before cessation the year’s OW is estimated; on cessation the actual OW to the last day is used (CPF Board AW ceiling examples, Steps 1–2)`,
				`${CPF_2026}: ${rule}`,
				CPF_WAGES,
				`${SHG}: CDAC $3 on 108,000`,
				`${SDL}: capped at $11.25`
			],
			period: '2026-03',
			inputs: [
				...citizen(8000, leaves ? resigned('2026-03-31') : {}),
				registration('CPF', HIRED, {
					reference_number: 'PROBE-CPF',
					opening: [
						{
							year: '2026',
							base: 16000,
							ordinary: 16000,
							employee: 3200,
							employer: 2720,
							origin: 'CURRENT_EMPLOYER',
							reference: 'This employer’s CPF submissions, January–February 2026'
						}
					]
				}),
				bonus(100000, '2026-03-10', 'Performance bonus')
			],
			lines: pay(108000, { CPF: [cpf[0], cpf[1]], CDAC: [3, 0], SDL: [0, 11.25] })
		})
	),

	// ── self-help funds: opt-out, r.8 instructions, foreign Indian community (SG-SHG01, SG-SHG03, SG-SHG04(b)) ─
	sg({
		id: 'SG-SHG01-3',
		description:
			'A Chinese citizen on SGD 1,500 in February 2026 who has opted out of CDAC by written application to the fund: no CDAC.',
		citation: [
			'CPF (Contributions to Community Fund — CDAC) Rules 1992 r.3(1) (deduct from each employee who desires to contribute) and r.4 (an employee who does not desire to contribute notifies the employer on CDAC’s form) (SSO, current as at 30 Sep 2026, https://sso.agc.gov.sg/SL/CPFA1953-R6?ProvIds=pr3-,pr4-)',
			`${CPF_2026}: 37% × 1,500 = 555; employee 300; employer 255`,
			`${SDL}: 3.75`
		],
		period: '2026-02',
		inputs: [
			...citizen(1500),
			registration('CDAC', HIRED, {
				reference_number: 'PROBE-CDAC',
				elections: { shg_opt_out: true, shg_instruction_reference: 'CDAC-OPT-OUT-1' }
			})
		],
		lines: pay(1500, { CPF: [300, 255], SDL: [0, 3.75] })
	}),
	...(
		[
			[
				'SG-SHG03-9',
				'CHINESE',
				'CDAC',
				5,
				'CPF (Contributions to Community Fund — CDAC) Rules 1992 r.8 (SSO, read 30 Sep 2026, https://sso.agc.gov.sg/SL/CPFA1953-R6?ProvIds=pr8-): written notice to contribute in excess of the Schedule rate — $5 instead of $1',
				'CDAC-R8-NOTICE'
			],
			[
				'SG-SHG03-10',
				'INDIAN',
				'SINDA',
				2,
				'SINDA Rules 1992 r.8(2) (https://sso.agc.gov.sg/SL/CPFA1953-R5): notice on SINDA’s form of a lesser amount — $2 instead of $7 (golden “a fund instruction for a different monthly amount…”)',
				'SINDA-R8-FORM'
			]
		] as const
	).map(([id, race, fund, amount, rule, reference]) =>
		sg({
			id,
			description: `A ${race.toLowerCase()} citizen on SGD 3,000 in September 2026 whose ${fund} instruction names $${amount} a month.`,
			citation: [
				rule,
				`${SHG}: the Schedule rung at 3,000 would be CDAC $1 / SINDA $7`,
				`${CPF_2026}: 600 / 510`,
				`${SDL}: 7.50`
			],
			period: '2026-09',
			inputs: [
				...hire({
					name: `${fund} instruction`,
					born: '1996-04-18',
					race,
					terms: [{ salary: 3000 }]
				}),
				registration(fund, HIRED, {
					reference_number: `PROBE-${fund}`,
					elections: { shg_monthly_amount: amount, shg_instruction_reference: reference }
				})
			],
			lines: pay(3000, { CPF: [600, 510], [fund]: [amount, 0], SDL: [0, 7.5] })
		})
	),
	sg({
		id: 'SG-SHG04b-1',
		description:
			'An Indian S Pass holder on SGD 3,000 in February 2026: outside CPF, inside SINDA (the Rules define the community by descent, with no pass condition).',
		citation: [
			CPF_ACT,
			'SINDA Rules 1992 r.2 (“Indian community”) and r.3 (deduction from each employee of the community) (https://sso.agc.gov.sg/SL/CPFA1953-R5); tracker SG-SHG04(b)',
			`${SHG}: SINDA $7 (>2,500–4,500)`,
			`${SDL}: 7.50, foreign employees included`
		],
		period: '2026-02',
		inputs: hire({
			name: 'Ravi Kumar',
			born: '1992-02-02',
			race: 'INDIAN',
			nationality: 'Indian',
			terms: [{ salary: 3000, residency: 'FOREIGNER', pass: 'S_PASS' }]
		}),
		lines: pay(3000, { SINDA: [7, 0], SDL: [0, 7.5] })
	})
);

// ── 2026-09-30 batch 9: every self-help-fund rung edge, the EA ss.29–32 deduction limits, OW + AW at the ceiling ─
const SHG_TABLE =
	'CPF Board, Contributions to self-help groups (read 30 Sep 2026): CDAC ≤$2,000 $0.50, >2,000–3,500 $1, >3,500–5,000 $1.50, >5,000–7,500 $2, >7,500 $3; ECF ≤1,000 $2, >1,000–1,500 $4, >1,500–2,500 $6, >2,500–4,000 $9, >4,000–7,000 $12, >7,000–10,000 $16, >10,000 $20; MBMF ≤1,000 $3, >1,000–2,000 $4.50, >2,000–3,000 $6.50, >3,000–4,000 $15, >4,000–6,000 $19.50, >6,000–8,000 $22, >8,000–10,000 $24, >10,000 $26; SINDA ≤1,000 $1, >1,000–1,500 $3, >1,500–2,500 $5, >2,500–4,500 $7, >4,500–7,500 $9, >7,500–10,000 $12, >10,000–15,000 $18, >15,000 $30 (https://www.cpf.gov.sg/employer/employer-obligations/contributions-to-self-help-groups)';
const EA_DEDUCT =
	'Employment Act 1968 (SSO, current as at 30 Sep 2026) s.27(1)(b) damage or loss, (d) house accommodation, (e) amenities, (h) CPF, (j) co-operative society dues; s.29(1): a damage deduction must not exceed the loss and, except with the Commissioner’s permission, one-quarter of one month’s wages; s.30(2): accommodation and amenity deductions together must not exceed one-quarter of the salary payable for the salary period; s.32(1): all deductions other than under s.27(1)(a), (f) or (j) must not exceed 50% of the salary payable for the period; s.32(2): (1) does not apply to the last salary on termination (https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr27-,pr29-,pr30-,pr32-)';
const EA_DEDUCT_BASE = `${CPF_2026}: 3,000 → 600 / 510; ${SHG}: CDAC $1; ${SDL}: 7.50`;

/** A one-off deduction of `code` on 15 September 2026, with its inquiry or consent record uploaded. */
const deduct = (code: string, amount: number, reason: string): ProbeInput => ({
	...bonus(amount, '2026-09-15', reason, code),
	files: { evidence_file: `${code.toLowerCase()}-record.pdf` }
});
/** A SGD 3,000 slip (CPF 600 / 510, CDAC 1, SDL 7.50) less `other` deductions. */
const lessOther = (other: number) => ({
	...pay(3000, { CPF: [600, 510], CDAC: [1, 0], SDL: [0, 7.5] }),
	total_deductions: cents(601 + other),
	net: cents(3000 - 601 - other)
});

register(
	// ── every rung edge no probe read (SG-SHG03; SG-SDL02 cap seam via 4,500 / 4,500.01) ───────────────────────
	...(
		[
			['SG-SHG03-11', 'CHINESE', 'OTHER', 3500, 'CDAC', 1, [700, 595], 8.75],
			['SG-SHG03-12', 'CHINESE', 'OTHER', 3500.01, 'CDAC', 1.5, [700, 595], 8.75],
			['SG-SHG03-13', 'CHINESE', 'OTHER', 5000, 'CDAC', 1.5, [1000, 850], 11.25],
			['SG-SHG03-14', 'CHINESE', 'OTHER', 5000.01, 'CDAC', 2, [1000, 850], 11.25],
			['SG-SHG03-15', 'CHINESE', 'OTHER', 7500, 'CDAC', 2, [1500, 1275], 11.25],
			['SG-SHG03-16', 'CHINESE', 'OTHER', 7500.01, 'CDAC', 3, [1500, 1275], 11.25],
			['SG-SHG03-17', 'EURASIAN', 'OTHER', 1000, 'ECF', 2, [200, 170], 2.5],
			['SG-SHG03-18', 'EURASIAN', 'OTHER', 1000.01, 'ECF', 4, [200, 170], 2.5],
			['SG-SHG03-19', 'EURASIAN', 'OTHER', 1500, 'ECF', 4, [300, 255], 3.75],
			['SG-SHG03-20', 'EURASIAN', 'OTHER', 1500.01, 'ECF', 6, [300, 255], 3.75],
			['SG-SHG03-21', 'EURASIAN', 'OTHER', 2500, 'ECF', 6, [500, 425], 6.25],
			['SG-SHG03-22', 'EURASIAN', 'OTHER', 2500.01, 'ECF', 9, [500, 425], 6.25],
			['SG-SHG03-23', 'EURASIAN', 'OTHER', 7000, 'ECF', 12, [1400, 1190], 11.25],
			['SG-SHG03-24', 'EURASIAN', 'OTHER', 7000.01, 'ECF', 16, [1400, 1190], 11.25],
			['SG-SHG03-25', 'EURASIAN', 'OTHER', 10000, 'ECF', 16, [1600, 1360], 11.25],
			['SG-SHG03-26', 'EURASIAN', 'OTHER', 10000.01, 'ECF', 20, [1600, 1360], 11.25],
			['SG-SHG03-27', 'MALAY', 'ISLAM', 1000, 'MBMF', 3, [200, 170], 2.5],
			['SG-SHG03-28', 'MALAY', 'ISLAM', 1000.01, 'MBMF', 4.5, [200, 170], 2.5],
			['SG-SHG03-29', 'MALAY', 'ISLAM', 2000, 'MBMF', 4.5, [400, 340], 5],
			['SG-SHG03-30', 'MALAY', 'ISLAM', 2000.01, 'MBMF', 6.5, [400, 340], 5],
			['SG-SHG03-31', 'MALAY', 'ISLAM', 3000.01, 'MBMF', 15, [600, 510], 7.5],
			['SG-SHG03-32', 'MALAY', 'ISLAM', 4000, 'MBMF', 15, [800, 680], 10],
			['SG-SHG03-33', 'MALAY', 'ISLAM', 4000.01, 'MBMF', 19.5, [800, 680], 10],
			['SG-SHG03-34', 'MALAY', 'ISLAM', 6000, 'MBMF', 19.5, [1200, 1020], 11.25],
			['SG-SHG03-35', 'MALAY', 'ISLAM', 6000.01, 'MBMF', 22, [1200, 1020], 11.25],
			['SG-SHG03-36', 'MALAY', 'ISLAM', 8000, 'MBMF', 22, [1600, 1360], 11.25],
			['SG-SHG03-37', 'MALAY', 'ISLAM', 8000.01, 'MBMF', 24, [1600, 1360], 11.25],
			['SG-SHG03-38', 'MALAY', 'ISLAM', 10000, 'MBMF', 24, [1600, 1360], 11.25],
			['SG-SHG03-39', 'MALAY', 'ISLAM', 10000.01, 'MBMF', 26, [1600, 1360], 11.25],
			['SG-SHG03-40', 'INDIAN', 'OTHER', 1000.01, 'SINDA', 3, [200, 170], 2.5],
			['SG-SHG03-41', 'INDIAN', 'OTHER', 1500, 'SINDA', 3, [300, 255], 3.75],
			['SG-SHG03-42', 'INDIAN', 'OTHER', 1500.01, 'SINDA', 5, [300, 255], 3.75],
			['SG-SHG03-43', 'INDIAN', 'OTHER', 2500, 'SINDA', 5, [500, 425], 6.25],
			['SG-SHG03-44', 'INDIAN', 'OTHER', 2500.01, 'SINDA', 7, [500, 425], 6.25],
			['SG-SHG03-45', 'INDIAN', 'OTHER', 4500, 'SINDA', 7, [900, 765], 11.25],
			['SG-SHG03-46', 'INDIAN', 'OTHER', 4500.01, 'SINDA', 9, [900, 765], 11.25],
			['SG-SHG03-47', 'INDIAN', 'OTHER', 7500, 'SINDA', 9, [1500, 1275], 11.25],
			['SG-SHG03-48', 'INDIAN', 'OTHER', 7500.01, 'SINDA', 12, [1500, 1275], 11.25],
			['SG-SHG03-49', 'INDIAN', 'OTHER', 10000, 'SINDA', 12, [1600, 1360], 11.25],
			['SG-SHG03-50', 'INDIAN', 'OTHER', 10000.01, 'SINDA', 18, [1600, 1360], 11.25],
			['SG-SHG03-51', 'INDIAN', 'OTHER', 15000, 'SINDA', 18, [1600, 1360], 11.25],
			['SG-SHG03-52', 'INDIAN', 'OTHER', 15000.01, 'SINDA', 30, [1600, 1360], 11.25]
		] as const
	).map(([id, race, religion, salary, fund, amount, cpf, sdl]) =>
		sg({
			id,
			description: `A ${race.toLowerCase()} citizen${religion === 'ISLAM' ? ', Muslim,' : ''} on SGD ${salary} in February 2026: ${fund} $${amount} at the rung edge.`,
			citation: [
				`${SHG_TABLE}: ${fund} on ${salary} → $${amount}`,
				`${CPF_2026}: 37% × min(${salary}, 8,000) rounded to the dollar, employee 20% rounded down → ${cpf[0]} / ${cpf[1]}`,
				`${SDL}: ${sdl}`
			],
			period: '2026-02',
			inputs: hire({
				name: `${fund} rung probe`,
				born: '1996-04-18',
				race,
				religion,
				terms: [{ salary }]
			}),
			lines: pay(salary, { CPF: [cpf[0], cpf[1]], [fund]: [amount, 0], SDL: [0, sdl] })
		})
	),

	// ── EA ss.29, 30, 32: the deduction limits (SG-EA15, SG-EA17) — a citizen on SGD 3,000, September 2026 ────────
	sg({
		id: 'SG-EA15-1',
		description:
			'A damage deduction of SGD 750 after an inquiry: exactly one-quarter of the month’s SGD 3,000 wages, so it is taken.',
		citation: [
			`${EA_DEDUCT}: s.29(1) ¼ × 3,000 = 750; s.32(1) 50% × 3,000 = 1,500 less CPF 600 and CDAC 1 = 899 ≥ 750`,
			EA_DEDUCT_BASE
		],
		period: '2026-09',
		inputs: [...citizen(3000), deduct('DAMAGE_RECOVERY', 750, 'Damaged equipment, inquiry held')],
		lines: lessOther(750)
	}),
	sg({
		id: 'SG-EA15-2',
		description:
			'A damage deduction of SGD 750.01 without the Commissioner’s permission: a cent over s.29(1), so the run is refused.',
		citation: [`${EA_DEDUCT}: s.29(1) ¼ × 3,000 = 750 < 750.01 → excess 0.01`, EA_DEDUCT_BASE],
		period: '2026-09',
		inputs: [
			...citizen(3000),
			deduct('DAMAGE_RECOVERY', 750.01, 'Damaged equipment, inquiry held')
		],
		lines: {},
		refused: 'DEDUCTION_CEILING_EXCEEDED.*by 0\\.01 SGD'
	}),
	sg({
		id: 'SG-EA15-3',
		description:
			'A Commissioner-permitted damage deduction of SGD 800: the s.29(1) quarter does not bind, the s.32(1) half does and holds.',
		citation: [
			`${EA_DEDUCT}: s.29(1) “except with the Commissioner’s permission”; s.32(1) room 1,500 − 601 = 899 ≥ 800`,
			EA_DEDUCT_BASE
		],
		period: '2026-09',
		inputs: [
			...citizen(3000),
			deduct('APPROVED_DAMAGE_RECOVERY', 800, 'Lost cash float, Commissioner’s permission held')
		],
		lines: lessOther(800)
	}),
	sg({
		id: 'SG-EA15-4',
		description:
			'Consented accommodation SGD 500 and amenities SGD 250 in one salary period: together exactly one-quarter of the salary.',
		citation: [
			`${EA_DEDUCT}: s.30(2) 500 + 250 = 750 = ¼ × 3,000; s.32(1) 750 ≤ 899`,
			EA_DEDUCT_BASE
		],
		period: '2026-09',
		inputs: [
			...citizen(3000),
			deduct('ACCOMMODATION_RECOVERY', 500, 'Hostel, written consent'),
			deduct('AMENITIES_RECOVERY', 250, 'Transport, written consent')
		],
		lines: lessOther(750)
	}),
	sg({
		id: 'SG-EA15-5',
		description:
			'Accommodation SGD 500 and amenities SGD 250.01: the shared s.30(2) quarter is exceeded by a cent, so the run is refused.',
		citation: [`${EA_DEDUCT}: s.30(2) 750.01 > 750 → excess 0.01`, EA_DEDUCT_BASE],
		period: '2026-09',
		inputs: [
			...citizen(3000),
			deduct('ACCOMMODATION_RECOVERY', 500, 'Hostel, written consent'),
			deduct('AMENITIES_RECOVERY', 250.01, 'Transport, written consent')
		],
		lines: {},
		refused: 'DEDUCTION_CEILING_EXCEEDED.*by 0\\.01 SGD'
	}),
	sg({
		id: 'SG-EA17-1',
		description:
			'Two separate damage incidents of SGD 600 each: each inside its own s.29 quarter, together over the s.32(1) half once CPF counts, so the run is refused.',
		citation: [
			`${EA_DEDUCT}: s.29(1) 600 ≤ 750 per incident; s.32(1) 1,500 less the s.27(1)(h) CPF 600 (and CDAC 1) leaves 899 < 1,200`,
			EA_DEDUCT_BASE
		],
		period: '2026-09',
		inputs: [
			...citizen(3000),
			deduct('DAMAGE_RECOVERY', 600, 'Incident 1, inquiry held'),
			deduct('DAMAGE_RECOVERY', 600, 'Incident 2, inquiry held')
		],
		lines: {},
		refused: 'DEDUCTION_CEILING_EXCEEDED'
	}),
	sg({
		id: 'SG-EA17-2',
		description:
			'Co-operative society dues of SGD 1,000 with a SGD 700 damage deduction: s.32(1) leaves s.27(1)(j) dues outside the half, so both are taken.',
		citation: [
			`${EA_DEDUCT}: s.32(1) counts the 700 only, 700 ≤ 899; s.29(1) 700 ≤ 750`,
			EA_DEDUCT_BASE
		],
		period: '2026-09',
		inputs: [
			...citizen(3000),
			deduct('COOPERATIVE_DUES', 1000, 'Registered co-operative, written consent'),
			deduct('DAMAGE_RECOVERY', 700, 'Damaged equipment, inquiry held')
		],
		lines: lessOther(1700)
	}),
	sg({
		id: 'SG-EA17-3',
		description:
			'The SG-EA17-1 incidents on the last salary of an employee who resigns with notice on Wednesday 30 September 2026: s.32(2) lifts the half, so both are taken.',
		citation: [
			`${EA_DEDUCT}: s.32(2) last salary on termination; s.29(1) still 600 ≤ 750 each`,
			'Employment Act 1968 s.23(1): salary due on the last day of a resignation with notice (https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr23-)',
			EA_DEDUCT_BASE
		],
		period: '2026-09',
		inputs: [
			...citizen(3000, resigned('2026-09-30')),
			deduct('DAMAGE_RECOVERY', 600, 'Incident 1, inquiry held'),
			deduct('DAMAGE_RECOVERY', 600, 'Incident 2, inquiry held')
		],
		lines: lessOther(1200)
	}),

	// ── OW over the ceiling with AW in the same month (SG-CPF02) ─────────────────────────────────────────────────
	sg({
		id: 'SG-CPF02-4',
		description:
			'SGD 9,000 salary and a SGD 5,000 bonus on 25 September 2026: OW is capped at $8,000 and the whole bonus is AW inside the AW ceiling.',
		citation: [
			`${CPF_AW}: the ceiling reads OW subject to CPF (capped): at most 12 × 8,000 = 96,000, so the ceiling is at least 6,000 ≥ 5,000`,
			`${CPF_2026}: 37% × (8,000 + 5,000) = 4,810; employee 20% = 2,600; employer 2,210`,
			`${SHG}: CDAC on total wages 14,000 → $3`,
			`${SDL}: $11.25`
		],
		period: '2026-09',
		inputs: [...citizen(9000), bonus(5000, '2026-09-25', 'Performance bonus')],
		lines: pay(14000, { CPF: [2600, 2210], CDAC: [3, 0], SDL: [0, 11.25] })
	}),
	sg({
		id: 'SG-CPF02-5',
		description:
			'SGD 8,000 salary and a SGD 3,000 bonus on 15 December 2025: the 2025 $7,400 OW ceiling, the bonus AW in full.',
		citation: [
			`${CPF_AW}: 102,000 − at most 12 × 7,400 = 88,800 leaves at least 13,200 ≥ 3,000`,
			`${CPF_2025}: 37% × (7,400 + 3,000) = 3,848; employee 20% = 2,080; employer 1,768`,
			`${SHG}: CDAC on 11,000 → $3`,
			`${SDL}: $11.25`
		],
		period: '2025-12',
		inputs: [...citizen(8000), bonus(3000, '2025-12-15', 'Year-end bonus')],
		lines: pay(11000, { CPF: [2080, 1768], CDAC: [3, 0], SDL: [0, 11.25] })
	})
);

// ── 2026-09-30 batch 10: branches the goldens prove and no probe read (tracker rows named per case) ─────────
const CPF_2027_SPR =
	'CPF Board, CPF Contribution Rate Table from 1 January 2027, Tables 2–5 (read 2026-09-30): Table 2 (1st-year G/G) 55 & below >$750 9%/5% max $720/$400; Table 3 (2nd-year G/G) above 60–65 >$750 11%/7.5% max $880/$600; Table 4 (1st-year F/G) above 55–60 >$750 21.5%/5% max $1,720/$400; Table 5 (2nd-year F/G) above 60–65 >$750 20.5%/7.5% max $1,640/$600; OW ceiling $8,000 (https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfcontributionrates.pdf)';
const SPR_APPROVAL =
	'CPF Board, contributing more CPF for a new SPR employee: full employer / graduated employee rates need a joint application approved by the Board (https://www.cpf.gov.sg/service/article/how-can-i-contribute-more-cpf-for-my-employee-who-just-obtained-his-singapore-permanent-resident-spr-status)';
const SHG_DUAL =
	'CPF Board: "the first race listed determines the applicable SHG"; a mixed-race employee may also choose to contribute to the second fund (https://www.cpf.gov.sg/service/article/how-do-i-determine-which-self-help-group-shg-my-employee-should-contribute-to); SINDA Rules 1992 r.2 (Sikhs and Tamils are of the Indian community) (https://sso.agc.gov.sg/SL/CPFA1953-R5); tracker SG-SHG04(c) owner rule: the second fund by recorded election, a second SINDA election on an Indian-community first race refused';
const CPF_BASE_3000 = `${CPF_2026}: 37% × 3,000 = 1,110; employee 600; employer 510`;

/** A CPF or fund registration saved as incomplete. */
const unregistered = (scheme: string): ProbeInput => ({
	collection: 'employment_statutory_facts',
	values: {
		employee_id: '@e',
		employment_id: '@e_job',
		statutory_contribution_id: `@law:statutory_contributions:${scheme}`,
		effective_range: { from: HIRED, to: null },
		status: { kind: 'NOT_REGISTERED', reason: 'Registration pending' }
	}
});
const dismissed = (
	from: string,
	to: string,
	salary: number,
	more: Partial<Terms> = {}
): Partial<Hire> => ({
	from,
	to,
	terms: [{ salary, ...more }],
	exit: {
		exit_ground: 'DISMISSAL',
		exit_facts: { misconduct_dismissal: false, final_pay_not_possible: false }
	}
});

register(
	// ── SG-CPF01.unregistered, SG-SHG01.unregistered ──────────────────────────────────────────────────────────
	sg({
		id: 'SG-CPF01-4',
		description:
			'A Chinese citizen on SGD 3,000 in February 2026 whose CPF and CDAC registrations are saved NOT_REGISTERED: both are still assessed, each with a registration warning.',
		citation: [
			'CPF Act 1953 s.7(1): every employer shall pay contributions for every employee — the duty does not wait on the employer’s registration (https://sso.agc.gov.sg/Act/CPFA1953?ProvIds=pr7-)',
			'CPF (CDAC) Rules 1992 r.3(1): the employer shall deduct from each employee of the community (https://sso.agc.gov.sg/SL/CPFA1953-R6?ProvIds=pr3-)',
			CPF_BASE_3000,
			`${SHG}: CDAC $1`,
			`${SDL}: 7.50`
		],
		period: '2026-02',
		inputs: [...citizen(3000), unregistered('CPF'), unregistered('CDAC')],
		lines: pay(3000, { CPF: [600, 510], CDAC: [1, 0], SDL: [0, 7.5] }),
		warnings: ['CPF: registration incomplete', 'CDAC: registration incomplete']
	}),

	// ── SG-SHG04(c).other-first-cdac, SG-SHG04(c).dual-sinda-refused ───────────────────────────────────────────
	sg({
		id: 'SG-SHG04c-2',
		description:
			'A Sikh-Chinese citizen (first NRIC race Sikh) on SGD 3,000 in February 2026 who elects CDAC as well: SINDA plus CDAC.',
		citation: [SHG_DUAL, `${SHG}: SINDA $7, CDAC $1`, CPF_BASE_3000, `${SDL}: 7.50`],
		period: '2026-02',
		inputs: [
			...hire({
				name: 'Harpreet Lim',
				born: '1996-04-18',
				race: 'SIKH',
				terms: [{ salary: 3000 }]
			}),
			registration('CDAC', HIRED, {
				reference_number: 'PROBE-CDAC',
				elections: {
					shg_dual_cdac: true,
					shg_secondary_race: 'CHINESE',
					shg_instruction_reference: 'CDAC-DUAL-2'
				}
			})
		],
		lines: pay(3000, { CPF: [600, 510], SINDA: [7, 0], CDAC: [1, 0], SDL: [0, 7.5] })
	}),
	sg({
		id: 'SG-SHG04c-3',
		description:
			'A Tamil-Sikh citizen (first NRIC race Tamil, already SINDA) with a second SINDA election: the election is refused.',
		citation: [SHG_DUAL],
		period: '2026-02',
		inputs: [
			...hire({
				name: 'Kumar Singh',
				born: '1996-04-18',
				race: 'TAMIL',
				terms: [{ salary: 3000 }]
			}),
			registration('SINDA', HIRED, {
				reference_number: 'PROBE-SINDA',
				elections: {
					shg_dual_sinda: true,
					shg_secondary_race: 'SIKH',
					shg_instruction_reference: 'SINDA-DUAL-3'
				}
			})
		],
		lines: {},
		refused: 'dual SINDA election'
	}),

	// ── SG-CPF09.year-seams: the SPR year turns the month after the anniversary month ──────────────────────────
	...(
		[
			[
				'SG-CPF09-1',
				'2025-09-10',
				'2026-09',
				'first anniversary month (September 2026): still Table 2 (1st year G/G), 9% × 3,000 = 270; employee 5% = 150; employer 120',
				[150, 120]
			],
			[
				'SG-CPF09-2',
				'2025-09-10',
				'2026-10',
				'the month after the first anniversary: Table 3 (2nd year G/G), 24% × 3,000 = 720; employee 15% = 450; employer 270',
				[450, 270]
			],
			[
				'SG-CPF09-3',
				'2024-09-10',
				'2026-09',
				'second anniversary month (September 2026): still Table 3, 720; 450 / 270',
				[450, 270]
			],
			[
				'SG-CPF09-4',
				'2024-09-10',
				'2026-10',
				'the month after the second anniversary: Table 1 full rates, 37% = 1,110; 600 / 510',
				[600, 510]
			]
		] as const
	).map(([id, since, period, rule, cpf]) =>
		sg({
			id,
			description: `An SPR since ${since}, aged 30, on SGD 3,000 in ${period}: ${rule.split(':')[0]}.`,
			citation: [CPF_SPR, `${CPF_2026}: ${rule}`, `${SHG}: CDAC $1 (SPR)`, `${SDL}: 7.50`],
			period,
			inputs: citizen(3000, {
				from: since < HIRED ? HIRED : since,
				terms: [{ salary: 3000, residency: 'PERMANENT_RESIDENT', since }]
			}),
			lines: pay(3000, { CPF: [cpf[0], cpf[1]], CDAC: [1, 0], SDL: [0, 7.5] })
		})
	),

	// ── SG-CPF31.spr-tables: the 2027 SPR tables ──────────────────────────────────────────────────────────────
	...(
		[
			[
				'SG-CPF31-1',
				'1996-04-18',
				'2026-06-10',
				null,
				'Table 2, 55 & below: 9% × 3,000 = 270; employee 5% = 150; employer 120',
				[150, 120]
			],
			[
				'SG-CPF31-2',
				'1964-05-10',
				'2025-06-10',
				null,
				'Table 3, above 60–65: 11% × 3,000 = 330; employee 7.5% = 225; employer 105',
				[225, 105]
			],
			[
				'SG-CPF31-3',
				'1969-05-10',
				'2026-06-10',
				'CPF-JOINT-APPROVAL-6',
				'Table 4, above 55–60: 21.5% × 3,000 = 645; employee 5% = 150; employer 495',
				[150, 495]
			],
			[
				'SG-CPF31-4',
				'1964-05-10',
				'2025-06-10',
				'CPF-JOINT-APPROVAL-7',
				'Table 5, above 60–65: 20.5% × 3,000 = 615; employee 7.5% = 225; employer 390',
				[225, 390]
			]
		] as const
	).map(([id, born, since, approval, rule, cpf]) =>
		sg({
			id,
			description: `An SPR since ${since}, born ${born}, on SGD 3,000 in January 2027: ${rule.split(':')[0]}.`,
			citation: [
				CPF_SPR,
				`${CPF_2027_SPR}: ${rule}`,
				...(approval == null ? [] : [SPR_APPROVAL]),
				CPF_AGE,
				`${SHG}: CDAC $1 (SPR)`,
				`${SDL}: 7.50`
			],
			period: '2027-01',
			inputs: [
				...citizen(3000, {
					born,
					from: since,
					terms: [{ salary: 3000, residency: 'PERMANENT_RESIDENT', since }]
				}),
				...(approval == null
					? []
					: [
							registration('CPF', since, {
								reference_number: 'PROBE-CPF',
								elections: {
									spr_full_rate: false,
									spr_full_employer_rate: true,
									spr_approval_reference: approval
								}
							})
						])
			],
			lines: pay(3000, { CPF: [cpf[0], cpf[1]], CDAC: [1, 0], SDL: [0, 7.5] })
		})
	),

	// ── SG-EA01.manager: s.88(4) reaches a manager ─────────────────────────────────────────────────────────────
	sg({
		id: 'SG-EA01-1',
		description:
			'A manager (MANAGERIAL) on SGD 3,000 works eight hours on Hari Raya Haji, Wednesday 27 May 2026, at a company that pays: outside Part 4, but s.88(4) still earns the extra day.',
		citation: [
			`${EA_35}: a manager is outside Part 4 (overtime, rest days) only`,
			`${EA_88}: (4) extra day at the basic rate; the company records no time-off election (public_holiday_compensation default PAY)`,
			MOM_PH,
			`${EA_PART4}: Third Schedule 12 × 3,000 ÷ 260 = 138.4615 → 138.46`,
			`${CPF_2026}: 37% × 3,138.46 = 1,161.23 → 1,161; employee 627.69 → 627; employer 534`,
			`${SHG}: CDAC $1`,
			`${SDL}: 7.846 → 7.85`
		],
		period: '2026-05',
		inputs: [
			...citizen(3000, { terms: [{ salary: 3000, classification: 'MANAGERIAL' }] }),
			holiday('2026-05-01', 'Labour Day'),
			holiday('2026-05-27', 'Hari Raya Haji'),
			workDay(
				'2026-05-27',
				[
					['09:00', '13:00'],
					['14:00', '18:00']
				],
				{ approved_overtime_hours: 8 }
			)
		],
		lines: pay(3138.46, { CPF: [627, 534], CDAC: [1, 0], SDL: [0, 7.85] })
	}),

	// ── SG-EA19.classification-change: Part 4 from the dated change ───────────────────────────────────────────
	sg({
		id: 'SG-EA19-6',
		description:
			'A SGD 2,288 employee is MANAGERIAL to 15 September 2026 and EA_COVERED from Wednesday 16 September; two planned overtime hours on Monday 7 (manager) and on Monday 21 September (covered): only the second is paid.',
		citation: [
			`${EA_35}: Part 4 reaches the employee only while not in a managerial or executive position`,
			`${EA_PART4}: 21 September 2 h × 12.00 × 1.5 = 36.00`,
			`${EA_20A}: 2,288 × 11 ÷ 22 + 2,288 × 11 ÷ 22 = 2,288`,
			`${CPF_2026}: 37% × 2,324 = 859.88 → 860; employee 464.80 → 464; employer 396`,
			`${SHG}: CDAC $1`,
			`${SDL}: 5.81`
		],
		period: '2026-09',
		inputs: [
			...citizen(2288, {
				terms: [
					{ salary: 2288, classification: 'MANAGERIAL', to: '2026-09-15' },
					{ salary: 2288, from: '2026-09-16' }
				]
			}),
			workDay(
				'2026-09-07',
				[
					['09:00', '13:00'],
					['14:00', '20:00']
				],
				{ approved_overtime_hours: 2 }
			),
			workDay(
				'2026-09-21',
				[
					['09:00', '13:00'],
					['14:00', '20:00']
				],
				{ approved_overtime_hours: 2 }
			)
		],
		lines: pay(2324, { CPF: [464, 396], CDAC: [1, 0], SDL: [0, 5.81] })
	}),

	// ── SG-EA34.part-year, SG-EA34.service-ladder: the leaver’s annual leave ──────────────────────────────────
	sg({
		id: 'SG-EA34-1',
		description:
			'A citizen on SGD 4,400 hired Monday 5 January 2026, dismissed (not for misconduct) with last day Friday 29 May 2026: 4 completed months give 2.33 days, a fraction under one-half, so 2 untaken days are paid.',
		citation: [
			`${EA_88A}: 7 × 4 ÷ 12 = 2.33 → 2 days (s.88A(3): a fraction of one-half or more is a day, this one is not); 2 × 12 × 4,400 ÷ 260 = 406.15`,
			`${EA_20A}: May 2026 holds 21 working days (no holiday published for the case), all worked → 4,400`,
			`${CPF_ACT}: leave pay on termination is AW (tracker SG-CPF04)`,
			`${CPF_2026}: 37% × 4,806.15 = 1,778.28 → 1,778; employee 961.23 → 961; employer 817`,
			`${SHG}: CDAC $1.50 on 4,806.15`,
			`${SDL}: over 4,500 → $11.25`
		],
		period: '2026-05',
		inputs: [
			...citizen(4400, dismissed('2026-01-05', '2026-05-29', 4400)),
			...attended('2026-01-05', '2026-05-29'),
			encash(2, ['2026-01-05', '2027-01-04'], '2026-05-29')
		],
		lines: pay(4806.15, { CPF: [961, 817], CDAC: [1.5, 0], SDL: [0, 11.25] })
	}),
	sg({
		id: 'SG-EA34-2',
		since: '2018-02-26',
		description:
			'A citizen on SGD 4,400 with service since 1 March 2018, dismissed (not for misconduct) with last day Friday 18 September 2026, in the ninth service year: 14 days a year (the top of the ladder) × 6 completed months = 7 untaken days paid.',
		citation: [
			`${EA_88A}: s.88A(1) 7 days in the first year rising by one to 14 in the eighth year and after; ninth year (from 1 March 2026) 14 × 6 ÷ 12 = 7; 7 × 12 × 4,400 ÷ 260 = 1,421.54`,
			'Employment Act 1968 s.88A(5): attendance through 28 February 2026 is the opening declaration, 0 unexcused days (tracker SG-EA34 owner rule) (https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr88A-)',
			`${EA_20A} (b): 1–18 September holds 14 of 22 working days: 4,400 × 14 ÷ 22 = 2,800`,
			`${CPF_2026}: 37% × 4,221.54 = 1,561.97 → 1,562; employee 844.31 → 844; employer 718`,
			`${SHG}: CDAC $1.50 on 4,221.54`,
			`${SDL}: 0.25% × 4,221.54 = 10.55`
		],
		period: '2026-09',
		inputs: [
			...citizen(
				4400,
				dismissed('2018-03-01', '2026-09-18', 4400, {
					opening: { through: '2026-02-28', absent: 0 }
				})
			),
			...attended('2026-03-01', '2026-09-18'),
			encash(7, ['2026-03-01', '2027-02-28'], '2026-09-18')
		],
		lines: pay(4221.54, { CPF: [844, 718], CDAC: [1.5, 0], SDL: [0, 10.55] })
	}),

	// ── SG-SDL02.no-wages: a whole month of no-pay leave ──────────────────────────────────────────────────────
	sg({
		id: 'SG-SDL02-2',
		description:
			'A citizen on SGD 3,000 on no-pay leave at his own request for the whole of September 2026: no wages, so no CPF, fund or levy.',
		citation: [
			`${EA_20A} (c): 0 of 22 days worked → 0`,
			'SDL Act 1979 s.3(1)–(2): the levy is on the remuneration paid for the month; none is paid or payable (https://sso.agc.gov.sg/Act/SDLA1979#pr3-)',
			`${CPF_2026}: TW $50 or less → nil`,
			'CPF Board, self-help groups: deducted from the month’s wages; no wages, no deduction (https://www.cpf.gov.sg/employer/employer-obligations/contributions-to-self-help-groups)'
		],
		period: '2026-09',
		inputs: [...citizen(3000), unpaid('2026-09-01', '2026-09-30')],
		lines: pay(0, {})
	}),

	// ── SG-CPF21.changed-ow: a raised OW re-estimates the AW ceiling ──────────────────────────────────────────
	sg({
		id: 'SG-CPF21-5',
		description:
			'A citizen raised from SGD 5,000 to SGD 8,000 on 1 March 2026 (January–February contributed on 5,000) is paid a SGD 100,000 bonus on 10 March: the ceiling is re-estimated on the new OW.',
		citation: [
			`${CPF_AW}: estimated OW 10,000 + 8,000 × 10 (March–December) = 90,000 → ceiling 12,000 (on the old 5,000 forecast it would be 42,000)`,
			`${CPF_2026}: 37% × (8,000 + 12,000) = 7,400; employee 4,000; employer 3,400`,
			CPF_WAGES,
			`${SHG}: CDAC $3 on 108,000`,
			`${SDL}: capped at $11.25`
		],
		period: '2026-03',
		inputs: [
			...citizen(5000, {
				terms: [
					{ salary: 5000, to: '2026-02-28' },
					{ salary: 8000, from: '2026-03-01' }
				]
			}),
			registration('CPF', HIRED, {
				reference_number: 'PROBE-CPF',
				opening: [
					{
						year: '2026',
						base: 10000,
						ordinary: 10000,
						employee: 2000,
						employer: 1700,
						origin: 'CURRENT_EMPLOYER',
						reference: 'This employer’s CPF submissions, January–February 2026'
					}
				]
			}),
			bonus(100000, '2026-03-10', 'Performance bonus')
		],
		lines: pay(108000, { CPF: [4000, 3400], CDAC: [3, 0], SDL: [0, 11.25] })
	}),

	// ── SG-CPF22.concurrent: a concurrent employer’s OW does not consume this ceiling ─────────────────────────
	sg({
		id: 'SG-CPF22-3',
		description:
			'The SG-CPF21-2 employee (SGD 8,000, January–November contributed here) also works concurrently for another employer (SGD 55,000 OW there): the December SGD 20,000 bonus still meets this employer’s own $6,000 ceiling.',
		citation: [
			'CPF Board, AW ceiling for concurrent employment: each employer applies its own AW ceiling (https://www.cpf.gov.sg/service/article/how-do-i-apply-the-additional-wage-ceiling-for-the-following-scenarios-a-employee-a-is-working-for-two-companies-concurrently-b-employee-b-is-transferred-from-another-entity)',
			`${CPF_AW}: 102,000 − (88,000 + 8,000) = 6,000; the concurrent 55,000 is not counted`,
			`${CPF_2026}: 37% × (8,000 + 6,000) = 5,180; employee 2,800; employer 2,380`,
			`${SHG}: CDAC $3 on 28,000`,
			`${SDL}: capped at $11.25`
		],
		period: '2026-12',
		inputs: [
			...citizen(8000),
			registration('CPF', HIRED, {
				reference_number: 'PROBE-CPF',
				opening: [
					{
						year: '2026',
						base: 88000,
						ordinary: 88000,
						employee: 17600,
						employer: 14960,
						origin: 'CURRENT_EMPLOYER',
						reference: 'This employer’s CPF submissions, January–November 2026'
					},
					{
						year: '2026',
						base: 55000,
						ordinary: 55000,
						employee: 11000,
						employer: 9350,
						origin: 'OTHER_EMPLOYER',
						reference: 'Concurrent employer’s CPF statement, January–November 2026'
					}
				]
			}),
			bonus(20000, '2026-12-15', '13th-month payment')
		],
		lines: pay(28000, { CPF: [2800, 2380], CDAC: [3, 0], SDL: [0, 11.25] })
	})
);

// ── Phase 2 (capability plan §4): stored checks, PWM reference rows and the obligation ledger ─────────────────

/** The last terms row of `inputs`, expected refused with `pattern`. */
const refuseLastTerms = (inputs: readonly ProbeInput[], pattern: string): ProbeInput[] => {
	const last = inputs.findLastIndex((input) => input.collection === 'employment_terms');
	return inputs.map((input, index) => (index === last ? { ...input, refused: pattern } : input));
};
/** `e_job` recorded as leaving on `lastDay` for `ground`; `refused` expects the stored EXIT checks to refuse it. */
const leave = (lastDay: string, ground: string, refused?: string): ProbeInput => ({
	collection: 'employments',
	target: '@e_job',
	values: { effective_range: { from: HIRED, to: lastDay }, exit_ground: ground },
	...(refused === undefined ? {} : { refused })
});
/** A case whose oracle is a refusal or saved rows: the event run commits, and no payslip is pinned. */
const noSlip = (c: Parameters<typeof sg>[0], saved?: ProbeCase['saved']): ProbeCase => ({
	...sg(c),
	expected: [],
	...(saved === undefined ? {} : { saved })
});

const RRA_2026 =
	'Retirement and Re-employment Act 1993 s.4(1): no employer shall dismiss an employee below the prescribed minimum retirement age on the ground of age; Retirement and Re-employment Notifications S 187/2026, in force 1 July 2026 (https://sso.agc.gov.sg/SL/RRA1993-S187-2026?DocDate=20260401&ValidDate=20260701&ViewType=Within); MOM cohorts: born 1 July 1958–30 June 1960 retirement age 62, born 1 July 1960–30 June 1963 63, born from 1 July 1963 64 (re-employment to 69 for all three)';
/** A Chinese citizen born `born`, on SGD 3,000 from 2 June 2025. */
const older = (born: string) =>
	hire({ name: 'Lim Ah Kow', born, race: 'CHINESE', terms: [{ salary: 3000 }] });

register(
	// ── SG-HR24.born-from-1963 / .born-1960-1963 / .born-1958-1960 ──────────────────────────────────────────────
	noSlip({
		id: 'SG-HR24-1',
		description:
			'Born 10 February 1964 (the from-1 July 1963 cohort): a RETIREMENT exit on 30 September 2026, aged 62, is refused — the cohort’s minimum retirement age is 64.',
		citation: [
			`${RRA_2026}: age on 30 Sep 2026 = 62 < 64 → refused (check RETIREMENT_BELOW_MINIMUM_AGE)`
		],
		period: '2026-09',
		inputs: [...older('1964-02-10'), leave('2026-09-30', 'RETIREMENT', 'minimum retirement age')],
		lines: {}
	}),
	noSlip(
		{
			id: 'SG-HR24-2',
			description:
				'Born 20 November 1962 (the 1 July 1960–30 June 1963 cohort): a RETIREMENT exit on 30 September 2026 at 63 is saved — a flat 64 would have refused it.',
			citation: [`${RRA_2026}: age on 30 Sep 2026 = 63, not below the cohort’s 63 → saved`],
			period: '2026-08',
			inputs: [...older('1962-11-20'), leave('2026-09-30', 'RETIREMENT')],
			lines: {}
		},
		[{ collection: 'employments', where: { id: '@e_job' }, rows: [{ exit_ground: 'RETIREMENT' }] }]
	),
	noSlip(
		{
			id: 'SG-HR24-3',
			description:
				'Born 1 August 1959 (the 1 July 1958–30 June 1960 cohort): a RETIREMENT exit on 30 September 2026 at 67 is saved.',
			citation: [`${RRA_2026}: age on 30 Sep 2026 = 67, not below the cohort’s 62 → saved`],
			period: '2026-08',
			inputs: [...older('1959-08-01'), leave('2026-09-30', 'RETIREMENT')],
			lines: {}
		},
		[{ collection: 'employments', where: { id: '@e_job' }, rows: [{ exit_ground: 'RETIREMENT' }] }]
	)
);

// ── SG-HR31 (Work Permit declared salary), SG-HR32 (EP/S Pass reduction needs the Controller) ─────────────────
const WP_SALARY =
	'Employment of Foreign Manpower (Work Passes) Regulations 2012 Fourth Schedule: pay the Work Permit holder at least the fixed monthly salary (basic plus fixed monthly allowances) declared to the Controller (https://sso.agc.gov.sg/SL/EFMA1990-S569-2012?DocDate=20251230&ProvIds=Sc4-&ValidDate=20260101); MOM, Paying the salary (https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/paying-the-salary)';
const PASS_REDUCTION =
	'Employment of Foreign Manpower (Work Passes) Regulations 2012 Fifth/Sixth Schedules: an EP or S Pass salary reduction needs the Controller’s reassessment first (https://sso.agc.gov.sg/SL/EFMA1990-S569-2012?DocDate=20251230&ProvIds=Sc5-&ValidDate=20260101)';
const foreigner = (pass: string, terms: readonly Terms[]) =>
	hire({
		name: 'Wang Jun',
		born: '1990-03-15',
		race: 'CHINESE',
		nationality: 'Chinese',
		terms: terms.map((t): Terms => ({ residency: 'FOREIGNER', pass, ...t }))
	});

register(
	sg({
		id: 'SG-HR31-1',
		description:
			'A Work Permit holder declared at SGD 1,800 and paid 1,800 to 31 August 2026; a revision to 1,600 from 1 September is refused. August pays 1,800 with SDL only.',
		citation: [
			`${WP_SALARY}: 1,600 < 1,800 → refused (check WORK_PERMIT_BELOW_DECLARED_SALARY)`,
			`${CPF_ACT}: no CPF or CDAC for a foreign employee`,
			`${SDL}: 0.25% × 1,800 = 4.50`
		],
		period: '2026-08',
		inputs: refuseLastTerms(
			foreigner('WORK_PERMIT', [
				{ salary: 1800, to: '2026-08-31', facts: { declared_fixed_monthly_salary: 1800 } },
				{ salary: 1600, from: '2026-09-01', facts: { declared_fixed_monthly_salary: 1800 } }
			]),
			'declared to the Controller'
		),
		lines: { BASIC: 1800, ...pay(1800, { SDL: [0, 4.5] }) }
	}),
	sg({
		id: 'SG-HR31-2',
		description:
			'The same Work Permit holder revised to SGD 1,900 from 1 September 2026, above the declared 1,800: saved, and September pays 1,900.',
		citation: [`${WP_SALARY}: 1,900 ≥ 1,800 → saved`, `${SDL}: 0.25% × 1,900 = 4.75`],
		period: '2026-09',
		inputs: foreigner('WORK_PERMIT', [
			{ salary: 1800, to: '2026-08-31', facts: { declared_fixed_monthly_salary: 1800 } },
			{ salary: 1900, from: '2026-09-01', facts: { declared_fixed_monthly_salary: 1800 } }
		]),
		lines: { BASIC: 1900, ...pay(1900, { SDL: [0, 4.75] }) }
	}),
	sg({
		id: 'SG-HR32-1',
		description:
			'An Employment Pass holder on SGD 6,000 to 31 August 2026; a reduction to 5,000 from 1 September with no Controller reassessment is refused. August pays 6,000.',
		citation: [
			`${PASS_REDUCTION}: 5,000 < 6,000 and no reassessment recorded → refused (check PASS_SALARY_REDUCTION_UNAPPROVED)`,
			`${SDL}: 6,000 > 4,500 → $11.25`
		],
		period: '2026-08',
		inputs: refuseLastTerms(
			foreigner('EMPLOYMENT_PASS', [
				{ salary: 6000, to: '2026-08-31' },
				{ salary: 5000, from: '2026-09-01' }
			]),
			'without a recorded Controller reassessment'
		),
		lines: { BASIC: 6000, ...pay(6000, { SDL: [0, 11.25] }) }
	}),
	sg({
		id: 'SG-HR32-2',
		description:
			'The same reduction to SGD 5,000 with the Controller’s reassessment recorded: saved, and September pays 5,000.',
		citation: [
			`${PASS_REDUCTION}: reassessment recorded → saved`,
			`${SDL}: 5,000 > 4,500 → $11.25`
		],
		period: '2026-09',
		inputs: foreigner('EMPLOYMENT_PASS', [
			{ salary: 6000, to: '2026-08-31' },
			{
				salary: 5000,
				from: '2026-09-01',
				facts: { pass_salary_reassessment_ref: 'MOM-REASSESSMENT-PROBE-1' }
			}
		]),
		lines: { BASIC: 5000, ...pay(5000, { SDL: [0, 11.25] }) }
	})
);

// ── SG-PWM01–10: the PWM_ROLE reference rows and the PWM_BELOW_FLOOR payslip warning ─────────────────────────
const PWM = (page: string, table: string) =>
	`MOM, Progressive Wage Model — ${table} (https://www.mom.gov.sg/employment-practices/progressive-wage-model/${page}, read 2026-10-01)`;
const PWM_WARNING = 'PWM_BELOW_FLOOR: P-SG-001: .*Progressive Wage floor';
/** A Chinese citizen aged 30 on `salary` in PWM job level `role`. */
const pwmWorker = (salary: number, role: string) =>
	hire({
		name: 'Tan Wei Ming',
		born: '1996-04-18',
		race: 'CHINESE',
		terms: [{ salary, facts: { pwm_role: role } }]
	});
/** One PWM case: a citizen on `salary` in `role`, warned or not, with the hand-computed CPF/CDAC/SDL. */
const pwm = (c: {
	id: string;
	description: string;
	citation: readonly string[];
	period: string;
	salary: number;
	role: string;
	warned: boolean;
	charges: Record<string, readonly [number, number]>;
}) =>
	sg({
		id: c.id,
		description: c.description,
		citation: c.citation,
		period: c.period,
		inputs: pwmWorker(c.salary, c.role),
		lines: { BASIC: c.salary, ...pay(c.salary, c.charges) },
		warnings: c.warned ? [PWM_WARNING] : []
	});
const CLEANING = PWM(
	'cleaning-sector',
	'Group 1 office and commercial: general/indoor cleaner $1,910 (1 Jul 2025–30 Jun 2026), $2,080 (1 Jul 2026–30 Jun 2027), monthly basic wage'
);

register(
	pwm({
		id: 'SG-PWM02-1',
		description:
			'A citizen general office cleaner on SGD 2,000 basic in June 2026: above the $1,910 floor of the July 2025 schedule, no warning.',
		citation: [
			`${CLEANING}: 2,000 ≥ 1,910 → no warning`,
			`${CPF_2026}: 37% × 2,000 = 740; employee 400; employer 340`,
			`${SHG}: CDAC $0.50 (≤$2,000)`,
			`${SDL}: 0.25% × 2,000 = 5.00`
		],
		period: '2026-06',
		salary: 2000,
		role: 'CLEAN_OFFICE_GENERAL',
		warned: false,
		charges: { CPF: [400, 340], CDAC: [0.5, 0], SDL: [0, 5] }
	}),
	pwm({
		id: 'SG-PWM02-2',
		description:
			'The same cleaner on SGD 2,000 in September 2026: under the $2,080 floor from 1 July 2026, so the run warns.',
		citation: [
			`${CLEANING}: 2,000 < 2,080 → PWM_BELOW_FLOOR warning`,
			`${CPF_2026}: 37% × 2,000 = 740; employee 400; employer 340`,
			`${SHG}: CDAC $0.50`,
			`${SDL}: 5.00`
		],
		period: '2026-09',
		salary: 2000,
		role: 'CLEAN_OFFICE_GENERAL',
		warned: true,
		charges: { CPF: [400, 340], CDAC: [0.5, 0], SDL: [0, 5] }
	}),
	pwm({
		id: 'SG-PWM02-3',
		description:
			'A citizen general office cleaner on SGD 2,080 in September 2026: exactly the floor, no warning.',
		citation: [
			`${CLEANING}: 2,080 ≥ 2,080 → no warning`,
			`${CPF_2026}: 37% × 2,080 = 769.60 → 770; employee 20% = 416; employer 354`,
			`${SHG}: CDAC $1 (>$2,000–3,500)`,
			`${SDL}: 0.25% × 2,080 = 5.20`
		],
		period: '2026-09',
		salary: 2080,
		role: 'CLEAN_OFFICE_GENERAL',
		warned: false,
		charges: { CPF: [416, 354], CDAC: [1, 0], SDL: [0, 5.2] }
	}),
	sg({
		id: 'SG-PWM01-1',
		description:
			'A Work Permit general office cleaner on SGD 1,500 in September 2026: PWM wages bind local (citizen and SPR) workers only, so no warning.',
		citation: [
			`${PWM('what-is-pwm', 'PWM applies to Singapore citizen and permanent resident workers')}: a foreign worker → no warning`,
			`${CPF_ACT}: no CPF or CDAC for a foreign employee`,
			`${SDL}: 0.25% × 1,500 = 3.75`
		],
		period: '2026-09',
		inputs: foreigner('WORK_PERMIT', [
			{ salary: 1500, facts: { pwm_role: 'CLEAN_OFFICE_GENERAL' } }
		]),
		lines: { BASIC: 1500, ...pay(1500, { SDL: [0, 3.75] }) },
		warnings: []
	}),
	pwm({
		id: 'SG-PWM03-1',
		description:
			'A citizen outsourced security officer on SGD 3,000 basic in February 2026: under the $3,090 floor of 2026, so the run warns.',
		citation: [
			`${PWM('security-sector', 'outsourced security officer basic monthly wage $2,870 (2025), $3,090 (1 Jan–31 Dec 2026)')}: 3,000 < 3,090 → warning`,
			CPF_BASE_3000,
			`${SHG}: CDAC $1`,
			`${SDL}: 7.50`
		],
		period: '2026-02',
		salary: 3000,
		role: 'SECURITY_OUTSOURCED_OFFICER',
		warned: true,
		charges: { CPF: [600, 510], CDAC: [1, 0], SDL: [0, 7.5] }
	}),
	pwm({
		id: 'SG-PWM04-1',
		description:
			'A citizen landscape worker on SGD 2,000 basic in September 2026: under the $2,095 floor, so the run warns.',
		citation: [
			`${PWM('landscape-sector', 'landscape worker $1,950 (1 Jul 2025–30 Jun 2026), $2,095 (1 Jul 2026–30 Jun 2027), monthly basic wage')}: 2,000 < 2,095 → warning`,
			`${CPF_2026}: 740; employee 400; employer 340`,
			`${SHG}: CDAC $0.50`,
			`${SDL}: 5.00`
		],
		period: '2026-09',
		salary: 2000,
		role: 'LANDSCAPE_WORKER',
		warned: true,
		charges: { CPF: [400, 340], CDAC: [0.5, 0], SDL: [0, 5] }
	}),
	pwm({
		id: 'SG-PWM05-1',
		description:
			'A citizen assistant lift and escalator specialist on SGD 2,700 basic in September 2026: under the $2,750 floor, so the run warns.',
		citation: [
			`${PWM('lift-and-escalator-sector', 'assistant L&E specialist $2,525 (1 Jul 2025–30 Jun 2026), $2,750 (1 Jul 2026–30 Jun 2027), monthly basic wage')}: 2,700 < 2,750 → warning`,
			`${CPF_2026}: 37% × 2,700 = 999; employee 540; employer 459`,
			`${SHG}: CDAC $1`,
			`${SDL}: 0.25% × 2,700 = 6.75`
		],
		period: '2026-09',
		salary: 2700,
		role: 'LIFT_ASSISTANT_SPECIALIST',
		warned: true,
		charges: { CPF: [540, 459], CDAC: [1, 0], SDL: [0, 6.75] }
	}),
	pwm({
		id: 'SG-PWM06-1',
		description:
			'A citizen retail assistant on SGD 2,400 in August 2026: above the $2,305 floor of 1 Sep 2025–31 Aug 2026, no warning.',
		citation: [
			`${PWM('retail-sector', 'retail assistant/cashier $2,305 (1 Sep 2025–31 Aug 2026), $2,435 (1 Sep 2026–31 Aug 2027), monthly gross wage excluding OT')}: 2,400 ≥ 2,305 → no warning`,
			`${CPF_2026}: 37% × 2,400 = 888; employee 480; employer 408`,
			`${SHG}: CDAC $1`,
			`${SDL}: 0.25% × 2,400 = 6.00`
		],
		period: '2026-08',
		salary: 2400,
		role: 'RETAIL_ASSISTANT',
		warned: false,
		charges: { CPF: [480, 408], CDAC: [1, 0], SDL: [0, 6] }
	}),
	pwm({
		id: 'SG-PWM06-2',
		description:
			'The same retail assistant on SGD 2,400 in September 2026: under the $2,435 floor from 1 September 2026, so the run warns.',
		citation: [
			`${PWM('retail-sector', 'retail assistant/cashier $2,435 from 1 Sep 2026')}: 2,400 < 2,435 → warning`,
			`${CPF_2026}: 888; employee 480; employer 408`,
			`${SHG}: CDAC $1`,
			`${SDL}: 6.00`
		],
		period: '2026-09',
		salary: 2400,
		role: 'RETAIL_ASSISTANT',
		warned: true,
		charges: { CPF: [480, 408], CDAC: [1, 0], SDL: [0, 6] }
	}),
	pwm({
		id: 'SG-PWM07-1',
		description:
			'A citizen quick-service food/drink stall assistant on SGD 2,200 in September 2026: under the $2,220 floor, so the run warns.',
		citation: [
			`${PWM('food-services-sector', 'Category A food/drink stall assistant $2,080 (1 Mar 2025–30 Jun 2026), $2,220 (1 Jul 2026–30 Jun 2027), monthly gross wage excluding OT')}: 2,200 < 2,220 → warning`,
			`${CPF_2026}: 37% × 2,200 = 814; employee 440; employer 374`,
			`${SHG}: CDAC $1`,
			`${SDL}: 0.25% × 2,200 = 5.50`
		],
		period: '2026-09',
		salary: 2200,
		role: 'FOOD_QS_STALL_ASSISTANT',
		warned: true,
		charges: { CPF: [440, 374], CDAC: [1, 0], SDL: [0, 5.5] }
	}),
	pwm({
		id: 'SG-PWM08-1',
		description:
			'A citizen waste-collection crew member on SGD 2,800 in September 2026: under the $2,840 floor, so the run warns.',
		citation: [
			`${PWM('waste-management-sector', 'waste collection crew $2,630 (1 Jul 2025–30 Jun 2026), $2,840 (1 Jul 2026–30 Jun 2027), monthly gross wage excluding OT')}: 2,800 < 2,840 → warning`,
			`${CPF_2026}: 37% × 2,800 = 1,036; employee 560; employer 476`,
			`${SHG}: CDAC $1`,
			`${SDL}: 0.25% × 2,800 = 7.00`
		],
		period: '2026-09',
		salary: 2800,
		role: 'WASTE_COLLECTION_CREW',
		warned: true,
		charges: { CPF: [560, 476], CDAC: [1, 0], SDL: [0, 7] }
	}),
	pwm({
		id: 'SG-PWM09-1',
		description:
			'A citizen administrative assistant on SGD 2,100 in September 2026: under the $2,170 Occupational Progressive Wage, so the run warns.',
		citation: [
			`${PWM('occupational-pws-for-administrators-and-drivers', 'administrative assistant $1,980 (1 Jul 2025–30 Jun 2026), $2,170 (1 Jul 2026–30 Jun 2027), monthly gross wage')}: 2,100 < 2,170 → warning`,
			`${CPF_2026}: 37% × 2,100 = 777; employee 420; employer 357`,
			`${SHG}: CDAC $1`,
			`${SDL}: 0.25% × 2,100 = 5.25`
		],
		period: '2026-09',
		salary: 2100,
		role: 'ADMIN_ASSISTANT',
		warned: true,
		charges: { CPF: [420, 357], CDAC: [1, 0], SDL: [0, 5.25] }
	}),
	pwm({
		id: 'SG-PWM10-1',
		description:
			'A citizen general driver on SGD 2,300 in June 2026: above the old taxonomy’s $2,190 general-driver floor, no warning.',
		citation: [
			`${PWM('occupational-pws-for-administrators-and-drivers', 'general driver $2,190 (1 Jul 2025–30 Jun 2026)')}: 2,300 ≥ 2,190 → no warning`,
			`${CPF_2026}: 37% × 2,300 = 851; employee 460; employer 391`,
			`${SHG}: CDAC $1`,
			`${SDL}: 0.25% × 2,300 = 5.75`
		],
		period: '2026-06',
		salary: 2300,
		role: 'DRIVER_GENERAL',
		warned: false,
		charges: { CPF: [460, 391], CDAC: [1, 0], SDL: [0, 5.75] }
	}),
	pwm({
		id: 'SG-PWM10-2',
		description:
			'A citizen Group A Level 1 driver (Class 3 licence) on SGD 2,300 in September 2026: under the new taxonomy’s $2,370, so the run warns.',
		citation: [
			`${PWM('occupational-pws-for-administrators-and-drivers', 'Group A (Class 3 or below) Level 1 $2,370 (1 Jul 2026–30 Jun 2027)')}: 2,300 < 2,370 → warning`,
			`${CPF_2026}: 851; employee 460; employer 391`,
			`${SHG}: CDAC $1`,
			`${SDL}: 5.75`
		],
		period: '2026-09',
		salary: 2300,
		role: 'DRIVER_GROUP_A_LEVEL_1',
		warned: true,
		charges: { CPF: [460, 391], CDAC: [1, 0], SDL: [0, 5.75] }
	})
);

// ── The obligation ledger: SG-CPF05, SG-CPF16, SG-SDL05, SG-SHG01.remittance, SG-EA09, SG-HR01, SG-IRAS05 ───
const due = (duty: string, subject: string, rows: readonly Row[], ref?: string) => ({
	collection: 'obligation_instances',
	where: {
		duty_code: duty,
		subject_id: subject,
		...(ref === undefined ? {} : { trigger_ref: ref })
	},
	rows
});

register({
	...sg({
		id: 'SG-OBL-1',
		description:
			'A citizen on SGD 3,000 hired 1 September 2026; the September 2026 run raises the month’s CPF, SDL, SHG and salary-payment duties, the hire raises key employment terms, and the calendar raises the IR8A return of 2025 and 2026, each with its cited due day.',
		citation: [
			'CPF Regulations 1987 reg.2(1): not later than 14 days after the end of the month → 30 Sep + 14 = 14 Oct 2026 (a Wednesday) (https://sso.agc.gov.sg/SL/CPFA1953-RG15)',
			'SDL Regulations reg.3: within 14 days after the month → 14 Oct 2026; the month’s levy 7.50 rounded down to the dollar for a local employee = 7 (SSG SDL NOA 2023 FAQ F.7)',
			'CPF Board: self-help group contributions are paid with the CPF submission → 14 Oct 2026',
			'Employment Act 1968 s.21(1): salary before the expiry of the 7th day after the salary period → 30 Sep + 7 = 7 Oct 2026',
			'Employment Act 1968 s.95A(2): key employment terms not later than 14 days after the start → 1 Sep + 14 = 15 Sep 2026',
			'Income Tax Act 1947 s.68(2); IRAS AIS: IR8A by 1 March of the following year → 1 Mar 2026 (year 2025), 1 Mar 2027 (year 2026)',
			CPF_BASE_3000,
			`${SHG}: CDAC $1`,
			`${SDL}: 7.50`
		],
		period: '2026-09',
		inputs: citizen(3000, { from: '2026-09-01' }),
		lines: { BASIC: 3000, ...pay(3000, { CPF: [600, 510], CDAC: [1, 0], SDL: [0, 7.5] }) }
	}),
	saved: [
		due('CPF_MONTHLY_SUBMISSION_AND_PAYMENT', '@run', [
			{ trigger_ref: '2026-09', due_on: '2026-10-14', state: 'OPEN' }
		]),
		due('SDL_REMITTANCE', '@run', [{ due_on: '2026-10-14', amount_due: 7 }]),
		due('SHG_DEDUCTION_REMITTANCE', '@run', [{ due_on: '2026-10-14' }]),
		due('SALARY_PAYMENT_DEADLINE', '@run', [{ due_on: '2026-10-07' }]),
		due('KEY_EMPLOYMENT_TERMS', '@e_job', [{ trigger_ref: 'HIRE', due_on: '2026-09-15' }]),
		due('ANNUAL_EMPLOYMENT_INCOME_RETURN', '@company', [{ due_on: '2026-03-01' }], '2025'),
		due('ANNUAL_EMPLOYMENT_INCOME_RETURN', '@company', [{ due_on: '2027-03-01' }], '2026')
	]
});

// ── An off-cycle bonus before the regular run: the salary is settled early beside it ───────────────────────────
register({
	id: 'SG-OFFCYCLE-01-1',
	profile: 'SG',
	description:
		'SG-CPF21-1 paid in two runs: the SGD 10,000 bonus off-cycle on 10 September 2026, before the regular run. The off-cycle act first settles the September salary early (an EARLY run), then charges the bonus as the month less the salary; the regular September run pays the person nothing. A no-pay day on Tuesday 15 September recorded after the early settlement is accepted and settles in October, as an October line priced on September.',
	citation: [
		'Owner design 2026-10-01 (off-cycle settles salary first; statutory is a monthly bill; a record made after the early settlement settles in the next period).',
		CPF_WAGES,
		`${CPF_2026}: the salary month 37% × 5,000 = 1,850, employee 1,000, employer 850; the whole month 37% × 15,000 = 5,550, employee 3,000, employer 2,550 (SG-CPF21-1), so the bonus slip carries 2,000 / 1,700`,
		`${SHG}: CDAC $1.50 on the 5,000 salary month, $3 on the 15,000 month: the bonus slip carries $1.50`,
		`${SDL}: $11.25 on the salary month already, the whole month's $11.25 cap: nothing on the bonus slip`,
		`${EA_20A}: September 2026 requires 22 working days, so the no-pay day is 5,000 ÷ 22 = 227.27, paid as an October line`,
		`${CPF_2026}: October total wages 5,000 − 227.27 = 4,772.73: total 37% = 1,765.91 → 1,766; employee 20% = 954.54 → 954; employer 812`,
		`${SHG}: CDAC $1.50 on 4,772.73. ${SDL}: 0.25% × 4,772.73 = 11.93, capped at $11.25`
	],
	company: { facts: { sdl_individual_employer: false } },
	inputs: [
		...officeWeek(HIRED),
		...citizen(5000),
		{ ...bonus(10000, '2026-09-10', 'Performance bonus'), ref: 'bonus_pay' }
	],
	history: [
		{
			period: '2026-09',
			kind: 'OFF_CYCLE',
			sources: ['@bonus_pay'],
			expected: [
				{
					employment: 'e_job',
					lines: { bonus: 10000, ...pay(10000, { CPF: [2000, 1700], CDAC: [1.5, 0] }) }
				}
			],
			early: [
				{
					employment: 'e_job',
					lines: {
						BASIC: 5000,
						...pay(5000, { CPF: [1000, 850], CDAC: [1.5, 0], SDL: [0, 11.25] })
					}
				}
			]
		},
		{
			period: '2026-09',
			inputs: [unpaid('2026-09-15', '2026-09-15')],
			absent: ['e_job']
		}
	],
	period: '2026-10',
	expected: [
		{
			employment: 'e_job',
			lines: {
				BASIC: 5000,
				UNPAID_LEAVE: 227.27,
				...pay(4772.73, { CPF: [954, 812], CDAC: [1.5, 0], SDL: [0, 11.25] })
			}
		}
	]
});
