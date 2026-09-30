/**
 * The differential probe: every synthetic scenario of `tests/e2e/profiles/<profile>.ts` run through the production
 * path (the built artifact under bolt-server's `start()`, `/__bolt/act` writes, the Payroll app's
 * `payroll_runs.create`, the saved payslips — `boot()` / `runCase()` of `payroll-probe.ts`), every saved line judged
 * against that profile's independent oracle (`tests/e2e/oracle/<profile>.ts` `computePayslip`).
 *
 * Shape. A profile's adapter maps one scenario onto probe inputs: `shared` rows (roster, holidays, worksites) and the
 * company override belong to the company, `inputs` to the person (local refs, prefixed per scenario in a batch).
 * Scenarios with the same company, shared rows and run list share one company; a batch of up to `DIFF_BATCH` of them
 * is one `runCase` (one company, every employee, each period of `runs` in order, the last judged). A batch whose
 * writes or run are refused is split in halves until the refusing scenario stands alone. A scenario the oracle
 * refuses, or one whose law reads the company's headcount, runs alone.
 *
 * A scenario field with no production-path precedent in `tests/e2e/probes/<profile>.ts` (or a collection shape no
 * probe writes) is not guessed: the adapter throws `Unmapped` and the scenario is reported as unmapped, not judged.
 *
 * Judgement: every key the oracle prices, plus every saved statutory key, to 0.01 (a missing key is 0); the oracle's
 * own unpriced keys are skipped. Company-assessed charges (`companyLines`) and run warnings are not judged.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCase, type Host, type ProbeCase, type ProbeInput, type Row } from './payroll-probe.ts';

type Json = Row[string];

export class Unmapped extends Error {}
/** The scenario carries a branch this adapter cannot express on the production path. */
export const unmapped = (what: string): never => {
	throw new Unmapped(what);
};

/** One scenario as probe inputs. */
export type Mapped = {
	/** company overrides (facts, region …) */
	company?: Row;
	/** company-level rows: the roster, published holidays, worksites; refs here are not prefixed */
	shared?: readonly ProbeInput[];
	/** the person's rows, local refs */
	inputs: readonly ProbeInput[];
	/** local ref of the employment whose slip is judged */
	employment: string;
	/** every period run, in order; the last is judged */
	runs: readonly string[];
	/** local employment refs `leave_encashment_on_exit` settles before the judged run */
	exits?: readonly string[];
	/** run alone: the law reads the company as a whole (headcount) */
	solo?: boolean;
};
/** What the oracle says the judged slip is. */
export type Verdict = {
	lines: Record<string, number>;
	/** the law refuses the slip as described (a refused write or run) */
	refused: string | null;
	/** keys the oracle declines to price */
	unjudged: readonly string[];
};
type Tagged = { id: string; rows: readonly string[]; branches: readonly string[] };
type Entry = { tags: Tagged; map: () => Mapped; verdict: () => Verdict };
export type Profile = { code: string; entries: () => Entry[] };

export const profile = <S extends Tagged>(
	code: string,
	generate: () => S[],
	map: (s: S) => Mapped,
	verdict: (s: S) => Verdict
): Profile => ({
	code,
	entries: () => generate().map((s) => ({ tags: s, map: () => map(s), verdict: () => verdict(s) }))
});

// ---------------------------------------------------------------------------------------------------------------
// Oracle lines
// ---------------------------------------------------------------------------------------------------------------

type OracleLine = { amount?: number; employee?: number; employer?: number };
/** An oracle's `lines` (flat numbers, or `{ amount | employee | employer }` per code) as probe keys. */
export function flatLines(lines: Record<string, number | OracleLine>): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [key, v] of Object.entries(lines)) {
		if (typeof v === 'number') out[key] = v;
		else {
			if (v.amount !== undefined) out[key] = v.amount;
			if (v.employee !== undefined) out[`${key}.employee`] = v.employee;
			if (v.employer !== undefined) out[`${key}.employer`] = v.employer;
		}
	}
	return out;
}
const reason = (r: unknown): string | null =>
	r == null || r === false
		? null
		: typeof r === 'string'
			? r
			: typeof r === 'object' && 'reason' in r
				? String(r.reason)
				: JSON.stringify(r);

