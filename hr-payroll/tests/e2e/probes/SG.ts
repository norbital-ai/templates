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
	/** The opening attendance declaration: absence decided outside through `through`, `absent` unexcused days. */
	opening?: { through: string; absent: number };
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
				work_classification: 'EA_COVERED',
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
}): ProbeCase {
	return {
		id: c.id,
		profile: 'SG',
		description: c.description,
		citation: c.citation,
		company: { facts: { sdl_individual_employer: false, ...c.company } },
		inputs: [...officeWeek(c.since ?? HIRED), ...c.inputs],
		period: c.period,
		expected: [{ employment: 'e_job', lines: c.lines }]
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
					exit_reason: 'DISMISSAL',
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
				exit: { exit_reason: 'RETRENCHMENT', exit_facts: { final_pay_not_possible: false } }
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