/** The generic verdict of an oracle result: `refused` (a string or `{ reason }`), `lines` via `probe` or flattened. */
export const verdictOf = (
	result: { refused?: unknown; lines?: unknown },
	probe?: Record<string, number>,
	unjudged: readonly string[] = []
): Verdict => ({
	lines: probe ?? flatLines((result.lines ?? {}) as Record<string, number | OracleLine>),
	refused: reason(result.refused),
	unjudged
});

// ---------------------------------------------------------------------------------------------------------------
// Input helpers shared by the adapters
// ---------------------------------------------------------------------------------------------------------------

const DAY = 86_400_000;
export const addDays = (d: string, n: number) =>
	new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
export const monthDays = (period: string) => {
	const out: string[] = [];
	for (let d = `${period}-01`; d.startsWith(period); d = addDays(d, 1)) out.push(d);
	return out;
};
export const lastDay = (period: string) => monthDays(period).at(-1)!;
export const periodsFrom = (from: string, to: string) => {
	const out: string[] = [];
	for (let p = from; p <= to; p = addDays(`${lastDay(p)}`, 1).slice(0, 7)) out.push(p);
	return out;
};
/** The office week (Mon–Fri 09:00–18:00, one hour's break, Sat off, Sun rest) is anchored on this Monday. */
export const ANCHOR = '2000-01-03';
export const COMPANY_FROM = '2000-01-01';

/** `hours` of work from `start` (HH:MM) with the 13:00–14:00 break once it is crossed, as `[from, to]` clock pairs. */
export function clock(hours: number, start = '09:00'): [string, string][] {
	const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
	const hhmm = (m: number) =>
		`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
	const s = toMin(start);
	const end = s + Math.round(hours * 60);
	if (s >= 13 * 60 || end <= 13 * 60) return [[hhmm(s), hhmm(end)]];
	return [
		[hhmm(s), '13:00'],
		['14:00', hhmm(end + 60)]
	];
}
/** A work day of `job` at offset `tz`: the clock pairs, plus any extra fields. */
export const workDay = (
	job: string,
	date: string,
	pairs: readonly (readonly [string, string])[],
	tz: string,
	extra: Row = {}
): ProbeInput => ({
	collection: 'work_days',
	values: {
		employment_id: `@${job}`,
		work_date: date,
		worked_intervals: pairs.map(([start, end]) => ({
			start: `${date}T${start}:00${tz}`,
			end: `${date}T${end}:00${tz}`
		})),
		...extra
	}
});
export const holidayRow = (date: string, name = 'Public holiday'): ProbeInput => ({
	collection: 'jurisdiction_holidays',
	values: {
		company_id: '@company',
		date,
		name,
		kind: 'PUBLIC_HOLIDAY',
		source: 'differential probe',
		published_at: '2024-01-01T00:00:00.000Z'
	}
});
export const adhocRow = (
	job: string,
	code: string,
	amount: number,
	date: string,
	reason: string,
	extra: Partial<ProbeInput> = {}
): ProbeInput => ({
	collection: 'adhoc_requests',
	values: {
		employment_id: `@${job}`,
		catalogue_id: `@law:adhoc_catalogue:${code}`,
		amount,
		event_date: date,
		pay_period: date.slice(0, 7),
		reason,
		as_adjustment_entry: false
	},
	...extra
});
export const leaveRow = (
	job: string,
	code: string,
	from: string,
	to: string,
	extra: Row = {},
	files?: Record<string, string>
): ProbeInput => ({
	collection: 'leave_entries',
	values: {
		employment_id: `@${job}`,
		catalogue_id: `@law:leave_catalogue:${code}`,
		reference: `DIFF-${code}-${from}`,
		from_date: from,
		to_date: to,
		reason: code.toLowerCase().replaceAll('_', ' '),
		...extra
	},
	...(files === undefined ? {} : { files })
});
export const registration = (
	person: string,
	job: string,
	scheme: string,
	from: string,
	status: Row
): ProbeInput => ({
	collection: 'employment_statutory_facts',
	values: {
		employee_id: `@${person}`,
		employment_id: `@${job}`,
		statutory_contribution_id: `@law:statutory_contributions:${scheme}`,
		effective_range: { from, to: null },
		status
	}
});
/** Sorted dates as inclusive ranges, joined across days `skip` accepts (weekends, holidays). */
export function ranges(dates: readonly string[], skip: (d: string) => boolean = () => false) {
	const out: [string, string][] = [];
	for (const d of [...dates].sort()) {
		const last = out.at(-1);
		let gap = last === undefined ? null : addDays(last[1], 1);
		while (gap !== null && gap < d && skip(gap)) gap = addDays(gap, 1);
		if (last !== undefined && gap === d) last[1] = d;
		else out.push([d, d]);
	}
	return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Batching and judgement
// ---------------------------------------------------------------------------------------------------------------

/** Every local ref of `inputs` renamed `<p><ref>`, and every employment given a unique employee number. */
export function prefixInputs(inputs: readonly ProbeInput[], p: string): ProbeInput[] {
	const local = new Set(inputs.flatMap((i) => (i.ref === undefined ? [] : [i.ref])));
	const rename = (v: Json): Json => {
		if (typeof v === 'string' && v.startsWith('@') && local.has(v.slice(1))) return `@${p}${v.slice(1)}`;
		if (Array.isArray(v)) return (v as readonly Json[]).map(rename);
		if (typeof v === 'object' && v !== null)
			return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rename(x)]));
		return v;
	};
	return inputs.map((input) => {
		const values = rename(input.values) as Row;
		return {
			...input,
			...(input.ref === undefined ? {} : { ref: `${p}${input.ref}` }),
			...(input.target === undefined ? {} : { target: rename(input.target) as string }),
			values:
				input.collection === 'employments' && input.target === undefined
					? { ...values, employee_number: `${p}${String(values.employee_number ?? 'E')}` }
					: values
		};
	});
}

export type Disagreement = {
	scenario: string;
	rows: readonly string[];
	branches: readonly string[];
	line: string;
	engine: number | string;
	oracle: number | string;
};
const TOTALS = ['gross', 'net', 'total_deductions', 'employer_cost'];

/** Every line where the saved slip and the oracle differ by more than 0.01; `[]` agrees. */
export function judge(
	tags: Tagged,
	verdict: Verdict,
	saved: { lines: Record<string, number> } | { refused: string }
): Disagreement[] {
	const at = (line: string, engine: number | string, oracle: number | string): Disagreement => ({
		scenario: tags.id,
		rows: tags.rows,
		branches: tags.branches,
		line,
		engine,
		oracle
	});
	if (verdict.refused !== null)
		return 'refused' in saved ? [] : [at('run', 'paid', `refused: ${verdict.refused}`)];
	if ('refused' in saved) return [at('run', `refused: ${saved.refused}`, 'paid')];
	const skip = new Set(verdict.unjudged);
	const keys = new Set([
		...TOTALS,
		...Object.keys(verdict.lines),
		...Object.keys(saved.lines).filter((k) => /\.(employee|employer)$/.test(k))
	]);
	const out: Disagreement[] = [];
	for (const key of [...keys].sort()) {
		if (skip.has(key) || (TOTALS.includes(key) && !(key in verdict.lines))) continue;
		const engine = saved.lines[key] ?? 0;
		const oracle = verdict.lines[key] ?? 0;
		if (Math.abs(engine - oracle) > 0.01 + 1e-9) out.push(at(key, engine, oracle));
	}
	return out;
}

type Job = { tags: Tagged; mapped: Mapped; verdict: Verdict };
type Outcome = { job: Job; disagreements: Disagreement[] };

/** One batch as one company: its rows, every run, the judged slips; a refused batch is split in halves. */
async function runBatch(host: Host, code: string, jobs: readonly Job[], n: string): Promise<Outcome[]> {
	const head = jobs[0]!.mapped;
	const probe: ProbeCase = {
		id: `diff-${code}-${n}`,
		profile: code,
		description: `differential batch ${n}`,
		citation: [],
		company: { effective_range: { from: COMPANY_FROM, to: null }, ...head.company },
		inputs: [
			...(head.shared ?? []),
			...jobs.flatMap((job, k) => prefixInputs(job.mapped.inputs, `s${k}_`))
		],
		history: head.runs.slice(0, -1).map((period) => ({ period })),
		period: head.runs.at(-1)!,
		expected: jobs.map((job, k) => ({ employment: `s${k}_${job.mapped.employment}`, lines: {} })),
		...(jobs.some((job) => job.mapped.exits !== undefined)
			? { exits: jobs.flatMap((job, k) => (job.mapped.exits ?? []).map((ref) => `s${k}_${ref}`)) }
			: {}),
		// a refusal the oracle expects is attempted, not thrown (runs alone, see `groups`)
		...(jobs.length === 1 && jobs[0]!.verdict.refused !== null ? { refused: '' } : {})
	};
	let results: Awaited<ReturnType<typeof runCase>>;
	try {
		results = await runCase(host, probe);
	} catch (error) {
		if (jobs.length > 1) {
			const half = Math.ceil(jobs.length / 2);
			return [
				...(await runBatch(host, code, jobs.slice(0, half), `${n}a`)),
				...(await runBatch(host, code, jobs.slice(half), `${n}b`))
			];
		}
		const text = error instanceof Error ? error.message : String(error);
		return [{ job: jobs[0]!, disagreements: judge(jobs[0]!.tags, jobs[0]!.verdict, { refused: text }) }];
	}
	return jobs.map((job, k) => {
		if (probe.refused !== undefined) {
			const run = results.find((r) => r.employment === 'run')!;
			const saved =
				run.differences.length === 0
					? { refused: JSON.stringify(run.actual) }
					: { lines: {} as Record<string, number> };
			return { job, disagreements: judge(job.tags, job.verdict, saved) };
		}
		const slip = results.find((r) => r.employment === `s${k}_${job.mapped.employment}`);
		return {
			job,
			disagreements: judge(job.tags, job.verdict, {
				lines: (slip?.actual ?? {}) as Record<string, number>
			})
		};
	});
}

/** Scenarios grouped by company shape and run list, in batches; refused and company-wide ones alone. */
function groups(jobs: readonly Job[], size: number): Job[][] {
	const by = new Map<string, Job[]>();
	for (const job of jobs) {
		const m = job.mapped;
		const alone = m.solo === true || job.verdict.refused !== null;
		const key = JSON.stringify([m.company ?? {}, m.shared ?? [], m.runs, alone ? job.tags.id : ''])
		by.set(key, [...(by.get(key) ?? []), job]);
	}
	const out: Job[][] = [];
	for (const list of by.values())
		for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
	return out;
}

/** `tasks` run with at most `limit` in flight. */
async function pool<T>(tasks: readonly (() => Promise<T>)[], limit: number): Promise<T[]> {
	const out: T[] = [];
	let next = 0;
	const worker = async () => {
		while (next < tasks.length) {
			const i = next++;
			out[i] = await tasks[i]!();
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
	return out;
}

export type ProfileReport = {
	profile: string;
	scenarios: number;
	agreed: number;
	disagreed: number;
	unmapped: { scenario: string; reason: string }[];
	disagreements: Disagreement[];
	/** tracker row / branch → agreed and disagreed scenarios */
	agreement: {
		rows: Record<string, { agreed: number; disagreed: number }>;
		branches: Record<string, { agreed: number; disagreed: number }>;
	};
};

/** One profile, every scenario: mapped, batched, run on `host`, judged. */
export async function differential(
	host: Host,
	p: Profile,
	opts: { batch: number; concurrency: number; log?: (line: string) => void }
): Promise<ProfileReport> {
	const unmappedList: ProfileReport['unmapped'] = [];
	const jobs: Job[] = [];
	for (const entry of p.entries()) {
		try {
			jobs.push({ tags: entry.tags, mapped: entry.map(), verdict: entry.verdict() });
		} catch (error) {
			if (!(error instanceof Unmapped)) throw error;
			unmappedList.push({ scenario: entry.tags.id, reason: error.message });
		}
	}
	const batches = groups(jobs, opts.batch);
	let done = 0;
	const outcomes = (
		await pool(
			batches.map((batch, i) => async () => {
				const out = await runBatch(host, p.code, batch, String(i));
				opts.log?.(`${p.code}: batch ${++done}/${batches.length} (${batch.length} scenarios)`);
				return out;
			}),
			opts.concurrency
		)
	).flat();
	const agreement: ProfileReport['agreement'] = { rows: {}, branches: {} };
	const tally = (into: Record<string, { agreed: number; disagreed: number }>, key: string, ok: boolean) => {
		const t = (into[key] ??= { agreed: 0, disagreed: 0 });
		if (ok) t.agreed++;
		else t.disagreed++;
	};
	for (const { job, disagreements } of outcomes) {
		const ok = disagreements.length === 0;
		for (const row of job.tags.rows) tally(agreement.rows, row, ok);
		for (const branch of job.tags.branches) tally(agreement.branches, branch, ok);
	}
	const disagreed = outcomes.filter((o) => o.disagreements.length > 0).length;
	return {
		profile: p.code,
		scenarios: jobs.length + unmappedList.length,
		agreed: outcomes.length - disagreed,
		disagreed,
		unmapped: unmappedList,
		disagreements: outcomes.flatMap((o) => o.disagreements),
		agreement
	};
}

/** `<dir>/<profile>.json` per report (summary, disagreements, unmapped) and `<dir>/agree.json`. */
export function writeReports(dir: string, reports: readonly ProfileReport[]) {
	mkdirSync(dir, { recursive: true });
	for (const r of reports) {
		const { agreement: _, ...rest } = r;
		writeFileSync(join(dir, `${r.profile}.json`), `${JSON.stringify(rest, null, '\t')}\n`);
	}
	writeFileSync(
		join(dir, 'agree.json'),
		`${JSON.stringify(Object.fromEntries(reports.map((r) => [r.profile, r.agreement])), null, '\t')}\n`
	);
}

// ---------------------------------------------------------------------------------------------------------------
// The office roster every adapter shares: a Monday-anchored week, 5 × OFFICE, OFF, REST (see `officeWeek`)
// ---------------------------------------------------------------------------------------------------------------
import { officeWeek } from './payroll-probe.ts';
const OFFICE = officeWeek(ANCHOR);
/** Mon–Fri of `period` that are not in `holidays`. */
export const workingDays = (period: string, holidays: readonly string[] = []) =>
	monthDays(period).filter((d) => weekday(d) >= 1 && weekday(d) <= 5 && !holidays.includes(d));

// ---------------------------------------------------------------------------------------------------------------
// SG (precedents: tests/e2e/probes/SG.ts `hire`, `registration`, `workDay`, `holiday`, `bonus`, `encash`, `deduct`)
// ---------------------------------------------------------------------------------------------------------------
import * as sgOracle from './oracle/SG.ts';
import { generateProfiles as sgScenarios } from './profiles/SG.ts';

const SG_PASS = { EP: 'EMPLOYMENT_PASS', S_PASS: 'S_PASS', WORK_PERMIT: 'WORK_PERMIT' } as const;
const SG_EXIT: Record<string, Row> = {
	RESIGNATION: { exit_ground: 'RESIGNATION', exit_facts: { notice_served: true } },
	DISMISSAL: {
		exit_ground: 'DISMISSAL',
		exit_facts: { misconduct_dismissal: false, final_pay_not_possible: false }
	},
	RETRENCHMENT: { exit_ground: 'RETRENCHMENT', exit_facts: { final_pay_not_possible: false } },
	CONTRACT_END: { exit_ground: 'END_OF_CONTRACT', exit_facts: {} },
	DEATH: { exit_ground: 'DEATH', exit_facts: {} }
};

function sgMap(s: sgOracle.Scenario): Mapped {
	const e = s.employee;
	const job = s.employment;
	const m = s.month;
	const tz = '+08:00';
	if (job.part_time !== undefined) unmapped('part_time (no SG part-time probe)');
	if (job.monthly_allowance !== undefined || job.rate_changes?.some((c) => c.monthly_allowance))
		unmapped('monthly_allowance (SG has no allowance catalogue)');
	if (m.medical_reimbursement !== undefined) unmapped('medical_reimbursement (no claim probe)');
	if (e.sdl_exempt_student) unmapped('sdl_exempt_student (no SG student probe)');
	const end = job.end ?? null;
	// terms: a new row at every status change and rate change
	const status = (day: string) => sgOracle.statusOn(e, day);
	const cuts = [
		job.start,
		...[e.spr_granted_on, e.citizen_on].filter(
			(d): d is string => d !== undefined && d > job.start && (end === null || d <= end)
		),
		...(job.rate_changes ?? []).map((c) => c.from)
	];
	const starts = [...new Set(cuts)].sort();
	const salaryOn = (day: string) =>
		[...(job.rate_changes ?? [])].reverse().find((c) => c.from <= day)?.monthly_basic ?? job.monthly_basic;
	const terms = starts.map((from, i): ProbeInput => {
		const st = status(from);
		const next = starts[i + 1];
		return {
			collection: 'employment_terms',
			values: {
				employment_id: '@job',
				residency_status: st === 'SPR' ? 'PERMANENT_RESIDENT' : st,
				...(st === 'SPR' ? { residency_since: e.spr_granted_on! } : {}),
				...(st === 'CITIZEN' && e.citizen_on !== undefined ? { residency_since: e.citizen_on } : {}),
				...(st === 'FOREIGNER' ? { pass_type: SG_PASS[e.pass ?? 'EP'] } : {}),
				tax_residency: 'RESIDENT',
				currency: 'SGD',
				base_salary: salaryOn(from),
				pay_frequency: 'MONTHLY',
				work_classification: job.managerial ? 'MANAGERIAL' : 'EA_COVERED',
				statutory_work_category: job.workman ? 'MANUAL_LABOUR' : 'NON_MANUAL',
				employment_type: 'PERMANENT',
				shift_pattern_id: '@week',
				...(m.leave_days_paid_on_exit !== undefined
					? {
							opening_attendance_through: addDays(`${s.period}-01`, -1),
							opening_unexcused_absence_days: 0,
							opening_attendance_reference: 'DIFF-OPENING-ATTENDANCE'
						}
					: {}),
				effective_range: { from, to: next === undefined ? end : addDays(next, -1) }
			}
		};
	});
	const funds = sgOracle.funds(e);
	const first = sgOracle.funds({ ...e, shg_dual_election: false, shg_opt_out: [] });
	const regs: ProbeInput[] = [];
	const reg = (scheme: string, from: string, status: Row) =>
		regs.push(registration('person', 'job', scheme, from, status));
	const sprFrom = e.spr_granted_on !== undefined && e.spr_granted_on > job.start ? e.spr_granted_on : job.start;
	if (s.employer_unregistered)
		for (const scheme of ['CPF', ...funds])
			reg(scheme, job.start, { kind: 'NOT_REGISTERED', reason: 'Registration pending' });
	else {
		const cpf: Row = {
			...(e.spr_rates === 'FULL_EMPLOYER' || e.spr_rates === 'FULL'
				? {
						elections: {
							spr_full_rate: e.spr_rates === 'FULL',
							spr_full_employer_rate: e.spr_rates === 'FULL_EMPLOYER',
							spr_approval_reference: 'DIFF-CPF-APPROVAL'
						}
					}
				: {}),
			...(s.cpf_opening === undefined
				? {}
				: {
						opening: [
							{
								year: s.period.slice(0, 4),
								base: s.cpf_opening.ordinary_wages_ytd + s.cpf_opening.additional_wages_ytd,
								ordinary: s.cpf_opening.ordinary_wages_ytd,
								employee: 0,
								employer: 0,
								origin: 'CURRENT_EMPLOYER',
								reference: 'This employer’s CPF submissions this year'
							},
							...(s.cpf_opening.other_employer_ow_ytd === undefined
								? []
								: [
										{
											year: s.period.slice(0, 4),
											base: s.cpf_opening.other_employer_ow_ytd,
											ordinary: s.cpf_opening.other_employer_ow_ytd,
											employee: 0,
											employer: 0,
											...(s.cpf_opening.related_company_approved
												? {
														origin: 'APPROVED_RELATED_EMPLOYER',
														board_approval_reference: 'DIFF-CPF-BOARD',
														employers_related: true,
														employee_informed: true,
														terms_unchanged: true,
														transferred_employee: true
													}
												: { origin: 'OTHER_EMPLOYER' }),
											reference: 'Earlier employer’s CPF this year'
										}
									])
						]
					})
		};
		if (Object.keys(cpf).length > 0)
			reg('CPF', e.spr_rates === undefined ? job.start : sprFrom, {
				kind: 'REGISTERED',
				reference_number: 'DIFF-CPF',
				...cpf
			});
		for (const fund of e.shg_opt_out ?? [])
			reg(fund, job.start, {
				kind: 'REGISTERED',
				reference_number: `DIFF-${fund}`,
				elections: { shg_opt_out: true, shg_instruction_reference: `DIFF-${fund}-OPT-OUT` }
			});
		const second = funds.filter((f) => !first.includes(f));
		for (const fund of second) {
			if (fund !== 'CDAC' && fund !== 'SINDA') unmapped(`dual ${fund} election`);
			reg(fund, job.start, {
				kind: 'REGISTERED',
				reference_number: `DIFF-${fund}`,
				elections: {
					[`shg_dual_${fund.toLowerCase()}`]: true,
					shg_secondary_race: e.second_race!,
					shg_instruction_reference: `DIFF-${fund}-DUAL`
				}
			});
		}
		if (e.shg_instruction !== undefined)
			reg(e.shg_instruction.fund, job.start, {
				kind: 'REGISTERED',
				reference_number: `DIFF-${e.shg_instruction.fund}`,
				elections: {
					shg_monthly_amount: e.shg_instruction.amount,
					shg_instruction_reference: `DIFF-${e.shg_instruction.fund}-INSTRUCTION`
				}
			});
	}
	reg('SDL', job.start, {
		kind: 'REGISTERED',
		reference_number: 'DIFF-SDL',
		elections: {
			sdl_service_scope: job.wholly_outside_singapore ? 'OUTSIDE_SINGAPORE' : 'SINGAPORE_SERVICE',
			sdl_household_role: job.household_role ? 'CHAUFFEUR' : 'NONE',
			sdl_wholly_exclusive: job.household_role === true,
			sdl_nonbusiness: job.household_role === true,
			sdl_student_class: 'NONE'
		}
	});

	const holidays = s.holidays;
	const skip = (d: string) => weekday(d) === 0 || weekday(d) === 6 || holidays.includes(d);
	const on = (d: string) => (end !== null && end < d ? end : d);
	const mid = on(`${s.period}-15`);
	const last = on(lastDay(s.period));
	const gross = job.monthly_basic;
	const time: ProbeInput[] = [
		...holidays.filter((d) => weekday(d) === 6).map((d) => workDay('job', d, [], tz)),
		...(m.absent ?? []).map((d) => workDay('job', d, [], tz)),
		...(m.overtime ?? []).map((o) =>
			workDay('job', o.date, clock(8 + o.hours), tz, { approved_overtime_hours: o.hours })
		),
		...(m.rest_day_work ?? []).map((w) =>
			workDay('job', w.date, clock(w.hours), tz, {
				approved_overtime_hours: w.hours,
				requested_by: w.requested_by
			})
		),
		...(m.holiday_work ?? []).map((w) =>
			workDay('job', w.date, clock(w.hours), tz, { approved_overtime_hours: w.hours })
		),
		...ranges(m.no_pay_leave ?? [], skip).map(([from, to]) =>
			leaveRow('job', 'UNPAID_LEAVE', from, to, {
				half_day_start: false,
				half_day_end: false,
				no_pay_origin: 'EMPLOYEE_REQUESTED'
			})
		),
		...(m.paid_leave ?? []).map((l) =>
			l.kind === 'ANNUAL'
				? leaveRow('job', 'ANNUAL_LEAVE', l.date, l.date, { half_day_start: false, half_day_end: false })
				: leaveRow(
						'job',
						l.kind === 'OUTPATIENT' ? 'SICK_LEAVE' : 'HOSPITALIZATION_LEAVE',
						l.date,
						l.date,
						{ half_day_start: false, half_day_end: false },
						{ certificate_file: `sick-${l.date}.pdf` }
					)
		),
		...(m.bonus === undefined ? [] : [adhocRow('job', 'bonus', m.bonus, mid, 'Bonus')]),
		...(m.retrenchment_benefit === undefined
			? []
			: [adhocRow('job', 'RETRENCHMENT_BENEFIT', m.retrenchment_benefit, last, 'Retrenchment benefit')]),
		...(m.damage_recovery === undefined
			? []
			: [
					adhocRow(
						'job',
						m.damage_recovery.commissioner_permitted ? 'APPROVED_DAMAGE_RECOVERY' : 'DAMAGE_RECOVERY',
						m.damage_recovery.loss,
						mid,
						'Damage recovery, inquiry held',
						{ files: { evidence_file: 'damage-record.pdf' } }
					)
				]),
		...(m.notice_in_lieu_weeks === undefined && m.notice_in_lieu_days === undefined
			? []
			: [
					adhocRow(
						'job',
						'SALARY_IN_LIEU_OF_NOTICE',
						sgOracle.noticePayInLieu(gross, m.notice_in_lieu_weeks ?? 0, m.notice_in_lieu_days ?? 0),
						last,
						'Salary in lieu of notice'
					)
				]),
		...(m.leave_days_paid_on_exit === undefined
			? []
			: (() => {
					// the service year holding the last day
					let from = `${last.slice(0, 4)}${job.start.slice(4)}`;
					if (from > last) from = `${Number(last.slice(0, 4)) - 1}${job.start.slice(4)}`;
					const to = addDays(`${Number(from.slice(0, 4)) + 1}${from.slice(4)}`, -1);
					return [
						leaveRow('job', 'ANNUAL_LEAVE', from, to, {
							reference: 'DIFF-EXIT-ANNUAL',
							encash_days: m.leave_days_paid_on_exit,
							effective_on: last,
							due_on: last
						})
					];
				})())
	];
	return {
		company: {
			facts: {
				sdl_individual_employer: false,
				...(m.off_day_holiday === 'SUBSTITUTE' || m.holiday_work?.some((w) => w.time_off_in_lieu)
					? { public_holiday_compensation: 'TIME_OFF' }
					: {})
			}
		},
		shared: [...OFFICE, ...holidays.map((d) => holidayRow(d))],
		inputs: [
			{
				collection: 'employees',
				ref: 'person',
				values: {
					name: `Differential ${s.id}`,
					date_of_birth: e.birth_date,
					gender: 'MALE',
					nationality: e.residency === 'FOREIGNER' ? 'Foreign' : 'Singaporean',
					race: e.race,
					religion: e.religion ?? 'OTHER'
				}
			},
			{
				collection: 'employments',
				ref: 'job',
				values: {
					employee_id: '@person',
					company_id: '@company',
					employee_number: 'SG',
					effective_range: { from: job.start, to: end },
					...(job.exit_cause === undefined ? {} : SG_EXIT[job.exit_cause])
				}
			},
			...terms,
			...regs,
			...time
		],
		employment: 'job',
		runs: [s.period]
	};
}
const sg = profile('SG', sgScenarios, sgMap, (s) => verdictOf({ lines: sgOracle.computePayslip(s).lines }));
